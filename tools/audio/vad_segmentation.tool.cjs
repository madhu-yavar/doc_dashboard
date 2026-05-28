const fsSync = require("fs");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

class VADSegmentationTool {
  constructor(config = {}) {
    this.name = "VAD Segmentation Tool";
    this.version = "1.0.0";
    this.debug = config.debug || false;
    const bundledPython = path.join(process.cwd(), ".venv-pyannote", "bin", "python3.11");
    this.pythonBin = config.pythonBin || process.env.PYANNOTE_PYTHON_BIN || (fsSync.existsSync(bundledPython) ? bundledPython : "python3");
  }

  log(message, data = {}) {
    if (this.debug) {
      console.log(`[VADTool] ${message}`, data);
    }
  }

  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  percentile(sortedValues, p) {
    if (!sortedValues.length) {
      return 0;
    }
    if (sortedValues.length === 1) {
      return sortedValues[0];
    }

    const index = this.clamp((sortedValues.length - 1) * p, 0, sortedValues.length - 1);
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.ceil(index);

    if (lowerIndex === upperIndex) {
      return sortedValues[lowerIndex];
    }

    const lower = sortedValues[lowerIndex];
    const upper = sortedValues[upperIndex];
    return lower + (upper - lower) * (index - lowerIndex);
  }

  isRiffWav(buffer) {
    return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE";
  }

  async transcodeAudioToWav(sourcePath, outputPath) {
    const helperPath = path.join(__dirname, "decode_audio_to_wav.py");
    const { stdout } = await execFileAsync(
      this.pythonBin,
      [
        helperPath,
        "--audio-path",
        sourcePath,
        "--out-path",
        outputPath,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 1024 * 1024 * 8,
      },
    );

    const payload = JSON.parse(String(stdout || "{}").trim() || "{}");
    if (!payload.success) {
      throw new Error(payload.error || "Audio decode helper failed");
    }
    return payload;
  }

  readWavMetadata(buffer) {
    if (!this.isRiffWav(buffer)) {
      throw new Error("Only RIFF/WAVE files are supported.");
    }

    let offset = 12;
    let fmt = null;
    let data = null;

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkSize;

      if (chunkId === "fmt ") {
        fmt = {
          audioFormat: buffer.readUInt16LE(chunkStart),
          numChannels: buffer.readUInt16LE(chunkStart + 2),
          sampleRate: buffer.readUInt32LE(chunkStart + 4),
          byteRate: buffer.readUInt32LE(chunkStart + 8),
          blockAlign: buffer.readUInt16LE(chunkStart + 12),
          bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
        };
      }

      if (chunkId === "data") {
        data = {
          offset: chunkStart,
          size: chunkSize,
        };
      }

      offset = chunkEnd + (chunkSize % 2);
    }

    if (!fmt || !data) {
      throw new Error("WAV file is missing fmt or data chunk.");
    }

    return {
      ...fmt,
      dataOffset: data.offset,
      dataSize: data.size,
      durationSeconds: data.size / fmt.byteRate,
    };
  }

  assertEnergyVadSupport(meta) {
    const supportedPcmFormats = new Set([1, 3]);
    if (!supportedPcmFormats.has(meta.audioFormat)) {
      throw new Error(`Energy VAD currently supports PCM/float WAV only. Found audioFormat=${meta.audioFormat}.`);
    }

    const supportedBits = new Set([8, 16, 24, 32]);
    if (!supportedBits.has(meta.bitsPerSample)) {
      throw new Error(`Energy VAD does not support ${meta.bitsPerSample}-bit WAV yet.`);
    }
  }

  alignByteCount(byteCount, blockAlign) {
    return Math.max(blockAlign, Math.floor(byteCount / blockAlign) * blockAlign);
  }

  buildPcmWavBuffer(meta, pcmData) {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, 4, "ascii");
    header.writeUInt32LE(36 + pcmData.length, 4);
    header.write("WAVE", 8, 4, "ascii");
    header.write("fmt ", 12, 4, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(meta.audioFormat, 20);
    header.writeUInt16LE(meta.numChannels, 22);
    header.writeUInt32LE(meta.sampleRate, 24);
    header.writeUInt32LE(meta.byteRate, 28);
    header.writeUInt16LE(meta.blockAlign, 32);
    header.writeUInt16LE(meta.bitsPerSample, 34);
    header.write("data", 36, 4, "ascii");
    header.writeUInt32LE(pcmData.length, 40);
    return Buffer.concat([header, pcmData]);
  }

  formatSeconds(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  frameIndexToByteOffset(meta, frameIndex) {
    return frameIndex * meta.blockAlign;
  }

  async prepareAudioForAnalysis(audioPath) {
    const sourcePath = path.resolve(audioPath);
    const buffer = await fs.readFile(sourcePath);

    if (this.isRiffWav(buffer)) {
      return {
        sourcePath,
        analysisPath: sourcePath,
        buffer,
        transcoded: false,
        cleanup: async () => {},
      };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-audio-analysis-"));
    const analysisPath = path.join(
      tempDir,
      `${path.basename(sourcePath, path.extname(sourcePath))}.wav`,
    );
    await this.transcodeAudioToWav(sourcePath, analysisPath);

    return {
      sourcePath,
      analysisPath,
      buffer: await fs.readFile(analysisPath),
      transcoded: true,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  }

  async loadAudioForAnalysis(audioPath) {
    const prepared = await this.prepareAudioForAnalysis(audioPath);
    const meta = this.readWavMetadata(prepared.buffer);
    return {
      ...prepared,
      meta,
      pcmData: prepared.buffer.subarray(meta.dataOffset, meta.dataOffset + meta.dataSize),
    };
  }

  async loadWavAudio(audioPath) {
    return this.loadAudioForAnalysis(audioPath);
  }

  readNormalizedSample(buffer, offset, meta) {
    if (meta.audioFormat === 3 && meta.bitsPerSample === 32) {
      return this.clamp(buffer.readFloatLE(offset), -1, 1);
    }

    switch (meta.bitsPerSample) {
      case 8:
        return (buffer.readUInt8(offset) - 128) / 128;
      case 16:
        return buffer.readInt16LE(offset) / 32768;
      case 24:
        return buffer.readIntLE(offset, 3) / 8388608;
      case 32:
        return buffer.readInt32LE(offset) / 2147483648;
      default:
        throw new Error(`Unsupported sample depth for energy VAD: ${meta.bitsPerSample}`);
    }
  }

  computeFrameRms(pcmData, meta, startFrame, endFrame) {
    const bytesPerSample = meta.bitsPerSample / 8;
    let sumSquares = 0;
    let sampleCount = 0;

    for (let frameIndex = startFrame; frameIndex < endFrame; frameIndex += 1) {
      const frameOffset = this.frameIndexToByteOffset(meta, frameIndex);
      for (let channelIndex = 0; channelIndex < meta.numChannels; channelIndex += 1) {
        const sampleOffset = frameOffset + channelIndex * bytesPerSample;
        if (sampleOffset + bytesPerSample > pcmData.length) {
          break;
        }
        const sample = this.readNormalizedSample(pcmData, sampleOffset, meta);
        sumSquares += sample * sample;
        sampleCount += 1;
      }
    }

    if (!sampleCount) {
      return 0;
    }

    return Math.sqrt(sumSquares / sampleCount);
  }

  mergeSegments(segments, mergeGapFrames) {
    if (!segments.length) {
      return [];
    }

    const merged = [segments[0]];
    for (let index = 1; index < segments.length; index += 1) {
      const current = segments[index];
      const previous = merged[merged.length - 1];

      if (current.startFrame - previous.endFrame <= mergeGapFrames) {
        previous.endFrame = Math.max(previous.endFrame, current.endFrame);
        continue;
      }

      merged.push({ ...current });
    }

    return merged;
  }

  splitLongSegments(segments, maxSegmentFrames) {
    if (!Number.isFinite(maxSegmentFrames) || maxSegmentFrames <= 0) {
      return segments;
    }

    const split = [];
    for (const segment of segments) {
      let startFrame = segment.startFrame;
      while (startFrame < segment.endFrame) {
        const endFrame = Math.min(segment.endFrame, startFrame + maxSegmentFrames);
        split.push({ startFrame, endFrame });
        startFrame = endFrame;
      }
    }
    return split;
  }

  segmentSpeechByEnergy(pcmData, meta, options = {}) {
    const frameMs = options.frameMs ?? 30;
    const minSpeechMs = options.minSpeechMs ?? 300;
    const minSilenceMs = options.minSilenceMs ?? 350;
    const preRollMs = options.preRollMs ?? 120;
    const postRollMs = options.postRollMs ?? 220;
    const mergeGapMs = options.mergeGapMs ?? 250;
    const maxSegmentMs = options.maxSegmentMs ?? null;
    const minEnergy = options.minEnergy ?? 0.008;
    const speechMultiplier = options.speechMultiplier ?? 3;
    const releaseFactor = options.releaseFactor ?? 0.65;

    const totalFrames = Math.floor(pcmData.length / meta.blockAlign);
    const analysisFramesPerWindow = Math.max(1, Math.round((meta.sampleRate * frameMs) / 1000));
    const analysisFrameCount = Math.ceil(totalFrames / analysisFramesPerWindow);
    const frameEnergies = [];

    for (let analysisIndex = 0; analysisIndex < analysisFrameCount; analysisIndex += 1) {
      const startFrame = analysisIndex * analysisFramesPerWindow;
      const endFrame = Math.min(totalFrames, startFrame + analysisFramesPerWindow);
      frameEnergies.push(this.computeFrameRms(pcmData, meta, startFrame, endFrame));
    }

    const sortedEnergies = [...frameEnergies].sort((a, b) => a - b);
    const noiseFloor = this.percentile(sortedEnergies, 0.2);
    const medianEnergy = this.percentile(sortedEnergies, 0.5);
    const peakEnergy = this.percentile(sortedEnergies, 0.95);
    const enterThreshold = Math.max(minEnergy, noiseFloor * speechMultiplier);
    const continueThreshold = Math.max(minEnergy * 0.8, enterThreshold * releaseFactor);

    const minSpeechFrames = Math.max(1, Math.ceil(minSpeechMs / frameMs));
    const minSilenceFrames = Math.max(1, Math.ceil(minSilenceMs / frameMs));
    const preRollFrames = Math.round((preRollMs / 1000) * meta.sampleRate);
    const postRollFrames = Math.round((postRollMs / 1000) * meta.sampleRate);
    const mergeGapFrames = Math.round((mergeGapMs / 1000) * meta.sampleRate);
    const maxSegmentFrames = Number.isFinite(maxSegmentMs) ? Math.round((maxSegmentMs / 1000) * meta.sampleRate) : null;

    const rawSegments = [];
    let inSpeech = false;
    let speechStartIndex = 0;
    let lastActiveIndex = 0;
    let silenceRun = 0;

    for (let analysisIndex = 0; analysisIndex < frameEnergies.length; analysisIndex += 1) {
      const energy = frameEnergies[analysisIndex];

      if (!inSpeech) {
        if (energy >= enterThreshold) {
          inSpeech = true;
          speechStartIndex = analysisIndex;
          lastActiveIndex = analysisIndex;
          silenceRun = 0;
        }
        continue;
      }

      if (energy >= continueThreshold) {
        lastActiveIndex = analysisIndex;
        silenceRun = 0;
        continue;
      }

      silenceRun += 1;
      if (silenceRun >= minSilenceFrames) {
        rawSegments.push({
          startAnalysisIndex: speechStartIndex,
          endAnalysisIndex: lastActiveIndex + 1,
        });
        inSpeech = false;
        silenceRun = 0;
      }
    }

    if (inSpeech) {
      rawSegments.push({
        startAnalysisIndex: speechStartIndex,
        endAnalysisIndex: lastActiveIndex + 1,
      });
    }

    const paddedSegments = rawSegments
      .map((segment) => {
        const startFrame = Math.max(0, segment.startAnalysisIndex * analysisFramesPerWindow - preRollFrames);
        const endFrame = Math.min(totalFrames, segment.endAnalysisIndex * analysisFramesPerWindow + postRollFrames);
        return { startFrame, endFrame };
      })
      .filter((segment) => segment.endFrame - segment.startFrame >= minSpeechFrames * analysisFramesPerWindow);

    const mergedSegments = this.mergeSegments(paddedSegments, mergeGapFrames);
    const splitSegments = this.splitLongSegments(mergedSegments, maxSegmentFrames);

    let fallbackUsed = false;
    const segments = splitSegments.length
      ? splitSegments
      : (() => {
          fallbackUsed = true;
          return totalFrames > 0 ? [{ startFrame: 0, endFrame: totalFrames }] : [];
        })();

    const finalizedSegments = segments.map((segment, index) => {
      const startByte = this.frameIndexToByteOffset(meta, segment.startFrame);
      const endByte = this.frameIndexToByteOffset(meta, segment.endFrame);
      const startSeconds = segment.startFrame / meta.sampleRate;
      const endSeconds = segment.endFrame / meta.sampleRate;

      return {
        segmentIndex: index,
        startFrame: segment.startFrame,
        endFrame: segment.endFrame,
        startByte,
        endByte,
        startSeconds,
        endSeconds,
        durationSeconds: endSeconds - startSeconds,
      };
    });

    const totalSpeechSeconds = finalizedSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0);

    return {
      segments: finalizedSegments,
      analysis: {
        mode: "energy",
        frameMs,
        analysisFrameCount,
        noiseFloor,
        medianEnergy,
        peakEnergy,
        enterThreshold,
        continueThreshold,
        minSpeechMs,
        minSilenceMs,
        preRollMs,
        postRollMs,
        mergeGapMs,
        maxSegmentMs: Number.isFinite(maxSegmentMs) ? maxSegmentMs : null,
        fallbackUsed,
        totalSpeechSeconds,
        speechCoverageRatio: meta.durationSeconds > 0 ? totalSpeechSeconds / meta.durationSeconds : 0,
      },
    };
  }

  async execute(context = {}) {
    const { audioPath, options = {} } = context;
    if (!audioPath) {
      throw new Error("audioPath is required");
    }

    const preparedAudio = await this.loadAudioForAnalysis(audioPath);
    try {
      const { meta, pcmData } = preparedAudio;
      this.assertEnergyVadSupport(meta);

      const { segments, analysis } = this.segmentSpeechByEnergy(pcmData, meta, options);

      return {
        audioPath,
        analysisAudioPath: preparedAudio.analysisPath,
        audio: {
          sampleRate: meta.sampleRate,
          numChannels: meta.numChannels,
          bitsPerSample: meta.bitsPerSample,
          audioFormat: meta.audioFormat,
          durationSeconds: meta.durationSeconds,
          transcodedForAnalysis: preparedAudio.transcoded,
        },
        segments,
        analysis,
      };
    } finally {
      try {
        await preparedAudio.cleanup?.();
      } catch {}
    }
  }
}

module.exports = VADSegmentationTool;
