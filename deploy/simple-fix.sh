#!/bin/bash
# Simplified prescription fix - copy this to the server and run it

echo "🔧 Fixing prescription templates..."

# Find container
CONTAINER_ID=$(docker ps | grep -E "node|app" | awk '{print $1}' | head -1)
echo "Using container: $CONTAINER_ID"

# Create directory
docker exec $CONTAINER_ID mkdir -p /app/prescription_template_dev

# Create CSS file
cat > /tmp/prescription.css << 'EOF'
.prescription-container{font-family:Arial;margin:40px auto;max-width:800px;background:#fff;padding:30px;border-radius:8px}
.header{text-align:center;border-bottom:3px solid #007bff;padding-bottom:20px;margin-bottom:30px}
.hospital-name{font-size:28px;font-weight:bold;color:#007bff;margin-bottom:10px}
.section{margin-bottom:25px}
.section-title{font-size:18px;font-weight:bold;color:#333;margin-bottom:15px;border-bottom:2px solid #ddd;padding-bottom:10px}
.medication-item{padding:15px;margin-bottom:12px;background:#f8f9fa;border-left:4px solid #007bff;border-radius:5px}
.medication-name{font-weight:bold;color:#333;font-size:16px;margin-bottom:8px}
EOF

docker cp /tmp/prescription.css $CONTAINER_ID:/app/prescription_template_dev/prescription-template.css

# Create JS file
cat > /tmp/prescription.js << 'EOF'
function renderPrescription(d){const p=d.patient,h=d.hospital,t=d.prescription;let html='<div class="prescription-container"><div class="header"><div class="hospital-name">'+h.name+"</div></div>";if(p){html+='<div class="section"><strong>Patient:</strong> '+p.name;if(p.age)html+=', '+p.age;if(p.gender)html+=", "+p.gender;html+="</div>"}if(t&&t.medicines){html+='<div class="section"><div class="section-title">Medications</div>';t.medicines.forEach(m=>{html+='<div class="medication-item"><div class="medication-name">'+m.name+"</div>";if(m.dose)html+="<div>Dose: "+m.dose;if(m.frequency)html+="<div>Freq: "+m.frequency;html+="</div>"});html+="</div>"}html+="</div>";const e=document.getElementById("prescription-content");if(e)e.innerHTML=html}
EOF

docker cp /tmp/prescription.js $CONTAINER_ID:/app/prescription_template_dev/prescription-template.js

# Create HTML file
cat > /tmp/prescription.html << 'EOF'
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Prescription</title><link rel="stylesheet" href="prescription-template.css"></head><body><div id="prescription-content"></div><script src="prescription-template.js"></script><script>renderPrescription(window.prescriptionData||{hospital:{name:"City Care Hospital"},patient:{name:"John Doe",age:45,gender:"Male"},prescription:{medicines:[{name:"AMOXICILLIN 500MG",dose:"500mg"}]}});</script></body></html>
EOF

docker cp /tmp/prescription.html $CONTAINER_ID:/app/prescription_template_dev/prescription-template.html

# Verify
echo "Files created:"
docker exec $CONTAINER_ID ls -la /app/prescription_template_dev/

# Restart
echo "Restarting container..."
docker restart $CONTAINER_ID

echo "Waiting 30 seconds for server to start..."
sleep 30

echo "Testing prescription generation..."
docker exec $CONTAINER_ID curl -X POST http://localhost:3000/api/prescriptions/generate \
  -H "Content-Type: application/json" \
  -d '{"documentId":"voice-live-live-1780483830844-c45144be","format":"html"}' \
  --max-time 10

echo ""
echo "✅ Fix applied! Test externally:"
echo "curl -X POST https://doctor-dashboard.yavar.ai/api/prescriptions/generate -H 'Content-Type: application/json' -d '{\"documentId\":\"voice-live-live-1780483830844-c45144be\",\"format\":\"html\"}'"