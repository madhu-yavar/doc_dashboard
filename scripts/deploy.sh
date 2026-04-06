#!/bin/bash
# Deployment script for Doctor Dashboard to GPU server

set -e

# Configuration - UPDATE THESE VALUES
GPU_SERVER_USER="root"
GPU_SERVER_HOST="206.1.62.28"
GPU_SERVER_PATH="/opt/doctor-dashboard"
CONTAINER_NAME="doctor-dashboard"
IMAGE_NAME="doctor-dashboard"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Doctor Dashboard Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Step 1: Build the Docker image locally
echo -e "${YELLOW}Step 1: Building Docker image locally...${NC}"
docker build -t $IMAGE_NAME:latest .
echo -e "${GREEN}✓ Build completed${NC}"
echo ""

# Step 2: Save the Docker image
echo -e "${YELLOW}Step 2: Saving Docker image to tar file...${NC}"
docker save $IMAGE_NAME:latest -o /tmp/doctor-dashboard.tar
echo -e "${GREEN}✓ Image saved${NC}"
echo ""

# Step 3: Copy to GPU server
echo -e "${YELLOW}Step 3: Copying image to GPU server ($GPU_SERVER_HOST)...${NC}"
scp /tmp/doctor-dashboard.tar $GPU_SERVER_USER@$GPU_SERVER_HOST:/tmp/
echo -e "${GREEN}✓ Image copied${NC}"
echo ""

# Step 4: Load and run on GPU server
echo -e "${YELLOW}Step 4: Deploying on GPU server...${NC}"
ssh $GPU_SERVER_USER@$GPU_SERVER_HOST << 'ENDSSH'
set -e

echo "Loading Docker image..."
docker load -i /tmp/doctor-dashboard.tar

echo "Stopping existing container (if running)..."
docker stop $CONTAINER_NAME 2>/dev/null || true
docker rm $CONTAINER_NAME 2>/dev/null || true

echo "Creating storage directory..."
mkdir -p /opt/doctor-dashboard/server/storage/uploads

echo "Starting new container..."
docker run -d \
  --name $CONTAINER_NAME \
  --restart unless-stopped \
  -p 8001:8001 \
  -e NODE_ENV=production \
  -e PORT=8001 \
  -e GEMMA_URL=http://localhost:8000/v1/chat/completions \
  -e GEMMA_MODEL=google/gemma-4-26B-A4B-it \
  -v /opt/doctor-dashboard/server/storage:/app/server/storage \
  $IMAGE_NAME:latest

echo "Cleaning up temporary files..."
rm /tmp/doctor-dashboard.tar

echo "Waiting for container to be healthy..."
sleep 5

if docker ps | grep -q $CONTAINER_NAME; then
    echo ""
    echo "=========================================="
    echo "✓ Deployment successful!"
    echo "=========================================="
    echo "Container: $CONTAINER_NAME"
    echo "Access URL: http://$(hostname -I | awk '{print $1}'):8001"
    echo "=========================================="
else
    echo "❌ Container failed to start. Check logs with:"
    echo "docker logs $CONTAINER_NAME"
    exit 1
fi
ENDSSH

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Your dashboard should now be accessible at:"
echo "  http://$GPU_SERVER_HOST:8001"
echo ""
echo "To view logs:"
echo "  ssh $GPU_SERVER_USER@$GPU_SERVER_HOST 'docker logs -f $CONTAINER_NAME'"
echo ""
