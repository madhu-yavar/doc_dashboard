/**
 * Gemma LLM Client Tool
 * Communicates with Gemma API for text generation
 */

class AsyncSemaphore {
  constructor(maxConcurrency) {
    this.maxConcurrency = Math.max(1, Number(maxConcurrency) || 1);
    this.activeCount = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return this.createRelease();
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    }).then(() => {
      this.activeCount += 1;
      return this.createRelease();
    });
  }

  createRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount = Math.max(0, this.activeCount - 1);

      const next = this.queue.shift();
      if (next) {
        next();
      }
    };
  }

  snapshot() {
    return {
      maxConcurrency: this.maxConcurrency,
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
    };
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

let sharedSemaphore = null;
let sharedSemaphoreLimit = null;

function getSharedSemaphore(limit) {
  const normalizedLimit = parsePositiveInt(limit, 4);
  if (!sharedSemaphore || sharedSemaphoreLimit !== normalizedLimit) {
    sharedSemaphore = new AsyncSemaphore(normalizedLimit);
    sharedSemaphoreLimit = normalizedLimit;
  }
  return sharedSemaphore;
}

class GemmaClientTool {
  constructor(config = {}) {
    this.name = "Gemma LLM Client";
    this.version = "1.0.0";
    this.baseUrl = config.baseUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
    this.model = config.model || process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it";
    this.timeout = config.timeout || 180000;
    this.maxInflight = parsePositiveInt(config.maxInflight || process.env.GEMMA_MAX_INFLIGHT, 4);
    this.semaphore = getSharedSemaphore(this.maxInflight);
  }

  /**
   * Send a prompt to Gemma and get the response
   * @param {string} prompt - The prompt to send
   * @param {object} options - Additional options (temperature, maxTokens, etc.)
   * @returns {Promise<{success: boolean, content: string, usage: object, error?: string}>}
   */
  async execute(prompt, options = {}) {
    const controller = new AbortController();
    const queuedAt = Date.now();
    const release = await this.semaphore.acquire();
    const requestStartedAt = Date.now();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
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
      const requestEndedAt = Date.now();
      const usage = this.buildUsage(null, requestStartedAt, requestEndedAt, queuedAt);

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Gemma request failed (${response.status}): ${text}`,
          content: "",
          usage,
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

      return {
        success: true,
        content,
        usage: this.buildUsage(payload, requestStartedAt, requestEndedAt, queuedAt),
        model: this.model
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const requestEndedAt = Date.now();
      const usage = this.buildUsage(null, requestStartedAt, requestEndedAt, queuedAt);

      if (error.name === "AbortError") {
        return {
          success: false,
          error: `Request timeout after ${this.timeout}ms`,
          content: "",
          usage,
        };
      }

      return {
        success: false,
        error: error.message,
        content: "",
        usage,
      };
    } finally {
      release();
    }
  }

  /**
   * Send a multi-turn conversation
   */
  async executeChat(messages, options = {}) {
    const controller = new AbortController();
    const queuedAt = Date.now();
    const release = await this.semaphore.acquire();
    const requestStartedAt = Date.now();
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
      const requestEndedAt = Date.now();
      const usage = this.buildUsage(null, requestStartedAt, requestEndedAt, queuedAt);

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Gemma request failed (${response.status}): ${text}`,
          content: "",
          usage,
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

      return {
        success: true,
        content,
        usage: this.buildUsage(payload, requestStartedAt, requestEndedAt, queuedAt)
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const requestEndedAt = Date.now();
      return {
        success: false,
        error: error.message,
        content: "",
        usage: this.buildUsage(null, requestStartedAt, requestEndedAt, queuedAt),
      };
    } finally {
      release();
    }
  }

  /**
   * Stream responses (for future use)
   */
  async stream(prompt, options = {}, onChunk) {
    // Streaming implementation can be added here
    return this.execute(prompt, options);
  }

  buildUsage(payload, requestStartedAt, requestEndedAt, queuedAt) {
    const queueWaitMs = Math.max(0, requestStartedAt - queuedAt);
    const latencyMs = Math.max(0, requestEndedAt - requestStartedAt);
    const usage = payload?.usage || {};

    return {
      promptTokens: usage.prompt_tokens || usage.promptTokens || 0,
      completionTokens: usage.completion_tokens || usage.completionTokens || 0,
      totalTokens: usage.total_tokens || usage.totalTokens || 0,
      latency: latencyMs,
      latencyMs,
      queueWaitMs,
      queuedAt: new Date(queuedAt).toISOString(),
      startedAt: new Date(requestStartedAt).toISOString(),
      endedAt: new Date(requestEndedAt).toISOString(),
      inflight: this.semaphore.snapshot(),
    };
  }
}

module.exports = GemmaClientTool;
