# Use Node.js 18 LTS
FROM node:18-slim

LABEL org.opencontainers.image.title="Bear Notes MCP Server" \
      org.opencontainers.image.description="MCP server for Bear Notes with semantic search and RAG" \
      org.opencontainers.image.source="https://github.com/pda/bear-mcp-server"

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

CMD ["node", "src/index.js"]
