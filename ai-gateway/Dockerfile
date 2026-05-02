FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY ai-gateway/package.json ai-gateway/package.json
COPY model-config/package.json model-config/package.json
COPY model-config/index.js model-config/index.js
COPY model-config/index.d.ts model-config/index.d.ts
RUN npm ci --workspace ai-gateway

COPY ai-gateway/tsconfig.json ai-gateway/tsconfig.json
COPY ai-gateway/src ai-gateway/src
RUN npm run build --workspace ai-gateway
RUN find ai-gateway/dist -type f -name '*.js' -exec sed -i -E \
  -e "s/from '(\.{1,2}\/[^']*)'/from '\1.js'/g" \
  -e 's/from "(\.{1,2}\/[^"]*)"/from "\1.js"/g' \
  -e "s/import\('(\.{1,2}\/[^']*)'\)/import('\1.js')/g" \
  -e 's/import\("(\.{1,2}\/[^"]*)"\)/import("\1.js")/g' \
  -e "s/import '(\.{1,2}\/[^']*)'/import '\1.js'/g" \
  -e 's/import "(\.{1,2}\/[^"]*)"/import "\1.js"/g' \
  {} +

FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY ai-gateway/package.json ai-gateway/package.json
COPY model-config/package.json model-config/package.json
COPY model-config/index.js model-config/index.js
COPY model-config/index.d.ts model-config/index.d.ts
RUN npm ci --workspace ai-gateway --omit=dev && npm cache clean --force

COPY --from=build /app/ai-gateway/dist ai-gateway/dist

WORKDIR /app/ai-gateway
CMD ["node", "dist/index.js"]
