/**
 * Live conversation STT simulation using chunked Whisper, MedASR shadow
 * transcription, optional speaker diarization, and Gemma validation.
 *
 * Supports two chunking modes:
 * - sequential fixed windows
 * - local energy-based VAD segmentation
 *
 * Usage:
 *   node scripts/test_live_whisper_simulation.cjs tests/fixtures/audio/ESL+pain+mgmt+sample.wav
 *   node scripts/test_live_whisper_simulation.cjs tests/fixtures/audio/ESL+pain+mgmt+sample.wav --window-seconds 15 --hop-seconds 15 --keep-chunks
 *   node scripts/test_live_whisper_simulation.cjs tests/fixtures/audio/ESL-Cardio-sample.wav --vad --window-seconds 20 --diarize --diarization-provider pyannote --allow-diarization-fallback
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const LiveConversationSTTAgent = require("../agents/live_conversation_stt_agent.cjs");
const VADSegmentationTool = require("../tools/audio/vad_segmentation.tool.cjs");

function parseArgs(argv) {
  const args = {
    audioPath: null,
    windowSeconds: 15,
    hopSeconds: 15,
    keepChunks: false,
    out: null,
    vadMode: "none",
    diarize: false,
    frameMs: 30,
    minSpeechMs: 300,
    minSilenceMs: 350,
    preRollMs: 120,
    postRollMs: 220,
    mergeGapMs: 250,
    diarizationProvider: undefined,
    allowDiarizationFallback: false,
    enableGeminiFallback: false,
    skipValidation: false,
    pyannotePythonBin: undefined,
    pyannoteModelDir: undefined,
    pyannoteAllowOnlineBootstrap: false,
    pyannoteDevice: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!args.audioPath && !current.startsWith("--")) {
      args.audioPath = current;
      continue;
    }
    if (current === "--window-seconds") {
      args.windowSeconds = Number(argv[index + 1] || args.windowSeconds);
      index += 1;
      continue;
    }
    if (current === "--hop-seconds") {
      args.hopSeconds = Number(argv[index + 1] || args.hopSeconds);
      index += 1;
      continue;
    }
    if (current === "--out") {
      args.out = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (current === "--keep-chunks") {
      args.keepChunks = true;
      continue;
    }
    if (current === "--vad-mode") {
      args.vadMode = argv[index + 1] || args.vadMode;
      index += 1;
      continue;
    }
    if (current === "--vad") {
      args.vadMode = "energy";
      continue;
    }
    if (current === "--diarize") {
      args.diarize = true;
      continue;
    }
    if (current === "--diarization-provider") {
      args.diarizationProvider = argv[index + 1] || args.diarizationProvider;
      index += 1;
      continue;
    }
    if (current === "--allow-diarization-fallback") {
      args.allowDiarizationFallback = true;
      continue;
    }
    if (current === "--allow-gemini-fallback") {
      args.enableGeminiFallback = true;
      continue;
    }
    if (current === "--python-bin") {
      args.pyannotePythonBin = argv[index + 1] || args.pyannotePythonBin;
      index += 1;
      continue;
    }
    if (current === "--model-dir") {
      args.pyannoteModelDir = argv[index + 1] || args.pyannoteModelDir;
      index += 1;
      continue;
    }
    if (current === "--allow-online-bootstrap") {
      args.pyannoteAllowOnlineBootstrap = true;
      continue;
    }
    if (current === "--device") {
      args.pyannoteDevice = argv[index + 1] || args.pyannoteDevice;
      index += 1;
      continue;
    }
    if (current === "--skip-validation") {
      args.skipValidation = true;
      continue;
    }
    if (current === "--frame-ms") {
      args.frameMs = Number(argv[index + 1] || args.frameMs);
      index += 1;
      continue;
    }
    if (current === "--min-speech-ms") {
      args.minSpeechMs = Number(argv[index + 1] || args.minSpeechMs);
      index += 1;
      continue;
    }
    if (current === "--min-silence-ms") {
      args.minSilenceMs = Number(argv[index + 1] || args.minSilenceMs);
      index += 1;
      continue;
    }
    if (current === "--pre-roll-ms") {
      args.preRollMs = Number(argv[index + 1] || args.preRollMs);
      index += 1;
      continue;
    }
    if (current === "--post-roll-ms") {
      args.postRollMs = Number(argv[index + 1] || args.postRollMs);
      index += 1;
      continue;
    }
    if (current === "--merge-gap-ms") {
      args.mergeGapMs = Number(argv[index + 1] || args.mergeGapMs);
      index += 1;
      continue;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.audioPath) {
    console.error("Usage: node scripts/test_live_whisper_simulation.cjs <wav-file> [--window-seconds N] [--hop-seconds N] [--vad | --vad-mode energy] [--keep-chunks]");
    process.exit(1);
  }

  if (!fs.existsSync(args.audioPath)) {
    console.error(`[LiveSim] Audio file not found: ${args.audioPath}`);
    process.exit(1);
  }

  const absoluteAudioPath = path.resolve(args.audioPath);
  const tool = new VADSegmentationTool();
  const preparedAudio = await tool.loadAudioForAnalysis(absoluteAudioPath);
  const { meta } = preparedAudio;
  const agent = new LiveConversationSTTAgent({
    enableGeminiFallback: args.enableGeminiFallback,
    diarizationProvider: args.diarizationProvider,
    allowDiarizationFallback: args.allowDiarizationFallback,
    pyannotePythonBin: args.pyannotePythonBin,
    pyannoteModelDir: args.pyannoteModelDir,
    pyannoteAllowOnlineBootstrap: args.pyannoteAllowOnlineBootstrap,
    pyannoteDevice: args.pyannoteDevice,
  });

  console.log("[LiveSim] Live conversation pipeline simulation");
  console.log(`[LiveSim] Audio: ${absoluteAudioPath}`);
  console.log(`[LiveSim] Duration: ${meta.durationSeconds.toFixed(2)}s`);
  console.log(`[LiveSim] Mode: ${args.vadMode === "energy" ? "energy_vad" : "fixed_window_no_vad"}`);
  console.log(`[LiveSim] Max chunk window: ${args.windowSeconds}s`);
  if (args.vadMode !== "energy") {
    console.log(`[LiveSim] Hop: ${args.hopSeconds}s`);
  } else {
    console.log(`[LiveSim] VAD frame: ${args.frameMs}ms`);
    console.log(`[LiveSim] VAD min speech: ${args.minSpeechMs}ms`);
    console.log(`[LiveSim] VAD min silence: ${args.minSilenceMs}ms`);
  }
  if (args.diarize) {
    console.log(`[LiveSim] Diarization provider: ${args.diarizationProvider || process.env.SPEAKER_DIARIZATION_PROVIDER || "pyannote"}`);
    console.log(`[LiveSim] Diarization fallback: ${args.allowDiarizationFallback ? "enabled" : "disabled"}`);
  }
  console.log(`[LiveSim] Validation: ${args.skipValidation ? "skipped" : "enabled"}`);
  console.log("");

  let result;
  try {
    result = await agent.execute({
      audioPath: absoluteAudioPath,
      options: {
        mode: args.vadMode === "energy" ? "energy_vad" : "fixed_window_no_vad",
        windowSeconds: args.windowSeconds,
        hopSeconds: args.hopSeconds,
        keepChunks: args.keepChunks,
        enableSpeakerDiarization: args.diarize,
        diarizationProvider: args.diarizationProvider,
        allowDiarizationFallback: args.allowDiarizationFallback,
        enableGeminiFallback: args.enableGeminiFallback,
        skipValidation: args.skipValidation,
        frameMs: args.frameMs,
        minSpeechMs: args.minSpeechMs,
        minSilenceMs: args.minSilenceMs,
        preRollMs: args.preRollMs,
        postRollMs: args.postRollMs,
        mergeGapMs: args.mergeGapMs,
      },
    });
  } finally {
    try {
      await preparedAudio.cleanup?.();
    } catch {}
  }

  if (!result.success) {
    console.error(`[LiveSim] Failed: ${result.error}`);
    process.exit(1);
  }

  const report = result.data;

  const outputPath = args.out || path.join("tests", "results", `live_whisper_sim_${Date.now()}.json`);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(report, null, 2));

  for (const chunk of report.chunks) {
    console.log(
      `[LiveSim] Chunk ${chunk.chunkIndex} ${chunk.startLabel}-${chunk.endLabel} | ${chunk.success ? "PASS" : "FAIL"} | ${chunk.latencyMs}ms | ${chunk.textLength} chars${chunk.speakerLabel ? ` | ${chunk.speakerLabel}` : ""}`,
    );
  }

  console.log("");
  console.log(`[LiveSim] Report written to ${outputPath}`);
  console.log(`[LiveSim] Cumulative transcript length: ${report.cumulativeTranscript.length} chars`);
  if (report.sourceTranscripts?.medasr) {
    console.log(`[LiveSim] MedASR shadow: ${report.sourceTranscripts.medasr.success ? "PASS" : "FAIL"} | ${report.sourceTranscripts.medasr.latencyMs || 0}ms`);
  }
  if (report.sourceTranscripts?.merged) {
    console.log(`[LiveSim] Final transcript backend: ${report.sourceTranscripts.merged.backend || "unknown"}`);
  }
  if (report.diarization?.speakers) {
    console.log(`[LiveSim] Diarization speakers: ${report.diarization.speakers.length}`);
  }
  if (report.validation) {
    console.log(`[LiveSim] Validation: ${report.validation.recommendation} | ${report.validation.confidence}`);
    console.log(`[LiveSim] Review items: ${Array.isArray(report.validation.reviewItems) ? report.validation.reviewItems.length : 0}`);
  }
}

main().catch((error) => {
  console.error("[LiveSim] Uncaught error:", error);
  process.exit(1);
});
