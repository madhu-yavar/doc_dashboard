/**
 * OPTION B: Thinking/ReAct-Style Extraction
 * Multi-step reasoning with explicit thinking process
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

// Step 1: Analyze document structure and identify sections
async function step1_AnalyzeDocument(pdfText, pdfName) {
  const prompt = `You are analyzing a hospital discharge summary PDF.
FIRST, think about the document structure and identify key sections.

PDF CONTENT (first 4000 chars):
${pdfText.slice(0, 4000)}

Think through this step-by-step:
1. What type of document is this?
2. What sections are clearly visible?
3. Where would patient demographics be located?
4. Where would vital signs and risk scores be located?

After your thinking, provide a JSON summary:
{
  "document_type": "",
  "sections_identified": ["section1", "section2", ...],
  "confidence": "high/medium/low",
  "extraction_strategy": "brief description of how to extract data"
}`;

  const response = await fetch(GEMMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 800,
    }),
  });

  const payload = await response.json();
  let content = payload.choices?.[0]?.message?.content || "";
  if (content.includes("```json")) {
    content = content.split("```json")[1].split("```")[0].trim();
  } else if (content.includes("```")) {
    content = content.split("```")[1].split("```")[0].trim();
  }

  return {
    step: "Step 1: Document Analysis",
    thinking: content,
    tokens: payload.usage?.total_tokens || 0
  };
}

// Step 2: Extract patient demographics with verification
async function step2_ExtractDemographics(pdfText) {
  const prompt = `You are extracting patient demographics from a hospital discharge summary.
THINK carefully about finding the most accurate information.

PDF CONTENT:
${pdfText.slice(0, 6000)}

Think through this step-by-step:
1. Scan for patient name - look for "Name:" or "Patient Name:" fields
2. Find MRN/Hospital number
3. Locate age and gender
4. Verify information from multiple sources if available

Return ONLY JSON:
{
  "name": "",
  "mrn": "",
  "age": 0,
  "gender": "",
  "confidence_notes": "what you found and how confident you are",
  "sources": ["where you found each piece of data"]
}`;

  const response = await fetch(GEMMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 600,
    }),
  });

  const payload = await response.json();
  let content = payload.choices?.[0]?.message?.content || "";
  if (content.includes("```json")) {
    content = content.split("```json")[1].split("```")[0].trim();
  } else if (content.includes("```")) {
    content = content.split("```")[1].split("```")[0].trim();
  }

  return {
    step: "Step 2: Demographics Extraction",
    thinking: content,
    tokens: payload.usage?.total_tokens || 0
  };
}

// Step 3: Extract and cross-validate risk scores
async function step3_ExtractRiskScores(pdfText) {
  const prompt = `You are extracting risk assessment scores from a hospital discharge summary.
These are CRITICAL clinical values - be EXTRA careful and cross-verify.

PDF CONTENT:
${pdfText.slice(0, 8000)}

Think through this step-by-step:
1. Look for "Fall Risk Assessment Tool" - extract score AND level
2. Find "DVT" risk assessment - extract score AND level
3. Find "Pressure Ulcer" risk assessment - extract score AND level
4. Look for "Aspiration Risk" - extract score AND level
5. Find EWS (Early Warning Score)
6. Find GCS (Glasgow Coma Scale) - extract E, M, V components

For EACH score found:
- Verify the numeric value
- Note the risk level (Low/Moderate/High/Highest)
- Cross-check if multiple mentions exist

Return ONLY JSON:
{
  "fall_risk": {"score": 0, "level": "", "verified": true/false},
  "dvt_risk": {"score": 0, "level": "", "verified": true/false},
  "pressure_ulcer_risk": {"score": 0, "level": "", "verified": true/false},
  "aspiration_risk": {"score": 0, "level": "", "verified": true/false},
  "ews_score": 0,
  "gcs": {"eyes": 0, "motor": 0, "verbal": 0, "total": 0},
  "validation_notes": "any discrepancies or concerns"
}`;

  const response = await fetch(GEMMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 1000,
    }),
  });

  const payload = await response.json();
  let content = payload.choices?.[0]?.message?.content || "";
  if (content.includes("```json")) {
    content = content.split("```json")[1].split("```")[0].trim();
  } else if (content.includes("```")) {
    content = content.split("```")[1].split("```")[0].trim();
  }

  return {
    step: "Step 3: Risk Scores Extraction (with validation)",
    thinking: content,
    tokens: payload.usage?.total_tokens || 0
  };
}

// Step 4: Extract vitals with normal range comparison
async function step4_ExtractVitals(pdfText) {
  const prompt = `You are extracting vital signs from a hospital discharge summary.
Compare values against normal ranges and flag abnormalities.

PDF CONTENT:
${pdfText.slice(0, 6000)}

Think through this:
1. Find Vital Assessment section
2. Extract BP, Pulse, Temp, Resp Rate, SpO2, Pain Score, GRBS
3. Check each value:
   - BP: Normal <120/80, Elevated 120-129/<80, High ≥130/80
   - Pulse: Normal 60-100
   - SpO2: Normal ≥95%
   - GRBS: Normal <100, Prediabetic 100-125, Diabetic ≥126

Return ONLY JSON:
{
  "bp": {"systolic": 0, "diastolic": 0, "status": "normal/elevated/high"},
  "pulse": {"value": 0, "status": "normal/bradycardia/tachycardia"},
  "temperature": {"value": 0, "unit": "F"},
  "resp_rate": 0,
  "spo2": {"value": 0, "status": "normal/low"},
  "pain_score": {"value": 0, "scale": 10},
  "grbs": {"value": 0, "interpretation": "normal/prediabetic/diabetic"},
  "abnormal_flags": ["list any abnormal values found"]
}`;

  const response = await fetch(GEMMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 800,
    }),
  });

  const payload = await response.json();
  let content = payload.choices?.[0]?.message?.content || "";
  if (content.includes("```json")) {
    content = content.split("```json")[1].split("```")[0].trim();
  } else if (content.includes("```")) {
    content = content.split("```")[1].split("```")[0].trim();
  }

  return {
    step: "Step 4: Vitals Extraction (with clinical interpretation)",
    thinking: content,
    tokens: payload.usage?.total_tokens || 0
  };
}

// Step 5: Extract functional status (ADLs)
async function step5_ExtractFunctionalStatus(pdfText) {
  const prompt = `You are extracting functional status - Activities of Daily Living (ADLs).
This indicates how much assistance the patient needs.

PDF CONTENT:
${pdfText.slice(0, 6000)}

Look for "Ability to perform activities of daily living" or similar section.
For each activity (Bathing, Dressing, Eating, Walking, Toilet Use), note the level:
- Independent
- Assisted
- Dependent

Return ONLY JSON:
{
  "functional_status": {
    "bathing": "Independent/Assisted/Dependent",
    "dressing": "Independent/Assisted/Dependent",
    "eating": "Independent/Assisted/Dependent",
    "walking": "Independent/Assisted/Dependent",
    "toilet_use": "Independent/Assisted/Dependent"
  },
  "overall_assistance_needs": "None/Partial/Full/Complete assistance required",
  "mobility_notes": "any additional mobility information"
}`;

  const response = await fetch(GEMMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 600,
    }),
  });

  const payload = await response.json();
  let content = payload.choices?.[0]?.message?.content || "";
  if (content.includes("```json")) {
    content = content.split("```json")[1].split("```")[0].trim();
  } else if (content.includes("```")) {
    content = content.split("```")[1].split("```")[0].trim();
  }

  return {
    step: "Step 5: Functional Status Extraction",
    thinking: content,
    tokens: payload.usage?.total_tokens || 0
  };
}

// Step 6: Extract diagnosis, allergies, medications
async function step6_ExtractClinicalData(pdfText) {
  const prompt = `You are extracting clinical data: diagnosis, allergies, medications.

PDF CONTENT:
${pdfText.slice(0, 8000)}

Extract:
1. Principal diagnosis with ICD code if available
2. Secondary diagnoses
3. Known allergies
4. Current medications
5. Investigations ordered
6. Nursing needs identified

Return ONLY JSON:
{
  "diagnosis": {
    "principal": "",
    "icd_code": "",
    "secondary": []
  },
  "allergies": [],
  "medications": [{"name": "", "dose": "", "frequency": ""}],
  "investigations": [],
  "nursing_needs": []
}`;

  const response = await fetch(GEMMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 1000,
    }),
  });

  const payload = await response.json();
  let content = payload.choices?.[0]?.message?.content || "";
  if (content.includes("```json")) {
    content = content.split("```json")[1].split("```")[0].trim();
  } else if (content.includes("```")) {
    content = content.split("```")[1].split("```")[0].trim();
  }

  return {
    step: "Step 6: Clinical Data Extraction",
    thinking: content,
    tokens: payload.usage?.total_tokens || 0
  };
}

// Step 7: Final assembly with validation
async function step7_FinalAssembly(steps, pdfText) {
  const prompt = `You are assembling the final structured data from a discharge summary.
Review all the extraction steps below and create a validated final JSON.

PREVIOUS EXTRACTION STEPS:
${steps.map(s => `${s.step}: ${s.thinking}`).join("\n\n")}

CRITICAL VALIDATION TASKS:
1. Cross-check patient demographics across steps
2. Verify risk scores are consistent
3. Ensure vitals have appropriate units
4. Check for any missing critical fields
5. Flag any inconsistencies found

Create the final validated JSON:
{
  "patient": {
    "name": "",
    "mrn": "",
    "age": 0,
    "gender": ""
  },
  "vitals": {
    "bp": {"systolic": 0, "diastolic": 0},
    "pulse": 0,
    "temperature": "",
    "spo2": 0,
    "resp_rate": 0,
    "pain_score": 0,
    "grbs": 0
  },
  "risk_scores": {
    "fall_risk": {"score": 0, "level": ""},
    "dvt_risk": {"score": 0, "level": ""},
    "pressure_ulcer_risk": {"score": 0, "level": ""},
    "aspiration_risk": {"score": 0, "level": ""},
    "ews_score": 0,
    "gcs": {"eyes": 0, "motor": 0, "verbal": 0, "total": 0}
  },
  "functional_status": {
    "bathing": "",
    "dressing": "",
    "eating": "",
    "walking": "",
    "toilet_use": "",
    "overall_assistance": ""
  },
  "diagnosis": {
    "principal": "",
    "icd_code": "",
    "secondary": []
  },
  "allergies": [],
  "medications": [],
  "investigations": [],
  "nursing_needs": [],
  "validation_summary": {
    "confidence_level": "high/medium/low",
    "inconsistencies_found": [],
    "missing_critical_fields": [],
    "data_quality_notes": ""
  }
}`;

  const response = await fetch(GEMMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });

  const payload = await response.json();
  let content = payload.choices?.[0]?.message?.content || "";
  if (content.includes("```json")) {
    content = content.split("```json")[1].split("```")[0].trim();
  } else if (content.includes("```")) {
    content = content.split("```")[1].split("```")[0].trim();
  }

  return {
    step: "Step 7: Final Assembly & Validation",
    thinking: content,
    tokens: payload.usage?.total_tokens || 0
  };
}

async function processOptionB(pdfPath) {
  const pdfName = path.basename(pdfPath);
  console.log(`\n📄 Processing: ${pdfName}`);
  console.log(`📋 Method: Option B (Thinking/ReAct-Style Extraction)`);

  const startTime = Date.now();
  const steps = [];
  let totalTokens = 0;

  try {
    const pdfText = await extractTextFromPdf(pdfPath);

    console.log(`\n🔍 Step 1: Analyzing document structure...`);
    const step1 = await step1_AnalyzeDocument(pdfText, pdfName);
    steps.push(step1);
    totalTokens += step1.tokens;
    console.log(`   ✅ Completed (${step1.tokens} tokens)`);

    console.log(`\n👤 Step 2: Extracting demographics...`);
    const step2 = await step2_ExtractDemographics(pdfText);
    steps.push(step2);
    totalTokens += step2.tokens;
    console.log(`   ✅ Completed (${step2.tokens} tokens)`);

    console.log(`\n⚠️  Step 3: Extracting risk scores (with validation)...`);
    const step3 = await step3_ExtractRiskScores(pdfText);
    steps.push(step3);
    totalTokens += step3.tokens;
    console.log(`   ✅ Completed (${step3.tokens} tokens)`);

    console.log(`\n📊 Step 4: Extracting vitals (with clinical interpretation)...`);
    const step4 = await step4_ExtractVitals(pdfText);
    steps.push(step4);
    totalTokens += step4.tokens;
    console.log(`   ✅ Completed (${step4.tokens} tokens)`);

    console.log(`\n🚶 Step 5: Extracting functional status...`);
    const step5 = await step5_ExtractFunctionalStatus(pdfText);
    steps.push(step5);
    totalTokens += step5.tokens;
    console.log(`   ✅ Completed (${step5.tokens} tokens)`);

    console.log(`\n💊 Step 6: Extracting clinical data...`);
    const step6 = await step6_ExtractClinicalData(pdfText);
    steps.push(step6);
    totalTokens += step6.tokens;
    console.log(`   ✅ Completed (${step6.tokens} tokens)`);

    console.log(`\n🔧 Step 7: Final assembly & validation...`);
    const step7 = await step7_FinalAssembly(steps, pdfText);
    steps.push(step7);
    totalTokens += step7.tokens;
    console.log(`   ✅ Completed (${step7.tokens} tokens)`);

    const endTime = Date.now();

    // Parse final JSON from step 7
    let finalData = null;
    try {
      const cleanThinking = step7.thinking.includes("{") ? step7.thinking.substring(step7.thinking.indexOf("{")) : step7.thinking;
      finalData = JSON.parse(cleanThinking);
    } catch (e) {
      console.error(`   ⚠️ Could not parse final JSON: ${e.message}`);
    }

    return {
      method: "Option B (Thinking/ReAct)",
      latency_ms: endTime - startTime,
      tokens_used: totalTokens,
      steps: steps.map(s => ({ step: s.step, tokens: s.tokens })),
      data: finalData,
      raw_thinking: steps.map(s => `${s.step}:\n${s.thinking}`).join("\n\n---\n\n")
    };

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return { error: error.message, method: "Option B", steps_completed: steps.length };
  }
}

// Run if called directly
if (require.main === module) {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: node optionB_extraction.cjs <pdf-path>");
    process.exit(1);
  }
  processOptionB(pdfPath).then(result => {
    console.log("\n\n=== FINAL RESULT ===");
    console.log(JSON.stringify(result.data || result, null, 2));
  }).catch(console.error);
}

module.exports = { processOptionB };
