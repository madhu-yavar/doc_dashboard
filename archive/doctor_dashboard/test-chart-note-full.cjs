/**
 * Test script for Chart Note Generation
 * Tests with real PDF files using the full extraction pipeline
 */

const DischargeExtractorAgent = require("./agents/discharge_extractor_agent.cjs");
const GemmaClientTool = require("./tools/llm/gemma_client.tool.cjs");
const PromptBuilderTool = require("./tools/llm/prompt_builder.tool.cjs");
const ChartNoteComposerSkill = require("./skills/generation/chart_note_composer.skill.cjs");

// Configuration
const GEMMA_URL = process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
const MODEL = process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it";
const DATA_FOLDER = "../data";

// Test PDFs - smaller ones for faster testing
const TEST_PDFS = [
  { name: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf", description: "Neuro/Stroke case" },
  { name: "Custom.MEXX.Report.ZEN.DischargeSummary14.cls.pdf", description: "Unknown case" },
  { name: "Custom.MEXX.Report.ZEN.DischargeSummary15.cls.pdf", description: "Unknown case" },
  { name: "Custom.MEXX.Report.ZEN.DischargeSummary16.cls.pdf", description: "Small PDF" }
];

/**
 * Test chart note generation for a single PDF using full extraction
 */
async function testChartNoteGeneration(pdfInfo) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📄 Testing: ${pdfInfo.name}`);
  console.log(`   (${pdfInfo.description})`);
  console.log(`${"=".repeat(70)}`);

  // Initialize tools and agent
  const gemmaClient = new GemmaClientTool({ baseUrl: GEMMA_URL, model: MODEL });
  const promptBuilder = new PromptBuilderTool();
  const chartNoteSkill = new ChartNoteComposerSkill();
  const agent = new DischargeExtractorAgent({
    gemma: { baseUrl: GEMMA_URL, model: MODEL, timeout: 120000 }
  });

  try {
    const startTime = Date.now();

    // Step 1: Run the full extraction agent
    console.log("\n🔍 Running extraction agent...");
    const pdfPath = `${DATA_FOLDER}/${pdfInfo.name}`;

    const agentResult = await agent.process(pdfPath, {
      pdfName: pdfInfo.name
    });

    if (!agentResult.success) {
      console.log(`❌ Extraction failed: ${agentResult.error}`);
      return { success: false, pdfName: pdfInfo.name, error: agentResult.error };
    }

    const extractionTime = Date.now() - startTime;
    console.log(`✅ Extraction complete (${agentResult.tokensUsed} tokens, ${extractionTime}ms)`);

    // Step 2: Generate chart note from extracted data
    console.log("\n✍️  Generating chart note...");
    const chartNoteResult = await chartNoteSkill.execute({
      extractedData: agentResult.data,
      gemmaClient: gemmaClient,
      promptBuilder: promptBuilder
    });

    if (!chartNoteResult.success) {
      console.log(`❌ Chart note generation failed: ${chartNoteResult.error}`);
      return { success: false, pdfName: pdfInfo.name, error: chartNoteResult.error };
    }

    const chartNoteTime = Date.now() - startTime - extractionTime;
    console.log(`✅ Chart note generated (${chartNoteResult.usage?.totalTokens || 0} tokens, ${chartNoteTime}ms)`);

    // Display the chart note
    console.log("\n" + "─".repeat(70));
    console.log("CHART NOTE:");
    console.log("─".repeat(70));
    console.log(chartNoteResult.data.chart_note);
    console.log("─".repeat(70));

    return {
      success: true,
      pdfName: pdfInfo.name,
      chartNote: chartNoteResult.data.chart_note,
      extractionTokens: agentResult.tokensUsed,
      chartNoteTokens: chartNoteResult.usage?.totalTokens || 0,
      totalTokens: agentResult.tokensUsed + (chartNoteResult.usage?.totalTokens || 0)
    };

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    return { success: false, pdfName: pdfInfo.name, error: error.message };
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log("\n🚀 CHART NOTE GENERATION TEST SUITE (Full Pipeline)");
  console.log(`Model: ${MODEL}`);
  console.log(`Tests: ${TEST_PDFS.length} PDFs`);
  console.log("\nThis will:");
  console.log("  1. Extract clinical data using the DischargeExtractorAgent");
  console.log("  2. Generate a chart note from the extracted data");
  console.log("  3. Display the generated chart note");

  const results = [];

  for (const pdfInfo of TEST_PDFS) {
    const result = await testChartNoteGeneration(pdfInfo);
    results.push(result);
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(70));

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalTokens = results.reduce((sum, r) => sum + (r.totalTokens || 0), 0);

  console.log(`Total Tests: ${results.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total Tokens Used: ${totalTokens.toLocaleString()}`);

  results.forEach(result => {
    if (result.success) {
      console.log(`  ✅ ${result.pdfName}`);
      console.log(`     Extraction: ${result.extractionTokens?.toLocaleString() || 0} tokens`);
      console.log(`     Chart Note: ${result.chartNoteTokens?.toLocaleString() || 0} tokens`);
      console.log(`     Total: ${result.totalTokens?.toLocaleString() || 0} tokens`);
    } else {
      console.log(`  ❌ ${result.pdfName} - ${result.error}`);
    }
  });

  console.log("=".repeat(70));
}

// Run tests
runTests().catch(console.error);
