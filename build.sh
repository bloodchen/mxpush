source .env
NAME="mxpush"
PORT="${dockerPort:=8100}"
docker container stop $NAME
docker container rm $NAME
docker build -t $NAME .
##mkdir data && chmod a+rw data
docker run --name $NAME --ulimit nofile=90000:90000 -p $PORT:8080 --restart=always -d $NAME
