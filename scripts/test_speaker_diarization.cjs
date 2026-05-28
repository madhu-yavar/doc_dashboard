const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const SpeakerDiarizationSkill = require("../skills/stt/speaker_diarization_skill.cjs");

async function main() {
  const filePath = process.argv[2];
  const mimeType = process.argv[3] || "audio/mpeg";
  const provider = process.argv.includes("--provider")
    ? process.argv[process.argv.indexOf("--provider") + 1]
    : undefined;
  const allowFallback = process.argv.includes("--allow-fallback");
  const pythonBin = process.argv.includes("--python-bin")
    ? process.argv[process.argv.indexOf("--python-bin") + 1]
    : undefined;
  const modelDir = process.argv.includes("--model-dir")
    ? process.argv[process.argv.indexOf("--model-dir") + 1]
    : undefined;
  const allowOnlineBootstrap = process.argv.includes("--allow-online-bootstrap");
  const device = process.argv.includes("--device")
    ? process.argv[process.argv.indexOf("--device") + 1]
    : undefined;
  const numSpeakers = process.argv.includes("--num-speakers")
    ? Number(process.argv[process.argv.indexOf("--num-speakers") + 1])
    : undefined;
  const minSpeakers = process.argv.includes("--min-speakers")
    ? Number(process.argv[process.argv.indexOf("--min-speakers") + 1])
    : undefined;
  const maxSpeakers = process.argv.includes("--max-speakers")
    ? Number(process.argv[process.argv.indexOf("--max-speakers") + 1])
    : undefined;
  const windowSeconds = process.argv.includes("--window-seconds")
    ? Number(process.argv[process.argv.indexOf("--window-seconds") + 1])
    : undefined;
  const windowOverlapSeconds = process.argv.includes("--window-overlap-seconds")
    ? Number(process.argv[process.argv.indexOf("--window-overlap-seconds") + 1])
    : undefined;
  const windowedThresholdSeconds = process.argv.includes("--windowed-threshold-seconds")
    ? Number(process.argv[process.argv.indexOf("--windowed-threshold-seconds") + 1])
    : undefined;
  const timeoutMs = process.argv.includes("--timeout-ms")
    ? Number(process.argv[process.argv.indexOf("--timeout-ms") + 1])
    : undefined;

  if (!filePath) {
    throw new Error("Usage: node scripts/test_speaker_diarization.cjs <filePath> [mimeType] [--provider pyannote|gemini] [--allow-fallback] [--python-bin PATH] [--model-dir PATH] [--allow-online-bootstrap] [--device cpu|mps|cuda] [--num-speakers N] [--min-speakers N] [--max-speakers N] [--window-seconds N] [--window-overlap-seconds N] [--windowed-threshold-seconds N] [--timeout-ms N]");
  }

  const skill = new SpeakerDiarizationSkill({
    pythonBin,
    modelDir,
    allowOnlineBootstrap,
    device,
    pyannoteTimeout: timeoutMs,
  });
  const result = await skill.execute({
    audioPath: filePath,
    mimeType,
    options: {
      maxRetries: 0,
      provider,
      allowFallback,
      numSpeakers,
      minSpeakers,
      maxSpeakers,
      windowSeconds,
      windowOverlapSeconds,
      windowedThresholdSeconds,
    },
  });

  const payload = {
    success: result.success,
    error: result.error || null,
    backend: result.backend || null,
    model: result.model || null,
    usage: result.usage || null,
    speakerCount: Array.isArray(result.data?.speakers) ? result.data.speakers.length : 0,
    segmentCount: Array.isArray(result.data?.segments) ? result.data.segments.length : 0,
    speakers: Array.isArray(result.data?.speakers)
      ? result.data.speakers.map((speaker) => ({
          id: speaker.id,
          label: speaker.label,
          role: speaker.role,
          confidence: speaker.confidence,
        }))
      : [],
    firstSegments: Array.isArray(result.data?.segments)
      ? result.data.segments.slice(0, 6).map((segment) => ({
          speakerLabel: segment.speakerLabel,
          speakerRole: segment.speakerRole,
          startLabel: segment.startLabel,
          endLabel: segment.endLabel,
          text: String(segment.text || "").slice(0, 160),
        }))
      : [],
    quality: result.data?.quality || null,
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
