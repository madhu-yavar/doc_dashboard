/**
 * Test script for Voice Extractor Agent
 * Tests Phase 2 structured extraction from voice transcripts
 */

const VoiceExtractorAgent = require("../agents/voice_extractor_agent.cjs");

// Test transcript from the Cardio sample
const testTranscript = {
  rawText: "a 30-year-old patient with a history of inferior wall MI, post right coronary artery and circumflex stent. has been feeling well, no symptoms of chest pain, no symptoms of dyspnea, orthopnea, dizziness, lightheadedness, no syncope. Next, patient weighs 244 pounds, blood pressure 120 over 82, heart rate is 68, regular period. HEENT, pupils are equal, JVP is normal, no carotid bruit. Neck is soft, thyroid not enlarged, trachea midline, no cervical lymphadenopathy. Respiratory, equal expansion, normal breath sounds. Heart, PMI in the fifth intercostal space, S1, S2 normal. No rub, no gallop, no murmurs. Abdomen soft, non-tender, no bruits, bowel sounds present. Extremities, equal pulses, no leg edema, period. Assessment, stable. Assessment, CAD. Number two, LV dysfunction. Plan, increase Coreg to 25 mg b.i.d. Increase Vasotec to 20 mg daily. Continue with aspirin 325 mg daily, Plavix 75 mg daily. Return in 3 months, period.",
  language: "en-US",
  overallConfidence: 0.98,
  segments: [
    {
      id: "seg_0",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:05",
      endLabel: "00:12",
      startMs: 5000,
      endMs: 12000,
      text: "a 30-year-old patient with a history of inferior wall MI, post right coronary artery and circumflex stent.",
      confidence: 0.98,
      flags: []
    },
    {
      id: "seg_1",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:12",
      endLabel: "00:21",
      startMs: 12000,
      endMs: 21000,
      text: "has been feeling well, no symptoms of chest pain, no symptoms of dyspnea, orthopnea, dizziness, lightheadedness, no syncope.",
      confidence: 0.99,
      flags: []
    },
    {
      id: "seg_2",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:21",
      endLabel: "00:26",
      startMs: 21000,
      endMs: 26000,
      text: "Next, patient weighs 244 pounds, blood pressure 120 over 82, heart rate is 68, regular period.",
      confidence: 0.99,
      flags: []
    },
    {
      id: "seg_6",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:48",
      endLabel: "00:52",
      startMs: 48000,
      endMs: 52000,
      text: "Assessment, stable. Assessment, CAD. Number two, LV dysfunction.",
      confidence: 0.97,
      flags: []
    },
    {
      id: "seg_7",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:52",
      endLabel: "00:57",
      startMs: 52000,
      endMs: 57000,
      text: "Plan, increase Coreg to 25 mg b.i.d. Increase Vasotec to 20 mg daily.",
      confidence: 0.98,
      flags: ["medication"]
    },
    {
      id: "seg_8",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:57",
      endLabel: "01:03",
      startMs: 57000,
      endMs: 63000,
      text: "Continue with aspirin 325 mg daily, Plavix 75 mg daily. Return in 3 months, period.",
      confidence: 0.98,
      flags: ["medication", "follow_up"]
    }
  ]
};

async function runTest() {
  console.log("=".repeat(60));
  console.log("VOICE EXTRACTOR AGENT - PHASE 2 TEST");
  console.log("=".repeat(60));

  const agent = new VoiceExtractorAgent({
    gemma: {
      baseUrl: process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions",
      model: process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it",
      timeout: 180000
    },
    logSteps: true
  });

  console.log("\n🎤 Input Transcript Summary:");
  console.log("  - Segments:", testTranscript.segments.length);
  console.log("  - Duration: ~63 seconds");
  console.log("  - Overall Confidence:", testTranscript.overallConfidence);
  console.log("  - Text Sample:", testTranscript.rawText.substring(0, 100) + "...");

  console.log("\n🔄 Running VoiceExtractorAgent...");
  const startTime = Date.now();

  try {
    const result = await agent.execute("test_session_cardio_001", testTranscript);

    const duration = Date.now() - startTime;

    console.log("\n" + "=".repeat(60));
    console.log("EXTRACTION RESULTS");
    console.log("=".repeat(60));
    console.log(`✓ Success: ${result.success}`);
    console.log(`✓ Status: ${result.status}`);
    console.log(`✓ Duration: ${(duration / 1000).toFixed(2)}s`);

    console.log("\n📋 EXTRACTED DATA:");

    if (result.extractedData) {
      console.log("\n  🏥 DIAGNOSIS:");
      if (result.extractedData.diagnosis?.principal) {
        console.log(`    Principal: ${result.extractedData.diagnosis.principal.name}`);
      }
      if (result.extractedData.diagnosis?.secondary?.length > 0) {
        console.log(`    Secondary: ${result.extractedData.diagnosis.secondary.map(d => d.name).join(", ")}`);
      }

      console.log("\n  💊 MEDICATIONS:");
      if (result.extractedData.medications?.length > 0) {
        result.extractedData.medications.forEach((med, i) => {
          console.log(`    ${i + 1}. ${med.name} ${med.dose} ${med.frequency} ${med.route} - ${med.indication || "no indication"} ${med.status}`);
        });
      } else {
        console.log("    No medications extracted");
      }

      console.log("\n  📊 VITALS:");
      const vitals = result.extractedData.vitals || {};
      if (vitals.bp?.systolic) {
        console.log(`    BP: ${vitals.bp.systolic}/${vitals.bp.diastolic}`);
      }
      if (vitals.pulse) {
        console.log(`    Pulse: ${vitals.pulse}`);
      }
      if (vitals.spo2) {
        console.log(`    SpO2: ${vitals.spo2}%`);
      }

      console.log("\n  🔬 LABS/INVESTIGATIONS:");
      if (result.extractedData.lab_results?.length > 0) {
        result.extractedData.lab_results.forEach(lab => {
          console.log(`    - ${lab.test_name}: ${lab.value}`);
        });
      } else {
        console.log("    No labs extracted");
      }

      console.log("\n  📻 RADIOLOGY:");
      if (result.extractedData.radiology?.pending?.length > 0) {
        result.extractedData.radiology.pending.forEach(rad => {
          console.log(`    - ${rad.type} (${rad.status})`);
        });
      } else {
        console.log("    No radiology extracted");
      }

      console.log("\n  🏃 FOLLOW-UP:");
      if (result.extractedData.follow_up?.items?.length > 0) {
        result.extractedData.follow_up.items.forEach(fu => {
          console.log(`    - ${fu.specialty || "General"}: ${fu.timing} - ${fu.reason || "no reason"}`);
        });
      } else {
        console.log("    No follow-up extracted");
      }
    }

    console.log("\n⚠️  REVIEW ITEMS:");
    if (result.reviewItems?.length > 0) {
      result.reviewItems.forEach((item, i) => {
        console.log(`    ${i + 1}. [${item.severity.toUpperCase()}] ${item.title}`);
        console.log(`       Category: ${item.category} | Resolution: ${item.resolution}`);
      });
    } else {
      console.log("    No review items - extraction is confident!");
    }

    console.log("\n📝 STEPS COMPLETED:");
    result.steps.forEach((step, i) => {
      const status = step.status === "completed" ? "✓" : "✗";
      console.log(`    ${i + 1}. ${status} ${step.name}`);
    });

    if (result.errors?.length > 0) {
      console.log("\n❌ ERRORS:");
      result.errors.forEach(err => {
        console.log(`    - ${err.step}: ${err.error}`);
      });
    }

    // Save results to file for inspection
    const fs = require("fs");
    const outputPath = "/Users/yavar/Documents/CoE/Manipal/test_voice_extraction_result.json";
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\n💾 Full results saved to: ${outputPath}`);

  } catch (error) {
    console.error("\n❌ TEST FAILED:", error.message);
    console.error(error.stack);
  }

  console.log("\n" + "=".repeat(60));
}

// Run the test
runTest().catch(console.error);
