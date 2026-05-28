#!/usr/bin/env node
/**
 * PRESCRIPTION GENERATION POC - WITHOUT TEMPLATE
 *
 * Fetches processed prescription data from documents.json
 * and generates a prescription directly without using HTML templates.
 */

const fs = require("fs");
const path = require("path");

const DOCS_FILE = path.join(__dirname, "..", "server", "storage", "documents.json");
const OUTPUT_DIR = path.join(__dirname, "..", "server", "storage", "prescriptions");

/**
 * Generate a clean prescription text without template
 */
function generatePrescriptionText(data) {
  const extracted = data.extracted_data.merged || data.extracted_data;
  const meta = data.meta || {};
  const dashboardCards = data.dashboard_cards || {};

  const lines = [];
  lines.push("=".repeat(70));
  lines.push("PRESCRIPTION".padStart(43));
  lines.push("=".repeat(70));
  lines.push("");

  // Hospital Info
  const hospital = extracted.hospital || {};
  lines.push(hospital.name?.toUpperCase() || "MANIPAL HOSPITALS");
  lines.push(hospital.address || "");
  lines.push(`Department: ${hospital.department || extracted.department || "UROLOGY MHB"}`);
  lines.push("");

  // Patient Info
  const patient = extracted.patient || {};
  lines.push("-".repeat(70));
  lines.push("PATIENT INFORMATION");
  lines.push("-".repeat(70));
  lines.push(`Name:        ${patient.name || "N/A"}`);
  lines.push(`Age/Sex:     ${patient.age || extracted.age_sex || "N/A"} / ${patient.gender || extracted.gender || "N/A"}`);
  lines.push(`Hospital No: ${patient.hospital_no || patient.mrn || "N/A"}`);
  lines.push(`Episode No:  ${patient.episode_number || extracted.episode_no || "N/A"}`);
  lines.push("");

  // Visit Info
  const visit = extracted.visit || {};
  lines.push("-".repeat(70));
  lines.push("VISIT DETAILS");
  lines.push("-".repeat(70));
  lines.push(`Date:        ${visit.date || meta.rx_date || new Date().toISOString().split("T")[0]}`);
  lines.push(`Time:        ${visit.time || ""}`);
  lines.push(`Visit Type:  ${visit.visit_type || "OPD"}`);
  lines.push("");

  // Doctor Info
  const doctor = extracted.doctor || {};
  lines.push("-".repeat(70));
  lines.push("CONSULTING DOCTOR");
  lines.push("-".repeat(70));
  lines.push(`Dr. ${doctor.name || "N/A"}`);
  lines.push(`Reg No: ${doctor.registration_number || ""}`);
  lines.push("");

  // Vitals
  const vitals = extracted.vitals || {};
  const hasVitals = vitals.blood_pressure?.systolic || vitals.pulse?.value || vitals.weight?.value;
  if (hasVitals) {
    lines.push("-".repeat(70));
    lines.push("VITAL SIGNS");
    lines.push("-".repeat(70));
    if (vitals.blood_pressure?.systolic) {
      lines.push(`Blood Pressure: ${vitals.blood_pressure.systolic}/${vitals.blood_pressure.diastolic || "N/A"} mmHg`);
    }
    if (vitals.pulse?.value) {
      lines.push(`Pulse:          ${vitals.pulse.value} bpm`);
    }
    if (vitals.weight?.value) {
      lines.push(`Weight:         ${vitals.weight.value} kg`);
    }
    lines.push("");
  }

  // Diagnosis
  const diagnosis = extracted.diagnosis || {};
  const principalDiagnosis = diagnosis.principal || dashboardCards.diagnosis_card?.principal_diagnosis || "";
  const secondaryDiagnoses = diagnosis.secondary || dashboardCards.diagnosis_card?.secondary_diagnoses || [];

  lines.push("-".repeat(70));
  lines.push("DIAGNOSIS");
  lines.push("-".repeat(70));
  lines.push(`Principal Diagnosis: ${principalDiagnosis}`);
  if (secondaryDiagnoses.length > 0) {
    lines.push(`Comorbidities:       ${secondaryDiagnoses.join(", ")}`);
  }
  if (diagnosis.symptoms?.length > 0) {
    lines.push(`Symptoms:            ${diagnosis.symptoms.join(", ")}`);
  }
  lines.push("");

  // Medications
  const medications = extracted.medications || [];
  if (medications.length > 0) {
    lines.push("-".repeat(70));
    lines.push("MEDICINES");
    lines.push("-".repeat(70));
    lines.push(String("Sr.").padEnd(5) + "Medicine".padEnd(30) + "Dose".padEnd(12) + "Frequency".padEnd(15) + "Duration");
    lines.push("-".repeat(70));

    medications.forEach((med, idx) => {
      const sr = (idx + 1).toString() + ".";
      const name = (med.name || med.generic_name || "N/A").substring(0, 28);
      const dose = (med.dosage || med.dose || "As directed").substring(0, 12);
      const freq = (med.frequency || "As directed").substring(0, 15);
      const dur = (med.duration || med.instructions || "-").substring(0, 12);
      lines.push(sr.padEnd(5) + name.padEnd(30) + dose.padEnd(12) + freq.padEnd(15) + dur);

      if (med.instructions) {
        lines.push("     " + "Note: " + med.instructions);
      }
    });
    lines.push("");
  }

  // Lab Investigations
  const labInvestigations = extracted.lab_investigations?.selected_tests || [];
  if (labInvestigations.length > 0) {
    lines.push("-".repeat(70));
    lines.push("LAB INVESTIGATIONS ADVISED");
    lines.push("-".repeat(70));
    labInvestigations.forEach((lab, idx) => {
      lines.push(`${String(idx + 1).padStart(2)}. ${lab.test_name}${lab.is_uncertain ? " (uncertain)" : ""}`);
    });
    lines.push("");
  }

  // Radiology
  const radiology = extracted.radiology_selections?.selected_studies || extracted.radiology || [];
  if (radiology.length > 0) {
    lines.push("-".repeat(70));
    lines.push("RADIOLOGY ADVISED");
    lines.push("-".repeat(70));
    radiology.forEach((study, idx) => {
      const name = study.study_name || study.name || study;
      lines.push(`${String(idx + 1).padStart(2)}. ${name}${study.is_uncertain ? " (uncertain)" : ""}`);
    });
    lines.push("");
  }

  // Procedures
  const procedures = extracted.procedures || [];
  if (procedures.length > 0) {
    lines.push("-".repeat(70));
    lines.push("PROCEDURES ADVISED");
    lines.push("-".repeat(70));
    procedures.forEach((proc, idx) => {
      const name = typeof proc === "string" ? proc : proc.name;
      lines.push(`${String(idx + 1).padStart(2)}. ${name}`);
    });
    lines.push("");
  }

  // Clinical Notes
  const notes = extracted.handwritten_notes || [];
  if (notes.length > 0) {
    lines.push("-".repeat(70));
    lines.push("DOCTOR'S NOTES");
    lines.push("-".repeat(70));
    notes.forEach(note => {
      lines.push(`• ${note.text}${note.is_inferred ? " (inferred)" : ""}`);
    });
    lines.push("");
  }

  // Footer
  lines.push("=".repeat(70));
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push("=".repeat(70));

  return lines.join("\n");
}

/**
 * Generate structured JSON prescription
 */
function generatePrescriptionJSON(data) {
  const extracted = data.extracted_data.merged || data.extracted_data;
  const meta = data.meta || {};
  const dashboardCards = data.dashboard_cards || {};

  const patient = extracted.patient || {};
  const hospital = extracted.hospital || {};
  const doctor = extracted.doctor || {};
  const visit = extracted.visit || {};
  const diagnosis = extracted.diagnosis || {};

  return {
    prescription: {
      header: {
        hospital_name: hospital.name || "MANIPAL HOSPITALS",
        hospital_address: hospital.address || "",
        department: hospital.department || extracted.department || "",
        prescription_date: visit.date || new Date().toISOString().split("T")[0],
        prescription_time: visit.time || "",
        episode_number: patient.episode_number || extracted.episode_no || "",
        visit_type: visit.visit_type || "OPD"
      },
      patient: {
        name: patient.name || "",
        age: patient.age || extracted.age || "",
        gender: patient.gender || extracted.gender || "",
        hospital_number: patient.hospital_no || patient.mrn || "",
        mrn: patient.mrn || "",
        episode_number: patient.episode_number || ""
      },
      doctor: {
        name: doctor.name || "",
        qualifications: doctor.qualifications || [],
        registration_number: doctor.registration_number || "",
        specialty: doctor.specialty || ""
      },
      vitals: {
        blood_pressure: extracted.vitals?.blood_pressure || null,
        pulse: extracted.vitals?.pulse || null,
        temperature: extracted.vitals?.temperature || null,
        weight: extracted.vitals?.weight || null,
        spo2: extracted.vitals?.spo2 || null
      },
      diagnosis: {
        principal: diagnosis.principal || "",
        secondary: diagnosis.secondary || [],
        symptoms: diagnosis.symptoms || []
      },
      medications: (extracted.medications || []).map(med => ({
        name: med.name || med.generic_name || "",
        generic_name: med.generic_name || "",
        dosage: med.dosage || med.dose || "",
        form: med.form || "",
        frequency: med.frequency || "",
        duration: med.duration || "",
        route: med.route || "",
        instructions: med.instructions || "",
        category: med.category || ""
      })),
      investigations: {
        lab_tests: (extracted.lab_investigations?.selected_tests || []).map(t => ({
          test_name: t.test_name,
          category: t.category,
          priority: t.priority,
          is_uncertain: t.is_uncertain || false
        })),
        radiology: (extracted.radiology_selections?.selected_studies || extracted.radiology || []).map(r => ({
          study_name: r.study_name || r.name,
          category: r.category,
          is_uncertain: r.is_uncertain || false
        })),
        procedures: (extracted.procedures || []).map(p => ({
          name: typeof p === "string" ? p : p.name,
          category: typeof p === "string" ? "" : p.category || ""
        }))
      },
      clinical_notes: (extracted.handwritten_notes || []).map(n => ({
        text: n.text,
        category: n.category,
        confidence: n.confidence
      })),
      metadata: {
        generated_at: new Date().toISOString(),
        pipeline: meta.pipeline || "two_stage_prescription",
        document_type: meta.document_type || "prescription",
        has_handwriting: extracted.handwriting_detection?.has_handwriting || false
      }
    }
  };
}

/**
 * Generate HTML prescription without template (minimal HTML)
 */
function generatePrescriptionHTML(data) {
  const extracted = data.extracted_data.merged || data.extracted_data;
  const patient = extracted.patient || {};
  const hospital = extracted.hospital || {};
  const doctor = extracted.doctor || {};
  const diagnosis = extracted.diagnosis || {};
  const medications = extracted.medications || [];
  const labTests = extracted.lab_investigations?.selected_tests || [];
  const radiology = extracted.radiology_selections?.selected_studies || extracted.radiology || [];
  const notes = extracted.handwritten_notes || [];

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prescription - ${patient.name || "Patient"}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 12px; line-height: 1.4; color: #333; }
    .container { max-width: 800px; margin: 20px auto; padding: 20px; background: white; border: 1px solid #ddd; }
    .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
    .hospital-name { font-size: 24px; font-weight: bold; text-transform: uppercase; color: #2c5282; }
    .hospital-address { font-size: 11px; color: #666; }
    .section { margin-bottom: 20px; }
    .section-title { font-weight: bold; background: #f7fafc; padding: 8px 12px; border-left: 4px solid #2c5282; margin-bottom: 10px; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
    .info-grid { display: grid; grid-template-columns: 200px 1fr; gap: 8px; }
    .label { font-weight: 600; color: #4a5568; }
    .value { color: #2d3748; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f7fafc; font-weight: 600; text-transform: uppercase; font-size: 11px; }
    .sr-no { width: 40px; text-align: center; }
    .notes { font-style: italic; color: #718096; font-size: 11px; padding-left: 20px; }
    .footer { border-top: 1px solid #ddd; padding-top: 15px; text-align: center; font-size: 10px; color: #999; }
    .tag { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-right: 5px; }
    .tag-high { background: #c6f6d5; color: #22543d; }
    .tag-medium { background: #feebc8; color: #744210; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="hospital-name">${hospital.name || "MANIPAL HOSPITALS"}</div>
      <div class="hospital-address">${hospital.address || ""}</div>
    </div>

    <div class="section">
      <div class="section-title">Patient Information</div>
      <div class="info-grid">
        <div class="label">Patient Name:</div><div class="value">${patient.name || "N/A"}</div>
        <div class="label">Age/Sex:</div><div class="value">${patient.age || ""} / ${patient.gender || ""}</div>
        <div class="label">Hospital No:</div><div class="value">${patient.hospital_no || patient.mrn || "N/A"}</div>
        <div class="label">Episode No:</div><div class="value">${patient.episode_number || ""}</div>
        <div class="label">Date/Time:</div><div class="value">${extracted.visit?.date || ""} ${extracted.visit?.time || ""}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Consulting Doctor</div>
      <div class="info-grid">
        <div class="label">Doctor:</div><div class="value">${doctor.name || "N/A"}</div>
        <div class="label">Reg No:</div><div class="value">${doctor.registration_number || ""}</div>
      </div>
    </div>
`;

  // Diagnosis
  if (diagnosis.principal || diagnosis.secondary?.length) {
    html += `
    <div class="section">
      <div class="section-title">Diagnosis</div>
      <div class="info-grid">
        <div class="label">Principal:</div><div class="value">${diagnosis.principal || "N/A"}</div>
      </div>`;
    if (diagnosis.secondary?.length) {
      html += `<div class="info-grid" style="margin-top: 8px;"><div class="label">Comorbidities:</div><div class="value">${diagnosis.secondary.join(", ")}</div></div>`;
    }
    html += `</div>`;
  }

  // Medications
  if (medications.length > 0) {
    html += `
    <div class="section">
      <div class="section-title">Medications</div>
      <table>
        <thead><tr><th class="sr-no">#</th><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th></tr></thead>
        <tbody>`;
    medications.forEach((med, idx) => {
      const confidenceClass = med.verification_confidence === 'high' ? 'tag-high' : 'tag-medium';
      html += `
        <tr>
          <td class="sr-no">${idx + 1}</td>
          <td>${(med.name || med.generic_name || "N/A").toUpperCase()}</td>
          <td>${med.dosage || med.dose || "-"}</td>
          <td>${med.frequency || "-"}</td>
          <td>${med.duration || "-"}</td>
        </tr>`;
      if (med.instructions) {
        html += `<tr><td></td><td colspan="4" class="notes">Note: ${med.instructions}</td></tr>`;
      }
    });
    html += `</tbody></table></div>`;
  }

  // Lab Investigations
  if (labTests.length > 0) {
    html += `
    <div class="section">
      <div class="section-title">Lab Investigations Advised</div>
      <table>
        <thead><tr><th class="sr-no">#</th><th>Test Name</th><th>Category</th></tr></thead>
        <tbody>`;
    labTests.forEach((lab, idx) => {
      html += `<tr><td class="sr-no">${idx + 1}</td><td>${lab.test_name}</td><td>${lab.category || ""}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  // Radiology
  if (radiology.length > 0) {
    html += `
    <div class="section">
      <div class="section-title">Radiology Advised</div>
      <table>
        <thead><tr><th class="sr-no">#</th><th>Study</th></tr></thead>
        <tbody>`;
    radiology.forEach((study, idx) => {
      const name = study.study_name || study.name || study;
      html += `<tr><td class="sr-no">${idx + 1}</td><td>${name}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  // Clinical Notes
  if (notes.length > 0) {
    html += `
    <div class="section">
      <div class="section-title">Doctor's Notes</div>
      <ul style="padding-left: 20px;">`;
    notes.forEach(note => {
      html += `<li>${note.text}${note.is_inferred ? ' <span style="color:#999;">(inferred)</span>' : ''}</li>`;
    });
    html += `</ul></div>`;
  }

  html += `
    <div class="footer">
      Generated on ${new Date().toLocaleString()} | From Document: Prescription_03.pdf
    </div>
  </div>
</body>
</html>`;

  return html;
}

/**
 * Main POC function
 */
async function main() {
  const docId = process.argv[2] || "420e2ee0-d0ce-4f35-a387-c25db8b1c6e7"; // Default to Prescription_03
  const format = process.argv[3] || "all"; // text, json, html, or all

  console.log(`\n${"=".repeat(70)}`);
  console.log(`PRESCRIPTION GENERATION POC - WITHOUT TEMPLATE`);
  console.log(`${"=".repeat(70)}\n`);

  // Load documents
  const docs = JSON.parse(fs.readFileSync(DOCS_FILE, "utf8"));
  const document = docs.documents.find(d => d.id === docId);

  if (!document) {
    console.error(`Document not found: ${docId}`);
    console.log("\nAvailable prescription documents:");
    docs.documents
      .filter(d => d.documentType === "prescription" || d.name?.includes("Prescription"))
      .forEach(d => console.log(`  - ${d.name} (${d.id})`));
    process.exit(1);
  }

  console.log(`Document: ${document.name}`);
  console.log(`Status: ${document.status}`);
  console.log(`Department: ${document.department || "N/A"}`);

  const result = document.result;
  const extracted = result.extracted_data;

  console.log("\nData Summary:");
  console.log(`  Patient:   ${extracted.merged?.patient?.name || extracted.stage1?.patient?.name || "N/A"}`);
  console.log(`  Diagnosis: ${extracted.merged?.diagnosis?.principal || extracted.stage3?.diagnosis?.principal || "N/A"}`);
  console.log(`  Medications: ${extracted.merged?.medications?.length || extracted.stage3?.medications?.length || 0}`);
  console.log(`  Lab Tests: ${extracted.merged?.lab_investigations?.selected_tests?.length || extracted.stage3?.lab_investigations?.selected_tests?.length || 0}`);
  console.log(`  Radiology: ${extracted.merged?.radiology_selections?.selected_studies?.length || extracted.stage3?.radiology_selections?.selected_studies?.length || 0}`);

  // Create output directory
  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
  const baseName = document.name.replace(".pdf", "");

  // Generate outputs based on format
  if (format === "all" || format === "text") {
    console.log("\n[1/3] Generating plain text prescription...");
    const textContent = generatePrescriptionText(result);
    const textPath = path.join(OUTPUT_DIR, `${baseName}_prescription.txt`);
    await fs.promises.writeFile(textPath, textContent);
    console.log(`  ✓ Saved: ${textPath}`);
  }

  if (format === "all" || format === "json") {
    console.log("\n[2/3] Generating JSON prescription...");
    const jsonContent = generatePrescriptionJSON(result);
    const jsonPath = path.join(OUTPUT_DIR, `${baseName}_prescription.json`);
    await fs.promises.writeFile(jsonPath, JSON.stringify(jsonContent, null, 2));
    console.log(`  ✓ Saved: ${jsonPath}`);
  }

  if (format === "all" || format === "html") {
    console.log("\n[3/3] Generating HTML prescription...");
    const htmlContent = generatePrescriptionHTML(result);
    const htmlPath = path.join(OUTPUT_DIR, `${baseName}_prescription.html`);
    await fs.promises.writeFile(htmlPath, htmlContent);
    console.log(`  ✓ Saved: ${htmlPath}`);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`POC COMPLETE! Prescription generated without template.`);
  console.log(`${"=".repeat(70)}\n`);
}

main().catch(console.error);
