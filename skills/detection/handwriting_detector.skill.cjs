/**
 * Handwriting Detection Skill
 * Detects if a document contains handwritten text using vision models
 * Uses Qwen 8B for fast classification, then routes to 30B if handwriting found
 */

class HandwritingDetectorSkill {
  constructor(config = {}) {
    this.name = "Handwriting Detector";
    this.version = "1.0.0";
    this.config = config;
    this.qwenVisionClient = null;

    // Lazy load the Qwen client
    if (config.qwenVisionClient) {
      this.qwenVisionClient = config.qwenVisionClient;
    }
  }

  getQwenClient() {
    if (!this.qwenVisionClient) {
      const QwenVisionClientTool = require("../../tools/llm/qwen_vision_client.tool.cjs");
      this.qwenVisionClient = new QwenVisionClientTool({
        baseUrl: this.config.qwenUrl || process.env.QWEN_URL || "http://206.1.62.28:8001/v1/chat/completions",
        model: this.config.qwenModel || "cyankiwi/Qwen3-VL-30B-A3B-Instruct-AWQ-4bit",
        timeout: this.config.timeout || 60000 // 60s for detection
      });
    }
    return this.qwenVisionClient;
  }

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

  buildDetectionPrompt() {
    return `You are a document analyzer specializing in detecting handwritten text in medical documents.

Your task is to analyze this document page and determine:

1. Does it contain ANY handwritten text? (including annotations, signatures, notes)
2. What percentage of the text appears to be handwritten vs printed?
3. Are there specific sections that are handwritten? (e.g., prescriptions, notes, signatures)

Return ONLY valid JSON in this format:
{
  "has_handwriting": true/false,
  "handwriting_percentage": 0-100,
  "handwriting_sections": ["list of sections with handwriting"],
  "confidence": "high/medium/low",
  "reasoning": "brief explanation of your assessment"
}

Look for:
- Handwritten medication names or dosages
- Doctor's handwritten notes
- Patient annotations
- Signature blocks
- Handwritten corrections or additions
- Any text that appears to be in cursive or irregular script

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  /**
   * Detect handwriting in a document
   * @param {object} context - Execution context
   * @param {string} context.filePath - Path to the PDF/image file
   * @param {Function} context.onProgress - Progress callback
   * @returns {Promise<object>} Detection result
   */
  async execute(context) {
    const { filePath, onProgress } = context;

    if (!filePath) {
      return {
        success: false,
        step: "handwriting_detector",
        error: "File path is required"
      };
    }

    try {
      const qwenClient = this.getQwenClient();

      if (onProgress) {
        onProgress({
          type: "info",
          step: "handwriting_detector",
          status: "processing",
          message: "Analyzing document for handwriting..."
        });
      }

      // Build the detection prompt
      const prompt = this.buildDetectionPrompt();

      // Execute detection with vision - using first page only for speed
      const result = await qwenClient.execute(prompt, {
        images: [filePath],
        temperature: 0.1,
        maxTokens: 500,
        systemPrompt: "You are a document analysis expert specializing in handwriting detection."
      });

      if (!result.success) {
        return {
          success: false,
          step: "handwriting_detector",
          error: result.error
        };
      }

      if (onProgress) {
        onProgress({
          type: "info",
          step: "handwriting_detector",
          status: "parsing",
          message: "Parsing detection results..."
        });
      }

      // Parse the JSON response
      const data = this.parseModelJson(result.content);

      // Add metadata
      data.meta = {
        detected_at: new Date().toISOString(),
        model: result.model,
        latency_ms: result.usage?.latency || 0
      };

      if (onProgress) {
        const handwritingStatus = data.has_handwriting ? "Handwriting detected" : "No handwriting";
        onProgress({
          type: "success",
          step: "handwriting_detector",
          status: "complete",
          message: `${handwritingStatus} (${data.handwriting_percentage || 0}% confidence)`,
          data: {
            hasHandwriting: data.has_handwriting,
            percentage: data.handwriting_percentage,
            sections: data.handwriting_sections
          }
        });
      }

      return {
        success: true,
        step: "handwriting_detector",
        data: data,
        usage: result.usage
      };
    } catch (error) {
      // If detection fails, assume no handwriting for safety
      return {
        success: true,
        step: "handwriting_detector",
        data: {
          has_handwriting: false,
          handwriting_percentage: 0,
          handwriting_sections: [],
          confidence: "low",
          reasoning: `Detection failed: ${error.message}`,
          meta: {
            detected_at: new Date().toISOString(),
            error: error.message
          }
        }
      };
    }
  }

  /**
   * Quick detection - only checks first page, returns boolean
   * Useful for fast routing decisions
   */
  async quickDetect(filePath) {
    const result = await this.execute({ filePath });
    return {
      hasHandwriting: result.data?.has_handwriting || false,
      confidence: result.data?.confidence || "low"
    };
  }
}

module.exports = HandwritingDetectorSkill;
