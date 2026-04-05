/**
 * Test extraction for labs and medications from DischargeSummary12
 */

const PDFReaderTool = require('../tools/pdf/pdf_reader.tool.cjs');
const GemmaClientTool = require('../tools/llm/gemma_client.tool.cjs');
const PromptBuilderTool = require('../tools/llm/prompt_builder.tool.cjs');
const path = require('path');

const PDF_PATH = path.join(__dirname, '../../data/Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf');

async function testExtraction() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TESTING LABS & MEDICATIONS EXTRACTION');
  console.log('='.repeat(80));

  // Read PDF
  console.log('\n📄 Reading PDF...');
  const pdfReader = new PDFReaderTool();
  const pdfResult = await pdfReader.execute(PDF_PATH, 10000);

  if (!pdfResult.success) {
    console.error('Failed to read PDF');
    return;
  }

  console.log(`   ✅ PDF read: ${pdfResult.text.length} chars, ${pdfResult.pages} pages`);

  // Initialize tools
  const gemmaClient = new GemmaClientTool({
    baseUrl: process.env.GEMMA_URL || 'http://206.1.62.28:8000/v1/chat/completions',
    model: process.env.GEMMA_MODEL || 'google/gemma-4-26B-A4B-it'
  });
  const promptBuilder = new PromptBuilderTool();

  // Search for lab-related content in the PDF
  console.log('\n🔍 Searching for LABS content in PDF...');
  const lines = pdfResult.text.split('\n');
  const labLines = lines.filter(l =>
    l.match(/lab|laboratory|investigation|cbc|hemoglobin|wbc|platelet|sodium|potassium|creatinine|blood sugar|grbs|lft|lipid|urine|ecg|echo|ct|xray/i)
  );

  console.log('Found', labLines.length, 'lines with lab-related content (first 20):');
  labLines.slice(0, 20).forEach((line, i) => {
    console.log(`  ${i+1}: ${line.substring(0, 100)}`);
  });

  // Search for medication content
  console.log('\n💊 Searching for MEDICATIONS content in PDF...');
  const medLines = lines.filter(l =>
    l.match(/medication|medicine|injection|tablet|syrup|capsule|mg|ml|od|bd|tds|sos|stat|prn|freely/i)
  );

  console.log('Found', medLines.length, 'lines with medication-related content (first 20):');
  medLines.slice(0, 20).forEach((line, i) => {
    console.log(`  ${i+1}: ${line.substring(0, 100)}`);
  });

  // Test Clinical Data Extraction
  console.log('\n🤖 Testing Clinical Data Extraction...');
  const clinicalPrompt = promptBuilder.build('clinical_data_extractor', { pdfText: pdfResult.text });
  const clinicalResult = await gemmaClient.execute(clinicalPrompt, { temperature: 0.1, maxTokens: 1500 });

  if (clinicalResult.success) {
    console.log('\n📦 Clinical Data Result:');
    console.log('─'.repeat(80));
    console.log(clinicalResult.content);
    console.log('─'.repeat(80));

    try {
      const data = JSON.parse(clinicalResult.content);
      console.log('\n✅ Parsed JSON:');
      console.log('\n   Medications:', data.medications?.length || 0);
      if (data.medications && data.medications.length > 0) {
        data.medications.forEach((med, i) => {
          console.log(`     [${i+1}] ${med.name} - ${med.dose} - ${med.frequency}`);
        });
      }
      console.log('\n   Allergies:', data.allergies);
      console.log('\n   Investigations:', data.investigations);
      console.log('\n   Nursing Needs:', data.nursing_needs);
    } catch (e) {
      console.log('\n❌ Failed to parse JSON:', e.message);
    }
  }
}

testExtraction().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
