/**
 * Handwriting Orders Extractor Skill (Stage 3)
 * Extracts lab and radiology orders from masked prescription images
 * Uses Gemini 2.5 Flash with higher thinking budget for order recall
 */

class HandwritingOrdersExtractorSkill {
  constructor(config = {}) {
    this.name = "Handwriting Orders Extractor";
    this.version = "1.0.0";
    this.config = config;
    this.geminiClient = null;
    this.currentApiKey = null;
  }

  getGeminiClient(apiKey) {
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

Your task is to extract ALL medically ordered tests and studies from the prescription pages.

FOCUS ONLY ON ORDERS:
- lab_investigations: blood tests, urine tests, pathology, biochemistry, microbiology, cardiology tests if ordered as tests
- radiology.selected_studies: imaging, ultrasound, X-ray, CT, MRI, scan, ECG, Echo, audiology, nerve conduction, or other procedure-style studies

DO NOT EXTRACT:
- medicines
- diagnoses
- symptoms
- generic clinical advice
- doctor / patient / hospital / date details
- vital signs

RECALL RULES:
- Read all pages carefully.
- Do not miss orders written as abbreviations: CBC, LFT, KFT, RFT, TFT, HbA1c, PSA, ECG, USG, MRI, CT, X-ray, NCS, etc.
- Capture both checklist-style items and free-text ordered investigations.
- If an order is partially unclear but still recognizable, keep the recognizable wording and mark it as uncertain.
- Prefer extracting an order once rather than missing it.
- Do not invent tests not visible in the document.
- Keep wording close to the document.

CLASSIFICATION RULES:
- Put lab/pathology tests in "lab_investigations".
- Put imaging, scan, ECG, echo, audiology, nerve conduction, and procedure-style studies in "radiology.selected_studies".
- If unsure whether an item is lab vs study, choose the bucket that best matches how it would be ordered clinically.

STRICT JSON RULES:
- Return exactly one JSON object.
- Use double quotes for all keys and string values.
- No markdown, no code fences, no prose, no comments, no trailing commas.
- Do not omit any required field.

Return ONLY valid JSON in this format:
{
  "lab_investigations": [
    {"test_name": "CBC", "category": "hematology", "is_uncertain": false, "confidence_reason": ""},
    {"test_name": "LFT", "category": "biochemistry", "is_uncertain": true, "confidence_reason": "partially unclear abbreviation"}
  ],
  "radiology": {
    "selected_studies": [
      {"study_name": "Chest X-ray", "category": "imaging", "is_uncertain": false, "confidence_reason": ""},
      {"study_name": "ECG", "category": "cardiology", "is_uncertain": true, "confidence_reason": "study name partially obscured"}
    ]
  },
  "has_orders": false,
  "confidence": "high|medium|low"
}

IMPORTANT:
- Even if no lab tests are found, include "lab_investigations": [].
- Even if no studies are found, include "radiology": { "selected_studies": [] }.

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  async execute(context) {
    const { images, maskedImage, apiKey, onProgress } = context;
    const imagesForExtraction = images || (maskedImage ? [maskedImage] : null);

    if (!imagesForExtraction || imagesForExtraction.length === 0) {
      return {
        success: false,
        step: "handwriting_orders_extractor",
        error: "Images are required for handwriting extraction"
      };
    }

    if (!apiKey) {
      return {
        success: false,
        step: "handwriting_orders_extractor",
        error: "Gemini API key is required for handwriting extraction"
      };
    }

    try {
      const geminiClient = this.getGeminiClient(apiKey);

      if (onProgress) {
        onProgress({
          type: "info",
          step: "handwriting_orders_extractor",
          status: "processing",
          message: `Extracting ordered labs and studies from ${imagesForExtraction.length} page(s)...`
        });
      }

      const result = await geminiClient.execute(this.buildPrompt(), {
        images: imagesForExtraction,
        temperature: 0.1,
        maxTokens: 2048,
        thinkingBudget: this.config.thinkingBudget ?? 8192,
        responseMimeType: "application/json",
        systemInstruction: "You are a medical document extraction expert specializing in handwritten diagnostic orders and investigations."
      });

      if (!result.success) {
        return {
          success: false,
          step: "handwriting_orders_extractor",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);

      if (!Array.isArray(data.lab_investigations)) {
        data.lab_investigations = [];
      }
      if (!data.radiology || !Array.isArray(data.radiology.selected_studies)) {
        data.radiology = { selected_studies: [] };
      }
      data.lab_investigations = data.lab_investigations.map((item) => ({
        test_name: item?.test_name || "",
        category: item?.category || "unknown",
        is_uncertain: Boolean(item?.is_uncertain),
        confidence_reason: String(item?.confidence_reason || "")
      })).filter((item) => item.test_name);
      data.radiology.selected_studies = data.radiology.selected_studies.map((item) => ({
        study_name: item?.study_name || "",
        category: item?.category || "imaging",
        is_uncertain: Boolean(item?.is_uncertain),
        confidence_reason: String(item?.confidence_reason || "")
      })).filter((item) => item.study_name);

      if (onProgress) {
        onProgress({
          type: "success",
          step: "handwriting_orders_extractor",
          status: "complete",
          message: `Orders extracted: ${data.lab_investigations.length} labs, ${data.radiology.selected_studies.length} studies`
        });
      }

      return {
        success: true,
        step: "handwriting_orders_extractor",
        data: {
          lab_investigations: data.lab_investigations,
          radiology: data.radiology,
          has_orders: data.has_orders || data.lab_investigations.length > 0 || data.radiology.selected_studies.length > 0,
          confidence: data.confidence || "medium"
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "handwriting_orders_extractor",
        error: error.message
      };
    }
  }
}

module.exports = HandwritingOrdersExtractorSkill;
