/**
 * Gemma Handwriting Detector Skill
 * Detects handwriting presence and percentage in prescription documents
 * Uses Gemma Vision model to analyze document images
 */

const GemmaVisionClientTool = require("../../tools/llm/gemma_vision_client.tool.cjs");

class GemmaHandwritingDetectorSkill {
  constructor(config = {}) {
    this.name = "Gemma Handwriting Detector";
    this.version = "1.0.0";
    this.gemmaVision = new GemmaVisionClientTool(config.gemma || {});
    this.threshold = config.handwritingThreshold || 15; // Default 15%
  }

  /**
   * Detect handwriting in prescription document
   * @param {object} context - { pdfPath, images, pdfText }
   * @returns {Promise<object>}
   */
  async execute(context) {
    const { pdfPath, images, pdfText } = context;

    try {
      // Use first image if provided, otherwise use pdfPath (will be converted to image)
      const firstPageImage = (images && images.length > 0) ? images[0] : pdfPath;

      if (!firstPageImage) {
        return {
          success: false,
          error: "No image or PDF path provided for handwriting detection",
          data: this.getDefaultResult()
        };
      }

      const prompt = this.buildDetectionPrompt();

      const result = await this.gemmaVision.execute(prompt, {
        images: [firstPageImage]
      });

      if (!result.success) {
        return {
          success: false,
          error: `Handwriting detection failed: ${result.error}`,
          data: this.getDefaultResult()
        };
      }

      const analysis = this.parseResponse(result.content);

      return {
        success: true,
        step: "handwriting_detection",
        data: {
          has_handwriting: analysis.hasHandwriting,
          handwriting_percentage: analysis.percentage,
          handwriting_regions: analysis.regions,
          exceeds_threshold: analysis.percentage >= this.threshold,
          threshold_used: this.threshold,
          detection_method: "gemma_vision",
          pages_analyzed: 1
        },
        usage: result.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: this.getDefaultResult()
      };
    }
  }

  /**
   * Build prompt for handwriting detection
   */
  buildDetectionPrompt() {
    return `Analyze this prescription document image and detect handwriting.

Your task:
1. Estimate the PERCENTAGE of the document that contains handwriting (0-100)
2. Identify which regions have handwriting
3. Determine if handwriting is present in critical areas (medications, dosage, instructions)

Respond with JSON:
{
  "hasHandwriting": true/false,
  "percentage": 0-100,
  "regions": [
    {
      "area": "patient_info|medications|diagnosis|doctor_notes|other",
      "description": "brief description",
      "confidence": 0.0-1.0
    }
  ],
  "critical_areas_with_handwriting": ["medications", "dosage", "instructions"]
}

Rules:
- Printed text (hospital forms) is NOT handwriting
- Doctor's handwritten notes ARE handwriting
- Handwritten medications ARE handwriting
- Tick marks and circles are NOT considered handwriting for this check`;
  }

  /**
   * Parse Gemma response
   */
  parseResponse(content) {
    try {
      // Extract JSON from response
      let jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.getDefaultAnalysis();
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        hasHandwriting: parsed.hasHandwriting || false,
        percentage: Math.min(100, Math.max(0, parsed.percentage || 0)),
        regions: Array.isArray(parsed.regions) ? parsed.regions : [],
        criticalAreas: Array.isArray(parsed.critical_areas_with_handwriting)
          ? parsed.critical_areas_with_handwriting
          : []
      };
    } catch (error) {
      console.error("Failed to parse handwriting detection response:", error.message);
      return this.getDefaultAnalysis();
    }
  }

  /**
   * Get default analysis when parsing fails
   */
  getDefaultAnalysis() {
    return {
      hasHandwriting: false,
      percentage: 0,
      regions: [],
      criticalAreas: []
    };
  }

  /**
   * Get default result when detection fails
   */
  getDefaultResult() {
    return {
      has_handwriting: false,
      handwriting_percentage: 0,
      handwriting_regions: [],
      exceeds_threshold: false,
      threshold_used: this.threshold,
      detection_method: "fallback",
      pages_analyzed: 0
    };
  }

  /**
   * Check if Stage 3 (Gemini) should be triggered
   * NO THRESHOLD - any handwriting triggers Stage 3
   */
  shouldTriggerStage3(detectionResult) {
    // No threshold - if ANY handwriting is detected, trigger Stage 3
    return detectionResult?.has_handwriting === true;
  }
}

module.exports = GemmaHandwritingDetectorSkill;
