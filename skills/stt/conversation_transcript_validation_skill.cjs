const GemmaTranscriptValidationTool = require("../../tools/llm/gemma_transcript_validation.tool.cjs");

class ConversationTranscriptValidationSkill {
  constructor(config = {}) {
    this.name = "Conversation Transcript Validation Skill";
    this.version = "1.0.0";
    this.type = "conversation_transcript_validation_skill";
    this.debug = config.debug || false;
    this.tool = config.tool || new GemmaTranscriptValidationTool(config);
  }

  log(message, data = {}) {
    if (this.debug) {
      console.log(`[ConversationTranscriptValidationSkill] ${message}`, data);
    }
  }

  normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  tokenize(text) {
    return this.normalizeText(text)
      .split(/[^a-z0-9.+/-]+/i)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  computeJaccardSimilarity(leftText, rightText) {
    const leftTokens = new Set(this.tokenize(leftText));
    const rightTokens = new Set(this.tokenize(rightText));

    if (leftTokens.size === 0 && rightTokens.size === 0) {
      return 1;
    }

    const union = new Set([...leftTokens, ...rightTokens]);
    let intersectionCount = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        intersectionCount += 1;
      }
    }

    return union.size === 0 ? 1 : intersectionCount / union.size;
  }

  extractDoseTokens(text) {
    return Array.from(
      new Set(
        String(text || "")
          .match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?|iu|drops?)\b/gi) || [],
      ),
    ).map((item) => item.toLowerCase());
  }

  buildHeuristicValidation(context = {}, fallbackReason = null) {
    const medasrText = context.medasrResult?.data?.normalizedText || context.medasrResult?.data?.rawText || "";
    const whisperText = context.whisperResult?.data?.normalizedText || context.whisperResult?.data?.rawText || "";
    const mergedText = context.mergedResult?.data?.normalizedText || context.mergedResult?.data?.rawText || "";
    const diarizationQuality = context.diarization?.quality || {};
    const reviewItems = [];
    const similarity = this.computeJaccardSimilarity(medasrText || mergedText, whisperText || mergedText);
    const medasrDoses = this.extractDoseTokens(medasrText);
    const whisperDoses = this.extractDoseTokens(whisperText);

    if (medasrText && whisperText && similarity < 0.6) {
      reviewItems.push({
        id: `review_${reviewItems.length + 1}`,
        title: "Medical and general transcripts diverge",
        severity: similarity < 0.45 ? "high" : "medium",
        source: "medasr_vs_whisper",
        reason: `Transcript similarity is low (${similarity.toFixed(2)}), so clinical wording may need review.`,
        snippet: mergedText.slice(0, 180),
        resolutionHint: "Check medications, diagnoses, and instructions against the source audio.",
      });
    }

    const doseMismatch = medasrDoses.filter((dose) => !whisperDoses.includes(dose));
    if (doseMismatch.length > 0) {
      reviewItems.push({
        id: `review_${reviewItems.length + 1}`,
        title: "Dose or medication wording mismatch",
        severity: "high",
        source: "medication_validation",
        reason: `Dose terms appear in MedASR but not Whisper: ${doseMismatch.slice(0, 5).join(", ")}`,
        snippet: doseMismatch.slice(0, 3).join(", "),
        resolutionHint: "Verify dose, frequency, and route before publishing the note.",
      });
    }

    if ((Number(diarizationQuality.speakerAmbiguityCount) || 0) > 0) {
      reviewItems.push({
        id: `review_${reviewItems.length + 1}`,
        title: "Speaker attribution is ambiguous",
        severity: (Number(diarizationQuality.speakerAmbiguityCount) || 0) > 2 ? "high" : "medium",
        source: "diarization",
        reason: `${diarizationQuality.speakerAmbiguityCount} diarization segments are still marked as unknown.`,
        snippet: "",
        resolutionHint: "Review clinician instructions and plan items before finalizing.",
      });
    }

    if (fallbackReason) {
      reviewItems.push({
        id: `review_${reviewItems.length + 1}`,
        title: "Validation fallback used",
        severity: "low",
        source: "validation_fallback",
        reason: fallbackReason,
        snippet: "",
        resolutionHint: "Treat this output as heuristic-only until Gemma validation succeeds.",
      });
    }

    const hasHigh = reviewItems.some((item) => item.severity === "high");
    const hasMedium = reviewItems.some((item) => item.severity === "medium");

    return {
      confidence: hasHigh ? "low" : hasMedium ? "medium" : "high",
      recommendation: hasHigh || hasMedium ? "review" : "accept",
      summary: reviewItems.length
        ? "Validation surfaced transcript or speaker risks that should be reviewed."
        : "No major transcript conflicts were detected by heuristic validation.",
      preferredSource: context.mergedResult?.success ? "merged" : context.medasrResult?.success ? "medasr" : "whisper",
      riskFlags: {
        medicationRisk: doseMismatch.length > 0 ? "high" : reviewItems.some((item) => item.source === "medasr_vs_whisper") ? "medium" : "low",
        orderRisk: hasHigh ? "high" : hasMedium ? "medium" : "low",
        speakerAttributionRisk: (Number(diarizationQuality.speakerAmbiguityCount) || 0) > 0 ? "medium" : "low",
      },
      reviewItems,
      metadata: {
        backend: fallbackReason ? "heuristic_validation_fallback" : "heuristic_validation",
        similarityScore: Number(similarity.toFixed(2)),
      },
    };
  }

  async execute(context = {}) {
    const medasrText = context.medasrResult?.data?.normalizedText || context.medasrResult?.data?.rawText || "";
    const whisperText = context.whisperResult?.data?.normalizedText || context.whisperResult?.data?.rawText || "";
    const mergedText = context.mergedResult?.data?.normalizedText || context.mergedResult?.data?.rawText || "";
    const diarizationSummary = {
      speakers: Array.isArray(context.diarization?.speakers) ? context.diarization.speakers.length : 0,
      quality: context.diarization?.quality || null,
      backend: context.diarization?.metadata?.backend || context.diarization?.backend || null,
    };
    const chunkSummary = context.chunkSummary || null;

    this.log("execute", {
      medasrLength: medasrText.length,
      whisperLength: whisperText.length,
      mergedLength: mergedText.length,
    });

    const toolResult = await this.tool.execute({
      medasrText,
      whisperText,
      mergedText,
      diarizationSummary,
      chunkSummary,
    });

    if (!toolResult.success) {
      const fallback = this.buildHeuristicValidation(context, toolResult.error || "Gemma validation failed");
      return {
        success: true,
        data: fallback,
        backend: fallback.metadata.backend,
        error: toolResult.error || null,
      };
    }

    return {
      success: true,
      data: {
        ...toolResult.data,
        metadata: {
          backend: "gemma_validation",
          model: toolResult.model || null,
          usage: toolResult.usage || null,
        },
      },
      backend: "gemma_validation",
      model: toolResult.model || null,
      usage: toolResult.usage || null,
    };
  }
}

module.exports = ConversationTranscriptValidationSkill;
