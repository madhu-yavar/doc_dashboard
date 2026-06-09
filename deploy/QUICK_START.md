# Quick Deployment Guide

## Prerequisites Check
- ✅ GCP VM created (e2-standard-4, asia-south1-c)
- ✅ External IP: 34.93.22.155
- ✅ Local machine with GCP SDK
- ✅ SSH access configured

## One-Command Deployment

```bash
# From your project directory
cd /Users/yavar/Documents/CoE/Manipal

# Run auto-deployment
bash deploy/auto-deploy.sh
```

## Manual Deployment Steps

### 1. Package and Upload
```bash
# Create deployment package
tar -czf /tmp/doctor-dashboard.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=dist \
  .

# Upload to VM
gcloud compute scp /tmp/doctor-dashboard.tar.gz \
  doctor-dashboard@doctor-dashboard-vm:/tmp/ \
  --zone=asia-south1-c
```

### 2. SSH and Setup
```bash
# Connect to VM
gcloud compute ssh doctor-dashboard@doctor-dashboard-vm --zone=asia-south1-c

# Extract and setup
cd /tmp
tar -xzf doctor-dashboard.tar.gz -C /home/doctor-dashboard/app/
cd /home/doctor-dashboard/app

# Start services
docker compose up -d
```

### 3. Configure SSL (Optional)
```bash
# On the VM
sudo certbot --nginx -d doctor-dashboard.yavartechworks.com
```

## Verification Commands

```bash
# Check service status
docker compose ps

# View logs
docker compose logs -f

# Health check
curl http://34.93.22.155:3000/health
```

## Common Issues

### Permission Denied
```bash
# Add user to docker group
sudo usermod -aG docker doctor-dashboard
newgrp docker
```

### Port Already in Use
```bash
# Check what's using the port
sudo netstat -tulpn | grep :3000

# Kill process if needed
sudo kill -9 <PID>
```

### Out of Memory
```bash
# Check memory usage
free -h

# Check Docker stats
docker stats
```

## Rolling Back

```bash
# Stop services
docker compose down

# Restore from backup
docker compose exec -T postgres psql -U doctor_dashboard doctor_dashboard < backup.sql

# Restart
docker compose up -d
```

## Support

For issues or questions:
- Check logs: `docker compose logs -f`
- VM console: GCP Console → Compute Engine → VM Instances
- Restart VM: `gcloud compute reset doctor-dashboard-vm --zone=asia-south1-c`
