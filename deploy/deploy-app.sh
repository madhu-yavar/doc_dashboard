#!/bin/bash
# Application Deployment Script for doctor-dashboard
# This script deploys the doctor-dashboard application

set -e  # Exit on error

echo "=========================================="
echo "Doctor Dashboard Application Deployment"
echo "=========================================="

# Configuration
APP_DIR="/home/doctor-dashboard/app"
DEPLOY_USER="doctor-dashboard"
DOMAIN="${1:-doctor-dashboard.yavartechworks.com}"  # Use your actual domain or IP

echo "📁 Creating application directory..."
mkdir -p $APP_DIR/data/postgres
mkdir -p $APP_DIR/logs
mkdir -p $APP_DIR/backups

echo "📋 Copying application files..."
# Assuming files are copied to /tmp/doctor-dashboard first
if [ -d "/tmp/doctor-dashboard" ]; then
    cp -r /tmp/doctor-dashboard/* $APP_DIR/
    chown -R $DEPLOY_USER:$DEPLOY_USER $APP_DIR
else
    echo "❌ Application files not found in /tmp/doctor-dashboard"
    echo "Please copy your application files first:"
    echo "  scp -r ./ doctor-dashboard@<VM-IP>:/tmp/doctor-dashboard"
    exit 1
fi

cd $APP_DIR

echo "🔐 Setting up environment variables..."
if [ ! -f "$APP_DIR/.env" ]; then
    echo "Creating .env file..."
    cat > $APP_DIR/.env << 'EOF'
# Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_NAME=doctor_dashboard
DB_USER=doctor_dashboard
DB_PASSWORD=CHANGE_THIS_SECURE_PASSWORD
POSTGRES_PASSWORD=CHANGE_THIS_SECURE_PASSWORD

# Application Configuration
NODE_ENV=production
PORT=3000
VITE_API_URL=http://34.93.22.155:3000

# JWT Secret (Generate a secure random string)
JWT_SECRET=CHANGE_THIS_SECURE_JWT_SECRET
JWT_EXPIRES_IN=7d

# Session Secret
SESSION_SECRET=CHANGE_THIS_SECURE_SESSION_SECRET

# Email Configuration (Optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
EMAIL_FROM=doctor-dashboard@yavartechworks.com

# Storage Configuration
UPLOAD_DIR=/app/data/uploads
MAX_FILE_SIZE=10485760

# GPU Configuration (if using GPU for STT)
USE_GPU=true
GPU_MEMORY_FRACTION=0.7

# Logging
LOG_LEVEL=info
LOG_FILE=/app/logs/app.log
EOF

    echo "⚠️  IMPORTANT: Update the .env file with secure passwords and secrets!"
    echo "   nano $APP_DIR/.env"
fi

echo "🐳 Building Docker images..."
cd $APP_DIR
docker compose build

echo "🚀 Starting services..."
docker compose up -d postgres
sleep 10  # Wait for PostgreSQL to be ready
docker compose up -d

echo "⏳ Waiting for services to be healthy..."
sleep 30

echo "🔍 Checking service status..."
docker compose ps

echo "📊 Creating default admin user..."
docker compose exec server node scripts/create_admin.js || true

echo "✅ Application deployment complete!"
echo ""
echo "📝 Access Information:"
echo "  Application URL: http://$DOMAIN"
echo "  API URL: http://$DOMAIN:3000"
echo ""
echo "🔧 Useful Commands:"
echo "  View logs: docker compose logs -f"
echo "  Stop services: docker compose down"
echo "  Restart services: docker compose restart"
echo "  Backup database: docker compose exec postgres pg_dump -U doctor_dashboard doctor_dashboard > backup.sql"
echo ""
echo "⚠️  Next Steps:"
echo "1. Configure SSL certificate: certbot --nginx -d $DOMAIN"
echo "2. Set up monitoring: configure health check endpoints"
echo "3. Update DNS to point to this VM"
