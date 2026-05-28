/**
 * Test script for MedASR STT integration
 *
 * Usage:
 *   node scripts/test_medasr_stt.cjs /path/to/audio.wav
 *
 * Environment variables (.env):
 *   MEDASR_ENDPOINT=http://206.1.62.28:8008/transcribe
 *   MEDASR_TIMEOUT=30000
 *   MEDASR_MAX_RETRIES=2
 */

const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const MedASRSTTSkill = require("../skills/stt/medasr_stt_skill.cjs");

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".webm") return "audio/webm";
  return "application/octet-stream";
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: node scripts/test_medasr_stt.cjs <audio-file-path>");
    console.error("Example: node scripts/test_medasr_stt.cjs ./tests/fixtures/audio/ESL+pain+mgmt+sample.wav");
    process.exit(1);
  }

  const mimeType = detectMimeType(filePath);

  console.log("[Test] MedASR STT Integration");
  console.log(`[Test] Audio file: ${filePath}`);
  console.log(`[Test] Endpoint: ${process.env.MEDASR_ENDPOINT || "http://206.1.62.28:8008/transcribe"}`);
  console.log(`[Test] Mime type: ${mimeType}`);
  console.log("");

  const skill = new MedASRSTTSkill({
    endpoint: process.env.MEDASR_ENDPOINT,
    timeout: Number(process.env.MEDASR_TIMEOUT || 30000),
    maxRetries: Number(process.env.MEDASR_MAX_RETRIES || 2),
    debug: false,
  });

  console.log("[Test] Starting transcription...");
  const startTime = Date.now();

  const result = await skill.execute({
    audioPath: filePath,
    mimeType,
  });

  const elapsed = Date.now() - startTime;

  console.log("");
  console.log(`[Test] Completed in ${elapsed}ms`);
  console.log("");

  if (result.success) {
    console.log("[Test] SUCCESS");
    console.log("");
    console.log("[Transcript]");
    console.log("-----------");
    console.log(result.data.normalizedText || result.data.rawText || "(empty)");
    console.log("-----------");
    console.log("");
    console.log("[Details]");
    console.log(`  Language: ${result.data.language}`);
    console.log(`  Segments: ${result.data.segments.length}`);
    console.log(`  Model: ${result.model}`);
    console.log(`  Backend: ${result.backend}`);
    console.log("");
    return;
  }

  console.log("[Test] FAILED");
  console.log("");
  console.log(`Error: ${result.error}`);
  console.log("");
  process.exit(1);
}

main().catch((err) => {
  console.error("[Test] Uncaught error:", err);
  process.exit(1);
});
