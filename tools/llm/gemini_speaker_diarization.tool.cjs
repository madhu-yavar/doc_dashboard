const path = require("path");

const GeminiAudioTranscriptionTool = require("./gemini_audio_transcription.tool.cjs");

class GeminiSpeakerDiarizationTool {
  constructor(config = {}) {
    this.name = "Gemini Speaker Diarization Tool";
    this.version = "1.0.0";
    this.transcriptionTool = config.transcriptionTool || new GeminiAudioTranscriptionTool(config);
    this.model = config.model || this.transcriptionTool.model;
    this.debug = config.debug || false;
  }

  log(message, data = {}) {
    if (this.debug) {
      console.log(`[GeminiSpeakerDiarization] ${message}`, data);
    }
  }

  normalizeRole(role) {
    return role === "doctor" || role === "patient" ? role : "unknown";
  }

  normalizeLabel(label, fallback = "Speaker") {
    return String(label || fallback).replace(/\s+/g, " ").trim() || fallback;
  }

  normalizeFlags(flags = []) {
    const normalized = Array.isArray(flags)
      ? flags
          .map((flag) => String(flag || "").trim().toLowerCase().replace(/\s+/g, "_"))
          .filter(Boolean)
      : [];
    return Array.from(new Set(normalized));
  }

  parseTimeLabel(label) {
    const text = String(label || "").trim();
    if (!text) {
      return null;
    }

    const parts = text.split(":").map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part))) {
      return null;
    }

    if (parts.length === 2) {
      return (parts[0] * 60) + parts[1];
    }

    if (parts.length === 3) {
      return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    }

    return null;
  }

  formatTimeLabel(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return "00:00";
    }

    const totalSeconds = Math.round(seconds);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  buildPrompt(options = {}) {
    const transcriptHint = String(options.transcriptHint || "").trim();
    const hintBlock = transcriptHint
      ? `Transcript hint for wording only:\n${transcriptHint.slice(0, 8000)}`
      : "No transcript hint is provided.";

    return [
      "Analyze this clinical conversation audio and return structured speaker diarization JSON.",
      "This is for a doctor-patient workflow. Separate speaker turns and infer speaker roles conservatively.",
      "Return valid JSON only with this exact top-level shape:",
      "{",
      '  "language": string | null,',
      '  "rawText": string,',
      '  "normalizedText": string,',
      '  "speakers": [{',
      '    "id": string,',
      '    "label": string,',
      '    "role": "doctor" | "patient" | "unknown",',
      '    "confidence": number | null',
      "  }],",
      '  "segments": [{',
      '    "segmentId": string,',
      '    "speakerId": string | null,',
      '    "speakerRole": "doctor" | "patient" | "unknown",',
      '    "speakerLabel": string,',
      '    "startLabel": string,',
      '    "endLabel": string,',
      '    "startSeconds": number | null,',
      '    "endSeconds": number | null,',
      '    "text": string,',
      '    "normalizedText": string,',
      '    "confidence": number | null,',
      '    "flags": string[]',
      "  }],",
      '  "quality": {',
      '    "overallConfidence": number | null,',
      '    "lowConfidenceSegmentCount": number,',
      '    "speakerCount": number,',
      '    "speakerAmbiguityCount": number,',
      '    "overlappingSpeechSuspected": boolean',
      "  }",
      "}",
      "Requirements:",
      "- Preserve the spoken text faithfully; do not summarize.",
      "- Infer role as doctor or patient only when evidence is strong. Otherwise use unknown.",
      "- Use concise turn-based segments instead of one giant paragraph.",
      "- Include timestamps as best estimates; use startSeconds/endSeconds when possible.",
      "- Set flags such as low_confidence, overlap, interruption, medication, dosage, follow_up when relevant.",
      "- If only one speaker is truly present, return one speaker.",
      "- Use the transcript hint only to preserve wording, not to invent new speaker turns.",
      hintBlock,
    ].join("\n");
  }

  normalizeSpeaker(speaker = {}, index = 0) {
    const id = String(speaker.id || `spk_${index + 1}`).trim() || `spk_${index + 1}`;
    const role = this.normalizeRole(speaker.role);
    const defaultLabel = role === "doctor" ? "Doctor" : role === "patient" ? "Patient" : `Speaker ${index + 1}`;
    const confidence = Number(speaker.confidence);

    return {
      id,
      label: this.normalizeLabel(speaker.label, defaultLabel),
      role,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    };
  }

  normalizeSegment(segment = {}, index = 0, speakerMap = new Map()) {
    const speakerId = segment.speakerId ? String(segment.speakerId).trim() : null;
    const linkedSpeaker = speakerId ? speakerMap.get(speakerId) : null;
    const rawRole = segment.speakerRole || linkedSpeaker?.role;
    const role = this.normalizeRole(rawRole);
    const defaultLabel = role === "doctor" ? "Doctor" : role === "patient" ? "Patient" : `Speaker ${index + 1}`;
    const confidence = Number(segment.confidence);
    const startSeconds = Number(segment.startSeconds);
    const endSeconds = Number(segment.endSeconds);
    const resolvedStartSeconds = Number.isFinite(startSeconds) ? Math.max(0, startSeconds) : this.parseTimeLabel(segment.startLabel);
    const resolvedEndSeconds = Number.isFinite(endSeconds) ? Math.max(0, endSeconds) : this.parseTimeLabel(segment.endLabel);
    const text = String(segment.text || segment.normalizedText || "").replace(/\s+/g, " ").trim();

    return {
      segmentId: String(segment.segmentId || `seg_${index + 1}`).trim() || `seg_${index + 1}`,
      speakerId: speakerId || linkedSpeaker?.id || null,
      speakerRole: role,
      speakerLabel: this.normalizeLabel(segment.speakerLabel || linkedSpeaker?.label, defaultLabel),
      startLabel: String(segment.startLabel || this.formatTimeLabel(resolvedStartSeconds || 0)).trim() || "00:00",
      endLabel: String(segment.endLabel || this.formatTimeLabel(resolvedEndSeconds || (resolvedStartSeconds || 0) + 6)).trim() || "00:06",
      startSeconds: Number.isFinite(resolvedStartSeconds) ? resolvedStartSeconds : null,
      endSeconds: Number.isFinite(resolvedEndSeconds) ? resolvedEndSeconds : null,
      text: text || "[No transcript text returned]",
      normalizedText: text || "[No transcript text returned]",
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
      flags: this.normalizeFlags(segment.flags),
    };
  }

  buildFallbackDiarization(payload = {}, fileLabel = "") {
    const rawText = String(payload.rawText || payload.normalizedText || `Transcript unavailable for ${fileLabel}`).trim();
    return {
      language: payload.language || "en",
      rawText,
      normalizedText: rawText,
      speakers: [
        {
          id: "spk_1",
          label: "Speaker 1",
          role: "unknown",
          confidence: null,
        },
      ],
      segments: [
        {
          segmentId: "seg_1",
          speakerId: "spk_1",
          speakerRole: "unknown",
          speakerLabel: "Speaker 1",
          startLabel: "00:00",
          endLabel: "00:30",
          startSeconds: 0,
          endSeconds: 30,
          text: rawText,
          normalizedText: rawText,
          confidence: null,
          flags: ["fallback_diarization"],
        },
      ],
      quality: {
        overallConfidence: null,
        lowConfidenceSegmentCount: 1,
        speakerCount: 1,
        speakerAmbiguityCount: 1,
        overlappingSpeechSuspected: false,
      },
      metadata: {
        backend: "gemini_diarization",
        model: this.model,
        recovery: "fallback",
      },
    };
  }

  normalizePayload(payload = {}, fileLabel = "") {
    const source = payload && typeof payload === "object" ? payload : {};
    const fallback = this.buildFallbackDiarization(source, fileLabel);
    const candidateSpeakers = Array.isArray(source.speakers) ? source.speakers : fallback.speakers;
    const speakers = candidateSpeakers.map((speaker, index) => this.normalizeSpeaker(speaker, index));
    const speakerMap = new Map(speakers.map((speaker) => [speaker.id, speaker]));

    const sourceSegments = Array.isArray(source.segments) ? source.segments : fallback.segments;
    const segments = sourceSegments.length
      ? sourceSegments.map((segment, index) => this.normalizeSegment(segment, index, speakerMap))
      : fallback.segments;

    const confidences = segments
      .map((segment) => (typeof segment.confidence === "number" ? segment.confidence : null))
      .filter((value) => typeof value === "number");
    const lowConfidenceSegmentCount = segments.filter((segment) =>
      segment.flags.includes("low_confidence") ||
      segment.flags.includes("speaker_ambiguity") ||
      (typeof segment.confidence === "number" && segment.confidence < 0.75)
    ).length;
    const speakerAmbiguityCount = segments.filter((segment) => segment.speakerRole === "unknown").length;
    const providedQuality = source.quality || {};

    return {
      language: source.language || fallback.language,
      rawText: String(source.rawText || source.normalizedText || segments.map((segment) => segment.text).join(" ")).trim(),
      normalizedText: String(source.normalizedText || source.rawText || segments.map((segment) => segment.normalizedText).join(" ")).trim(),
      speakers,
      segments,
      quality: {
        overallConfidence: typeof providedQuality.overallConfidence === "number"
          ? providedQuality.overallConfidence
          : (confidences.length
              ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2))
              : null),
        lowConfidenceSegmentCount: Number.isFinite(providedQuality.lowConfidenceSegmentCount)
          ? providedQuality.lowConfidenceSegmentCount
          : lowConfidenceSegmentCount,
        speakerCount: Number.isFinite(providedQuality.speakerCount)
          ? providedQuality.speakerCount
          : speakers.length,
        speakerAmbiguityCount: Number.isFinite(providedQuality.speakerAmbiguityCount)
          ? providedQuality.speakerAmbiguityCount
          : speakerAmbiguityCount,
        overlappingSpeechSuspected: Boolean(providedQuality.overlappingSpeechSuspected),
      },
      metadata: {
        ...(source.metadata && typeof source.metadata === "object" ? source.metadata : {}),
        backend: "gemini_diarization",
        model: this.model,
      },
    };
  }

  async execute(filePath, options = {}) {
    const prompt = options.prompt || this.buildPrompt({ transcriptHint: options.transcriptHint });
    const result = await this.transcriptionTool.execute(filePath, {
      mimeType: options.mimeType || "audio/mpeg",
      maxRetries: options.maxRetries ?? 1,
      temperature: options.temperature ?? 0.1,
      maxTokens: options.maxTokens ?? 4096,
      prompt,
    });

    if (!result.success) {
      return result;
    }

    const normalized = this.normalizePayload(result.data, path.basename(filePath));
    const completionTokens = Number(
      result.usage?.completionTokens ??
      result.usage?.candidatesTokenCount ??
      0
    ) || 0;
    const looksLikeFallback = /^Transcript unavailable for /i.test(String(normalized.rawText || "").trim());
    const hasMeaningfulSegments = Array.isArray(normalized.segments) && normalized.segments.some((segment) => {
      const text = String(segment?.text || "").trim();
      const flags = Array.isArray(segment?.flags) ? segment.flags : [];
      return text && !/^Transcript unavailable for /i.test(text) && !flags.includes("fallback_diarization");
    });

    if (looksLikeFallback || !hasMeaningfulSegments || completionTokens === 0) {
      return {
        success: false,
        error: "Gemini returned no usable speaker diarization content.",
        usage: result.usage || null,
        model: result.model || this.model,
        uploadedFile: result.uploadedFile || null,
        rawResponse: result.rawResponse || null,
      };
    }

    return {
      success: true,
      data: normalized,
      usage: result.usage || null,
      model: result.model || this.model,
      uploadedFile: result.uploadedFile || null,
      rawResponse: result.rawResponse || null,
    };
  }
}

module.exports = GeminiSpeakerDiarizationTool;
