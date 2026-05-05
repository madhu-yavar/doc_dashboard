/**
 * Prescription Extraction Comparison Test
 * Compares opendataloader-pdf vs Qwen Vision for handwritten prescription extraction
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Test configuration
const TEST_FILE = "./data/Doxper.pdf";
const OUTPUT_DIR = "./experiments/results";

// Ensure output directory exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * Method 1: opendataloader-pdf (Python)
 * Uses hybrid mode with OCR for scanned/handwritten prescriptions
 */
async function extractWithOpenDataLoader(pdfPath) {
  console.log("\n" + "=".repeat(70));
  console.log("METHOD 1: OpenDataLoader-PDF (Hybrid + OCR)");
  console.log("=".repeat(70));

  const outputFile = path.join(OUTPUT_DIR, "opendataloader_output.json");
  const markdownFile = path.join(OUTPUT_DIR, "opendataloader_output.md");

  try {
    // Run opendataloader-pdf with hybrid mode and OCR
    // Note: hybrid server needs to be running separately
    const cmd = `opendataloader-pdf "${pdfPath}" --output-dir "${OUTPUT_DIR}" --format "json,markdown"`;

    console.log(`Running: ${cmd}`);
    const startTime = Date.now();

    try {
      execSync(cmd, { stdio: "inherit", timeout: 60000 });
    } catch (error) {
      // Hybrid mode might not have server running, try local mode
      console.log("\nHybrid mode failed (server not running?), trying local mode...");
      execSync(`opendataloader-pdf "${pdfPath}" --output-dir "${OUTPUT_DIR}" --format "json,markdown"`, {
        stdio: "inherit",
        timeout: 60000
      });
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n✅ OpenDataLoader completed in ${duration}s`);

    // Read and parse the JSON output
    const jsonFile = path.join(OUTPUT_DIR, path.basename(pdfPath, ".pdf") + ".json");

    if (fs.existsSync(jsonFile)) {
      const jsonContent = fs.readFileSync(jsonFile, "utf-8");
      const parsed = JSON.parse(jsonContent);

      // OpenDataLoader returns an object with a 'kids' array containing elements
      const data = parsed.kids || parsed || [];

      return {
        method: "opendataloader-pdf",
        duration: parseFloat(duration),
        success: true,
        raw: data,
        summary: analyzeOpenDataLoaderOutput(data)
      };
    } else {
      return {
        method: "opendataloader-pdf",
        duration: parseFloat(duration),
        success: false,
        error: "JSON output file not found"
      };
    }
  } catch (error) {
    return {
      method: "opendataloader-pdf",
      duration: 0,
      success: false,
      error: error.message
    };
  }
}

/**
 * Analyze OpenDataLoader JSON output for prescription-relevant content
 */
function analyzeOpenDataLoaderOutput(data) {
  const summary = {
    total_elements: data.length || 0,
    element_types: {},
    text_blocks: [],
    tables: [],
    images: [],
    full_text: ""
  };

  // Group by type and extract text
  for (const element of data) {
    const type = element.type || "unknown";
    summary.element_types[type] = (summary.element_types[type] || 0) + 1;

    if (type === "paragraph" || type === "heading" || type === "list") {
      const content = element.content || "";
      if (content) {
        summary.text_blocks.push({
          type,
          content,
          page: element["page number"]
        });
        summary.full_text += content + "\n";
      }
    }

    if (type === "table") {
      summary.tables.push({
        page: element["page number"],
        bbox: element["bounding box"],
        content: element.content || ""
      });
    }

    if (type === "picture" || type === "image") {
      summary.images.push({
        page: element["page number"],
        bbox: element["bounding box"],
        description: element.description || element.content || ""
      });
    }
  }

  return summary;
}

/**
 * Method 2: Qwen Vision Model
 * Direct vision-based extraction
 */
async function extractWithQwenVision(pdfPath) {
  console.log("\n" + "=".repeat(70));
  console.log("METHOD 2: Qwen Vision (8B Model)");
  console.log("=".repeat(70));

  const PrescriptionExtractorSkill = require("../skills/extraction/prescription_extractor.skill.cjs");

  const startTime = Date.now();

  try {
    const extractor = new PrescriptionExtractorSkill({
      qwenBaseUrl: "http://206.1.62.28:8000/v1/chat/completions",
      qwenModel: "Qwen/Qwen3-VL-8B-Instruct",
      timeout: 120000
    });

    const result = await extractor.execute({
      filePath: pdfPath,
      onProgress: (progress) => {
        console.log(`  [${progress.step}] ${progress.status}`);
      }
    });

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    if (result.success) {
      console.log(`\n✅ Qwen Vision completed in ${duration}s`);

      return {
        method: "qwen-vision-8b",
        duration: parseFloat(duration),
        success: true,
        raw: result.data,
        summary: analyzeQwenOutput(result.data),
        usage: result.usage
      };
    } else {
      return {
        method: "qwen-vision-8b",
        duration: parseFloat(duration),
        success: false,
        error: result.error
      };
    }
  } catch (error) {
    return {
      method: "qwen-vision-8b",
      duration: 0,
      success: false,
      error: error.message
    };
  }
}

/**
 * Analyze Qwen output for summary statistics
 */
function analyzeQwenOutput(data) {
  return {
    patient_found: !!data.patient?.name,
    patient_name: data.patient?.name || null,
    doctor_found: !!data.doctor?.name,
    doctor_name: data.doctor?.name || null,
    medications_count: data.medications?.length || 0,
    medications: data.medications || [],
    diagnosis: data.diagnosis?.primary || null,
    confidence: data.extraction_metadata?.confidence || "unknown",
    total_medications: data.extraction_metadata?.total_medications || 0
  };
}

/**
 * Save results to file
 */
function saveResults(results) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultFile = path.join(OUTPUT_DIR, `comparison_${timestamp}.json`);
  const reportFile = path.join(OUTPUT_DIR, `comparison_report_${timestamp}.md`);

  // Save full JSON
  fs.writeFileSync(resultFile, JSON.stringify(results, null, 2));

  // Generate human-readable report
  let report = "# Prescription Extraction Comparison Report\n\n";
  report += `**Date:** ${new Date().toLocaleString()}\n`;
  report += `**Test File:** ${TEST_FILE}\n\n`;
  report += "---\n\n";

  for (const result of results) {
    report += `## ${result.method}\n\n`;
    report += `- **Status:** ${result.success ? "✅ Success" : "❌ Failed"}\n`;
    report += `- **Duration:** ${result.duration}s\n`;

    if (result.success) {
      report += `- **Summary:**\n`;

      if (result.method.includes("qwen")) {
        report += `  - Patient: ${result.summary.patient_found ? result.summary.patient_name : "Not found"}\n`;
        report += `  - Doctor: ${result.summary.doctor_found ? result.summary.doctor_name : "Not found"}\n`;
        report += `  - Medications: ${result.summary.medications_count}\n`;
        report += `  - Diagnosis: ${result.summary.diagnosis || "Not found"}\n`;
        report += `  - Confidence: ${result.summary.confidence}\n`;

        if (result.summary.medications_count > 0) {
          report += `\n  **Medications:**\n`;
          for (const med of result.summary.medications) {
            report += `  - ${med.name || "Unknown"} (${med.dosage || ""} ${med.frequency || ""})\n`;
          }
        }
      } else {
        report += `  - Total Elements: ${result.summary.total_elements}\n`;
        report += `  - Text Blocks: ${result.summary.text_blocks.length}\n`;
        report += `  - Tables: ${result.summary.tables.length}\n`;
        report += `  - Images: ${result.summary.images.length}\n`;
        report += `  - Element Types: ${JSON.stringify(result.summary.element_types)}\n`;
      }
    } else {
      report += `- **Error:** ${result.error}\n`;
    }

    report += "\n---\n\n";
  }

  // Comparison section
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length >= 2) {
    report += "## Comparison\n\n";
    report += "| Metric | OpenDataLoader | Qwen Vision |\n";
    report += "|--------|----------------|-------------|\n";
    report += `| Duration | ${successfulResults[0].duration}s | ${successfulResults[1].duration}s |\n`;
    report += `| Status | ${successfulResults[0].success ? "✅" : "❌"} | ${successfulResults[1].success ? "✅" : "❌"} |\n`;

    if (successfulResults[1].summary) {
      report += `\n### Qwen Vision Extracted Data:\n`;
      report += `- **Medications Found:** ${successfulResults[1].summary.medications_count}\n`;
      report += `- **Patient:** ${successfulResults[1].summary.patient_name || "Not found"}\n`;
      report += `- **Doctor:** ${successfulResults[1].summary.doctor_name || "Not found"}\n`;
    }
  }

  fs.writeFileSync(reportFile, report);

  return { resultFile, reportFile };
}

/**
 * Main comparison function
 */
async function runComparison() {
  console.log("\n" + "█".repeat(70));
  console.log("PRESCRIPTION EXTRACTION COMPARISON TEST");
  console.log("█".repeat(70));
  console.log(`Test File: ${TEST_FILE}`);
  console.log(`Output Directory: ${OUTPUT_DIR}`);

  // Check if test file exists
  if (!fs.existsSync(TEST_FILE)) {
    console.error(`\n❌ Test file not found: ${TEST_FILE}`);
    return;
  }

  const results = [];

  // Method 1: OpenDataLoader-PDF
  console.log("\n📦 Running OpenDataLoader-PDF extraction...");
  const opendataloaderResult = await extractWithOpenDataLoader(TEST_FILE);
  results.push(opendataloaderResult);

  // Method 2: Qwen Vision
  console.log("\n🤖 Running Qwen Vision extraction...");
  const qwenResult = await extractWithQwenVision(TEST_FILE);
  results.push(qwenResult);

  // Save results
  console.log("\n💾 Saving results...");
  const { resultFile, reportFile } = saveResults(results);

  console.log("\n" + "█".repeat(70));
  console.log("COMPARISON COMPLETE");
  console.log("█".repeat(70));
  console.log(`\n📁 Results saved to:`);
  console.log(`  - JSON: ${resultFile}`);
  console.log(`  - Report: ${reportFile}`);

  // Print quick summary
  console.log("\n📊 Quick Summary:");
  for (const result of results) {
    const icon = result.success ? "✅" : "❌";
    console.log(`  ${icon} ${result.method}: ${result.duration}s - ${result.success ? "Success" : result.error || "Failed"}`);
  }

  return results;
}

// Run the comparison
runComparison()
  .then(results => {
    console.log("\n✅ All tests completed!");
  })
  .catch(error => {
    console.error("\n💥 Test failed:", error.message);
    process.exit(1);
  });
