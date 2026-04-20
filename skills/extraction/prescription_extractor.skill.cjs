/**
 * Prescription Extractor Skill
 * Extracts structured data from handwritten prescription documents
 * Uses Qwen Vision model for OCR and understanding
 */

class PrescriptionExtractorSkill {
  constructor(config = {}) {
    this.name = "Prescription Extractor";
    this.version = "1.0.0";
    this.config = config;
    this.qwenVisionClient = null;

    // Lazy load the Qwen client
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

  repairJson(content) {
    let repaired = "";
    let inString = false;
    let escaped = false;

    for (const char of String(content || "")) {
      if (inString && (char === "\n" || char === "\r" || char === "\t")) {
        repaired += " ";
        escaped = false;
        continue;
      }

      repaired += char;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
      }
    }

    return repaired.replace(/,\s*([}\]])/g, "$1");
  }

  normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
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
   * Execute the prescription extraction
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
        step: "prescription_extractor",
        error: "File path is required"
      };
    }

    try {
      const qwenClient = this.getQwenClient();

      if (onProgress) {
        onProgress({
          type: "info",
          step: "prescription_extractor",
          status: "processing",
          message: "Initializing Qwen Vision model..."
        });
      }

      // Build the extraction prompt
      const prompt = this.buildPrompt({ pdfText });

      // Execute extraction with vision
      const result = await qwenClient.execute(prompt, {
        images: [filePath],
        temperature: 0.1,
        maxTokens: 4000,
        systemPrompt: "You are a medical document extraction expert specializing in handwritten prescriptions."
      });

      if (!result.success) {
        return {
          success: false,
          step: "prescription_extractor",
          error: result.error
        };
      }

      if (onProgress) {
        onProgress({
          type: "info",
          step: "prescription_extractor",
          status: "parsing",
          message: "Parsing extraction results..."
        });
      }

      // Parse the JSON response
      const data = this.parseModelJson(result.content);

      // Add metadata
      data.meta = {
        extracted_at: new Date().toISOString(),
        model: result.model,
        tokens_used: result.usage?.totalTokens || 0,
        latency_ms: result.usage?.latency || 0
      };

      if (onProgress) {
        onProgress({
          type: "success",
          step: "prescription_extractor",
          status: "complete",
          message: `Extracted ${data.medications?.length || 0} medications`,
          data: {
            medicationsCount: data.medications?.length || 0,
            patientFound: !!data.patient?.name,
            doctorFound: !!data.doctor?.name
          }
        });
      }

      return {
        success: true,
        step: "prescription_extractor",
        data: data,
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "prescription_extractor",
        error: error.message
      };
    }
  }

  /**
   * Execute with multiple images (for multi-page prescriptions)
   */
  async executeMultiple(context) {
    const { filePaths = [], pdfText = "", onProgress } = context;

    if (!filePaths.length) {
      return {
        success: false,
        step: "prescription_extractor",
        error: "At least one file path is required"
      };
    }

    try {
      const qwenClient = this.getQwenClient();

      // Build the extraction prompt
      const prompt = this.buildPrompt({ pdfText });

      // Execute extraction with multiple images
      const result = await qwenClient.execute(prompt, {
        images: filePaths,
        temperature: 0.1,
        maxTokens: 4000
      });

      if (!result.success) {
        return {
          success: false,
          step: "prescription_extractor",
          error: result.error
        };
      }

      // Parse the JSON response
      const data = this.parseModelJson(result.content);

      // Add metadata
      data.meta = {
        extracted_at: new Date().toISOString(),
        model: result.model,
        pages_processed: filePaths.length,
        tokens_used: result.usage?.totalTokens || 0
      };

      return {
        success: true,
        step: "prescription_extractor",
        data: data,
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "prescription_extractor",
        error: error.message
      };
    }
  }

  /**
   * Format the extracted data for display
   */
  formatForDisplay(data) {
    const lines = [];

    lines.push("=" .repeat(60));
    lines.push("PRESCRIPTION EXTRACTION RESULTS");
    lines.push("=".repeat(60));

    if (data.patient?.name) {
      lines.push(`\nPATIENT: ${data.patient.name}`);
      if (data.patient.age) lines.push(`  Age: ${data.patient.age}`);
      if (data.patient.gender) lines.push(`  Gender: ${data.patient.gender}`);
      if (data.patient.date) lines.push(`  Date: ${data.patient.date}`);
    }

    if (data.doctor?.name) {
      lines.push(`\nDOCTOR: ${data.doctor.name}`);
      if (data.doctor.registration_number) {
        lines.push(`  Reg: ${data.doctor.registration_number}`);
      }
    }

    if (data.diagnosis?.primary) {
      lines.push(`\nDIAGNOSIS: ${data.diagnosis.primary}`);
    }

    lines.push("\n" + "-".repeat(40));
    lines.push("MEDICATIONS");
    lines.push("-".repeat(40));

    if (data.medications && data.medications.length > 0) {
      data.medications.forEach((med, index) => {
        lines.push(`\n${index + 1}. ${med.name || "Unknown"}`);
        if (med.dosage) lines.push(`   Dosage: ${med.dosage}`);
        if (med.form) lines.push(`   Form: ${med.form}`);
        if (med.quantity) lines.push(`   Quantity: ${med.quantity}`);
        if (med.frequency) lines.push(`   Frequency: ${med.frequency}`);
        if (med.duration) lines.push(`   Duration: ${med.duration}`);
        if (med.route) lines.push(`   Route: ${med.route}`);
        if (med.instructions) lines.push(`   Instructions: ${med.instructions}`);
        if (med.confidence) lines.push(`   Confidence: ${med.confidence}`);
      });
    } else {
      lines.push("\nNo medications extracted");
    }

    if (data.notes?.warnings?.length) {
      lines.push("\nWARNINGS:");
      data.notes.warnings.forEach(w => lines.push(`  - ${w}`));
    }

    if (data.notes?.follow_up) {
      lines.push(`\nFOLLOW-UP: ${data.notes.follow_up}`);
    }

    if (data.extraction_metadata) {
      lines.push("\n" + "=".repeat(60));
      lines.push(`Confidence: ${data.extraction_metadata.confidence}`);
      lines.push(`Medications: ${data.extraction_metadata.total_medications}`);
      if (data.extraction_metadata.issues?.length) {
        lines.push("Issues:");
        data.extraction_metadata.issues.forEach(i => lines.push(`  - ${i}`));
      }
    }

    return lines.join("\n");
  }
}

module.exports = PrescriptionExtractorSkill;
