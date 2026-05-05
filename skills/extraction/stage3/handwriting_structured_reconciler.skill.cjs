/**
 * Handwriting Structured Reconciler Skill (Stage 3)
 * Reviews extracted handwritten notes/diagnosis against the source images
 * and promotes missed structured orders into labs / radiology / nuclear / procedures.
 */

class HandwritingStructuredReconcilerSkill {
  constructor(config = {}) {
    this.name = "Handwriting Structured Reconciler";
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
        model: this.config.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash",
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

  compactJson(value) {
    return JSON.stringify(value || {}, null, 2);
  }

  buildPrompt(context = {}) {
    const {
      notes = [],
      diagnosis = {},
      orders = {},
      visualElements = {}
    } = context;

    return `You are reconciling extraction outputs from the SAME handwritten prescription pages.

Your task is to recover only the clinically structured orders that may have been mentioned in handwritten notes or findings but were not captured in the structured order extractor.

Source of truth:
- the provided prescription images
- the extracted handwritten notes below
- the current structured order extraction below
- the visual tick/circle detection below

CURRENT HANDWRITTEN NOTES:
${this.compactJson(notes)}

CURRENT DIAGNOSIS / FINDINGS:
${this.compactJson(diagnosis)}

CURRENT STRUCTURED ORDERS:
${this.compactJson(orders)}

CURRENT VISUAL SELECTIONS:
${this.compactJson(visualElements)}

PROMOTION RULES:
- Return ONLY additional items that are explicitly visible in the images or clearly present in the handwritten notes/findings.
- Do NOT repeat items already captured in the current structured orders unless you are providing a clearer equivalent wording.
- Prefer wording close to the prescription.
- Promote only these categories:
  - "lab_investigations": CBC, urine culture, PSA, HbA1c, LFT, RFT, urine tests, microbiology, pathology, etc.
  - "radiology.selected_studies": X-ray, CT, MRI, USG / ultrasound, scan, mammography, fluoroscopy.
  - "nuclear_medicine.selected_studies": PET, DTPA, DMSA, MIBI, thallium, V/Q, bone scan, thyroid scan, renal scan, HIDA, or other tracer studies.
  - "procedures": uroflowmetry, PVR, cystoscopy, catheterization, NCS, EMG, PFT, ECG, Echo, stress test, Holter, biopsy, endoscopy, etc.
- DO NOT add diagnoses, symptoms, medicines, vitals, general advice, or follow-up instructions here.
- If an item is partly readable but clinically recognizable, keep the readable wording and mark it uncertain.
- If there are no additional structured items to promote, return empty arrays.

STRICT JSON RULES:
- Return exactly one JSON object.
- Use double quotes for all keys and string values.
- No markdown, no code fences, no prose, no comments, no trailing commas.

Return ONLY valid JSON in this format:
{
  "lab_investigations": [
    {"test_name": "Urine Culture", "category": "microbiology", "is_uncertain": false, "confidence_reason": ""}
  ],
  "radiology": {
    "selected_studies": [
      {"study_name": "Ultrasound Abdomen & Pelvis", "category": "imaging", "is_uncertain": false, "confidence_reason": ""}
    ]
  },
  "nuclear_medicine": {
    "selected_studies": [
      {"study_name": "DTPA Renal Scan", "category": "renal", "is_uncertain": false, "confidence_reason": ""}
    ]
  },
  "procedures": [
    {"name": "Uroflowmetry + PVR", "category": "urology", "is_uncertain": false, "confidence_reason": ""}
  ],
  "has_additions": false,
  "confidence": "high|medium|low"
}

Remember: return only additional/promoted structured items, not the full existing extraction.`;
  }

  normalizeLabItems(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        test_name: String(item?.test_name || "").trim(),
        category: String(item?.category || "unknown").trim() || "unknown",
        is_uncertain: Boolean(item?.is_uncertain),
        confidence_reason: String(item?.confidence_reason || "").trim(),
        source: "note_reconciliation"
      }))
      .filter((item) => item.test_name);
  }

  normalizeStudyItems(items, source = "note_reconciliation") {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        study_name: String(item?.study_name || "").trim(),
        category: String(item?.category || "imaging").trim() || "imaging",
        is_uncertain: Boolean(item?.is_uncertain),
        confidence_reason: String(item?.confidence_reason || "").trim(),
        source
      }))
      .filter((item) => item.study_name);
  }

  normalizeProcedureItems(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        name: String(item?.name || "").trim(),
        category: String(item?.category || "procedure").trim() || "procedure",
        is_uncertain: Boolean(item?.is_uncertain),
        confidence_reason: String(item?.confidence_reason || "").trim(),
        source: "note_reconciliation"
      }))
      .filter((item) => item.name);
  }

  async execute(context) {
    const { images, apiKey, notes, diagnosis, orders, visualElements, onProgress } = context;

    if (!Array.isArray(images) || images.length === 0) {
      return {
        success: false,
        step: "handwriting_structured_reconciler",
        error: "Images are required for structured reconciliation"
      };
    }

    if (!apiKey) {
      return {
        success: false,
        step: "handwriting_structured_reconciler",
        error: "Gemini API key is required for structured reconciliation"
      };
    }

    try {
      const geminiClient = this.getGeminiClient(apiKey);

      if (onProgress) {
        onProgress({
          type: "info",
          step: "handwriting_structured_reconciler",
          status: "processing",
          message: `Reconciling handwritten notes into structured orders across ${images.length} page(s)...`
        });
      }

      const result = await geminiClient.execute(this.buildPrompt({
        notes,
        diagnosis,
        orders,
        visualElements
      }), {
        images,
        temperature: 0.05,
        maxTokens: 2048,
        thinkingBudget: this.config.thinkingBudget ?? 4096,
        responseMimeType: "application/json",
        systemInstruction: "You are a medical document extraction expert specializing in promoting missed handwritten orders into structured clinical fields."
      });

      if (!result.success) {
        return {
          success: false,
          step: "handwriting_structured_reconciler",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);
      const labInvestigations = this.normalizeLabItems(data.lab_investigations);
      const radiology = {
        selected_studies: this.normalizeStudyItems(data?.radiology?.selected_studies)
      };
      const nuclearMedicine = {
        selected_studies: this.normalizeStudyItems(data?.nuclear_medicine?.selected_studies, "note_reconciliation")
      };
      const procedures = this.normalizeProcedureItems(data.procedures);

      if (onProgress) {
        onProgress({
          type: "success",
          step: "handwriting_structured_reconciler",
          status: "complete",
          message: `Structured reconciliation added ${labInvestigations.length} labs, ${radiology.selected_studies.length} imaging, ${nuclearMedicine.selected_studies.length} nuclear, ${procedures.length} procedures`
        });
      }

      return {
        success: true,
        step: "handwriting_structured_reconciler",
        data: {
          lab_investigations: labInvestigations,
          radiology,
          nuclear_medicine: nuclearMedicine,
          procedures,
          has_additions: Boolean(data.has_additions) || labInvestigations.length > 0 || radiology.selected_studies.length > 0 || nuclearMedicine.selected_studies.length > 0 || procedures.length > 0,
          confidence: String(data.confidence || "medium").trim() || "medium"
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "handwriting_structured_reconciler",
        error: error.message
      };
    }
  }
}

module.exports = HandwritingStructuredReconcilerSkill;
