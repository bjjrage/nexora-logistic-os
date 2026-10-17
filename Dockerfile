FROM node:24.20.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY frontend ./frontend
COPY server ./server
COPY api ./api
COPY scripts ./scripts
COPY tests ./tests
COPY supabase ./supabase
RUN npm run check:migrations && npm test && npm run build && npm prune --omit=dev

FROM node:24.20.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node MANUAL_MAESTRO_NEXORA_OS.html ./
COPY --chown=node:node manual ./manual
USER node
EXPOSE 8080
CMD ["node", "server/index.ts"]
