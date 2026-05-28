const GemmaClientTool = require("./gemma_client.tool.cjs");

class GemmaTranscriptValidationTool {
  constructor(config = {}) {
    this.name = "Gemma Transcript Validation Tool";
    this.version = "1.0.0";
    this.gemmaClient = config.gemmaClient || new GemmaClientTool(config);
    this.debug = config.debug || false;
  }

  log(message, data = {}) {
    if (this.debug) {
      console.log(`[GemmaTranscriptValidation] ${message}`, data);
    }
  }

  normalizeRisk(value, fallback = "medium") {
    const normalized = String(value || fallback).trim().toLowerCase();
    return normalized === "low" || normalized === "medium" || normalized === "high" ? normalized : fallback;
  }

  normalizeSeverity(value, fallback = "medium") {
    return this.normalizeRisk(value, fallback);
  }

  normalizeRecommendation(value, fallback = "review") {
    const normalized = String(value || fallback).trim().toLowerCase();
    return normalized === "accept" || normalized === "review" || normalized === "fallback" ? normalized : fallback;
  }

  normalizeConfidence(value, fallback = "medium") {
    return this.normalizeRisk(value, fallback);
  }

  buildPrompt(input = {}) {
    const medasrText = String(input.medasrText || "").slice(0, 12000);
    const whisperText = String(input.whisperText || "").slice(0, 12000);
    const mergedText = String(input.mergedText || "").slice(0, 16000);
    const diarizationSummary = JSON.stringify(input.diarizationSummary || {}, null, 2).slice(0, 4000);
    const chunkSummary = JSON.stringify(input.chunkSummary || {}, null, 2).slice(0, 3000);

    return [
      "You are validating a doctor-patient medical conversation transcript.",
      "Do not rewrite the transcript. Assess transcript quality and list concrete review risks only.",
      "Return valid JSON only with this exact top-level shape:",
      "{",
      '  "confidence": "high" | "medium" | "low",',
      '  "recommendation": "accept" | "review" | "fallback",',
      '  "summary": string,',
      '  "preferredSource": "merged" | "medasr" | "whisper" | "gemini_fallback",',
      '  "riskFlags": {',
      '    "medicationRisk": "low" | "medium" | "high",',
      '    "orderRisk": "low" | "medium" | "high",',
      '    "speakerAttributionRisk": "low" | "medium" | "high"',
      "  },",
      '  "reviewItems": [{',
      '    "title": string,',
      '    "severity": "low" | "medium" | "high",',
      '    "source": string,',
      '    "reason": string,',
      '    "snippet": string,',
      '    "resolutionHint": string',
      "  }]",
      "}",
      "Rules:",
      "- Focus on medication terms, dosage/frequency, orders/tests, and speaker-sensitive instructions.",
      "- If MedASR and Whisper disagree clinically, surface it as a review item.",
      "- If diarization is weak or ambiguous, surface a speaker attribution review item.",
      "- Keep review items concise and actionable.",
      "",
      "MERGED TRANSCRIPT:",
      mergedText || "[none]",
      "",
      "MEDASR TRANSCRIPT:",
      medasrText || "[none]",
      "",
      "WHISPER TRANSCRIPT:",
      whisperText || "[none]",
      "",
      "DIARIZATION SUMMARY:",
      diarizationSummary || "{}",
      "",
      "CHUNK SUMMARY:",
      chunkSummary || "{}",
    ].join("\n");
  }

  parseJson(text) {
    const source = String(text || "").trim();
    if (!source) {
      return null;
    }

    try {
      return JSON.parse(source);
    } catch {
      const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenced?.[1]) {
        try {
          return JSON.parse(fenced[1].trim());
        } catch {
          return null;
        }
      }
      const firstBrace = source.indexOf("{");
      const lastBrace = source.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          return JSON.parse(source.slice(firstBrace, lastBrace + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  normalizeReviewItems(items = []) {
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map((item, index) => ({
        id: `review_${index + 1}`,
        title: String(item?.title || item?.name || `Review item ${index + 1}`).trim(),
        severity: this.normalizeSeverity(item?.severity, "medium"),
        source: String(item?.source || "validation").trim() || "validation",
        reason: String(item?.reason || "").trim(),
        snippet: String(item?.snippet || "").trim(),
        resolutionHint: String(item?.resolutionHint || item?.resolution || "").trim(),
      }))
      .filter((item) => item.title);
  }

  normalizePayload(payload = {}) {
    const reviewItems = this.normalizeReviewItems(payload.reviewItems);
    return {
      confidence: this.normalizeConfidence(payload.confidence, reviewItems.some((item) => item.severity === "high") ? "low" : "medium"),
      recommendation: this.normalizeRecommendation(payload.recommendation, reviewItems.length > 0 ? "review" : "accept"),
      summary: String(payload.summary || "").trim(),
      preferredSource: String(payload.preferredSource || "merged").trim() || "merged",
      riskFlags: {
        medicationRisk: this.normalizeRisk(payload.riskFlags?.medicationRisk, "medium"),
        orderRisk: this.normalizeRisk(payload.riskFlags?.orderRisk, "medium"),
        speakerAttributionRisk: this.normalizeRisk(payload.riskFlags?.speakerAttributionRisk, "medium"),
      },
      reviewItems,
    };
  }

  async execute(input = {}) {
    const prompt = this.buildPrompt(input);
    this.log("execute", {
      mergedLength: String(input.mergedText || "").length,
      medasrLength: String(input.medasrText || "").length,
      whisperLength: String(input.whisperText || "").length,
    });

    const result = await this.gemmaClient.execute(prompt, {
      temperature: 0.1,
      maxTokens: 1600,
      jsonMode: false,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Gemma validation failed",
        backend: "gemma_validation",
      };
    }

    const parsed = this.parseJson(result.content);
    if (!parsed) {
      return {
        success: false,
        error: "Gemma validation returned invalid JSON",
        backend: "gemma_validation",
        rawContent: result.content,
      };
    }

    return {
      success: true,
      data: this.normalizePayload(parsed),
      backend: "gemma_validation",
      model: result.model || null,
      usage: result.usage || null,
    };
  }
}

module.exports = GemmaTranscriptValidationTool;
