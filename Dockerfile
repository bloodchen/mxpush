# 用 bookworm-slim，兼容性好一些
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# 关键：装 ca-certificates + git
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# 确保 postinstall 脚本可运行（uWS 会下载二进制）
ENV npm_config_ignore_scripts=false \
    npm_config_unsafe_perm=true

COPY package*.json ./
# 有 lock 用 ci，没有就 i
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm i --omit=dev; fi

FROM node:20-bullseye-slim AS runner
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
USER node

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

EXPOSE 8080
CMD ["node","index.js"]