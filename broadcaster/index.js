const http = require('http');
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
const natsUrl = required('NATS_URL');
const natsSubject = required('NATS_SUBJECT');
// Every replica subscribes with the same queue group name: NATS gives each message to only ONE
// member of the group, so with 6 replicas a message is still sent to the chat service once.
const natsQueue = required('NATS_QUEUE');
const messageFormat = required('MESSAGE_FORMAT');
const requestTimeoutMs = requiredInt('REQUEST_TIMEOUT_MS');
// Where the messages are sent. In Discord or Slack the URL contains a token, so it comes from a
// Secret and it is never printed.
const webhookUrl = required('WEBHOOK_URL');

const jsonCodec = JSONCodec();
let subscribed = false;
let connected = false; // true only while the connection to NATS is up
let connection = null;

// What each chat service expects. "generic" is the format of the exercise.
const FORMATS = {
  generic: (text) => ({ user: 'bot', message: text }),
  // allowed_mentions stops a todo that contains @everyone from pinging the whole channel
  discord: (text) => ({ username: 'bot', content: text, allowed_mentions: { parse: [] } }),
  slack: (text) => ({ text }),
};
if (!FORMATS[messageFormat]) {
  console.error(`MESSAGE_FORMAT must be one of: ${Object.keys(FORMATS).join(', ')}`);
  process.exit(1);
}

const describe = ({ event, todo }) => {
  if (event === 'created') {
    return `A todo was created: "${todo.todo}"`;
  }
  if (event === 'updated') {
    return `A todo was marked as ${todo.done ? 'done' : 'not done'}: "${todo.todo}"`;
  }
  return null;
};

const send = async (text) => {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(FORMATS[messageFormat](text)),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`the chat service answered ${response.status}`);
  }
};

const handle = async (message) => {
  let event;
  try {
    event = jsonCodec.decode(message.data);
  } catch (err) {
    console.error(`Ignoring a message that is not JSON: ${err.message}`);
    return;
  }
  const text = describe(event);
  if (!text) {
    console.error(`Ignoring an unknown event: ${JSON.stringify(event.event)}`);
    return;
  }
  // No retry: a retry could deliver the message twice, and a lost message is acceptable.
  try {
    await send(text);
    console.log(`Sent: ${text}`);
  } catch (err) {
    console.error(`Could not send "${text}": ${err.message}`);
  }
};

const start = async () => {
  connection = await connect({
    servers: natsUrl,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2000,
    waitOnFirstConnect: true,
  });
  connected = true;
  console.log(`Connected to NATS at ${natsUrl}`);

  const subscription = connection.subscribe(natsSubject, { queue: natsQueue });
  subscribed = true;
  console.log(`Subscribed to "${natsSubject}" in the queue group "${natsQueue}"`);

  // when NATS goes away the subscription is restored by the client on reconnection
  (async () => {
    for await (const status of connection.status()) {
      if (status.type === 'disconnect') {
        connected = false;
        console.log('Disconnected from NATS');
      } else if (status.type === 'reconnect') {
        connected = true;
        console.log('Reconnected to NATS');
      }
    }
  })();

  for await (const message of subscription) {
    await handle(message);
  }
};

// Probes: ready only when it is connected to NATS and subscribed
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/livez') {
    res.writeHead(200).end('ok\n');
    return;
  }
  if (req.method === 'GET' && req.url === '/healthz') {
    const ready = subscribed && connected && connection && !connection.isClosed();
    res.writeHead(ready ? 200 : 503).end(ready ? 'ok\n' : 'not connected to NATS\n');
    return;
  }
  res.writeHead(404).end('Not found\n');
});

server.listen(port, () => {
  console.log(`Server started in port ${port}`);
});

// On shutdown (a rollout or a scale down) finish the messages that were already received and then
// exit, so that they are not lost.
const shutdown = async () => {
  console.log('Shutting down: finishing the messages in progress');
  subscribed = false;
  try {
    if (connection) {
      await connection.drain();
    }
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch((err) => {
  console.error(`The broadcaster stopped: ${err.message}`);
  process.exit(1);
});
