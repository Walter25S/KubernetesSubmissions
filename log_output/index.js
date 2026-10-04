const http = require('http');
const { randomUUID } = require('crypto');

const port = process.env.PORT || 3000;
const randomString = randomUUID();

const status = () => `${new Date().toISOString()}: ${randomString}`;

setInterval(() => console.log(status()), 5000);
console.log(status());

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`${status()}\n`);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});

server.listen(port, () => {
  console.log(`Server started in port ${port}`);
});
