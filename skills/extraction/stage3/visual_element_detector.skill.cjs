/**
 * Visual Element Detector Skill (Stage 3)
 * Detects visual elements like ticks, circles, and checkboxes in prescription forms
 * Uses Gemini 2.5 Flash for visual understanding
 * Part of two-stage prescription extraction pipeline
 */

class VisualElementDetectorSkill {
  constructor(config = {}) {
    this.name = "Visual Element Detector";
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
    return `You are an expert at analyzing medical prescription forms and detecting VISUAL SELECTIONS.

Your task is to detect only items that are visually selected on the form.

VISUAL SIGNALS TO ACCEPT:
- check marks or ticks
- circles around an item
- filled checkboxes
- underlines used as a clear selection marker

DO NOT COUNT AN ITEM AS SELECTED IF:
- it is merely mentioned in handwriting with no visual selection mark
- it appears in free-text advice or diagnosis
- the mark is not clearly attached to that item
- the item is present only as narrative text without a checklist-style affordance

LOOK FOR:
- lab investigations
- radiology / imaging / ECG selections

EXTRACT:
- test_name or study_name exactly as written
- whether it is checked / circled / underlined
- priority if explicitly shown, otherwise "routine"

STRICT JSON RULES:
- Return exactly one JSON object.
- Use double quotes for all keys and string values.
- No markdown, no code fences, no prose, no comments, no trailing commas.
- total_selected must equal the number of objects in selected_tests.
- If no checklist-style form is present, total_available may be 0.

Return ONLY valid JSON in this format:
{
  "lab_investigations": {
    "selected_tests": [
      {
        "test_name": "CBC",
        "is_checked": true,
        "is_circled": false,
        "is_underlined": false,
        "priority": "routine"
      }
    ],
    "total_available": 20,
    "total_selected": 5
  },
  "radiology": {
    "selected_studies": [
      {
        "study_name": "Chest X-ray",
        "is_checked": true
      }
    ]
  },
  "has_selections": true,
  "confidence": "high"
}

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  /**
   * Execute visual element detection
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
        step: "visual_element_detector",
        error: "Images are required for visual element detection"
      };
    }

    if (!apiKey) {
      return {
        success: false,
        step: "visual_element_detector",
        error: "Gemini API key is required for visual element detection"
      };
    }

    try {
      const geminiClient = this.getGeminiClient(apiKey);

      if (onProgress) {
        onProgress({
          type: "info",
          step: "visual_element_detector",
          status: "processing",
          message: `Detecting visual elements in ${imagesForExtraction.length} page(s)...`
        });
      }

      const prompt = this.buildPrompt();

      const result = await geminiClient.execute(prompt, {
        images: imagesForExtraction,
        temperature: 0.1,
        maxTokens: 3072,
        responseMimeType: "application/json",
        systemInstruction: "You are a medical document analysis expert specializing in detecting visual selections like checkmarks and circles."
      });

      if (!result.success) {
        return {
          success: false,
          step: "visual_element_detector",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);

      const selectedCount = data.lab_investigations?.total_selected || 0;
      if (onProgress) {
        onProgress({
          type: "success",
          step: "visual_element_detector",
          status: "complete",
          message: `Found ${selectedCount} selected lab tests`
        });
      }

      return {
        success: true,
        step: "visual_element_detector",
        data: {
          lab_investigations: data.lab_investigations || {
            selected_tests: [],
            total_available: 0,
            total_selected: 0
          },
          radiology: data.radiology || {
            selected_studies: []
          },
          has_selections: data.has_selections || false,
          confidence: data.confidence || "medium"
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "visual_element_detector",
        error: error.message
      };
    }
  }
}

module.exports = VisualElementDetectorSkill;
