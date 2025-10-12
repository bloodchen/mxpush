docker rm -f caddy >/dev/null 2>&1 || true

docker run --name caddy -d -p 80:80 -p 443:443 \
    -v $PWD/www:/usr/share/caddy \
    -v $PWD/Caddyfile:/etc/caddy/Caddyfile \
    -v caddy_data:/data \
    --network mxnet \
    --restart=always caddy