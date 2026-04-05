/**
 * Test script for Chart Note Generation
 * Tests with real PDF files from the data folder
 */

const PDFReaderTool = require("./tools/pdf/pdf_reader.tool.cjs");
const GemmaClientTool = require("./tools/llm/gemma_client.tool.cjs");
const PromptBuilderTool = require("./tools/llm/prompt_builder.tool.cjs");
const ChartNoteComposerSkill = require("./skills/generation/chart_note_composer.skill.cjs");

// Configuration
const GEMMA_URL = process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
const MODEL = process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it";
const DATA_FOLDER = "../data";

// Test PDFs
const TEST_PDFS = [
  "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
  "Custom.MEXX.Report.ZEN.DischargeSummary1.cls.pdf",
  "Custom.MEXX.Report.ZEN.DischargeSummary2.cls.pdf",
  "Custom.MEXX.Report.ZEN.DischargeSummary5.cls.pdf"
];

/**
 * Test chart note generation for a single PDF
 */
async function testChartNoteGeneration(pdfName) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📄 Testing: ${pdfName}`);
  console.log(`${"=".repeat(70)}`);

  // Initialize tools
  const pdfReader = new PDFReaderTool();
  const gemmaClient = new GemmaClientTool({ baseUrl: GEMMA_URL, model: MODEL });
  const promptBuilder = new PromptBuilderTool();
  const chartNoteSkill = new ChartNoteComposerSkill();

  try {
    // Step 1: Read PDF
    console.log("\n📖 Reading PDF...");
    const pdfPath = `${DATA_FOLDER}/${pdfName}`;
    const pdfResult = await pdfReader.execute(pdfPath, 10000);

    if (!pdfResult.success) {
      console.log(`❌ Failed to read PDF: ${pdfResult.error}`);
      return;
    }

    console.log(`✅ PDF read: ${pdfResult.pages} pages, ${pdfResult.text.length} characters`);

    // Step 2: Use existing agent to extract data (reuse existing extraction)
    console.log("\n🔍 Extracting clinical data...");
    // For now, we'll use the raw PDF text and let the LLM parse it
    // In production, this would use the full extraction agent result

    // Create a simple extracted data structure from the PDF text
    const extractedData = {
      patient: {
        name: "Extracted from PDF",
        mrn: "See PDF",
        age: 0,
        gender: "See PDF",
        admission_date: "See PDF",
        discharge_date: "See PDF"
      },
      // The chart_note_composer will work with minimal data
      // In production, this comes from the full extraction agent
    };

    // Step 3: Generate chart note
    console.log("\n✍️  Generating chart note...");
    const chartNoteResult = await chartNoteSkill.execute({
      extractedData: {
        ...extractedData,
        // Pass the raw PDF text for the skill to extract from
        pdf_text: pdfResult.text.substring(0, 8000) // First 8000 chars
      },
      gemmaClient: gemmaClient,
      promptBuilder: promptBuilder
    });

    if (!chartNoteResult.success) {
      console.log(`❌ Chart note generation failed: ${chartNoteResult.error}`);
      return;
    }

    console.log(`✅ Chart note generated (${chartNoteResult.usage?.totalTokens || 0} tokens)`);
    console.log("\n" + "─".repeat(70));
    console.log("CHART NOTE:");
    console.log("─".repeat(70));
    console.log(chartNoteResult.data.chart_note);
    console.log("─".repeat(70));

    return {
      success: true,
      pdfName,
      chartNote: chartNoteResult.data.chart_note,
      tokensUsed: chartNoteResult.usage?.totalTokens || 0
    };

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    return { success: false, pdfName, error: error.message };
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log("\n🚀 CHART NOTE GENERATION TEST SUITE");
  console.log(`Model: ${MODEL}`);
  console.log(`Tests: ${TEST_PDFS.length} PDFs`);

  const results = [];

  for (const pdfName of TEST_PDFS) {
    const result = await testChartNoteGeneration(pdfName);
    results.push(result);

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(70));

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalTokens = results.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);

  console.log(`Total Tests: ${results.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total Tokens Used: ${totalTokens.toLocaleString()}`);

  results.forEach(result => {
    if (result.success) {
      console.log(`  ✅ ${result.pdfName} - ${result.tokensUsed} tokens`);
    } else {
      console.log(`  ❌ ${result.pdfName} - ${result.error}`);
    }
  });

  console.log("=".repeat(70));
}

// Run tests
runTests().catch(console.error);
