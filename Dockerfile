# 1) 用 Debian bullseye-slim，更少兼容坑
FROM node:20-bullseye-slim AS deps
WORKDIR /app

# 安装 CA 证书，确保 HTTPS 正常；并开启必要的 npm 脚本执行权限
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 确保 postinstall 会运行（uWS 要用）
ENV npm_config_ignore_scripts=false \
    npm_config_loglevel=info \
    NPM_CONFIG_INCLUDE=dev \
    # 以 root 安装时开启脚本权限，避免 uWS 下载失败
    npm_config_unsafe_perm=true

# 只拷贝包描述，利用缓存
COPY package*.json ./

# 更可控：用 npm ci（若没有 lock 就用 npm i）
# 如果你有 package-lock.json，优先：
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm i --omit=dev; fi

# 2) 生产镜像
FROM node:20-bullseye-slim AS runner
WORKDIR /app

# 同样安装 CA，防止运行时也需要出网（比如拉配置）
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# 以 node 用户运行更安全
USER node

# 复制依赖与源码
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

EXPOSE 8080
CMD ["node", "index.js"]