/**
 * Local VAD segmentation report for PCM WAV audio.
 *
 * Usage:
 *   node scripts/test_vad_segmentation.cjs tests/fixtures/audio/ESL-Cardio-sample.wav
 *   node scripts/test_vad_segmentation.cjs tests/fixtures/audio/ESL-Cardio-sample.wav --window-seconds 20
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const VADSegmentationSkill = require("../skills/stt/vad_segmentation_skill.cjs");
const VADSegmentationTool = require("../tools/audio/vad_segmentation.tool.cjs");

function parseArgs(argv) {
  const args = {
    audioPath: null,
    out: null,
    windowSeconds: 20,
    frameMs: 30,
    minSpeechMs: 300,
    minSilenceMs: 350,
    preRollMs: 120,
    postRollMs: 220,
    mergeGapMs: 250,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!args.audioPath && !current.startsWith("--")) {
      args.audioPath = current;
      continue;
    }
    if (current === "--out") {
      args.out = argv[index + 1] || args.out;
      index += 1;
      continue;
    }
    if (current === "--window-seconds") {
      args.windowSeconds = Number(argv[index + 1] || args.windowSeconds);
      index += 1;
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
    console.error("Usage: node scripts/test_vad_segmentation.cjs <wav-file> [--window-seconds N]");
    process.exit(1);
  }

  if (!fs.existsSync(args.audioPath)) {
    console.error(`[VAD] Audio file not found: ${args.audioPath}`);
    process.exit(1);
  }

  const absoluteAudioPath = path.resolve(args.audioPath);
  const tool = new VADSegmentationTool();
  const skill = new VADSegmentationSkill({ tool });
  const result = await skill.execute({
    audioPath: absoluteAudioPath,
    options: {
      frameMs: args.frameMs,
      minSpeechMs: args.minSpeechMs,
      minSilenceMs: args.minSilenceMs,
      preRollMs: args.preRollMs,
      postRollMs: args.postRollMs,
      mergeGapMs: args.mergeGapMs,
      maxSegmentMs: args.windowSeconds * 1000,
    },
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  const { audio, segments, analysis } = result.data;

  const report = {
    generatedAt: new Date().toISOString(),
    audioPath: absoluteAudioPath,
    durationSeconds: audio.durationSeconds,
    audio: {
      sampleRate: audio.sampleRate,
      channels: audio.numChannels,
      bitsPerSample: audio.bitsPerSample,
      audioFormat: audio.audioFormat,
    },
    vad: analysis,
    segments,
  };

  const outputPath = args.out || path.join("tests", "results", `vad_segments_${Date.now()}.json`);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(report, null, 2));

  console.log("[VAD] Segmentation summary");
  console.log(`[VAD] Audio: ${absoluteAudioPath}`);
  console.log(`[VAD] Duration: ${audio.durationSeconds.toFixed(2)}s`);
  console.log(`[VAD] Segments: ${segments.length}`);
  console.log(`[VAD] Speech coverage: ${(analysis.speechCoverageRatio * 100).toFixed(1)}%`);
  console.log(`[VAD] Threshold: ${analysis.enterThreshold.toFixed(4)} (continue ${analysis.continueThreshold.toFixed(4)})`);
  console.log("");

  for (const segment of segments) {
    console.log(
      `[VAD] Segment ${segment.segmentIndex} ${tool.formatSeconds(segment.startSeconds)}-${tool.formatSeconds(segment.endSeconds)} | ${segment.durationSeconds.toFixed(2)}s`,
    );
  }

  console.log("");
  console.log(`[VAD] Report written to ${outputPath}`);
}

main().catch((error) => {
  console.error("[VAD] Uncaught error:", error);
  process.exit(1);
});
