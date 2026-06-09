#!/bin/bash
# VM Setup Script for doctor-dashboard deployment
# This script sets up the GCP VM with all required dependencies

set -e  # Exit on error

echo "=========================================="
echo "Doctor Dashboard VM Setup Script"
echo "=========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (use sudo)"
    exit 1
fi

echo "📦 Updating system packages..."
apt-get update -y

echo "🔧 Installing essential packages..."
apt-get install -y \
    curl \
    wget \
    git \
    nginx \
    certbot \
    python3-certbot-nginx \
    ufw \
    fail2ban \
    htop \
    net-tools \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

echo "🐳 Installing Docker..."
# Remove existing Docker installations
apt-get remove -y docker docker-engine docker.io containerd runc

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Set up Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "👤 Creating doctor-dashboard user..."
useradd -m -s /bin/bash doctor-dashboard || true
usermod -aG docker doctor-dashboard

echo "🔒 Configuring firewall..."
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable

echo "✅ VM setup complete!"
echo ""
echo "Next steps:"
echo "1. Copy your application files to /home/doctor-dashboard/app/"
echo "2. Run the deploy-app.sh script as doctor-dashboard user"
echo ""
echo "VM IP: $(curl -s ifconfig.me)"
