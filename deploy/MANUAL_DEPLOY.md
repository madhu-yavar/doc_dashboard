# Manual Deployment Instructions

Since we're experiencing GCP permission issues, here are multiple deployment approaches:

## Option 1: Direct SSH Deployment (Recommended)

If you have direct SSH access to the VM:

```bash
# 1. Create deployment package locally
cd /Users/yavar/Documents/CoE/Manipal
tar -czf /tmp/doctor-dashboard.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=dist \
  --exclude=build \
  .

# 2. Copy files directly via SCP
scp /tmp/doctor-dashboard.tar.gz user@34.93.22.155:/tmp/

# 3. SSH to VM
ssh user@34.93.22.155

# 4. Extract and setup
sudo mkdir -p /opt/doctor-dashboard
cd /opt/doctor-dashboard
sudo tar -xzf /tmp/doctor-dashboard.tar.gz

# 5. Run setup
sudo bash deploy/vm-setup.sh
```

## Option 2: GCP Console Deployment

### Using GCP Console:

1. **Open GCP Console**
   - Go to https://console.cloud.google.com/compute/instances
   - Select project: yavar-client-poc

2. **Connect to VM**
   - Find your VM (should be in asia-south1-c zone)
   - Click "SSH" button to open browser-based SSH

3. **Download Deployment Files**
   ```bash
   # In the SSH session, download deployment files
   curl -o /tmp/doctor-dashboard.tar.gz https://storage.googleapis.com/your-bucket/doctor-dashboard.tar.gz
   
   # Or use wget if you have the files hosted somewhere
   ```

4. **Extract and Deploy**
   ```bash
   cd /tmp
   tar -xzf doctor-dashboard.tar.gz
   cd doctor-dashboard
   
   # Run setup scripts
   sudo bash deploy/vm-setup.sh
   bash deploy/deploy-app.sh
   ```

## Option 3: Manual Setup Steps

If automated scripts don't work, follow these steps manually:

### 1. System Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install -y docker-compose

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Application Setup
```bash
# Create directory
sudo mkdir -p /opt/doctor-dashboard
cd /opt/doctor-dashboard

# Copy your application files (use SCP, SFTP, or git clone)
# git clone https://your-repo.git .

# Build and start
docker-compose build
docker-compose up -d
```

### 3. Environment Configuration
```bash
# Create .env file
cat > .env << 'EOF'
DB_HOST=postgres
DB_PORT=5432
DB_NAME=doctor_dashboard
DB_USER=doctor_dashboard
DB_PASSWORD=your_secure_password
POSTGRES_PASSWORD=your_secure_password

JWT_SECRET=your_jwt_secret
SESSION_SECRET=your_session_secret

PORT=3000
NODE_ENV=production
EOF
```

## Option 4: Google Cloud Deployment Manager

### Using Deployment Manager templates:

1. **Create deployment template**
2. **Deploy using gcloud deployment-manager deployments create**

## Troubleshooting GCP Permissions

If you're getting permission errors:

```bash
# Check your current permissions
gcloud auth list
gcloud config list

# Try switching to a different account
gcloud config set account YOUR_ACCOUNT

# Or request additional permissions from your GCP admin
```

## Quick VM Access

### Find your VM details:
```bash
# List all projects
gcloud projects list

# Try different project
gcloud config set project PROJECT_ID

# List instances in specific project/zone
gcloud compute instances list --project=PROJECT_ID --zone=asia-south1-c
```

### Direct SSH with IP:
```bash
# If you have SSH keys set up
ssh -i ~/.ssh/google_compute_engine username@34.93.22.155

# Or with gcloud (if permissions work)
gcloud compute ssh INSTANCE_NAME --zone=ZONE
```

## Next Steps

1. **Check GCP Console**: Go to console.cloud.google.com and verify your VM exists
2. **Check Permissions**: Ensure your account has "Compute Instance Admin" role
3. **Try Browser SSH**: Use the SSH button in GCP Console
4. **Manual Deploy**: Use the manual steps above if automated scripts fail

## Support

If you're still stuck:
1. What is the exact name of your VM in GCP Console?
2. What permissions does your account have?
3. Can you access the VM via the GCP Console SSH button?

Let me know which approach works best for you!