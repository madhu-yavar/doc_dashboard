/**
 * Visit Metadata Extractor Skill (Stage 1)
 * Extracts visit-related metadata from prescription documents
 * Part of two-stage prescription extraction pipeline
 */

class VisitMetadataExtractorSkill {
  constructor(config = {}) {
    this.name = "Visit Metadata Extractor";
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

  extractLabeledValue(pdfText, labels) {
    const text = String(pdfText || "");
    for (const label of labels) {
      const pattern = new RegExp(`${label}\\s*[:\\-]?\\s*([A-Z0-9\\/ .&()-]{2,})`, "i");
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return null;
  }

  extractDepartment(pdfText) {
    const labeledDepartment = this.extractLabeledValue(pdfText, [
      "Department",
      "Dept"
    ]);
    if (labeledDepartment) return labeledDepartment;

    const text = String(pdfText || "");
    const lineMatch = text.match(/\b(ENT|UROLOGY|NEUROLOGY|DERMATOLOGY|OBSTETRICS(?:\s+AND\s+GYNAECOLOGY)?|GYNAECOLOGY|CARDIOLOGY|ORTHOPEDICS?|PEDIATRICS?)\b[^\n]{0,20}\b(MHB|MHS|OPD|IPD)\b/i);
    return lineMatch ? lineMatch[0].trim().replace(/\s+/g, " ") : null;
  }

  extractTextFallbacks(pdfText) {
    return {
      opd_number: this.extractLabeledValue(pdfText, ["OPD?\\s*No", "OP\\s*Number", "OP\\s*No"]),
      episode_number: this.extractLabeledValue(pdfText, ["Episode\\s*No", "Episode", "Visit\\s*No", "Visit\\s*ID"]),
      ipd_number: this.extractLabeledValue(pdfText, ["IPD?\\s*No", "IP\\s*Number", "IP\\s*No"]),
      department: this.extractDepartment(pdfText),
    };
  }

  buildPrompt(pdfText = "") {
    return `You are an expert at extracting visit information from medical prescription documents.

Your task is to carefully analyze the prescription document and extract VISIT/METADATA INFORMATION ONLY.

${pdfText ? `OCR TEXT FROM DOCUMENT:\n${pdfText.substring(0, 2000)}\n\n` : ""}

EXTRACT THE FOLLOWING VISIT INFORMATION:
- Date of prescription/visit (usually labeled "Date:" or visible near patient info)
- Time of visit (if visible)
- Department / clinic label exactly as printed (if visible)

IDENTIFIER EXTRACTION - Look carefully for these specific labels:
- OPD Number: Usually labeled as "OP No", "OPD No", "OP Number" (often starts with "O" followed by digits)
- Episode Number: Usually labeled as "Episode No", "Episode", "Visit No", "Visit ID"
- IPD Number: Usually labeled as "IP No", "IPD No", "IP Number" (often starts with "I" followed by digits)

IMPORTANT DISTINCTIONS:
- "OP No" = OPD Number (put in opd_number field)
- "Episode No" = Episode Number (put in episode_number field)
- "IP No" = IPD Number (put in ipd_number field)
- "MR No" or "Hospital No" = MRN/Hospital Number (NOT a visit identifier - do not extract here)

- Visit type: OPD (outpatient) or IPD (inpatient) - infer from context or labels present

Return ONLY valid JSON in this format:
{
  "date": null,
  "time": null,
  "episode_number": null,
  "opd_number": null,
  "ipd_number": null,
  "department": null,
  "visit_type": "OPD|IPD|unknown",
  "confidence": "high/medium/low"
}

QUALITY RULES:
- Look for exact label matches: "OP No", "Episode No", "IP No"
- OPD numbers often start with "O" (e.g., "O00011843893")
- IPD numbers often start with "I" (e.g., "I00012345678")
- Preserve values exactly as written (don't format)
- If a field is not visible or unclear, use null

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  async execute(context) {
    const { filePath, pdfText = "", onProgress } = context;

    if (!filePath) {
      return {
        success: false,
        step: "visit_metadata_extractor",
        error: "File path is required"
      };
    }

    try {
      const gemmaClient = this.getGemmaClient();

      if (onProgress) {
        onProgress({
          type: "info",
          step: "visit_metadata_extractor",
          status: "processing",
          message: "Extracting visit metadata..."
        });
      }

      const prompt = this.buildPrompt(pdfText);

      const result = await gemmaClient.execute(prompt, {
        images: [filePath],
        temperature: 0.1,
        maxTokens: 800,
        systemPrompt: "You are a medical document extraction expert specializing in visit metadata."
      });

      if (!result.success) {
        return {
          success: false,
          step: "visit_metadata_extractor",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);
      const textFallbacks = this.extractTextFallbacks(pdfText);

      if (onProgress) {
        onProgress({
          type: "success",
          step: "visit_metadata_extractor",
          status: "complete",
          message: data.date ? `Visit date: ${data.date}` : "No visit information found"
        });
      }

      return {
        success: true,
        step: "visit_metadata_extractor",
        data: {
          visit: {
            date: data.date || null,
            time: data.time || null,
            episode_number: data.episode_number || textFallbacks.episode_number || null,
            episode_no: data.episode_number || textFallbacks.episode_number || null,
            opd_number: data.opd_number || textFallbacks.opd_number || null,
            ipd_number: data.ipd_number || textFallbacks.ipd_number || null,
            department: data.department || textFallbacks.department || null,
            visit_type: data.visit_type || "unknown"
          },
          confidence: data.confidence || "medium"
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: "visit_metadata_extractor",
        error: error.message
      };
    }
  }
}

module.exports = VisitMetadataExtractorSkill;
