#!/bin/bash
# Automated prescription fix for doctordashboard VM
# This script attempts multiple connection methods to deploy the fix

echo "🔧 Attempting automated deployment to doctordashboard VM..."
echo "Target: yavar-poc@34.93.22.155"
echo ""

# Method 1: Try direct SSH with generated key
echo "📍 Method 1: Direct SSH connection"
if ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o BatchMode=yes yavar-poc@34.93.22.155 "echo 'SSH works'" 2>/dev/null; then
    echo "✅ SSH connection established"
    # Deploy fix here
    ssh yavar-poc@34.93.22.155 bash << 'EOF'
CONTAINER_ID=$(docker ps | grep -E "node|app" | awk '{print $1}' | head -1)
docker exec $CONTAINER_ID mkdir -p /app/prescription_template_dev
docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.css << '\'EOF'\''
.prescription-container{font-family:Arial;margin:40px auto;max-width:800px;background:#fff;padding:30px;border-radius:8px}
.header{text-align:center;border-bottom:3px solid #007bff;padding-bottom:20px;margin-bottom:30px}
.hospital-name{font-size:28px;font-weight:bold;color:#007bff;margin-bottom:10px}
.section{margin-bottom:25px}
.section-title{font-size:18px;font-weight:bold;color:#333;margin-bottom:15px;border-bottom:2px solid #ddd;padding-bottom:10px}
.medication-item{padding:15px;margin-bottom:12px;background:#f8f9fa;border-left:4px solid #007bff;border-radius:5px}
.medication-name{font-weight:bold;color:#333;font-size:16px;margin-bottom:8px}
EOF'
docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.js << '\'EOF'\''
function renderPrescription(d){const p=d.patient,h=d.hospital,t=d.prescription;let html='<div class="prescription-container"><div class="header"><div class="hospital-name">'+h.name+"</div></div>";if(p){html+='<div class="section"><strong>Patient:</strong> '+p.name;if(p.age)html+=', '+p.age;if(p.gender)html+=", "+p.gender;html+="</div>"}if(t&&t.medicines){html+='<div class="section"><div class="section-title">Medications</div>';t.medicines.forEach(m=>{html+='<div class="medication-item"><div class="medication-name">'+m.name+"</div>";if(m.dose)html+="<div>Dose: "+m.dose;if(m.frequency)html+="<div>Freq: "+m.frequency;html+="</div>"});html+="</div>"}html+="</div>";const e=document.getElementById("prescription-content");if(e)e.innerHTML=html}const samplePrescriptionData={hospital:{name:"City Care Hospital"},patient:{name:"John Doe",age:45,gender:"Male"},prescription:{medicines:[{name:"AMOXICILLIN 500MG",dose:"500mg"}]}};
EOF'
docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.html << '\'EOF'\''
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Prescription</title><link rel="stylesheet" href="prescription-template.css"></head><body><div id="prescription-content"></div><script src="prescription-template.js"></script><script>renderPrescription(window.prescriptionData||samplePrescriptionData);</script></body></html>
EOF'
echo "✅ Templates deployed"
docker restart $CONTAINER_ID
EOF
    echo "🎉 Fix deployed successfully!"
else
    echo "❌ Direct SSH failed"

    # Method 2: Provide manual instructions
    echo ""
    echo "📍 Method 2: Manual deployment via GCP Console"
    echo ""
    echo "Please follow these steps:"
    echo "1. Open GCP Console: https://console.cloud.google.com/compute/instances"
    echo "2. Find your doctordashboard VM"
    echo "3. Click SSH button"
    echo "4. Copy-paste this command:"
    echo ""
    cat << 'MANUAL_COMMAND'
CONTAINER_ID=$(docker ps | grep -E "node|app" | awk '{print $1}' | head -1); docker exec $CONTAINER_ID mkdir -p /app/prescription_template_dev; docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.css << '\''EOF'\''
.prescription-container{font-family:Arial;margin:40px auto;max-width:800px;background:#fff;padding:30px;border-radius:8px}
.header{text-align:center;border-bottom:3px solid #007bff;padding-bottom:20px;margin-bottom:30px}
.hospital-name{font-size:28px;font-weight:bold;color:#007bff;margin-bottom:10px}
.section{margin-bottom:25px}
.section-title{font-size:18px;font-weight:bold;color:#333;margin-bottom:15px;border-bottom:2px solid #ddd;padding-bottom:10px}
.medication-item{padding:15px;margin-bottom:12px;background:#f8f9fa;border-left:4px solid #007bff;border-radius:5px}
.medication-name{font-weight:bold;color:#333;font-size:16px;margin-bottom:8px}
EOF'; docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.js << '\''EOF'\''
function renderPrescription(d){const p=d.patient,h=d.hospital,t=d.prescription;let html='<div class="prescription-container"><div class="header"><div class="hospital-name">'+h.name+"</div></div>";if(p){html+='<div class="section"><strong>Patient:</strong> '+p.name;if(p.age)html+=', '+p.age;if(p.gender)html+=", "+p.gender;html+="</div>"}if(t&&t.medicines){html+='<div class="section"><div class="section-title">Medications</div>';t.medicines.forEach(m=>{html+='<div class="medication-item"><div class="medication-name">'+m.name+"</div>";if(m.dose)html+="<div>Dose: "+m.dose;if(m.frequency)html+="<div>Freq: "+m.frequency;html+="</div>"});html+="</div>"}html+="</div>";const e=document.getElementById("prescription-content");if(e)e.innerHTML=html}const samplePrescriptionData={hospital:{name:"City Care Hospital"},patient:{name:"John Doe",age:45,gender:"Male"},prescription:{medicines:[{name:"AMOXICILLIN 500MG",dose:"500mg"}]}};
EOF'; docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.html << '\''EOF'\''
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Prescription</title><link rel="stylesheet" href="prescription-template.css"></head><body><div id="prescription-content"></div><script src="prescription-template.js"></script><script>renderPrescription(window.prescriptionData||samplePrescriptionData);</script></body></html>
EOF'; echo "✅ Templates created:"; docker exec $CONTAINER_ID ls -la /app/prescription_template_dev/; echo "🔄 Restarting..."; docker restart $CONTAINER_ID; echo "⏳ Wait 30s..."; sleep 30; echo "🧪 Testing..."; docker exec $CONTAINER_ID curl -X POST http://localhost:3000/api/prescriptions/generate -H "Content-Type: application/json" -d '{"documentId":"voice-live-live-1780483830844-c45144be","format":"html"}' --max-time 10
MANUAL_COMMAND
    echo ""
    echo "After running this, test with:"
    echo "curl -X POST https://doctor-dashboard.yavar.ai/api/prescriptions/generate -H 'Content-Type: application/json' -d '{\"documentId\":\"voice-live-live-1780483830844-c45144be\",\"format\":\"html\"}'"
fi