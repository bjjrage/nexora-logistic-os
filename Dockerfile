FROM node:24.20.0-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
COPY infra/routing/requirements.txt /tmp/routing-requirements.txt
RUN python3 -m venv /opt/routing && /opt/routing/bin/pip install --no-cache-dir -r /tmp/routing-requirements.txt
ENV ROUTING_PYTHON=/opt/routing/bin/python
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY frontend ./frontend
COPY server ./server
COPY api ./api
COPY scripts ./scripts
COPY tests ./tests
COPY deploy/vercel/vercel.json ./deploy/vercel/vercel.json
COPY supabase ./supabase
COPY MANUAL_MAESTRO_NEXORA_OS.html ./
COPY manual ./manual
RUN npm run check:migrations && npm test && npm run build && npm prune --omit=dev

FROM node:24.20.0-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/routing /opt/routing
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 ROUTING_PYTHON=/opt/routing/bin/python
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node MANUAL_MAESTRO_NEXORA_OS.html ./
COPY --from=build --chown=node:node /app/MANUAL_WORKFLOWS_NEXORA_PORTATIL.html ./
COPY --chown=node:node manual ./manual
USER node
EXPOSE 8080
CMD ["node", "server/index.ts"]
