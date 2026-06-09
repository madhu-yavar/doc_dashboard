#!/bin/bash
# Direct Deployment Script - For when GCP permissions are limited
# This script creates a portable deployment package that can be uploaded manually

set -e

echo "=========================================="
echo "Doctor Dashboard - Direct Deployment"
echo "=========================================="

# Configuration
DEPLOY_DIR="/Users/yavar/Documents/CoE/Manipal"
PACKAGE_DIR="/tmp/doctor-dashboard-deploy"
VM_IP="34.93.22.155"
VM_USER="${1:-doctor-dashboard}"

echo "📦 Creating deployment package..."

# Clean and create package directory
rm -rf $PACKAGE_DIR
mkdir -p $PACKAGE_DIR

# Copy application files
echo "📁 Copying application files..."
cd $DEPLOY_DIR
mkdir -p $PACKAGE_DIR/app

# Copy essential files
cp -r agents $PACKAGE_DIR/app/
cp -r server $PACKAGE_DIR/app/
cp -r src $PACKAGE_DIR/app/
cp -r public $PACKAGE_DIR/app/
cp -r docs $PACKAGE_DIR/app/
cp -r scripts $PACKAGE_DIR/app/

# Copy config files
cp package*.json $PACKAGE_DIR/app/
cp tsconfig.json $PACKAGE_DIR/app/
cp vite.config.ts $PACKAGE_DIR/app/
cp tailwind.config.ts $PACKAGE_DIR/app/
cp postcss.config.js $PACKAGE_DIR/app/
cp index.html $PACKAGE_DIR/app/
cp Dockerfile $PACKAGE_DIR/app/

# Copy deployment files
cp -r deploy $PACKAGE_DIR/app/
cp .env.postgres.example $PACKAGE_DIR/app/.env.example

echo "🔐 Creating setup instructions..."
cat > $PACKAGE_DIR/README.txt << 'EOF'
DOCTOR DASHBOARD DEPLOYMENT PACKAGE
====================================

To deploy this package to your VM:

1. Upload to VM:
   scp -r doctor-dashboard-deploy user@34.93.22.155:/tmp/

2. SSH to VM:
   ssh user@34.93.22.155

3. Run setup:
   cd /tmp/doctor-dashboard-deploy/app
   sudo bash deploy/vm-setup.sh
   bash deploy/deploy-app.sh

Or use the GCP Console SSH button and:
cd /tmp/doctor-dashboard-deploy/app
sudo bash deploy/vm-setup.sh
EOF

echo "📦 Creating deployment archive..."
cd /tmp
tar -czf doctor-dashboard-portable.tar.gz doctor-dashboard-deploy/

echo "✅ Deployment package created: /tmp/doctor-dashboard-portable.tar.gz"
echo ""
echo "📤 To deploy:"
echo "  1. Upload to VM:"
echo "     scp /tmp/doctor-dashboard-portable.tar.gz user@$VM_IP:/tmp/"
echo ""
echo "  2. SSH to VM:"
echo "     ssh user@$VM_IP"
echo ""
echo "  3. Extract and deploy:"
echo "     cd /tmp"
echo "     tar -xzf doctor-dashboard-portable.tar.gz"
echo "     cd doctor-dashboard-deploy/app"
echo "     sudo bash deploy/vm-setup.sh"
echo "     bash deploy/deploy-app.sh"
echo ""
echo "🎯 Or use GCP Console:"
echo "  1. Upload archive to Google Cloud Storage"
echo "  2. Download on VM using: gsutil cp gs://bucket/doctor-dashboard-portable.tar.gz /tmp/"
echo "  3. Extract and run deployment scripts"