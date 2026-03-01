# Use Node.js 18 LTS
FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN chmod +x src/index.js

CMD ["node", "src/index.js"]
