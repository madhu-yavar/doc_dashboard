/**
 * STT matrix runner for dictation baseline checks.
 *
 * Usage:
 *   node scripts/test_stt_matrix.cjs [audio-file ...]
 *   node scripts/test_stt_matrix.cjs --router-whisper --router-medasr tests/fixtures/audio/ESL+pain+mgmt+sample.wav
 *   node scripts/test_stt_matrix.cjs --router-hybrid tests/fixtures/audio/ESL+pain+mgmt+sample.wav tests/fixtures/audio/ESL-Cardio-sample.wav
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const WhisperSTTSkill = require("../skills/stt/whisper_stt_skill.cjs");
const MedASRSTTSkill = require("../skills/stt/medasr_stt_skill.cjs");
const STTRouterAgent = require("../agents/stt_router_agent.cjs");

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
    routerWhisper: false,
    routerMedasr: false,
    routerHybrid: false,
    out: null,
    audioFiles: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--router-whisper") {
      args.routerWhisper = true;
      continue;
    }
    if (current === "--router-medasr") {
      args.routerMedasr = true;
      continue;
    }
    if (current === "--router-hybrid") {
      args.routerHybrid = true;
      continue;
    }
    if (current === "--out") {
      args.out = argv[index + 1] || null;
      index += 1;
      continue;
    }
    args.audioFiles.push(current);
  }

  return args;
}

async function runCase(caseName, filePath, execute) {
  const startedAt = Date.now();
  try {
    const result = await execute();
    const latencyMs = Date.now() - startedAt;
    const transcript =
      result?.data?.normalizedText ||
      result?.data?.rawText ||
      result?.rawText ||
      "";

    return {
      caseName,
      filePath,
      success: !!result?.success,
      backend: result?.backend || result?.data?.metadata?.backend || "unknown",
      model: result?.model || result?.data?.metadata?.model || "unknown",
      latencyMs,
      textLength: transcript.length,
      segmentCount: result?.data?.segments?.length || 0,
      transcriptPreview: transcript.slice(0, 180),
      error: result?.success ? null : result?.error || "Unknown failure",
    };
  } catch (error) {
    return {
      caseName,
      filePath,
      success: false,
      backend: "unknown",
      model: "unknown",
      latencyMs: Date.now() - startedAt,
      textLength: 0,
      segmentCount: 0,
      transcriptPreview: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const audioFiles = args.audioFiles.length > 0
    ? args.audioFiles
    : [
        "tests/fixtures/audio/ESL+pain+mgmt+sample.wav",
        "tests/fixtures/audio/ESL-Cardio-sample.wav",
      ];

  const missing = audioFiles.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    console.error("[Matrix] Missing audio files:");
    missing.forEach((item) => console.error(`  - ${item}`));
    process.exit(1);
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

  const results = [];

  for (const filePath of audioFiles) {
    const mimeType = detectMimeType(filePath);
    console.log("");
    console.log(`[Matrix] Audio: ${filePath}`);

    results.push(await runCase("whisper_direct", filePath, () =>
      whisper.execute({ audioPath: filePath, mimeType }),
    ));

    results.push(await runCase("medasr_direct", filePath, () =>
      medasr.execute({ audioPath: filePath, mimeType }),
    ));

    if (args.routerWhisper) {
      const router = new STTRouterAgent({
        primaryBackend: "whisper",
        enableHybrid: false,
        enableFallback: true,
        whisperUrl: process.env.WHISPER_STT_URL,
        language: process.env.WHISPER_LANGUAGE || "auto",
        temperature: process.env.WHISPER_TEMPERATURE || "0",
        medasrEndpoint: process.env.MEDASR_ENDPOINT,
        geminiModel: process.env.VOICE_GEMINI_MODEL || process.env.GEMINI_MODEL,
        geminiApiKey: process.env.GEMINI_API_KEY,
        debug: false,
      });
      results.push(await runCase("router_whisper", filePath, () =>
        router.execute(filePath, { mimeType }),
      ));
    }

    if (args.routerMedasr) {
      const router = new STTRouterAgent({
        primaryBackend: "medasr",
        enableHybrid: false,
        enableFallback: true,
        whisperUrl: process.env.WHISPER_STT_URL,
        language: process.env.WHISPER_LANGUAGE || "auto",
        temperature: process.env.WHISPER_TEMPERATURE || "0",
        medasrEndpoint: process.env.MEDASR_ENDPOINT,
        geminiModel: process.env.VOICE_GEMINI_MODEL || process.env.GEMINI_MODEL,
        geminiApiKey: process.env.GEMINI_API_KEY,
        debug: false,
      });
      results.push(await runCase("router_medasr", filePath, () =>
        router.execute(filePath, { mimeType }),
      ));
    }

    if (args.routerHybrid) {
      const router = new STTRouterAgent({
        primaryBackend: "medasr",
        enableHybrid: true,
        enableFallback: true,
        whisperUrl: process.env.WHISPER_STT_URL,
        language: process.env.WHISPER_LANGUAGE || "auto",
        temperature: process.env.WHISPER_TEMPERATURE || "0",
        medasrEndpoint: process.env.MEDASR_ENDPOINT,
        gemmaUrl: process.env.GEMMA_URL,
        gemmaModel: process.env.GEMMA_MODEL,
        geminiModel: process.env.VOICE_GEMINI_MODEL || process.env.GEMINI_MODEL,
        geminiApiKey: process.env.GEMINI_API_KEY,
        debug: false,
      });
      results.push(await runCase("router_hybrid", filePath, () =>
        router.execute(filePath, { mimeType }),
      ));
    }
  }

  const timestamp = Date.now();
  const outputPath = args.out || path.join("tests", "results", `stt_matrix_${timestamp}.json`);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    audioFiles,
    cases: results,
  }, null, 2));

  console.log("");
  console.log("[Matrix] Summary");
  results.forEach((item) => {
    const status = item.success ? "PASS" : "FAIL";
    console.log(
      `  ${status} ${item.caseName} | ${path.basename(item.filePath)} | ${item.latencyMs}ms | ${item.textLength} chars${item.error ? ` | ${item.error}` : ""}`,
    );
  });
  console.log("");
  console.log(`[Matrix] Report written to ${outputPath}`);
}

main().catch((error) => {
  console.error("[Matrix] Uncaught error:", error);
  process.exit(1);
});
