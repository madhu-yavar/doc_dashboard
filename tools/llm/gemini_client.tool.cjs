class GeminiClientTool {
  constructor(config = {}) {
    this.name = "Gemini LLM Client";
    this.version = "1.0.0";
    this.baseUrl = config.baseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models";
    this.model = config.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    this.timeout = config.timeout || 120000;
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || "";
  }

  /**
   * Check if a string is likely a base64 encoded image
   */
  isBase64(str) {
    if (typeof str !== 'string' || str.length < 100) return false;
    // Base64 images are typically long and contain only base64 chars
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    // Check if most of the string matches base64 pattern
    const sampleSize = Math.min(str.length, 1000);
    const sample = str.substring(0, sampleSize);
    const matches = sample.split('').filter(c => base64Regex.test(c)).length;
    return matches / sampleSize > 0.95;
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
      // Build parts array - include images if provided
      const parts = [];

      // Add text prompt
      parts.push({ text: String(prompt || "") });

      // Add images if provided (for vision models)
      if (options.images && Array.isArray(options.images)) {
        for (const image of options.images) {
          if (typeof image === "string") {
            if (image.startsWith("data:")) {
              // Base64 data URL - format: data:image/png;base64,xxxxx
              const matches = image.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                console.log(`[Gemini] Parsed data URL: mimeType=${matches[1]}, dataLength=${matches[2].length}`);
                parts.push({
                  inlineData: {
                    mimeType: matches[1] || "image/png",
                    data: matches[2]
                  }
                });
              } else {
                console.warn("[Gemini] Invalid data URL format:", image.substring(0, 100));
              }
            } else if (image.startsWith("http://") || image.startsWith("https://")) {
              // URL - for Gemini, we need to fetch and convert to base64
              // For now, skip or we could add fetching logic
              console.warn("URL images not directly supported, use base64 data URLs");
            } else if (this.isBase64(image)) {
              // Raw base64 string (without data: prefix)
              parts.push({
                inlineData: {
                  mimeType: "image/png",
                  data: image
                }
              });
            } else {
              // File path - read and convert
              try {
                const fs = require("fs/promises");
                const buffer = await fs.readFile(image);
                const base64 = buffer.toString("base64");
                const ext = image.toLowerCase().split(".").pop();
                const mimeType = ext === "png" ? "image/png" :
                                 ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
                                 ext === "gif" ? "image/gif" : "image/png";
                parts.push({
                  inlineData: {
                    mimeType: mimeType,
                    data: base64
                  }
                });
              } catch (err) {
                console.warn(`Failed to read image file: ${err.message}`);
              }
            }
          } else if (image.base64) {
            // Object with base64 property
            parts.push({
              inlineData: {
                mimeType: image.mimeType || "image/png",
                data: image.base64
              }
            });
          } else if (image.buffer) {
            // Buffer object
            parts.push({
              inlineData: {
                mimeType: image.mimeType || "image/png",
                data: image.buffer.toString("base64")
              }
            });
          }
        }
      }

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
              parts: parts,
            },
          ],
          generationConfig: {
            temperature: options.temperature ?? 0.1,
            maxOutputTokens: options.maxTokens ?? 600,
            responseMimeType: options.responseMimeType || undefined,
            thinkingConfig:
              options.thinkingBudget !== undefined
                ? {
                    thinkingBudget: options.thinkingBudget,
                    includeThoughts: options.includeThoughts ?? false,
                  }
                : undefined,
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
            responseMimeType: options.responseMimeType || undefined,
            thinkingConfig:
              options.thinkingBudget !== undefined
                ? {
                    thinkingBudget: options.thinkingBudget,
                    includeThoughts: options.includeThoughts ?? false,
                  }
                : undefined,
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
