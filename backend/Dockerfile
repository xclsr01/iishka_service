FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY ai-gateway/package.json ai-gateway/package.json
RUN npm ci --workspace backend

COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/prisma.config.ts backend/prisma.config.ts
COPY backend/prisma backend/prisma
ENV DATABASE_URL=postgresql://user:password@localhost:5432/iishka_service
ENV DIRECT_URL=postgresql://user:password@localhost:5432/iishka_service
RUN npm run db:generate --workspace backend

COPY backend/src backend/src
RUN npm run build --workspace backend

FROM node:22-slim AS runtime

ENV NODE_ENV=production
ENV APP_ENV=production
ENV PORT=8080

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY ai-gateway/package.json ai-gateway/package.json
RUN npm ci --workspace backend --omit=dev && npm cache clean --force

COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/prisma backend/prisma

WORKDIR /app/backend
EXPOSE 8080

CMD ["node", "dist/index.js"]
