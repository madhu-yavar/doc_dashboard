#!/usr/bin/env node
/**
 * PRESCRIPTION GENERATION POC
 *
 * Quick proof-of-concept for generating prescriptions from live conversation data.
 *
 * Usage: node scripts/prescription_poc.cjs <sessionId>
 *
 * This script:
 * 1. Reads draft extraction from a live conversation session
 * 2. Maps it to prescription template format
 * 3. Renders the HTML template
 * 4. Generates PDF with Puppeteer
 */

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

// ============================================================
// CONFIGURATION
// ============================================================

const STORAGE_DIR = path.join(__dirname, "..", "server", "storage");
const SESSIONS_FILE = path.join(STORAGE_DIR, "live_conversation_sessions.json");
const TEMPLATE_DIR = path.join(__dirname, "..", "prescription_template_dev");
const OUTPUT_DIR = path.join(__dirname, "..", "server", "storage", "prescriptions");

// Default hospital configuration (will be configurable in production)
const DEFAULT_HOSPITAL = {
  name: "City Care Hospital",
  tagline: "Your Health, Our Priority",
  department: "INTERNAL MEDICINE",
  branch: "Main Branch",
  address: "#123, Hospital Road, City Center - 560001 | Phone: 1800 987 6543"
};

// ============================================================
// DATA MAPPING - DRAFT EXTRACTION → PRESCRIPTION FORMAT
// ============================================================

/**
 * Map draft extraction data to prescription template format
 */
function mapDraftToPrescription(draft, session) {
  const extracted = draft.extractedData || {};

  // Patient info from session or draft
  const patientName = session.linkedPatient || extracted.patient?.name || "";
  const ageMatch = patientName.match(/\((\d+)\s*[yY]ears?\s*\/\s*(M|F|Male|Female)/i);
  const age = ageMatch ? ageMatch[1] : extracted.patient?.age || "";
  const gender = ageMatch ? (ageMatch[2].charAt(0).toUpperCase()) : (extracted.patient?.gender || "");

  // Vitals - extract from symptoms or medications if mentioned
  const vitals = {
    height: extracted.vitals?.height || "",
    bp: extracted.vitals?.bp || extracted.vitals?.bloodPressure || "",
    weight: extracted.vitals?.weight || ""
  };

  // Medications - map to template format
  const medications = (extracted.medications || []).map((med, idx) => {
    // Parse instruction for timing
    const instruction = med.instruction || med.dosage || "";
    const morning = /morning|bd|tid|qid/i.test(instruction);
    const noon = /noon|afternoon|bd|tid|qid/i.test(instruction);
    const night = /night|bed|time|od/i.test(instruction);

    // Extract dose
    const dose = med.name?.match(/(\d+\s*(mg|ml|tablet|capsule|syrup|sachet))/i)?.[1] ||
                 med.dosage || med.dose || "";

    // Extract days
    const daysMatch = instruction.match(/(\d+)\s*days?/i);
    const days = daysMatch ? daysMatch[1] : "";

    return {
      srNo: idx + 1,
      name: med.name?.toUpperCase() || "",
      dose: dose,
      morning: morning,
      noon: noon,
      night: night,
      days: days,
      remarks: instruction.replace(dose, "").trim() || med.instruction || ""
    };
  });

  // Labs - map to checkboxes
  const labKeywords = {
    cbc: ["cbc", "complete blood", "hemogram"],
    glucoseRandom: ["glucose", "blood sugar"],
    denguePanel: ["dengue", "ns1", "dengue panel"],
    esr: ["esr"],
    hba1c: ["hba1c", "glycosylated"],
    lipidProfile: ["lipid", "cholesterol"],
    thyroidProfile: ["thyroid", "tsh", "t3", "t4"],
    urineRoutine: ["urine", "routine"],
    liver: ["lft", "liver", "sgot", "sgpt", "bilirubin"],
    kidney: ["kidney", "creatinine", "bun", "renal"]
  };

  const labs = {};
  const labText = (extracted.labs || []).join(" ").toLowerCase();
  Object.entries(labKeywords).forEach(([key, keywords]) => {
    labs[key] = keywords.some(kw => labText.includes(kw));
  });
  labs.other = (extracted.labs || []).filter(lab =>
    !Object.values(labKeywords).flat().some(kw => lab.toLowerCase().includes(kw))
  ).join(", ");

  // Radiology - map to checkboxes
  const radiologyKeywords = {
    xrayChestPa: ["xray", "chest", "x-ray"],
    usgAbdPelvis: ["usg", "ultrasound", "abdomen", "pelvis"],
    mriBrain: ["mri", "brain"],
    ctThoraxHrct: ["ct", "chest", "hrct"]
  };

  const radiology = {};
  const radioText = (extracted.radiology || []).join(" ").toLowerCase();
  Object.entries(radiologyKeywords).forEach(([key, keywords]) => {
    radiology[key] = keywords.some(kw => radioText.includes(kw));
  });
  radiology.other = (extracted.radiology || []).filter(radio =>
    !Object.values(radiologyKeywords).flat().some(kw => radio.toLowerCase().includes(kw))
  ).join(", ");

  // Procedures - all false for POC
  const procedures = {
    ecg: false, eeg: false, holter: false, ncv: false,
    tmt: false, echo: false, enmg: false, cag: false, physiotherapy: false
  };

  // Build output
  return {
    hospital: DEFAULT_HOSPITAL,

    patient: {
      name: patientName,
      ageSex: `${age} Yrs / ${gender === "M" ? "Male" : gender === "F" ? "Female" : "Other"}`,
      hospitalNo: extracted.patient?.mrn || "",
      mobile: extracted.patient?.mobile || "",
      email: extracted.patient?.email || ""
    },

    visit: {
      episodeNo: `EP${Date.now().toString().slice(-8)}`,
      dateTime: new Date().toISOString().replace("T", " ").slice(0, 16)
    },

    consultant: {
      name: session.createdBy?.username || "Dr. Sample Doctor",
      regNo: "KMC-12345", // TODO: From doctor profile
      department: "Internal Medicine"
    },

    vitals: vitals,

    clinical: {
      allergies: extracted.allergies?.[0] || "No known drug allergy",
      diet: extracted.diet || "Normal",
      vulnerable: false,
      knownHealthConditions: extracted.comorbidities?.join(", ") || ""
    },

    doctorNotes: {
      freeText: formatDoctorNotes(extracted)
    },

    procedures: procedures,
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
      medicines: medications.length > 0 ? medications : generateEmptyMedicationRows(8)
    },

    crossReference: "",
    nextVisitDate: extracted.followUp?.join("; ") || "",
    doctor: {
      signatureText: session.createdBy?.username || "Dr. Sample"
    }
  };
}

/**
 * Format doctor notes from extracted data
 */
function formatDoctorNotes(extracted) {
  const parts = [];

  if (extracted.symptoms?.length) {
    parts.push("Chief complaints:");
    extracted.symptoms.forEach(s => parts.push(`- ${s}`));
  }

  if (extracted.diagnosis) {
    parts.push("\nClinical impression:");
    parts.push(extracted.diagnosis);
  }

  if (extracted.plan?.length) {
    parts.push("\nPlan:");
    extracted.plan.forEach(p => parts.push(`- ${p}`));
  }

  return parts.join("\n") || "Doctor's notes will appear here.";
}

/**
 * Generate empty medication rows for template
 */
function generateEmptyMedicationRows(count) {
  return Array.from({ length: count }, (_, i) => ({
    srNo: "",
    name: "",
    dose: "",
    morning: false,
    noon: false,
    night: false,
    days: "",
    remarks: ""
  }));
}

// ============================================================
// HTML RENDERING
// ============================================================

/**
 * Inject data into the prescription template
 */
async function renderPrescriptionHTML(data) {
  // Read template files
  const templateHTML = fs.readFileSync(path.join(TEMPLATE_DIR, "prescription-template.html"), "utf8");
  const templateCSS = fs.readFileSync(path.join(TEMPLATE_DIR, "prescription-template.css"), "utf8");
  const templateJS = fs.readFileSync(path.join(TEMPLATE_DIR, "prescription-template.js"), "utf8");

  // Create inline version with embedded CSS
  let html = templateHTML.replace('<link rel="stylesheet" href="prescription-template.css" />',
    `<style>${templateCSS}</style>`);

  // Replace the external script with inline JS
  html = html.replace('<script src="prescription-template.js"></script>', `<script>${templateJS}</script>`);

  // Remove the old demo binding script that calls samplePrescriptionData
  html = html.replace(/<script>\s*\/\/ Demo binding[\s\S]*?renderPrescription\(samplePrescriptionData\);\s*<\/script>\s*/g, '');

  // Inline the data as JSON and call renderPrescription
  const dataScript = `
    <script>
      window.prescriptionData = ${JSON.stringify(data, null, 2)};
      renderPrescription(window.prescriptionData);
    </script>
  `;

  // Insert data script before closing body tag
  html = html.replace('</body>', dataScript + '</body>');

  return html;
}

// ============================================================
// PDF GENERATION
// ============================================================

/**
 * Generate PDF from HTML using Puppeteer
 */
async function generatePDF(html, outputPath) {
  console.log(" Launching browser...");

  // Try to find system Chrome/Chromium
  const commonChromePaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium"
  ];

  let executablePath = undefined;
  for (const path of commonChromePaths) {
    try {
      await fs.promises.access(path);
      executablePath = path;
      console.log(`  ✓ Found system Chrome at: ${path}`);
      break;
    } catch {
      // Continue checking
    }
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();

    console.log("  Rendering HTML...");
    await page.setContent(html, { waitUntil: "networkidle0" });

    console.log("  Generating PDF...");
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });

    console.log(`  ✓ PDF saved to: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

// ============================================================
// MAIN POC
// ============================================================

async function main() {
  const sessionId = process.argv[2];

  if (!sessionId) {
    console.error("Usage: node scripts/prescription_poc.cjs <sessionId>");
    console.error("\nAvailable sessions:");
    await listAvailableSessions();
    process.exit(1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`PRESCRIPTION GENERATION POC`);
  console.log(`${"=".repeat(60)}\n`);

  // Ensure output directory exists
  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

  // Step 1: Load session data
  console.log("Step 1: Loading session data...");
  const sessions = JSON.parse(await fs.promises.readFile(SESSIONS_FILE, "utf8")).sessions;
  const session = sessions.find(s => s.id === sessionId);

  if (!session) {
    console.error(`✗ Session not found: ${sessionId}`);
    await listAvailableSessions();
    process.exit(1);
  }

  console.log(`  ✓ Session found: ${session.id}`);
  console.log(`  ✓ Patient: ${session.linkedPatient || "Not specified"}`);
  console.log(`  ✓ Status: ${session.status}`);

  // Step 2: Map draft extraction to prescription format
  console.log("\nStep 2: Mapping draft extraction to prescription format...");
  const prescriptionData = mapDraftToPrescription(session.draftExtraction || {}, session);

  console.log(`  ✓ Patient: ${prescriptionData.patient.name}`);
  console.log(`  ✓ Medications: ${prescriptionData.prescription.medicines.filter(m => m.name).length}`);
  console.log(`  ✓ Labs: ${Object.values(prescriptionData.labs).filter(Boolean).length} selected`);

  // Step 3: Render HTML template
  console.log("\nStep 3: Rendering HTML template...");
  const html = await renderPrescriptionHTML(prescriptionData);
  console.log("  ✓ HTML rendered");

  // Save HTML for preview
  const htmlPath = path.join(OUTPUT_DIR, `prescription_${sessionId}.html`);
  await fs.promises.writeFile(htmlPath, html);
  console.log(`  ✓ HTML saved to: ${htmlPath}`);

  // Step 4: Generate PDF
  console.log("\nStep 4: Generating PDF...");
  const pdfPath = path.join(OUTPUT_DIR, `prescription_${sessionId}.pdf`);
  await generatePDF(html, pdfPath);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`POC COMPLETE!`);
  console.log(`${"=".repeat(60)}`);
  console.log(`\nOutputs:`);
  console.log(`  HTML: ${htmlPath}`);
  console.log(`  PDF:  ${pdfPath}`);
  console.log(`\nOpen the HTML file in a browser to preview, or use the PDF directly.\n`);
}

/**
 * List available sessions
 */
async function listAvailableSessions() {
  try {
    const sessions = JSON.parse(await fs.promises.readFile(SESSIONS_FILE, "utf8")).sessions;

    if (sessions.length === 0) {
      console.log("  No sessions found.");
      return;
    }

    console.log("\n  Available sessions:");
    sessions
      .filter(s => s.draftExtraction?.extractedData)
      .slice(0, 10)
      .forEach(s => {
        const hasMeds = s.draftExtraction?.extractedData?.medications?.length || 0;
        console.log(`    - ${s.id}`);
        console.log(`      Patient: ${s.linkedPatient || "N/A"} | Meds: ${hasMeds} | Status: ${s.status}`);
      });

    if (sessions.length > 10) {
      console.log(`    ... and ${sessions.length - 10} more`);
    }
  } catch (error) {
    console.log("  Could not load sessions.");
  }
}

// Run POC
main().catch(console.error);
