FROM node:18-alpine
WORKDIR /app

COPY backend/package*.json ./
RUN npm install

COPY backend/. .

EXPOSE 3000

# 先執行 schema.js，再啟動 server.js
CMD ["sh", "-c", "node schema.js && node server.js"]