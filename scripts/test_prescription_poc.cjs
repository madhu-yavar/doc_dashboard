#!/usr/bin/env node
/**
 * PRESCRIPTION GENERATION POC - END-TO-END TEST
 *
 * Simulates the complete flow from voice session to PDF generation
 */

const fs = require("fs/promises");
const path = require("path");

const DOCS_FILE = path.join(__dirname, "..", "server", "storage", "documents.json");
const OUTPUT_DIR = path.join(__dirname, "..", "server", "storage", "prescriptions");

// Mock voice session data (simulates what live voice creates)
const mockVoiceSession = {
  id: "live-poc-test-" + Date.now(),
  linkedPatient: "John Doe",
  encounterLabel: "Fever Consultation",
  createdBy: {
    id: "test-doctor",
    username: "DrTestUser",
    role: "doctor"
  }
};

// Mock voice extraction results
const mockVoiceExtraction = {
  diagnosis: "Viral Fever with body aches",
  symptoms: ["High grade fever", "Body ache", "Headache", "Sore throat"],
  medications: [
    { name: "Paracetamol", instruction: "500mg twice daily for 5 days" },
    { name: "Azithromycin", instruction: "500mg once daily for 3 days" },
    { name: "Cetrizine", instruction: "10mg at night for 5 days" },
    { name: "Dolo 650", instruction: "SOS for fever" }
  ],
  labs: ["CBC", "HbA1c", "Widal", "Typhoid", "Malaria", "Dengue NS1"],
  radiology: ["Chest X-ray PA view"],
  procedures: [],
  follow_up: ["Review after 3 days", "Report if fever persists"],
  plan: ["Bed rest", "Plenty of fluids", "Soft diet", "Monitor temperature"]
};

// Sample doctor edits (simulating what doctor would change in UI)
const doctorEdits = {
  medications: [
    // Doctor changes: Paracetamol - timing to M+A+N, adds days
    { srNo: 1, name: "PARACETAMOL", dose: "500mg", morning: true, noon: true, night: true, days: "5", remarks: "3 times daily" },
    // Doctor keeps Azithromycin as is
    { srNo: 2, name: "AZITHROMYCIN", dose: "500mg", morning: true, noon: false, night: false, days: "3", remarks: "once daily" },
    // Doctor changes: Cetrizine - adds remarks
    { srNo: 3, name: "CETRIZINE", dose: "10mg", morning: false, noon: false, night: true, days: "5", remarks: "at night for allergy" },
    // Doctor removes Dolo (not in edited list)
    { srNo: 4, name: "", dose: "", morning: false, noon: false, night: false, days: "", remarks: "" }
  ],
  labs: {
    cbc: true,
    hba1c: false,        // Doctor unchecks this
    srCreat: false,
    denguePanel: true,   // Voice data had "Dengue NS1"
    glucoseRandom: false,
    thyroidProfile: false,
    urineRoutine: false,
    other: "Widal, Typhoid, Malaria"  // Labs without checkboxes
  },
  radiology: {
    xrayChestPa: true,
    usgAbdPelvis: false,
    mriBrain: false,
    ctThoraxHrct: false,
    other: ""
  },
  doctorNotes: {
    freeText: `Diagnosis: Viral Fever with body aches

Symptoms: High grade fever, Body ache, Headache, Sore throat

Assessment: Patient presenting with acute febrile illness. Vital signs stable.

Advice: Bed rest, Plenty of fluids, Soft diet

Investigations: CBC, Widal, Typhoid, Malaria, Dengue NS1

Follow-up: Review after 3 days, Report if fever persists

Generated from Live Voice Session`
  },
  vitals: {
    bp: "130/85 mmHg",    // Doctor adds this
    weight: "70 kg",       // Doctor adds this
    height: "170 cm"       // Doctor adds this
  },
  nextVisitDate: "2026-05-30"
};

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                     PRESCRIPTION GENERATION POC                              ║
║                    End-to-End Flow Demonstration                           ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

async function runPOC() {
  const { PrescriptionService } = require("../server/prescription_service.cjs");
  const service = new PrescriptionService();
  await service.initialize();

  // ========================================================================
  // STEP 1: Create mock voice document (simulates finalized session)
  // ========================================================================
  console.log(`\n${"=".repeat(80)}`);
  console.log(`STEP 1: Creating Mock Voice Document`);
  console.log(`${"=".repeat(80)}`);

  const documentId = `voice-live-${mockVoiceSession.id}`;
  const now = new Date().toISOString();

  const mockDocument = {
    id: documentId,
    type: "voice",
    documentType: "voice",
    status: "processed",
    uploadedAt: now,
    processedAt: now,
    fileName: `${mockVoiceSession.linkedPatient} - ${mockVoiceSession.encounterLabel}`,
    fileType: "audio/webm",
    result: {
      meta: {
        sessionType: "live_conversation",
        sessionId: mockVoiceSession.id,
        patientName: mockVoiceSession.linkedPatient,
        encounterLabel: mockVoiceSession.encounterLabel
      },
      extracted_data: {
        patient_info: {
          name: mockVoiceSession.linkedPatient
        },
        diagnosis: mockVoiceExtraction.diagnosis,
        symptoms: mockVoiceExtraction.symptoms,
        medications: mockVoiceExtraction.medications,
        labs: mockVoiceExtraction.labs,
        radiology: mockVoiceExtraction.radiology,
        follow_up: mockVoiceExtraction.follow_up,
        plan: mockVoiceExtraction.plan
      },
      transcript: {
        normalizedText: "Patient has fever for 2 days, body ache, headache..."
      }
    },
    createdBy: mockVoiceSession.createdBy
  };

  // Save mock document to documents.json so the service can find it
  try {
    const docsContent = await fs.readFile(DOCS_FILE, "utf8");
    const docs = JSON.parse(docsContent);

    // Check if document already exists
    const existingIndex = docs.documents.findIndex(d => d.id === documentId);
    if (existingIndex >= 0) {
      docs.documents[existingIndex] = mockDocument;
    } else {
      docs.documents.unshift(mockDocument);
    }

    await fs.writeFile(DOCS_FILE, JSON.stringify(docs, null, 2));
    console.log(`  ✓ Document saved to documents.json`);
  } catch (error) {
    console.log(`  ⚠ Could not save document: ${error.message}`);
    console.log(`  Continuing with in-memory mock...`);
  }

  console.log(`  ✓ Document ID: ${documentId}`);
  console.log(`  ✓ Patient: ${mockVoiceSession.linkedPatient}`);
  console.log(`  ✓ Diagnosis: ${mockVoiceExtraction.diagnosis}`);
  console.log(`  ✓ Medications extracted: ${mockVoiceExtraction.medications.length}`);
  console.log(`  ✓ Labs extracted: ${mockVoiceExtraction.labs.length}`);

  // ========================================================================
  // STEP 2: Fetch prescription data (simulates API call)
  // ========================================================================
  console.log(`\n${"=".repeat(80)}`);
  console.log(`STEP 2: Fetch Prescription Data (Simulated API Call)`);
  console.log(`${"=".repeat(80)}`);
  console.log(`  GET /api/prescriptions/data/${documentId}`);

  const prescriptionData = service.mapVoiceToPrescription(mockDocument);

  console.log(`  ✓ Hospital: ${prescriptionData.hospital.name}`);
  console.log(`  ✓ Patient: ${prescriptionData.patient.name}`);
  console.log(`  ✓ Medications parsed: ${prescriptionData.prescription.medicines.filter(m => m.name).length}`);

  console.log(`\n  Original Medications (from voice):`);
  prescriptionData.prescription.medicines.filter(m => m.name).forEach(med => {
    const timing = `${med.morning ? 'M ' : ''}${med.noon ? 'A ' : ''}${med.night ? 'N' : ''}`;
    console.log(`    ${med.srNo}. ${med.name} ${med.dose} - [${timing}] - "${med.remarks}"`);
  });

  // ========================================================================
  // STEP 3: Display Review UI (simulates frontend review page)
  // ========================================================================
  console.log(`\n${"=".repeat(80)}`);
  console.log(`STEP 3: Doctor Reviews Data (Read-Only Mode)`);
  console.log(`${"=".repeat(80)}`);
  console.log(`  URL: /prescription/${documentId}`);
  console.log(`  ├─ Medications Tab: ${prescriptionData.prescription.medicines.filter(m => m.name).length} medications`);
  console.log(`  ├─ Labs Tab: ${Object.values(prescriptionData.labs).filter(Boolean).length - 1} checked`);
  console.log(`  ├─ Radiology Tab: ${Object.values(prescriptionData.radiology).filter(Boolean).length - 1} checked`);
  console.log(`  └─ Notes Tab: Diagnosis & notes available`);

  console.log(`\n  Doctor reviews: ✓ Medications correct`);
  console.log(`                   ✓ Labs mostly correct`);
  console.log(`                   ✓ Wants to edit timing and add vitals`);
  console.log(`                   → Clicks [Edit] button`);

  // ========================================================================
  // STEP 4: Doctor Makes Edits (simulates edit mode)
  // ========================================================================
  console.log(`\n${"=".repeat(80)}`);
  console.log(`STEP 4: Doctor Makes Edits (Edit Mode)`);
  console.log(`${"=".repeat(80)}`);

  console.log(`  Original → Doctor's Edit:`);
  console.log(`  ┌─────────────────────────────────────────────────────────────────┐`);
  console.log(`  │ Paracetamol 500mg  M N    →  M A N   (changed timing)            │`);
  console.log(`  │ Paracetamol remarks → "3 times daily" (updated)              │`);
  console.log(`  │ HbA1c checked       →  unchecked (removed)                  │`);
  console.log(`  │ Vitals: BP 130/85, Weight 70kg (added)                      │`);
  console.log(`  │ Doctor's notes: Expanded with full assessment              │`);
  console.log(`  └─────────────────────────────────────────────────────────────────┘`);

  // Apply doctor edits
  let editedData = { ...prescriptionData };
  editedData.prescription.medicines = doctorEdits.medications;
  editedData.labs = doctorEdits.labs;
  editedData.radiology = doctorEdits.radiology;
  editedData.doctorNotes = doctorEdits.doctorNotes;
  editedData.vitals = doctorEdits.vitals;
  editedData.nextVisitDate = doctorEdits.nextVisitDate;

  console.log(`  → Clicks [Save & Generate] button`);

  // ========================================================================
  // STEP 5: Generate Prescription with Edits
  // ========================================================================
  console.log(`\n${"=".repeat(80)}`);
  console.log(`STEP 5: Generate Prescription (With Doctor's Edits)`);
  console.log(`${"=".repeat(80)}`);
  console.log(`  POST /api/prescriptions/generate`);
  console.log(`  Body: { documentId: "${documentId}", format: "both", updateData: {...} }`);

  const result = await service.generatePrescription(documentId, {
    format: "both",
    updateData: doctorEdits  // Simulating edited data from UI
  });

  console.log(`\n  ✓ Generation successful!`);
  console.log(`  ✓ HTML: ${result.urls.html}`);
  console.log(`  ✓ PDF: ${result.urls.pdf}`);

  // ========================================================================
  // STEP 6: Display Final Prescription Summary
  // ========================================================================
  console.log(`\n${"=".repeat(80)}`);
  console.log(`FINAL PRESCRIPTION SUMMARY`);
  console.log(`${"=".repeat(80)}`);

  console.log(`\n┌───────────────────────────────────────────────────────────────────────┐`);
  console.log(`│                    MANIPAL HOSPITALS                                   │`);
  console.log(`│              Generated from Live Voice Session                            │`);
  console.log(`└───────────────────────────────────────────────────────────────────────┘`);

  console.log(`\nPATIENT: ${editedData.patient.name}`);
  console.log(`Hospital No: ${editedData.patient.hospitalNo}`);
  console.log(`Date/Time: ${editedData.visit.dateTime}`);
  console.log(`Consultant: ${editedData.consultant.name}`);

  console.log(`\nDIAGNOSIS: ${editedData.doctorNotes.freeText.split('\n')[0]}`);

  console.log(`\nMEDICINES:`);
  editedData.prescription.medicines.filter(m => m.name).forEach(med => {
    const timing = `${med.morning ? 'M' : '_'} ${med.noon ? 'A' : '_'} ${med.night ? 'N' : '_'}`;
    console.log(`  ${med.srNo}. ${med.name.padEnd(15)} ${med.dose.padEnd(8)} [${timing}]  ${med.days ? med.days : ''} ${med.remarks}`);
  });

  console.log(`\nLABS ADVISED:`);
  Object.entries(editedData.labs)
    .filter(([key, val]) => key !== "other" && val === true)
    .forEach(([key]) => console.log(`  ✓ ${key}`));
  if (editedData.labs.other) {
    console.log(`  Other: ${editedData.labs.other}`);
  }

  console.log(`\nRADIOLOGY ADVISED:`);
  Object.entries(editedData.radiology)
    .filter(([key, val]) => key !== "other" && val === true)
    .forEach(([key]) => console.log(`  ✓ ${key}`));

  console.log(`\nVITALS:`);
  console.log(`  BP: ${editedData.vitals.bp || "N/A"}`);
  console.log(`  Weight: ${editedData.vitals.weight || "N/A"}`);
  console.log(`  Height: ${editedData.vitals.height || "N/A"}`);

  console.log(`\nNEXT VISIT: ${editedData.nextVisitDate || "N/A"}`);

  // ========================================================================
  // STEP 7: Open Generated Files
  // ========================================================================
  console.log(`\n${"=".repeat(80)}`);
  console.log(`STEP 6: Opening Generated Prescription`);
  console.log(`${"=".repeat(80)}`);
  console.log(`  Opening PDF in browser...`);

  const pdfPath = result.paths.pdf;
  const htmlPath = result.paths.html;

  // Open PDF
  const { exec } = require("child_process");

  exec(`open "${pdfPath}"`, (error) => {
    if (error) {
      console.log(`  ⚠ Could not open PDF automatically`);
      console.log(`  📄 PDF saved at: ${pdfPath}`);
    } else {
      console.log(`  ✓ PDF opened in browser`);
    }
  });

  // Summary
  console.log(`\n${"=".repeat(80)}`);
  console.log(`POC COMPLETE!`);
  console.log(`${"=".repeat(80)}`);
  console.log(`\nGenerated Files:`);
  console.log(`  📄 HTML: ${htmlPath}`);
  console.log(`  📄 PDF:  ${pdfPath}`);
  console.log(`\nDocument ID for testing: ${documentId}`);
  console.log(`\nTest URL: http://localhost:8001/prescription/${documentId}`);
  console.log(`\n${"=".repeat(80)}\n`);
}

runPOC().catch(console.error);
