/**
 * Gemma LLM Client Tool
 * Communicates with Gemma API for text generation
 */

class GemmaClientTool {
  constructor(config = {}) {
    this.name = "Gemma LLM Client";
    this.version = "1.0.0";
    this.baseUrl = config.baseUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
    this.model = config.model || process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it";
    this.timeout = config.timeout || 180000;
  }

  /**
   * Send a prompt to Gemma and get the response
   * @param {string} prompt - The prompt to send
   * @param {object} options - Additional options (temperature, maxTokens, etc.)
   * @returns {Promise<{success: boolean, content: string, usage: object, error?: string}>}
   */
  async execute(prompt, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const startTime = Date.now();

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens ?? 3000,
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Gemma request failed (${response.status}): ${text}`,
          content: ""
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
        model: this.model
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === "AbortError") {
        return {
          success: false,
          error: `Request timeout after ${this.timeout}ms`,
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
          max_tokens: options.maxTokens ?? 3000,
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
