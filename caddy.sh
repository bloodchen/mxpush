
echo "📡 创建 Docker 网络（如果不存在）..."
docker network inspect mxnet >/dev/null 2>&1 || \
docker network create mxnet

docker rm -f caddy >/dev/null 2>&1 || true

docker run --name caddy -d -p 80:80 -p 443:443 \
    -v $PWD/www:/usr/share/caddy \
    -v $PWD/Caddyfile:/etc/caddy/Caddyfile --network mxnet \
    -v caddy_data:/data \
    --restart=always caddy