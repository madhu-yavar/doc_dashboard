/**
 * STT Result Reconciler Skill
 * Analyzes, validates, and selects the best transcript from multiple STT results
 *
 * Features:
 * - Quality scoring for transcripts
 * - Comparison between multiple results
 * - Confidence-based selection
 * - Medical content validation
 */

class STTResultReconcilerSkill {
  constructor(config = {}) {
    this.name = "STT Result Reconciler";
    this.version = "1.0.0";
    this.type = "stt_reconciler";
    this.debug = config.debug || false;
  }

  log(message, data = {}) {
    if (this.debug) {
      console.log(`[STTReconciler] ${message}`, data);
    }
  }

  /**
   * Calculate quality score for a transcript
   */
  calculateQualityScore(transcript) {
    let score = 0;
    const maxScore = 100;

    if (!transcript) {
      return { score: 0, details: { reason: "No transcript provided" } };
    }

    const details = {};
    const rawText = transcript.rawText || transcript.normalizedText || "";

    // 1. Text length (0-25 points)
    // Too short = bad, reasonable length = good
    const textLength = rawText.length;
    if (textLength === 0) {
      details.textLength = { score: 0, reason: "Empty transcript" };
    } else if (textLength < 20) {
      details.textLength = { score: 5, reason: "Very short transcript" };
      score += 5;
    } else if (textLength < 50) {
      details.textLength = { score: 10, reason: "Short transcript" };
      score += 10;
    } else if (textLength < 200) {
      details.textLength = { score: 20, reason: "Good length" };
      score += 20;
    } else if (textLength < 1000) {
      details.textLength = { score: 25, reason: "Excellent length" };
      score += 25;
    } else {
      details.textLength = { score: 22, reason: "Very long (might include hallucinations)" };
      score += 22;
    }

    // 2. Segment count (0-15 points)
    const segmentCount = transcript.segments?.length || 0;
    if (segmentCount === 0) {
      details.segmentCount = { score: 0, reason: "No segments" };
    } else if (segmentCount === 1) {
      details.segmentCount = { score: 10, reason: "Single segment" };
      score += 10;
    } else if (segmentCount <= 5) {
      details.segmentCount = { score: 15, reason: "Good segmentation" };
      score += 15;
    } else {
      details.segmentCount = { score: 12, reason: "Many segments" };
      score += 12;
    }

    // 3. Medical content indicators (0-20 points)
    const medicalIndicators = [
      "blood pressure", "bp", "pulse", "heart rate", "temperature",
      "medication", "prescription", "dose", "mg", "tablet", "capsule",
      "patient", "diagnosis", "symptom", "treatment", "follow up",
      "lab", "radiology", "x-ray", "ct", "mri", "ultrasound",
      "discharge", "admission", "referral"
    ];
    const lowerText = rawText.toLowerCase();
    const medicalMatches = medicalIndicators.filter(ind => lowerText.includes(ind)).length;
    const medicalScore = Math.min(20, medicalMatches * 2);
    details.medicalContent = { score: medicalScore, matches: medicalMatches };
    score += medicalScore;

    // 4. Language detection (0-10 points)
    if (transcript.language) {
      details.language = { score: 10, detected: transcript.language };
      score += 10;
    } else {
      details.language = { score: 0, reason: "No language detected" };
    }

    // 5. Confidence indicators (0-20 points)
    const quality = transcript.quality || {};
    const lowConfidenceCount = quality.lowConfidenceSegmentCount || 0;
    const confidenceScore = Math.max(0, 20 - (lowConfidenceCount * 5));
    details.confidence = { score: confidenceScore, lowConfidenceCount };
    score += confidenceScore;

    // 6. Structure indicators (0-10 points)
    // Check for structured patterns like numbers, dates, measurements
    const hasNumbers = /\d+/.test(rawText);
    const hasMeasurements = /\d+\s*(mg|ml|mcg|%|mmhg|bpm|°c|°f)/i.test(rawText);
    let structureScore = 5;
    if (hasNumbers) structureScore += 3;
    if (hasMeasurements) structureScore += 2;
    details.structure = { score: structureScore, hasNumbers, hasMeasurements };
    score += structureScore;

    // 7. Backend preference (0-0 points, for tracking only)
    // We don't add points for backend preference here
    details.backend = transcript.metadata?.backend || "unknown";

    return {
      score: Math.min(maxScore, score),
      maxScore,
      details,
    };
  }

  /**
   * Compare two transcripts and return the better one
   */
  compareTranscripts(transcript1, transcript2) {
    const score1 = this.calculateQualityScore(transcript1);
    const score2 = this.calculateQualityScore(transcript2);

    this.log("compare", {
      backend1: transcript1?.metadata?.backend,
      score1: score1.score,
      backend2: transcript2?.metadata?.backend,
      score2: score2.score,
    });

    if (score1.score > score2.score) {
      return {
        winner: transcript1,
        loser: transcript2,
        reason: `Higher quality score (${score1.score} vs ${score2.score})`,
        scores: { transcript1: score1, transcript2: score2 },
      };
    } else if (score2.score > score1.score) {
      return {
        winner: transcript2,
        loser: transcript1,
        reason: `Higher quality score (${score2.score} vs ${score1.score})`,
        scores: { transcript1: score1, transcript2: score2 },
      };
    } else {
      // Tie - prefer medASR > Whisper > Gemini for medical content
      const backend1 = transcript1?.metadata?.backend || "unknown";
      const backend2 = transcript2?.metadata?.backend || "unknown";

      // Backend priority for medical content
      const backendPriority = { medasr: 3, whisper: 2, gemini: 1 };
      const priority1 = backendPriority[backend1] || 0;
      const priority2 = backendPriority[backend2] || 0;

      if (priority1 > priority2) {
        return {
          winner: transcript1,
          loser: transcript2,
          reason: `Tie score (${score1.score}), preferring ${backend1.toUpperCase()} for medical content`,
          scores: { transcript1: score1, transcript2: score2 },
        };
      } else if (priority2 > priority1) {
        return {
          winner: transcript2,
          loser: transcript1,
          reason: `Tie score (${score1.score}), preferring ${backend2.toUpperCase()} for medical content`,
          scores: { transcript1: score1, transcript2: score2 },
        };
      } else {
        // Same priority, prefer first
        return {
          winner: transcript1,
          loser: transcript2,
          reason: `Tie score (${score1.score}), same backend priority`,
          scores: { transcript1: score1, transcript2: score2 },
        };
      }
    }
  }

  /**
   * Validate transcript for minimum quality
   */
  validateTranscript(transcript) {
    const issues = [];

    if (!transcript) {
      issues.push({ severity: "critical", code: "no_transcript", message: "No transcript provided" });
      return { valid: false, issues };
    }

    const rawText = transcript.rawText || transcript.normalizedText || "";

    if (!rawText || rawText.length < 5) {
      issues.push({ severity: "critical", code: "empty_transcript", message: "Transcript is empty or too short" });
    }

    if (rawText.length > 0 && rawText.length < 10) {
      issues.push({ severity: "warning", code: "very_short_transcript", message: "Transcript is very short" });
    }

    // Check for error indicators
    const errorPatterns = [
      /transcript unavailable/i,
      /could not transcribe/i,
      /error/i,
      /failed/i,
    ];

    for (const pattern of errorPatterns) {
      if (pattern.test(rawText)) {
        issues.push({
          severity: "critical",
          code: "error_in_transcript",
          message: `Transcript contains error indicator: ${pattern.source}`
        });
        break;
      }
    }

    // Check quality flags
    const flags = transcript.segments?.flatMap(s => s.flags || []) || [];
    if (flags.includes("fallback_transcript")) {
      issues.push({
        severity: "warning",
        code: "fallback_transcript",
        message: "Transcript was generated using fallback method"
      });
    }

    if (flags.includes("partial_json_recovery")) {
      issues.push({
        severity: "info",
        code: "partial_json_recovery",
        message: "Transcript required JSON recovery"
      });
    }

    return {
      valid: !issues.some(i => i.severity === "critical"),
      issues,
    };
  }

  /**
   * Select the best transcript from results
   */
  selectBest(results) {
    this.log("selectBest", { resultCount: results.length });

    // Filter out failed results
    const validResults = results.filter(r => r.success && r.data);
    this.log("validResults", { count: validResults.length });

    if (validResults.length === 0) {
      return {
        success: false,
        error: "No valid transcripts to reconcile",
        selected: null,
      };
    }

    if (validResults.length === 1) {
      const transcript = validResults[0].data;
      const validation = this.validateTranscript(transcript);

      return {
        success: validation.valid,
        selected: transcript,
        source: validResults[0].backend,
        validation,
        reason: "Only valid result",
      };
    }

    // Compare all valid transcripts
    let best = validResults[0];
    let bestScore = this.calculateQualityScore(best.data);

    for (let i = 1; i < validResults.length; i++) {
      const current = validResults[i];
      const currentScore = this.calculateQualityScore(current.data);

      if (currentScore.score > bestScore.score) {
        best = current;
        bestScore = currentScore;
      }
    }

    const validation = this.validateTranscript(best.data);

    return {
      success: validation.valid,
      selected: best.data,
      source: best.backend,
      validation,
      reason: `Best quality score (${bestScore.score}/${bestScore.maxScore})`,
      scores: validResults.map(r => ({
        backend: r.backend,
        score: this.calculateQualityScore(r.data).score,
      })),
    };
  }

  /**
   * Main execution method
   */
  async execute(context) {
    const { medasrResult, whisperResult, geminiResult, primaryBackend } = context;

    this.log("execute", { primaryBackend, hasMedASR: !!medasrResult, hasWhisper: !!whisperResult, hasGemini: !!geminiResult });

    const results = [];

    if (medasrResult?.success) {
      results.push({ ...medasrResult, backend: "medasr" });
    }

    if (whisperResult?.success) {
      results.push({ ...whisperResult, backend: "whisper" });
    }

    if (geminiResult?.success) {
      results.push({ ...geminiResult, backend: "gemini" });
    }

    // If primary backend failed, just return the first successful fallback
    if (primaryBackend === "medasr" && !medasrResult?.success) {
      if (whisperResult?.success) {
        this.log("primary_failed", { primary: "medasr", using: "whisper" });
        return {
          success: true,
          selected: whisperResult.data,
          source: "whisper",
          reason: "Primary backend (medASR) failed, using Whisper",
          fallback: true,
        };
      }
      if (geminiResult?.success) {
        this.log("primary_failed", { primary: "medasr", using: "gemini" });
        return {
          success: true,
          selected: geminiResult.data,
          source: "gemini",
          reason: "Primary backend (medASR) failed, using Gemini",
          fallback: true,
        };
      }
    }

    if (primaryBackend === "whisper" && !whisperResult?.success) {
      if (medasrResult?.success) {
        this.log("primary_failed", { primary: "whisper", using: "medasr" });
        return {
          success: true,
          selected: medasrResult.data,
          source: "medasr",
          reason: "Primary backend (Whisper) failed, using medASR",
          fallback: true,
        };
      }
      if (geminiResult?.success) {
        this.log("primary_failed", { primary: "whisper", using: "gemini" });
        return {
          success: true,
          selected: geminiResult.data,
          source: "gemini",
          reason: "Primary backend (Whisper) failed, using Gemini",
          fallback: true,
        };
      }
    }

    if (primaryBackend === "gemini" && !geminiResult?.success) {
      if (medasrResult?.success) {
        this.log("primary_failed", { primary: "gemini", using: "medasr" });
        return {
          success: true,
          selected: medasrResult.data,
          source: "medasr",
          reason: "Primary backend (Gemini) failed, using medASR",
          fallback: true,
        };
      }
      if (whisperResult?.success) {
        console.log("primary_failed", { primary: "gemini", using: "whisper" });
        return {
          success: true,
          selected: whisperResult.data,
          source: "whisper",
          reason: "Primary backend (Gemini) failed, using Whisper",
          fallback: true,
        };
      }
    }

    // Select best from available results
    const best = this.selectBest(results);

    this.log("result", {
      success: best.success,
      source: best.source,
      reason: best.reason,
    });

    return best;
  }
}

module.exports = STTResultReconcilerSkill;
