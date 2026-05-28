/**
 * Prescription Patient Extractor Skill
 * Extracts patient information from prescription documents using Gemma Vision
 * Stage 1: Extract printed patient demographics
 */

class PrescriptionPatientExtractorSkill {
  constructor(config = {}) {
    this.name = "Prescription Patient Extractor";
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
        model: this.config.gemmaModel || process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it",
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

  extractLabeledValue(pdfText, labels) {
    const text = String(pdfText || "");
    for (const label of labels) {
      const pattern = new RegExp(`${label}\\s*[:\\-]?\\s*([A-Z0-9\\/.-]{3,})`, "i");
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return null;
  }

  extractTextFallbacks(pdfText) {
    const hospitalNo = this.extractLabeledValue(pdfText, [
      "Hospital\\s*No",
      "MR\\s*No",
      "UHID",
      "Patient\\s*ID",
      "HN",
      "File\\s*No"
    ]);
    const opdNumber = this.extractLabeledValue(pdfText, [
      "OPD?\\s*No",
      "OP\\s*Number",
      "OP\\s*No"
    ]);

    return {
      mrn: hospitalNo,
      opd_number: opdNumber
    };
  }

  buildPrompt(options = {}) {
    const { pdfText = "" } = options;

    return `You are an expert at extracting patient information from medical prescription documents.

Your task is to carefully analyze the prescription document and extract PATIENT DEMOGRAPHIC INFORMATION ONLY.

${pdfText ? `OCR TEXT FROM DOCUMENT:\n${pdfText.substring(0, 3000)}\n\n` : ""}

EXTRACT THE FOLLOWING PATIENT INFORMATION:
- Patient name (if visible)
- Age as a NUMBER only (e.g., 77, not "77 Yrs" or "77 years")
- Gender (Male/Female/Other)

CRITICAL FIELD DISTINCTIONS:
- MRN (Medical Record Number) is typically labeled as: "MR No", "Hospital No", "HN", "Patient ID", "UHID", "File No"
- OPD Number is labeled as: "OP No", "OPD No", "OP Number"
- Episode Number is labeled as: "Episode No", "Episode No.", "Ep. No"
- Each field goes to its respective field - DO NOT mix them

- Date of prescription/visit (if visible)

Return ONLY valid JSON in this format:
{
  "name": null,
  "age": null,
  "gender": null,
  "mrn": null,
  "opd_number": null,
  "episode_number": null,
  "date": null,
  "confidence": "high/medium/low"
}

QUALITY RULES:
- If handwriting is unclear, make your best effort and note low confidence
- If a field is not visible or unclear, use null
- Keep names as written (don't normalize)
- Preserve dates exactly as written
- IMPORTANT: Age must be a number only, no text suffix
- CRITICAL: Match each field to its correct label - "Hospital No" → mrn, "OP No" → opd_number, "Episode No" → episode_number

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
      const gemmaClient = this.getGemmaClient();

      if (onProgress) {
        onProgress({
          type: "info",
          step: "prescription_patient_extractor",
          status: "processing",
          message: "Extracting patient information..."
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
          step: "prescription_patient_extractor",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);
      const textFallbacks = this.extractTextFallbacks(pdfText);

      // Clean up age field - extract numeric value if it has suffixes like "77 Yrs"
      let cleanedAge = data.age || null;
      if (cleanedAge !== null) {
        if (typeof cleanedAge === 'string') {
          const numericMatch = cleanedAge.match(/\d+/);
          cleanedAge = numericMatch ? parseInt(numericMatch[0]) : null;
        } else if (typeof cleanedAge !== 'number') {
          cleanedAge = null;
        }
      }

      const resolvedMrn = data.mrn || textFallbacks.mrn || null;
      const resolvedOpdNumber = data.opd_number || textFallbacks.opd_number || null;
      const resolvedEpisodeNumber = data.episode_number || null;
      const visitLikeMrn = String(resolvedMrn || "").trim();
      const blockedAsMrn =
        visitLikeMrn &&
        (
          new RegExp(`^${String(resolvedOpdNumber || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(visitLikeMrn) ||
          /^(?:O\d{5,}|OPD?\s*[-:]?\s*[A-Z0-9-]+|EP(?:ISODE)?\s*[-:]?\s*[A-Z0-9-]+|VISIT\s*[-:]?\s*[A-Z0-9-]+)/i.test(visitLikeMrn)
        );

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
            age: cleanedAge,
            gender: data.gender || null,
            // Only extract true MRN, not OPD or Episode numbers
            hospital_no: blockedAsMrn ? null : resolvedMrn,
            mrn: blockedAsMrn ? null : resolvedMrn,
            opd_number: resolvedOpdNumber,
            episode_number: resolvedEpisodeNumber,
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
