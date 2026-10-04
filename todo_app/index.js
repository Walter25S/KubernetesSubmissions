const fs = require('fs');
const http = require('http');
const path = require('path');

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
const imageDir = required('IMAGE_DIR');
const imageFile = path.join(imageDir, 'image.jpg');
const imageUrl = required('IMAGE_URL');
const imageTtlMs = requiredInt('IMAGE_TTL_MS');
const backendUrl = required('TODO_BACKEND_URL');
const requestTimeoutMs = requiredInt('REQUEST_TIMEOUT_MS');
const shutdownEnabled = process.env.ENABLE_SHUTDOWN === 'true';
// A button of the page that "breaks" the app, to see Kubernetes restart it (exercise 4.2)
const breakEnabled = process.env.ENABLE_BREAK_BUTTON === 'true';

// What the health check answers. The button sets it to false; the container is restarted by
// Kubernetes (liveness probe) and it starts again as true.
let isHealthy = true;

const MAX_TODO_LENGTH = requiredInt('MAX_TODO_LENGTH');
const MAX_BODY_BYTES = requiredInt('MAX_BODY_BYTES');
const imageTtlMinutes = Math.round(imageTtlMs / 60000);

fs.mkdirSync(imageDir, { recursive: true });

// --- picture cache (exercise 1.12) ---

let refreshing = null;

const downloadImage = async () => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Image request failed with status ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const tmpFile = `${imageFile}.tmp`;
  fs.writeFileSync(tmpFile, buffer);
  fs.renameSync(tmpFile, imageFile);
  console.log(`New image saved (${buffer.length} bytes)`);
};

const refreshImage = () => {
  if (!refreshing) {
    refreshing = downloadImage()
      .catch((err) => console.error(`Could not fetch a new image: ${err.message}`))
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
};

const imageAge = () => {
  try {
    return Date.now() - fs.statSync(imageFile).mtimeMs;
  } catch (err) {
    return null;
  }
};

// --- todos (exercise 2.2): stored by the todo-backend service ---

const fetchTodos = async () => {
  const response = await fetch(`${backendUrl}/todos`, { signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!response.ok) {
    throw new Error(`todo-backend answered ${response.status}`);
  }
  return response.json();
};

const createTodo = async (todo) => {
  const response = await fetch(`${backendUrl}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todo }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`todo-backend answered ${response.status}`);
  }
};

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderPage = (todos, message) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Todo app</title>
  </head>
  <body>
    <h1>Todo app</h1>
    <img src="/image" alt="Random picture" width="400" />
    <p>The picture changes every ${imageTtlMinutes} minutes.</p>

    <form action="/todos" method="post">
      <input
        type="text"
        name="todo"
        maxlength="${MAX_TODO_LENGTH}"
        placeholder="What needs to be done?"
        aria-label="New todo"
        required
      />
      <button type="submit">Create todo</button>
      <small>Max ${MAX_TODO_LENGTH} characters</small>
    </form>
${
  breakEnabled
    ? `    <form action="/break" method="post">
      <button type="submit">Break the app</button>
      <small>The health check starts to fail and Kubernetes restarts the container</small>
    </form>
`
    : ''
}
${message ? `    <p><strong>${escapeHtml(message)}</strong></p>\n` : ''}
    <h2>Todos</h2>
    <ul>
${todos.map((item) => `      <li>${escapeHtml(item.todo)}</li>`).join('\n')}
    </ul>
  </body>
</html>
`;

// --- http helpers ---

const sendText = (res, status, text) => {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
};

const sendHtml = (res, status, html) => {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
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
  // Liveness probe (exercise 4.2): 200 while the app is healthy, 500 after the button was
  // pressed. When it fails Kubernetes restarts the container.
  if (req.method === 'GET' && req.url === '/healthz') {
    if (!isHealthy) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Readiness probe (exercise 4.2): ready when the app is healthy AND the backend, which owns
  // the database, is connected to it. If it fails the pod gets no traffic; it is not restarted.
  if (req.method === 'GET' && req.url === '/readyz') {
    if (!isHealthy) {
      sendText(res, 500, 'unhealthy\n');
      return;
    }
    try {
      const response = await fetch(`${backendUrl}/healthz`, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`todo-backend answered ${response.status}`);
      }
      sendText(res, 200, 'ok\n');
    } catch (err) {
      sendText(res, 503, `not ready: ${err.message}\n`);
    }
    return;
  }

  if (breakEnabled && req.method === 'POST' && req.url === '/break') {
    isHealthy = false;
    console.log('The app was broken with the button: the health check now fails');
    res.writeHead(303, { Location: '/' });
    res.end();
    return;
  }

  // While it is broken the normal operation of the app stops
  if (!isHealthy) {
    sendText(res, 503, 'The app is broken. Kubernetes will restart it in a few seconds.\n');
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    try {
      sendHtml(res, 200, renderPage(await fetchTodos()));
    } catch (err) {
      console.error(`Could not get the todos: ${err.message}`);
      sendHtml(res, 200, renderPage([], 'The todos are not available right now.'));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/todos') {
    let todo;
    try {
      todo = (new URLSearchParams(await readBody(req)).get('todo') || '').trim();
    } catch (err) {
      sendText(res, 413, 'Request too large\n');
      return;
    }
    if (todo.length === 0 || todo.length > MAX_TODO_LENGTH) {
      sendHtml(res, 400, renderPage([], `A todo must have 1-${MAX_TODO_LENGTH} characters.`));
      return;
    }
    try {
      await createTodo(todo);
    } catch (err) {
      console.error(`Could not create the todo: ${err.message}`);
      sendHtml(res, 502, renderPage([], 'The todo could not be saved, try again later.'));
      return;
    }
    res.writeHead(303, { Location: '/' });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/image') {
    const age = imageAge();
    if (age === null) {
      await refreshImage();
    } else if (age > imageTtlMs) {
      // Serve the old picture one more time, the next request gets a new one.
      refreshImage();
    }
    fs.readFile(imageFile, (err, data) => {
      if (err) {
        sendText(res, 502, 'Image not available\n');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/shutdown' && shutdownEnabled) {
    sendText(res, 200, 'Shutting down\n');
    setTimeout(() => process.exit(1), 100);
    return;
  }

  sendText(res, 404, 'Not found\n');
});

server.listen(port, () => {
  console.log(`Server started in port ${port}`);
});
