const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const GeminiAudioTranscriptionTool = require("../tools/llm/gemini_audio_transcription.tool.cjs");

async function main() {
  const filePath = process.argv[2];
  const mimeType = process.argv[3] || "audio/mpeg";

  if (!filePath) {
    throw new Error("Usage: node scripts/test_gemini_audio_transcription.cjs <filePath> [mimeType]");
  }

  const tool = new GeminiAudioTranscriptionTool();
  const result = await tool.execute(filePath, {
    mimeType,
    maxRetries: 0,
  });

  const candidateText = String(result.rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text || "");
  let candidateJsonError = null;
  try {
    JSON.parse(candidateText);
  } catch (error) {
    candidateJsonError = error instanceof Error ? error.message : String(error);
  }

  const payload = {
    success: result.success,
    error: result.error || null,
    model: result.model || null,
    usage: result.usage || null,
    speakerCount: Array.isArray(result.data?.speakers) ? result.data.speakers.length : 0,
    segmentCount: Array.isArray(result.data?.segments) ? result.data.segments.length : 0,
    rawTextPreview: String(result.data?.rawText || "").slice(0, 240),
    candidateTextPreview: candidateText.slice(0, 400),
    candidateJsonError,
  };

  console.log(JSON.stringify(payload, null, 2));

  if (!result.success) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
