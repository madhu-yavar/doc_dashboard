/**
 * Gemini Vision Client Tool
 * Extends GeminiClientTool with image/vision support
 * Compatible with Gemini 2.5 Flash / Pro
 */

class GeminiVisionClientTool {
  constructor(config = {}) {
    this.name = "Gemini Vision Client";
    this.version = "1.0.0";
    this.baseUrl = config.baseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models";
    this.model = config.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    this.timeout = config.timeout || 180000; // 3 minutes for vision
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || "";
  }

  normalizeUsage(usage = {}) {
    const promptTokens = Number(
      usage.promptTokens ??
      usage.promptTokenCount ??
      0
    ) || 0;

    const completionTokens = Number(
      usage.completionTokens ??
      usage.candidatesTokenCount ??
      0
    ) || 0;

    const totalTokens = Number(
      usage.totalTokens ??
      usage.totalTokenCount ??
      (promptTokens + completionTokens)
    ) || 0;

    return {
      ...usage,
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  /**
   * Convert file to base64 for Gemini
   * Gemini expects inlineData with mimeType and base64 data
   */
  prepareImage(base64Data, mimeType = "image/png") {
    return {
      inlineData: {
        mimeType: mimeType,
        data: base64Data
      }
    };
  }

  /**
   * Extract text from Gemini response
   */
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

  /**
   * Execute vision prompt with image(s)
   * @param {string} prompt - Text prompt
   * @param {object} options - Options including images
   * @returns {Promise<{success: boolean, content: string, error?: string, usage?: object}>}
   */
  async execute(prompt, options = {}) {
    const apiKey = String(options.apiKey || this.apiKey || "").trim();
    if (!apiKey) {
      return {
        success: false,
        error: "Gemini API key is required. Provide via options.apiKey or GEMINI_API_KEY env variable.",
        content: ""
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // Build parts array
      const parts = [{ text: String(prompt || "") }];

      // Add images if provided
      if (options.images && Array.isArray(options.images)) {
        for (const image of options.images) {
          if (typeof image === "string") {
            if (image.startsWith("data:")) {
              // Data URL - parse mime type and base64
              const [mimeInfo, base64Data] = image.split(",");
              const mimeType = mimeInfo.match(/:(.*?);/)?.[1] || "image/png";
              parts.push(this.prepareImage(base64Data, mimeType));
            } else if (image.startsWith("http://") || image.startsWith("https://")) {
              // URL - Gemini can fetch directly
              parts.push({ fileData: { fileUri: image } });
            } else {
              // File path - read and convert
              const fs = require("fs");
              const path = require("path");
              const buffer = fs.readFileSync(image);
              const ext = path.extname(image).toLowerCase();
              const mimeTypes = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp",
                ".bmp": "image/bmp"
              };
              const mimeType = mimeTypes[ext] || "image/png";
              parts.push(this.prepareImage(buffer.toString("base64"), mimeType));
            }
          } else if (image.base64) {
            // Object with base64 property
            parts.push(this.prepareImage(image.base64, image.mimeType || "image/png"));
          } else if (image.buffer) {
            // Object with buffer property
            parts.push(this.prepareImage(image.buffer.toString("base64"), image.mimeType || "image/png"));
          } else if (image.inlineData) {
            // Already in Gemini format
            parts.push(image);
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
            ? { parts: [{ text: String(options.systemInstruction) }] }
            : undefined,
          contents: [{ parts }],
          generationConfig: {
            temperature: options.temperature ?? 0.1,
            maxOutputTokens: options.maxTokens ?? 8192,
            responseMimeType: options.responseMimeType || "text/plain"
          },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Gemini Vision request failed (${response.status}): ${text}`,
          content: ""
        };
      }

      const payload = await response.json();
      const content = this.extractText(payload);

      return {
        success: true,
        content,
        usage: this.normalizeUsage(payload.usageMetadata || {}),
        model: this.model
      };

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        return {
          success: false,
          error: `Gemini Vision request timeout after ${this.timeout}ms`,
          content: ""
        };
      }
      return {
        success: false,
        error: error.message,
        content: ""
      };
    }
  }

  /**
   * Execute with JSON response mode
   * Useful for structured extraction
   */
  async executeJSON(prompt, options = {}) {
    return this.execute(prompt, {
      ...options,
      responseMimeType: "application/json"
    });
  }

  /**
   * Execute chat conversation with vision
   */
  async executeChat(messages, options = {}) {
    const apiKey = String(options.apiKey || this.apiKey || "").trim();
    if (!apiKey) {
      return {
        success: false,
        error: "Gemini API key is required.",
        content: ""
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
          contents: messages,
          generationConfig: {
            temperature: options.temperature ?? 0.1,
            maxOutputTokens: options.maxTokens ?? 8192,
          },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Gemini Chat failed (${response.status}): ${text}`,
          content: ""
        };
      }

      const payload = await response.json();
      return {
        success: true,
        content: this.extractText(payload),
        usage: this.normalizeUsage(payload.usageMetadata || {})
      };

    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: error.message,
        content: ""
      };
    }
  }
}

module.exports = GeminiVisionClientTool;
