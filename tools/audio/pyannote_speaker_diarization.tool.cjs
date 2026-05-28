const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

class PyannoteSpeakerDiarizationTool {
  constructor(config = {}) {
    this.name = "Pyannote Speaker Diarization Tool";
    this.version = "2.0.0";
    const bundledPythonBin = path.join(process.cwd(), ".venv-pyannote", "bin", "python3.11");
    this.pythonBin = config.pythonBin || process.env.PYANNOTE_PYTHON_BIN || (fs.existsSync(bundledPythonBin) ? bundledPythonBin : "python3");
    this.runnerPath = path.resolve(
      config.runnerPath || process.env.PYANNOTE_RUNNER_PATH || path.join(__dirname, "pyannote_offline_diarization.py"),
    );
    this.modelDir = path.resolve(
      config.modelDir || process.env.PYANNOTE_MODEL_DIR || path.join(process.cwd(), "models", "pyannote-speaker-diarization-community-1"),
    );
    this.modelId = config.modelId || process.env.PYANNOTE_DIARIZATION_MODEL || "pyannote/speaker-diarization-community-1";
    this.hfToken = config.hfToken || process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN || process.env.PYANNOTE_HF_TOKEN || "";
    this.hfHome = path.resolve(config.hfHome || process.env.HF_HOME || path.join(process.cwd(), ".cache", "huggingface"));
    this.mplConfigDir = path.resolve(config.mplConfigDir || process.env.MPLCONFIGDIR || path.join(process.cwd(), ".cache", "matplotlib"));
    this.allowOnlineBootstrap = config.allowOnlineBootstrap ?? (process.env.PYANNOTE_ALLOW_ONLINE_BOOTSTRAP === "true");
    this.device = config.device || process.env.PYANNOTE_DEVICE || "cpu";
    this.timeout = Number(config.timeout || process.env.PYANNOTE_TIMEOUT || 600000);
    this.maxRetries = Number.isFinite(config.maxRetries) ? config.maxRetries : Number(process.env.PYANNOTE_MAX_RETRIES || 1);
    this.windowSeconds = Number(config.windowSeconds ?? process.env.PYANNOTE_WINDOW_SECONDS ?? 180);
    this.windowOverlapSeconds = Number(config.windowOverlapSeconds ?? process.env.PYANNOTE_WINDOW_OVERLAP_SECONDS ?? 15);
    this.windowedThresholdSeconds = Number(config.windowedThresholdSeconds ?? process.env.PYANNOTE_WINDOWED_THRESHOLD_SECONDS ?? 180);
    this.debug = config.debug || false;
  }

  log(message, data = {}) {
    if (this.debug) {
      console.log(`[PyannoteSpeakerDiarization] ${message}`, data);
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  isRetryableError(error) {
    const message = String(error?.message || error || "");
    return (
      message.includes("timed out") ||
      message.includes("ECONNRESET") ||
      message.includes("ENOTFOUND") ||
      message.includes("Temporary failure")
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
    const role = this.normalizeRole(rawSpeaker.role || rawSpeaker.speakerRole);
    const id = String(
      rawSpeaker.id ||
      rawSpeaker.speakerId ||
      rawSpeaker.speaker_id ||
      rawSpeaker.speaker ||
      rawSpeaker.label ||
      `spk_${index + 1}`,
    ).trim() || `spk_${index + 1}`;
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
    const root = payload?.result || payload?.data || payload || {};
    const speakerRows = Array.isArray(root.speakers) ? root.speakers : [];
    const segmentRows = Array.isArray(root.segments)
      ? root.segments
      : Array.isArray(root.diarization)
        ? root.diarization
        : Array.isArray(root.turns)
          ? root.turns
          : [];

    const inferredSpeakerRows = speakerRows.length
      ? speakerRows
      : Array.from(
          new Set(
            segmentRows
              .map((segment) =>
                String(
                  segment?.speakerId ||
                  segment?.speaker_id ||
                  segment?.speaker ||
                  segment?.label ||
                  "",
                ).trim(),
              )
              .filter(Boolean),
          ),
        ).map((speakerId, index) => ({ id: speakerId, label: `Speaker ${index + 1}` }));

    const speakers = inferredSpeakerRows.map((speaker, index) => this.normalizeSpeaker(speaker, index));
    const speakerMap = new Map(speakers.map((speaker) => [speaker.id, speaker]));
    const segments = segmentRows.map((segment, index) => this.normalizeSegment(segment, index, speakerMap));
    const confidences = segments
      .map((segment) => segment.confidence)
      .filter((value) => typeof value === "number");
    const rawText = String(root.rawText || root.normalizedText || options.transcriptHint || "").trim();
    const quality = root.quality || {};

    return {
      language: root.language || null,
      rawText,
      normalizedText: String(root.normalizedText || rawText).trim(),
      speakers,
      segments,
      quality: {
        overallConfidence: this.normalizeConfidence(quality.overallConfidence) !== null
          ? this.normalizeConfidence(quality.overallConfidence)
          : (confidences.length
              ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2))
              : null),
        lowConfidenceSegmentCount: Number.isFinite(Number(quality.lowConfidenceSegmentCount))
          ? Number(quality.lowConfidenceSegmentCount)
          : segments.filter((segment) => typeof segment.confidence === "number" && segment.confidence < 0.7).length,
        speakerCount: Number.isFinite(Number(quality.speakerCount))
          ? Number(quality.speakerCount)
          : speakers.length,
        speakerAmbiguityCount: Number.isFinite(Number(quality.speakerAmbiguityCount))
          ? Number(quality.speakerAmbiguityCount)
          : segments.filter((segment) => segment.speakerRole === "unknown").length,
        overlappingSpeechSuspected: Boolean(quality.overlappingSpeechSuspected),
      },
      metadata: {
        backend: "pyannote_diarization",
        model: root.model || this.modelId,
        providerLatencyMs: root.latencyMs || root.latency || null,
        hasSegmentText: segments.some((segment) => segment.text),
        source: root.source || (fs.existsSync(this.modelDir) ? "local_model_dir" : "hub"),
      },
    };
  }

  ensureLocalPrerequisites() {
    if (!fs.existsSync(this.runnerPath)) {
      return `Pyannote offline runner not found: ${this.runnerPath}`;
    }

    if (fs.existsSync(this.modelDir)) {
      return null;
    }

    if (this.allowOnlineBootstrap) {
      return null;
    }

    return `Pyannote model directory not found: ${this.modelDir}. Seed it once from Hugging Face or enable PYANNOTE_ALLOW_ONLINE_BOOTSTRAP for the first authenticated download.`;
  }

  executeLocalRunner(audioPath, options = {}) {
    const prerequisiteError = this.ensureLocalPrerequisites();
    if (prerequisiteError) {
      return Promise.resolve({
        success: false,
        error: prerequisiteError,
        backend: "pyannote_diarization",
      });
    }

    return new Promise((resolve) => {
      const args = [
        this.runnerPath,
        "--audio-path",
        path.resolve(audioPath),
        "--model-id",
        options.modelId || this.modelId,
        "--device",
        options.device || this.device,
      ];

      if (fs.existsSync(this.modelDir) || this.allowOnlineBootstrap) {
        args.push("--model-dir", this.modelDir);
      }
      if (this.allowOnlineBootstrap) {
        args.push("--allow-online-bootstrap");
      }
      if (options.transcriptHint) {
        args.push("--transcript-hint", String(options.transcriptHint).slice(0, 20000));
      }
      if (Number.isFinite(options.numSpeakers)) {
        args.push("--num-speakers", String(options.numSpeakers));
      }
      if (Number.isFinite(options.minSpeakers)) {
        args.push("--min-speakers", String(options.minSpeakers));
      }
      if (Number.isFinite(options.maxSpeakers)) {
        args.push("--max-speakers", String(options.maxSpeakers));
      }
      const windowSeconds = Number.isFinite(options.windowSeconds) ? Number(options.windowSeconds) : this.windowSeconds;
      const windowOverlapSeconds = Number.isFinite(options.windowOverlapSeconds)
        ? Number(options.windowOverlapSeconds)
        : this.windowOverlapSeconds;
      const windowedThresholdSeconds = Number.isFinite(options.windowedThresholdSeconds)
        ? Number(options.windowedThresholdSeconds)
        : this.windowedThresholdSeconds;
      if (Number.isFinite(windowSeconds) && windowSeconds > 0) {
        args.push("--window-seconds", String(windowSeconds));
      }
      if (Number.isFinite(windowOverlapSeconds) && windowOverlapSeconds >= 0) {
        args.push("--window-overlap-seconds", String(windowOverlapSeconds));
      }
      if (Number.isFinite(windowedThresholdSeconds) && windowedThresholdSeconds > 0) {
        args.push("--windowed-threshold-seconds", String(windowedThresholdSeconds));
      }

      fs.mkdirSync(this.hfHome, { recursive: true });
      fs.mkdirSync(this.mplConfigDir, { recursive: true });

      const child = spawn(this.pythonBin, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HF_TOKEN: this.hfToken || process.env.HF_TOKEN || "",
          HUGGINGFACE_HUB_TOKEN: this.hfToken || process.env.HUGGINGFACE_HUB_TOKEN || "",
          HF_HOME: this.hfHome,
          MPLCONFIGDIR: this.mplConfigDir,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const startedAt = Date.now();
      const stdoutChunks = [];
      const stderrChunks = [];
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, this.timeout);

      child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

      child.on("error", (error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: error?.message || String(error),
          backend: "pyannote_diarization",
          latency: Date.now() - startedAt,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timeoutId);
        const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

        if (!stdout) {
          resolve({
            success: false,
            error: timedOut
              ? `Pyannote local runner timed out after ${this.timeout}ms`
              : (stderr || `Pyannote local runner exited with code ${code}`),
            backend: "pyannote_diarization",
            latency: Date.now() - startedAt,
          });
          return;
        }

        let payload;
        try {
          payload = JSON.parse(stdout);
        } catch {
          resolve({
            success: false,
            error: stderr || `Pyannote local runner returned invalid JSON: ${stdout.slice(0, 300)}`,
            backend: "pyannote_diarization",
            latency: Date.now() - startedAt,
          });
          return;
        }

        if (!payload.success) {
          resolve({
            success: false,
            error: payload.error || stderr || "Pyannote offline diarization failed",
            backend: "pyannote_diarization",
            latency: payload.latencyMs || Date.now() - startedAt,
          });
          return;
        }

        resolve({
          success: true,
          data: payload.data,
          backend: "pyannote_diarization",
          model: payload.model || payload.data?.metadata?.model || this.modelId,
          latency: payload.latencyMs || Date.now() - startedAt,
          rawPayload: payload,
        });
      });
    });
  }

  async execute(audioPath, options = {}) {
    const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : this.maxRetries;
    const startedAt = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const result = await this.executeLocalRunner(audioPath, options);
      if (result.success) {
        const normalized = this.normalizePayload(result.data, options);
        if (!Array.isArray(normalized.segments) || normalized.segments.length === 0) {
          return {
            success: false,
            error: "Pyannote diarization returned no usable segments",
            backend: "pyannote_diarization",
            latency: Date.now() - startedAt,
          };
        }

        return {
          success: true,
          data: normalized,
          backend: "pyannote_diarization",
          model: normalized.metadata?.model || this.modelId,
          latency: Date.now() - startedAt,
        };
      }

      if (!this.isRetryableError(result.error) || attempt >= maxRetries) {
        return {
          success: false,
          error: result.error,
          backend: "pyannote_diarization",
          latency: Date.now() - startedAt,
        };
      }

      await this.sleep(1000 * (attempt + 1));
    }

    return {
      success: false,
      error: "Pyannote diarization failed after retries",
      backend: "pyannote_diarization",
      latency: Date.now() - startedAt,
    };
  }
}

module.exports = PyannoteSpeakerDiarizationTool;
