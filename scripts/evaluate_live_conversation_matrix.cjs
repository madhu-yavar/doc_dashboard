/**
 * Batch evaluator for live-conversation audio using direct STT baselines plus
 * live-style chunking variants.
 *
 * Usage:
 *   node scripts/evaluate_live_conversation_matrix.cjs --dir tests/fixtures/audio/audio_recordings/Audio_Recordings --limit 10
 *   node scripts/evaluate_live_conversation_matrix.cjs --variants whisper_direct,medasr_direct,live_vad_diarized
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const WhisperSTTSkill = require("../skills/stt/whisper_stt_skill.cjs");
const MedASRSTTSkill = require("../skills/stt/medasr_stt_skill.cjs");
const LiveConversationSTTAgent = require("../agents/live_conversation_stt_agent.cjs");

const DEFAULT_DIR = "tests/fixtures/audio/audio_recordings/Audio_Recordings";
const DEFAULT_VARIANTS = [
  "whisper_direct",
  "medasr_direct",
  "live_fixed",
  "live_vad",
  "live_vad_diarized",
];
const SUPPORTED_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".webm"]);

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".webm") return "audio/webm";
  return "application/octet-stream";
}

function parseArgs(argv) {
  const args = {
    dir: DEFAULT_DIR,
    limit: 10,
    out: null,
    csv: null,
    windowSeconds: 20,
    hopSeconds: 20,
    variants: [...DEFAULT_VARIANTS],
    diarizationProvider: process.env.SPEAKER_DIARIZATION_PROVIDER || "pyannote",
    allowDiarizationFallback: process.env.SPEAKER_DIARIZATION_ALLOW_FALLBACK === "true",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--dir") {
      args.dir = argv[index + 1] || args.dir;
      index += 1;
      continue;
    }
    if (current === "--limit") {
      args.limit = Number(argv[index + 1] || args.limit);
      index += 1;
      continue;
    }
    if (current === "--out") {
      args.out = argv[index + 1] || args.out;
      index += 1;
      continue;
    }
    if (current === "--csv") {
      args.csv = argv[index + 1] || args.csv;
      index += 1;
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
    if (current === "--variants") {
      args.variants = String(argv[index + 1] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      index += 1;
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
  }

  return args;
}

async function listAudioFiles(dir, limit) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((filePath) => SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
}

function transcriptFromResult(result) {
  return (
    result?.data?.normalizedText ||
    result?.data?.rawText ||
    result?.rawText ||
    ""
  );
}

async function runVariant({ filePath, mimeType, variant, whisper, medasr, liveAgent, args }) {
  const startedAt = Date.now();

  try {
    if (variant === "whisper_direct") {
      const result = await whisper.execute({ audioPath: filePath, mimeType });
      return {
        variant,
        success: !!result.success,
        latencyMs: Date.now() - startedAt,
        transcriptLength: transcriptFromResult(result).length,
        backend: result.backend || result?.data?.metadata?.backend || "whisper",
        model: result.model || result?.data?.metadata?.model || null,
        durationSeconds: result?.data?.metadata?.audioDuration || null,
        reviewItemCount: 0,
        error: result.success ? null : result.error || "Unknown failure",
      };
    }

    if (variant === "medasr_direct") {
      const result = await medasr.execute({ audioPath: filePath, mimeType });
      return {
        variant,
        success: !!result.success,
        latencyMs: Date.now() - startedAt,
        transcriptLength: transcriptFromResult(result).length,
        backend: result.backend || result?.data?.metadata?.backend || "medasr",
        model: result.model || result?.data?.metadata?.model || null,
        durationSeconds: result?.data?.metadata?.audioDuration || null,
        reviewItemCount: 0,
        error: result.success ? null : result.error || "Unknown failure",
      };
    }

    const liveOptions = {
      windowSeconds: args.windowSeconds,
      hopSeconds: args.hopSeconds,
      enableGeminiFallback: false,
      diarizationProvider: args.diarizationProvider,
      allowDiarizationFallback: args.allowDiarizationFallback,
    };

    if (variant === "live_fixed") {
      Object.assign(liveOptions, {
        mode: "fixed_window_no_vad",
        enableSpeakerDiarization: false,
        skipValidation: true,
      });
    } else if (variant === "live_vad") {
      Object.assign(liveOptions, {
        mode: "energy_vad",
        enableSpeakerDiarization: false,
        skipValidation: true,
      });
    } else if (variant === "live_vad_diarized") {
      Object.assign(liveOptions, {
        mode: "energy_vad",
        enableSpeakerDiarization: true,
        skipValidation: false,
      });
    } else {
      throw new Error(`Unsupported variant: ${variant}`);
    }

    const result = await liveAgent.execute({
      audioPath: filePath,
      options: liveOptions,
    });

    const report = result.data || {};
    return {
      variant,
      success: !!result.success,
      latencyMs: Date.now() - startedAt,
      transcriptLength: String(report.cumulativeTranscript || report.finalTranscript?.normalizedText || "").length,
      backend: report.summary?.finalTranscriptBackend || result.backend || null,
      model: report.sourceTranscripts?.merged?.model || null,
      durationSeconds: report.durationSeconds || null,
      chunkMode: report.mode || null,
      totalChunks: report.summary?.totalChunks || 0,
      successfulChunks: report.summary?.successfulChunks || 0,
      failedChunks: report.summary?.failedChunks || 0,
      timeToFirstTranscriptMs: report.summary?.timeToFirstTranscriptMs || null,
      averageChunkLatencyMs: report.summary?.averageLatencyMs || null,
      validationRecommendation: report.summary?.validationRecommendation || null,
      validationConfidence: report.summary?.validationConfidence || null,
      reviewItemCount: Array.isArray(report.validation?.reviewItems) ? report.validation.reviewItems.length : 0,
      diarizationBackend: report.diarization?.backend || (liveOptions.enableSpeakerDiarization ? "unresolved" : "disabled"),
      speakerCount: Array.isArray(report.diarization?.speakers) ? report.diarization.speakers.length : 0,
      error: result.success ? null : result.error || "Unknown failure",
    };
  } catch (error) {
    return {
      variant,
      success: false,
      latencyMs: Date.now() - startedAt,
      transcriptLength: 0,
      backend: null,
      model: null,
      durationSeconds: null,
      reviewItemCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeFileResults(filePath, rows) {
  const primaryLive = rows.find((row) => row.variant === "live_vad_diarized")
    || rows.find((row) => row.variant === "live_vad")
    || rows.find((row) => row.variant === "live_fixed")
    || null;

  return {
    fileName: path.basename(filePath),
    filePath,
    directWhisperOk: !!rows.find((row) => row.variant === "whisper_direct" && row.success),
    directMedasrOk: !!rows.find((row) => row.variant === "medasr_direct" && row.success),
    primaryLiveOk: !!primaryLive?.success,
    primaryLiveVariant: primaryLive?.variant || null,
    primaryLiveBackend: primaryLive?.backend || null,
    primaryLiveRecommendation: primaryLive?.validationRecommendation || null,
    primaryLiveReviewItems: primaryLive?.reviewItemCount || 0,
  };
}

function buildCsvTemplate(rows) {
  const header = [
    "file_name",
    "file_path",
    "variant",
    "auto_success",
    "auto_backend",
    "auto_duration_seconds",
    "auto_total_chunks",
    "auto_time_to_first_transcript_ms",
    "auto_average_chunk_latency_ms",
    "auto_validation_recommendation",
    "auto_review_items",
    "manual_transcript_readability_1_5",
    "manual_medication_accuracy_1_5",
    "manual_diagnosis_symptoms_1_5",
    "manual_orders_followup_1_5",
    "manual_speaker_attribution_1_5",
    "manual_chunk_boundary_integrity_1_5",
    "manual_publish_safe_yes_no",
    "manual_reviewer_notes",
  ];

  const dataRows = rows
    .filter((row) => row.variant === "live_vad_diarized")
    .map((row) => [
      path.basename(row.filePath),
      row.filePath,
      row.variant,
      row.success ? "yes" : "no",
      row.backend || "",
      row.durationSeconds ?? "",
      row.totalChunks ?? "",
      row.timeToFirstTranscriptMs ?? "",
      row.averageChunkLatencyMs ?? "",
      row.validationRecommendation || "",
      row.reviewItemCount ?? "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);

  return [header, ...dataRows]
    .map((columns) => columns.map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(","))
    .join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const audioFiles = await listAudioFiles(args.dir, args.limit);

  if (audioFiles.length === 0) {
    throw new Error(`No supported audio files found in ${args.dir}`);
  }

  const whisper = new WhisperSTTSkill({
    url: process.env.WHISPER_STT_URL,
    language: process.env.WHISPER_LANGUAGE || "auto",
    temperature: process.env.WHISPER_TEMPERATURE || "0",
    timeout: 60000,
    maxRetries: 2,
    debug: false,
  });

  const medasr = new MedASRSTTSkill({
    endpoint: process.env.MEDASR_ENDPOINT,
    timeout: Number(process.env.MEDASR_TIMEOUT || 30000),
    maxRetries: Number(process.env.MEDASR_MAX_RETRIES || 2),
    debug: false,
  });

  const liveAgent = new LiveConversationSTTAgent({
    debug: false,
    diarizationProvider: args.diarizationProvider,
    allowDiarizationFallback: args.allowDiarizationFallback,
    enableGeminiFallback: false,
  });

  const rows = [];

  console.log(`[LiveEval] Evaluating ${audioFiles.length} file(s)`);
  console.log(`[LiveEval] Variants: ${args.variants.join(", ")}`);

  for (const filePath of audioFiles) {
    const mimeType = detectMimeType(filePath);
    console.log(`\n[LiveEval] File: ${path.basename(filePath)}`);

    for (const variant of args.variants) {
      console.log(`[LiveEval]   -> ${variant}`);
      const row = await runVariant({
        filePath,
        mimeType,
        variant,
        whisper,
        medasr,
        liveAgent,
        args,
      });
      rows.push({
        fileName: path.basename(filePath),
        filePath,
        mimeType,
        ...row,
      });
      console.log(
        `[LiveEval]      ${row.success ? "PASS" : "FAIL"} | ${row.latencyMs}ms | backend=${row.backend || "n/a"}${row.error ? ` | ${row.error}` : ""}`,
      );
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: {
      dir: path.resolve(args.dir),
      limit: args.limit,
      files: audioFiles,
    },
    config: {
      variants: args.variants,
      windowSeconds: args.windowSeconds,
      hopSeconds: args.hopSeconds,
      diarizationProvider: args.diarizationProvider,
      allowDiarizationFallback: args.allowDiarizationFallback,
    },
    rows,
    fileSummary: audioFiles.map((filePath) =>
      summarizeFileResults(filePath, rows.filter((row) => row.filePath === filePath))),
  };

  const timestamp = Date.now();
  const outputPath = args.out || path.join("tests", "results", `live_conversation_matrix_${timestamp}.json`);
  const csvPath = args.csv || path.join("tests", "results", `live_conversation_scoring_template_${timestamp}.csv`);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(report, null, 2));
  await fsp.writeFile(csvPath, `${buildCsvTemplate(rows)}\n`);

  console.log("\n[LiveEval] File summary");
  for (const item of report.fileSummary) {
    console.log(
      `  ${item.fileName} | whisper=${item.directWhisperOk ? "PASS" : "FAIL"} | medasr=${item.directMedasrOk ? "PASS" : "FAIL"} | ${item.primaryLiveVariant || "live"}=${item.primaryLiveOk ? "PASS" : "FAIL"} | reviewItems=${item.primaryLiveReviewItems}`,
    );
  }
  console.log(`\n[LiveEval] JSON report: ${outputPath}`);
  console.log(`[LiveEval] CSV template: ${csvPath}`);
}

main().catch((error) => {
  console.error("[LiveEval] Uncaught error:", error);
  process.exit(1);
});
