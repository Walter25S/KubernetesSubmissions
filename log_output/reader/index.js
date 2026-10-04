const fs = require('fs');
const http = require('http');

const port = process.env.PORT || 3000;
const logFile = process.env.FILE_PATH || '/usr/src/app/files/log.txt';
const pingPongUrl = process.env.PINGPONG_URL || 'http://ping-pong-svc:2346/pings';

const lastLine = () => {
  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
  return lines[lines.length - 1];
};

const pingPongs = async () => {
  try {
    const response = await fetch(pingPongUrl, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    return (await response.text()).trim();
  } catch (err) {
    console.error(`Could not get the pongs: ${err.message}`);
    return 'unavailable';
  }
};

const sendText = (res, status, text) => {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    let line;
    try {
      line = lastLine();
    } catch (err) {
      sendText(res, 503, 'Log file not available yet\n');
      return;
    }
    sendText(res, 200, `${line}.\nPing / Pongs: ${await pingPongs()}\n`);
    return;
  }
  sendText(res, 404, 'Not found\n');
});

server.listen(port, () => {
  console.log(`Server started in port ${port}`);
});
