/**
 * Lab Report Extractor Agent
 * Optimized for laboratory reports and investigation results
 * Focuses on Labs + Vitals, skips most clinical narrative sections
 */

const PDFReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");
const GemmaClientTool = require("../tools/llm/gemma_client.tool.cjs");
const PromptBuilderTool = require("../tools/llm/prompt_builder.tool.cjs");
const ProvenanceBuilderTool = require("../tools/clinical/provenance_builder.tool.cjs");

// Skills - selective for lab reports
const DocumentAnalyzerSkill = require("../skills/extraction/document_analyzer.skill.cjs");
const DemographicsExtractorSkill = require("../skills/extraction/demographics_extractor.skill.cjs");
const VitalsExtractorSkill = require("../skills/extraction/vitals_extractor.skill.cjs");

class LabReportExtractorAgent {
  constructor(config = {}) {
    this.name = "Lab Report Extractor";
    this.version = "1.0.0";
    this.type = "lab_report_extractor";
    this.documentType = "lab_report";

    // Initialize tools
    this.pdfReader = new PDFReaderTool(config);
    this.gemmaClient = new GemmaClientTool(config.gemma || {});
    this.promptBuilder = new PromptBuilderTool(config);
    this.provenanceBuilder = new ProvenanceBuilderTool(config);

    // LAB REPORT SPECIFIC - Minimal skills
    this.skills = [
      new DocumentAnalyzerSkill(),
      new DemographicsExtractorSkill(),
      new VitalsExtractorSkill()  // Some lab reports include basic vitals
    ];

    this.config = {
      maxRetries: 2,
      timeoutPerStep: 90000,
      totalTimeout: 180000,
      requireAllSteps: false,
      logSteps: true,
      saveIntermediates: true,
      ...config
    };
  }

  async process(pdfPath, options = {}) {
    const startTime = Date.now();
    const pdfName = options.pdfName || pdfPath.split("/").pop();
    const onProgress = options.onProgress || null;

    try {
      console.log(`\n🧪 Processing LAB REPORT: ${pdfName}`);

      if (onProgress) {
        onProgress({ type: 'start', pdfName, totalSteps: this.skills.length, documentType: this.documentType });
      }

      // Step 1: Read PDF
      const pdfResult = await this.pdfReader.execute(pdfPath, 50000);
      if (!pdfResult.success) {
        throw new Error(`Failed to read PDF: ${pdfResult.error}`);
      }

      const pdfText = pdfResult.text;
      console.log(`   📖 PDF read: ${pdfText.length} chars, ${pdfResult.pages} pages`);

      // Step 2: Extract lab results using specialized prompt
      const labResult = await this.extractLabResults(pdfText);
      const steps = [
        { step: 'document_analyzer', success: true, data: { document_type: 'Lab Report' } },
        { step: 'lab_extractor', success: labResult.success, data: labResult.data, usage: labResult.usage }
      ];

      const finalResult = this.assembleFinalResult(steps, pdfName);
      const endTime = Date.now();

      if (onProgress) {
        onProgress({
          type: 'complete',
          pdfName,
          latency: endTime - startTime,
          tokensUsed: labResult.usage?.totalTokens || 0
        });
      }

      return {
        success: true,
        agent: this.name,
        agentType: this.type,
        documentType: this.documentType,
        pdfName: pdfName,
        pdfPath: pdfPath,
        latency: endTime - startTime,
        tokensUsed: labResult.usage?.totalTokens || 0,
        steps: steps.map(s => ({
          step: s.step,
          success: s.success,
          tokens: s.usage?.totalTokens || 0,
          latency: s.usage?.latency || 0,
          dataKeys: s.data ? Object.keys(s.data) : [],
          error: s.error || null
        })),
        data: finalResult
      };

    } catch (error) {
      console.error(`❌ Lab report extractor failed: ${error.message}`);
      return {
        success: false,
        agent: this.name,
        agentType: this.type,
        documentType: this.documentType,
        pdfName: pdfName,
        pdfPath: pdfPath,
        error: error.message,
        data: null
      };
    }
  }

  async extractLabResults(pdfText) {
    const startTime = Date.now();

    const prompt = `You are a specialized laboratory data extractor. Extract ALL laboratory test results from the following text.

Return a JSON object with this structure:
{
  "patient": {
    "name": "Patient name if available",
    "mrn": "MRN if available",
    "age": age if available,
    "gender": "gender if available"
  },
  "report_meta": {
    "report_date": "Date of report",
    "report_type": "Type of lab report",
    "ordering_physician": "Name if available"
  },
  "lab_results": [
    {
      "test_name": "Name of the test",
      "value": "Result value",
      "unit": "Unit of measurement",
      "reference_range": "Normal range if provided",
      "flag": "abnormal flag (High/Low/Critical/Normal)",
      "status": "status if provided"
    }
  ],
  "vitals": {
    "bp": "Blood pressure if present",
    "pulse": "Pulse if present",
    "temperature": "Temperature if present"
  }
}

IMPORTANT:
- Extract EVERY test result, even if values are normal
- Preserve exact test names from the document
- Include units and reference ranges
- Mark abnormal results correctly
- If a test has multiple components, extract each component separately

Document text:
${pdfText.substring(0, 15000)}

Return only valid JSON, no explanation.`;

    try {
      const response = await this.gemmaClient.generate({
        prompt,
        maxTokens: 4000,
        temperature: 0.1
      });

      const usage = {
        totalTokens: response.usage?.totalTokens || 0,
        latency: Date.now() - startTime
      };

      // Parse JSON response
      let data;
      try {
        const cleaned = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        data = JSON.parse(cleaned);
      } catch (parseError) {
        console.warn('Failed to parse lab results as JSON, using fallback extraction');
        data = this.fallbackLabExtraction(pdfText);
      }

      return {
        success: true,
        data,
        usage
      };

    } catch (error) {
      console.error('LLM lab extraction failed:', error.message);
      return {
        success: true,
        data: this.fallbackLabExtraction(pdfText),
        usage: { totalTokens: 0, latency: Date.now() - startTime }
      };
    }
  }

  fallbackLabExtraction(pdfText) {
    // Regex-based fallback for common lab patterns
    const results = {
      patient: {},
      report_meta: {
        report_date: new Date().toISOString().split('T')[0],
        report_type: 'Laboratory Report'
      },
      lab_results: [],
      vitals: {}
    };

    // Extract patient info
    const nameMatch = pdfText.match(/Patient\s*(?:Name|)\s*[:]\s*([A-Z][A-Z\s]+)/i);
    if (nameMatch) results.patient.name = nameMatch[1].trim();

    const mrnMatch = pdfText.match(/(?:Hospital No|MRN|Patient ID)\s*[:]\s*([A-Z0-9]+)/i);
    if (mrnMatch) results.patient.mrn = mrnMatch[1];

    // Extract lab values (common pattern: Test Name: Value Unit (Reference))
    const labPatterns = [
      { regex: /H[bo]globin\s*[:]\s*([\d.]+)\s*(g\/dL|%)/gi, test: 'Hemoglobin' },
      { regex: /WBC\s*[:]\s*([\d.]+)\s*(x10\^9\/L|cells\/cmm)/gi, test: 'WBC' },
      { regex: /Platelet\s*[:]\s*([\d.]+)\s*(x10\^9\/L|cells\/cmm)/gi, test: 'Platelet Count' },
      { regex: /RBC\s*[:]\s*([\d.]+)\s*(x10\^12\/L|mill\/cmm)/gi, test: 'RBC' },
      { regex: /Hct\s*[:]\s*([\d.]+)\s*%/gi, test: 'Hematocrit' },
      { regex: /(?:Blood Sugar|Glucose|RBS|FBS|PPBS)\s*[:]\s*([\d.]+)\s*(mg\/dL)/gi, test: 'Glucose' },
      { regex: /Creatinine\s*[:]\s*([\d.]+)\s*(mg\/dL)/gi, test: 'Creatinine' },
      { regex: /Sodium\s*[:]\s*([\d.]+)\s*(mEq\/L|mmol\/L)/gi, test: 'Sodium' },
      { regex: /Potassium\s*[:]\s*([\d.]+)\s*(mEq\/L|mmol\/L)/gi, test: 'Potassium' },
    ];

    for (const pattern of labPatterns) {
      const matches = [...pdfText.matchAll(pattern.regex)];
      for (const match of matches) {
        results.lab_results.push({
          test_name: pattern.test,
          value: match[1],
          unit: match[2] || '',
          reference_range: '',
          flag: '',
          status: 'detected'
        });
      }
    }

    return results;
  }

  assembleFinalResult(steps, pdfName) {
    const result = {
      meta: {
        pdf_file: pdfName,
        processed_at: new Date().toISOString(),
        agent_version: this.version,
        document_type: this.documentType,
        extraction_focus: "Laboratory test results and basic vitals"
      },
      patient: {},
      report_meta: {},
      lab_results: [],
      vitals: {},
      provenance: {}
    };

    for (const step of steps) {
      if (!step.success || !step.data) continue;
      const data = step.data;

      if (data.patient) result.patient = { ...result.patient, ...data.patient };
      if (data.report_meta) result.report_meta = { ...result.report_meta, ...data.report_meta };
      if (data.lab_results) result.lab_results = [...result.lab_results, ...data.lab_results];
      if (data.vitals) result.vitals = { ...result.vitals, ...data.vitals };
      if (data.provenance) result.provenance = { ...result.provenance, ...data.provenance };
    }

    return result;
  }
}

module.exports = LabReportExtractorAgent;
