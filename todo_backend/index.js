const http = require('http');

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

const todos = [];
let nextId = 1;

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

const server = http.createServer(async (req, res) => {
  if (req.url !== '/todos') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (req.method === 'GET') {
    sendJson(res, 200, todos);
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
      sendJson(res, 400, { error: `todo must be 1-${MAX_TODO_LENGTH} characters` });
      return;
    }
    const todo = { id: nextId, todo: text };
    nextId += 1;
    todos.push(todo);
    console.log(`Created todo ${todo.id}`);
    sendJson(res, 201, todo);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

server.listen(port, () => {
  console.log(`Server started in port ${port}`);
});
