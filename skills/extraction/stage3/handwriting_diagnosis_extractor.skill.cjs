/**
 * Handwriting Diagnosis Extractor Skill (Stage 3)
 * Extracts handwritten diagnosis and symptoms from masked prescription images
 * Uses Gemini 2.5 Flash for superior handwriting recognition
 * Part of two-stage prescription extraction pipeline
 */

class HandwritingDiagnosisExtractorSkill {
  constructor(config = {}) {
    this.name = "Handwriting Diagnosis Extractor";
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

Your task is to extract diagnosis-oriented clinical content from the prescription pages.
Focus on diagnosis and symptoms only. Do NOT use this prompt to capture handwritten general notes, lab orders, radiology orders, or procedures.

EXTRACT THE FOLLOWING:
- principal_diagnosis: the main clinical condition if explicitly written
- secondary_diagnoses: additional conditions if explicitly written
- symptoms: complaints or symptoms if explicitly written

RULES:
- Read all pages.
- Do NOT extract medicines here.
- Do NOT duplicate the same content across multiple fields.
- If a line is clearly a lab test, imaging request, ECG, scan order, or procedure order, do NOT place it in any field here.
- Do NOT extract general advice, follow-up instructions, or free-form handwritten notes here unless they are explicitly part of the diagnosis/symptom statement.
- Do NOT put vital signs, allergies, medication lines, dates, hospital names, doctor names, or registration numbers into any field here.
- Keep wording close to the document when possible.
- If diagnosis is not explicitly written, use null for principal_diagnosis and keep has_diagnosis false.
- Keep the JSON compact and deterministic.
- Keep arrays concise:
  - secondary_diagnoses: max 5
  - symptoms: max 6

STRICT JSON RULES:
- Return exactly one JSON object.
- Use double quotes for all keys and string values.
- No markdown, no code fences, no prose, no comments, no trailing commas.
- Do not omit any required top-level field.

Return ONLY valid JSON in this format:
{
  "principal_diagnosis": "main diagnosis or null",
  "secondary_diagnoses": ["secondary diagnosis 1", "secondary diagnosis 2"],
  "symptoms": ["symptom 1", "symptom 2"],
  "has_diagnosis": false,
  "confidence": "high|medium|low"
}

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  /**
   * Execute handwriting diagnosis extraction
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
        step: "handwriting_diagnosis_extractor",
        error: "Images are required for handwriting extraction"
      };
    }

    if (!apiKey) {
      return {
        success: false,
        step: "handwriting_diagnosis_extractor",
        error: "Gemini API key is required for handwriting extraction"
      };
    }

    try {
      const geminiClient = this.getGeminiClient(apiKey);

      if (onProgress) {
        onProgress({
          type: "info",
          step: "handwriting_diagnosis_extractor",
          status: "processing",
          message: `Extracting handwritten diagnosis from ${imagesForExtraction.length} page(s)...`
        });
      }

      const prompt = this.buildPrompt();

      const result = await geminiClient.execute(prompt, {
        images: imagesForExtraction,
        temperature: 0.1,
        maxTokens: 2048,
        thinkingBudget: this.config.thinkingBudget ?? 4096,
        responseMimeType: "application/json",
        systemInstruction: "You are a medical document extraction expert specializing in handwritten diagnosis and symptoms."
      });

      if (!result.success) {
        return {
          success: false,
          step: "handwriting_diagnosis_extractor",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);

      // Debug logging to see what Gemini returned
      console.log(`[Stage3-Diagnosis] Gemini returned keys:`, Object.keys(data || {}));
      if (onProgress) {
        onProgress({
          type: "success",
          step: "handwriting_diagnosis_extractor",
          status: "complete",
          message: data.principal_diagnosis ? `Diagnosis: ${data.principal_diagnosis}` : "No diagnosis found"
        });
      }

      return {
        success: true,
        step: "handwriting_diagnosis_extractor",
        data: {
          diagnosis: {
            principal: data.principal_diagnosis || null,
            secondary: Array.isArray(data.secondary_diagnoses) ? data.secondary_diagnoses : [],
            symptoms: Array.isArray(data.symptoms) ? data.symptoms : []
          },
          has_diagnosis: data.has_diagnosis || false,
          confidence: data.confidence || "medium"
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "handwriting_diagnosis_extractor",
        error: error.message
      };
    }
  }
}

module.exports = HandwritingDiagnosisExtractorSkill;
