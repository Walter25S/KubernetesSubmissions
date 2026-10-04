const http = require('http');
const { Pool } = require('pg');
const { connect, JSONCodec } = require('nats');

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
const MAX_TODO_LENGTH = requiredInt('MAX_TODO_LENGTH');
const MAX_BODY_BYTES = requiredInt('MAX_BODY_BYTES');
const retryDelayMs = requiredInt('DB_RETRY_DELAY_MS');

const pool = new Pool({
  host: required('DB_HOST'),
  port: requiredInt('DB_PORT'),
  database: required('DB_NAME'),
  user: required('DB_USER'),
  password: required('DB_PASSWORD'),
  // do not wait forever for a connection: the readiness probe has to get an answer
  connectionTimeoutMillis: requiredInt('DB_CONNECT_TIMEOUT_MS'),
});

// true once the table exists, that is, once the database has answered at least once
let databaseReady = false;

// --- messaging (exercise 4.6) ---
// The backend tells the other services about the changes of the todos by publishing a message
// to NATS; the broadcaster listens to it. It is optional: without NATS_URL no message is sent
// (for example in the environments that do not have NATS). Publishing never makes a request
// fail and does not wait: a message that cannot be sent is lost, which is acceptable here.
const natsUrl = process.env.NATS_URL || '';
const natsSubject = natsUrl ? required('NATS_SUBJECT') : '';
const jsonCodec = JSONCodec();
let natsConnection = null;

const startMessaging = () => {
  if (!natsUrl) {
    console.log('Messaging is off: NATS_URL is not set');
    return;
  }
  // waitOnFirstConnect: keep trying if NATS is not there yet instead of giving up
  connect({
    servers: natsUrl,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2000,
    waitOnFirstConnect: true,
  })
    .then((connection) => {
      natsConnection = connection;
      console.log(`Connected to NATS at ${natsUrl}, subject ${natsSubject}`);
    })
    .catch((err) => console.error(`NATS connection failed: ${err.message}`));
};

const publishEvent = (event, todo) => {
  if (!natsConnection || natsConnection.isClosed()) {
    return;
  }
  try {
    natsConnection.publish(natsSubject, jsonCodec.encode({ event, todo }));
  } catch (err) {
    console.error(`Could not publish the message: ${err.message}`);
  }
};

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
        'CREATE TABLE IF NOT EXISTS todos (id SERIAL PRIMARY KEY, todo TEXT NOT NULL)',
      );
      // The "done" field (exercise 4.5). A database created before it has the table without
      // the column, so it is added if it is missing; the existing todos are not done.
      await pool.query(
        'ALTER TABLE todos ADD COLUMN IF NOT EXISTS done BOOLEAN NOT NULL DEFAULT false',
      );
      databaseReady = true;
      console.log('Database ready');
      return;
    } catch (err) {
      console.error(`Database not available yet: ${err.message}`);
      await sleep(retryDelayMs);
    }
  }
};

// One line per request, written when the response has been sent.
const logRequest = (req, res, startedAt, details) => {
  const ms = Date.now() - startedAt;
  console.log(`${req.method} ${req.url} ${res.statusCode} ${ms}ms${details ? ` ${details}` : ''}`);
};

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

// The probes call these every few seconds: they are not logged, to keep the log readable.
const PROBES = ['/healthz', '/livez'];

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  let details = '';
  if (!PROBES.includes(req.url)) {
    res.on('finish', () => logRequest(req, res, startedAt, details));
  }

  // Liveness probe (exercise 4.2): the process answers. It does not look at the database: if the
  // database is down a restart of the backend would not fix it.
  if (req.method === 'GET' && req.url === '/livez') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  // Readiness probe (exercise 4.2): ready only when it is connected to the database. If it
  // fails the pod is taken out of the Service (todo-app gets errors from the other pods or none)
  // but it is not restarted.
  if (req.method === 'GET' && req.url === '/healthz') {
    try {
      if (!databaseReady) {
        throw new Error('database not ready');
      }
      await pool.query('SELECT 1');
      sendJson(res, 200, { status: 'ok' });
    } catch (err) {
      sendJson(res, 503, { status: 'unavailable', reason: err.message });
    }
    return;
  }

  const idMatch = /^\/todos\/(\d+)$/.exec(req.url);
  if (req.url !== '/todos' && !idMatch) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  // PUT /todos/<id> with {"done": true} or {"done": false} (exercise 4.5)
  if (idMatch) {
    const id = Number(idMatch[1]);
    if (req.method !== 'PUT') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    if (!Number.isSafeInteger(id) || id > 2147483647) {
      sendJson(res, 404, { error: 'Todo not found' });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      sendJson(res, 400, { error: 'Body must be valid JSON' });
      return;
    }
    if (payload === null || typeof payload.done !== 'boolean') {
      sendJson(res, 400, { error: 'done must be true or false' });
      return;
    }
    try {
      const result = await pool.query(
        'UPDATE todos SET done = $1 WHERE id = $2 RETURNING id, todo, done',
        [payload.done, id],
      );
      if (result.rowCount === 0) {
        details = `todo ${id} not found`;
        sendJson(res, 404, { error: 'Todo not found' });
        return;
      }
      details = `updated todo ${id}: done=${payload.done}`;
      publishEvent('updated', result.rows[0]);
      sendJson(res, 200, result.rows[0]);
    } catch (err) {
      console.error(`Database error: ${err.message}`);
      sendJson(res, 503, { error: 'Database not available' });
    }
    return;
  }

  if (req.method === 'GET') {
    try {
      const result = await pool.query('SELECT id, todo, done FROM todos ORDER BY id');
      sendJson(res, 200, result.rows);
    } catch (err) {
      console.error(`Database error: ${err.message}`);
      sendJson(res, 503, { error: 'Database not available' });
    }
    return;
  }

  if (req.method === 'POST') {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      sendJson(res, 400, { error: 'Body must be valid JSON' });
      return;
    }
    const text = typeof payload.todo === 'string' ? payload.todo.trim() : '';
    if (text.length === 0 || text.length > MAX_TODO_LENGTH) {
      // JSON.stringify keeps the text on a single line (no log injection).
      details = `rejected todo (${text.length} characters, limit ${MAX_TODO_LENGTH}): ${JSON.stringify(text)}`;
      sendJson(res, 400, { error: `todo must be 1-${MAX_TODO_LENGTH} characters` });
      return;
    }
    try {
      const result = await pool.query(
        'INSERT INTO todos (todo) VALUES ($1) RETURNING id, todo, done',
        [text],
      );
      details = `created todo ${result.rows[0].id}: ${JSON.stringify(text)}`;
      publishEvent('created', result.rows[0]);
      sendJson(res, 201, result.rows[0]);
    } catch (err) {
      console.error(`Database error: ${err.message}`);
      sendJson(res, 503, { error: 'Database not available' });
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

// The server starts at once, without waiting for the database: while the database is not
// there /healthz answers 503 (not ready) and /todos answers 503 too.
server.listen(port, () => {
  console.log(`Server started in port ${port}`);
});
initDatabase();
startMessaging();
