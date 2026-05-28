const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const GeminiSTTSkill = require("../skills/stt/gemini_stt_skill.cjs");
const MedASRSTTSkill = require("../skills/stt/medasr_stt_skill.cjs");
const WhisperSTTSkill = require("../skills/stt/whisper_stt_skill.cjs");
const ConversationTranscriptValidationSkill = require("../skills/stt/conversation_transcript_validation_skill.cjs");
const HybridSTTReconcilerSkill = require("../skills/stt/hybrid_stt_reconciler_skill.cjs");
const SpeakerDiarizationSkill = require("../skills/stt/speaker_diarization_skill.cjs");
const VADSegmentationSkill = require("../skills/stt/vad_segmentation_skill.cjs");
const VADSegmentationTool = require("../tools/audio/vad_segmentation.tool.cjs");

class LiveConversationSTTAgent {
  constructor(config = {}) {
    this.name = "Live Conversation STT Agent";
    this.version = "2.0.0";
    this.type = "live_conversation_stt_agent";
    const bundledPyannotePython = path.join(process.cwd(), ".venv-pyannote", "bin", "python3.11");

    this.config = {
      debug: config.debug || false,
      whisperTimeout: config.whisperTimeout || 60000,
      whisperRetries: config.whisperRetries || 2,
      whisperUrl: config.whisperUrl || process.env.WHISPER_STT_URL,
      medasrTimeout: config.medasrTimeout || Number(process.env.MEDASR_TIMEOUT || 30000),
      medasrRetries: config.medasrRetries || Number(process.env.MEDASR_MAX_RETRIES || 2),
      medasrEndpoint: config.medasrEndpoint || process.env.MEDASR_ENDPOINT,
      language: config.language || process.env.WHISPER_LANGUAGE || "auto",
      temperature: config.temperature || process.env.WHISPER_TEMPERATURE || "0",
      gemmaUrl: config.gemmaUrl || process.env.GEMMA_URL,
      gemmaModel: config.gemmaModel || process.env.GEMMA_MODEL,
      pyannotePythonBin: config.pyannotePythonBin || process.env.PYANNOTE_PYTHON_BIN || (fs.existsSync(bundledPyannotePython) ? bundledPyannotePython : "python3"),
      pyannoteModelDir: config.pyannoteModelDir || process.env.PYANNOTE_MODEL_DIR || path.join(process.cwd(), "models", "pyannote-speaker-diarization-community-1"),
      pyannoteModelId: config.pyannoteModelId || process.env.PYANNOTE_DIARIZATION_MODEL || "pyannote/speaker-diarization-community-1",
      pyannoteAllowOnlineBootstrap: config.pyannoteAllowOnlineBootstrap ?? (process.env.PYANNOTE_ALLOW_ONLINE_BOOTSTRAP === "true"),
      pyannoteDevice: config.pyannoteDevice || process.env.PYANNOTE_DEVICE || "cpu",
      pyannoteTimeout: Number(config.pyannoteTimeout ?? process.env.PYANNOTE_TIMEOUT ?? 600000),
      pyannoteWindowSeconds: Number(config.pyannoteWindowSeconds ?? process.env.PYANNOTE_WINDOW_SECONDS ?? 180),
      pyannoteWindowOverlapSeconds: Number(config.pyannoteWindowOverlapSeconds ?? process.env.PYANNOTE_WINDOW_OVERLAP_SECONDS ?? 15),
      pyannoteWindowedThresholdSeconds: Number(config.pyannoteWindowedThresholdSeconds ?? process.env.PYANNOTE_WINDOWED_THRESHOLD_SECONDS ?? 180),
      diarizationProvider: config.diarizationProvider || process.env.SPEAKER_DIARIZATION_PROVIDER || "pyannote",
      diarizationFallbackProvider: config.diarizationFallbackProvider || process.env.SPEAKER_DIARIZATION_FALLBACK || "gemini",
      allowDiarizationFallback: config.allowDiarizationFallback ?? (process.env.SPEAKER_DIARIZATION_ALLOW_FALLBACK === "true"),
      enableGeminiFallback: config.enableGeminiFallback ?? (process.env.LIVE_STT_ENABLE_GEMINI_FALLBACK === "true"),
      geminiBaseUrl: config.geminiBaseUrl || process.env.GEMINI_BASE_URL,
      geminiModel: config.geminiModel || process.env.VOICE_GEMINI_MODEL || process.env.GEMINI_MODEL,
      geminiApiKey: config.geminiApiKey || process.env.GEMINI_API_KEY,
      geminiApiKeyFallback: config.geminiApiKeyFallback || process.env.GEMINI_API_KEY_FALLBACK,
      geminiTimeout: config.geminiTimeout || 300000,
      geminiMaxRetries: config.geminiMaxRetries || 1,
      chunkCircuitConsecutiveFailures: Number(config.chunkCircuitConsecutiveFailures ?? process.env.LIVE_STT_CHUNK_CIRCUIT_CONSECUTIVE_FAILURES ?? 4),
      chunkCircuitMinimumAttempts: Number(config.chunkCircuitMinimumAttempts ?? process.env.LIVE_STT_CHUNK_CIRCUIT_MIN_ATTEMPTS ?? 4),
      ...config,
    };

    this.vadTool = new VADSegmentationTool({ debug: this.config.debug });
    this.vadSkill = new VADSegmentationSkill({ debug: this.config.debug, tool: this.vadTool });
    this.whisperSkill = new WhisperSTTSkill({
      url: this.config.whisperUrl,
      language: this.config.language,
      temperature: this.config.temperature,
      timeout: this.config.whisperTimeout,
      maxRetries: this.config.whisperRetries,
      debug: this.config.debug,
    });
    this.medasrSkill = new MedASRSTTSkill({
      endpoint: this.config.medasrEndpoint,
      timeout: this.config.medasrTimeout,
      maxRetries: this.config.medasrRetries,
      debug: this.config.debug,
    });
    this.hybridReconcilerSkill = new HybridSTTReconcilerSkill({
      gemmaUrl: this.config.gemmaUrl,
      gemmaModel: this.config.gemmaModel,
      timeout: config.hybridTimeout || 60000,
      debug: this.config.debug,
    });
    this.validationSkill = new ConversationTranscriptValidationSkill({
      baseUrl: this.config.gemmaUrl,
      model: this.config.gemmaModel,
      debug: this.config.debug,
    });
    this.speakerDiarizationSkill = new SpeakerDiarizationSkill({
      provider: this.config.diarizationProvider,
      fallbackProvider: this.config.diarizationFallbackProvider,
      allowFallback: this.config.allowDiarizationFallback,
      pythonBin: this.config.pyannotePythonBin,
      modelDir: this.config.pyannoteModelDir,
      modelId: this.config.pyannoteModelId,
      allowOnlineBootstrap: this.config.pyannoteAllowOnlineBootstrap,
      device: this.config.pyannoteDevice,
      windowSeconds: this.config.pyannoteWindowSeconds,
      windowOverlapSeconds: this.config.pyannoteWindowOverlapSeconds,
      windowedThresholdSeconds: this.config.pyannoteWindowedThresholdSeconds,
      pyannoteTimeout: this.config.pyannoteTimeout,
      baseUrl: this.config.geminiBaseUrl,
      model: this.config.geminiModel,
      apiKey: this.config.geminiApiKey,
      apiKeyFallback: this.config.geminiApiKeyFallback,
      geminiTimeout: this.config.geminiTimeout,
      maxRetries: this.config.geminiMaxRetries,
      debug: this.config.debug,
    });
    this.geminiSkill = new GeminiSTTSkill({
      baseUrl: this.config.geminiBaseUrl,
      model: this.config.geminiModel,
      apiKey: this.config.geminiApiKey,
      apiKeyFallback: this.config.geminiApiKeyFallback,
      timeout: this.config.geminiTimeout,
      maxRetries: this.config.geminiMaxRetries,
      debug: this.config.debug,
    });
  }

  log(message, data = {}) {
    if (this.config.debug) {
      console.log(`[LiveConversationSTTAgent] ${message}`, data);
    }
  }

  detectMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".wav") return "audio/wav";
    if (ext === ".mp3") return "audio/mpeg";
    if (ext === ".m4a") return "audio/mp4";
    if (ext === ".webm") return "audio/webm";
    return "application/octet-stream";
  }

  resolveWindowSeconds(options = {}) {
    const explicitSeconds = Number(options.windowSeconds);
    if (Number.isFinite(explicitSeconds) && explicitSeconds > 0) {
      return explicitSeconds;
    }

    const maxSegmentMs = Number(options.maxSegmentMs);
    if (Number.isFinite(maxSegmentMs) && maxSegmentMs > 0) {
      return Math.max(1, maxSegmentMs / 1000);
    }

    return 15;
  }

  resolveHopSeconds(options = {}) {
    const explicitSeconds = Number(options.hopSeconds);
    if (Number.isFinite(explicitSeconds) && explicitSeconds > 0) {
      return explicitSeconds;
    }
    return this.resolveWindowSeconds(options);
  }

  hasUsableTranscriptResult(result = null) {
    const transcript = result?.data?.normalizedText || result?.data?.rawText || "";
    return Boolean(result?.success && String(transcript).trim().length > 0);
  }

  buildFailureSummary({
    chunks = [],
    chunkCircuit = null,
    chunkedWhisperResult = null,
    whisperFallbackResult = null,
    medasrResult = null,
    reconciliationResult = null,
    geminiFallbackResult = null,
    diarization = null,
  } = {}) {
    const parts = [];
    const failedChunks = chunks.filter((chunk) => !chunk.success);
    const firstChunkError = failedChunks[0];

    if (chunkCircuit?.tripped) {
      parts.push(`Whisper chunk circuit breaker opened: ${chunkCircuit.reason}.`);
    }

    if (failedChunks.length > 0) {
      parts.push(
        `Whisper chunk transcription failed for ${failedChunks.length}/${chunks.length} chunks${firstChunkError?.error ? ` (first: ${firstChunkError.error})` : ""}.`,
      );
    }

    if (!this.hasUsableTranscriptResult(chunkedWhisperResult) && chunkedWhisperResult?.error) {
      parts.push(`Chunked Whisper failed: ${chunkedWhisperResult.error}.`);
    }

    if (whisperFallbackResult && !this.hasUsableTranscriptResult(whisperFallbackResult)) {
      parts.push(`Whole-file Whisper fallback failed: ${whisperFallbackResult.error || "unknown failure"}.`);
    }

    if (medasrResult && !this.hasUsableTranscriptResult(medasrResult)) {
      parts.push(`MedASR failed: ${medasrResult.error || "unknown failure"}.`);
    }

    if (reconciliationResult && !this.hasUsableTranscriptResult(reconciliationResult) && reconciliationResult.error) {
      parts.push(`Hybrid reconciliation failed: ${reconciliationResult.error}.`);
    }

    if (geminiFallbackResult && !this.hasUsableTranscriptResult(geminiFallbackResult)) {
      parts.push(`Gemini fallback failed: ${geminiFallbackResult.error || "unknown failure"}.`);
    }

    if (diarization?.error) {
      parts.push(`Speaker diarization failed: ${diarization.error}.`);
    }

    return parts.join(" ") || "No transcript source succeeded.";
  }

  buildFixedWindowPlan(meta, options = {}) {
    const windowSeconds = this.resolveWindowSeconds(options);
    const hopSeconds = this.resolveHopSeconds(options);
    const windowBytes = this.vadTool.alignByteCount(windowSeconds * meta.byteRate, meta.blockAlign);
    const hopBytes = this.vadTool.alignByteCount(hopSeconds * meta.byteRate, meta.blockAlign);
    const chunks = [];

    for (let startByte = 0, chunkIndex = 0; startByte < meta.dataSize; startByte += hopBytes, chunkIndex += 1) {
      const endByte = Math.min(meta.dataSize, startByte + windowBytes);
      if (endByte <= startByte) {
        break;
      }

      const startSeconds = startByte / meta.byteRate;
      const endSeconds = endByte / meta.byteRate;
      chunks.push({
        chunkIndex,
        startByte,
        endByte,
        startSeconds,
        endSeconds,
        durationSeconds: endSeconds - startSeconds,
        source: "fixed_window",
      });

      if (endByte >= meta.dataSize) {
        break;
      }
    }

    return {
      mode: "fixed_window_no_vad",
      analysis: null,
      chunks,
    };
  }

  async buildChunkPlan(analysisAudioPath, meta, options = {}) {
    const mode = options.mode || "fixed_window_no_vad";

    if (mode === "energy_vad") {
      const vadResult = await this.vadSkill.execute({
        audioPath: analysisAudioPath,
        options: {
          frameMs: options.frameMs,
          minSpeechMs: options.minSpeechMs,
          minSilenceMs: options.minSilenceMs,
          preRollMs: options.preRollMs,
          postRollMs: options.postRollMs,
          mergeGapMs: options.mergeGapMs,
          maxSegmentMs: this.resolveWindowSeconds(options) * 1000,
        },
      });

      if (!vadResult.success) {
        throw new Error(vadResult.error || "VAD segmentation failed");
      }

      return {
        mode: "energy_vad",
        analysis: vadResult.data.analysis,
        chunks: vadResult.data.segments.map((segment, index) => ({
          chunkIndex: index,
          startByte: segment.startByte,
          endByte: segment.endByte,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          durationSeconds: segment.durationSeconds,
          source: "energy_vad",
        })),
      };
    }

    return this.buildFixedWindowPlan(meta, options);
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

  getSegmentStartSeconds(segment = {}) {
    if (Number.isFinite(segment.startSeconds)) {
      return segment.startSeconds;
    }
    return this.parseTimeLabel(segment.startLabel);
  }

  getSegmentEndSeconds(segment = {}) {
    if (Number.isFinite(segment.endSeconds)) {
      return segment.endSeconds;
    }
    return this.parseTimeLabel(segment.endLabel);
  }

  annotateChunksWithDiarization(chunks = [], diarization = null) {
    if (!diarization || !Array.isArray(diarization.segments) || diarization.segments.length === 0) {
      return chunks;
    }

    return chunks.map((chunk) => {
      const totalsBySpeaker = new Map();
      const chunkStart = Number(chunk.startSeconds) || 0;
      const chunkEnd = Number(chunk.endSeconds) || chunkStart;

      for (const segment of diarization.segments) {
        const segmentStart = this.getSegmentStartSeconds(segment);
        const segmentEnd = this.getSegmentEndSeconds(segment);
        if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) {
          continue;
        }

        const overlapStart = Math.max(chunkStart, segmentStart);
        const overlapEnd = Math.min(chunkEnd, segmentEnd);
        const overlapSeconds = overlapEnd - overlapStart;
        if (overlapSeconds <= 0) {
          continue;
        }

        const key = segment.speakerId || `${segment.speakerRole}:${segment.speakerLabel}`;
        const previous = totalsBySpeaker.get(key) || {
          speakerId: segment.speakerId || null,
          speakerRole: segment.speakerRole || "unknown",
          speakerLabel: segment.speakerLabel || "Speaker",
          overlapSeconds: 0,
        };
        previous.overlapSeconds += overlapSeconds;
        totalsBySpeaker.set(key, previous);
      }

      const ranked = Array.from(totalsBySpeaker.values()).sort((left, right) => right.overlapSeconds - left.overlapSeconds);
      const dominant = ranked[0];
      const dominantShare = dominant ? dominant.overlapSeconds / Math.max(0.001, chunkEnd - chunkStart) : 0;

      if (!dominant) {
        return {
          ...chunk,
          speakerId: null,
          speakerRole: "unknown",
          speakerLabel: "Unknown",
          speakerConfidence: null,
        };
      }

      return {
        ...chunk,
        speakerId: dominant.speakerId,
        speakerRole: dominantShare >= 0.6 ? dominant.speakerRole : "unknown",
        speakerLabel: dominantShare >= 0.6 ? dominant.speakerLabel : "Mixed / unclear",
        speakerConfidence: Number(dominantShare.toFixed(2)),
      };
    });
  }

  buildChunkTranscriptResult(chunks = [], meta = {}, options = {}) {
    const successfulChunks = chunks.filter((chunk) => chunk.success && chunk.transcript);
    const cumulativeTranscript = successfulChunks.map((chunk) => chunk.transcript).join("\n");
    const baseTranscript = this.whisperSkill.buildTranscriptResponse(
      cumulativeTranscript,
      options.language || this.config.language || "en",
      {
        audioDuration: meta.durationSeconds,
        mode: "live_chunked_whisper",
        chunkCount: chunks.length,
        successfulChunkCount: successfulChunks.length,
      },
    );

    const speakerMap = new Map();
    const segments = successfulChunks.map((chunk, index) => {
      const speakerId = chunk.speakerId || "spk_unknown";
      const speakerRole = chunk.speakerRole || "unknown";
      const speakerLabel = chunk.speakerLabel || "Unknown";
      if (!speakerMap.has(speakerId)) {
        speakerMap.set(speakerId, {
          id: speakerId,
          label: speakerLabel,
          role: speakerRole,
          confidence: Number.isFinite(chunk.speakerConfidence) ? chunk.speakerConfidence : null,
        });
      }

      const flags = [chunk.source, "requires_review"];
      if (speakerRole === "unknown") {
        flags.push("speaker_ambiguity");
      }
      if (Number.isFinite(chunk.speakerConfidence) && chunk.speakerConfidence < 0.7) {
        flags.push("low_confidence");
      }

      return {
        segmentId: `seg_${index + 1}`,
        speakerId,
        speakerRole,
        speakerLabel,
        startLabel: chunk.startLabel,
        endLabel: chunk.endLabel,
        startSeconds: chunk.startSeconds,
        endSeconds: chunk.endSeconds,
        text: chunk.transcript,
        normalizedText: chunk.transcript,
        confidence: Number.isFinite(chunk.speakerConfidence) ? Math.max(0.65, chunk.speakerConfidence) : 0.9,
        flags: Array.from(new Set(flags)),
      };
    });

    const overallConfidence = segments.length
      ? Number(
          (
            segments.reduce((sum, segment) => sum + (Number(segment.confidence) || 0.9), 0) /
            Math.max(1, segments.length)
          ).toFixed(2),
        )
      : 0;

    return {
      success: cumulativeTranscript.length > 0,
      data: {
        ...baseTranscript,
        rawText: cumulativeTranscript,
        normalizedText: cumulativeTranscript,
        speakers: Array.from(speakerMap.values()),
        segments,
        quality: {
          overallConfidence,
          lowConfidenceSegmentCount: segments.filter((segment) => Array.isArray(segment.flags) && segment.flags.includes("low_confidence")).length,
          missingAudioSuspected: chunks.some((chunk) => !chunk.success),
          overlappingSpeechSuspected: segments.some((segment) => Array.isArray(segment.flags) && segment.flags.includes("overlap")),
          medicationRisk: "medium",
        },
        metadata: {
          ...baseTranscript.metadata,
          backend: "whisper_chunked_live",
          chunkMode: options.mode || "fixed_window_no_vad",
          chunkCount: chunks.length,
          successfulChunkCount: successfulChunks.length,
        },
      },
      backend: "whisper_chunked_live",
      model: "whisper-self-hosted",
      latency: chunks.reduce((sum, chunk) => sum + (chunk.latencyMs || 0), 0),
    };
  }

  evaluateChunkCircuitBreaker(chunks = [], totalPlannedChunks = 0, options = {}) {
    const minimumAttempts = Number(options.chunkCircuitMinimumAttempts ?? this.config.chunkCircuitMinimumAttempts);
    const consecutiveFailureThreshold = Number(
      options.chunkCircuitConsecutiveFailures ?? this.config.chunkCircuitConsecutiveFailures,
    );

    if (!Number.isFinite(minimumAttempts) || !Number.isFinite(consecutiveFailureThreshold)) {
      return { tripped: false, reason: null, skippedChunks: 0, attemptedChunks: chunks.length };
    }

    if (chunks.length < Math.max(1, minimumAttempts)) {
      return { tripped: false, reason: null, skippedChunks: 0, attemptedChunks: chunks.length };
    }

    let consecutiveFailures = 0;
    for (let index = chunks.length - 1; index >= 0; index -= 1) {
      if (chunks[index]?.success) {
        break;
      }
      consecutiveFailures += 1;
    }

    if (consecutiveFailures < Math.max(1, consecutiveFailureThreshold)) {
      return { tripped: false, reason: null, skippedChunks: 0, attemptedChunks: chunks.length };
    }

    const firstFailedChunk = chunks.find((chunk) => !chunk.success);
    return {
      tripped: true,
      reason: `Opened after ${consecutiveFailures} consecutive failed chunk calls${firstFailedChunk?.error ? ` (first: ${firstFailedChunk.error})` : ""}`,
      skippedChunks: Math.max(0, totalPlannedChunks - chunks.length),
      attemptedChunks: chunks.length,
    };
  }

  async runChunkTranscription(chunkPlan, pcmData, meta, workingDir, options = {}) {
    const chunks = [];
    const totalPlannedChunks = Array.isArray(chunkPlan?.chunks) ? chunkPlan.chunks.length : 0;

    for (const plannedChunk of chunkPlan.chunks) {
      const pcmSlice = pcmData.subarray(plannedChunk.startByte, plannedChunk.endByte);
      const chunkBuffer = this.vadTool.buildPcmWavBuffer(meta, pcmSlice);
      const chunkPath = path.join(workingDir, `chunk_${String(plannedChunk.chunkIndex).padStart(3, "0")}.wav`);
      await fsp.writeFile(chunkPath, chunkBuffer);

      const startedAt = Date.now();
      const result = await this.whisperSkill.execute({
        audioPath: chunkPath,
        mimeType: "audio/wav",
        language: options.language,
        temperature: options.temperature,
      });
      const latencyMs = Date.now() - startedAt;
      const transcript = result.success
        ? (result.data.normalizedText || result.data.rawText || "")
        : "";

      chunks.push({
        chunkIndex: plannedChunk.chunkIndex,
        chunkPath,
        startSeconds: plannedChunk.startSeconds,
        endSeconds: plannedChunk.endSeconds,
        startLabel: this.vadTool.formatSeconds(plannedChunk.startSeconds),
        endLabel: this.vadTool.formatSeconds(plannedChunk.endSeconds),
        latencyMs,
        success: result.success,
        textLength: transcript.length,
        transcript,
        error: result.success ? null : result.error || "Unknown failure",
        source: plannedChunk.source,
      });

      const circuitBreaker = this.evaluateChunkCircuitBreaker(chunks, totalPlannedChunks, options);
      if (circuitBreaker.tripped) {
        return {
          chunks,
          circuitBreaker,
        };
      }
    }

    return {
      chunks,
      circuitBreaker: {
        tripped: false,
        reason: null,
        skippedChunks: 0,
        attemptedChunks: chunks.length,
      },
    };
  }

  async runMedASRShadowTranscription(audioPath, mimeType, options = {}) {
    try {
      return await this.medasrSkill.execute({
        audioPath,
        mimeType,
        options: {
          maxRetries: options.medasrMaxRetries ?? this.config.medasrRetries,
        },
      });
    } catch (error) {
      return {
        success: false,
        error: error?.message || String(error),
        backend: "medasr",
      };
    }
  }

  async runWholeFileWhisperFallback(audioPath, mimeType, options = {}) {
    try {
      const result = await this.whisperSkill.execute({
        audioPath,
        mimeType,
        language: options.language,
        temperature: options.temperature,
        options: {
          maxRetries: options.whisperMaxRetries ?? this.config.whisperRetries,
        },
      });

      if (!this.hasUsableTranscriptResult(result)) {
        return result;
      }

      return {
        ...result,
        data: {
          ...result.data,
          metadata: {
            ...(result.data?.metadata || {}),
            backend: "whisper_fullfile_fallback",
            fallbackReason: options.fallbackReason || "chunk_transcription_failed",
          },
        },
        backend: "whisper_fullfile_fallback",
      };
    } catch (error) {
      return {
        success: false,
        error: error?.message || String(error),
        backend: "whisper_fullfile_fallback",
      };
    }
  }

  async runSpeakerDiarization(audioPath, mimeType, options = {}) {
    const result = await this.speakerDiarizationSkill.execute({
      audioPath,
      mimeType,
      transcriptHint: options.transcriptHint,
      options: {
        provider: options.diarizationProvider || this.config.diarizationProvider,
        fallbackProvider: options.diarizationFallbackProvider || this.config.diarizationFallbackProvider,
        allowFallback: options.allowDiarizationFallback ?? this.config.allowDiarizationFallback,
        maxRetries: options.diarizationMaxRetries ?? 0,
        temperature: options.diarizationTemperature ?? 0.1,
        maxTokens: options.diarizationMaxTokens ?? 4096,
        numSpeakers: options.diarizationNumSpeakers,
        minSpeakers: options.diarizationMinSpeakers,
        maxSpeakers: options.diarizationMaxSpeakers,
        windowSeconds: options.diarizationWindowSeconds ?? this.config.pyannoteWindowSeconds,
        windowOverlapSeconds: options.diarizationWindowOverlapSeconds ?? this.config.pyannoteWindowOverlapSeconds,
        windowedThresholdSeconds: options.diarizationWindowedThresholdSeconds ?? this.config.pyannoteWindowedThresholdSeconds,
      },
    });

    return result.success
      ? {
          ...result.data,
          usage: result.usage || null,
          latencyMs: result.latency || null,
          backend: result.backend,
        }
      : {
          error: result.error || "Speaker diarization failed",
          backend: result.backend || null,
          latencyMs: result.latency || null,
        };
  }

  async runGeminiFallback(audioPath, mimeType, options = {}) {
    if (!this.config.enableGeminiFallback && !options.enableGeminiFallback) {
      return null;
    }

    try {
      return await this.geminiSkill.execute({
        audioPath,
        mimeType,
        options: {
          maxRetries: options.geminiMaxRetries ?? this.config.geminiMaxRetries,
        },
      });
    } catch (error) {
      return {
        success: false,
        error: error?.message || String(error),
        backend: "gemini",
      };
    }
  }

  buildChunkSummary(chunks = [], circuitBreaker = null) {
    const successfulChunks = chunks.filter((item) => item.success);
    const totalLatencyMs = chunks.reduce((sum, item) => sum + (item.latencyMs || 0), 0);
    const firstSuccessfulChunk = successfulChunks[0] || null;
    return {
      totalChunks: chunks.length,
      successfulChunks: successfulChunks.length,
      failedChunks: chunks.length - successfulChunks.length,
      totalLatencyMs,
      averageLatencyMs: chunks.length > 0 ? Math.round(totalLatencyMs / chunks.length) : 0,
      timeToFirstTranscriptMs: firstSuccessfulChunk?.latencyMs || null,
      cumulativeTranscriptLength: successfulChunks.reduce((sum, chunk) => sum + (chunk.transcript?.length || 0), 0),
      circuitBroken: Boolean(circuitBreaker?.tripped),
      circuitBreakReason: circuitBreaker?.reason || null,
      skippedChunks: Number(circuitBreaker?.skippedChunks || 0),
    };
  }

  summarizeResult(result = null) {
    if (!result) {
      return null;
    }

    const transcript = result?.data?.normalizedText || result?.data?.rawText || "";
    return {
      success: !!result.success,
      backend: result.backend || result?.data?.metadata?.backend || null,
      model: result.model || result?.data?.metadata?.model || null,
      latencyMs: result.latency || null,
      textLength: transcript.length,
      segmentCount: result?.data?.segments?.length || 0,
      error: result.success ? null : result.error || null,
    };
  }

  async execute(context = {}) {
    const { audioPath, options = {} } = context;
    if (!audioPath) {
      return {
        success: false,
        error: "audioPath is required",
      };
    }

    if (!fs.existsSync(audioPath)) {
      return {
        success: false,
        error: `Audio file not found: ${audioPath}`,
      };
    }

    const absoluteAudioPath = path.resolve(audioPath);
    const mimeType = options.mimeType || this.detectMimeType(absoluteAudioPath);

    // For webm/mp4 files that don't work with the Python decoder, use direct Whisper transcription
    // This skips VAD segmentation and works reliably with browser recordings
    if (mimeType.includes("webm") || mimeType.includes("mp4") || mimeType.includes("mpeg")) {
      this.log("Using direct Whisper transcription for browser format", { mimeType, audioPath });
      try {
        const result = await this.whisperSkill.execute({
          audioPath: absoluteAudioPath,
          mimeType: mimeType,
          language: options.language || this.config.language,
          temperature: options.temperature || this.config.temperature,
        });

        if (result.success && result.data) {
          // Transform Whisper result into the expected format
          const segments = (result.data.segments || []).map((seg, idx) => ({
            chunkIndex: idx,
            startSeconds: parseFloat(seg.startLabel?.replace(":", ".") || "0") || 0,
            endSeconds: parseFloat(seg.endLabel?.replace(":", ".") || "0") || 0,
            startLabel: seg.startLabel || "00:00",
            endLabel: seg.endLabel || "00:00",
            transcript: seg.text || seg.normalizedText || "",
            success: true,
            error: null,
          }));

          return {
            success: true,
            data: {
              ...result.data,
              chunks: segments,
            },
            backend: "whisper_direct",
            model: "whisper-self-hosted",
          };
        } else {
          return {
            success: false,
            error: result.error || "Whisper transcription failed",
            backend: "whisper_direct",
          };
        }
      } catch (error) {
        return {
          success: false,
          error: `Direct Whisper transcription failed: ${error.message}`,
          backend: "whisper_direct",
        };
      }
    }

    // Original flow for wav files - use VAD segmentation
    const workingDir = await fsp.mkdtemp(path.join(os.tmpdir(), "live-conversation-stt-"));
    let preparedAudio = null;

    try {
      preparedAudio = await this.vadTool.loadAudioForAnalysis(absoluteAudioPath);
      const { meta, pcmData, analysisPath } = preparedAudio;
      const chunkPlan = await this.buildChunkPlan(analysisPath, meta, options);

      const medasrPromise = this.runMedASRShadowTranscription(absoluteAudioPath, mimeType, options);
      const diarizationPromise = options.enableSpeakerDiarization
        ? this.runSpeakerDiarization(absoluteAudioPath, mimeType, {
            ...options,
            transcriptHint: options.transcriptHint || "",
          })
        : Promise.resolve(null);

      const chunkRun = await this.runChunkTranscription(chunkPlan, pcmData, meta, workingDir, options);
      const chunks = chunkRun.chunks;
      const chunkSummary = this.buildChunkSummary(chunks, chunkRun.circuitBreaker);

      const [medasrResult, diarization] = await Promise.all([medasrPromise, diarizationPromise]);
      const annotatedChunks = diarization?.segments
        ? this.annotateChunksWithDiarization(chunks, diarization)
        : chunks;
      const annotatedWhisperResult = this.buildChunkTranscriptResult(annotatedChunks, meta, options);
      let whisperFallbackResult = null;
      if (!this.hasUsableTranscriptResult(annotatedWhisperResult) || chunkRun.circuitBreaker?.tripped) {
        whisperFallbackResult = await this.runWholeFileWhisperFallback(absoluteAudioPath, mimeType, {
          ...options,
          fallbackReason: chunkRun.circuitBreaker?.tripped ? "chunk_circuit_broken" : "all_live_chunks_failed",
        });
      }
      const effectiveWhisperResult = this.hasUsableTranscriptResult(whisperFallbackResult)
        ? whisperFallbackResult
        : annotatedWhisperResult;

      let reconciliationResult = {
        success: false,
        error: "No transcript sources available for reconciliation",
        backend: "hybrid",
      };
      if (this.hasUsableTranscriptResult(medasrResult) || this.hasUsableTranscriptResult(effectiveWhisperResult)) {
        reconciliationResult = await this.hybridReconcilerSkill.execute({
          medasrResult,
          whisperResult: effectiveWhisperResult,
          options: { maxRetries: options.hybridMaxRetries ?? 1 },
        });
      }

      let finalTranscriptResult = this.hasUsableTranscriptResult(reconciliationResult) ? reconciliationResult : null;

      if (!finalTranscriptResult) {
        finalTranscriptResult = this.hasUsableTranscriptResult(medasrResult)
          ? medasrResult
          : this.hasUsableTranscriptResult(effectiveWhisperResult)
            ? effectiveWhisperResult
            : null;
      }

      let geminiFallbackResult = null;
      if (!finalTranscriptResult) {
        geminiFallbackResult = await this.runGeminiFallback(absoluteAudioPath, mimeType, options);
        if (this.hasUsableTranscriptResult(geminiFallbackResult)) {
          finalTranscriptResult = {
            ...geminiFallbackResult,
            data: {
              ...geminiFallbackResult.data,
              metadata: {
                ...(geminiFallbackResult.data?.metadata || {}),
                backend: "gemini_fallback",
              },
            },
            backend: "gemini_fallback",
          };
        }
      }

      const failureSummary = this.buildFailureSummary({
        chunks: annotatedChunks,
        chunkCircuit: chunkRun.circuitBreaker,
        chunkedWhisperResult: annotatedWhisperResult,
        whisperFallbackResult,
        medasrResult,
        reconciliationResult,
        geminiFallbackResult,
        diarization,
      });

      const validationResult = options.skipValidation
        ? {
            success: true,
            data: {
              confidence: "medium",
              recommendation: "review",
              summary: "Validation was skipped.",
              preferredSource: finalTranscriptResult?.backend || "merged",
              riskFlags: {
                medicationRisk: "medium",
                orderRisk: "medium",
                speakerAttributionRisk: diarization?.quality?.speakerAmbiguityCount ? "medium" : "low",
              },
              reviewItems: [],
              metadata: { backend: "validation_skipped" },
            },
            backend: "validation_skipped",
          }
        : (finalTranscriptResult || this.hasUsableTranscriptResult(medasrResult) || this.hasUsableTranscriptResult(effectiveWhisperResult))
          ? await this.validationSkill.execute({
              medasrResult,
              whisperResult: effectiveWhisperResult,
              mergedResult: finalTranscriptResult,
              diarization,
              chunkSummary,
            })
          : {
              success: true,
              data: {
                confidence: "low",
                recommendation: "reject",
                summary: failureSummary,
                preferredSource: null,
                riskFlags: {
                  medicationRisk: "high",
                  orderRisk: "high",
                  speakerAttributionRisk: diarization?.error ? "high" : "medium",
                },
                reviewItems: [
                  {
                    id: "review_no_transcript",
                    title: "No transcript source succeeded",
                    severity: "high",
                    source: "pipeline",
                    reason: failureSummary,
                    snippet: "",
                    resolutionHint: "Check remote STT providers and rerun the session before using this record clinically.",
                  },
                ],
                metadata: {
                  backend: "validation_no_transcript",
                },
              },
              backend: "validation_no_transcript",
            };

      const pipelineSucceeded = Boolean(finalTranscriptResult);

      const report = {
        generatedAt: new Date().toISOString(),
        audioPath: absoluteAudioPath,
        mimeType,
        pipeline: {
          primaryLiveTranscript: this.hasUsableTranscriptResult(whisperFallbackResult)
            ? "whisper_fullfile_fallback"
            : "whisper_chunked_live",
          medicalShadowTranscript: "medasr",
          reconciliation: "gemma_hybrid_reconciler",
          validation: validationResult.backend,
          diarization: diarization?.backend || (options.enableSpeakerDiarization ? "unresolved" : "disabled"),
          geminiFallbackEnabled: this.config.enableGeminiFallback || options.enableGeminiFallback || false,
        },
        mode: chunkPlan.mode,
        windowSeconds: this.resolveWindowSeconds(options),
        hopSeconds: this.resolveHopSeconds(options),
        durationSeconds: meta.durationSeconds,
        vad: chunkPlan.analysis,
        summary: {
          ...chunkSummary,
          chunkSuccessRatio: chunkSummary.totalChunks > 0
            ? Number((chunkSummary.successfulChunks / chunkSummary.totalChunks).toFixed(2))
            : 0,
          chunkFallbackUsed: this.hasUsableTranscriptResult(whisperFallbackResult),
          chunkCircuitBroken: chunkSummary.circuitBroken,
          chunkCircuitReason: chunkSummary.circuitBreakReason,
          firstFailedChunkError: annotatedChunks.find((chunk) => !chunk.success)?.error || null,
          effectiveWhisperBackend: effectiveWhisperResult?.backend || null,
          finalTranscriptBackend: finalTranscriptResult?.backend || null,
          validationRecommendation: validationResult?.data?.recommendation || null,
          validationConfidence: validationResult?.data?.confidence || null,
        },
        chunks: annotatedChunks,
        diarization,
        sourceTranscripts: {
          whisperChunked: this.summarizeResult(annotatedWhisperResult),
          whisperFallback: this.summarizeResult(whisperFallbackResult),
          medasr: this.summarizeResult(medasrResult),
          merged: this.summarizeResult(finalTranscriptResult),
        },
        validation: validationResult?.data || null,
        cumulativeTranscript: effectiveWhisperResult?.data?.normalizedText || "",
        finalTranscript: finalTranscriptResult?.data || null,
      };

      if (!options.keepChunks) {
        await fsp.rm(workingDir, { recursive: true, force: true });
      }
      try {
        await preparedAudio.cleanup?.();
      } catch {}

      return {
        success: pipelineSucceeded,
        data: report,
        backend: finalTranscriptResult?.backend || annotatedWhisperResult?.backend || medasrResult?.backend || null,
        error: pipelineSucceeded ? null : failureSummary,
      };
    } catch (error) {
      if (!options.keepChunks) {
        await fsp.rm(workingDir, { recursive: true, force: true });
      }
      try {
        await preparedAudio?.cleanup?.();
      } catch {}

      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }
}

module.exports = LiveConversationSTTAgent;
