/**
 * Test updated vitals extraction with readings
 */

const PDFReaderTool = require('../tools/pdf/pdf_reader.tool.cjs');
const GemmaClientTool = require('../tools/llm/gemma_client.tool.cjs');
const PromptBuilderTool = require('../tools/llm/prompt_builder.tool.cjs');
const path = require('path');

const PDF_PATH = path.join(__dirname, '../../data/Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf');

async function testVitalsExtraction() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TESTING UPDATED VITALS EXTRACTION');
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

  // Build and execute vitals prompt
  console.log('\n🤖 Extracting vitals with NEW prompt...');
  const prompt = promptBuilder.build('vitals_extractor', { pdfText: pdfResult.text });

  const result = await gemmaClient.execute(prompt, { temperature: 0.1, maxTokens: 1000 });

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
    console.log('\n   Latest Vitals:');
    console.log('     BP:', JSON.stringify(data.latest?.bp));
    console.log('     Pulse:', JSON.stringify(data.latest?.pulse));
    console.log('     SpO2:', JSON.stringify(data.latest?.spo2));

    console.log('\n   Readings (', data.readings?.length || 0, ' found):');
    if (data.readings && data.readings.length > 0) {
      data.readings.forEach((r, i) => {
        console.log(`     [${i+1}] ${r.date} - BP: ${r.bp_systolic}/${r.bp_diastolic}, Pulse: ${r.pulse}`);
      });
    } else {
      console.log('     No multiple readings found - single reading document');
    }

    console.log('\n   Reference Ranges:');
    console.log('     ', JSON.stringify(data.reference_ranges));

    console.log('\n   Abnormal Flags:');
    console.log('     ', data.abnormal_flags || []);

  } catch (e) {
    console.log('\n❌ Failed to parse JSON:', e.message);
    console.log('   Raw content was:', result.content.substring(0, 200));
  }
}

testVitalsExtraction().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
