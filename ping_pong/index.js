const fs = require('fs');
const http = require('http');
const path = require('path');

const port = process.env.PORT || 3000;
const counterFile = process.env.COUNTER_FILE || '/usr/src/app/files/pingpong.txt';

const loadCounter = () => {
  try {
    const value = parseInt(fs.readFileSync(counterFile, 'utf8'), 10);
    return Number.isNaN(value) ? 0 : value;
  } catch (err) {
    return 0;
  }
};

const saveCounter = (value) => {
  fs.mkdirSync(path.dirname(counterFile), { recursive: true });
  fs.writeFileSync(counterFile, String(value));
};

let counter = loadCounter();

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/pingpong') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`pong ${counter}\n`);
    counter += 1;
    saveCounter(counter);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});

server.listen(port, () => {
  console.log(`Server started in port ${port}`);
});
