#!/bin/bash
# Manual deployment - copies image to current directory for manual transfer

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Step 1: Building Docker image...${NC}"
docker build -t doctor-dashboard:latest .

echo -e "${YELLOW}Step 2: Saving Docker image to tar file...${NC}"
docker save doctor-dashboard:latest -o ./doctor-dashboard.tar

echo -e "${GREEN}✓ Image saved to ./doctor-dashboard.tar${NC}"
echo ""
echo "File size:"
ls -lh ./doctor-dashboard.tar
echo ""
echo "Next steps:"
echo "1. Copy doctor-dashboard.tar to your GPU server (via SCP, SFTP, or any method)"
echo "2. On the GPU server, run:"
echo ""
echo "   # Load the image"
echo "   docker load -i doctor-dashboard.tar"
echo ""
echo "   # Stop existing container (if any)"
echo "   docker stop doctor-dashboard 2>/dev/null || true"
echo "   docker rm doctor-dashboard 2>/dev/null || true"
echo ""
echo "   # Create storage directory"
echo "   mkdir -p /opt/doctor-dashboard/server/storage/uploads"
echo ""
echo "   # Run the container"
echo "   docker run -d \\"
echo "     --name doctor-dashboard \\"
echo "     --restart unless-stopped \\"
echo "     -p 8001:8001 \\"
echo "     -e NODE_ENV=production \\"
echo "     -e PORT=8001 \\"
echo "     -e GEMMA_URL=http://localhost:8000/v1/chat/completions \\"
echo "     -e GEMMA_MODEL=google/gemma-4-26B-A4B-it \\"
echo "     -v /opt/doctor-dashboard/server/storage:/app/server/storage \\"
echo "     doctor-dashboard:latest"
echo ""
echo "   # Check logs"
echo "   docker logs -f doctor-dashboard"
echo ""
