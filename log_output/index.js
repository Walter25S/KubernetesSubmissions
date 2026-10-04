const { randomUUID } = require('crypto');

const randomString = randomUUID();

const logOutput = () => {
  console.log(`${new Date().toISOString()}: ${randomString}`);
};

logOutput();
setInterval(logOutput, 5000);
