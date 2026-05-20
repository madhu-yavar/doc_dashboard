const fs = require("fs/promises");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const GeminiAudioTranscriptionTool = require("../tools/llm/gemini_audio_transcription.tool.cjs");

const repoRoot = path.join(__dirname, "..");
const voiceSessionsPath = path.join(repoRoot, "server", "storage", "voice_sessions.json");
const documentsPath = path.join(repoRoot, "server", "storage", "documents.json");
const voiceTranscriptsDir = path.join(repoRoot, "server", "storage", "voice_transcripts");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatTimeLabel(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function fallbackTimeLabel(index) {
  return formatTimeLabel(index * 12);
}

function normalizeFlags(flags = []) {
  const normalized = Array.isArray(flags)
    ? flags.map((flag) => normalizeText(flag).toLowerCase().replace(/\s+/g, "_")).filter(Boolean)
    : [];
  return Array.from(new Set(normalized));
}

function buildSegmentsFromTranscript(transcript = {}) {
  const speakers = Array.isArray(transcript.speakers) ? transcript.speakers : [];
  const speakerById = new Map(speakers.map((speaker) => [speaker.id, speaker]));
  const sourceSegments = Array.isArray(transcript.segments) ? transcript.segments : [];

  return sourceSegments.map((segment, index) => {
    const linkedSpeaker = segment?.speakerId ? speakerById.get(segment.speakerId) : null;
    const confidenceValue = Number(segment?.confidence);
    return {
      id: segment?.segmentId || `seg_${index + 1}`,
      speakerRole: segment?.speakerRole || linkedSpeaker?.role || "unknown",
      speakerLabel: normalizeText(segment?.speakerLabel || linkedSpeaker?.label || `Speaker ${index + 1}`) || `Speaker ${index + 1}`,
      startLabel: normalizeText(segment?.startLabel) || fallbackTimeLabel(index),
      endLabel: normalizeText(segment?.endLabel) || fallbackTimeLabel(index + 1),
      text: normalizeText(segment?.text || segment?.normalizedText),
      confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : null,
      flags: normalizeFlags(segment?.flags),
    };
  });
}

function buildTranscriptQuality(transcript = {}, segments = []) {
  const confidences = segments
    .map((segment) => (typeof segment.confidence === "number" ? segment.confidence : null))
    .filter((value) => typeof value === "number");

  return {
    overallConfidence:
      typeof transcript.quality?.overallConfidence === "number"
        ? transcript.quality.overallConfidence
        : (confidences.length
            ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(3))
            : null),
    lowConfidenceSegmentCount: segments.filter((segment) =>
      segment.flags.includes("low_confidence") ||
      (typeof segment.confidence === "number" && segment.confidence < 0.75)
    ).length,
    medicationRisk:
      transcript.quality?.medicationRisk === "high" ||
      transcript.quality?.medicationRisk === "medium" ||
      transcript.quality?.medicationRisk === "low"
        ? transcript.quality.medicationRisk
        : "low",
  };
}

function inferReviewDescriptor(segment) {
  const flags = new Set(segment.flags || []);
  if (flags.has("dosage")) return { category: "medication", severity: "high", reasonCode: "dosage_ambiguity", title: "Confirm medication dosage wording" };
  if (flags.has("medication")) return { category: "medication", severity: "medium", reasonCode: "low_confidence", title: "Confirm medication instruction" };
  if (flags.has("labs")) return { category: "lab_order", severity: "medium", reasonCode: "possible_missing_context", title: "Confirm lab order wording" };
  if (flags.has("radiology")) return { category: "radiology_order", severity: "medium", reasonCode: "possible_missing_context", title: "Confirm imaging order wording" };
  if (flags.has("follow_up")) return { category: "follow_up", severity: "low", reasonCode: "low_confidence", title: "Confirm follow-up instruction" };
  return { category: "transcript", severity: "low", reasonCode: "low_confidence", title: "Review transcript span" };
}

function buildReviewItems(segments = []) {
  const reviewItems = [];
  for (const segment of segments) {
    const needsReview =
      segment.flags.length > 0 ||
      (typeof segment.confidence === "number" && segment.confidence < 0.75);
    if (!needsReview) continue;
    const descriptor = inferReviewDescriptor(segment);
    reviewItems.push({
      id: `review_${Math.random().toString(36).slice(2, 10)}`,
      category: descriptor.category,
      severity: descriptor.severity,
      reasonCode: descriptor.reasonCode,
      title: descriptor.title,
      extractedValue: segment.text,
      suggestedValue: segment.text,
      provenanceText: segment.text,
      provenanceTime: `${segment.startLabel} - ${segment.endLabel}`,
      resolution: "pending",
      editedValue: "",
    });
  }
  return reviewItems;
}

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    throw new Error("Usage: node scripts/rescue_voice_session_transcript.cjs <sessionId>");
  }

  const voiceSessionsPayload = JSON.parse(await fs.readFile(voiceSessionsPath, "utf8"));
  const documentsPayload = JSON.parse(await fs.readFile(documentsPath, "utf8"));
  const sessions = Array.isArray(voiceSessionsPayload.sessions) ? voiceSessionsPayload.sessions : [];
  const documents = Array.isArray(documentsPayload.documents) ? documentsPayload.documents : [];

  const session = sessions.find((item) => item.id === sessionId);
  if (!session?.audioPath) {
    throw new Error(`Voice session ${sessionId} not found or missing audioPath.`);
  }

  const tool = new GeminiAudioTranscriptionTool();
  const result = await tool.execute(session.audioPath, {
    mimeType: session.mimeType || "audio/wav",
  });
  if (!result.success) {
    throw new Error(result.error || "Transcription failed");
  }

  const transcript = result.data || {};
  const segments = buildSegmentsFromTranscript(transcript);
  const transcriptQuality = buildTranscriptQuality(transcript, segments);
  const reviewItems = buildReviewItems(segments);
  const rawText = normalizeText(transcript.rawText);
  const normalizedText = normalizeText(transcript.normalizedText || transcript.rawText);

  session.sttBackend = `Gemini ${result.model || tool.model}`;
  session.transcriptQuality = transcriptQuality;
  session.segments = segments;
  session.reviewItems = reviewItems;
  session.error = null;
  session.status = reviewItems.length > 0 ? "review_required" : "queued_for_extraction";
  session.extractionPreview = {
    linkedPatient: session.linkedPatient,
    encounterLabel: session.encounterLabel,
    diagnosis: "",
    medications: [],
    labs: [],
    radiology: [],
    procedures: [],
    followUp: [],
    clinicalNotes: [
      `Gemini transcription completed for ${session.fileName}.`,
      reviewItems.length > 0
        ? `${reviewItems.length} transcript span(s) require review before queue processing.`
        : "Transcript is ready for queue processing.",
    ],
  };

  const transcriptPath = path.join(voiceTranscriptsDir, `${sessionId}.json`);
  session.transcriptPath = transcriptPath;
  await fs.writeFile(
    transcriptPath,
    JSON.stringify({
      transcriptId: sessionId,
      sourceType: "dictation_upload",
      fileName: session.fileName,
      linkedPatient: session.linkedPatient,
      encounterLabel: session.encounterLabel,
      sttBackend: session.sttBackend,
      model: result.model || tool.model,
      usage: result.usage || null,
      language: transcript.language || null,
      rawText,
      normalizedText,
      speakers: Array.isArray(transcript.speakers) ? transcript.speakers : [],
      segments: Array.isArray(transcript.segments) ? transcript.segments : [],
      quality: transcript.quality || transcriptQuality,
    }, null, 2),
    "utf8"
  );

  let document = documents.find((item) => item.id === sessionId);
  if (!document) {
    document = {
      id: session.id,
      name: session.fileName,
      size: session.size,
      uploadedAt: session.uploadedAt,
      filePath: session.audioPath,
      hash: session.hash,
      documentType: "voice",
    };
    documents.unshift(document);
  }

  document.documentType = "voice";
  document.mimeType = session.mimeType || document.mimeType || "audio/wav";
  document.durationLabel = session.durationLabel || document.durationLabel || null;
  document.linkedPatient = session.linkedPatient || document.linkedPatient || "Encounter link pending";
  document.encounterLabel = session.encounterLabel || document.encounterLabel || "Not linked";
  document.segments = segments;
  document.transcript = {
    rawText,
    normalizedText,
    language: transcript.language || null,
    overallConfidence: transcriptQuality.overallConfidence,
  };
  document.transcriptQuality = transcriptQuality;
  document.reviewItems = reviewItems;
  document.extractionPreview = session.extractionPreview;
  document.status = session.status;
  document.error = null;

  await fs.writeFile(voiceSessionsPath, JSON.stringify({ sessions }, null, 2), "utf8");
  await fs.writeFile(documentsPath, JSON.stringify({ documents }, null, 2), "utf8");

  console.log(JSON.stringify({
    sessionId,
    status: session.status,
    segmentCount: segments.length,
    reviewItemCount: reviewItems.length,
    transcriptPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
