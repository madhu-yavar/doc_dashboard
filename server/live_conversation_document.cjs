const DashboardMapperSkill = require("../skills/clinical/dashboard_mapper.skill.cjs");
const { normalizeLiveDraft } = require("./live_conversation_draft.cjs");

const dashboardMapper = new DashboardMapperSkill();

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

function formatDurationLabel(durationMs) {
  const totalSeconds = Math.max(0, Math.round((Number(durationMs) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getDocumentIdForSession(sessionId) {
  return `voice-live-${sessionId}`;
}

function getDisplayName(linkedPatient, encounterLabel) {
  const patientName = asText(linkedPatient);
  const encounter = asText(encounterLabel);

  if (patientName && encounter) return `${patientName} - ${encounter}`;
  if (patientName) return patientName;
  if (encounter) return `Encounter ${encounter}`;
  return "Conversation - Live";
}

function deriveEncounterNumber(sessionId) {
  const digits = String(sessionId || "").replace(/\D/g, "");
  if (!digits) return "EN000001";
  return `EN${digits.slice(-6).padStart(6, "0")}`;
}

function deriveEncounterLabel({ encounterLabel, sessionId }) {
  return deriveEncounterNumber(sessionId);
}

function isLiveConversationDocument(document) {
  return document?.result?.meta?.sessionType === "live_conversation";
}

function normalizeMedicationEntry(medication) {
  if (typeof medication === "string") {
    const name = asText(medication);
    return name
      ? {
          name,
          dose: "",
          frequency: "",
          route: "Oral",
          instruction: "",
          status: "active",
        }
      : null;
  }

  if (!medication || typeof medication !== "object") return null;

  const name = firstText(medication.name, medication.label, medication.medicine);
  if (!name) return null;

  const instruction = firstText(medication.instruction, medication.instructions, medication.frequency, medication.remarks);
  return {
    ...medication,
    name,
    dose: firstText(medication.dose, medication.dosage),
    frequency: firstText(medication.frequency, instruction),
    route: firstText(medication.route, "Oral"),
    instruction,
    status: firstText(medication.status) || "active",
  };
}

function normalizeInvestigationEntry(item) {
  if (typeof item === "string") {
    const testName = asText(item);
    return testName ? { test_name: testName, status: "ordered" } : null;
  }

  if (!item || typeof item !== "object") return null;
  const testName = firstText(item.test_name, item.name, item.label, item.type);
  return testName ? { ...item, test_name: testName, status: firstText(item.status) || "ordered" } : null;
}

function normalizeRadiologyEntry(item) {
  if (typeof item === "string") {
    const studyName = asText(item);
    return studyName ? { name: studyName, study_name: studyName, status: "ordered" } : null;
  }

  if (!item || typeof item !== "object") return null;
  const studyName = firstText(item.study_name, item.name, item.label, item.type);
  return studyName
    ? {
        ...item,
        name: firstText(item.name, studyName),
        study_name: studyName,
        status: firstText(item.status) || "ordered",
      }
    : null;
}

function normalizeProcedureEntry(item) {
  if (typeof item === "string") {
    const name = asText(item);
    return name ? { name, status: "mentioned" } : null;
  }

  if (!item || typeof item !== "object") return null;
  const name = firstText(item.name, item.label, item.type);
  return name ? { ...item, name, status: firstText(item.status) || "mentioned" } : null;
}

function normalizeTextList(items) {
  return asArray(items)
    .map((item) => {
      if (typeof item === "string") return asText(item);
      if (item && typeof item === "object") {
        return firstText(item.name, item.label, item.value, item.text, item.summary, item.reason, item.type);
      }
      return "";
    })
    .filter(Boolean);
}

function buildClinicalNotes({
  diagnosisText,
  symptoms,
  pastHistoryItems,
  planItems,
  followUpItems,
  transcriptText,
  createdAt,
}) {
  const date = asText(createdAt) || new Date().toISOString();
  const notes = [];

  if (diagnosisText || symptoms.length > 0 || planItems.length > 0) {
    notes.push({
      type: "Live Conversation Summary",
      author: "Live Conversation",
      date,
      summary: diagnosisText || "Clinical summary recorded during live conversation.",
      background: pastHistoryItems.join(", "),
      assessment: symptoms.join(", "),
      recommendations: planItems.join("; "),
      pending_items: followUpItems,
      risk_flags: [],
      source_excerpt: transcriptText ? [transcriptText.slice(0, 280)] : [],
      source_type: "live_conversation",
      is_synthetic: true,
      confidence: "medium",
    });
  }

  return notes;
}

function buildVoiceSourceData({ draft, linkedPatient, encounterLabel, createdAt, transcriptText, sessionId }) {
  const normalizedDraft = normalizeLiveDraft(draft || {});
  const chiefComplaint = asText(normalizedDraft.chiefComplaint);
  const hpi = asText(normalizedDraft.hpi);
  const ros = normalizeTextList(normalizedDraft.ros);
  const pastHistoryItems = normalizeTextList(normalizedDraft.pastHistory);
  const diagnosisText = asText(normalizedDraft.diagnosis);
  const symptoms = normalizeTextList(normalizedDraft.symptoms);
  const planItems = normalizeTextList(normalizedDraft.plan);
  const followUpItems = normalizeTextList(normalizedDraft.followUp || normalizedDraft.follow_up);
  const medications = asArray(normalizedDraft.medications).map(normalizeMedicationEntry).filter(Boolean);
  const investigations = asArray(normalizedDraft.labs).map(normalizeInvestigationEntry).filter(Boolean);
  const radiology = asArray(normalizedDraft.radiology).map(normalizeRadiologyEntry).filter(Boolean);
  const procedures = asArray(normalizedDraft.procedures).map(normalizeProcedureEntry).filter(Boolean);

  return {
    patient: {
      name: firstText(linkedPatient, normalizedDraft.patient.name),
      age: normalizedDraft.patient.age,
      gender: asText(normalizedDraft.patient.gender),
      mrn: asText(encounterLabel),
      hospital_no: asText(encounterLabel),
    },
    diagnosis: {
      principal: diagnosisText
        ? {
            name: diagnosisText,
            description: diagnosisText,
            status: "active",
          }
        : null,
      secondary: [],
      comorbidities: pastHistoryItems,
      symptoms,
      icd_code: "",
    },
    chief_complaint: chiefComplaint,
    hpi,
    ros,
    medications,
    investigations,
    radiology,
    procedures,
    treatment: {
      current_approach: planItems[0] || "",
      management_items: planItems,
      procedures: procedures.map((item) => item.name || "").filter(Boolean),
    },
    follow_up: {
      items: followUpItems,
    },
    clinical_notes: buildClinicalNotes({
      diagnosisText,
      symptoms,
      pastHistoryItems,
      planItems,
      followUpItems,
      transcriptText,
      createdAt,
    }),
    vitals: normalizedDraft.vitals,
    transcript: transcriptText,
    meta: {
      source_type: "voice",
      document_type: "live_conversation",
      sessionType: "live_conversation",
      sessionId,
      patientName: firstText(linkedPatient, normalizedDraft.patient.name),
      encounterLabel: asText(encounterLabel),
      department_type: "Live Conversation",
      processed_at: asText(createdAt) || new Date().toISOString(),
      agent_version: dashboardMapper.version,
    },
  };
}

function buildLiveConversationResult({
  documentId,
  sessionId,
  linkedPatient,
  encounterLabel,
  draftExtraction,
  transcript,
  createdAt,
  sttBackend,
}) {
  const transcriptText = firstText(transcript?.normalizedText, transcript?.rawText);
  const sourceData = buildVoiceSourceData({
    draft: draftExtraction || {},
    linkedPatient,
    encounterLabel,
    createdAt,
    transcriptText,
    sessionId,
  });
  const mappedDashboard = dashboardMapper.mapVoiceData(sourceData) || {};
  const samplePatientData = mappedDashboard.sample_patient_data || dashboardMapper.buildSamplePatientData(sourceData);

  samplePatientData.name = firstText(samplePatientData.name, linkedPatient);
  samplePatientData.mrn = firstText(samplePatientData.mrn, encounterLabel);
  samplePatientData.summary = dashboardMapper.generatePatientSummary(sourceData);

  return {
    dashboard_cards: mappedDashboard.dashboard_cards || dashboardMapper.buildDashboardCards(sourceData, {}),
    sample_patient_data: samplePatientData,
    presentation: {
      summary_cards: {},
      notes_rail: [],
    },
    meta: {
      ...sourceData.meta,
      source_type: "voice",
      voice_session_id: documentId,
      stt_backend: asText(sttBackend) || "live_conversation",
      transcript_date: (asText(createdAt) || new Date().toISOString()).split("T")[0],
    },
    extracted_data: sourceData,
    transcript: transcriptText,
    speakers: asArray(transcript?.speakers),
    segments: asArray(transcript?.segments),
    quality: transcript?.quality && typeof transcript.quality === "object" ? transcript.quality : {},
  };
}

function buildLiveConversationDocument(session, options = {}) {
  const createdAt = asText(options.createdAt) || new Date().toISOString();
  const sessionId = asText(session?.id);
  const documentId = asText(options.documentId) || getDocumentIdForSession(sessionId);
  const linkedPatient = firstText(
    session?.linkedPatient,
    session?.draftExtraction?.extractedData?.patient?.name,
    session?.draftExtraction?.extractedData?.patientName,
    session?.transcript?.patientName,
  );
  const encounterLabel = deriveEncounterLabel({
    encounterLabel: session?.encounterLabel,
    sessionId,
  });
  const name = getDisplayName(linkedPatient, encounterLabel);
  const result = buildLiveConversationResult({
    documentId,
    sessionId,
    linkedPatient,
    encounterLabel,
    draftExtraction: session?.draftExtraction?.extractedData,
    transcript: session?.transcript,
    createdAt,
    sttBackend: options.sttBackend || session?.sttBackend,
  });

  return {
    id: documentId,
    type: "voice",
    documentType: "voice",
    documentSubtype: "unknown",
    status: "processed",
    name,
    fileName: name,
    size: Number(session?.audio?.totalBytes) || 0,
    uploadedAt: createdAt,
    processedAt: createdAt,
    department: "Live Conversation",
    mimeType: firstText(session?.audio?.mimeType).split(";")[0] || "audio/webm",
    fileType: firstText(session?.audio?.mimeType).split(";")[0] || "audio/webm",
    durationLabel: formatDurationLabel(session?.durationMs),
    linkedPatient,
    encounterLabel,
    result,
    error: null,
  };
}

function hydrateLiveConversationDocument(document, session) {
  if (!isLiveConversationDocument(document) && !session) return false;

  const sourceSession = session || {
    id: asText(document?.result?.meta?.sessionId),
    linkedPatient: firstText(document?.linkedPatient, document?.result?.meta?.patientName, document?.result?.extracted_data?.patient?.name),
    encounterLabel: firstText(document?.encounterLabel, document?.result?.meta?.encounterLabel),
    durationMs: 0,
    audio: {
      mimeType: firstText(document?.mimeType, document?.fileType),
      totalBytes: Number(document?.size) || 0,
    },
    transcript: {
      rawText: asText(document?.result?.transcript),
      normalizedText: asText(document?.result?.transcript),
      speakers: asArray(document?.result?.speakers),
      segments: asArray(document?.result?.segments),
      quality: document?.result?.quality && typeof document.result.quality === "object" ? document.result.quality : {},
    },
    draftExtraction: {
      extractedData: document?.result?.extracted_data || {},
    },
    sttBackend: asText(document?.result?.meta?.stt_backend),
  };

  const normalized = buildLiveConversationDocument(sourceSession, {
    documentId: document.id,
    createdAt: document.processedAt || document.uploadedAt || new Date().toISOString(),
    sttBackend: sourceSession.sttBackend,
  });

  Object.assign(document, {
    ...document,
    ...normalized,
    uploadedAt: document.uploadedAt || normalized.uploadedAt,
    processedAt: document.processedAt || normalized.processedAt,
  });

  return true;
}

module.exports = {
  buildLiveConversationDocument,
  buildLiveConversationResult,
  formatDurationLabel,
  getDisplayName,
  getDocumentIdForSession,
  hydrateLiveConversationDocument,
  isLiveConversationDocument,
  deriveEncounterNumber,
};
