# Quick GCP Deployment Commands

## When SSH is stable, run these commands:

### 1. Test SSH Connection
```bash
cd /Users/yavar/Documents/CoE/Manipal/gcp
ssh -i yavar-poc yavar-poc@35.244.7.120 "docker --version"
```

### 2. If SSH works, run automated deployment:
```bash
cd /Users/yavar/Documents/CoE/Manipal/gcp
./deploy-doctor-dashboard.sh
```

### 3. Or manual quick deployment:
```bash
# SSH into GCP
ssh -i yavar-poc yavar-poc@35.244.7.120

# On GCP instance, run these commands:
cd /tmp
mkdir -p doctor-build
cd doctor-build

# Copy files from your local machine first, then:
# Build and deploy
docker build -t doctor-dashboard:fixed /tmp/doctor-build
docker stop doctor-dashboard
docker rm doctor-dashboard  
docker run -d --name doctor-dashboard \
  -p 8004:8001 \
  --restart unless-stopped \
  -v /home/yavar-poc/doctor-data:/app/server/storage \
  doctor-dashboard:fixed
```

## Current Issues to Fix:
1. ❌ Prescription generation - missing CSS/JS files
2. ❌ Playwright - Chromium not installed  
3. ❌ WebSocket - immediate disconnections
4. ✅ Environment variables - properly configured

## Files to Deploy:
- Updated Dockerfile (with Playwright + templates)
- Updated package.json (with playwright dependency)
- prescription_template_dev/ directory (complete with all files)
- All server/, agents/, skills/ directories

## Deployment Script Created:
✅ gcp/deploy-doctor-dashboard.sh (automated)
✅ gcp/MANUAL_DEPLOY.md (manual instructions)
