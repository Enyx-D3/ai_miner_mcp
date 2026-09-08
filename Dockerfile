FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY runtime ./runtime
RUN mkdir -p /data
ENV BRAIN2_MISSION_DATA_DIR=/data MCP_BIND=0.0.0.0 MCP_PORT=8787
EXPOSE 8787
CMD ["node","src/server.mjs"]
