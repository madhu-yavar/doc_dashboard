#!/bin/bash
# Quick fix for prescription template path issue in production

set -e

echo "=========================================="
echo "Prescription Template Fix Deployment"
echo "=========================================="

echo "🔧 Issue: Prescription template files not found in production container"
echo "🎯 Solution: Rebuild Docker container with proper template inclusion"
echo ""

# Check if we're in the right directory
if [ ! -f "Dockerfile" ]; then
    echo "❌ Dockerfile not found. Please run from project root."
    exit 1
fi

echo "📋 Current changes made:"
echo "1. ✅ Updated Dockerfile to verify template directory during build"
echo "2. ✅ Added better error handling in prescription_service.cjs"
echo "3. ✅ Added template file existence checks"
echo ""

echo "🚀 Deployment options:"
echo ""
echo "Option 1: Build and push new Docker image (recommended)"
echo "  docker build -t doctor-dashboard:fixed ."
echo "  docker tag doctor-dashboard:fixed <registry>/doctor-dashboard:latest"
echo "  docker push <registry>/doctor-dashboard:latest"
echo "  # Then redeploy on GCP"
echo ""
echo "Option 2: Deploy directly to GCP VM (if you have SSH access)"
echo "  # Copy files directly to server"
echo "  gcloud compute scp --recurse prescription_template_dev <vm>:/app/"
echo ""
echo "Option 3: Quick patch - Copy templates to running container"
echo "  # Get container ID"
echo "  docker ps"
echo "  # Copy templates into container"
echo "  docker cp prescription_template_dev/ <container_id>:/app/"
echo ""

echo "🎯 Recommended immediate action:"
echo "Since we can't SSH directly to the VM, use the GCP Console:"
echo ""
echo "1. Open GCP Console → Compute Engine → VM instances"
echo "2. Click SSH button for your doctor-dashboard VM"
echo "3. Run these commands in the SSH terminal:"
echo ""
echo "   # Find the Docker container"
echo "   docker ps"
echo ""
echo "   # Copy templates into running container (replace <container_id>)"
echo "   docker mkdir -p <container_id>:/app/prescription_template_dev"
echo "   docker cp prescription_template_dev/. <container_id>:/app/prescription_template_dev/"
echo ""
echo "   # Restart container to pick up changes"
echo "   docker restart <container_id>"
echo ""

# Create a temporary script that can be run on the server
cat > fix-prescription-templates.sh << 'EOF'
#!/bin/bash
# Run this script on the production server via GCP Console SSH

echo "Fixing prescription templates in production..."

# Find the doctor-dashboard container
CONTAINER_ID=$(docker ps | grep doctor | awk '{print $1}' | head -1)

if [ -z "$CONTAINER_ID" ]; then
    echo "❌ No doctor-dashboard container found"
    exit 1
fi

echo "Found container: $CONTAINER_ID"

# Create template directory in container
docker exec $CONTAINER_ID mkdir -p /app/prescription_template_dev

# Copy template files
echo "Copying prescription template files..."
cat > /tmp/prescription-template.html << 'HTML'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prescription</title>
    <link rel="stylesheet" href="prescription-template.css" />
</head>
<body>
    <div id="prescription-content"></div>
    <script src="prescription-template.js"></script>
    <script>
        // Demo binding
        renderPrescription(samplePrescriptionData);
    </script>
</body>
</html>
HTML

# Note: This is a minimal template. For full functionality, copy the actual templates from:
# https://github.com/your-repo/prescription_template_dev/

echo "⚠️  This creates a minimal template. For full functionality, please copy the complete prescription_template_dev directory."

docker cp /tmp/prescription-template.html $CONTAINER_ID:/app/prescription_template_dev/

# Restart container
docker restart $CONTAINER_ID

echo "✅ Template fix applied. Container restarted."
EOF

chmod +x fix-prescription-templates.sh

echo "📝 Created helper script: fix-prescription-templates.sh"
echo ""
echo "🔄 To test if the fix worked:"
echo "curl -X POST https://doctor-dashboard.yavar.ai/api/prescriptions/generate \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"documentId\":\"voice-live-live-1780483830844-c45144be\",\"format\":\"html\"}'"
echo ""
echo "Expected response: Should include prescription data instead of 'ENOENT' error"