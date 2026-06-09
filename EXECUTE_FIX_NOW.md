# 🚀 PRESCRIPTION FIX - Execute Now

## Quick Instructions

**1. Open GCP Console SSH:**
- Go to: https://console.cloud.google.com/compute/instances
- Find your "doctordashboard" VM
- Click the **SSH** button

**2. Copy & Paste This One-Liner:**

```bash
CONTAINER_ID=$(docker ps | grep -E "node|app" | awk '{print $1}' | head -1); docker exec $CONTAINER_ID mkdir -p /app/prescription_template_dev; docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.css << '\''EOF'\''
.prescription-container{font-family:Arial;margin:40px auto;max-width:800px;background:#fff;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
.header{text-align:center;border-bottom:3px solid #007bff;padding-bottom:20px;margin-bottom:30px}
.hospital-name{font-size:28px;font-weight:bold;color:#007bff;margin-bottom:10px}
.section{margin-bottom:25px}
.section-title{font-size:18px;font-weight:bold;color:#333;margin-bottom:15px;border-bottom:2px solid #ddd;padding-bottom:10px}
.medication-item{padding:15px;margin-bottom:12px;background:#f8f9fa;border-left:4px solid #007bff;border-radius:5px}
.medication-name{font-weight:bold;color:#333;font-size:16px;margin-bottom:8px}
.timing-badge{display:inline-block;padding:4px 10px;background:#007bff;color:#fff;border-radius:12px;font-size:12px;margin:5px 5px 0 0}
@media print{body{background:#fff}.prescription-container{box-shadow:none}}
EOF'; docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.js << '\''EOF'\''
function renderPrescription(d){const p=d.patient,h=d.hospital,t=d.prescription;let html='<div class="prescription-container"><div class="header"><div class="hospital-name">'+h.name+"</div></div>";if(p){html+='<div class="section"><strong>Patient:</strong> '+p.name;if(p.age)html+=', '+p.age+" years";if(p.gender)html+=", "+p.gender;html+="</div>"}if(t&&t.medicines){html+='<div class="section"><div class="section-title">Medications</div>';t.medicines.forEach(m=>{html+='<div class="medication-item"><div class="medication-name">'+m.name+"</div>";if(m.dose)html+="<div>Dose: "+m.dose+"</div>";if(m.frequency)html+="<div>Frequency: "+m.frequency+"</div>";if(m.timing){html+="<div>";if(m.timing.morning)html+='<span class="timing-badge">Morning</span>';if(m.timing.noon)html+='<span class="timing-badge">Noon</span>';if(m.timing.night)html+='<span class="timing-badge">Night</span>';if(m.timing.bedtime)html+='<span class="timing-badge">Bedtime</span>';html+="</div>"}html+="</div>"});html+="</div>"}html+="</div>";const e=document.getElementById("prescription-content");if(e)e.innerHTML=html}const samplePrescriptionData={hospital:{name:"City Care Hospital",tagline:"Your Health,Our Priority"},patient:{name:"John Doe",age:45,gender:"Male"},doctor:{name:"Dr. Smith"},prescription:{medicines:[{name:"AMOXICILLIN 500MG",dose:"500mg",frequency:"Twice daily",timing:{morning:true,night:true}}]}};
EOF'; docker exec $CONTAINER_ID bash -c 'cat > /app/prescription_template_dev/prescription-template.html << '\''EOF'\''
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Prescription</title><link rel="stylesheet" href="prescription-template.css"></head><body><div id="prescription-content"></div><script src="prescription-template.js"></script><script>renderPrescription(window.prescriptionData||samplePrescriptionData);</script></body></html>
EOF'; echo "✅ Templates deployed:"; docker exec $CONTAINER_ID ls -la /app/prescription_template_dev/; echo "🔄 Restarting container..."; docker restart $CONTAINER_ID; echo "⏳ Waiting 30 seconds for server..."; sleep 30; echo "🧪 Testing prescription endpoint..."; docker exec $CONTAINER_ID curl -X POST http://localhost:3000/api/prescriptions/generate -H "Content-Type: application/json" -d '{"documentId":"voice-live-live-1780483830844-c45144be","format":"html"}' --max-time 10
```

**3. Test the Fix:**

```bash
curl -X POST https://doctor-dashboard.yavar.ai/api/prescriptions/generate \
  -H "Content-Type: application/json" \
  -d '{"documentId":"voice-live-live-1780483830844-c45144be","format":"html"}'
```

## ✅ Expected Result

**Before Fix:**
```json
{"success":false,"error":"ENOENT: no such file or directory, open '/app/prescription_template_dev/prescription-template.css'"}
```

**After Fix:**
```json
{
  "success": true,
  "documentId": "voice-live-live-1780483830844-c45144be",
  "urls": {
    "html": "/prescriptions/Conversation_prescription_123456.html"
  }
}
```

## 🔧 What This Does

1. Finds the running Docker container
2. Creates `/app/prescription_template_dev/` directory
3. Generates all 3 template files (HTML, CSS, JS)
4. Restarts the container
5. Tests the prescription endpoint

## 🎯 VM Details

- **Name:** doctordashboard
- **IP:** 34.93.22.155
- **Domain:** https://doctor-dashboard.yavar.ai
- **Specs:** 4 vCPU, 16GB RAM, 100GB SSD

---

**⏱️ Time required: ~2 minutes**
**🎉 Result:** Prescription generation will work immediately after fix!