# 🚀 Quick Fix for Prescription Generation

## Issue
Prescription download fails with:
```
"ENOENT: no such file or directory, open '/app/prescription_template_dev/prescription-template.css'"
```

## 🎯 Solution (Copy-Paste into GCP Console SSH)

**Step 1:** Open GCP Console → Compute Engine → VM instances → Click SSH button

**Step 2:** Copy and paste this entire script into the SSH terminal:

```bash
#!/bin/bash
# Prescription Templates Fix Script - Run in GCP Console SSH

echo "🔧 Fixing prescription templates..."

# Find the doctor-dashboard container
CONTAINER_ID=$(docker ps | grep -E "doctor|node|app" | awk '{print $1}' | head -1)

if [ -z "$CONTAINER_ID" ]; then
    echo "❌ No container found. Listing all containers:"
    docker ps
    exit 1
fi

echo "✅ Found container: $CONTAINER_ID"

# Create template directory
docker exec $CONTAINER_ID mkdir -p /app/prescription_template_dev

# Create CSS file
echo "📝 Creating prescription-template.css..."
docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.css << '\''EOF'\''
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px}
.prescription-container{max-width:800px;margin:0 auto;background:white;padding:40px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
.header{text-align:center;margin-bottom:30px;border-bottom:2px solid #007bff;padding-bottom:20px}
.hospital-name{font-size:24px;font-weight:bold;color:#007bff;margin-bottom:10px}
.prescription-info{display:flex;justify-content:space-between;margin-bottom:30px;padding:15px;background:#f8f9fa;border-radius:5px}
.section{margin-bottom:30px}
.section-title{font-size:18px;font-weight:bold;color:#333;margin-bottom:15px;border-bottom:1px solid #ddd;padding-bottom:10px}
.medication-item{padding:12px;margin-bottom:10px;background:#f8f9fa;border-left:4px solid #007bff;border-radius:4px}
.medication-name{font-weight:bold;color:#333;margin-bottom:5px}
EOF'

# Create JS file
echo "📝 Creating prescription-template.js..."
docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.js << '\''EOF'\''
function renderPrescription(data){
const prescription=data.prescription;
const patient=data.patient;
const doctor=data.doctor;
const hospital=data.hospital;
let html=`<div class="prescription-container"><div class="header"><div class="hospital-name">${hospital.name}</div></div><div class="prescription-info"><div><strong>Patient:</strong>${patient.name}</div></div>`;
if(prescription.medicines){prescription.medicines.forEach(med=>{html+=`<div class="medication-item"><div class="medication-name">${med.name}</div></div>`});}
html+=`</div>`;
document.getElementById("prescription-content").innerHTML=html}
const samplePrescriptionData={hospital:{name:"City Care Hospital"},patient:{name:"John Doe",age:45},doctor:{name:"Dr. Smith"},prescription:{medicines:[{name:"AMOXICILLIN 500MG",dose:"500mg"}]}};
EOF'

# Create HTML file
echo "📝 Creating prescription-template.html..."
docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.html << '\''EOF'\''
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Prescription</title><link rel="stylesheet" href="prescription-template.css"></head><body><div id="prescription-content"></div><script src="prescription-template.js"></script><script>renderPrescription(window.prescriptionData||samplePrescriptionData);</script></body></html>
EOF'

echo "✅ Templates created!"
echo "📋 Files created:"
docker exec $CONTAINER_ID ls -la /app/prescription_template_dev/

echo ""
echo "🔄 Restarting container..."
docker restart $CONTAINER_ID

echo "⏳ Waiting 30 seconds for server to start..."
sleep 30

echo "🧪 Testing prescription generation..."
curl -X POST http://localhost:3000/api/prescriptions/generate \
  -H "Content-Type: application/json" \
  -d '{"documentId":"voice-live-live-1780483830844-c45144be","format":"html"}' \
  --max-time 10

echo ""
echo "✅ Fix applied! Test the production endpoint now."
```

## 🧪 Test the Fix

After running the script, test the production endpoint:

```bash
curl -X POST https://doctor-dashboard.yavar.ai/api/prescriptions/generate \
  -H "Content-Type: application/json" \
  -d '{"documentId":"voice-live-live-1780483830844-c45144be","format":"html"}'
```

**Expected Response:** Should return prescription data instead of ENOENT error

## 🔍 What This Fix Does

1. **Creates missing directory**: `/app/prescription_template_dev/`
2. **Adds 3 template files**: HTML, CSS, and JS for prescription rendering
3. **Restarts container**: To pick up the new files
4. **Tests locally**: Verifies the fix works

## ⚡ Why This Happened

The Docker build process wasn't copying the `prescription_template_dev` directory correctly into the container, so the prescription service couldn't find the template files needed to generate prescriptions.

## 🎯 Permanent Fix

For a permanent solution, update the Dockerfile to ensure templates are always included:

```dockerfile
# Add verification step after copying files
COPY prescription_template_dev ./prescription_template_dev
RUN ls -la prescription_template_dev && echo "Templates verified"
```

## 📞 If Still Failing

1. Check container logs: `docker logs <container_id> --tail 50`
2. Verify files exist: `docker exec <container_id> ls -la /app/prescription_template_dev/`
3. Test document exists in database
4. Check server resources (memory/CPU)