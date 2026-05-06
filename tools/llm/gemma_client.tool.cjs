/**
 * Gemma LLM Client Tool
 * Communicates with Gemma API for text generation
 * Supports fallback to secondary model if primary fails
 */

class GemmaClientTool {
  constructor(config = {}) {
    this.name = "Gemma LLM Client";
    this.version = "2.0.0";

    // Primary model configuration
    this.baseUrl = config.baseUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
    this.model = config.model || process.env.GEMMA_MODEL || "google/gemma-4-31B-it";
    this.timeout = config.timeout || 180000;

    // Fallback model configuration (for 26B or alternative endpoint)
    this.fallbackBaseUrl = config.fallbackBaseUrl || process.env.GEMMA_FALLBACK_URL || this.baseUrl;
    this.fallbackModel = config.fallbackModel || process.env.GEMMA_FALLBACK_MODEL || "google/gemma-2-27b-it";
    this.enableFallback = config.enableFallback ?? process.env.GEMMA_ENABLE_FALLBACK !== "false";

    // Gemma 4-31B has a max context of 16384 tokens
    // Leave room for input tokens by defaulting to 2048 max output
    this.defaultMaxTokens = config.maxTokens || 2048;
  }

  /**
   * Send a prompt to Gemma and get the response
   * Falls back to secondary model if primary fails
   * @param {string} prompt - The prompt to send
   * @param {object} options - Additional options (temperature, maxTokens, etc.)
   * @returns {Promise<{success: boolean, content: string, usage: object, error?: string, model?: string}>}
   */
  async execute(prompt, options = {}) {
    // Try primary model first
    const primaryResult = await this.executeWithModel(this.baseUrl, this.model, prompt, options);

    if (primaryResult.success || !this.enableFallback) {
      return primaryResult;
    }

    // Primary failed, try fallback
    console.log(`⚠️  Primary model ${this.model} failed, trying fallback ${this.fallbackModel}...`);
    const fallbackResult = await this.executeWithModel(this.fallbackBaseUrl, this.fallbackModel, prompt, options);

    if (fallbackResult.success) {
      fallbackResult.usedFallback = true;
      fallbackResult.primaryError = primaryResult.error;
    }

    return fallbackResult;
  }

  /**
   * Execute with a specific model/endpoint
   */
  async executeWithModel(baseUrl, model, prompt, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const startTime = Date.now();

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: prompt }],
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens ?? this.defaultMaxTokens,
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Gemma request failed (${response.status}): ${text}`,
          content: "",
          model
        };
      }

      const payload = await response.json();
      let content = payload.choices?.[0]?.message?.content || "";

      // Clean up markdown code blocks
      if (content.includes("```json")) {
        content = content.split("```json")[1].split("```")[0].trim();
      } else if (content.includes("```")) {
        content = content.split("```")[1].split("```")[0].trim();
      }

      const endTime = Date.now();

      return {
        success: true,
        content,
        usage: {
          promptTokens: payload.usage?.prompt_tokens || 0,
          completionTokens: payload.usage?.completion_tokens || 0,
          totalTokens: payload.usage?.total_tokens || 0,
          latency: endTime - startTime
        },
        model
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === "AbortError") {
        return {
          success: false,
          error: `Request timeout after ${this.timeout}ms`,
          content: "",
          model
        };
      }

      return {
        success: false,
        error: error.message,
        content: "",
        model
      };
    }
  }

  /**
   * Send a multi-turn conversation
   */
  async executeChat(messages, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens ?? this.defaultMaxTokens,
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemma request failed (${response.status}): ${text}`);
      }

      const payload = await response.json();
      let content = payload.choices?.[0]?.message?.content || "";

      // Clean up markdown code blocks
      if (content.includes("```json")) {
        content = content.split("```json")[1].split("```")[0].trim();
      } else if (content.includes("```")) {
        content = content.split("```")[1].split("```")[0].trim();
      }

      return {
        success: true,
        content,
        usage: payload.usage
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

  /**
   * Stream responses (for future use)
   */
  async stream(prompt, options = {}, onChunk) {
    // Streaming implementation can be added here
    return this.execute(prompt, options);
  }
}

module.exports = GemmaClientTool;
