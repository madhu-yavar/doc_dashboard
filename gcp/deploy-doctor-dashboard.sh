#!/bin/bash
# Doctor Dashboard Deployment Script for GCP
# Fixes prescription generation and WebSocket issues

set -e

echo "🚀 Starting Doctor Dashboard Deployment to GCP..."

# Configuration
GCP_USER="yavar-poc"
GCP_HOST="35.244.7.120"
SSH_KEY="./yavar-poc"
PROJECT_DIR="/Users/yavar/Documents/CoE/Manipal"
CONTAINER_NAME="doctor-dashboard"
IMAGE_NAME="doctor-dashboard:fixed"

echo "📦 Step 1: Copy updated files to GCP..."
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
    "$PROJECT_DIR/Dockerfile" \
    "$PROJECT_DIR/package.json" \
    "$GCP_USER@$GCP_HOST:/tmp/"

echo "📦 Step 2: Copy project files to GCP (this may take a few minutes)..."
# Copy essential directories first
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -r \
    "$PROJECT_DIR/server" \
    "$PROJECT_DIR/agents" \
    "$PROJECT_DIR/skills" \
    "$PROJECT_DIR/tools" \
    "$PROJECT_DIR/config" \
    "$PROJECT_DIR/scripts" \
    "$PROJECT_DIR/prescription_template_dev" \
    "$GCP_USER@$GCP_HOST:/tmp/doctor-dashboard-build/"

echo "📦 Step 3: Copy frontend build files..."
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -r \
    "$PROJECT_DIR/dist" \
    "$PROJECT_DIR/public" \
    "$PROJECT_DIR/index.html" \
    "$GCP_USER@$GCP_HOST:/tmp/doctor-dashboard-build/"

echo "🔧 Step 4: Build Docker image on GCP..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$GCP_USER@$GCP_HOST" << 'ENDSSH'
cd /tmp/doctor-dashboard-build

# Replace Dockerfile and package.json
cp /tmp/Dockerfile .
cp /tmp/package.json .

echo "Building Docker image with Playwright and template fixes..."
docker build -t doctor-dashboard:fixed .

echo "✅ Docker image built successfully!"
ENDSSH

echo "🛑 Step 5: Stop current container..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$GCP_USER@$GCP_HOST" << 'ENDSSH'
docker stop doctor-dashboard || true
docker rm doctor-dashboard || true
ENDSSH

echo "🚀 Step 6: Start new container with fixes..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$GCP_USER@$GCP_HOST" << 'ENDSSH'
# Get the current container's environment variables (if any)
OLD_ENV=$(docker inspect doctor-dashboard:latest --format='{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || echo "")

# Start new container with proper environment
docker run -d \
  --name doctor-dashboard \
  -p 8004:8001 \
  --restart unless-stopped \
  -v /home/yavar-poc/doctor-data:/app/server/storage \
  -e NODE_ENV=production \
  -e PORT=8001 \
  -e GEMMA_URL=http://206.1.62.28:8000/v1/chat/completions \
  -e GEMMA_MODEL=google/gemma-4-26B-A4B-it \
  -e ENABLE_HYBRID_STT=true \
  -e STT_BACKEND=medasr \
  -e HYBRID_RECONCILER_TIMEOUT=240000 \
  -e MEDASR_ENDPOINT=http://206.1.62.28:8008/transcribe \
  -e MEDASR_TIMEOUT=30000 \
  -e WHISPER_STT_URL=http://202.88.209.11/whisper/transcribe \
  -e WHISPER_LANGUAGE=auto \
  -e LIVE_CONVERSATION_DEBUG=true \
  doctor-dashboard:fixed

echo "✅ New container started!"
ENDSSH

echo "🔍 Step 7: Verify deployment..."
sleep 5
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$GCP_USER@$GCP_HOST" << 'ENDSSH'
echo "=== Container Status ==="
docker ps | grep doctor-dashboard

echo ""
echo "=== Recent Logs ==="
docker logs doctor-dashboard --tail 20

echo ""
echo "=== Check Template Files ==="
docker exec doctor-dashboard ls -la /app/prescription_template_dev/

echo ""
echo "=== Check Playwright ==="
docker exec doctor-dashboard npm list playwright

echo ""
echo "=== Test Playwright ==="
docker exec doctor-dashboard node -e "
const { chromium } = require('playwright');
chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  .then(browser => browser.close())
  .then(() => console.log('✅ Playwright works!'))
  .catch(err => console.error('❌ Playwright failed:', err.message));
"
ENDSSH

echo ""
echo "🎉 Deployment complete!"
echo "📝 Next steps:"
echo "1. Test prescription generation at https://doctor-dashboard.zagent.dev.yavar.ai"
echo "2. Test live audio functionality"
echo "3. Check logs if issues occur: docker logs doctor-dashboard -f"