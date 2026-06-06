# Backend Dockerfile - AWS EC2 / Lambda
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY server.js ./
COPY send-whatsapp.js ./
COPY src ./src

EXPOSE 3000

CMD ["npm", "start"]
