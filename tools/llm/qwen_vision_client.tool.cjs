/**
 * Qwen Vision LLM Client Tool
 * Communicates with Qwen Vision API for image/text understanding
 * Supports multi-modal input (text + images)
 */

class QwenVisionClientTool {
  constructor(config = {}) {
    this.name = "Qwen Vision Client";
    this.version = "1.0.0";
    this.baseUrl = config.baseUrl || process.env.QWEN_URL || "http://206.1.62.28:8001/v1/chat/completions";
    this.timeout = config.timeout || 120000;
    this.model = config.model || "cyankiwi/Qwen3-VL-30B-A3B-Instruct-AWQ-4bit";
  }

  /**
   * Convert a file to base64 data URL
   * @param {string} filePath - Path to the file
   * @param {string} mimeType - MIME type of the file
   * @returns {Promise<string>} Base64 data URL
   */
  async fileToBase64(filePath, mimeType = "application/pdf") {
    const fs = require("fs/promises");
    const buffer = await fs.readFile(filePath);
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }

  /**
   * Get the appropriate MIME type for a file
   * @param {string} filePath - Path to the file
   * @returns {string} MIME type
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
    return mimeTypes[ext] || "application/octet-stream";
  }

  /**
   * Convert PDF to PNG images (first page only for speed)
   * @param {string} pdfPath - Path to the PDF file
   * @returns {Promise<string[]>} Array of image file paths
   */
  async convertPdfToImages(pdfPath) {
    const { execSync } = require("child_process");
    const fs = require("fs/promises");
    const path = require("path");
    const crypto = require("crypto");

    const tempDir = "/tmp/qwen_vision_temp";
    await fs.mkdir(tempDir, { recursive: true });

    const fileId = crypto.randomBytes(8).toString("hex");
    const prefix = path.join(tempDir, fileId);

    try {
      // Convert PDF to PNG using pdftoppm
      // -png: PNG format
      // -singlefile: Only first page (for faster processing)
      // -r 300: 300 DPI for good quality
      execSync(`pdftoppm -png -singlefile -r 300 "${pdfPath}" "${prefix}"`, {
        stdio: "ignore",
        timeout: 30000
      });

      // When using -singlefile, pdftoppm doesn't add a page number suffix
      const imagePath = `${prefix}.png`;

      // Check if file was created
      try {
        await fs.access(imagePath);
        return [imagePath];
      } catch {
        throw new Error("PDF conversion failed - no output image created");
      }
    } catch (error) {
      throw new Error(`PDF to image conversion failed: ${error.message}`);
    }
  }

  /**
   * Clean up temporary image files
   * @param {string[]} filePaths - Array of file paths to delete
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
   * @param {string} filePath - Path to the file
   * @returns {Promise<{paths: string[], cleanup: boolean}>} Image paths and cleanup flag
   */
  async processFilePath(filePath) {
    const ext = filePath.toLowerCase().split(".").pop();

    if (ext === "pdf") {
      // Convert PDF to images
      const imagePaths = await this.convertPdfToImages(filePath);
      return { paths: imagePaths, cleanup: true };
    } else {
      // Return as-is for image files
      return { paths: [filePath], cleanup: false };
    }
  }

  /**
   * Send a prompt with image(s) to Qwen Vision and get the response
   * @param {string} prompt - The prompt to send
   * @param {object} options - Additional options including images
   * @returns {Promise<{success: boolean, content: string, usage: object, error?: string}>}
   */
  async execute(prompt, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let tempImagePaths = [];

    try {
      const startTime = Date.now();

      // Build messages array
      const messages = [];

      // Add system message if provided
      if (options.systemPrompt) {
        messages.push({
          role: "system",
          content: options.systemPrompt
        });
      }

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
          max_tokens: options.maxTokens ?? 4000,
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Qwen Vision request failed (${response.status}): ${text}`,
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
   * Send a chat conversation with vision support
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
          max_tokens: options.maxTokens ?? 4000,
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Qwen Vision request failed (${response.status}): ${text}`);
      }

      const payload = await response.json();
      let responseContent = payload.choices?.[0]?.message?.content || "";

      // Clean up markdown code blocks
      if (responseContent.includes("```json")) {
        responseContent = responseContent.split("```json")[1].split("```")[0].trim();
      } else if (responseContent.includes("```")) {
        responseContent = responseContent.split("```")[1].split("```")[0].trim();
      }

      return {
        success: true,
        content: responseContent,
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
   * Extract structured data from a document image
   * @param {string} imagePath - Path to the image/PDF
   * @param {object} extractionSchema - Schema to extract
   * @returns {Promise<object>} Extracted data
   */
  async extractFromDocument(imagePath, extractionSchema) {
    const prompt = this.buildExtractionPrompt(extractionSchema);

    const result = await this.execute(prompt, {
      images: [imagePath],
      temperature: 0.1,
      maxTokens: 4000
    });

    if (!result.success) {
      throw new Error(result.error);
    }

    try {
      return JSON.parse(result.content);
    } catch (e) {
      // Try to extract JSON from markdown
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error("Failed to parse JSON response");
    }
  }

  /**
   * Build an extraction prompt from schema
   */
  buildExtractionPrompt(schema) {
    return `Extract the following information from this handwritten prescription document.

Return the result as a JSON object with these fields:
${JSON.stringify(schema, null, 2)}

Rules:
1. Extract ALL visible medications with their full details
2. Include dosage, frequency, and route if visible
3. Note any doctor information visible
4. Include any dates or timestamps visible
5. Note patient information if visible
6. Mark fields as null if not clearly visible

Return ONLY valid JSON, no additional text.`;
  }
}

module.exports = QwenVisionClientTool;
