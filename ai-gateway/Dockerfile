FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY ai-gateway/package.json ai-gateway/package.json
RUN npm ci --workspace ai-gateway

COPY ai-gateway/tsconfig.json ai-gateway/tsconfig.json
COPY ai-gateway/src ai-gateway/src
RUN npm run build --workspace ai-gateway

FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY ai-gateway/package.json ai-gateway/package.json
RUN npm ci --workspace ai-gateway --omit=dev && npm cache clean --force

COPY --from=build /app/ai-gateway/dist ai-gateway/dist

WORKDIR /app/ai-gateway
CMD ["node", "dist/index.js"]
