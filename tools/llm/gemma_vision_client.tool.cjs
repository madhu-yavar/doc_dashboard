/**
 * Gemma Vision LLM Client Tool
 * Extends Gemma with vision support for image understanding
 * Compatible with Gemma 4-31B and other multimodal Gemma models
 */

class GemmaVisionClientTool {
  constructor(config = {}) {
    this.name = "Gemma Vision Client";
    this.version = "1.0.0";
    this.baseUrl = config.baseUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
    this.model = config.model || process.env.GEMMA_MODEL || "google/gemma-4-31B-it";
    this.timeout = config.timeout || 180000;
    // Gemma 4-31B has a max context of 16384 tokens
    // For vision requests with images, use a lower default since images consume many tokens
    this.defaultMaxTokens = config.maxTokens || 2048;
  }

  /**
   * Get MIME type for a file based on extension
   */
  getMimeType(filePath) {
    const ext = filePath.toLowerCase().split(".").pop();
    const mimeTypes = {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      bmp: "image/bmp",
      webp: "image/webp"
    };
    return mimeTypes[ext] || "image/png";
  }

  /**
   * Convert file to base64 data URL
   */
  async fileToBase64(filePath, mimeType = "application/pdf") {
    const fs = require("fs/promises");
    const buffer = await fs.readFile(filePath);
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }

  /**
   * Convert PDF to PNG images (first page only for speed)
   */
  async convertPdfToImages(pdfPath, pageNum = 1) {
    const { execSync } = require("child_process");
    const fs = require("fs/promises");
    const path = require("path");
    const crypto = require("crypto");

    const tempDir = "/tmp/gemma_vision_temp";
    await fs.mkdir(tempDir, { recursive: true });

    const fileId = crypto.randomBytes(8).toString("hex");
    const prefix = path.join(tempDir, fileId);

    try {
      // Convert PDF to PNG using pdftoppm
      execSync(`pdftoppm -png -singlefile -r 300 "${pdfPath}" "${prefix}"`, {
        stdio: "ignore",
        timeout: 30000
      });

      // When using -singlefile, pdftoppm doesn't add a page number suffix
      const imagePath = `${prefix}.png`;

      // Check if file was created
      try {
        await fs.access(imagePath);
        return imagePath;
      } catch {
        throw new Error("PDF conversion failed - no output image created");
      }
    } catch (error) {
      throw new Error(`PDF to image conversion failed: ${error.message}`);
    }
  }

  /**
   * Clean up temporary image files
   */
  async cleanupImages(filePaths) {
    const fs = require("fs/promises");
    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath);
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Process a file path - converts PDFs to images if needed
   */
  async processFilePath(filePath) {
    const ext = filePath.toLowerCase().split(".").pop();

    if (ext === "pdf") {
      // Convert PDF to images
      const imagePath = await this.convertPdfToImages(filePath);
      return { paths: [imagePath], cleanup: true };
    } else {
      // Return as-is for image files
      return { paths: [filePath], cleanup: false };
    }
  }

  /**
   * Parse model JSON response
   */
  parseModelJson(content) {
    const normalized = String(content || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const candidates = [];
    candidates.push(normalized);

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

  /**
   * Send a prompt with image(s) to Gemma and get the response
   */
  async execute(prompt, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let tempImagePaths = [];

    try {
      const startTime = Date.now();

      // Build messages array
      const messages = [];

      // Build user message with content array
      const content = [];

      // Add text prompt
      content.push({
        type: "text",
        text: prompt
      });

      // Add images if provided
      if (options.images && Array.isArray(options.images)) {
        for (const image of options.images) {
          if (typeof image === "string") {
            // If it's a URL, use it directly
            if (image.startsWith("http://") || image.startsWith("https://")) {
              content.push({
                type: "image_url",
                image_url: {
                  url: image
                }
              });
            } else if (image.startsWith("data:")) {
              // Already a data URL
              content.push({
                type: "image_url",
                image_url: {
                  url: image
                }
              });
            } else {
              // Check if it's a PDF and convert to image
              const { paths, cleanup } = await this.processFilePath(image);
              if (cleanup) {
                tempImagePaths.push(...paths);
              }
              // Convert first image to base64
              const mimeType = this.getMimeType(paths[0]);
              const base64 = await this.fileToBase64(paths[0], mimeType);
              content.push({
                type: "image_url",
                image_url: {
                  url: base64
                }
              });
            }
          } else if (image.buffer) {
            // Buffer object with mimeType
            const base64 = `data:${image.mimeType || "image/png"};base64,${image.buffer.toString("base64")}`;
            content.push({
              type: "image_url",
              image_url: {
                url: base64
              }
            });
          } else if (image.base64) {
            // Object with base64 property
            const base64 = `data:${image.mimeType || "image/png"};base64,${image.base64}`;
            content.push({
              type: "image_url",
              image_url: {
                url: base64
              }
            });
          }
        }
      }

      messages.push({
        role: "user",
        content: content
      });

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
        return {
          success: false,
          error: `Gemma Vision request failed (${response.status}): ${text}`,
          content: ""
        };
      }

      const payload = await response.json();
      let responseContent = payload.choices?.[0]?.message?.content || "";

      // Clean up markdown code blocks
      if (responseContent.includes("```json")) {
        responseContent = responseContent.split("```json")[1].split("```")[0].trim();
      } else if (responseContent.includes("```")) {
        responseContent = responseContent.split("```")[1].split("```")[0].trim();
      }

      const endTime = Date.now();

      // Clean up temporary images
      if (tempImagePaths.length > 0) {
        // Don't await - cleanup in background
        this.cleanupImages(tempImagePaths).catch(() => {});
      }

      return {
        success: true,
        content: responseContent,
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

      // Clean up temp images on error
      if (tempImagePaths.length > 0) {
        await this.cleanupImages(tempImagePaths).catch(() => {});
      }

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
   * Execute with JSON response mode (for structured extraction)
   */
  async executeJSON(prompt, options = {}) {
    const result = await this.execute(prompt, options);
    if (!result.success) {
      return result;
    }

    try {
      const data = this.parseModelJson(result.content);
      return {
        success: true,
        data,
        content: result.content,
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        error: `JSON parse failed: ${error.message}`,
        content: result.content,
        raw: result.content
      };
    }
  }
}

module.exports = GemmaVisionClientTool;
