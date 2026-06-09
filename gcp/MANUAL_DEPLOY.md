# Manual Deployment Guide for GCP

If the automated script fails, follow these steps manually:

## Quick Manual Deployment

### 1. SSH into GCP Instance
```bash
cd /Users/yavar/Documents/CoE/Manipal/gcp
ssh -i yavar-poc yavar-poc@35.244.7.120
```

### 2. Create Build Directory on GCP
```bash
mkdir -p /tmp/doctor-dashboard-build
cd /tmp/doctor-dashboard-build
```

### 3. Copy Files from Local to GCP
```bash
# From your local machine (separate terminal):
cd /Users/yavar/Documents/CoE/Manipal/gcp

# Copy Dockerfile and package.json
scp -i yavar-poc Dockerfile package.json yavar-poc@35.244.7.120:/tmp/doctor-dashboard-build/

# Copy project directories (this may take 5-10 minutes):
scp -i yavar-poc -r \
  ../server \
  ../agents \
  ../skills \
  ../tools \
  ../config \
  ../scripts \
  ../prescription_template_dev \
  yavar-poc@35.244.7.120:/tmp/doctor-dashboard-build/
```

### 4. Build Docker Image on GCP
```bash
# On GCP instance:
cd /tmp/doctor-dashboard-build

# Verify files are there
ls -la

# Build image (takes 5-10 minutes):
docker build -t doctor-dashboard:fixed .
```

### 5. Stop and Remove Old Container
```bash
docker stop doctor-dashboard
docker rm doctor-dashboard
```

### 6. Start New Container
```bash
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
  -e WHISPER_STT_URL=http://202.88.209.11/whisper/transcribe \
  -e LIVE_CONVERSATION_DEBUG=true \
  doctor-dashboard:fixed
```

### 7. Verify Deployment
```bash
# Check container status
docker ps | grep doctor-dashboard

# Check logs
docker logs doctor-dashboard --tail 20

# Verify template files
docker exec doctor-dashboard ls -la /app/prescription_template_dev/

# Verify Playwright
docker exec doctor-dashboard npm list playwright
```

## Troubleshooting

### If build fails:
```bash
# Check build logs
docker build -t doctor-dashboard:fixed . 2>&1 | tee build.log
# Look for errors in build.log
```

### If Playwright fails:
```bash
# Test Playwright manually
docker exec doctor-dashboard node -e "console.log(require('playwright'))"
```

### If WebSocket issues persist:
```bash
# Check STT service connectivity
curl -I http://206.1.62.28:8008/transcribe
curl -I http://202.88.209.11/whisper/transcribe
```

## Expected Results

✅ **Container Status**: Up and healthy  
✅ **Template Files**: 4 files in /app/prescription_template_dev/  
✅ **Playwright**: Version 1.60.0 installed  
✅ **Prescription Generation**: Working (no CSS errors)  
✅ **Live Audio**: WebSocket connections stable

## Rollback (If Needed)

```bash
docker stop doctor-dashboard
docker rm doctor-dashboard
docker run -d --name doctor-dashboard \
  -p 8004:8001 \
  --restart unless-stopped \
  doctor-dashboard:latest  # Previous version
```