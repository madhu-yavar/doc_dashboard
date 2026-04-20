/**
 * Prescription Patient Extractor Skill
 * Extracts patient information from prescription documents using Qwen Vision
 */

class PrescriptionPatientExtractorSkill {
  constructor(config = {}) {
    this.name = "Prescription Patient Extractor";
    this.version = "1.0.0";
    this.config = config;
    this.qwenVisionClient = null;

    if (config.qwenVisionClient) {
      this.qwenVisionClient = config.qwenVisionClient;
    }
  }

  getQwenClient() {
    if (!this.qwenVisionClient) {
      const QwenVisionClientTool = require("../../tools/llm/qwen_vision_client.tool.cjs");
      this.qwenVisionClient = new QwenVisionClientTool({
        baseUrl: this.config.qwenBaseUrl || process.env.QWEN_URL || "http://206.1.62.28:8001/v1/chat/completions",
        model: this.config.qwenModel || "cyankiwi/Qwen3-VL-30B-A3B-Instruct-AWQ-4bit",
        timeout: this.config.timeout || 120000
      });
    }
    return this.qwenVisionClient;
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

    return `You are an expert at extracting patient information from handwritten prescription documents.

Your task is to carefully analyze the prescription document and extract PATIENT INFORMATION ONLY.

${pdfText ? `OCR TEXT FROM DOCUMENT:\n${pdfText.substring(0, 3000)}\n\n` : ""}

EXTRACT THE FOLLOWING PATIENT INFORMATION:
- Patient name (if visible)
- Age/Gender (if visible)
- Patient ID/MRN (if visible)
- Date of prescription/visit (if visible)
- Any other patient identifiers (if visible)

QUALITY RULES:
- If handwriting is unclear, make your best effort and note low confidence
- If a field is not visible or unclear, use null
- Keep names as written (don't normalize)
- Preserve dates exactly as written

Return ONLY valid JSON in this format:
{
  "name": null,
  "age": null,
  "gender": null,
  "mrn": null,
  "date": null,
  "other_identifiers": [],
  "confidence": "high/medium/low"
}

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  /**
   * Execute the patient extraction
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
        step: "prescription_patient_extractor",
        error: "File path is required"
      };
    }

    try {
      const qwenClient = this.getQwenClient();

      if (onProgress) {
        onProgress({
          type: "info",
          step: "prescription_patient_extractor",
          status: "processing",
          message: "Extracting patient information..."
        });
      }

      const prompt = this.buildPrompt({ pdfText });

      const result = await qwenClient.execute(prompt, {
        images: [filePath],
        temperature: 0.1,
        maxTokens: 1000,
        systemPrompt: "You are a medical document extraction expert specializing in patient information from prescriptions."
      });

      if (!result.success) {
        return {
          success: false,
          step: "prescription_patient_extractor",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);

      if (onProgress) {
        onProgress({
          type: "success",
          step: "prescription_patient_extractor",
          status: "complete",
          message: data.name ? `Found patient: ${data.name}` : "No patient information found",
          data: {
            patientFound: !!data.name,
            confidence: data.confidence
          }
        });
      }

      return {
        success: true,
        step: "prescription_patient_extractor",
        data: {
          patient: {
            name: data.name || null,
            age: data.age || null,
            gender: data.gender || null,
            mrn: data.mrn || data.id || null,
            date: data.date || null
          },
          other_identifiers: data.other_identifiers || [],
          confidence: data.confidence || "medium"
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "prescription_patient_extractor",
        error: error.message
      };
    }
  }
}

module.exports = PrescriptionPatientExtractorSkill;
