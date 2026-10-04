FROM node:20-alpine

WORKDIR /usr/src/app

COPY package.json ./
COPY index.js ./

USER node

EXPOSE 3000

CMD ["node", "index.js"]
