const fs = require('fs');
const http = require('http');

const port = process.env.PORT || 3000;
const filePath = process.env.FILE_PATH || '/usr/src/app/files/log.txt';

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    fs.readFile(filePath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Log file not available yet\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(content);
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});

server.listen(port, () => {
  console.log(`Server started in port ${port}`);
});
