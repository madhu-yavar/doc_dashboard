const fs = require("fs");
const FormData = require("form-data");
const path = require("path");

class PyannoteSpeakerDiarizationTool {
  constructor(config = {}) {
    this.name = "Pyannote Speaker Diarization Tool (GPU)";
    this.version = "3.0.0-GPU";
    this.apiUrl = config.apiUrl || process.env.PYANNOTE_GPU_API_URL || "http://206.1.62.28:8009/diarize";
    this.apiKey = config.apiKey || process.env.PYANNOTE_GPU_API_KEY || "test123";
    this.timeout = Number(config.timeout || process.env.PYANNOTE_TIMEOUT || 120000); // 2 minutes for GPU
    this.maxRetries = Number.isFinite(config.maxRetries) ? config.maxRetries : Number(process.env.PYANNOTE_MAX_RETRIES || 2);
    this.debug = config.debug || false;
    this.device = "gpu"; // Always GPU now
  }

  log(message, data = {}) {
    if (this.debug) {
      console.log(`[PyannoteSpeakerDiarization-GPU] ${message}`, data);
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  isRetryableError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return (
      message.includes("timed out") ||
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("enotfound") ||
      message.includes("temporary failure") ||
      message.includes("connection")
    );
  }

  normalizeRole(role) {
    const value = String(role || "").trim().toLowerCase();
    if (value === "doctor" || value === "clinician" || value === "provider") {
      return "doctor";
    }
    if (value === "patient" || value === "member") {
      return "patient";
    }
    return "unknown";
  }

  normalizeLabel(label, fallback = "Speaker") {
    return String(label || fallback).replace(/\s+/g, " ").trim() || fallback;
  }

  normalizeFlags(flags = []) {
    const values = Array.isArray(flags)
      ? flags.map((flag) => String(flag || "").trim().toLowerCase().replace(/\s+/g, "_"))
      : [];
    return Array.from(new Set(values.filter(Boolean)));
  }

  firstFinite(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number)) {
        return number;
      }
    }
    return null;
  }

  formatTimeLabel(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return "00:00";
    }

    const rounded = Math.round(seconds);
    const hrs = Math.floor(rounded / 3600);
    const mins = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;

    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  normalizeConfidence(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const confidence = Number(value);
    return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null;
  }

  normalizeSpeaker(rawSpeaker = {}, index = 0) {
    const id = String(
      rawSpeaker.id ||
      rawSpeaker.speakerId ||
      rawSpeaker.speaker ||
      rawSpeaker.label ||
      rawSpeaker.speaker_id ||
      `spk_${index + 1}`,
    ).trim() || `spk_${index + 1}`;

    const role = this.normalizeRole(rawSpeaker.role || rawSpeaker.speakerRole);
    const defaultLabel = role === "doctor" ? "Doctor" : role === "patient" ? "Patient" : `Speaker ${index + 1}`;
    const confidence = this.normalizeConfidence(rawSpeaker.confidence);

    return {
      id,
      label: this.normalizeLabel(rawSpeaker.label || rawSpeaker.name || id, defaultLabel),
      role,
      confidence,
    };
  }

  normalizeSegment(rawSegment = {}, index = 0, speakerMap = new Map()) {
    const speakerId = String(
      rawSegment.speakerId ||
      rawSegment.speaker_id ||
      rawSegment.speaker ||
      rawSegment.label ||
      rawSegment.speakerLabel ||
      `spk_${index + 1}`,
    ).trim() || `spk_${index + 1}`;

    const linkedSpeaker = speakerMap.get(speakerId) || null;
    const role = this.normalizeRole(rawSegment.speakerRole || rawSegment.role || linkedSpeaker?.role);

    const startSeconds = this.firstFinite(
      rawSegment.startSeconds,
      rawSegment.start,
      rawSegment.start_sec,
      rawSegment.begin,
      rawSegment.begin_time,
    );

    const endSeconds = this.firstFinite(
      rawSegment.endSeconds,
      rawSegment.end,
      rawSegment.end_sec,
      rawSegment.stop,
      rawSegment.end_time,
    );

    const text = String(
      rawSegment.text ||
      rawSegment.transcript ||
      rawSegment.content ||
      rawSegment.words ||
      "",
    ).replace(/\s+/g, " ").trim();

    return {
      segmentId: String(rawSegment.segmentId || rawSegment.id || `seg_${index + 1}`).trim() || `seg_${index + 1}`,
      speakerId,
      speakerRole: role,
      speakerLabel: this.normalizeLabel(
        rawSegment.speakerLabel || rawSegment.label || linkedSpeaker?.label || speakerId,
        linkedSpeaker?.label || `Speaker ${index + 1}`,
      ),
      startLabel: this.normalizeLabel(rawSegment.startLabel, this.formatTimeLabel(startSeconds || 0)),
      endLabel: this.normalizeLabel(rawSegment.endLabel, this.formatTimeLabel(endSeconds || startSeconds || 0)),
      startSeconds: Number.isFinite(startSeconds) ? Math.max(0, startSeconds) : null,
      endSeconds: Number.isFinite(endSeconds) ? Math.max(0, endSeconds) : null,
      text,
      normalizedText: text,
      confidence: this.normalizeConfidence(rawSegment.confidence),
      flags: this.normalizeFlags(rawSegment.flags),
    };
  }

  normalizePayload(payload = {}, options = {}) {
    const root = payload || {};

    // Handle GPU API response format
    const gpuSpeakers = Array.isArray(root.speakers) ? root.speakers : [];
    const gpuSegments = Array.isArray(root.segments) ? root.segments : [];
    const numSpeakers = Number(root.num_speakers) || gpuSpeakers.length;

    // Convert GPU format to internal format
    const speakers = gpuSpeakers.map((speaker, index) =>
      this.normalizeSpeaker({
        id: speaker,
        label: `Speaker ${index + 1}`,
        role: "unknown", // Will be inferred later
      }, index)
    );

    // If no speakers array but segments exist, infer from segments
    const inferredSpeakers = speakers.length ? speakers : Array.from(
      new Set(gpuSegments.map(seg => seg.speaker).filter(Boolean))
    ).map((speakerId, index) => ({
      id: speakerId,
      label: `Speaker ${index + 1}`,
      role: "unknown",
    }));

    const speakerMap = new Map(inferredSpeakers.map(s => [s.id, s]));

    const segments = gpuSegments.map((segment, index) =>
      this.normalizeSegment({
        speakerId: segment.speaker,
        start: segment.start,
        end: segment.end,
        speakerRole: speakerMap.get(segment.speaker)?.role || "unknown",
        speakerLabel: speakerMap.get(segment.speaker)?.label || `Speaker ${index + 1}`,
      }, index, speakerMap)
    );

    const rawText = String(options.transcriptHint || "").trim();
    const quality = {};

    return {
      language: root.language || null,
      rawText,
      normalizedText: rawText,
      speakers: inferredSpeakers,
      segments,
      quality: {
        overallConfidence: null, // GPU API doesn't provide confidence scores
        lowConfidenceSegmentCount: 0,
        speakerCount: numSpeakers || inferredSpeakers.length,
        speakerAmbiguityCount: segments.filter(s => s.speakerRole === "unknown").length,
        overlappingSpeechSuspected: false,
      },
      metadata: {
        backend: "pyannote_gpu_diarization",
        model: "pyannote-speaker-diarization-community-1",
        providerLatencyMs: null,
        hasSegmentText: segments.some(s => s.text),
        source: "gpu_api",
        device: "gpu",
      },
    };
  }

  async executeGPURunner(audioPath, options = {}) {
    try {
      // Check if file exists
      const stats = await fs.promises.stat(audioPath);
      if (!stats.isFile()) {
        return {
          success: false,
          error: `Audio file not found: ${audioPath}`,
        };
      }

      this.log("Starting GPU diarization", { audioPath, size: stats.size });

      // Create form data
      const form = new FormData();
      form.append("file", fs.createReadStream(audioPath));

      // Make request to GPU service
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          ...form.getHeaders(),
          "X-API-Key": this.apiKey,
        },
        body: form,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`GPU service returned ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      this.log("GPU diarization completed", {
        numSpeakers: result.num_speakers,
        segmentCount: result.segments?.length,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      if (error.name === "AbortError") {
        return {
          success: false,
          error: `GPU diarization timed out after ${this.timeout}ms`,
        };
      }
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  async execute(audioPath, options = {}) {
    const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : this.maxRetries;
    const startedAt = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const result = await this.executeGPURunner(audioPath, options);

      if (result.success) {
        const normalized = this.normalizePayload(result.data, options);

        if (!Array.isArray(normalized.segments) || normalized.segments.length === 0) {
          return {
            success: false,
            error: "GPU diarization returned no usable segments",
            backend: "pyannote_gpu_diarization",
            latency: Date.now() - startedAt,
          };
        }

        return {
          success: true,
          data: normalized,
          backend: "pyannote_gpu_diarization",
          model: normalized.metadata?.model || "pyannote-speaker-diarization-community-1",
          latency: Date.now() - startedAt,
        };
      }

      if (!this.isRetryableError(result.error) || attempt >= maxRetries) {
        return {
          success: false,
          error: result.error,
          backend: "pyannote_gpu_diarization",
          latency: Date.now() - startedAt,
        };
      }

      this.log("retry_attempt", { attempt, error: result.error });
      await this.sleep(1000 * (attempt + 1));
    }

    return {
      success: false,
      error: "GPU diarization failed after retries",
      backend: "pyannote_gpu_diarization",
      latency: Date.now() - startedAt,
    };
  }
}

module.exports = PyannoteSpeakerDiarizationTool;