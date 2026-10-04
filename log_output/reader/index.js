const fs = require('fs');
const http = require('http');

const port = process.env.PORT || 3000;
const logFile = process.env.FILE_PATH || '/usr/src/app/files/log.txt';
const pingPongFile = process.env.PINGPONG_FILE || '/usr/src/app/shared/pingpong.txt';

const lastLine = () => {
  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
  return lines[lines.length - 1];
};

const pingPongs = () => {
  try {
    return fs.readFileSync(pingPongFile, 'utf8').trim() || '0';
  } catch (err) {
    return '0';
  }
};

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    let line;
    try {
      line = lastLine();
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Log file not available yet\n');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`${line}.\nPing / Pongs: ${pingPongs()}\n`);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});

server.listen(port, () => {
  console.log(`Server started in port ${port}`);
});
