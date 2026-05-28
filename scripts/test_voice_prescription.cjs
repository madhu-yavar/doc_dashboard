#!/usr/bin/env node
/**
 * Test Voice Prescription Transformation
 */

const { PrescriptionService } = require("../server/prescription_service.cjs");

// Mock voice document (simulates what live voice creates)
const mockVoiceDocument = {
  id: "voice-live-test-123",
  name: "Test Voice Session",
  documentType: "voice",
  status: "processed",
  result: {
    meta: {
      sessionType: "live_conversation",
      sessionId: "live-poc-test-001",
      patientName: "John Doe"
    },
    extracted_data: {
      patient_info: {
        name: "John Doe"
      },
      diagnosis: "Viral Fever",
      symptoms: ["Fever", "Body ache", "Headache"],
      medications: [
        { name: "Paracetamol", instruction: "500mg twice daily for 3 days" },
        { name: "Azithromycin", instruction: "500mg once daily for 5 days" },
        { name: "Cetrizine", instruction: "10mg at night for 5 days" }
      ],
      labs: ["CBC", "HbA1c", "Chest X-ray"],
      radiology: ["Chest X-ray PA view"],
      follow_up: ["Review after 3 days"],
      plan: ["Rest", "Hydration", "Monitor temperature"]
    },
    transcript: {
      normalizedText: "Patient has fever for 2 days..."
    }
  },
  createdBy: {
    username: "DrTest"
  }
};

async function test() {
  const service = new PrescriptionService();
  await service.initialize();

  console.log("=".repeat(70));
  console.log("VOICE PRESCRIPTION TRANSFORMATION TEST");
  console.log("=".repeat(70));

  const result = service.mapVoiceToPrescription(mockVoiceDocument);

  console.log("\n📋 Hospital:");
  console.log(`  Name: ${result.hospital.name}`);
  console.log(`  Address: ${result.hospital.address}`);

  console.log("\n👤 Patient:");
  console.log(`  Name: ${result.patient.name}`);
  console.log(`  Hospital No: ${result.patient.hospitalNo}`);

  console.log("\n💊 Medications:");
  result.prescription.medicines.filter(m => m.name).forEach(med => {
    console.log(`  ${med.srNo}. ${med.name}`);
    console.log(`     Dose: ${med.dose}`);
    console.log(`     Timing: ${med.morning ? 'M ' : ''}${med.noon ? 'A ' : ''}${med.night ? 'N' : ''}`);
    console.log(`     Remarks: ${med.remarks}`);
  });

  console.log("\n🔬 Labs Checked:");
  Object.entries(result.labs)
    .filter(([key, val]) => key !== "other" && val === true)
    .forEach(([key]) => console.log(`  ✓ ${key}`));

  if (result.labs.other) {
    console.log(`  Other: ${result.labs.other}`);
  }

  console.log("\n🫀 Radiology Checked:");
  Object.entries(result.radiology)
    .filter(([key, val]) => key !== "other" && val === true)
    .forEach(([key]) => console.log(`  ✓ ${key}`));

  console.log("\n📝 Doctor's Notes:");
  console.log(`  ${result.doctorNotes.freeText.substring(0, 100)}...`);

  console.log("\n" + "=".repeat(70));
  console.log("✓ VOICE TRANSFORMATION SUCCESSFUL");
  console.log("=".repeat(70));
}

test().catch(console.error);
