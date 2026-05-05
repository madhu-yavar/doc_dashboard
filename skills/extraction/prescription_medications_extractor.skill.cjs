/**
 * Prescription Medications Extractor Skill
 * Extracts ALL medications from prescription documents using Gemini Vision
 * Designed for Stage 3: Handwritten medication extraction
 */

class PrescriptionMedicationsExtractorSkill {
  constructor(config = {}) {
    this.name = "Prescription Medications Extractor";
    this.version = "3.0.0";
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
        timeout: this.config.timeout || 180000
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

    return `You are an expert at extracting structured data from handwritten prescription documents.

Your task is to carefully analyze the prescription document and extract ALL visible information.

${pdfText ? `OCR TEXT FROM DOCUMENT:\n${pdfText.substring(0, 8000)}\n\n` : ""}

EXTRACT THE FOLLOWING INFORMATION:

1. PATIENT INFORMATION:
   - Patient name (if visible)
   - Age/Gender (if visible)
   - Patient ID/MRN (if visible)
   - Date of prescription (if visible)

2. DOCTOR INFORMATION:
   - Doctor name (if visible)
   - Doctor's registration number (if visible)
   - Signature (note if present)

3. MEDICATIONS:
   For EACH medication found, extract:
   - Medication name (brand or generic)
   - Dosage (strength, e.g., 500mg, 5ml)
   - Form (tablet, syrup, injection, etc.)
   - Quantity prescribed
   - Frequency (OD, BD, TDS, QID, SOS, PRN, or written instructions)
   - Duration (if mentioned, e.g., "5 days", "1 week")
   - Route (oral, IV, IM, etc. if specified)
   - Instructions (any additional notes)

4. DIAGNOSIS/INDICATION:
   - Primary diagnosis or reason for prescription (if visible)
   - Symptoms (if mentioned)

5. ADDITIONAL NOTES:
   - Any warnings or precautions written
   - Follow-up instructions (if any)
   - Any other visible notes

QUALITY RULES:
- Be thorough - extract EVERY medication you can see
- If handwriting is unclear, make your best effort and note low confidence
- If a field is not visible or unclear, use null
- Keep medication names as written (don't normalize)
- Preserve dosage units exactly as written
- Note any abbreviations used

Return ONLY valid JSON in this format:
{
  "patient": {
    "name": null,
    "age": null,
    "gender": null,
    "id": null,
    "date": null
  },
  "doctor": {
    "name": null,
    "registration_number": null,
    "signature_present": false
  },
  "medications": [
    {
      "name": "",
      "dosage": "",
      "form": "",
      "quantity": "",
      "frequency": "",
      "duration": "",
      "route": "",
      "instructions": "",
      "confidence": "high/medium/low"
    }
  ],
  "diagnosis": {
    "primary": null,
    "symptoms": []
  },
  "notes": {
    "warnings": [],
    "follow_up": "",
    "other_notes": ""
  },
  "extraction_metadata": {
    "total_medications": 0,
    "confidence": "high/medium/low",
    "issues": ["any issues with handwriting clarity, missing info, etc."]
  }
}

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  /**
   * Execute the medications extraction
   * @param {object} context - Execution context
   * @param {string} context.filePath - Path to the PDF/image file
   * @param {string} context.maskedImage - Base64 masked image (for Stage 3)
   * @param {string} context.pdfText - Optional OCR text from PDF
   * @param {Function} context.onProgress - Progress callback
   * @returns {Promise<object>} Extraction result
   */
  async execute(context) {
    const { filePath, maskedImage, pdfText = "", onProgress } = context;

    if (!filePath && !maskedImage) {
      return {
        success: false,
        step: "prescription_medications_extractor",
        error: "File path or masked image is required"
      };
    }

    try {
      const geminiClient = this.getGeminiClient();

      if (onProgress) {
        onProgress({
          type: "info",
          step: "prescription_medications_extractor",
          status: "processing",
          message: "Extracting medications from handwritten content (Gemini)..."
        });
      }

      const prompt = this.buildPrompt({ pdfText });

      // Use masked image if provided (Stage 3), otherwise use file path
      const imageData = maskedImage
        ? [{ base64: maskedImage, mimeType: "image/png" }]
        : [filePath];

      const result = await geminiClient.execute(prompt, {
        images: imageData,
        temperature: 0.1,
        maxTokens: 4000
      });

      if (!result.success) {
        return {
          success: false,
          step: "prescription_medications_extractor",
          error: result.error
        };
      }

      if (onProgress) {
        onProgress({
          type: "info",
          step: "prescription_medications_extractor",
          status: "parsing",
          message: "Parsing extraction results..."
        });
      }

      // Parse the JSON response
      const data = this.parseModelJson(result.content);

      // Extract medications from the response
      const medications = data.medications || [];
      const totalCount = medications.length;

      if (onProgress) {
        onProgress({
          type: "success",
          step: "prescription_medications_extractor",
          status: "complete",
          message: `Extracted ${totalCount} medications`,
          data: {
            medicationsCount: totalCount,
            patientFound: !!data.patient?.name,
            doctorFound: !!data.doctor?.name
          }
        });
      }

      // Return only medications for this skill
      return {
        success: true,
        step: "prescription_medications_extractor",
        data: {
          medications: medications,
          total_count: totalCount,
          notes: data.notes?.other_notes || "",
          extraction_metadata: data.extraction_metadata || {
            total_medications: totalCount,
            confidence: "medium",
            issues: []
          }
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "prescription_medications_extractor",
        error: error.message
      };
    }
  }
}

module.exports = PrescriptionMedicationsExtractorSkill;
