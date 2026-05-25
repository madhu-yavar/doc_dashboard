/**
 * Test script for Whisper STT integration
 *
 * Usage:
 *   node scripts/test_whisper_stt.cjs /path/to/audio.wav
 *
 * Environment variables (.env):
 *   WHISPER_STT_URL=http://202.88.209.11/whisper/transcribe
 *   WHISPER_LANGUAGE=auto
 *   WHISPER_TEMPERATURE=0
 */

const path = require("path");
require("../tools/llm/whisper_transcription.tool.cjs");

// Load environment variables
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const WhisperTranscriptionTool = require("../tools/llm/whisper_transcription.tool.cjs");

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: node scripts/test_whisper_stt.cjs <audio-file-path>");
    console.error("Example: node scripts/test_whisper_stt.cjs ./tests/fixtures/audio/test.wav");
    process.exit(1);
  }

  console.log(`[Test] Whisper STT Integration`);
  console.log(`[Test] Audio file: ${filePath}`);
  console.log(`[Test] STT URL: ${process.env.WHISPER_STT_URL || "http://202.88.209.11/whisper/transcribe"}`);
  console.log(`[Test] Language: ${process.env.WHISPER_LANGUAGE || "auto"}`);
  console.log("");

  const tool = new WhisperTranscriptionTool({
    url: process.env.WHISPER_STT_URL,
    language: process.env.WHISPER_LANGUAGE || "auto",
    temperature: process.env.WHISPER_TEMPERATURE || "0",
    timeout: 60000,
  });

  console.log("[Test] Starting transcription...");
  const startTime = Date.now();

  const result = await tool.execute(filePath, {
    mimeType: "audio/wav",
  });

  const elapsed = Date.now() - startTime;

  console.log("");
  console.log(`[Test] Completed in ${elapsed}ms`);
  console.log("");

  if (result.success) {
    console.log("[Test] ✅ SUCCESS");
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
    console.log("");
  } else {
    console.log("[Test] ❌ FAILED");
    console.log("");
    console.log(`Error: ${result.error}`);
    console.log("");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[Test] Uncaught error:", err);
  process.exit(1);
});
