#!/bin/bash
# GCP Console Quick Setup Script
# Run this directly in the GCP Console SSH terminal

set -e  # Exit on error

echo "=========================================="
echo "Doctor Dashboard - GCP Console Quick Setup"
echo "=========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (use sudo)"
    exit 1
fi

echo "👤 Creating doctor-dashboard user..."
useradd -m -s /bin/bash doctor-dashboard || true
usermod -aG sudo doctor-dashboard

echo "📁 Creating application directory..."
mkdir -p /opt/doctor-dashboard
chown -R doctor-dashboard:doctor-dashboard /opt/doctor-dashboard

echo "🔧 Installing dependencies..."
apt update -y
apt install -y curl git wget nginx ufw

echo "🐳 Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
usermod -aG docker doctor-dashboard

echo "🔒 Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw --force enable

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Get application files (see below)"
echo "2. Configure environment variables"
echo "3. Build and deploy with Docker Compose"
echo ""
echo "📁 Application directory: /opt/doctor-dashboard"
echo "👤 Application user: doctor-dashboard"
echo ""
echo "🔄 Switch to doctor-dashboard user:"
echo "   sudo -u doctor-dashboard -i"
echo ""
echo "📥 To get application files, choose one method:"
echo ""
echo "   Method 1: Clone from Git"
echo "   cd /opt/doctor-dashboard"
echo "   git clone <your-repo-url> ."
echo ""
echo "   Method 2: Download from Cloud Storage"
echo "   gsutil cp gs://bucket/doctor-dashboard-portable.tar.gz /tmp/"
echo "   tar -xzf /tmp/doctor-dashboard-portable.tar.gz -C /opt/doctor-dashboard"
echo ""
echo "   Method 3: Manual upload via SCP (from your local machine)"
echo "   scp -r /path/to/app/* doctor-dashboard@34.93.22.155:/opt/doctor-dashboard/"