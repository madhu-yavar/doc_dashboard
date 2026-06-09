# GCP Console SSH Deployment Guide

## Step-by-Step Instructions for GCP Console SSH

### 🚀 Quick Deploy (5 minutes)

1. **Open GCP Console SSH**
   - Go to: https://console.cloud.google.com/compute/instances
   - Select project: `yavar-client-poc`
   - Find your VM (should be in `asia-south1-c` zone)
   - Click the **SSH** button next to your VM

2. **Download Deployment Package**
   
   Run these commands in the SSH terminal:

   ```bash
   # Download the deployment package from GitHub/GitLab/Cloud Storage
   # For now, we'll set up manually
   
   # Create app directory
   sudo mkdir -p /opt/doctor-dashboard
   cd /opt/doctor-dashboard
   
   # Create deployment user
   sudo useradd -m -s /bin/bash doctor-dashboard || true
   sudo usermod -aG sudo doctor-dashboard
   sudo chown -R doctor-dashboard:doctor-dashboard /opt/doctor-dashboard
   ```

3. **Install Docker**
   
   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Install Docker
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   
   # Add user to docker group
   sudo usermod -aG docker doctor-dashboard
   ```

4. **Get Application Files**
   
   **Option A: Using Git (Recommended)**
   ```bash
   # Switch to doctor-dashboard user
   sudo -u doctor-dashboard -i
   
   cd /opt/doctor-dashboard
   git clone https://github.com/YOUR_USERNAME/doctor-dashboard.git .
   ```
   
   **Option B: Manual Upload**
   - If you have the files locally, upload them to Cloud Storage:
   ```bash
   # Create a bucket for deployment
   gsutil mb gs://doctor-dashboard-deploy
   
   # Then on your local machine:
   gsutil cp /tmp/doctor-dashboard-portable.tar.gz gs://doctor-dashboard-deploy/
   
   # On the VM:
   sudo -u doctor-dashboard -i
   cd /opt/doctor-dashboard
   gsutil cp gs://doctor-dashboard-deploy/doctor-dashboard-portable.tar.gz /tmp/
   tar -xzf /tmp/doctor-dashboard-portable.tar.gz
   mv doctor-dashboard-deploy/app/* .
   rm -rf doctor-dashboard-deploy
   ```

5. **Set Up Environment Variables**
   
   ```bash
   cd /opt/doctor-dashboard
   cp .env.postgres.example .env
   
   # Edit the .env file with your actual values
   nano .env
   ```

   Update these values:
   ```env
   DB_HOST=postgres
   DB_PORT=5432
   DB_NAME=doctor_dashboard
   DB_USER=doctor_dashboard
   DB_PASSWORD=your_secure_password_here
   POSTGRES_PASSWORD=your_secure_password_here
   
   JWT_SECRET=generate_with_command_below
   SESSION_SECRET=generate_with_command_below
   
   # Generate secrets:
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

6. **Build and Deploy**
   
   ```bash
   cd /opt/doctor-dashboard
   
   # Build Docker images
   docker compose build
   
   # Start services
   docker compose up -d
   ```

7. **Check Deployment Status**
   
   ```bash
   # Check running containers
   docker ps
   
   # View logs
   docker compose logs -f
   
   # Check health
   curl http://localhost:3000/health
   ```

8. **Configure Firewall**
   
   ```bash
   # Allow HTTP/HTTPS traffic
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw allow 3000/tcp
   sudo ufw reload
   ```

9. **Access Your Application**
   
   - **HTTP**: http://34.93.22.155:3000
   - **API**: http://34.93.22.155:3000/api

## 🔧 Troubleshooting

### Docker won't start
```bash
sudo systemctl restart docker
sudo systemctl status docker
```

### Permission denied
```bash
sudo chown -R doctor-dashboard:doctor-dashboard /opt/doctor-dashboard
sudo -u doctor-dashboard -i
```

### Out of memory
```bash
# Check memory
free -h

# Add swap if needed
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Database connection failed
```bash
# Check PostgreSQL status
docker compose ps postgres
docker compose logs postgres

# Restart database
docker compose restart postgres
```

## 🚀 Next Steps

1. **Configure SSL Certificate**
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

2. **Set Up Monitoring**
   ```bash
   # Add health check cron job
   (crontab -l 2>/dev/null; echo "*/5 * * * * curl -f http://localhost:3000/health || echo 'Health check failed'") | crontab -
   ```

3. **Create Admin User**
   ```bash
   docker compose exec server node scripts/create_admin.js
   ```

## 📞 Support

If you get stuck:
1. Check logs: `docker compose logs -f`
2. Check containers: `docker ps -a`
3. Restart services: `docker compose restart`

## 🎯 Quick Reference

| Command | Purpose |
|---------|---------|
| `docker compose ps` | Check service status |
| `docker compose logs -f` | View logs |
| `docker compose restart` | Restart services |
| `docker compose down` | Stop all services |
| `docker compose up -d` | Start all services |

---

**🎉 Your application should be running at: http://34.93.22.155:3000**