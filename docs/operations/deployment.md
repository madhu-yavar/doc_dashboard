# Deployment Guide

## Doctor Dashboard - Clinical Intelligence System

**Version:** 2.0.0
**Environment:** Production
**Last Updated:** 2026-04-15

---

## Overview

This guide covers deploying the Doctor Dashboard system to production environments, including infrastructure setup, configuration, and monitoring.

> Note
> The current repository ships a file-backed Express server in `server/index.cjs`. The environment block below documents the variables actually read by that server today; storage path remapping, TLS, auth, and log shipping are deployment concerns around the app rather than toggles built into the current root server.

---

## Architecture Options

### Option 1: Single Server Deployment

Suitable for small-scale deployments (<50 concurrent users).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SINGLE SERVER DEPLOYMENT                           │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                      Frontend (Nginx)                               │    │
│  │                      Static Files + Reverse Proxy                   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                   Backend (Node.js + PM2)                           │    │
│  │                        API Server                                   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                      Storage Layer                                 │    │
│  │                   File System Storage                              │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ (network)
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Gemma LLM Service (Separate)                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Option 2: Multi-Server Deployment

Recommended for production (>50 concurrent users).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LOAD BALANCER                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Frontend Servers (Nginx) - 2+ instances                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                  Backend Servers (Node.js + PM2) - 3+ instances             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Shared Storage (NFS/S3)                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Gemma LLM Service Cluster                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Infrastructure Requirements

### Minimum Requirements (Single Server)

| Resource | Specification |
|----------|---------------|
| CPU | 4 cores |
| Memory | 16 GB RAM |
| Storage | 100 GB SSD |
| Network | 100 Mbps |
| OS | Ubuntu 22.04 LTS |

### Recommended Requirements (Multi-Server)

| Resource | Backend Servers | Frontend Servers |
|----------|-----------------|------------------|
| CPU | 8 cores | 4 cores |
| Memory | 32 GB RAM | 8 GB RAM |
| Storage | 200 GB SSD | 50 GB SSD |
| Network | 1 Gbps | 1 Gbps |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

---

## Prerequisites Installation

### 1. Node.js Setup

```bash
# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### 2. Nginx Setup

```bash
# Install Nginx
sudo apt-get update
sudo apt-get install -y nginx

# Enable and start Nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 3. PM2 Setup

```bash
# Install PM2 globally
sudo npm install -g pm2

# Enable PM2 startup script
pm2 startup systemd
```

---

## Application Setup

### 1. Deploy Application Code

```bash
# Clone repository
git clone <repository-url> /var/www/doctor-dashboard
cd /var/www/doctor-dashboard

# Install dependencies
npm ci --production
```

### 2. Configure Environment

Create `/var/www/doctor-dashboard/.env`:

```env
# Environment
NODE_ENV=production
PORT=8001

# Gemma LLM
GEMMA_URL=http://your-gemma-service:8000
GEMMA_MODEL=google/gemma-4-26B-A4B-it

# Optional Gemini external-knowledge mode
USE_GEMINI_FOR_EXTERNAL=true
GEMINI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=your-gemini-api-key

# Optional extractor tuning
EXTRACTION_PER_DOCUMENT_CONCURRENCY=3
ENABLE_PENDING_ITEMS_EXTRACTION=true
ENABLE_DOCUMENT_ANALYZER=false
```

### 3. Create Storage Directory

```bash
sudo mkdir -p /var/www/doctor-dashboard/server/storage/uploads
sudo chown -R www-data:www-data /var/www/doctor-dashboard/server/storage
```

---

## Process Management with PM2

### Create Ecosystem File

Create `/var/www/doctor-dashboard/ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [{
    name: 'doctor-dashboard-api',
    script: './server/index.cjs',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 8001
    },
    error_file: '/var/log/doctor-dashboard/error.log',
    out_file: '/var/log/doctor-dashboard/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '1G'
  }]
};
```

### Start Application

```bash
cd /var/www/doctor-dashboard

# Start with PM2
pm2 start ecosystem.config.cjs

# Save PM2 configuration
pm2 save

# Monitor status
pm2 status
pm2 logs doctor-dashboard-api
```

---

## Nginx Configuration

### Frontend Configuration

Create `/etc/nginx/sites-available/doctor-dashboard`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Configuration
    ssl_certificate /etc/ssl/certs/your-domain.crt;
    ssl_certificate_key /etc/ssl/private/your-domain.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Frontend static files
    location / {
        root /var/www/doctor-dashboard/dist;
        try_files $uri $uri/ /index.html;

        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # API proxy
    location /api/ {
        proxy_pass http://localhost:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts for long-running requests
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # SSE for progress updates
    location /api/documents/process/progress {
        proxy_pass http://localhost:8001;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
    }
}
```

### Enable Site

```bash
sudo ln -s /etc/nginx/sites-available/doctor-dashboard /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Security Hardening

### 1. Firewall Configuration

```bash
# Install UFW
sudo apt-get install -y ufw

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable
```

### 2. SSL Certificate

```bash
# Install Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal (already configured)
sudo certbot renew --dry-run
```

### 3. File Permissions

```bash
# Restrict access to sensitive files
sudo chmod 600 /var/www/doctor-dashboard/.env
sudo chmod 640 /var/www/doctor-dashboard/storage/*

# Set proper ownership
sudo chown -R www-data:www-data /var/www/doctor-dashboard
```

---

## Monitoring & Logging

### 1. Log Management

```bash
# Create log directory
sudo mkdir -p /var/log/doctor-dashboard
sudo chown -R www-data:www-data /var/log/doctor-dashboard

# Configure logrotate
sudo nano /etc/logrotate.d/doctor-dashboard
```

`/etc/logrotate.d/doctor-dashboard`:
```
/var/log/doctor-dashboard/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
}
```

### 2. PM2 Monitoring

```bash
# Install PM2 Plus (optional)
pm2 plus

# Or use basic monitoring
pm2 monit
```

### 3. Application Metrics

Configure metrics collection (Prometheus, Grafana, etc.) for:

- CPU usage
- Memory usage
- API response times
- Error rates
- LLM latency

---

## Backup Strategy

### 1. Backup Script

Create `/usr/local/bin/backup-doctor-dashboard.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/backup/doctor-dashboard"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR/$DATE"

# Backup storage
tar -czf "$BACKUP_DIR/$DATE/storage.tar.gz" /var/www/storage

# Backup database (if using one)
# mongodump --out "$BACKUP_DIR/$DATE/db"

# Keep last 7 days
find "$BACKUP_DIR" -type d -mtime +7 -exec rm -rf {} \;
```

### 2. Schedule Backups

```bash
# Make executable
chmod +x /usr/local/bin/backup-doctor-dashboard.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add: 0 2 * * * /usr/local/bin/backup-doctor-dashboard.sh
```

---

## Update Procedure

### 1. Zero-Downtime Deployment

```bash
# Pull latest code
cd /var/www/doctor-dashboard
git pull origin main

# Install dependencies
npm ci --production

# Build frontend
npm run build

# Reload PM2 (zero downtime)
pm2 reload doctor-dashboard-api

# Clear cache (if needed)
sudo systemctl reload nginx
```

### 2. Rollback Procedure

```bash
# Revert to previous version
cd /var/www/doctor-dashboard
git checkout <previous-commit>

# Rebuild and reload
npm ci --production
npm run build
pm2 reload doctor-dashboard-api
```

---

## Health Checks

### Configure Health Check Monitoring

Create `/usr/local/bin/health-check.sh`:

```bash
#!/bin/bash
HEALTH_URL="http://localhost:8001/api/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $RESPONSE -ne 200 ]; then
    echo "Health check failed: HTTP $RESPONSE"
    # Send alert or restart service
    pm2 restart doctor-dashboard-api
fi
```

Add to crontab for every 5 minutes:
```
*/5 * * * * /usr/local/bin/health-check.sh
```

---

## Troubleshooting

### Common Issues

**Issue:** High memory usage
- **Solution:** Reduce PM2 instances or increase server memory

**Issue:** Slow API responses
- **Solution:** Check Gemma LLM service, optimize prompts

**Issue:** File upload failures
- **Solution:** Check nginx client_max_body_size, disk space

**Issue:** PM2 processes crashing
- **Solution:** Check logs, increase max_memory_restart

---

**Document Version:** 1.0
**Last Updated:** 2026-04-15
