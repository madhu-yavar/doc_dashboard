/**
 * Prescription Diagnosis Extractor Skill
 * Extracts diagnosis/indications from prescription documents using Gemini Vision
 * Stage 3: Extract handwritten diagnosis and symptoms
 */

class PrescriptionDiagnosisExtractorSkill {
  constructor(config = {}) {
    this.name = "Prescription Diagnosis Extractor";
    this.version = "2.0.0";
    this.config = config;
    this.geminiVisionClient = null;

    if (config.geminiVisionClient) {
      this.geminiVisionClient = config.geminiVisionClient;
    }
  }

  getGeminiClient() {
    if (!this.geminiVisionClient) {
      const GeminiVisionClientTool = require("../../tools/llm/gemini_vision_client.tool.cjs");
      this.geminiVisionClient = new GeminiVisionClientTool({
        apiKey: this.config.geminiApiKey || process.env.GEMINI_API_KEY,
        model: this.config.geminiModel || "gemini-2.5-flash",
        timeout: this.config.timeout || 120000
      });
    }
    return this.geminiVisionClient;
  }

  parseModelJson(content) {
    const normalized = String(content || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const candidates = [];
    candidates.push(normalized);

    const firstBrace = normalized.indexOf("{");
    const lastBrace = normalized.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(normalized.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (_error) {
        continue;
      }
    }

    throw new Error("Unable to parse model JSON response");
  }

  buildPrompt(options = {}) {
    const { pdfText = "" } = options;

    return `You are an expert at extracting diagnosis information from handwritten prescription documents.

Your task is to carefully analyze the prescription document and extract DIAGNOSIS/INDICATION information.

${pdfText ? `OCR TEXT FROM DOCUMENT:\n${pdfText.substring(0, 3000)}\n\n` : ""}

EXTRACT THE FOLLOWING DIAGNOSIS INFORMATION:
- Primary diagnosis or reason for prescription (if visible)
- Secondary diagnoses (if any)
- Symptoms mentioned (if any)
- Clinical indications (if any)

QUALITY RULES:
- If handwriting is unclear, make your best effort and note low confidence
- If diagnosis is not visible, use null
- Keep diagnosis text as written (don't normalize or code)
- Note any abbreviations used

Return ONLY valid JSON in this format:
{
  "primary_diagnosis": null,
  "secondary_diagnoses": [],
  "symptoms": [],
  "indications": [],
  "clinical_notes": "",
  "confidence": "high/medium/low"
}

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  /**
   * Execute the diagnosis extraction
   * @param {object} context - Execution context
   * @param {string} context.filePath - Path to the PDF/image file
   * @param {string} context.pdfText - Optional OCR text from PDF
   * @param {Function} context.onProgress - Progress callback
   * @returns {Promise<object>} Extraction result
   */
  async execute(context) {
    const { filePath, pdfText = "", onProgress } = context;

    if (!filePath) {
      return {
        success: false,
        step: "prescription_diagnosis_extractor",
        error: "File path is required"
      };
    }

    try {
      const geminiClient = this.getGeminiClient();

      if (onProgress) {
        onProgress({
          type: "info",
          step: "prescription_diagnosis_extractor",
          status: "processing",
          message: "Extracting diagnosis information..."
        });
      }

      const prompt = this.buildPrompt({ pdfText });

      const result = await geminiClient.execute(prompt, {
        images: [filePath],
        temperature: 0.1,
        maxTokens: 1500,
        systemPrompt: "You are a medical document extraction expert specializing in diagnosis information from prescriptions."
      });

      if (!result.success) {
        return {
          success: false,
          step: "prescription_diagnosis_extractor",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);

      if (onProgress) {
        onProgress({
          type: "success",
          step: "prescription_diagnosis_extractor",
          status: "complete",
          message: data.primary_diagnosis ? `Found: ${data.primary_diagnosis}` : "No diagnosis found",
          data: {
            diagnosisFound: !!data.primary_diagnosis,
            confidence: data.confidence
          }
        });
      }

      return {
        success: true,
        step: "prescription_diagnosis_extractor",
        data: {
          diagnosis: {
            principal: data.primary_diagnosis || null,
            secondary: data.secondary_diagnoses || [],
            symptoms: data.symptoms || [],
            indications: data.indications || [],
            clinical_notes: data.clinical_notes || ""
          },
          confidence: data.confidence || "medium"
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "prescription_diagnosis_extractor",
        error: error.message
      };
    }
  }
}

module.exports = PrescriptionDiagnosisExtractorSkill;
