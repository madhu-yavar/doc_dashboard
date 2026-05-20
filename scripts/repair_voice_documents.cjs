const fs = require("fs/promises");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const documentsPath = path.join(repoRoot, "server", "storage", "documents.json");
const voiceSessionsPath = path.join(repoRoot, "server", "storage", "voice_sessions.json");
const DashboardMapperSkill = require("../skills/clinical/dashboard_mapper.skill.cjs");

const dashboardMapper = new DashboardMapperSkill();

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildVoiceTranscriptObject(source = {}) {
  const sourceSegments = Array.isArray(source.segments) ? source.segments : [];
  const segments = sourceSegments.map((segment, index) => ({
    id: segment.id || segment.segmentId || `seg_${index + 1}`,
    segmentId: segment.segmentId || segment.id || `seg_${index + 1}`,
    speakerId: segment.speakerId || null,
    speakerRole: segment.speakerRole || "unknown",
    speakerLabel: normalizeText(segment.speakerLabel || `Speaker ${index + 1}`) || `Speaker ${index + 1}`,
    startLabel: normalizeText(segment.startLabel) || "00:00",
    endLabel: normalizeText(segment.endLabel) || "00:00",
    startMs: typeof segment.startMs === "number" ? segment.startMs : null,
    endMs: typeof segment.endMs === "number" ? segment.endMs : null,
    text: normalizeText(segment.text),
    normalizedText: normalizeText(segment.normalizedText || segment.text),
    confidence: typeof segment.confidence === "number" ? segment.confidence : null,
    flags: Array.isArray(segment.flags) ? segment.flags : [],
  }));

  const transcriptText = normalizeText(
    source.transcript?.normalizedText ||
    source.transcript?.rawText ||
    source.normalizedText ||
    source.rawText ||
    segments.map((segment) => segment.text).join(" ")
  );

  return {
    segments,
    rawText: normalizeText(source.transcript?.rawText || transcriptText),
    normalizedText: transcriptText,
    language: source.transcript?.language || source.language || null,
    overallConfidence:
      source.transcript?.overallConfidence ??
      source.transcriptQuality?.overallConfidence ??
      null,
  };
}

function buildVoiceDocumentResult({ documentId, uploadedAt, sttBackend, extractedData, dashboardPayload }) {
  const normalizeVoiceDashboardSourceData = (data = {}) => {
    const principal = data?.diagnosis?.principal;
    const principalText = typeof principal === "string"
      ? principal
      : principal?.name || principal?.description || "";

    return {
      ...data,
      diagnosis: {
        ...(data.diagnosis || {}),
        principal: principalText,
        secondary: Array.isArray(data?.diagnosis?.secondary)
          ? data.diagnosis.secondary.map((item) => typeof item === "string" ? item : item?.name || item?.description || "").filter(Boolean)
          : [],
        comorbidities: Array.isArray(data?.diagnosis?.comorbidities) ? data.diagnosis.comorbidities : [],
        icd_code: data?.diagnosis?.icd_code || principal?.icd_code || principal?.code || "",
      },
      medications: Array.isArray(data?.medications)
        ? data.medications.map((med) => ({
            ...med,
            name: med?.name || "",
            dose: med?.dose || "",
            frequency: med?.frequency || "",
            route: med?.route || "",
          }))
        : [],
      procedures: Array.isArray(data?.procedures)
        ? data.procedures.map((item) => typeof item === "string" ? item : item?.name || "").filter(Boolean)
        : [],
      follow_up: typeof data?.follow_up === "object" && data.follow_up
        ? data.follow_up
        : { items: [] },
      radiology: Array.isArray(data?.radiology)
        ? data.radiology
        : {
            findings: Array.isArray(data?.radiology?.findings) ? data.radiology.findings : [],
            pending: Array.isArray(data?.radiology?.pending) ? data.radiology.pending : [],
          },
    };
  };
  const knownVoiceCardKeys = [
    "vitals_card",
    "diagnosis_card",
    "medications_card",
    "labs_card",
    "radiology_card",
    "treatment_card",
    "clinical_notes_card",
    "discharge_plan_card",
    "follow_up_card",
    "risk_card",
  ];
  const payloadObject = dashboardPayload && typeof dashboardPayload === "object" ? dashboardPayload : {};
  const sourceDataRaw = extractedData && typeof extractedData === "object" ? extractedData : payloadObject;
  const sourceData = normalizeVoiceDashboardSourceData(sourceDataRaw);
  const normalizedDashboardCards = payloadObject.dashboard_cards && typeof payloadObject.dashboard_cards === "object"
    ? payloadObject.dashboard_cards
    : knownVoiceCardKeys.some((key) => Object.prototype.hasOwnProperty.call(payloadObject, key))
      ? payloadObject
      : dashboardMapper.buildDashboardCards(sourceData, {});
  if (normalizedDashboardCards.diagnosis_card && typeof normalizedDashboardCards.diagnosis_card === "object") {
    normalizedDashboardCards.diagnosis_card.principal_diagnosis = sourceData?.diagnosis?.principal || "";
    normalizedDashboardCards.diagnosis_card.icd_code = sourceData?.diagnosis?.icd_code || normalizedDashboardCards.diagnosis_card.icd_code || "";
  }
  const samplePatientData = payloadObject.sample_patient_data && typeof payloadObject.sample_patient_data === "object"
    ? payloadObject.sample_patient_data
    : dashboardMapper.buildSamplePatientData(sourceData);
  samplePatientData.summary = dashboardMapper.generatePatientSummary(sourceData);
  const presentation = payloadObject.presentation && typeof payloadObject.presentation === "object"
    ? payloadObject.presentation
    : { summary_cards: {}, notes_rail: [] };

  return {
    dashboard_cards: normalizedDashboardCards,
    sample_patient_data: samplePatientData,
    presentation,
    meta: {
      ...(extractedData?.meta || {}),
      source_type: "voice",
      voice_session_id: documentId,
      stt_backend: sttBackend || "unknown",
      transcript_date: uploadedAt?.split("T")[0] || new Date().toISOString().split("T")[0],
    },
    extracted_data: extractedData || {},
  };
}

function deriveVoiceDocumentStatus(session = {}) {
  const reviewItems = Array.isArray(session.reviewItems) ? session.reviewItems : [];
  const hasPendingReview = reviewItems.some((item) => item?.resolution === "pending");
  if (hasPendingReview) return "review_required";
  if (session.extractedData && session.dashboardPayload) return "processed";
  if (Array.isArray(session.segments) && session.segments.length > 0) return "queued";
  return session.status || "failed";
}

async function main() {
  const documentsPayload = JSON.parse(await fs.readFile(documentsPath, "utf8"));
  const voiceSessionsPayload = JSON.parse(await fs.readFile(voiceSessionsPath, "utf8"));
  const documents = Array.isArray(documentsPayload.documents) ? documentsPayload.documents : [];
  const sessions = Array.isArray(voiceSessionsPayload.sessions) ? voiceSessionsPayload.sessions : [];
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const repaired = [];

  for (const document of documents) {
    if ((document.documentType && document.documentType !== "voice") || !sessionById.has(document.id)) {
      continue;
    }

    const session = sessionById.get(document.id);
    if (!(session.extractedData && session.dashboardPayload)) {
      continue;
    }

    const transcript = buildVoiceTranscriptObject(session);
    document.documentType = "voice";
    document.mimeType = session.mimeType || document.mimeType || "audio/wav";
    document.durationLabel = session.durationLabel || document.durationLabel || null;
    document.linkedPatient = session.linkedPatient || document.linkedPatient || "Encounter link pending";
    document.encounterLabel = session.encounterLabel || document.encounterLabel || "Not linked";
    document.segments = transcript.segments;
    document.transcript = {
      rawText: transcript.rawText,
      normalizedText: transcript.normalizedText,
      language: transcript.language,
      overallConfidence: transcript.overallConfidence,
    };
    document.transcriptQuality = session.transcriptQuality || document.transcriptQuality || null;
    document.reviewItems = Array.isArray(session.reviewItems) ? session.reviewItems : (document.reviewItems || []);
    document.extractionPreview = session.extractionPreview || document.extractionPreview || null;
    document.result = buildVoiceDocumentResult({
      documentId: document.id,
      uploadedAt: session.uploadedAt || document.uploadedAt,
      sttBackend: session.sttBackend,
      extractedData: session.extractedData,
      dashboardPayload: session.dashboardPayload,
    });
    document.status = deriveVoiceDocumentStatus(session);
    document.error = null;
    document.processedAt = document.processedAt || new Date().toISOString();
    repaired.push({
      id: document.id,
      name: document.name,
      status: document.status,
    });
  }

  await fs.writeFile(documentsPath, JSON.stringify({ documents }, null, 2), "utf8");
  console.log(JSON.stringify({ repaired }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
