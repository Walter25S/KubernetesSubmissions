const http = require('http');

const port = process.env.PORT || 3000;
let counter = 0;

const sendText = (res, status, text) => {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
};

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/pingpong') {
    sendText(res, 200, `pong ${counter}\n`);
    counter += 1;
    return;
  }
  if (req.method === 'GET' && req.url === '/pings') {
    sendText(res, 200, `${counter}\n`);
    return;
  }
  sendText(res, 404, 'Not found\n');
});

server.listen(port, () => {
  console.log(`Server started in port ${port}`);
});
