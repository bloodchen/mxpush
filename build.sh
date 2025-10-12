source .env
NAME="mxpush"
PORT="${dockerPort:=8100}"
docker rm -f $NAME >/dev/null 2>&1 || true
docker build -t $NAME .
##mkdir data && chmod a+rw data
docker run --name $NAME --ulimit nofile=1048576:1048576 \
    --log-driver json-file --log-opt max-size=200m --log-opt max-file=3 \
    -p $PORT:8080 --restart=always -d $NAME
