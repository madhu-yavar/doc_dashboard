const fs = require("fs/promises");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const GeminiAudioTranscriptionTool = require("../tools/llm/gemini_audio_transcription.tool.cjs");
const VoiceExtractorAgent = require("../agents/voice_extractor_agent.cjs");

const repoRoot = path.join(__dirname, "..");
const voiceSessionsPath = path.join(repoRoot, "server", "storage", "voice_sessions.json");
const documentsPath = path.join(repoRoot, "server", "storage", "documents.json");

function normalizeTranscript(transcript = {}) {
  const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
  const normalizedSegments = segments.map((segment, index) => ({
    id: segment.id || segment.segmentId || `seg_${index}`,
    segmentId: segment.segmentId || segment.id || `seg_${index}`,
    speakerId: segment.speakerId || null,
    speakerRole: segment.speakerRole || "unknown",
    speakerLabel: segment.speakerLabel || "Speaker",
    startLabel: segment.startLabel || "00:00",
    endLabel: segment.endLabel || "00:00",
    startMs: typeof segment.startMs === "number" ? segment.startMs : null,
    endMs: typeof segment.endMs === "number" ? segment.endMs : null,
    text: String(segment.text || "").trim(),
    normalizedText: String(segment.normalizedText || segment.text || "").trim(),
    confidence: typeof segment.confidence === "number" ? segment.confidence : null,
    flags: Array.isArray(segment.flags) ? segment.flags : [],
  }));

  return {
    rawText: String(transcript.rawText || "").trim(),
    normalizedText: String(transcript.normalizedText || transcript.rawText || "").trim(),
    language: transcript.language || null,
    overallConfidence: transcript.quality?.overallConfidence ?? transcript.overallConfidence ?? null,
    segments: normalizedSegments,
  };
}

function buildVoiceDocumentResult({ documentId, uploadedAt, sttBackend, extractedData, dashboardPayload }) {
  return {
    dashboard_cards: dashboardPayload || {},
    meta: {
      source_type: "voice",
      voice_session_id: documentId,
      stt_backend: sttBackend || "unknown",
      transcript_date: String(uploadedAt || new Date().toISOString()).split("T")[0],
      ...(extractedData?.meta || {}),
    },
    extracted_data: extractedData || {},
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function main() {
  const documentId = process.argv[2] || "59c0e422-2eeb-444d-92ce-6c750e8bf9f6";
  const mimeType = process.argv[3] || "audio/wav";

  const voiceSessions = await readJson(voiceSessionsPath);
  const documents = await readJson(documentsPath);

  const voiceSession = voiceSessions.sessions.find((item) => item.id === documentId);
  if (!voiceSession?.audioPath) {
    throw new Error(`Voice session ${documentId} not found or missing audioPath.`);
  }

  const document = documents.documents.find((item) => item.id === documentId);
  if (!document) {
    throw new Error(`Document ${documentId} not found.`);
  }

  const transcriptionTool = new GeminiAudioTranscriptionTool();
  const extractor = new VoiceExtractorAgent({
    gemma: {
      baseUrl: process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions",
      model: process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it",
      timeout: 180000,
      defaultJsonMode: true,
    },
    logSteps: true,
  });

  const sttStartedAt = Date.now();
  let transcription = null;
  let transcriptionError = null;

  try {
    transcription = await transcriptionTool.execute(voiceSession.audioPath, {
      mimeType: voiceSession.mimeType || mimeType,
    });
  } catch (error) {
    transcriptionError = error instanceof Error ? error.message : String(error);
  }

  const sttLatencyMs = Date.now() - sttStartedAt;
  const liveTranscriptionSucceeded = Boolean(transcription?.success);
  const transcriptObject = liveTranscriptionSucceeded
    ? normalizeTranscript(transcription.data)
    : normalizeTranscript({
        rawText: document.transcript?.rawText || voiceSession.segments.map((segment) => segment.text).join(" "),
        normalizedText: document.transcript?.normalizedText || voiceSession.segments.map((segment) => segment.text).join(" "),
        language: document.transcript?.language || "en",
        overallConfidence: document.transcript?.overallConfidence ?? voiceSession.transcriptQuality?.overallConfidence ?? null,
        segments: voiceSession.segments,
      });

  const extractionStartedAt = Date.now();
  const extraction = await extractor.execute(documentId, transcriptObject);
  const extractionLatencyMs = Date.now() - extractionStartedAt;

  const simulatedQueueResult = buildVoiceDocumentResult({
    documentId,
    uploadedAt: document.uploadedAt,
    sttBackend: `Gemini ${transcription.model || transcriptionTool.model}`,
    extractedData: voiceSession.extractedData,
    dashboardPayload: voiceSession.dashboardPayload,
  });

  const summary = {
    documentId,
    fileName: voiceSession.fileName,
    audioPath: voiceSession.audioPath,
    inputDocumentStatus: document.status,
    inputDocumentError: document.error || null,
    voiceSessionStatus: voiceSession.status,
    storedSessionCanRepairQueueRecord: Boolean(voiceSession.extractedData && voiceSession.dashboardPayload),
    transcription: {
      success: liveTranscriptionSucceeded,
      usedStoredTranscriptFallback: !liveTranscriptionSucceeded,
      error: transcriptionError || transcription?.error || null,
      model: transcription?.model || null,
      latencyMs: sttLatencyMs,
      rawTextPreview: transcriptObject.rawText.slice(0, 160),
      language: transcriptObject.language,
      overallConfidence: transcriptObject.overallConfidence,
      segmentCount: transcriptObject.segments.length,
    },
    extraction: {
      success: extraction.success,
      status: extraction.status,
      latencyMs: extractionLatencyMs,
      reviewItemCount: extraction.reviewItems?.length || 0,
      medications: extraction.extractedData?.medications?.length || 0,
      labResults: extraction.extractedData?.lab_results?.length || 0,
      clinicalNotes: extraction.extractedData?.clinical_notes?.length || 0,
      errors: extraction.errors || [],
      steps: (extraction.steps || []).map((step) => ({ name: step.name, status: step.status })),
    },
    dashboard: {
      generated: Boolean(extraction.dashboardPayload),
      alerts: extraction.dashboardPayload?.alerts?.length || 0,
      patientsNeedingAttention: extraction.dashboardPayload?.patients_needing_attention?.length || 0,
      readyForDischarge: extraction.dashboardPayload?.ready_for_discharge?.length || 0,
      complexCases: extraction.dashboardPayload?.complex_cases?.length || 0,
    },
    storedVoiceSession: {
      hasExtractedData: Boolean(voiceSession.extractedData),
      hasDashboardPayload: Boolean(voiceSession.dashboardPayload),
      storedLabs: voiceSession.extractedData?.lab_results?.length || 0,
      storedAlerts: voiceSession.dashboardPayload?.alerts?.length || 0,
    },
    queueRepairSimulation: {
      resultHasDashboardCards: Boolean(simulatedQueueResult.dashboard_cards),
      resultHasExtractedData: Boolean(simulatedQueueResult.extracted_data),
      sttBackend: simulatedQueueResult.meta?.stt_backend || null,
      transcriptDate: simulatedQueueResult.meta?.transcript_date || null,
      storedDashboardAlerts: simulatedQueueResult.dashboard_cards?.alerts?.length || 0,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
