class GeminiClientTool {
  constructor(config = {}) {
    this.name = "Gemini LLM Client";
    this.version = "1.0.0";
    this.baseUrl = config.baseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models";
    this.model = config.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    this.timeout = config.timeout || 120000;
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || "";
  }

  extractText(payload = {}) {
    const candidate = payload.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts
      .map((part) => String(part?.text || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  buildGroundingCitations(payload = {}) {
    const candidate = payload.candidates?.[0] || {};
    const grounding = candidate.groundingMetadata || {};
    const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : [];
    const supports = Array.isArray(grounding.groundingSupports) ? grounding.groundingSupports : [];

    return chunks
      .map((chunk, index) => {
        const web = chunk?.web || {};
        const supportText = supports
          .filter((support) => Array.isArray(support?.groundingChunkIndices) && support.groundingChunkIndices.includes(index))
          .map((support) => String(support?.segment?.text || "").trim())
          .filter(Boolean)
          .join(" ");

        return {
          label: web.title ? `[Google Search: ${web.title}]` : "[Google Search Result]",
          value: web.title || web.uri || "",
          source_class: "external",
          source_section: "Google Search Grounding",
          source_excerpt: supportText,
          source_page: null,
          url: web.uri || "",
          retrieved_at: new Date().toISOString(),
          provenance_type: "quoted",
          confidence: 0.9,
        };
      })
      .filter((item) => item.url || item.value);
  }

  async execute(prompt, options = {}) {
    const apiKey = String(options.apiKey || this.apiKey || "").trim();
    if (!apiKey) {
      return {
        success: false,
        error: "Gemini API key is required.",
        content: "",
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/${this.model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: options.systemInstruction
            ? {
                parts: [{ text: String(options.systemInstruction) }],
              }
            : undefined,
          contents: [
            {
              parts: [{ text: String(prompt || "") }],
            },
          ],
          generationConfig: {
            temperature: options.temperature ?? 0.1,
            maxOutputTokens: options.maxTokens ?? 600,
          },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Gemini request failed (${response.status}): ${text}`,
          content: "",
        };
      }

      const payload = await response.json();
      return {
        success: true,
        content: this.extractText(payload),
        usage: payload.usageMetadata || {},
        model: this.model,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        return {
          success: false,
          error: `Gemini request timeout after ${this.timeout}ms`,
          content: "",
        };
      }

      return {
        success: false,
        error: error.message,
        content: "",
      };
    }
  }

  async executeGroundedSearch(question, options = {}) {
    const apiKey = String(options.apiKey || this.apiKey || "").trim();
    if (!apiKey) {
      return {
        success: false,
        error: "Gemini API key is required.",
        content: "",
        citations: [],
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/${this.model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: options.systemInstruction
            ? { parts: [{ text: String(options.systemInstruction) }] }
            : undefined,
          contents: [
            {
              parts: [{ text: String(question || "") }],
            },
          ],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: options.temperature ?? 0.1,
            maxOutputTokens: options.maxTokens ?? 700,
          },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Gemini grounded search failed (${response.status}): ${text}`,
          content: "",
          citations: [],
        };
      }

      const payload = await response.json();
      return {
        success: true,
        content: this.extractText(payload),
        citations: this.buildGroundingCitations(payload),
        usage: payload.usageMetadata || {},
        model: this.model,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        return {
          success: false,
          error: `Gemini grounded search timeout after ${this.timeout}ms`,
          content: "",
          citations: [],
        };
      }

      return {
        success: false,
        error: error.message,
        content: "",
        citations: [],
      };
    }
  }
}

module.exports = GeminiClientTool;
