#!/bin/bash
# Script to copy prescription templates to production Docker container
# Run this via GCP Console SSH

echo "=========================================="
echo "Prescription Templates Fix Script"
echo "Run this on the production server via GCP Console SSH"
echo "=========================================="

# Find the doctor-dashboard container
CONTAINER_ID=$(docker ps | grep -E "doctor|node" | awk '{print $1}' | head -1)

if [ -z "$CONTAINER_ID" ]; then
    echo "❌ No doctor-dashboard container found"
    echo "Available containers:"
    docker ps
    exit 1
fi

echo "Found container: $CONTAINER_ID"

# Check if container has /app directory
if ! docker exec $CONTAINER_ID ls /app > /dev/null 2>&1; then
    echo "❌ Container doesn't have /app directory"
    exit 1
fi

echo "✅ Container has /app directory"

# Create template directory in container
echo "Creating prescription template directory..."
docker exec $CONTAINER_ID mkdir -p /app/prescription_template_dev

# Create the CSS file
echo "Creating prescription-template.css..."
docker exec $CONTAINER_ID tee /app/prescription_template_dev/prescription-template.css > /dev/null << 'EOF'
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background-color: #f5f5f5;
    padding: 20px;
}

.prescription-container {
    max-width: 800px;
    margin: 0 auto;
    background: white;
    padding: 40px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.header {
    text-align: center;
    margin-bottom: 30px;
    border-bottom: 2px solid #007bff;
    padding-bottom: 20px;
}

.hospital-name {
    font-size: 24px;
    font-weight: bold;
    color: #007bff;
    margin-bottom: 10px;
}

.hospital-tagline {
    font-size: 14px;
    color: #666;
    margin-bottom: 20px;
}

.prescription-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 30px;
    padding: 15px;
    background-color: #f8f9fa;
    border-radius: 5px;
}

.patient-info, .doctor-info {
    flex: 1;
}

.info-label {
    font-weight: bold;
    color: #333;
    margin-bottom: 5px;
}

.info-value {
    color: #666;
    margin-bottom: 15px;
}

.section {
    margin-bottom: 30px;
}

.section-title {
    font-size: 18px;
    font-weight: bold;
    color: #333;
    margin-bottom: 15px;
    border-bottom: 1px solid #ddd;
    padding-bottom: 10px;
}

.diagnosis-item, .medication-item {
    padding: 12px;
    margin-bottom: 10px;
    background-color: #f8f9fa;
    border-left: 4px solid #007bff;
    border-radius: 4px;
}

.medication-name {
    font-weight: bold;
    color: #333;
    margin-bottom: 5px;
}

.medication-details {
    color: #666;
    font-size: 14px;
    margin: 3px 0;
}

.timing-badges {
    display: flex;
    gap: 5px;
    margin-top: 8px;
}

.timing-badge {
    padding: 3px 8px;
    background-color: #007bff;
    color: white;
    border-radius: 12px;
    font-size: 12px;
}

.footer {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid #ddd;
    text-align: center;
    color: #666;
    font-size: 12px;
}

@media print {
    body {
        background-color: white;
        padding: 0;
    }

    .prescription-container {
        box-shadow: none;
        border-radius: 0;
    }
}
EOF

# Create the JS file
echo "Creating prescription-template.js..."
docker exec $CONTAINER_ID tee /app/prescription_template_dev/prescription-template.js > /dev/null << 'EOF'
function renderPrescription(data) {
    const prescription = data.prescription;
    const patient = data.patient;
    const doctor = data.doctor;
    const hospital = data.hospital;

    // Build prescription HTML
    let html = `
        <div class="prescription-container">
            <div class="header">
                <div class="hospital-name">${hospital.name}</div>
                <div class="hospital-tagline">${hospital.tagline}</div>
                <div>${hospital.address}</div>
            </div>

            <div class="prescription-info">
                <div class="patient-info">
                    <div class="info-label">Patient:</div>
                    <div class="info-value">${patient.name}</div>
                    <div class="info-label">Age/Gender:</div>
                    <div class="info-value">${patient.age} yrs / ${patient.gender}</div>
                    <div class="info-label">Date:</div>
                    <div class="info-value">${new Date().toLocaleDateString()}</div>
                </div>
                <div class="doctor-info">
                    <div class="info-label">Doctor:</div>
                    <div class="info-value">${doctor.name}</div>
                    <div class="info-label">Department:</div>
                    <div class="info-value">${hospital.department}</div>
                </div>
            </div>
    `;

    // Add diagnosis
    if (prescription.diagnosis && prescription.diagnosis.length > 0) {
        html += `
            <div class="section">
                <div class="section-title">Diagnosis</div>
        `;
        prescription.diagnosis.forEach(diag => {
            html += `<div class="diagnosis-item">${diag}</div>`;
        });
        html += `</div>`;
    }

    // Add medications
    if (prescription.medicines && prescription.medicines.length > 0) {
        html += `
            <div class="section">
                <div class="section-title">Medications</div>
        `;
        prescription.medicines.forEach(med => {
            html += `
                <div class="medication-item">
                    <div class="medication-name">${med.name}</div>
                    <div class="medication-details">Dose: ${med.dose}</div>
                    <div class="medication-details">Frequency: ${med.frequency}</div>
                    <div class="medication-details">Instruction: ${med.instruction}</div>
                    <div class="timing-badges">
                        ${med.timing.morning ? '<span class="timing-badge">Morning</span>' : ''}
                        ${med.timing.noon ? '<span class="timing-badge">Noon</span>' : ''}
                        ${med.timing.night ? '<span class="timing-badge">Night</span>' : ''}
                        ${med.timing.bedtime ? '<span class="timing-badge">Bedtime</span>' : ''}
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    }

    html += `
            <div class="footer">
                <p>This is a computer-generated prescription.</p>
                <p>Generated on ${new Date().toLocaleString()}</p>
            </div>
        </div>
    `;

    document.getElementById('prescription-content').innerHTML = html;
}

// Sample data for testing
const samplePrescriptionData = {
    hospital: {
        name: "City Care Hospital",
        tagline: "Your Health, Our Priority",
        address: "#123, Hospital Road, City Center - 560001",
        department: "INTERNAL MEDICINE"
    },
    patient: {
        name: "John Doe",
        age: 45,
        gender: "Male"
    },
    doctor: {
        name: "Dr. Sarah Smith",
        department: "Internal Medicine"
    },
    prescription: {
        diagnosis: ["Hypertension", "Type 2 Diabetes"],
        medicines: [
            {
                name: "AMOXICILLIN 500MG",
                dose: "500mg",
                frequency: "Twice daily",
                instruction: "After food",
                timing: { morning: true, night: true, noon: false, bedtime: false }
            }
        ]
    }
};
EOF

# Create the HTML file
echo "Creating prescription-template.html..."
docker exec $CONTAINER_ID tee /app/prescription_template_dev/prescription-template.html > /dev/null << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Medical Prescription</title>
    <link rel="stylesheet" href="prescription-template.css" />
</head>
<body>
    <div id="prescription-content"></div>
    <script src="prescription-template.js"></script>
    <script>
        // Demo binding - will be replaced by actual data
        renderPrescription(window.prescriptionData || samplePrescriptionData);
    </script>
</body>
</html>
EOF

# Verify files were created
echo "Verifying template files..."
docker exec $CONTAINER_ID ls -la /app/prescription_template_dev/

echo ""
echo "✅ Prescription templates created successfully!"
echo ""
echo "📋 Files created:"
echo "  - /app/prescription_template_dev/prescription-template.html"
echo "  - /app/prescription_template_dev/prescription-template.css"
echo "  - /app/prescription_template_dev/prescription-template.js"
echo ""
echo "🔄 Container will need to be restarted to pick up changes:"
echo "  docker restart $CONTAINER_ID"
echo ""
echo "🧪 Test the fix:"
echo "  curl -X POST https://doctor-dashboard.yavar.ai/api/prescriptions/generate \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"documentId\":\"voice-live-live-1780483830844-c45144be\",\"format\":\"html\"}'"
echo ""
echo "Expected: Prescription data instead of ENOENT error"

read -p "Restart container now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Restarting container..."
    docker restart $CONTAINER_ID
    echo "✅ Container restarted. Wait 30 seconds for the server to start, then test."
else
    echo "⚠️  Remember to restart the container manually: docker restart $CONTAINER_ID"
fi