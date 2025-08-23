# 构建阶段：bookworm = glibc 2.36（满足 ≥2.33）
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# uWS 安装脚本需要出网/证书；如依赖里有 github 源，还需要 git
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# 允许 postinstall（uWS 会在这一步下载 .node）
ENV npm_config_ignore_scripts=false \
    npm_config_unsafe_perm=true

COPY package*.json ./
# 有 lock 就 ci，没有就 i
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm i --omit=dev; fi

# 运行阶段：同样用 bookworm，保证 glibc 匹配
FROM node:20-bookworm-slim AS runner
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