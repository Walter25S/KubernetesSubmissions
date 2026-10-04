const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const filePath = process.env.FILE_PATH || '/usr/src/app/files/log.txt';
const randomString = randomUUID();

fs.mkdirSync(path.dirname(filePath), { recursive: true });

const writeLine = () => {
  const line = `${new Date().toISOString()}: ${randomString}\n`;
  fs.appendFileSync(filePath, line);
  process.stdout.write(line);
};

writeLine();
setInterval(writeLine, 5000);
