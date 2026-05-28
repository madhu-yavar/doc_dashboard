/**
 * Test demographics extraction specifically
 */

const PDFReaderTool = require('../tools/pdf/pdf_reader.tool.cjs');
const GemmaClientTool = require('../tools/llm/gemma_client.tool.cjs');
const PromptBuilderTool = require('../tools/llm/prompt_builder.tool.cjs');
const path = require('path');

const PDF_PATH = path.join(__dirname, '../../data/Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf');

async function testDemographicsExtraction() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TESTING DEMOGRAPHICS EXTRACTION ONLY');
  console.log('='.repeat(80));

  // Read PDF
  console.log('\n📄 Reading PDF...');
  const pdfReader = new PDFReaderTool();
  const pdfResult = await pdfReader.execute(PDF_PATH, 8000);

  if (!pdfResult.success) {
    console.error('Failed to read PDF');
    return;
  }

  console.log(`   ✅ PDF read: ${pdfResult.text.length} chars`);

  // Initialize tools
  const gemmaClient = new GemmaClientTool({
    baseUrl: process.env.GEMMA_URL || 'http://206.1.62.28:8000/v1/chat/completions',
    model: process.env.GEMMA_MODEL || 'google/gemma-4-26B-A4B-it'
  });
  const promptBuilder = new PromptBuilderTool();

  // Build and execute demographics prompt
  console.log('\n🤖 Extracting demographics...');
  const prompt = promptBuilder.build('demographics_extractor', { pdfText: pdfResult.text });

  console.log('\n📝 Prompt (first 500 chars):');
  console.log(prompt.substring(0, 500) + '...\n');

  const result = await gemmaClient.execute(prompt, { temperature: 0.1, maxTokens: 600 });

  if (!result.success) {
    console.error('Failed to get response from LLM:', result.error);
    return;
  }

  console.log('📦 LLM Response:');
  console.log('─'.repeat(80));
  console.log(result.content);
  console.log('─'.repeat(80));

  // Try to parse JSON
  try {
    const data = JSON.parse(result.content);
    console.log('\n✅ Parsed JSON:');
    console.log('   Name:', data.name);
    console.log('   MRN:', data.mrn);
    console.log('   Age:', data.age);
    console.log('   Gender:', data.gender);
    console.log('   Admission Date:', data.admission_date);
    console.log('   Discharge Date:', data.discharge_date || '❌ NOT EXTRACTED');
    console.log('\n   Confidence Notes:', data.confidence_notes);
    console.log('   Sources:', data.sources);
  } catch (e) {
    console.log('\n❌ Failed to parse JSON:', e.message);
  }
}

testDemographicsExtraction().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
