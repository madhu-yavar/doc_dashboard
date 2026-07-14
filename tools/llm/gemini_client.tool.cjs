class GeminiClientTool {
  constructor(config = {}) {
    this.name = "Gemini LLM Client";
    this.version = "1.1.0"; // Bumped for model fallback support
    this.baseUrl = config.baseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models";
    this.model = config.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    this.timeout = config.timeout || 120000;
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || "";
    this.apiKeyFallback = config.apiKeyFallback || process.env.GEMINI_API_KEY_FALLBACK || "";
    this.apiKeys = [this.apiKey, this.apiKeyFallback].filter(Boolean);

    // Model fallback chain
    this.models = [
      this.model,
      process.env.GEMINI_MODEL_FALLBACK_1,
      process.env.GEMINI_MODEL_FALLBACK_2,
      process.env.GEMINI_MODEL_FALLBACK_3
    ].filter(Boolean);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  isRetryableStatus(status) {
    return [408, 429, 500, 502, 503, 504].includes(Number(status));
  }

  isRetryableError(error) {
    const message = String(error?.message || error || "");
    return (
      error?.name === "AbortError" ||
      message.includes("fetch failed") ||
      message.includes("ECONNRESET") ||
      message.includes("ETIMEDOUT") ||
      message.includes("ENOTFOUND")
    );
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
    // Get available API keys - use provided key, then primary, then fallback
    const availableKeys = this.apiKeys.length > 0 ? this.apiKeys : [this.apiKey].filter(Boolean);
    if (availableKeys.length === 0) {
      return {
        success: false,
        error: "Gemini API key is required.",
        content: "",
      };
    }

    const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : 2;

    // Try each API key with retries before moving to the next key
    for (let keyIndex = 0; keyIndex < availableKeys.length; keyIndex++) {
      const apiKey = availableKeys[keyIndex];
      const isKeyFallback = keyIndex > 0;

      // Try each model in the fallback chain
      for (let modelIndex = 0; modelIndex < this.models.length; modelIndex++) {
        const currentModel = this.models[modelIndex];
        const isModelFallback = modelIndex > 0;

        if (isModelFallback) {
          console.log(`[Gemini] Trying fallback model ${modelIndex}: ${currentModel}`);
        }

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
                console.warn("URL images not directly supported, use base64 data URLs");
              } else if (this.isBase64(image)) {
                parts.push({
                  inlineData: {
                    mimeType: "image/png",
                    data: image
                  }
                });
              } else {
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
              parts.push({
                inlineData: {
                  mimeType: image.mimeType || "image/png",
                  data: image.base64
                }
              });
            } else if (image.buffer) {
              parts.push({
                inlineData: {
                  mimeType: image.mimeType || "image/png",
                  data: image.buffer.toString("base64")
                }
              });
            }
          }
        }

        const response = await fetch(`${this.baseUrl}/${currentModel}:generateContent`, {
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

          // Try next model if this is a non-retryable error or we've exhausted retries
          const isRetryable = this.isRetryableStatus(response.status);
          if (!isRetryable || attempt >= maxRetries) {
            // If we have more models to try, continue to next model
            if (modelIndex < this.models.length - 1) {
              console.warn(`[Gemini] Model ${currentModel} failed with HTTP ${response.status}. Trying fallback model...`);
              break; // Break out of retry loop, continue to next model
            }
            // If we have more API keys to try, continue to next key
            if (keyIndex < availableKeys.length - 1) {
              console.warn(`[Gemini] API key ${keyIndex + 1} failed with HTTP ${response.status}. Trying fallback API key...`);
              break; // Break out of retry loop, continue to next API key
            }
            // No more keys/models to try, return final error
            return {
              success: false,
              error: `Gemini request failed (${response.status}): ${text}`,
              content: "",
            };
          }

          // Retryable error with retries remaining
          const delayMs = 1500 * (attempt + 1);
          console.warn(`[Gemini] Retry ${attempt + 1}/${maxRetries} after HTTP ${response.status}. Waiting ${delayMs}ms.`);
          await this.sleep(delayMs);
          continue;
        }

        const payload = await response.json();

        const candidate = payload.candidates?.[0];
        const finishReason = candidate?.finishReason;
        if (finishReason && finishReason !== "STOP") {
          console.warn(`[Gemini] Response not complete: finishReason=${finishReason}`);
        }

        // Success - return immediately with model info
        if (isKeyFallback || isModelFallback) {
          console.log(`[Gemini] Request succeeded with ${isModelFallback ? `model: ${currentModel}` : `fallback API key`}`);
        }
        return {
          success: true,
          content: this.extractText(payload),
          usage: this.normalizeUsage(payload.usageMetadata || {}),
          model: currentModel,
          finishReason: finishReason,
          rawPayload: payload,
        };
      } catch (error) {
        clearTimeout(timeoutId);

        const isRetryable = this.isRetryableError(error);
        if (!isRetryable || attempt >= maxRetries) {
          // If we have more models to try, continue to next model
          if (modelIndex < this.models.length - 1 && error.name !== "AbortError") {
            console.warn(`[Gemini] Model ${currentModel} failed with error: ${error.message}. Trying fallback model...`);
            break; // Break out of retry loop, continue to next model
          }
          // If we have more API keys to try, continue to next key
          if (keyIndex < availableKeys.length - 1 && error.name !== "AbortError") {
            console.warn(`[Gemini] API key ${keyIndex + 1} failed with error: ${error.message}. Trying fallback API key...`);
            break; // Break out of retry loop, continue to next API key
          }
          // No more keys/models to try or it's a timeout, return final error
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

        // Retryable error with retries remaining
        const delayMs = 1500 * (attempt + 1);
        console.warn(`[Gemini] Retry ${attempt + 1}/${maxRetries} after transient error: ${error.message}. Waiting ${delayMs}ms.`);
        await this.sleep(delayMs);
        continue;
      }
      }
      }
    }

    // All API keys exhausted
    return {
      success: false,
      error: "Gemini request failed with all available API keys",
      content: "",
    };
  }

  async executeGroundedSearch(question, options = {}) {
    // Get available API keys - use provided key, then primary, then fallback
    const availableKeys = this.apiKeys.length > 0 ? this.apiKeys : [this.apiKey].filter(Boolean);
    if (availableKeys.length === 0) {
      return {
        success: false,
        error: "Gemini API key is required.",
        content: "",
        citations: [],
      };
    }

    const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : 2;

    // Try each API key with retries before moving to the next key
    for (let keyIndex = 0; keyIndex < availableKeys.length; keyIndex++) {
      const apiKey = availableKeys[keyIndex];
      const isFallback = keyIndex > 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          const response = await fetch(`${this.baseUrl}/${currentModel}:generateContent`, {
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
            const isRetryable = this.isRetryableStatus(response.status);

            if (!isRetryable || attempt >= maxRetries) {
              if (keyIndex < availableKeys.length - 1) {
                console.warn(`[Gemini] API key ${keyIndex + 1} failed for grounded search with HTTP ${response.status}. Trying fallback key...`);
                break;
              }
              return {
                success: false,
                error: `Gemini grounded search failed (${response.status}): ${text}`,
                content: "",
                citations: [],
              };
            }

            const delayMs = 1500 * (attempt + 1);
            console.warn(`[Gemini] Retry ${attempt + 1}/${maxRetries} for grounded search after HTTP ${response.status}. Waiting ${delayMs}ms.`);
            await this.sleep(delayMs);
            continue;
          }

          const payload = await response.json();
          if (isFallback) {
            console.log(`[Gemini] Grounded search succeeded with fallback API key`);
          }
          return {
            success: true,
            content: this.extractText(payload),
            citations: this.buildGroundingCitations(payload),
            usage: this.normalizeUsage(payload.usageMetadata || {}),
            model: this.model,
          };
        } catch (error) {
          clearTimeout(timeoutId);

          const isRetryable = this.isRetryableError(error);
          if (!isRetryable || attempt >= maxRetries) {
            if (keyIndex < availableKeys.length - 1 && error.name !== "AbortError") {
              console.warn(`[Gemini] API key ${keyIndex + 1} failed for grounded search: ${error.message}. Trying fallback key...`);
              break;
            }
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

          // Retryable error with retries remaining
          const delayMs = 1500 * (attempt + 1);
          console.warn(`[Gemini] Retry ${attempt + 1}/${maxRetries} for grounded search after error: ${error.message}. Waiting ${delayMs}ms.`);
          await this.sleep(delayMs);
          continue;
        }
      }
    }

    // All API keys exhausted
    return {
      success: false,
      error: "Gemini grounded search failed with all available API keys",
      content: "",
      citations: [],
    };
  }
}

module.exports = GeminiClientTool;
