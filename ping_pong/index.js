const http = require('http');
const { Pool } = require('pg');

const required = (name) => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
};

const requiredInt = (name) => {
  const value = parseInt(required(name), 10);
  if (Number.isNaN(value) || value <= 0) {
    console.error(`Environment variable ${name} must be a positive integer`);
    process.exit(1);
  }
  return value;
};

const port = requiredInt('PORT');
const retryDelayMs = requiredInt('DB_RETRY_DELAY_MS');

const pool = new Pool({
  host: required('DB_HOST'),
  port: requiredInt('DB_PORT'),
  database: required('DB_NAME'),
  user: required('DB_USER'),
  password: required('DB_PASSWORD'),
});

// Without a handler, an error on an idle connection (for example when the
// database restarts) would crash the process. The pool replaces the connection.
pool.on('error', (err) => {
  console.error(`Idle database connection lost: ${err.message}`);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The database may still be starting when this pod starts, so keep trying.
const initDatabase = async () => {
  for (;;) {
    try {
      await pool.query(
        'CREATE TABLE IF NOT EXISTS pings (id INTEGER PRIMARY KEY, count BIGINT NOT NULL)',
      );
      await pool.query('INSERT INTO pings (id, count) VALUES (1, 0) ON CONFLICT (id) DO NOTHING');
      console.log('Database ready');
      return;
    } catch (err) {
      console.error(`Database not available yet: ${err.message}`);
      await sleep(retryDelayMs);
    }
  }
};

const sendText = (res, status, text) => {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/pingpong') {
      // count - 1 is the number of requests before this one
      const result = await pool.query(
        'UPDATE pings SET count = count + 1 WHERE id = 1 RETURNING count - 1 AS pong',
      );
      sendText(res, 200, `pong ${result.rows[0].pong}\n`);
      return;
    }
    if (req.method === 'GET' && req.url === '/pings') {
      const result = await pool.query('SELECT count FROM pings WHERE id = 1');
      sendText(res, 200, `${result.rows[0].count}\n`);
      return;
    }
  } catch (err) {
    console.error(`Database error: ${err.message}`);
    sendText(res, 503, 'Database not available\n');
    return;
  }
  sendText(res, 404, 'Not found\n');
});

initDatabase().then(() => {
  server.listen(port, () => {
    console.log(`Server started in port ${port}`);
  });
});
