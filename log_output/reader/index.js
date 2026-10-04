const fs = require('fs');
const http = require('http');

const port = process.env.PORT || 3000;
const logFile = process.env.FILE_PATH || '/usr/src/app/files/log.txt';
const pingPongUrl = process.env.PINGPONG_URL || 'http://ping-pong-svc:2346/pings';
const infoFile = process.env.INFO_FILE || '/usr/src/app/config/information.txt';
const message = process.env.MESSAGE || '';

const lastLine = () => {
  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
  return lines[lines.length - 1];
};

const fileContent = () => {
  try {
    return fs.readFileSync(infoFile, 'utf8').trim();
  } catch (err) {
    return '';
  }
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
  // Readiness probe (exercise 4.1): ready when the data of ping-pong can be received.
  if (req.method === 'GET' && req.url === '/healthz') {
    try {
      const response = await fetch(pingPongUrl, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      sendText(res, 200, 'ok\n');
    } catch (err) {
      sendText(res, 503, `ping-pong not available: ${err.message}\n`);
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    let line;
    try {
      line = lastLine();
    } catch (err) {
      sendText(res, 503, 'Log file not available yet\n');
      return;
    }
    sendText(
      res,
      200,
      `file content: ${fileContent()}\n` +
        `env variable: MESSAGE=${message}\n` +
        `${line}.\n` +
        `Ping / Pongs: ${await pingPongs()}\n`,
    );
    return;
  }
  sendText(res, 404, 'Not found\n');
});

server.listen(port, () => {
  console.log(`Server started in port ${port}`);
});
