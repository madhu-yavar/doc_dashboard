/**
 * Test script for Agentic STT Router
 *
 * Usage:
 *   node scripts/test_agentic_stt.cjs /path/to/audio.wav
 *
 * Tests the LangGraph-based STT Router Agent with:
 * - Strategy selection
 * - Backend routing (Whisper/Gemini)
 * - Fallback handling
 * - Result reconciliation
 */

const path = require("path");

// Load environment variables
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const STTRouterAgent = require("../agents/stt_router_agent.cjs");

async function main() {
  const audioPath = process.argv[2];

  if (!audioPath) {
    console.error("Usage: node scripts/test_agentic_stt.cjs <audio-file-path>");
    console.error("Example: node scripts/test_agentic_stt.cjs ./tests/fixtures/audio/test.wav");
    process.exit(1);
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    AGENTIC STT ROUTER TEST                            ║
╚══════════════════════════════════════════════════════════════════════╝

Test Configuration:
  Audio File: ${audioPath}
  Primary Backend: ${process.env.STT_BACKEND || "whisper"}
  Whisper URL: ${process.env.WHISPER_STT_URL || "N/A"}
  Gemini Model: ${process.env.GEMINI_MODEL || "N/A"}
  Enable Fallback: true

`);

  const agent = new STTRouterAgent({
    primaryBackend: process.env.STT_BACKEND || "whisper",
    enableFallback: true,
    whisperUrl: process.env.WHISPER_STT_URL,
    language: process.env.WHISPER_LANGUAGE || "auto",
    temperature: process.env.WHISPER_TEMPERATURE || "0",
    geminiModel: process.env.VOICE_GEMINI_MODEL || process.env.GEMINI_MODEL,
    geminiApiKey: process.env.GEMINI_API_KEY,
    debug: true, // Enable debug logging
  });

  console.log("🚀 Starting agentic STT workflow...\n");

  const startTime = Date.now();
  const result = await agent.execute(audioPath);
  const elapsed = Date.now() - startTime;

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                          RESULT SUMMARY                               ║
╚══════════════════════════════════════════════════════════════════════╝

Status: ${result.status}
Success: ${result.success ? "✅" : "❌"}
Backend Used: ${result.backend || "N/A"}
Total Latency: ${elapsed}ms

Execution Steps:
`);

  result.steps.forEach((step, i) => {
    const status = step.status === "completed" ? "✅" : step.status === "failed" ? "❌" : "⏳";
    console.log(`  ${i + 1}. ${status} ${step.name}`);
    if (step.error) {
      console.log(`     Error: ${step.error}`);
    }
    if (step.result) {
      const resultInfo = Object.entries(step.result)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      console.log(`     Result: ${resultInfo}`);
    }
  });

  if (result.errors.length > 0) {
    console.log("\nErrors:");
    result.errors.forEach((err, i) => {
      console.log(`  ${i + 1}. [${err.step}] ${err.error}`);
    });
  }

  if (result.success && result.data) {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                          TRANSCRIPT                                   ║
╚══════════════════════════════════════════════════════════════════════╝

Language: ${result.data.language}
Segments: ${result.data.segments?.length || 0}
Backend: ${result.data.metadata?.backend || "unknown"}
Model: ${result.data.metadata?.model || "unknown"}

Transcript:
─────────────────────────────────────────────────────────────────────────
${result.data.normalizedText || result.data.rawText || "(empty)"}
─────────────────────────────────────────────────────────────────────────
`);
  }

  console.log("\n✨ Test complete!\n");

  if (!result.success) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n❌ Uncaught error:", err);
  process.exit(1);
});
