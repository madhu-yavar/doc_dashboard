#!/bin/bash
# Auto-Deployment Script for Doctor Dashboard to GCP VM
# This script automates the entire deployment process

set -e  # Exit on error

# Configuration
VM_NAME="doctor-dashboard-vm"
VM_ZONE="asia-south1-c"
VM_IP="34.93.22.155"
PROJECT_PATH="/Users/yavar/Documents/CoE/Manipal"
DEPLOY_USER="doctor-dashboard"
DOMAIN="${1:-doctor-dashboard.yavartechworks.com}"

echo "=========================================="
echo "Doctor Dashboard Auto-Deployment"
echo "=========================================="
echo "VM: $VM_NAME ($VM_ZONE)"
echo "IP: $VM_IP"
echo "Domain: $DOMAIN"
echo "=========================================="

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Google Cloud SDK not found. Please install it first:"
    echo "   https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if we can authenticate
echo "🔐 Checking GCP authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
    echo "❌ Not authenticated. Please run: gcloud auth login"
    exit 1
fi

echo "📦 Creating deployment package..."
cd $PROJECT_PATH

# Create deployment package excluding unnecessary files
tar -czf /tmp/doctor-dashboard.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=dist \
  --exclude=build \
  --exclude=.cache \
  --exclude=archive \
  --exclude=coverage \
  --exclude="*.log" \
  .

echo "📤 Copying files to VM..."
# Copy deployment package
gcloud compute scp /tmp/doctor-dashboard.tar.gz $DEPLOY_USER@$VM_NAME:/tmp/ \
  --zone=$VM_ZONE

# Copy setup scripts
gcloud compute scp deploy/vm-setup.sh $DEPLOY_USER@$VM_NAME:/tmp/ \
  --zone=$VM_ZONE
gcloud compute scp deploy/deploy-app.sh $DEPLOY_USER@$VM_NAME:/tmp/ \
  --zone=$VM_ZONE
gcloud compute scp deploy/docker-compose.prod.yml $DEPLOY_USER@$VM_NAME:/tmp/ \
  --zone=$VM_ZONE
gcloud compute scp deploy/nginx.conf $DEPLOY_USER@$VM_NAME:/tmp/ \
  --zone=$VM_ZONE

echo "🔧 Setting up VM..."
# Run VM setup
gcloud compute ssh $DEPLOY_USER@$VM_NAME \
  --zone=$VM_ZONE \
  --command="sudo bash /tmp/vm-setup.sh"

echo "🚀 Deploying application..."
# Deploy application
gcloud compute ssh $DEPLOY_USER@$VM_NAME \
  --zone=$VM_ZONE \
  --command="bash -s -- $DOMAIN" < deploy/deploy-app.sh

echo "⏳ Waiting for services to start..."
sleep 30

echo "🔍 Checking deployment status..."
gcloud compute ssh $DEPLOY_USER@$VM_NAME \
  --zone=$VM_ZONE \
  --command="cd /home/doctor-dashboard/app && docker compose ps"

echo "🎉 Deployment complete!"
echo ""
echo "📝 Access Information:"
echo "  HTTP URL: http://$VM_IP"
echo "  API URL: http://$VM_IP:3000"
echo "  SSH: gcloud compute ssh $DEPLOY_USER@$VM_NAME --zone=$VM_ZONE"
echo ""
echo "⚠️  Important Next Steps:"
echo "  1. Configure SSL: sudo certbot --nginx -d $DOMAIN"
echo "  2. Update .env with secure passwords"
echo "  3. Create admin user: docker compose exec server node scripts/create_admin.js"
echo "  4. Monitor logs: docker compose logs -f"
echo ""
echo "🔧 Troubleshooting:"
echo "  View logs: gcloud compute ssh $DEPLOY_USER@$VM_NAME --zone=$VM_ZONE --command='cd /home/doctor-dashboard/app && docker compose logs -f'"
echo "  Restart services: gcloud compute ssh $DEPLOY_USER@$VM_NAME --zone=$VM_ZONE --command='cd /home/doctor-dashboard/app && docker compose restart'"
