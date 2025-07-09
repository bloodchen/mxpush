#!/bin/bash

# Build and run script for mxpush Golang version with Docker

set -e

# Load environment variables if .env exists
if [ -f .env ]; then
    source .env
fi

# Configuration
NAME="mxpush-go"
PORT="${dockerPort:-8101}"
INTERNAL_PORT="8080"

echo "Building and starting mxpush Golang version..."

# Stop and remove existing container
echo "Stopping existing container..."
docker container stop $NAME 2>/dev/null || true
docker container rm $NAME 2>/dev/null || true

# Build Docker image
echo "Building Docker image..."
docker build -t $NAME .

# Run Docker container
echo "Starting Docker container..."
docker run --name $NAME \
    --log-driver json-file --log-opt max-size=200m --log-opt max-file=3 \
    --ulimit nofile=90000:90000 \
    -p $PORT:$INTERNAL_PORT \
    --restart=always \
    -d $NAME

echo "Container started successfully!"
echo "Service available at: http://localhost:$PORT"
echo "WebSocket endpoint: ws://localhost:$PORT/ws"
echo "Container name: $NAME"

# Show container status
docker ps | grep $NAME