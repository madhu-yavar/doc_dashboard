/**
 * Document Structure Analyzer Skill (Stage 1)
 * Analyzes prescription document layout and identifies regions
 * Part of two-stage prescription extraction pipeline
 */

class DocumentStructureAnalyzerSkill {
  constructor(config = {}) {
    this.name = "Document Structure Analyzer";
    this.version = "1.0.0";
    this.config = config;
    this.gemmaVisionClient = null;
  }

  getGemmaClient() {
    if (!this.gemmaVisionClient) {
      const GemmaVisionClientTool = require("../../../tools/llm/gemma_vision_client.tool.cjs");
      this.gemmaVisionClient = new GemmaVisionClientTool({
        baseUrl: this.config.gemmaBaseUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions",
        model: this.config.gemmaModel || "google/gemma-4-26B-A4B-it",
        timeout: this.config.timeout || 120000
      });
    }
    return this.gemmaVisionClient;
  }

  parseModelJson(content) {
    const normalized = String(content || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const candidates = [normalized];
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

  buildPrompt() {
    return `You are an expert at analyzing medical prescription document layouts.

Your task is to analyze the prescription document structure and identify key regions.

ANALYZE THE FOLLOWING:
1. Page count (if visible)
2. Hospital header/logo presence
3. Patient information area
4. Prescription/medication table
5. Vitals section
6. Lab investigations section (with checkboxes/ticks)
7. Diagnosis area
8. Doctor's signature area
9. Any handwritten regions

QUALITY RULES:
- Be precise about region locations (top, middle, bottom, left, right)
- Note if sections are printed forms or handwritten
- Identify checkbox/tick mark areas for lab investigations

Return ONLY valid JSON in this format:
{
  "page_count": 1,
  "has_hospital_header": true,
  "has_logo": false,
  "regions": {
    "patient_info": {"location": "top_left", "is_printed": true},
    "prescription_table": {"location": "middle_right", "has_handwriting": true},
    "vitals_section": {"location": "bottom_left", "is_empty": false},
    "lab_investigations": {"location": "bottom_right", "has_checkboxes": true},
    "diagnosis_area": {"location": "middle_left", "has_content": true},
    "doctor_signature": {"location": "bottom_right", "is_present": true}
  },
  "handwriting_regions": [
    {"area": "prescription_table", "percentage_estimate": 60}
  ],
  "document_type": "prescription_form|handwritten_prescription|mixed"
}

Remember: Return ONLY the JSON object, no additional text.`;
  }

  async execute(context) {
    const { filePath, onProgress } = context;

    if (!filePath) {
      return {
        success: false,
        step: "document_structure_analyzer",
        error: "File path is required"
      };
    }

    try {
      const gemmaClient = this.getGemmaClient();

      if (onProgress) {
        onProgress({
          type: "info",
          step: "document_structure_analyzer",
          status: "processing",
          message: "Analyzing document structure..."
        });
      }

      const prompt = this.buildPrompt();

      const result = await gemmaClient.execute(prompt, {
        images: [filePath],
        temperature: 0.1,
        maxTokens: 1500,
        systemPrompt: "You are a medical document layout analysis expert."
      });

      if (!result.success) {
        return {
          success: false,
          step: "document_structure_analyzer",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);

      if (onProgress) {
        onProgress({
          type: "success",
          step: "document_structure_analyzer",
          status: "complete",
          message: `Document structure analyzed: ${data.document_type || "unknown"}`
        });
      }

      return {
        success: true,
        step: "document_structure_analyzer",
        data: {
          document_structure: {
            page_count: data.page_count || 1,
            has_prescription_table: !!data.regions?.prescription_table,
            has_vitals_section: !!data.regions?.vitals_section && !data.regions.vitals_section.is_empty,
            has_lab_investigations: !!data.regions?.lab_investigations,
            has_radiology_section: false, // Can be enhanced later
            prescription_table_location: data.regions?.prescription_table?.location || "unknown",
            lab_selections_region: data.regions?.lab_investigations?.location || null,
            document_type: data.document_type || "unknown"
          },
          regions: data.regions || {},
          handwriting_regions: data.handwriting_regions || []
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "document_structure_analyzer",
        error: error.message
      };
    }
  }
}

module.exports = DocumentStructureAnalyzerSkill;
