/**
 * Prescription Doctor Extractor Skill
 * Extracts doctor/physician information from prescription documents using Gemma Vision
 * Stage 1: Extract printed doctor information
 */

class PrescriptionDoctorExtractorSkill {
  constructor(config = {}) {
    this.name = "Prescription Doctor Extractor";
    this.version = "2.0.0";
    this.config = config;
    this.gemmaVisionClient = null;

    if (config.gemmaVisionClient) {
      this.gemmaVisionClient = config.gemmaVisionClient;
    }
  }

  getGemmaClient() {
    if (!this.gemmaVisionClient) {
      const GemmaVisionClientTool = require("../../tools/llm/gemma_vision_client.tool.cjs");
      this.gemmaVisionClient = new GemmaVisionClientTool({
        baseUrl: this.config.gemmaBaseUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions",
        model: this.config.gemmaModel || process.env.GEMMA_MODEL || "google/gemma-4-31B-it",
        timeout: this.config.timeout || 120000
      });
    }
    return this.gemmaVisionClient;
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

    return `You are an expert at extracting doctor/physician information from handwritten prescription documents.

Your task is to carefully analyze the prescription document and extract DOCTOR INFORMATION.

${pdfText ? `OCR TEXT FROM DOCUMENT:\n${pdfText.substring(0, 3000)}\n\n` : ""}

EXTRACT THE FOLLOWING DOCTOR INFORMATION:
- Doctor's name (if visible)
- Doctor's qualifications/degrees (MBBS, MD, etc.) - if visible
- Doctor's registration number - if visible
- Doctor's specialty (if mentioned)
- Signature presence (note if signature is visible)
- Date of signing (if visible)

QUALITY RULES:
- If handwriting is unclear, make your best effort and note low confidence
- If a field is not visible or unclear, use null
- Keep names as written (don't normalize)
- Include all qualifications if listed
- Preserve registration numbers exactly as written

Return ONLY valid JSON in this format:
{
  "name": null,
  "qualifications": [],
  "registration_number": null,
  "specialty": null,
  "signature_present": false,
  "date": null,
  "confidence": "high/medium/low"
}

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  /**
   * Execute the doctor extraction
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
        step: "prescription_doctor_extractor",
        error: "File path is required"
      };
    }

    try {
      const gemmaClient = this.getGemmaClient();

      if (onProgress) {
        onProgress({
          type: "info",
          step: "prescription_doctor_extractor",
          status: "processing",
          message: "Extracting doctor information..."
        });
      }

      const prompt = this.buildPrompt({ pdfText });

      const result = await gemmaClient.execute(prompt, {
        images: [filePath],
        temperature: 0.1,
        maxTokens: 1000
      });

      if (!result.success) {
        return {
          success: false,
          step: "prescription_doctor_extractor",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);

      if (onProgress) {
        onProgress({
          type: "success",
          step: "prescription_doctor_extractor",
          status: "complete",
          message: data.name ? `Found doctor: ${data.name}` : "No doctor information found",
          data: {
            doctorFound: !!data.name,
            confidence: data.confidence
          }
        });
      }

      // Combine name with qualifications for display
      let displayName = data.name || "";
      if (displayName && data.qualifications && data.qualifications.length > 0) {
        displayName += ` (${data.qualifications.join(", ")})`;
      }

      return {
        success: true,
        step: "prescription_doctor_extractor",
        data: {
          doctor: {
            name: displayName || null,
            qualifications: data.qualifications || [],
            registration_number: data.registration_number || null,
            specialty: data.specialty || null,
            signature_present: data.signature_present || false,
            date: data.date || null
          },
          confidence: data.confidence || "medium"
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "prescription_doctor_extractor",
        error: error.message
      };
    }
  }
}

module.exports = PrescriptionDoctorExtractorSkill;
