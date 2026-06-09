# Doctor Dashboard Deployment to GCP VM

## VM Configuration
- **VM Name**: doctor-dashboard-vm
- **Zone**: asia-south1-c
- **Machine Type**: e2-standard-4 (4 vCPUs, 16 GB RAM)
- **External IP**: 34.93.22.155
- **OS**: Ubuntu 22.04 LTS

## Quick Deploy (Automated)

### Prerequisites
1. Local machine with SSH access to GCP
2. GCP credentials configured
3. Domain name pointed to VM IP (optional)

### Step 1: Prepare Files Locally
```bash
# Create deployment package
cd /Users/yavar/Documents/CoE/Manipal
tar -czf doctor-dashboard.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=dist \
  --exclude=build \
  --exclude=.cache \
  --exclude=deploy \
  .

# Make scripts executable
chmod +x deploy/vm-setup.sh
chmod +x deploy/deploy-app.sh
```

### Step 2: Copy Files to VM
```bash
# Copy deployment package to VM
gcloud compute scp doctor-dashboard.tar.gz doctor-dashboard-vm:/tmp/ \
  --zone=asia-south1-c

# Copy setup scripts
gcloud compute scp deploy/vm-setup.sh doctor-dashboard-vm:/tmp/ \
  --zone=asia-south1-c
gcloud compute scp deploy/deploy-app.sh doctor-dashboard-vm:/tmp/ \
  --zone=asia-south1-c

# Copy production configurations
gcloud compute scp deploy/docker-compose.prod.yml doctor-dashboard-vm:/tmp/ \
  --zone=asia-south1-c
gcloud compute scp deploy/nginx.conf doctor-dashboard-vm:/tmp/ \
  --zone=asia-south1-c
```

### Step 3: Run Setup on VM
```bash
# SSH into VM
gcloud compute ssh doctor-dashboard-vm --zone=asia-south1-c

# Extract application files
cd /tmp
mkdir -p doctor-dashboard
tar -xzf doctor-dashboard.tar.gz -C doctor-dashboard

# Run VM setup (as root)
sudo bash /tmp/vm-setup.sh

# Copy production configurations
cp /tmp/docker-compose.prod.yml /home/doctor-dashboard/app/docker-compose.yml
cp /tmp/nginx.conf /home/doctor-dashboard/app/nginx.conf

# Run application deployment
exit  # Exit root shell
sudo -u doctor-dashboard bash /tmp/deploy-app.sh
```

### Step 4: Configure Environment
```bash
# SSH into VM as doctor-dashboard user
gcloud compute ssh doctor-dashboard-vm --zone=asia-south1-c \
  --command="sudo -u doctor-dashboard -i"

# Edit environment variables
nano /home/doctor-dashboard/app/.env

# Generate secure passwords
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 5: Start Application
```bash
cd /home/doctor-dashboard/app

# Build and start services
docker compose build
docker compose up -d

# Check service status
docker compose ps
docker compose logs -f
```

## Manual Deploy (Step-by-Step)

### 1. Initial VM Setup
```bash
# SSH into VM
gcloud compute ssh doctor-dashboard-vm --zone=asia-south1-c

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Install nginx and certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Configure firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### 2. Deploy Application
```bash
# Create app directory
mkdir -p /home/doctor-dashboard/app
cd /home/doctor-dashboard/app

# Copy application files (from local machine)
# On local machine:
gcloud compute scp --recurse /Users/yavar/Documents/CoE/Manipal/* \
  doctor-dashboard-vm:/home/doctor-dashboard/app \
  --zone=asia-south1-c \
  --exclude=node_modules --exclude=.git --exclude=dist

# Build and start
docker compose build
docker compose up -d
```

### 3. Configure SSL
```bash
# Obtain SSL certificate
sudo certbot --nginx -d doctor-dashboard.yavartechworks.com

# Test auto-renewal
sudo certbot renew --dry-run
```

## Monitoring and Management

### Check Service Status
```bash
# View all containers
docker ps

# View logs
docker compose logs -f

# Check specific service
docker compose logs server
docker compose logs postgres
```

### Database Management
```bash
# Access database
docker compose exec postgres psql -U doctor_dashboard

# Backup database
docker compose exec postgres pg_dump -U doctor_dashboard doctor_dashboard \
  > backup_$(date +%Y%m%d).sql

# Restore database
docker compose exec -T postgres psql -U doctor_dashboard doctor_dashboard \
  < backup_20240604.sql
```

### Application Management
```bash
# Restart services
docker compose restart

# Update application
cd /home/doctor-dashboard/app
git pull
docker compose build
docker compose up -d

# View resource usage
docker stats
```

## Troubleshooting

### Service Won't Start
```bash
# Check logs
docker compose logs server

# Check disk space
df -h

# Check memory
free -h

# Restart Docker
sudo systemctl restart docker
```

### Database Connection Issues
```bash
# Check PostgreSQL status
docker compose ps postgres

# Check PostgreSQL logs
docker compose logs postgres

# Test connection
docker compose exec postgres pg_isready -U doctor_dashboard
```

### SSL Certificate Issues
```bash
# Check certificate status
sudo certbot certificates

# Renew certificate
sudo certbot renew

# Reconfigure nginx
sudo nginx -t
sudo systemctl reload nginx
```

## Performance Optimization

### PostgreSQL Tuning
Edit `/home/doctor-dashboard/app/postgresql.conf`:
```ini
shared_buffers = 4GB
effective_cache_size = 12GB
maintenance_work_mem = 1GB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 2621kB
min_wal_size = 1GB
max_wal_size = 4GB
```

### Docker Resource Limits
Update docker-compose.yml with resource limits:
```yaml
services:
  server:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 8G
        reservations:
          cpus: '1'
          memory: 4G
```

## Security Checklist

- ✅ Change default passwords in .env
- ✅ Configure SSL certificate
- ✅ Set up firewall rules
- ✅ Enable fail2ban
- ✅ Regular security updates
- ✅ Monitor access logs
- ✅ Backup strategy
- ✅ Health check endpoints

## Backup Strategy

### Automated Backups
```bash
# Create backup script
cat > /home/doctor-dashboard/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/home/doctor-dashboard/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Backup database
docker compose exec postgres pg_dump -U doctor_dashboard doctor_dashboard \
  > "$BACKUP_DIR/database_$DATE.sql"

# Backup uploads
tar -czf "$BACKUP_DIR/uploads_$DATE.tar.gz" data/uploads/

# Keep only last 7 days
find $BACKUP_DIR -name "database_*" -mtime +7 -delete
find $BACKUP_DIR -name "uploads_*" -mtime +7 -delete
EOF

chmod +x /home/doctor-dashboard/backup.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add: 0 2 * * * /home/doctor-dashboard/backup.sh
```

## Access Information

- **Application URL**: http://34.93.22.155
- **API URL**: http://34.93.22.155:3000
- **SSH Access**: `gcloud compute ssh doctor-dashboard-vm --zone=asia-south1-c`

## Next Steps

1. Configure domain DNS to point to VM IP
2. Set up SSL certificate with Let's Encrypt
3. Configure monitoring and alerts
4. Set up automated backups
5. Test all functionality
6. Deploy to production
