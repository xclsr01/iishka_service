FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY openai-gateway/package.json openai-gateway/package.json
RUN npm ci --workspace openai-gateway

COPY openai-gateway/tsconfig.json openai-gateway/tsconfig.json
COPY openai-gateway/src openai-gateway/src
RUN npm run build --workspace openai-gateway

FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY openai-gateway/package.json openai-gateway/package.json
RUN npm ci --workspace openai-gateway --omit=dev && npm cache clean --force

COPY --from=build /app/openai-gateway/dist openai-gateway/dist

WORKDIR /app/openai-gateway
CMD ["node", "dist/index.js"]
