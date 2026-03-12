#!/bin/bash

set -euo pipefail

echo "Starting automatic deployment..."

if [ ! -f .env.local ]; then
    echo "Error: .env.local file not found."
    exit 1
fi

if [ "$(free -m | awk '/^Swap:/{print $2}')" -eq 0 ]; then
    echo "No swap detected. Creating 4GB swap file for build stability..."
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
    echo "Swap created and enabled."
else
    echo "Swap already exists."
fi

echo "Updating host system packages..."
apt-get update && apt-get upgrade -y

if command -v docker >/dev/null 2>&1; then
    echo "Updating Docker Engine..."
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || true
fi

if command -v npm >/dev/null 2>&1; then
    echo "Updating host npm..."
    npm install -g npm@latest
fi

echo "Pulling latest changes from git..."
git pull origin main

set -a
source .env.local
set +a

if docker image inspect people-hrms:latest >/dev/null 2>&1; then
    echo "Tagging current image as rollback candidate..."
    docker tag people-hrms:latest people-hrms:previous || true
fi

echo "Building new Docker image..."
docker build \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY="$NEXT_PUBLIC_FIREBASE_API_KEY" \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN" \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID="$NEXT_PUBLIC_FIREBASE_PROJECT_ID" \
  --build-arg NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET" \
  --build-arg NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID" \
  --build-arg NEXT_PUBLIC_FIREBASE_APP_ID="$NEXT_PUBLIC_FIREBASE_APP_ID" \
  --build-arg NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID="$NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID" \
  --build-arg NEXT_PUBLIC_SETUP_KEY="$NEXT_PUBLIC_SETUP_KEY" \
  --build-arg NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" \
  --build-arg NEXT_PUBLIC_APP_ENV="${NEXT_PUBLIC_APP_ENV:-${APP_ENV:-production}}" \
  -t people-hrms:latest .

echo "Stopping old container..."
docker stop people-hrms || true
docker rm people-hrms || true

TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
CONTAINER_MEM=$((TOTAL_MEM - 512))
if [ "$CONTAINER_MEM" -lt 512 ]; then CONTAINER_MEM=512; fi

echo "Starting new container..."
docker run -d \
  --name people-hrms \
  --restart unless-stopped \
  --memory="${CONTAINER_MEM}m" \
  --cpus="2.0" \
  -p 127.0.0.1:3000:3000 \
  --env-file .env.local \
  people-hrms:latest

echo "Cleaning up unused Docker artifacts..."
docker system prune -f
docker builder prune -f

echo "Deployment complete."
