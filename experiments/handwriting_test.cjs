/**
 * Handwriting Extraction Test
 * Tests 8B vs 30B Qwen models for handwritten medication extraction
 */

const fs = require("fs");
const path = require("path");

const TEST_FILE = "./data/Doxper.pdf";

/**
 * Direct prompt test with both models
 */
async function testHandwritingWithModel(modelConfig) {
  const PrescriptionExtractorSkill = require("../skills/extraction/prescription_extractor.skill.cjs");

  const extractor = new PrescriptionExtractorSkill({
    qwenBaseUrl: modelConfig.baseUrl,
    qwenModel: modelConfig.model,
    timeout: 180000
  });

  // Use a more targeted prompt for medications
  const result = await extractor.execute({
    filePath: TEST_FILE,
    onProgress: (p) => console.log(`  [${p.step}] ${p.status}`)
  });

  return {
    model: modelConfig.name,
    success: result.success,
    data: result.data,
    medications: result.data?.medications || [],
    notes: result.data?.notes || {},
    diagnosis: result.data?.diagnosis || {}
  };
}

/**
 * Compare 8B vs 30B for handwriting
 */
async function compareHandwritingModels() {
  console.log("\n" + "█".repeat(70));
  console.log("HANDWRITING EXTRACTION TEST: 8B vs 30B");
  console.log("█".repeat(70));
  console.log("\nTarget: Extract handwritten medications from Doxper.pdf (Page 2)");
  console.log("Expected:");
  console.log("  1. Tab. Azithromycin 500mg - OD - 5 days");
  console.log("  2. Tab. Montek LC - HS - 5 days");
  console.log("  Problem: Fever with myalgia");
  console.log("  Diagnosis: Viral fever");

  const models = [
    {
      name: "Qwen 8B (bfloat16)",
      baseUrl: "http://206.1.62.28:8000/v1/chat/completions",
      model: "Qwen/Qwen3-VL-8B-Instruct"
    },
    {
      name: "Qwen 30B (AWQ 4-bit)",
      baseUrl: "http://206.1.62.28:8001/v1/chat/completions",
      model: "cyankiwi/Qwen3-VL-30B-A3B-Instruct-AWQ-4bit"
    }
  ];

  const results = [];

  for (const modelConfig of models) {
    console.log("\n" + "=".repeat(70));
    console.log(`Testing: ${modelConfig.name}`);
    console.log("=".repeat(70));

    const startTime = Date.now();
    const result = await testHandwritingWithModel(modelConfig);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ Completed in ${duration}s`);
    console.log(`\n📋 Results:`);
    console.log(`  Medications found: ${result.medications.length}`);
    result.medications.forEach((med, i) => {
      console.log(`    ${i + 1}. ${med.name} ${med.dosage} - ${med.frequency} (${med.duration})`);
    });
    console.log(`  Diagnosis: ${result.diagnosis.primary || "Not found"}`);
    console.log(`  Notes: ${result.notes.other_notes || result.notes.follow_up || "None"}`);

    results.push({
      ...result,
      duration
    });
  }

  // Generate comparison report
  console.log("\n" + "█".repeat(70));
  console.log("COMPARISON RESULTS");
  console.log("█".repeat(70));

  console.log(`\n${"Model".padEnd(30)} ${"Duration".padEnd(12)} ${"Medications".padEnd(12)} ${"Diagnosis"}`);
  console.log("─".repeat(70));

  for (const result of results) {
    const medCount = result.medications.length > 0 ? "✅ " + result.medications.length : "❌ 0";
    const diagnosis = result.diagnosis.primary ? "✅" : "❌";
    console.log(`${result.model.padEnd(30)} ${result.duration + "s".padEnd(12)} ${medCount.padEnd(12)} ${diagnosis}`);
  }

  // Detailed comparison
  console.log("\n" + "=".repeat(70));
  console.log("DETAILED COMPARISON");
  console.log("=".repeat(70));

  for (const result of results) {
    console.log(`\n## ${result.model}`);
    console.log(`Duration: ${result.duration}s`);
    console.log(`Medications (${result.medications.length}):`);
    if (result.medications.length === 0) {
      console.log(`  ❌ No medications extracted`);
    } else {
      result.medications.forEach((med, i) => {
        console.log(`  ${i + 1}. ${med.name}`);
        console.log(`     Dosage: ${med.dosage || "N/A"}`);
        console.log(`     Form: ${med.form || "N/A"}`);
        console.log(`     Frequency: ${med.frequency || "N/A"}`);
        console.log(`     Duration: ${med.duration || "N/A"}`);
        console.log(`     Confidence: ${med.confidence || "N/A"}`);
      });
    }
    console.log(`Diagnosis: ${result.diagnosis.primary || "Not found"}`);
    console.log(`Additional Notes: ${result.notes.other_notes || "None"}`);
  }

  // Save results
  const outputPath = "./experiments/results/handwriting_comparison.json";
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n📁 Results saved to: ${outputPath}`);

  return results;
}

compareHandwritingModels().catch(console.error);
