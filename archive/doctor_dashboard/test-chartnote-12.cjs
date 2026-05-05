/**
 * Test script for Chart Note Generation on DischargeSummary12
 */

const PDFReaderTool = require("./tools/pdf/pdf_reader.tool.cjs");
const GemmaClientTool = require("./tools/llm/gemma_client.tool.cjs");
const PromptBuilderTool = require("./tools/llm/prompt_builder.tool.cjs");
const ChartNoteAgent = require("./agents/chart_note_agent.cjs");
const CrossValidationAgentSkill = require("./skills/validation/cross_validation_agent.skill.cjs");
const DischargeExtractorAgent = require("./agents/discharge_extractor_agent.cjs");

// Configuration
const GEMMA_URL = process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
const MODEL = process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it";
const PDF_PATH = "../data/Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf";

/**
 * Test chart note generation for DischargeSummary12
 */
async function testChartNoteGeneration() {
  console.log("\n" + "=".repeat(70));
  console.log("📄 Testing Chartnote Generation for DischargeSummary12");
  console.log("=".repeat(70));

  try {
    // Initialize tools and agents
    const pdfReader = new PDFReaderTool();
    const chartNoteAgent = new ChartNoteAgent({
      gemma: {
        baseUrl: GEMMA_URL,
        model: MODEL,
        timeout: 120000
      }
    });
    const crossValidator = new CrossValidationAgentSkill({ confidenceThreshold: 0.9 });

    // Step 1: Read PDF
    console.log("\n📖 Step 1: Reading PDF...");
    const pdfResult = await pdfReader.execute(PDF_PATH, 15000);

    if (!pdfResult.success) {
      console.log(`❌ Failed to read PDF: ${pdfResult.error}`);
      return;
    }

    console.log(`✅ PDF read: ${pdfResult.pages} pages, ${pdfResult.text.length} characters`);

    // Step 2: Extract clinical data using DischargeExtractorAgent
    console.log("\n🔍 Step 2: Extracting clinical data from PDF...");
    const extractorAgent = new DischargeExtractorAgent({
      gemma: {
        baseUrl: GEMMA_URL,
        model: MODEL,
        timeout: 180000
      }
    });

    const extractionResult = await extractorAgent.process(PDF_PATH, {
      pdfName: "DischargeSummary12.cls.pdf",
      onProgress: (progress) => {
        console.log(`   ${progress.step}: ${progress.status}`);
      }
    });

    if (!extractionResult.success) {
      console.log(`❌ Extraction failed: ${extractionResult.error}`);
      return;
    }

    console.log(`✅ Extraction completed: ${extractionResult.tokensUsed || 0} tokens used`);
    console.log(`   Steps completed: ${extractionResult.steps?.length || 0}`);

    const extractedData = extractionResult.data || {};
    console.log("\n📊 Extracted Data Summary:");
    console.log(`   - Patient: ${extractedData.patient?.name || 'N/A'} (Age: ${extractedData.patient?.age || 'N/A'})`);
    console.log(`   - Diagnosis: ${extractedData.diagnosis?.principal || 'N/A'}`);
    console.log(`   - Medications: ${extractedData.medications?.length || 0}`);
    console.log(`   - Vitals: ${Object.keys(extractedData.vitals || {}).length} fields`);
    console.log(`   - Risk Scores: ${Object.keys(extractedData.risk_scores || {}).length} scores`);
    console.log(`   - Labs: ${extractedData.lab_results?.length || 0} results`);
    console.log(`   - Clinical Notes: ${extractedData.clinical_notes?.length || 0} notes`);

    // Step 3: Run cross-validation for citations
    console.log("\n🔎 Step 3: Running cross-validation...");
    const validationResult = await crossValidator.execute({
      extractedData: extractedData,
      pdfText: pdfResult.text.substring(0, 12000),
      gemmaClient: chartNoteAgent.gemmaClient,
      promptBuilder: chartNoteAgent.promptBuilder
    });

    console.log(`✅ Validation completed:`);
    console.log(`   - Confidence: ${(validationResult.data.validation.overallConfidence * 100).toFixed(0)}%`);
    console.log(`   - Fields reviewed: ${validationResult.data.validation.fieldsReviewed}/${validationResult.data.validation.totalFields}`);
    console.log(`   - Flags: ${validationResult.data.validation.flags?.length || 0}`);

    // Step 4: Generate chart note using ReAct agent
    console.log("\n✍️  Step 4: Generating chart note (ReAct Agent)...");

    const citationSummary = validationResult.data.citations.summary;
    const validationSummaryText = `Confidence: ${(citationSummary.overallConfidence * 100).toFixed(0)}% | Fields reviewed: ${citationSummary.fieldsReviewed}/${citationSummary.totalFields}`;

    const chartNoteResult = await chartNoteAgent.execute({
      extractedData: extractedData,
      pdfText: pdfResult.text.substring(0, 12000),
      citationData: validationResult.data.citations,
      validationSummary: validationSummaryText
    }, (progress) => {
      console.log(`   Progress: ${progress.step} - ${progress.status}`);
    });

    if (!chartNoteResult.success) {
      console.log(`❌ Chart note generation failed: ${chartNoteResult.error}`);
      return;
    }

    console.log(`\n✅ Chart note generated successfully!`);
    console.log(`   Tokens used: ${chartNoteResult.data.metadata.total_tokens || 0}`);
    console.log(`   Generation time: ${(chartNoteResult.data.metadata.generation_time_ms / 1000).toFixed(2)}s`);
    console.log(`   Steps completed: ${chartNoteResult.data.metadata.steps_completed || 0}`);

    // Display the chart note
    console.log("\n" + "─".repeat(70));
    console.log("GENERATED CHART NOTE:");
    console.log("─".repeat(70));
    console.log(chartNoteResult.data.chart_note);
    console.log("─".repeat(70));

    // Save to file
    const fs = require("fs");
    const outputPath = "./test-output-chartnote-12.md";
    fs.writeFileSync(outputPath, chartNoteResult.data.chart_note, "utf8");
    console.log(`\n💾 Chart note saved to: ${outputPath}`);

    return {
      success: true,
      tokensUsed: chartNoteResult.data.metadata.total_tokens || 0,
      generationTime: chartNoteResult.data.metadata.generation_time_ms || 0
    };

  } catch (error) {
    console.log(`\n❌ Error: ${error.message}`);
    console.log(error.stack);
    return { success: false, error: error.message };
  }
}

// Run test
testChartNoteGeneration().then(result => {
  console.log("\n" + "=".repeat(70));
  if (result.success) {
    console.log("✅ Test completed successfully");
  } else {
    console.log("❌ Test failed");
  }
  console.log("=".repeat(70));
  process.exit(result.success ? 0 : 1);
}).catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
