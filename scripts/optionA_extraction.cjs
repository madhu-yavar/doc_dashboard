/**
 * OPTION A: Single-Shot Extraction
 * Direct prompt → JSON response, no reasoning steps
 */

const fs = require("fs/promises");
const path = require("path");
const { PDFParse } = require("pdf-parse");

const GEMMA_URL = process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
const MODEL = process.env.GEMMA_MODEL || "google/gemma-4-31B-it";

async function extractTextFromPdf(filePath) {
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text || "";
}

function buildOptionAPrompt(pdfText, pdfName) {
  return `You are extracting structured data from a hospital discharge summary PDF.
Extract ALL available fields accurately. Return ONLY valid JSON.

PDF CONTENT:
${pdfText.slice(0, 8000)}

Return this exact JSON structure:
{
  "patient": {
    "name": "",
    "mrn": "",
    "age": 0,
    "gender": ""
  },
  "vitals": {
    "bp": "",
    "pulse": 0,
    "temp": "",
    "spo2": 0,
    "resp_rate": 0,
    "pain_score": 0,
    "grbs": 0,
    "ews_score": 0
  },
  "risk_scores": {
    "fall_risk_score": 0,
    "fall_risk_level": "",
    "dvt_score": 0,
    "dvt_level": "",
    "pressure_ulcer_score": 0,
    "pressure_level": "",
    "aspiration_score": 0,
    "aspiration_level": ""
  },
  "functional_status": {
    "bathing": "",
    "dressing": "",
    "eating": "",
    "walking": "",
    "toilet_use": ""
  },
  "gcs": {
    "eyes": 0,
    "motor": 0,
    "verbal": 0,
    "total": 0
  },
  "diagnosis": {
    "principal": "",
    "icd_code": "",
    "secondary": []
  },
  "allergies": [],
  "medications": [],
  "investigations_ordered": [],
  "nursing_needs": [],
  "diet": "",
  "summary": ""
}`;
}

async function callGemmaOptionA(pdfText, pdfName) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  const startTime = Date.now();

  const response = await fetch(GEMMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: buildOptionAPrompt(pdfText, pdfName) }],
      temperature: 0.1,
      max_tokens: 2500,
    }),
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemma request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  let content = payload.choices?.[0]?.message?.content || "";

  // Clean up JSON response
  if (content.includes("```json")) {
    content = content.split("```json")[1].split("```")[0].trim();
  } else if (content.includes("```")) {
    content = content.split("```")[1].split("```")[0].trim();
  }

  const endTime = Date.now();

  return {
    method: "Option A (Single-Shot)",
    latency_ms: endTime - startTime,
    tokens_used: payload.usage?.total_tokens || 0,
    data: JSON.parse(content),
    raw_response: content
  };
}

async function processOptionA(pdfPath) {
  const pdfName = path.basename(pdfPath);
  console.log(`\n📄 Processing: ${pdfName}`);
  console.log(`📋 Method: Option A (Single-Shot Extraction)`);

  try {
    const pdfText = await extractTextFromPdf(pdfPath);
    const result = await callGemmaOptionA(pdfText, pdfName);

    console.log(`✅ Success in ${result.latency_ms}ms`);
    console.log(`📊 Tokens used: ${result.tokens_used}`);

    return result;
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return { error: error.message, method: "Option A" };
  }
}

// Run if called directly
if (require.main === module) {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: node optionA_extraction.cjs <pdf-path>");
    process.exit(1);
  }
  processOptionA(pdfPath).then(console.log).catch(console.error);
}

module.exports = { processOptionA };
