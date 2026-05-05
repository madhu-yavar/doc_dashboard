/**
 * Handwriting Vitals Extractor Skill (Stage 3)
 * Extracts handwritten vitals from masked prescription images
 * Uses Gemini 2.5 Flash for superior handwriting recognition
 * Part of two-stage prescription extraction pipeline
 */

class HandwritingVitalsExtractorSkill {
  constructor(config = {}) {
    this.name = "Handwriting Vitals Extractor";
    this.version = "1.0.0";
    this.config = config;
    this.geminiClient = null;
    this.currentApiKey = null;
  }

  getGeminiClient(apiKey) {
    // Create new client if API key changed or client doesn't exist
    const effectiveKey = apiKey || this.config.apiKey || "";
    if (!this.geminiClient || this.currentApiKey !== effectiveKey) {
      const GeminiClientTool = require("../../../tools/llm/gemini_client.tool.cjs");
      this.geminiClient = new GeminiClientTool({
        baseUrl: this.config.geminiBaseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models",
        model: this.config.geminiModel || "gemini-2.5-flash",
        timeout: this.config.timeout || 180000,
        apiKey: effectiveKey
      });
      this.currentApiKey = effectiveKey;
    }
    return this.geminiClient;
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

  buildPrompt() {
    return `You are an expert at reading handwritten medical prescriptions and clinical notes.

Your task is to extract VITAL SIGNS only if they are explicitly present in the prescription pages.

EXTRACT THE FOLLOWING:
- Blood Pressure
- Pulse / Heart Rate
- Temperature
- Weight
- SpO2
- Respiratory Rate

RULES:
- Read all pages, but only extract values that are explicitly written.
- Do NOT infer vitals from diagnosis, lab values, dates, serial numbers, or form numbers.
- Look for abbreviations such as BP, B.P., PR, HR, Temp, WT, Wt, SpO2, RR.
- Blood pressure should be split into systolic and diastolic when both numbers are present.
- If only one BP number is visible, populate systolic and keep diastolic null.
- Keep units when written. If no unit is written, use the default unit shown in the schema.
- If no vital values are present, keep all values null and set has_vitals to false.
- Set has_vitals to true only if at least one vital value is populated.

STRICT JSON RULES:
- Return exactly one JSON object.
- Use double quotes for all keys and string values.
- No markdown, no code fences, no prose, no comments, no trailing commas.

Return ONLY valid JSON in this format:
{
  "blood_pressure": {
    "systolic": null,
    "diastolic": null,
    "unit": "mmHg"
  },
  "pulse": {
    "value": null,
    "unit": "bpm"
  },
  "temperature": {
    "value": null,
    "unit": "°F"
  },
  "weight": {
    "value": null,
    "unit": "kg"
  },
  "spo2": {
    "value": null,
    "unit": "%"
  },
  "respiratory_rate": {
    "value": null,
    "unit": "/min"
  },
  "has_vitals": true,
  "confidence": "high|medium|low"
}

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  /**
   * Execute handwriting vitals extraction
   * @param {object} context - { images, maskedImage, apiKey }
   * @returns {Promise<object>}
   */
  async execute(context) {
    // Support both old (maskedImage) and new (images array) interface
    const { images, maskedImage, apiKey, onProgress } = context;
    const imagesForExtraction = images || (maskedImage ? [maskedImage] : null);

    if (!imagesForExtraction || imagesForExtraction.length === 0) {
      return {
        success: false,
        step: "handwriting_vitals_extractor",
        error: "Images are required for handwriting extraction"
      };
    }

    if (!apiKey) {
      return {
        success: false,
        step: "handwriting_vitals_extractor",
        error: "Gemini API key is required for handwriting extraction"
      };
    }

    try {
      const geminiClient = this.getGeminiClient(apiKey);

      if (onProgress) {
        onProgress({
          type: "info",
          step: "handwriting_vitals_extractor",
          status: "processing",
          message: `Extracting handwritten vitals from ${imagesForExtraction.length} page(s)...`
        });
      }

      const prompt = this.buildPrompt();

      const result = await geminiClient.execute(prompt, {
        images: imagesForExtraction,
        temperature: 0.1,
        maxTokens: 2048,
        responseMimeType: "application/json",
        systemInstruction: "You are a medical document extraction expert specializing in handwritten vital signs."
      });

      if (!result.success) {
        return {
          success: false,
          step: "handwriting_vitals_extractor",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);

      if (onProgress) {
        onProgress({
          type: "success",
          step: "handwriting_vitals_extractor",
          status: "complete",
          message: data.has_vitals ? "Vitals extracted" : "No vitals found"
        });
      }

      return {
        success: true,
        step: "handwriting_vitals_extractor",
        data: {
          vitals: {
            blood_pressure: data.blood_pressure || { systolic: null, diastolic: null, unit: "mmHg" },
            pulse: data.pulse || { value: null, unit: "bpm" },
            temperature: data.temperature || { value: null, unit: "°F" },
            weight: data.weight || { value: null, unit: "kg" },
            spo2: data.spo2 || { value: null, unit: "%" },
            respiratory_rate: data.respiratory_rate || { value: null, unit: "/min" }
          },
          has_vitals: data.has_vitals || false,
          confidence: data.confidence || "medium"
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "handwriting_vitals_extractor",
        error: error.message
      };
    }
  }
}

module.exports = HandwritingVitalsExtractorSkill;
