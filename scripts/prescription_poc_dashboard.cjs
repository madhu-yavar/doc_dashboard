#!/usr/bin/env node
/**
 * PRESCRIPTION GENERATION POC - USING DASHBOARD DATA
 *
 * Fetches processed prescription data from documents.json
 * and generates a prescription using our template.
 */

const fs = require("fs");
const path = require("path");

const DOCS_FILE = path.join(__dirname, "..", "server", "storage", "documents.json");
const TEMPLATE_DIR = path.join(__dirname, "..", "prescription_template_dev");
const OUTPUT_DIR = path.join(__dirname, "..", "server", "storage", "prescriptions");

// Default hospital configuration
const DEFAULT_HOSPITAL = {
  name: "City Care Hospital",
  tagline: "Your Health, Our Priority",
  department: "INTERNAL MEDICINE",
  branch: "Main Branch",
  address: "#123, Hospital Road, City Center - 560001 | Phone: 1800 987 6543"
};

/**
 * Map dashboard prescription data to template format
 */
function mapDashboardToPrescription(dashboardData) {
  const extracted = dashboardData.result.extracted_data || {};
  const meta = dashboardData.result.meta || {};
  const dashboardCards = dashboardData.result.dashboard_cards || {};

  // Patient info
  const patient = extracted.patient || {};
  const age = patient.age || "";
  const gender = patient.gender || "";

  // Doctor info
  const doctor = extracted.doctor || {};

  // Diagnosis
  const diagnosis = extracted.diagnosis || {};
  const principalDiagnosis = diagnosis.principal || dashboardCards.diagnosis_card?.principal_diagnosis || "";
  const secondaryDiagnoses = diagnosis.secondary || dashboardCards.diagnosis_card?.secondary_diagnoses || [];

  // Medications - map to template format
  const medsList = extracted.medications || extracted.merged?.medications || dashboardCards.medications_card?.medication_list || [];
  const medications = medsList.map((med, idx) => {
    const name = med.name?.toUpperCase() || "";
    const dose = med.dose || med.dosage || "";
    const frequency = med.frequency?.toLowerCase() || "";
    const instruction = (med.instruction || med.instructions || "").toLowerCase();

    // Parse timing from both frequency and instruction
    const timingText = `${frequency} ${instruction}`;

    // Check for specific timing words
    const hasMorning = /morning/i.test(timingText);
    const hasNoon = /noon|afternoon/i.test(timingText);
    const hasNight = /night|bed|evening|at night|hs/i.test(timingText);

    // Check for frequency abbreviations
    const tds = /\btds\b|tid|3\s*times|thrice/i.test(timingText);  // 3 times daily
    const bd = /\bbd\b|bis.*die|2\s*times|twice/i.test(timingText);  // 2 times daily
    const qid = /\bqid\b|4\s*times|four\s*times/i.test(timingText);  // 4 times daily
    const od = /\bod\b|daily|once.*daily|omne.*die/i.test(timingText); // once daily

    // Determine timing based on frequency
    let morning = hasMorning;
    let noon = hasNoon;
    let night = hasNight;

    if (tds) {
      // 3 times daily = morning + noon + night
      morning = true;
      noon = true;
      night = true;
    } else if (bd) {
      // 2 times daily = morning + night
      morning = true;
      night = true;
    } else if (qid) {
      // 4 times daily = morning + noon + evening + night
      morning = true;
      noon = true;
      night = true;
    } else if (od) {
      // Once daily = morning by default (unless night specified)
      if (!morning && !noon && !night) {
        morning = true;
      }
    }

    // Extract days from instruction
    const daysMatch = instruction.match(/(\d+)\s*days?/i);
    const days = daysMatch ? daysMatch[1] : "";

    return {
      srNo: idx + 1,
      name: name,
      dose: dose,
      morning: morning,
      noon: noon,
      night: night,
      days: days,
      remarks: (med.instruction || med.instructions || frequency).replace(dose, "").trim() || frequency
    };
  }).filter(m => m.name); // Only include medications with names

  // Ensure minimum 8 rows
  while (medications.length < 8) {
    medications.push({
      srNo: "",
      name: "",
      dose: "",
      morning: false,
      noon: false,
      night: false,
      days: "",
      remarks: ""
    });
  }

  // Labs - map to checkboxes
  // Handle both string arrays and object arrays with test_name property
  const labListRaw = extracted.lab_investigations?.selected_tests || extracted.merged?.lab_investigations?.selected_tests || extracted.stage3?.lab_investigations?.selected_tests || [];
  const labList = labListRaw.map(lab => typeof lab === 'string' ? lab : lab.test_name || lab.name || '');

  const labKeywords = {
    cbc: ["cbc", "complete blood", "hemogram", "complete blood count"],
    glucoseRandom: ["glucose random", "blood sugar random", "rbs", "random blood sugar"],
    srCreat: ["s.creat", "creatinine", "serum creatinine", "s. creat"],
    denguePanel: ["dengue", "ns1", "dengue panel"],
    thyroidProfile: ["thyroid", "tsh", "t3", "t4", "thyroid profile"],
    dDimer: ["d-dimer", "d dimer", "d dimer assay"],
    sgpt: ["sgpt", "alt", "sgpt/alt"],
    esr: ["esr", "erythrocyte sedimentation"],
    bun: ["bun", "blood urea", "blood urea nitrogen"],
    electrolytes: ["electrolyte", "sodium", "potassium", "electrolytes"],
    hba1c: ["hba1c", "glycated hemoglobin", "glycosylated hemoglobin", "hba 1c"],
    lipidProfile: ["lipid profile", "cholesterol", "tg", "hdl", "ldl", "triglycerides"],
    urineRoutine: ["urine routine", "urine microscopy", "routine and microscopy", "routine microscopy"],
    lft: ["lft", "liver function", "liver function test"]
  };

  const labs = { other: "" };
  Object.keys(labKeywords).forEach(key => {
    labs[key] = labList.some(lab =>
      labKeywords[key].some(kw => lab.toLowerCase().includes(kw))
    );
  });

  // Find labs that don't match checkboxes
  const otherLabs = labList.filter(lab =>
    !Object.values(labKeywords).flat().some(kw => lab.toLowerCase().includes(kw))
  );
  labs.other = otherLabs.join(", ");

  // Radiology
  // Handle both string arrays and object arrays with study_name property
  const radioListRaw = extracted.merged?.radiology_selections?.selected_studies || extracted.radiology_selections?.selected_studies || extracted.radiology || extracted.stage3?.radiology_selections?.selected_studies || [];
  const radioList = radioListRaw.map(radio => typeof radio === 'string' ? radio : radio.study_name || radio.name || '');

  const radioKeywords = {
    xrayChestPa: ["xray", "chest", "x-ray", "cxr"],
    usgAbdPelvis: ["usg", "ultrasound", "abdomen", "pelvis", "kub"],
    mriBrain: ["mri", "brain"],
    ctThoraxHrct: ["ct", "chest", "hrct"]
  };

  const radiology = { other: "" };
  Object.keys(radioKeywords).forEach(key => {
    radiology[key] = radioList.some(radio =>
      radioKeywords[key].some(kw => radio.toLowerCase().includes(kw))
    );
  });

  const otherRadio = radioList.filter(radio =>
    !Object.values(radioKeywords).flat().some(kw => radio.toLowerCase().includes(kw))
  );
  radiology.other = otherRadio.join(", ");

  // Build doctor notes
  const notesParts = [];
  if (principalDiagnosis) {
    notesParts.push(`Diagnosis: ${principalDiagnosis}`);
  }
  if (secondaryDiagnoses && secondaryDiagnoses.length > 0) {
    notesParts.push(`Comorbidities: ${secondaryDiagnoses.join(", ")}`);
  }

  const doctorNotes = {
    freeText: notesParts.length > 0 ? notesParts.join("\n\n") : "Doctor's notes"
  };

  // Vitals - try to get from dashboard
  const vitalsCard = dashboardCards.vitals_card || {};
  const summary = vitalsCard.summary || {};
  const vitals = {
    height: extracted.vitals?.height || "",
    bp: summary.latest_bp || extracted.vitals?.bp || extracted.vitals?.bloodPressure || "",
    weight: extracted.vitals?.weight || ""
  };

  // Get actual hospital info from document
  const hospitalInfo = extracted.hospital || extracted.stage1?.hospital || {};
  const hospital = {
    name: hospitalInfo.name || DEFAULT_HOSPITAL.name,
    tagline: hospitalInfo.tagline || DEFAULT_HOSPITAL.tagline,
    department: hospitalInfo.department || extracted.department || DEFAULT_HOSPITAL.department,
    branch: hospitalInfo.branch || DEFAULT_HOSPITAL.branch,
    address: hospitalInfo.address || DEFAULT_HOSPITAL.address
  };

  return {
    hospital: hospital,

    patient: {
      name: patient.name || "Patient Name",
      ageSex: `${age} Yrs / ${gender === "Male" ? "Male" : gender === "Female" ? "Female" : gender || ""}`,
      hospitalNo: patient.mrn || patient.hospital_number || "",
      mobile: patient.mobile || "",
      email: patient.email || ""
    },

    visit: {
      episodeNo: meta.episode_number || extracted.patient?.episode_number || extracted.stage1?.patient?.episode_number || "",
      dateTime: meta.rx_date || extracted.visit?.date || new Date().toISOString().split("T")[0] + " 10:00"
    },

    consultant: {
      name: doctor.name || "Doctor Name",
      regNo: doctor.registration_number || doctor.reg_no || "",
      department: hospitalInfo.department || extracted.department || doctor.specialty || "Internal Medicine"
    },

    vitals: vitals,

    clinical: {
      allergies: extracted.allergies?.[0] || "No known drug allergy",
      diet: extracted.diet || "Normal",
      vulnerable: false,
      knownHealthConditions: (secondaryDiagnoses || []).join(", ") || ""
    },

    doctorNotes: doctorNotes,

    procedures: {
      ecg: false, eeg: false, holter: false, ncv: false,
      tmt: false, echo: false, enmg: false, cag: false, physiotherapy: false
    },

    labs: labs,
    radiology: radiology,

    admission: {
      admissionDate: "",
      dayCareProcedure: false,
      procedureDate: "",
      details: "",
      procedureNotes: ""
    },

    prescription: {
      medicines: medications
    },

    crossReference: "",
    nextVisitDate: extracted.follow_up?.[0] || "",
    doctor: {
      signatureText: doctor.name?.split(" ")[0] || "Doctor"
    }
  };
}

/**
 * Render HTML template with data
 */
function renderPrescriptionHTML(data) {
  let html = fs.readFileSync(path.join(TEMPLATE_DIR, "prescription-template.html"), "utf8");
  const css = fs.readFileSync(path.join(TEMPLATE_DIR, "prescription-template.css"), "utf8");
  const js = fs.readFileSync(path.join(TEMPLATE_DIR, "prescription-template.js"), "utf8");

  html = html.replace('<link rel="stylesheet" href="prescription-template.css" />', `<style>${css}</style>`);
  html = html.replace('<script src="prescription-template.js"></script>', `<script>${js}</script>`);
  html = html.replace(/<script>\s*\/\/ Demo binding[\s\S]*?renderPrescription\(samplePrescriptionData\);\s*<\/script>\s*/g, '');

  const dataScript = `<script>
window.prescriptionData = ${JSON.stringify(data, null, 2)};
renderPrescription(window.prescriptionData);
  </script>`;
  html = html.replace('</body>', dataScript + '</body>');

  return html;
}

/**
 * Main POC function
 */
async function main() {
  const docId = process.argv[2] || "420e2ee0-d0ce-4f35-a387-c25db8b1c6e7"; // Default to Prescription_03

  console.log(`\n${"=".repeat(60)}`);
  console.log(`PRESCRIPTION GENERATION POC - USING DASHBOARD DATA`);
  console.log(`${"=".repeat(60)}\n`);

  // Load documents
  const docs = JSON.parse(fs.readFileSync(DOCS_FILE, "utf8"));
  const document = docs.documents.find(d => d.id === docId);

  if (!document) {
    console.error(`Document not found: ${docId}`);
    console.log("\nAvailable prescription documents:");
    docs.documents
      .filter(d => d.documentType === "prescription")
      .forEach(d => console.log(`  - ${d.name} (${d.id})`));
    process.exit(1);
  }

  console.log(`Document: ${document.name}`);
  console.log(`Status: ${document.status}`);
  console.log(`Department: ${document.department || "N/A"}\n`);

  // Map to prescription format
  console.log("Step 1: Mapping dashboard data to prescription format...");
  const prescriptionData = mapDashboardToPrescription(document);

  console.log(`  ✓ Patient: ${prescriptionData.patient.name}`);
  console.log(`  ✓ Age/Sex: ${prescriptionData.patient.ageSex}`);
  console.log(`  ✓ Diagnosis: ${prescriptionData.doctorNotes.freeText.split("\n")[0]}`);
  console.log(`  ✓ Medications: ${prescriptionData.prescription.medicines.filter(m => m.name).length}`);
  console.log(`  ✓ Labs: ${Object.values(prescriptionData.labs).filter(Boolean).length - 1} selected`);

  // Render HTML
  console.log("\nStep 2: Rendering HTML template...");
  const html = renderPrescriptionHTML(prescriptionData);

  // Save HTML
  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, `prescription_${document.name.replace(".pdf", "")}.html`);
  await fs.promises.writeFile(outputPath, html);

  console.log(`  ✓ HTML saved: ${outputPath}`);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`POC COMPLETE!`);
  console.log(`${"=".repeat(60)}`);
  console.log(`\nOpen in browser: file://${outputPath}\n`);
}

main().catch(console.error);
