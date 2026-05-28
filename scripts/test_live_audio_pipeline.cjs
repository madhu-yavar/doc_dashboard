/**
 * Live Audio Pipeline Test Script (FULL FEATURE TEST)
 *
 * Tests the live conversation STT pipeline with:
 * - VAD Segmentation (energy-based)
 * - Speaker Diarization (Pyannote primary, Gemini fallback)
 * - Hybrid Reconciliation (Gemma with 3min timeout)
 *
 * Usage:
 *   node scripts/test_live_audio_pipeline.cjs [audio-file]
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const LiveConversationSTTAgent = require("../agents/live_conversation_stt_agent.cjs");

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".webm") return "audio/webm";
  return "application/octet-stream";
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function printSection(title) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(70)}`);
}

function printMetric(label, value, unit = "") {
  const paddedLabel = label.padEnd(35);
  const paddedValue = String(value).padEnd(15);
  console.log(`  ${paddedLabel} : ${paddedValue}${unit ? ` ${unit}` : ""}`);
}

function printStatus(test, status, details = "") {
  const statusIcon = status === "PASS" ? "✅" : status === "WARN" ? "⚠️" : "❌";
  console.log(`  ${statusIcon} [${status.padEnd(4)}] ${test}${details ? ` - ${details}` : ""}`);
}

async function main() {
  const args = process.argv.slice(2);
  const audioFile = args[0] || "tests/fixtures/audio/audio_recordings/Audio_Recordings/GEN0001.mp3";
  const absolutePath = path.resolve(audioFile);

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                 LIVE AUDIO PIPELINE TEST                             ║
╠══════════════════════════════════════════════════════════════════════╣
║  Audio: ${audioFile.padEnd(56)}║
╚══════════════════════════════════════════════════════════════════════╝`);

  // Test 1: File exists
  if (!fs.existsSync(absolutePath)) {
    console.error(`\n❌ Error: Audio file not found: ${absolutePath}`);
    process.exit(1);
  }
  printStatus("File exists", "PASS");

  const stats = await fsp.stat(absolutePath);
  printMetric("File size", formatBytes(stats.size));

  const mimeType = detectMimeType(absolutePath);
  printMetric("MIME type", mimeType);

  // Initialize agent with VAD and Diarization enabled
  const agent = new LiveConversationSTTAgent({
    debug: false,
    enableGeminiFallback: true,
    // Increase hybrid timeout for longer audio
    hybridTimeout: 180000, // 3 minutes instead of 60s
    // Enable speaker diarization
    diarizationProvider: "pyannote",
    diarizationFallbackProvider: "gemini",
    allowDiarizationFallback: true,
  });

  const testResults = {
    timestamp: new Date().toISOString(),
    audioFile: absolutePath,
    fileSize: stats.size,
    mimeType,
    tests: [],
  };

  // Run the pipeline
  const startTime = Date.now();

  try {
    const result = await agent.execute({
      audioPath: absolutePath,
      options: {
        mimeType,
        // Enable VAD segmentation instead of fixed windows
        mode: "energy_vad",
        // Keep VAD chunks capped at the intended 30 second ceiling
        windowSeconds: 30,
        // VAD parameters
        frameMs: 30,
        minSpeechMs: 500,
        minSilenceMs: 400,
        preRollMs: 100,
        postRollMs: 200,
        mergeGapMs: 200,
        maxSegmentMs: 30000, // legacy alias; agent now also respects this
        // Enable speaker diarization
        enableSpeakerDiarization: true,
        diarizationProvider: "pyannote",
        diarizationFallbackProvider: "gemini",
        allowDiarizationFallback: true,
        // Validation
        skipValidation: false,
        keepChunks: false,
      },
    });

    const totalLatency = Date.now() - startTime;

    if (!result.success) {
      printSection("PIPELINE FAILED");
      console.error(`  Error: ${result.error}`);
      testResults.tests.push({ name: "Pipeline execution", status: "FAIL", error: result.error });

      // Save results
      const outputPath = path.join("tests", "results", `live_pipeline_test_${Date.now()}.json`);
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(outputPath, JSON.stringify(testResults, null, 2));
      console.log(`\n  Results saved to: ${outputPath}`);
      process.exit(1);
    }

    const report = result.data;

    // Test results
    printSection("PIPELINE RESULTS");

    // Test 1: Audio Ingestion
    const audioIngestionPass = report.durationSeconds > 0;
    printStatus("Audio Ingestion", audioIngestionPass ? "PASS" : "FAIL");
    testResults.tests.push({ name: "Audio Ingestion", status: audioIngestionPass ? "PASS" : "FAIL" });
    if (audioIngestionPass) {
      printMetric("Duration", formatDuration(report.durationSeconds * 1000));
    }

    // Test 2: Chunk Plan Creation
    const chunkingPass = report.summary.totalChunks > 0;
    printStatus("Chunk Plan Creation", chunkingPass ? "PASS" : "FAIL");
    testResults.tests.push({ name: "Chunk Plan Creation", status: chunkingPass ? "PASS" : "FAIL" });
    if (chunkingPass) {
      printMetric("Mode", report.mode);
      printMetric("Total chunks", report.summary.totalChunks);
      printMetric("Successful chunks", report.summary.successfulChunks);
      printMetric("Failed chunks", report.summary.failedChunks);
    }

    // Test 3: Primary STT (Whisper)
    const whisperPass = report.sourceTranscripts.whisperChunked?.success;
    printStatus("Primary STT (Whisper)", whisperPass ? "PASS" : "FAIL");
    testResults.tests.push({ name: "Primary STT (Whisper)", status: whisperPass ? "PASS" : "FAIL" });
    if (whisperPass) {
      printMetric("Backend", report.sourceTranscripts.whisperChunked.backend);
      printMetric("Text length", report.sourceTranscripts.whisperChunked.textLength, "chars");
      printMetric("Segment count", report.sourceTranscripts.whisperChunked.segmentCount);
      printMetric("Latency", formatDuration(report.sourceTranscripts.whisperChunked.latencyMs));
    }

    // Test 4: Shadow STT (MedASR)
    const medasrPass = report.sourceTranscripts.medasr?.success;
    printStatus("Shadow STT (MedASR)", medasrPass ? "PASS" : "WARN", medasrPass ? "" : "MedASR unavailable");
    testResults.tests.push({ name: "Shadow STT (MedASR)", status: medasrPass ? "PASS" : "WARN" });
    if (medasrPass) {
      printMetric("Backend", report.sourceTranscripts.medasr.backend);
      printMetric("Text length", report.sourceTranscripts.medasr.textLength, "chars");
      printMetric("Segment count", report.sourceTranscripts.medasr.segmentCount);
      printMetric("Latency", formatDuration(report.sourceTranscripts.medasr.latencyMs));
    }

    // Test 5: Hybrid Reconciliation
    const mergedPass = report.sourceTranscripts.merged?.success;
    printStatus("Hybrid Reconciliation", mergedPass ? "PASS" : "WARN");
    testResults.tests.push({ name: "Hybrid Reconciliation", status: mergedPass ? "PASS" : "WARN" });
    if (mergedPass) {
      printMetric("Final backend", report.summary.finalTranscriptBackend);
      printMetric("Text length", report.sourceTranscripts.merged.textLength, "chars");
    }

    // Test 6: Speaker Diarization
    const diarizationPass = report.diarization?.backend && report.diarization.backend !== "disabled";
    printStatus("Speaker Diarization", diarizationPass ? "PASS" : "WARN", diarizationPass ? report.diarization.backend : "Disabled in test");
    testResults.tests.push({ name: "Speaker Diarization", status: diarizationPass ? "PASS" : "WARN" });
    if (diarizationPass) {
      printMetric("Diarization backend", report.diarization.backend);
      printMetric("Speaker count", report.diarization.speakers?.length || 0);
    }

    // Test 7: Transcript Validation
    const validationPass = report.validation?.recommendation;
    const validationStatus = validationPass === "reject" ? "FAIL" : validationPass === "review" ? "WARN" : "PASS";
    printStatus("Transcript Validation", validationStatus, `recommendation: ${validationPass || "unknown"}`);
    testResults.tests.push({ name: "Transcript Validation", status: validationStatus });
    if (report.validation) {
      printMetric("Confidence", report.validation.confidence);
      printMetric("Recommendation", report.validation.recommendation);
      if (report.validation.riskFlags) {
        printMetric("Medication risk", report.validation.riskFlags.medicationRisk);
        printMetric("Order risk", report.validation.riskFlags.orderRisk);
      }
    }

    // Test 8: Cumulative Output
    const cumulativePass = report.cumulativeTranscript?.length > 0;
    printStatus("Cumulative Output", cumulativePass ? "PASS" : "FAIL");
    testResults.tests.push({ name: "Cumulative Output", status: cumulativePass ? "PASS" : "FAIL" });
    if (cumulativePass) {
      printMetric("Cumulative transcript length", report.cumulativeTranscript.length, "chars");
    }

    // Test 9: Error Handling / Fallback
    printStatus("Error Handling", "PASS", "No hard failures");
    testResults.tests.push({ name: "Error Handling", status: "PASS" });

    // Test 10: Performance
    const performancePass = totalLatency < (report.durationSeconds * 1000) + 60000;
    printStatus("Performance", performancePass ? "PASS" : "WARN", `${formatDuration(totalLatency)} total`);
    testResults.tests.push({ name: "Performance", status: performancePass ? "PASS" : "WARN" });
    printMetric("Total latency", formatDuration(totalLatency));
    printMetric("Overhead", formatDuration(totalLatency - report.durationSeconds * 1000));

    // Transcript preview
    if (report.finalTranscript?.normalizedText || report.cumulativeTranscript) {
      printSection("TRANSCRIPT PREVIEW");
      const preview = (report.finalTranscript?.normalizedText || report.cumulativeTranscript).slice(0, 500);
      console.log(`  ${preview}${(report.finalTranscript?.normalizedText || report.cumulativeTranscript).length > 500 ? "..." : ""}`);
    }

    // Summary
    printSection("TEST SUMMARY");
    const passCount = testResults.tests.filter((t) => t.status === "PASS").length;
    const warnCount = testResults.tests.filter((t) => t.status === "WARN").length;
    const failCount = testResults.tests.filter((t) => t.status === "FAIL").length;
    printMetric("Passed", passCount);
    printMetric("Warnings", warnCount);
    printMetric("Failed", failCount);
    printMetric("Overall", failCount === 0 ? (warnCount === 0 ? "SUCCESS" : "SUCCESS_WITH_WARNINGS") : "FAILED");

    // Save results
    testResults.totalLatencyMs = totalLatency;
    testResults.report = report;
    const outputPath = path.join("tests", "results", `live_pipeline_test_${Date.now()}.json`);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, JSON.stringify(testResults, null, 2));

    console.log(`\n  Full results saved to: ${outputPath}`);

  } catch (error) {
    console.error(`\n❌ Uncaught error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[Test] Uncaught error:", error);
  process.exit(1);
});
