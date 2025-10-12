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
# 安装 PM2（全局）
RUN npm i -g pm2@latest

USER node
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

# 可选：健康检查路由你已有 `/`，直接用
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 8080

# 用 pm2-runtime 托管（对容器友好，一进程一前台）
#CMD ["pm2-runtime", "start", "ecosystem.config.cjs"]
CMD ["node", "index.js"]