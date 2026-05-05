/**
 * Hospital Info Extractor Skill (Stage 1)
 * Extracts hospital/clinic information from prescription documents
 * Part of two-stage prescription extraction pipeline
 */

class HospitalInfoExtractorSkill {
  constructor(config = {}) {
    this.name = "Hospital Info Extractor";
    this.version = "1.0.0";
    this.config = config;
    this.gemmaVisionClient = null;
  }

  getGemmaClient() {
    if (!this.gemmaVisionClient) {
      const GemmaVisionClientTool = require("../../../tools/llm/gemma_vision_client.tool.cjs");
      this.gemmaVisionClient = new GemmaVisionClientTool({
        baseUrl: this.config.gemmaBaseUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions",
        model: this.config.gemmaModel || "google/gemma-4-31B-it",
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

    const candidates = [normalized];
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

  extractDepartment(pdfText) {
    const text = String(pdfText || "");
    const labeledMatch = text.match(/\b(?:Department|Dept)\s*[:\-]?\s*([A-Z][A-Z0-9/&() .-]{2,})/i);
    if (labeledMatch?.[1]) return labeledMatch[1].trim().replace(/\s+/g, " ");

    const lineMatch = text.match(/\b(ENT|UROLOGY|NEUROLOGY|DERMATOLOGY|OBSTETRICS(?:\s+AND\s+GYNAECOLOGY)?|GYNAECOLOGY|CARDIOLOGY|ORTHOPEDICS?|PEDIATRICS?)\b[^\n]{0,20}\b(MHB|MHS|OPD|IPD)\b/i);
    return lineMatch ? lineMatch[0].trim().replace(/\s+/g, " ") : null;
  }

  buildPrompt(pdfText = "") {
    return `You are an expert at extracting hospital information from medical prescription documents.

Your task is to carefully analyze the prescription document and extract HOSPITAL/CLINIC INFORMATION ONLY.

${pdfText ? `OCR TEXT FROM DOCUMENT:\n${pdfText.substring(0, 2000)}\n\n` : ""}

EXTRACT THE FOLLOWING HOSPITAL INFORMATION:
- Hospital or clinic name
- Department name (if visible)
- Address (if visible)
- Contact number (if visible)
- Logo detected (yes/no)

QUALITY RULES:
- Hospital name is usually in the header
- Look for "Hospital", "Clinic", "Medical Center", "Nursing Home"
- If information is not visible, use null
- Keep names as written (don't normalize)

Return ONLY valid JSON in this format:
{
  "name": null,
  "department": null,
  "address": null,
  "contact": null,
  "logo_detected": false,
  "confidence": "high/medium/low"
}

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  async execute(context) {
    const { filePath, pdfText = "", onProgress } = context;

    if (!filePath) {
      return {
        success: false,
        step: "hospital_info_extractor",
        error: "File path is required"
      };
    }

    try {
      const gemmaClient = this.getGemmaClient();

      if (onProgress) {
        onProgress({
          type: "info",
          step: "hospital_info_extractor",
          status: "processing",
          message: "Extracting hospital information..."
        });
      }

      const prompt = this.buildPrompt(pdfText);

      const result = await gemmaClient.execute(prompt, {
        images: [filePath],
        temperature: 0.1,
        maxTokens: 800,
        systemPrompt: "You are a medical document extraction expert specializing in hospital information."
      });

      if (!result.success) {
        return {
          success: false,
          step: "hospital_info_extractor",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);
      const departmentFallback = this.extractDepartment(pdfText);

      if (onProgress) {
        onProgress({
          type: "success",
          step: "hospital_info_extractor",
          status: "complete",
          message: data.name ? `Found hospital: ${data.name}` : "No hospital information found"
        });
      }

      return {
        success: true,
        step: "hospital_info_extractor",
        data: {
          hospital: {
            name: data.name || null,
            department: data.department || departmentFallback || null,
            address: data.address || null,
            logo_detected: !!data.logo_detected
          },
          confidence: data.confidence || "medium"
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "hospital_info_extractor",
        error: error.message
      };
    }
  }
}

module.exports = HospitalInfoExtractorSkill;
