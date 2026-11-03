ARG SERVICE=web
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci
COPY apps ./apps
RUN npm run build

FROM build AS api
ENV NODE_ENV=production PORT=4000 API_BIND_ADDRESS=0.0.0.0
USER node
CMD ["npm", "start", "-w", "apps/api"]

FROM build AS web
ENV NODE_ENV=production
WORKDIR /app/apps/web
RUN chown -R node:node /app/apps/web/.next
USER node
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]

FROM build AS migrate
ENV NODE_ENV=production
USER node
CMD ["node", "/app/apps/api/dist/migrate.js"]

FROM ${SERVICE} AS runtime
