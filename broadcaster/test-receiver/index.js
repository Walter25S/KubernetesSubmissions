// A tiny "chat service" to test the broadcaster without an account in Discord or Slack: it
// accepts the messages (POST /), keeps them and lets you read them. Only for testing.
const http = require('http');

const port = parseInt(process.env.PORT || '8080', 10);
const messages = [];

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        messages.push({ receivedAt: new Date().toISOString(), body: JSON.parse(body || 'null') });
        console.log(`Received: ${body}`);
        res.writeHead(204).end();
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/messages') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(messages));
      return;
    }
    if (req.method === 'GET' && req.url === '/count') {
      res.writeHead(200).end(String(messages.length));
      return;
    }
    res.writeHead(404).end();
  })
  .listen(port, () => console.log(`Test receiver in port ${port}`));
