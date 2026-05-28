/**
 * Hybrid STT Reconciler Skill
 *
 * Combines MedASR and Whisper transcripts using Gemma LLM
 * to produce the best possible medical transcript.
 *
 * Strategy:
 * - MedASR: Excellent at medical terminology, drug names, procedures
 * - Whisper: Better grammar, sentence structure, general accuracy
 * - Gemma: Intelligently merges both, applies clinical reasoning
 */

class HybridSTTReconcilerSkill {
  constructor(config = {}) {
    this.name = "Hybrid STT Reconciler";
    this.version = "1.0.0";
    this.type = "stt_reconciler";

    // Gemma configuration
    this.gemmaUrl = config.gemmaUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
    this.gemmaModel = config.gemmaModel || process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it";
    this.timeout = config.timeout || Number(process.env.HYBRID_RECONCILER_TIMEOUT) || 180000; // 180 seconds default (3 minutes) for reconciliation
    this.debug = config.debug || false;
  }

  log(message, data = {}) {
    if (this.debug) {
      console.log(`[HybridReconciler] ${message}`, data);
    }
  }

  /**
   * Call Gemma API for reconciliation
   */
  async callGemma(prompt) {
    const startTime = Date.now();

    const response = await fetch(this.gemmaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.gemmaModel,
        messages: [
          {
            role: "system",
            content: "You are a medical transcription reconciliation expert. Your task is to merge two speech-to-text transcripts into one accurate, clean medical transcript."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: "json_object" }
      }),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemma API failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    const elapsed = Date.now() - startTime;

    return {
      text: data.choices[0].message.content,
      elapsed,
      tokens: data.usage?.total_tokens || 0
    };
  }

  /**
   * Reconcile two transcripts using Gemma
   */
  async reconcile(medasrResult, whisperResult) {
    const medasrText = medasrResult.data?.rawText || '';
    const whisperText = whisperResult.data?.rawText || '';

    this.log("reconcile", {
      medasrLength: medasrText.length,
      whisperLength: whisperText.length
    });

    const prompt = `You are a medical transcription reconciliation expert. You have two transcripts of the same medical dictation:

TRANSCRIPT A (MedASR - Medical ASR specialized):
Strengths: Excellent at medical terminology, drug names, procedures
Weaknesses: May contain formatting artifacts, less natural flow

"${medasrText}"

TRANSCRIPT B (Whisper - General ASR):
Strengths: Better grammar, natural language flow, general accuracy
Weaknesses: May struggle with medical terms

"${whisperText}"

INSTRUCTIONS:
1. Create ONE best combined transcript
2. Prefer MedASR for: drug names, dosages, medical conditions, procedures, vital signs
3. Prefer Whisper for: grammar, sentence structure, general narrative flow
4. Fix any inconsistencies using clinical reasoning (e.g., if MedASR says "5 years old" but context suggests an adult, use Whisper's age)
5. Remove artifacts like {next}, {period}, [ASSESSMENT], etc.
6. Return valid JSON only:
{
  "mergedTranscript": "the complete merged transcript",
  "rationale": "brief explanation of key decisions made",
  "confidence": "high/medium/low",
  "corrections": ["list of major corrections made"]
}`;

    const startTime = Date.now();

    try {
      const result = await this.callGemma(prompt);
      const parsed = JSON.parse(result.text);

      const elapsed = Date.now() - startTime;

      this.log("reconcile:success", {
        elapsed,
        tokens: result.tokens,
        confidence: parsed.confidence
      });

      return {
        success: true,
        data: {
          rawText: parsed.mergedTranscript,
          normalizedText: parsed.mergedTranscript,
          language: medasrResult.data?.language || whisperResult.data?.language || "en",
          speakers: medasrResult.data?.speakers || [{ id: "spk_1", label: "Speaker 1", role: "unknown" }],
          segments: [
            {
              segmentId: "seg_1",
              speakerId: "spk_1",
              speakerRole: "unknown",
              speakerLabel: "Speaker 1",
              startLabel: "00:00",
              endLabel: medasrResult.data?.segments?.[0]?.endLabel || whisperResult.data?.segments?.[0]?.endLabel || "01:00",
              text: parsed.mergedTranscript,
              normalizedText: parsed.mergedTranscript,
              confidence: parsed.confidence === "high" ? 0.95 : parsed.confidence === "medium" ? 0.85 : 0.75,
              flags: ["hybrid_reconciled"],
            }
          ],
          quality: {
            overallConfidence: parsed.confidence === "high" ? 0.95 : parsed.confidence === "medium" ? 0.85 : 0.75,
            lowConfidenceSegmentCount: 0,
            missingAudioSuspected: false,
            overlappingSpeechSuspected: false,
            medicationRisk: "low",
          },
          metadata: {
            backend: "hybrid",
            model: "gemma-hybrid-reconciler",
            rationale: parsed.rationale,
            corrections: parsed.corrections || [],
            medasrBackend: "medasr",
            whisperBackend: "whisper",
            reconciliationLatency: elapsed,
            reconciliationTokens: result.tokens,
          },
        },
        backend: "hybrid",
        model: "gemma-hybrid-reconciler",
        latency: elapsed,
        tokens: result.tokens,
        rationale: parsed.rationale,
        corrections: parsed.corrections || [],
        confidence: parsed.confidence,
      };
    } catch (error) {
      this.log("reconcile:error", { message: error.message });
      const elapsed = Date.now() - startTime;

      // Fallback: return the better of the two based on text length and confidence
      const medasrConfidence = medasrResult.data?.quality?.overallConfidence || 0.5;
      const whisperConfidence = whisperResult.data?.quality?.overallConfidence || 0.5;

      const fallbackResult = medasrConfidence >= whisperConfidence ? medasrResult : whisperResult;

      return {
        success: true,
        data: {
          ...fallbackResult.data,
          metadata: {
            ...fallbackResult.data?.metadata,
            backend: "hybrid-fallback",
            fallbackReason: error.message,
            usedSource: medasrConfidence >= whisperConfidence ? "medasr" : "whisper",
          }
        },
        backend: "hybrid-fallback",
        latency: elapsed,
        error: error.message,
      };
    }
  }

  /**
   * Main execution method
   */
  async execute(context) {
    const { medasrResult, whisperResult, options = {} } = context;

    this.log("execute", {
      medasrSuccess: medasrResult?.success,
      whisperSuccess: whisperResult?.success
    });

    // Check if both transcripts are available
    if (!medasrResult?.success || !whisperResult?.success) {
      // Return the successful one, or error if both failed
      if (medasrResult?.success) {
        return {
          success: true,
          data: medasrResult.data,
          backend: "medasr-only",
          fallbackReason: "Whisper transcription failed"
        };
      }
      if (whisperResult?.success) {
        return {
          success: true,
          data: whisperResult.data,
          backend: "whisper-only",
          fallbackReason: "MedASR transcription failed"
        };
      }
      return {
        success: false,
        error: "Both MedASR and Whisper transcriptions failed",
        backend: "hybrid"
      };
    }

    // Reconcile both transcripts
    return await this.reconcile(medasrResult, whisperResult);
  }
}

module.exports = HybridSTTReconcilerSkill;
