#!/bin/bash
# Deploy CORRECT prescription templates to match the medical format
# Run this on the doctordashboard VM

echo "🔧 Deploying CORRECT prescription templates..."

CONTAINER_ID=$(docker ps | grep -E "node|app" | awk '{print $1}' | head -1)
echo "Using container: $CONTAINER_ID"

# Create the full CSS template
cat > /tmp/prescription-template.css << 'EOF'
:root{--blue:#184dce;--blue-dark:#0f2f91;--line:#6d85e8;--text:#1f2937;--muted:#6b7280;--paper:#ffffff;--light-blue:#eef4ff;--grid:#9aa9d6}
*{box-sizing:border-box}
body{margin:0;background:#e5e7eb;color:var(--text);font-family:Arial,Helvetica,sans-serif}
.prescription-book{width:210mm;margin:16px auto}
.page{width:210mm;min-height:297mm;background:var(--paper);margin:0 auto 18px;padding:12mm 10mm 8mm;position:relative;border:1px solid #cbd5e1;box-shadow:0 8px 24px rgba(15,23,42,0.16);overflow:hidden}
.hospital-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid var(--blue);padding-bottom:8px;margin-bottom:8px}
.brand-block{display:flex;align-items:center;gap:10px}
.brand-icon{width:34px;height:34px;border-radius:8px;background:#e43826;color:#fff;font-size:22px;display:grid;place-items:center;font-weight:700}
.brand-name{font-size:28px;font-weight:700;color:#1d4ed8;line-height:1}
.brand-tagline{color:var(--blue);font-weight:700;font-size:10px;text-align:right}
.document-title{color:#4b5563;font-weight:700;font-style:italic;text-align:right;font-size:14px;line-height:1.2;padding-top:4px}
.document-title small{display:block;font-size:12px;font-weight:500}
.section-line{border-bottom:2px solid var(--line);padding-bottom:5px;margin-bottom:5px}
.patient-grid{display:grid;grid-template-columns:1.35fr 0.95fr 1fr;gap:5px 14px;font-size:11px}
.vitals-grid{display:grid;grid-template-columns:1fr 1fr 1.35fr 1fr 1fr 1fr;gap:6px 10px;font-size:11px;align-items:center}
.field-row{display:flex;gap:4px;min-height:16px;align-items:baseline}
.field-row.wide{grid-column:span 2}
.field-row label{font-weight:700;color:#4b5563;white-space:nowrap}
.field-row label::after{content:":"}
.field-row span,.line-field span,[data-field]{min-height:14px;flex:1;display:inline-block;white-space:pre-wrap}
.known-condition{grid-column:1/span 4}
.checkbox-line,.checkbox-grid label{display:flex;align-items:center;gap:5px;white-space:nowrap}
input[type="checkbox"]{appearance:none;width:13px;height:13px;border:2px solid #9ca3af;background:white;display:inline-block;position:relative;print-color-adjust:exact;-webkit-print-color-adjust:exact}
input[type="checkbox"]:checked::after{content:"✓";position:absolute;top:-7px;left:0;font-size:18px;color:#172554;font-weight:800}
.notes-box{height:172mm;border:1.5px solid var(--grid);margin-top:4px;display:flex;flex-direction:column}
.box-title{font-weight:700;font-size:11px;padding:4px 5px;border-bottom:1px solid #c7d2fe}
.doctor-notes{flex:1;padding:12px 18px;font-size:15px;line-height:1.55}
.procedure-strip,.checkbox-section{margin-top:6px;border:1.5px solid var(--line)}
.strip-title{background:var(--blue);color:white;text-align:center;font-weight:700;font-size:11px;padding:3px 0;letter-spacing:0.2px}
.checkbox-grid{display:grid;font-size:9.5px;gap:7px 12px;padding:8px}
.procedure-grid{grid-template-columns:repeat(8,1fr)}
.wide-check{grid-column:span 2}
.lab-grid{grid-template-columns:repeat(7,1fr)}
.radiology-grid{grid-template-columns:repeat(5,1fr)}
.other-box{height:18mm;border-top:1.5px solid var(--line);color:#9ca3af;display:grid;place-items:center;font-size:11px;padding:4px}
.other-box:not(:empty){color:var(--text);place-items:start;font-size:12px}
.nuclear-box{border:1.5px solid var(--grid);height:18mm;margin-top:6px;text-align:center;padding-top:5px;font-weight:700;color:#6b7280;font-size:11px}
.admission-procedure-grid{display:grid;grid-template-columns:1.45fr 1fr;gap:4mm;margin-top:6px}
.admission-box,.procedure-box{min-height:34mm;border:1.5px solid var(--line);padding:6px;font-size:11px}
.small-title{text-align:center;font-weight:700;color:#6b7280;margin-bottom:7px}
.line-field{min-height:19px;border-bottom:1px solid #d1d5db;margin-bottom:4px}
.prescription-section{margin-top:6px}
.prescription-title{text-align:center;font-weight:700;color:#4b5563;font-size:11px;border-top:1.5px solid var(--grid);border-left:1.5px solid var(--grid);border-right:1.5px solid var(--grid);padding:3px}
.medicine-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10.5px}
.medicine-table th,.medicine-table td{border:1.2px solid #7c8b8e;height:9.2mm;padding:3px 4px;vertical-align:middle}
.medicine-table th{font-size:9px;text-align:center;color:#4b5563;font-weight:700}
.medicine-table th:nth-child(1){width:8%}
.medicine-table th:nth-child(2){width:29%}
.medicine-table th:nth-child(3){width:10%}
.medicine-table th:nth-child(4),.medicine-table th:nth-child(5),.medicine-table th:nth-child(6){width:8%}
.medicine-table th:nth-child(7){width:10%}
.medicine-table th:nth-child(8){width:19%}
.medicine-table td.center{text-align:center}
.cross-reference{border:1.5px solid var(--grid);height:11mm;margin-top:3px;padding:6px;font-size:11px;font-weight:700;color:#6b7280}
.cross-reference span{font-weight:400;color:var(--text)}
.signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:45mm;margin-top:7px}
.next-visit-box,.signature-box{height:19mm;border:1.5px solid var(--grid);padding:5px;font-size:11px}
.signature-box{text-align:center;color:#9ca3af;display:flex;flex-direction:column;justify-content:flex-end}
.signature-line{min-height:20px;color:var(--text);font-family:"Brush Script MT",cursive;font-size:18px}
.footer{position:absolute;left:10mm;right:10mm;bottom:5mm;border-top:2px solid var(--blue);color:#2563eb;font-size:9px;display:flex;justify-content:space-between;padding-top:2px}
.empty-placeholder::before{content:attr(data-placeholder);color:#c7c7c7}
@page{size:A4;margin:0}
@media print{body{background:white}.prescription-book{margin:0;width:auto}.page{margin:0;border:none;box-shadow:none;page-break-after:always}}
EOF

docker cp /tmp/prescription-template.css $CONTAINER_ID:/app/prescription_template_dev/prescription-template.css

# Create the full JS template
cat > /tmp/prescription-template.js << 'EOF'
function getByPath(obj,path){return path.split('.').reduce((acc,key)=>{if(acc&&Object.prototype.hasOwnProperty.call(acc,key))return acc[key];return undefined},obj)}
function setText(el,value){const placeholder=el.getAttribute('data-placeholder');if(value===undefined||value===null||value===''){el.textContent='';if(placeholder)el.classList.add('empty-placeholder');return}el.classList.remove('empty-placeholder');el.textContent=Array.isArray(value)?value.join('\\n'):String(value)}
function bindTextFields(root,data){root.querySelectorAll('[data-field]').forEach((el)=>{const path=el.getAttribute('data-field');const value=getByPath(data,path);setText(el,value)})}
function bindCheckboxes(root,data){root.querySelectorAll('input[type="checkbox"][data-check]').forEach((el)=>{const path=el.getAttribute('data-check');el.checked=getByPath(data,path)===true})}
function medicineTiming(value){if(value===true||value===1||value==='1'||value==='yes'||value==='Y')return'✓';if(value===false||value===0||value==='0'||value==='no'||value==='N')return'×';return value||''}
function renderMedicineRows(root,data){const tbody=root.querySelector('tbody[data-repeat="prescription.medicines"]');if(!tbody)return;const medicines=getByPath(data,'prescription.medicines')||[];const minRows=Number(tbody.getAttribute('data-min-rows')||8);const rowCount=Math.max(minRows,medicines.length);tbody.innerHTML='';for(let i=0;i<rowCount;i+=1){const med=medicines[i]||{};const tr=document.createElement('tr');tr.innerHTML=`<td class="center">${med.srNo||(med.name?i+1:'')}</td><td>${med.name||''}</td><td class="center">${med.dose||''}</td><td class="center">${medicineTiming(med.morning)}</td><td class="center">${medicineTiming(med.noon)}</td><td class="center">${medicineTiming(med.night)}</td><td class="center">${med.days||''}</td><td>${med.remarks||''}</td>`;tbody.appendChild(tr)}}
function renderPrescription(data,rootSelector='#prescription-root'){const root=document.querySelector(rootSelector);if(!root)throw new Error(`Prescription root not found: ${rootSelector}`);bindTextFields(root,data||{});bindCheckboxes(root,data||{});renderMedicineRows(root,data||{})}
const samplePrescriptionData={hospital:{name:'City Care Hospital',tagline:'Your Health, Our Priority',department:'INTERNAL MEDICINE',branch:'Main Branch',address:'#123, Hospital Road, City Center'},patient:{name:'John Doe',ageSex:'42 Yrs / Male',hospitalNo:'H00012345',mobile:'9999999999',email:'john.doe@email.com'},visit:{episodeNo:'OP00000001',dateTime:'2026-06-05 10:30'},consultant:{name:'Dr. Sarah Smith',regNo:'REG 000000',department:'Internal Medicine'},vitals:{height:'172 cm',bp:'120/80',weight:'70 kg'},clinical:{allergies:'No known drug allergy',diet:'Normal',vulnerable:false,knownHealthConditions:'Diabetes mellitus'},doctorNotes:{freeText:'Chief complaints:\\n- Fever for 3 days\\n- Body ache and headache\\n\\nClinical impression:\\nViral febrile illness. Hydration advised.'},procedures:{ecg:false,eeg:false,holter:false,ncv:false,tmt:false,echo:false,enmg:false,cag:false,physiotherapy:false},labs:{cbc:true,glucoseRandom:false,srCreat:false,denguePanel:true,thyroidProfile:false,dDimer:false,sgpt:false,esr:true,bun:false,electrolytes:false,mp1Random:false,lipidProfile:false,ana:false,urineRoutine:false,hba1c:false,vitB12:false,sWidal:false,lft:false,ferritin:false,sgot:false,other:''},radiology:{xrayChestPa:false,xrayLsSpine:false,usgAbdPelvis:false,mriLimited:false,mriOneRegion:false,xrayKneeBilateral:false,dopplerBothLegsVenous:false,mriBrain:false,mriContrast:false,mriSpinePlus:false,mammogram:false,ctAbdPelvis:false,ctThoraxHrct:false,petCt:false,other:''},admission:{admissionDate:'',dayCareProcedure:false,procedureDate:'',details:'',procedureNotes:''},prescription:{medicines:[{srNo:1,name:'TAB PARACETAMOL',dose:'650 mg',morning:false,noon:false,night:true,days:'3',remarks:'After food, for fever/body ache'},{srNo:2,name:'CAP PANTOPRAZOLE',dose:'40 mg',morning:true,noon:false,night:false,days:'3',remarks:'Before food'}]},crossReference:'',nextVisitDate:'After 3 days if symptoms persist',doctor:{signatureText:'Dr. Sarah Smith'}};
window.renderPrescription=renderPrescription;window.samplePrescriptionData=samplePrescriptionData;
EOF

docker cp /tmp/prescription-template.js $CONTAINER_ID:/app/prescription_template_dev/prescription-template.js

# Create the full HTML template
cat > /tmp/prescription-template.html << 'EOF'
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Prescription</title><link rel="stylesheet" href="prescription-template.css"/></head><body><main id="prescription-root" class="prescription-book"><section class="page page-1" data-page="1"><header class="hospital-header"><div class="brand-block"><div class="brand-icon">✚</div><div><div class="brand-name" data-field="hospital.name">Your Hospital</div><div class="brand-tagline" data-field="hospital.tagline">Care • Safety • Trust</div></div></div><div class="document-title"><div>OUT PATIENT RECORD</div><small data-field="hospital.department">INTERNAL MEDICINE</small></div></header><section class="patient-grid section-line"><div class="field-row"><label>Patient Name</label><span data-field="patient.name"></span></div><div class="field-row"><label>Age/Sex</label><span data-field="patient.ageSex"></span></div><div class="field-row"><label>Episode No.</label><span data-field="visit.episodeNo"></span></div><div class="field-row"><label>Hospital No.</label><span data-field="patient.hospitalNo"></span></div><div class="field-row"><label>Date</label><span data-field="visit.dateTime"></span></div><div class="field-row"><label>Patient Mob. No.</label><span data-field="patient.mobile"></span></div><div class="field-row wide"><label>Consultant Name</label><span data-field="consultant.name"></span></div><div class="field-row"><label>E-mail ID</label><span data-field="patient.email"></span></div><div class="field-row"><label>KMC Reg No.</label><span data-field="consultant.regNo"></span></div><div class="field-row"><label>Dept</label><span data-field="consultant.department"></span></div></section><section class="vitals-grid section-line"><div class="field-row"><label>Height</label><span data-field="vitals.height"></span></div><div class="field-row"><label>BP</label><span data-field="vitals.bp"></span></div><div class="field-row"><label>Allergies</label><span data-field="clinical.allergies"></span></div><div class="field-row"><label>Diet</label><span data-field="clinical.diet"></span></div><div class="field-row"><label>Weight</label><span data-field="vitals.weight"></span></div><label class="checkbox-line"><input type="checkbox" data-check="clinical.vulnerable"/> Vulnerable</label><div class="field-row known-condition"><label>Any Known Health conditions</label><span data-field="clinical.knownHealthConditions"></span></div></section><section class="notes-box"><div class="box-title">Doctor's Notes:</div><div class="doctor-notes" data-field="doctorNotes.freeText" data-format="multiline"></div></section><section class="procedure-strip"><div class="strip-title">PROCEDURE</div><div class="checkbox-grid procedure-grid"><label><input type="checkbox" data-check="procedures.ecg"/> ECG</label><label><input type="checkbox" data-check="procedures.eeg"/> EEG</label><label><input type="checkbox" data-check="procedures.holter"/> Holter</label><label><input type="checkbox" data-check="procedures.ncv"/> NCV</label><label><input type="checkbox" data-check="procedures.tmt"/> TMT</label><label><input type="checkbox" data-check="procedures.echo"/> Echo</label><label><input type="checkbox" data-check="procedures.enmg"/> ENMG</label><label><input type="checkbox" data-check="procedures.cag"/> CAG</label><label class="wide-check"><input type="checkbox" data-check="procedures.physiotherapy"/> Physiotherapy</label></div></section><footer class="footer"><div><strong data-field="hospital.branch">Hospital Branch</strong><br/><span data-field="hospital.address"></span></div><div>Page 1 of 2</div></footer></section><section class="page page-2" data-page="2"><section class="checkbox-section lab-section"><div class="strip-title">LAB INVESTIGATIONS ADVISED</div><div class="checkbox-grid lab-grid"><label><input type="checkbox" data-check="labs.cbc"/> CBC</label><label><input type="checkbox" data-check="labs.glucoseRandom"/> Glucose Random</label><label><input type="checkbox" data-check="labs.srCreat"/> Sr. Creat.</label><label><input type="checkbox" data-check="labs.denguePanel"/> Dengue Panel</label><label><input type="checkbox" data-check="labs.thyroidProfile"/> Thyroid Profile</label><label><input type="checkbox" data-check="labs.dDimer"/> D-Dimer</label><label><input type="checkbox" data-check="labs.sgpt"/> SGPT</label><label><input type="checkbox" data-check="labs.esr"/> ESR</label><label><input type="checkbox" data-check="labs.bun"/> BUN</label><label><input type="checkbox" data-check="labs.electrolytes"/> Electrolytes</label><label><input type="checkbox" data-check="labs.lipidProfile"/> Lipid Profile</label><label><input type="checkbox" data-check="labs.urineRoutine"/> Urine Routine</label><label><input type="checkbox" data-check="labs.hba1c"/> HBA1C</label><label><input type="checkbox" data-check="labs.lft"/> LFT</label></div><div class="other-box" data-field="labs.other" data-placeholder="Other Lab Investigations"></div></section><section class="checkbox-section radiology-section"><div class="strip-title">RADIOLOGY TESTS ADVISED</div><div class="checkbox-grid radiology-grid"><label><input type="checkbox" data-check="radiology.xrayChestPa"/> X-Ray Chest PA</label><label><input type="checkbox" data-check="radiology.usgAbdPelvis"/> USG Abd & Pelvis</label><label><input type="checkbox" data-check="radiology.mriBrain"/> MRI Brain</label><label><input type="checkbox" data-check="radiology.ctThoraxHrct"/> CT Thorax (HRCT)</label></div><div class="other-box" data-field="radiology.other" data-placeholder="Other Radiology Investigations"></div></section><section class="nuclear-box">Nuclear Medicine</section><section class="admission-procedure-grid"><div class="admission-box"><div class="small-title">Admission / Surgery / Day Care Procedure</div><div class="line-field">Admission Date: <span data-field="admission.admissionDate"></span> <label><input type="checkbox" data-check="admission.dayCareProcedure"/> Day Care Procedure</label></div><div class="line-field">Surgery / Day Care Procedure Date: <span data-field="admission.procedureDate"></span></div><div class="line-field">Details: <span data-field="admission.details"></span></div></div><div class="procedure-box"><div class="small-title">Procedure</div><div data-field="admission.procedureNotes" data-format="multiline"></div></div></section><section class="prescription-section"><div class="prescription-title">PRESCRIPTION (WRITE IN CAPITAL LETTERS)</div><table class="medicine-table"><thead><tr><th>Sr. No.</th><th>Name of Medicine</th><th>Dose</th><th>Morning</th><th>Noon</th><th>Night</th><th>No. of Days</th><th>Remarks</th></tr></thead><tbody data-repeat="prescription.medicines" data-min-rows="8"></tbody></table></section><section class="cross-reference">Cross Reference: <span data-field="crossReference"></span></section><section class="signature-grid"><div class="next-visit-box"><div class="small-title">Next Visit Date</div><div data-field="nextVisitDate"></div></div><div class="signature-box"><div class="signature-line" data-field="doctor.signatureText"></div><div>Doctor's Signature</div></div></section><footer class="footer"><div><strong data-field="hospital.branch">Hospital Branch</strong><br/><span data-field="hospital.address"></span></div><div>Page 2 of 2</div></footer></section></main><script src="prescription-template.js"></script><script>renderPrescription(window.prescriptionData||samplePrescriptionData);</script></body></html>
EOF

docker cp /tmp/prescription-template.html $CONTAINER_ID:/app/prescription_template_dev/prescription-template.html

echo "✅ CORRECT prescription templates deployed:"
docker exec $CONTAINER_ID ls -la /app/prescription_template_dev/

echo "🔄 Restarting container..."
docker restart $CONTAINER_ID

echo "⏳ Waiting 30 seconds for server..."
sleep 30

echo "🧪 Testing with correct format..."
docker exec $CONTAINER_ID curl -X POST http://localhost:3000/api/prescriptions/generate \
  -H "Content-Type: application/json" \
  -d '{"documentId":"voice-live-live-1780483830844-c45144be","format":"html"}' \
  --max-time 10

echo ""
echo "✅ CORRECT prescription format deployed!"
echo "This matches the full medical prescription template with:"
echo "- 2-page format (Patient info + Prescriptions)"
echo "- Proper medical fields and layout"
echo "- Correct prescription table format"