source .env
echo "📡 创建 Docker 网络（如果不存在）..."
docker network inspect mxnet >/dev/null 2>&1 || \
docker network create mxnet

NAME="mxpush"

docker rm -f $NAME >/dev/null 2>&1 || true
docker build -t $NAME .
##mkdir data && chmod a+rw data
docker run --name $NAME --ulimit nofile=1048576:1048576 --network mxnet \
    --log-driver json-file --log-opt max-size=200m --log-opt max-file=3 \
    --restart=always -d $NAME
