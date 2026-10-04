const fs = require('fs');
const http = require('http');
const path = require('path');

const port = process.env.PORT || 3000;
const imageDir = process.env.IMAGE_DIR || '/usr/src/app/files/todo';
const imageFile = path.join(imageDir, 'image.jpg');
const imageUrl = process.env.IMAGE_URL || 'https://picsum.photos/1200';
const imageTtlMs = parseInt(process.env.IMAGE_TTL_MS, 10) || 10 * 60 * 1000;
const shutdownEnabled = process.env.ENABLE_SHUTDOWN === 'true';

fs.mkdirSync(imageDir, { recursive: true });

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

const page = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Todo app</title>
  </head>
  <body>
    <h1>Todo app</h1>
    <img src="/image" alt="Random picture" width="400" />
    <p>The picture changes every 10 minutes.</p>
  </body>
</html>
`;

const sendText = (res, status, text) => {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
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
