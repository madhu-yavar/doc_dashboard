const cors = require("cors");
const crypto = require("crypto");
const express = require("express");
const fs = require("fs/promises");
const http = require("http");
const multer = require("multer");
const path = require("path");

// Load environment variables from .env file
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// Import Agent System
const DocumentTypeRouter = require("../agents/document_type_router.cjs");
const DashboardMapperSkill = require("../skills/clinical/dashboard_mapper.skill.cjs");
const DoctorAssistantAgent = require("../agents/doctor_assistant_agent.cjs");
const ChatExportBuilderSkill = require("../skills/chat/chat_export_builder.skill.cjs");
const SourceHealthTool = require("../tools/chat/source_health.tool.cjs");
const STTRouterAgent = require("../agents/stt_router_agent.cjs");
const VoiceExtractorAgent = require("../agents/voice_extractor_agent.cjs");
const { AuthService } = require("./auth_service.cjs");

// Live Conversation Support
const LiveConversationWebSocket = require("./live_conversation_websocket.cjs");
const LiveConversationRoutes = require("./live_conversation_routes.cjs");
const {
  hydrateLiveConversationDocument,
  isLiveConversationDocument,
} = require("./live_conversation_document.cjs");
const {
  VOICE_DASHBOARD_INCOMPLETE_ERROR,
  validateVoiceDashboardResult,
} = require("./voice_result_validation.cjs");

// Prescription Generation Support
const { PrescriptionService } = require("./prescription_service.cjs");
const prescriptionService = new PrescriptionService();

const app = express();

// Helper function to log with immediate flush (useful for SSE debugging)
function logWithFlush(...args) {
  console.log(...args);
  if (process.stdout.flush) process.stdout.flush();
}

const PORT = Number(process.env.PORT || 8001);
const GEMMA_URL = process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
const MODEL = process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it";
const EXTRACTION_GEMMA_TIMEOUT_MS = Number.parseInt(
  process.env.EXTRACTION_GEMMA_TIMEOUT_MS || process.env.GEMMA_TIMEOUT_MS || "240000",
  10
);
const USE_GEMINI_FOR_EXTERNAL = process.env.USE_GEMINI_FOR_EXTERNAL !== "false";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const storageDir = path.join(__dirname, "storage");
const uploadsDir = path.join(storageDir, "uploads");
const distDir = path.join(__dirname, "..", "dist");
const documentsPath = path.join(storageDir, "documents.json");
const chatSessionsPath = path.join(storageDir, "chat_sessions.json");
const chatActionsPath = path.join(storageDir, "chat_actions.json");
const chatExportsPath = path.join(storageDir, "chat_exports.json");
const searchCachePath = path.join(storageDir, "search_cache.json");
const auditRunsPath = path.join(storageDir, "audit_runs.json");
const auditEventsPath = path.join(storageDir, "audit_events.jsonl");
const voiceSessionsPath = path.join(storageDir, "voice_sessions.json");
const voiceReviewsPath = path.join(storageDir, "voice_reviews.json");
const voiceAudioDir = path.join(storageDir, "voice_audio");
const voiceTranscriptsDir = path.join(storageDir, "voice_transcripts");
const voiceGraphCheckpointsDir = path.join(storageDir, "voice_graph_checkpoints");
const frontendOrigins = new Set(
  [
    process.env.FRONTEND_ORIGIN,
    "http://localhost:8081",
    "http://127.0.0.1:8081",
  ].filter(Boolean)
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 50,
  },
});

// Import Audit Logger - initialized after storage paths are defined
const AuditLogger = require("./audit_logger.cjs");
const { AnalyticsStore, registerAnalyticsRoutes } = require("./analytics_store.cjs");
const auditLogger = new AuditLogger({
  storageDir,
  runsPath: auditRunsPath,
  eventsPath: auditEventsPath
});
const analyticsStore = new AnalyticsStore({
  storageDir,
  databasePath: path.join(storageDir, "analytics.sqlite"),
});
const authService = new AuthService({
  storageDir,
});

// Initialize Live Conversation components
const liveConversationWebSocket = new LiveConversationWebSocket({
  storageDir,
  debug: process.env.LIVE_CONVERSATION_DEBUG === "true",
});
const liveConversationRoutes = new LiveConversationRoutes({
  storageDir,
  documentsPath,
});

app.use(cors({
  origin(origin, callback) {
    if (!origin || frontendOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

// Serve static test page
app.get('/test-agent', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-agent.html'));
});

function publicDocument(document) {
  const { filePath, audioPath, transcriptPath, ...rest } = document;

  if (isLiveConversationDocument(rest) && !rest.result?.dashboard_cards) {
    hydrateLiveConversationDocument(rest, null);
  }

  // Fix status if user_action_required is true but status is "processed"
  const needsAction = rest.result?.meta?.user_action_required ||
                     rest.result?.metadata?.user_action_required ||
                     rest.result?.extracted_data?.meta?.user_action_required;

  if (needsAction && rest.status === "processed") {
    rest.status = "partial";
  }

  // Ensure documentType is set (default to 'pdf' for backward compatibility)
  if (!rest.documentType) {
    rest.documentType = audioPath ? "voice" : "pdf";
  }

  if (rest.documentType === "voice" && (rest.status === "processed" || rest.status === "review_required")) {
    const validation = validateVoiceDashboardResult(rest.result);
    if (!validation.valid) {
      rest.status = "failed";
      rest.error = validation.error || VOICE_DASHBOARD_INCOMPLETE_ERROR;
    }
  }

  return rest;
}

function logVoiceDashboardValidationFailure(message, validation, details = {}) {
  console.warn(message, {
    error: validation?.error || VOICE_DASHBOARD_INCOMPLETE_ERROR,
    details: validation?.details || [],
    ...details,
  });
}

/**
 * Compute SHA-256 hash of a buffer
 * @param {Buffer} buffer - File content buffer
 * @returns {string} Hex-encoded SHA-256 hash
 */
function computeHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function ensureStorage() {
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(voiceAudioDir, { recursive: true });
  await fs.mkdir(voiceTranscriptsDir, { recursive: true });
  await fs.mkdir(voiceGraphCheckpointsDir, { recursive: true });
  await ensureCollectionFile(documentsPath, { documents: [] });
  await ensureCollectionFile(chatSessionsPath, { sessions: [] });
  await ensureCollectionFile(chatActionsPath, { actions: [] });
  await ensureCollectionFile(chatExportsPath, { exports: [] });
  await ensureCollectionFile(searchCachePath, { entries: [] });
  await ensureCollectionFile(voiceSessionsPath, { sessions: [] });
  await ensureCollectionFile(voiceReviewsPath, { reviews: [] });
  await authService.ensureStorage();
  await auditLogger.ensureStorage();
  await analyticsStore.initialize();
}

async function ensureCollectionFile(filePath, initialValue) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(initialValue, null, 2), "utf8");
  }
}

async function readDocuments() {
  await ensureStorage();
  const raw = await fs.readFile(documentsPath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.documents) ? parsed.documents : [];
}

async function writeDocuments(documents) {
  await ensureStorage();
  await fs.writeFile(documentsPath, JSON.stringify({ documents }, null, 2), "utf8");
}

async function readCollection(filePath, key) {
  try {
    await ensureStorage();
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed[key]) ? parsed[key] : [];
  } catch (error) {
    console.error(`Error reading collection from ${filePath}:`, error.message);
    return [];
  }
}

async function writeCollection(filePath, key, items) {
  await ensureStorage();
  await fs.writeFile(filePath, JSON.stringify({ [key]: items }, null, 2), "utf8");
}

let documentMutationQueue = Promise.resolve();
let voiceSessionMutationQueue = Promise.resolve();

function queueDocumentMutation(task) {
  const run = documentMutationQueue.then(task, task);
  documentMutationQueue = run.catch(() => {});
  return run;
}

function queueVoiceSessionMutation(task) {
  const run = voiceSessionMutationQueue.then(task, task);
  voiceSessionMutationQueue = run.catch(() => {});
  return run;
}

async function mutateDocuments(mutator) {
  return queueDocumentMutation(async () => {
    const documents = await readDocuments();
    const value = await mutator(documents);
    await writeDocuments(documents);
    return value;
  });
}

async function updateDocument(id, updater) {
  return mutateDocuments(async (documents) => {
    const document = documents.find((item) => item.id === id);
    if (!document) {
      return null;
    }

    await updater(document, documents);
    return { ...document };
  });
}

async function readVoiceSessions() {
  return readCollection(voiceSessionsPath, "sessions");
}

async function writeVoiceSessions(sessions) {
  return writeCollection(voiceSessionsPath, "sessions", sessions);
}

async function mutateVoiceSessions(mutator) {
  return queueVoiceSessionMutation(async () => {
    const sessions = await readVoiceSessions();
    const value = await mutator(sessions);
    await writeVoiceSessions(sessions);
    return value;
  });
}

async function updateVoiceSession(id, updater) {
  return mutateVoiceSessions(async (sessions) => {
    const session = sessions.find((item) => item.id === id);
    if (!session) {
      return null;
    }

    await updater(session, sessions);
    return { ...session };
  });
}

async function removeVoiceSession(id) {
  return mutateVoiceSessions(async (sessions) => {
    const index = sessions.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }

    const [session] = sessions.splice(index, 1);
    return session;
  });
}

async function removeDocument(id) {
  return mutateDocuments(async (documents) => {
    const index = documents.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }

    const [document] = documents.splice(index, 1);
    return document;
  });
}

function buildAgentInfo(agentResult) {
  return {
    name: agentResult.agent || agentResult.agentInfo?.name || "Unknown agent",
    version: agentResult.data?.meta?.agent_version || agentResult.agentInfo?.version || "unknown",
    latency: agentResult.latency ?? agentResult.agentInfo?.latency ?? 0,
    tokensUsed: typeof agentResult.tokensUsed === "number" ? agentResult.tokensUsed : (agentResult.agentInfo?.tokensUsed ?? 0),
    providerTokens: agentResult.providerTokens || agentResult.agentInfo?.providerTokens || null,
    steps: Array.isArray(agentResult.steps) ? agentResult.steps : [],
    validation: agentResult.validation || agentResult.agentInfo?.validation || null,
  };
}

function mergeAgentInfoForResume(existingAgentInfo, agentResult) {
  const previous = existingAgentInfo || {};
  const nextBase = buildAgentInfo(agentResult);

  const previousProviderTokens = previous.providerTokens || {};
  const nextProviderTokens = nextBase.providerTokens || {};

  const mergedProviderTokens = {
    gemma:
      typeof nextProviderTokens.gemma === "number" && nextProviderTokens.gemma > 0
        ? nextProviderTokens.gemma
        : (previousProviderTokens.gemma || 0),
    gemini:
      typeof nextProviderTokens.gemini === "number" && nextProviderTokens.gemini > 0
        ? nextProviderTokens.gemini
        : (previousProviderTokens.gemini || 0),
  };

  const mergedTokensUsed = mergedProviderTokens.gemma + mergedProviderTokens.gemini;

  return {
    ...previous,
    ...nextBase,
    providerTokens: mergedProviderTokens,
    tokensUsed: mergedTokensUsed > 0 ? mergedTokensUsed : (nextBase.tokensUsed || previous.tokensUsed || 0),
    ...(agentResult.agentInfo?.stages?.length
      ? {
          stages: agentResult.agentInfo.stages,
          pipeline: agentResult.agentInfo.pipeline || "two_stage_prescription",
        }
      : {}),
  };
}

function inferDepartment(filename) {
  const lower = filename.toLowerCase();

  if (lower.includes("summary3") || lower.includes("cardio") || lower.includes("chest")) {
    return "Cardiology / Cath Lab";
  }

  if (lower.includes("summary4") || lower.includes("ent")) {
    return "Pediatrics / ENT";
  }

  if (lower.includes("summary5") || lower.includes("neo") || lower.includes("newborn")) {
    return "Neonatal / Pediatrics";
  }

  return "Inpatient nursing / medical";
}

// Audit helper functions
function buildAuditRequestId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sanitizeAuditSummary(value = {}) {
  if (!value || typeof value !== "object") return {};

  return JSON.parse(
    JSON.stringify(value, (_key, current) => {
      if (typeof current === "string" && current.length > 2000) {
        return `${current.slice(0, 1997)}...`;
      }
      return current;
    })
  );
}

async function startAuditRunSafe(options) {
  try {
    return await auditLogger.startRun(options);
  } catch (error) {
    console.error("Audit start failure:", error);
    return null;
  }
}

function createAuditRunContext(run, base = {}) {
  const pending = new Set();
  const runId = run?.runId || null;
  const requestId = run?.requestId || base.requestId || null;

  const track = (operation) => {
    if (!runId) return Promise.resolve(null);

    const wrapped = Promise.resolve()
      .then(operation)
      .catch((error) => {
        console.error("Audit logging failure:", error);
        return null;
      })
      .finally(() => {
        pending.delete(wrapped);
      });

    pending.add(wrapped);
    return wrapped;
  };

  const wait = () => Promise.all(Array.from(pending));

  const event = (type, status = "info", title = "", details = {}) => {
    return track(() => auditLogger.logEvent(runId, {
      workflow: base.workflow,
      documentId: base.documentId,
      chatId: base.chatId,
      requestId,
      type,
      status,
      title,
      details: {
        ...(base.authMetadata || {}),
        ...details,
      },
    }));
  };

  const complete = (summary = {}) => {
    return wait()
      .then(() => runId && auditLogger.completeRun(runId, sanitizeAuditSummary(summary)))
      .catch((error) => {
        console.error("Audit completion failure:", error);
        return null;
      });
  };

  const fail = (error, summary = {}) => {
    return wait()
      .then(() => runId && auditLogger.failRun(runId, error, sanitizeAuditSummary(summary)))
      .catch((err) => {
        console.error("Audit failure logging failure:", err);
        return null;
      });
  };

  return { runId, requestId, event, complete, fail, wait };
}

function extractStepSummary(progress = {}) {
  const { type, step, stepNumber, totalSteps, status, data, error } = progress;
  return {
    type,
    step,
    stepNumber,
    totalSteps,
    status,
    tokens: data?.tokens,
    latency: data?.latency,
    error,
  };
}

// NOTE: Agent System now handles PDF processing and data extraction
// The legacy functions have been replaced by:
// - DocumentTypeRouter (auto-detects doc type and routes to appropriate agent)
// - DischargeExtractorAgent, OutpatientExtractorAgent, LabReportExtractorAgent, ChartNoteExtractorAgent
// - DashboardMapperSkill (transforms data to dashboard card format)

// Initialize Document Router (auto-detects document type and routes to appropriate extractor)
const documentRouter = new DocumentTypeRouter({
  gemma: {
    baseUrl: GEMMA_URL,
    model: MODEL,
    timeout: EXTRACTION_GEMMA_TIMEOUT_MS
  }
});

// Initialize Dashboard Mapper
const dashboardMapper = new DashboardMapperSkill();
const chatExportBuilder = new ChatExportBuilderSkill();
const sourceHealthTool = new SourceHealthTool();

// STT Router Agent - Agentic orchestration for Speech-to-Text
const voiceTranscriptionTool = new STTRouterAgent({
  primaryBackend: process.env.STT_BACKEND || "whisper",
  enableFallback: true,
  whisperUrl: process.env.WHISPER_STT_URL,
  language: process.env.WHISPER_LANGUAGE || "auto",
  temperature: process.env.WHISPER_TEMPERATURE || "0",
  geminiModel: process.env.VOICE_GEMINI_MODEL || process.env.GEMINI_MODEL,
  geminiApiKey: process.env.GEMINI_API_KEY,
  debug: process.env.STT_DEBUG === "true",
});

// Initialize Voice Extractor Agent for Phase 2 structured extraction
const voiceExtractorAgent = new VoiceExtractorAgent({
  gemma: {
    baseUrl: GEMMA_URL,
    model: MODEL,
    timeout: 180000,
    defaultJsonMode: true,
  },
  logSteps: true,
});

const doctorAssistantAgent = new DoctorAssistantAgent({
  gemma: {
    baseUrl: GEMMA_URL,
    model: MODEL,
    timeout: 120000,
  },
  gemini: {
    enabled: USE_GEMINI_FOR_EXTERNAL,
    model: GEMINI_MODEL,
    timeout: 120000,
    apiKey: process.env.GEMINI_API_KEY || "",
  },
  readSessions: async () => readCollection(chatSessionsPath, "sessions"),
  writeSessions: async (sessions) => writeCollection(chatSessionsPath, "sessions", sessions),
  readSearchCache: async () => readCollection(searchCachePath, "entries"),
  writeSearchCache: async (entries) => writeCollection(searchCachePath, "entries", entries),
});

// Helper function to transform agent result to dashboard format
async function transformAgentResultToDashboard(agentResult) {
  const data = agentResult.data || {};
  const metadata = agentResult.metadata || data.meta || {};
  // Check both metadata.stage2_masking (from PrescriptionTwoStageAgent) and data.meta.stage2_masking
  const stage2Masking = metadata.stage2_masking || data.meta?.stage2_masking;
  const reviewPages = Array.isArray(stage2Masking?.review_pages)
    ? stage2Masking.review_pages.map((page) => ({
        ...page,
        image_url: page?.image_path
          ? `/storage/masked_images/${path.basename(page.image_path)}`
          : null,
      }))
    : [];

  // Check if agent already returned dashboard-formatted data (e.g., PrescriptionExtractorAgent)
  // This prevents double-mapping which can lose data
  if (data.dashboard_cards && data.sample_patient_data && data.presentation) {
    // Agent already provided dashboard format - use it directly
    return {
      meta: {
        ...metadata,
        ...data.meta
      },
      dashboard_cards: data.dashboard_cards,
      sample_patient_data: data.sample_patient_data,
      presentation: data.presentation || {
        summary_cards: {},
        notes_rail: [],
      },
      extracted_data: data.extracted_data || data,
      // Preserve stage1 and stage3 data for handwriting extraction
      stage1: data.stage1,
      stage3: data.stage3,
      // Add masked image info for privacy verification
      masked_image_path: stage2Masking?.masked_image_path || null,
      masked_image_url: stage2Masking?.masked_image_path
        ? `/storage/masked_images/${path.basename(stage2Masking.masked_image_path)}`
        : null,
      masked_image_pages: reviewPages,
      // Preserve alert metadata (pharmacy and department alerts)
      pharmacy_alert: metadata.pharmacy_alert || null,
      department_alerts: metadata.department_alerts || null,
    };
  }

  // Use the dashboard mapper skill to transform the data
  const mapperResult = await dashboardMapper.execute({ agentResult });

  if (!mapperResult.success) {
    // Fallback to basic transformation if mapper fails
    return {
      meta: agentResult.data?.meta || {},
      dashboard_cards: buildFallbackDashboardCards(agentResult.data),
      sample_patient_data: buildFallbackPatientData(agentResult.data),
      presentation: {
        summary_cards: {},
        notes_rail: [],
      },
      extracted_data: agentResult.data || {},
      // Preserve alert metadata (pharmacy and department alerts)
      pharmacy_alert: metadata.pharmacy_alert || null,
      department_alerts: metadata.department_alerts || null,
    };
  }

  return {
    meta: agentResult.data?.meta || {},
    dashboard_cards: mapperResult.data.dashboard_cards,
    sample_patient_data: mapperResult.data.sample_patient_data,
    presentation: mapperResult.data.presentation || {
      summary_cards: {},
      notes_rail: [],
    },
    extracted_data: agentResult.data || {},
    // Preserve stage1 and stage3 data for handwriting extraction
    stage1: agentResult.data?.stage1,
    stage3: agentResult.data?.stage3,
    // Add masked image info for privacy verification
    masked_image_path: stage2Masking?.masked_image_path || null,
    masked_image_url: stage2Masking?.masked_image_path
      ? `/storage/masked_images/${path.basename(stage2Masking.masked_image_path)}`
      : null,
    masked_image_pages: reviewPages,
    // Preserve alert metadata (pharmacy and department alerts)
    pharmacy_alert: metadata.pharmacy_alert || null,
    department_alerts: metadata.department_alerts || null,
  };
}

// Fallback dashboard cards builder
function buildFallbackDashboardCards(data) {
  return {
    vitals_card: {
      icon: "📊",
      title: "Vital Signs",
      status: "stable",
      summary: { latest_bp: "", pulse: 0, temp: 0, spo2: 0 },
      trend: "stable",
      data_points: 0,
      has_alerts: false
    },
    diagnosis_card: {
      icon: "🩺",
      title: "Diagnosis",
      principal_diagnosis: data?.diagnosis?.principal || "",
      icd_code: data?.diagnosis?.icd_code || "",
      secondary_count: 0,
      secondary_diagnoses: [],
      procedures_count: 0
    },
    medications_card: {
      icon: "💊",
      title: "Medications",
      active_count: Array.isArray(data?.medications) ? data.medications.length : 0,
      allergy_count: Array.isArray(data?.allergies) ? data.allergies.length : 0,
      allergies: data?.allergies || [],
      categories: []
    },
    labs_card: {
      icon: "🔬",
      title: "Laboratory Results",
      total_tests: 0,
      abnormal_count: 0,
      critical_count: 0,
      pending_count: 0,
      top_abnormal: ""
    },
    risk_card: {
      icon: "⚠️",
      title: "Risk Assessment",
      fall_risk: data?.risk_scores?.fall_risk || { score: 0, level: "Unknown" },
      dvt_risk: data?.risk_scores?.dvt_risk || { score: 0, level: "Unknown" },
      pressure_ulcer_risk: data?.risk_scores?.pressure_ulcer_risk || { score: 0, level: "Unknown" },
      aspiration_risk: data?.risk_scores?.aspiration_risk || { score: 0, level: "Unknown" },
      ews_score: data?.risk_scores?.ews_score || 0,
      overall_status: "stable"
    },
    radiology_card: {
      icon: "🫀",
      title: "Radiology & Imaging",
      studies_completed: 0,
      critical_findings: 0,
      key_finding: ""
    },
    treatment_card: {
      icon: "🏥",
      title: "Treatment & Procedures",
      procedures_performed: 0,
      surgeries: 0,
      response: "Good"
    },
    clinical_notes_card: {
      icon: "📝",
      title: "Clinical Notes",
      total_notes: Array.isArray(data?.clinical_notes) ? data.clinical_notes.length : 0,
      last_update: data?.clinical_notes?.[0]?.date || data?.meta?.processed_at || new Date().toISOString(),
      notes: Array.isArray(data?.clinical_notes)
        ? data.clinical_notes.map((note) => ({
            type: note.type || "Clinical Note",
            author: note.author || "",
            date: note.date || "",
            summary: note.summary || ""
          }))
        : []
    },
    discharge_plan_card: {
      icon: "📋",
      title: "Discharge Plan",
      condition: "Stable",
      instruction_count: 0,
      red_flags: 0
    },
    follow_up_card: {
      icon: "📅",
      title: "Follow-Up",
      next_appointment: "",
      appointment_count: 0
    }
  };
}

// Fallback patient data builder
function buildFallbackPatientData(data) {
  const patient = data?.patient || {};
  return {
    name: patient.name || "",
    age: patient.age ?? null,
    mrn: patient.mrn || "",
    admission_date: patient.admission_date || data?.meta?.rx_date || "",
    discharge_date: patient.discharge_date || "",
    los_days: patient.los_days ?? null,
    summary: `Processed via Agent System v2.0.0.`
  };
}

function formatVoiceTimeLabel(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function estimateVoiceDurationLabel(size = 0) {
  const estimatedSeconds = Math.max(30, Math.min(4 * 60, Math.round(size / 24000)));
  return formatVoiceTimeLabel(estimatedSeconds);
}

function normalizeVoiceText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSpeakerRole(role) {
  if (role === "doctor" || role === "patient") {
    return role;
  }
  return "unknown";
}

function normalizeVoiceFlags(flags = []) {
  const normalized = Array.isArray(flags)
    ? flags
        .map((flag) => normalizeVoiceText(flag).toLowerCase().replace(/\s+/g, "_"))
        .filter(Boolean)
    : [];

  return Array.from(new Set(normalized));
}

function fallbackVoiceTimeLabel(index = 0) {
  return formatVoiceTimeLabel(index * 12);
}

function buildVoiceSegmentsFromTranscript(transcript = {}) {
  const speakers = Array.isArray(transcript.speakers) ? transcript.speakers : [];
  const speakerById = new Map(speakers.map((speaker) => [speaker.id, speaker]));
  const sourceSegments = Array.isArray(transcript.segments) ? transcript.segments : [];

  if (sourceSegments.length === 0) {
    const rawText = normalizeVoiceText(transcript.normalizedText || transcript.rawText);
    return rawText
      ? [
          {
            id: "seg_1",
            speakerRole: "unknown",
            speakerLabel: "Speaker 1",
            startLabel: "00:00",
            endLabel: "00:30",
            text: rawText,
            confidence: null,
            flags: ["fallback_transcript"],
          },
        ]
      : [];
  }

  return sourceSegments.map((segment, index) => {
    const linkedSpeaker = segment?.speakerId ? speakerById.get(segment.speakerId) : null;
    const text = normalizeVoiceText(segment?.text || segment?.normalizedText);
    const confidenceValue = Number(segment?.confidence);
    const flags = normalizeVoiceFlags(segment?.flags);
    const speakerRole = normalizeSpeakerRole(segment?.speakerRole || linkedSpeaker?.role);
    return {
      id: segment?.segmentId || `seg_${index + 1}`,
      speakerRole,
      speakerLabel: normalizeVoiceText(segment?.speakerLabel || linkedSpeaker?.label || `Speaker ${index + 1}`) || `Speaker ${index + 1}`,
      startLabel: normalizeVoiceText(segment?.startLabel) || fallbackVoiceTimeLabel(index),
      endLabel: normalizeVoiceText(segment?.endLabel) || fallbackVoiceTimeLabel(index + 1),
      text: text || "[No transcript text returned]",
      confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : null,
      flags,
    };
  });
}

function buildVoiceTranscriptQuality(transcript = {}, segments = []) {
  const confidences = segments
    .map((segment) => (typeof segment.confidence === "number" ? segment.confidence : null))
    .filter((value) => typeof value === "number");
  const lowConfidenceSegmentCount = segments.filter((segment) =>
    segment.flags.includes("low_confidence") ||
    (typeof segment.confidence === "number" && segment.confidence < 0.75)
  ).length;
  const quality = transcript.quality || {};
  const overallConfidence = typeof quality.overallConfidence === "number"
    ? quality.overallConfidence
    : (confidences.length > 0
        ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2))
        : null);

  const medicationRisk =
    quality.medicationRisk === "high" || quality.medicationRisk === "medium" || quality.medicationRisk === "low"
      ? quality.medicationRisk
      : segments.some((segment) => segment.flags.includes("dosage") || segment.flags.includes("medication"))
        ? "medium"
        : "low";

  return {
    overallConfidence,
    lowConfidenceSegmentCount,
    medicationRisk,
  };
}

function inferVoiceReviewDescriptor(segment) {
  const flags = new Set(segment.flags || []);

  if (flags.has("dosage")) {
    return {
      category: "medication",
      severity: "high",
      reasonCode: "dosage_ambiguity",
      title: "Confirm medication dosage wording",
    };
  }

  if (flags.has("medication")) {
    return {
      category: "medication",
      severity: "medium",
      reasonCode: "low_confidence",
      title: "Confirm medication instruction",
    };
  }

  if (flags.has("labs")) {
    return {
      category: "lab_order",
      severity: "medium",
      reasonCode: "possible_missing_context",
      title: "Confirm lab order wording",
    };
  }

  if (flags.has("radiology")) {
    return {
      category: "radiology_order",
      severity: "medium",
      reasonCode: "possible_missing_context",
      title: "Confirm imaging order wording",
    };
  }

  if (flags.has("follow_up")) {
    return {
      category: "follow_up",
      severity: "low",
      reasonCode: "low_confidence",
      title: "Confirm follow-up instruction",
    };
  }

  return {
    category: "transcript",
    severity: "low",
    reasonCode: "low_confidence",
    title: "Review low-confidence transcript span",
  };
}

function buildVoiceReviewItemsFromTranscript(segments = [], transcript = {}) {
  const reviewItems = [];

  for (const segment of segments) {
    const needsReview =
      segment.flags.includes("requires_review") ||
      segment.flags.includes("low_confidence") ||
      segment.flags.includes("dosage") ||
      segment.flags.includes("medication") ||
      segment.flags.includes("labs") ||
      segment.flags.includes("radiology") ||
      segment.flags.includes("follow_up") ||
      (typeof segment.confidence === "number" && segment.confidence < 0.75);

    if (!needsReview) {
      continue;
    }

    const descriptor = inferVoiceReviewDescriptor(segment);
    reviewItems.push({
      id: crypto.randomUUID(),
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

  if (reviewItems.length === 0 && transcript?.quality?.missingAudioSuspected) {
    reviewItems.push({
      id: crypto.randomUUID(),
      category: "transcript",
      severity: "high",
      reasonCode: "possible_missing_context",
      title: "Review transcript for missing audio",
      extractedValue: "Gemini signaled potential missing audio in the dictation.",
      suggestedValue: "Gemini signaled potential missing audio in the dictation.",
      provenanceText: normalizeVoiceText(transcript.rawText || transcript.normalizedText) || "Transcript quality gate raised a missing-audio flag.",
      provenanceTime: "Full audio",
      resolution: "pending",
      editedValue: "",
    });
  }

  // If we have transcript segments but no review items, create a default approval item
  if (reviewItems.length === 0 && segments.length > 0) {
    const firstSegment = segments[0];
    reviewItems.push({
      id: crypto.randomUUID(),
      category: "transcript",
      severity: "low",
      reasonCode: "transcript_approval",
      title: "Review and approve transcript",
      extractedValue: firstSegment.text || "",
      suggestedValue: firstSegment.text || "",
      provenanceText: firstSegment.text || "",
      provenanceTime: `${firstSegment.startLabel || "00:00"} - ${firstSegment.endLabel || "00:30"}`,
      resolution: "pending",
      editedValue: "",
    });
  }

  return reviewItems;
}

function buildVoiceExtractionPreview(session, transcript = {}, reviewItems = []) {
  const rawText = normalizeVoiceText(transcript.normalizedText || transcript.rawText);
  const lowConfidenceCount = reviewItems.filter((item) => item.resolution === "pending").length;
  const extractedData = session.extractedData || {};

  // Build medications from extracted data
  const medications = (extractedData.medications || []).map((med) => ({
    name: med.name,
    instruction: `${med.dose} ${med.frequency} ${med.route}`.trim(),
    status: med.needs_review ? "review" : "confirmed",
  }));

  // Build labs from extracted data
  const labs = (extractedData.lab_results || []).map((lab) => lab.test_name);

  // Build radiology from extracted data
  const radiology = (extractedData.radiology?.pending || extractedData.radiology || []).map((rad) => {
    const type = rad.type || "";
    const bodyPart = rad.body_part ? ` ${rad.body_part}` : "";
    return type + bodyPart;
  });

  // Build procedures from extracted data
  const procedures = (extractedData.procedures || []).map((proc) => proc.name);

  // Build follow-up from extracted data
  const followUp = (extractedData.follow_up?.items || extractedData.follow_up || []).map((fu) => {
    const specialty = fu.specialty || "";
    const timing = fu.timing || "";
    const reason = fu.reason ? ` - ${fu.reason}` : "";
    // Build clean follow-up string without extra " in" prefix
    const parts = [specialty, timing, reason].filter(Boolean);
    return parts.join(" ").trim();
  });

  return {
    linkedPatient: session.linkedPatient || "Encounter link pending",
    encounterLabel: session.encounterLabel || "Not linked",
    diagnosis: Array.isArray(extractedData.diagnosis?.principal)
      ? (extractedData.diagnosis.principal[0]?.name || "")
      : (extractedData.diagnosis?.principal?.name || ""),
    medications,
    labs,
    radiology,
    procedures,
    followUp,
    clinicalNotes: [
      `Gemini transcription completed for ${session.fileName}.`,
      rawText
        ? `Structured extraction completed. ${medications.length} medications, ${labs.length} labs, ${procedures.length} procedures extracted.`
        : "No transcript text was returned. Review the audio or retry the session.",
      lowConfidenceCount > 0
        ? `${lowConfidenceCount} transcript span${lowConfidenceCount > 1 ? "s" : ""} still require review before downstream mapping.`
        : "No transcript review items remain pending.",
    ],
  };
}

function publicVoiceSession(session) {
  const {
    audioPath,
    hash,
    transcriptPath,
    ...rest
  } = session;

  return {
    ...rest,
    transcriptPath: transcriptPath
      ? `/api/voice/${session.id}`
      : null,
  };
}

function buildVoiceTranscriptObject(source = {}) {
  const sourceSegments = Array.isArray(source.segments) ? source.segments : [];
  const segments = sourceSegments.map((segment, index) => ({
    id: segment.id || segment.segmentId || `seg_${index + 1}`,
    segmentId: segment.segmentId || segment.id || `seg_${index + 1}`,
    speakerId: segment.speakerId || null,
    speakerRole: normalizeSpeakerRole(segment.speakerRole),
    speakerLabel: normalizeVoiceText(segment.speakerLabel || `Speaker ${index + 1}`) || `Speaker ${index + 1}`,
    startLabel: normalizeVoiceText(segment.startLabel) || fallbackVoiceTimeLabel(index),
    endLabel: normalizeVoiceText(segment.endLabel) || fallbackVoiceTimeLabel(index + 1),
    startMs: typeof segment.startMs === "number" ? segment.startMs : null,
    endMs: typeof segment.endMs === "number" ? segment.endMs : null,
    text: normalizeVoiceText(segment.text),
    normalizedText: normalizeVoiceText(segment.normalizedText || segment.text),
    confidence: typeof segment.confidence === "number" ? segment.confidence : null,
    flags: normalizeVoiceFlags(segment.flags),
  }));

  const transcriptText = normalizeVoiceText(
    source.transcript?.normalizedText ||
    source.transcript?.rawText ||
    source.normalizedText ||
    source.rawText ||
    segments.map((segment) => segment.text).join(" ")
  );

  return {
    segments,
    rawText: normalizeVoiceText(source.transcript?.rawText || transcriptText),
    normalizedText: transcriptText,
    language: source.transcript?.language || source.language || null,
    overallConfidence:
      source.transcript?.overallConfidence ??
      source.transcriptQuality?.overallConfidence ??
      null,
  };
}

function buildVoiceDocumentResult({
  documentId,
  uploadedAt,
  sttBackend,
  extractedData,
  dashboardPayload,
}) {
  const normalizeVoiceDashboardSourceData = (data = {}) => {
    const principal = data?.diagnosis?.principal;
    // Handle principal diagnosis as string, object, or array (voice extraction returns array)
    const principalText = typeof principal === "string"
      ? principal
      : Array.isArray(principal)
        ? (principal[0]?.name || principal[0] || "")
        : (principal?.name || principal?.description || "");

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

  console.log(`[deriveVoiceDocumentStatus] hasPendingReview: ${hasPendingReview}, reviewItems.length: ${reviewItems.length}, segments.length: ${session.segments?.length || 0}`);

  if (hasPendingReview) {
    return "review_required";
  }
  // If all reviews are resolved and we have a transcript, we're "processed" (ready for queue/Phase 2)
  if (Array.isArray(session.segments) && session.segments.length > 0) {
    return "processed";
  }
  if (session.extractedData && session.dashboardPayload) {
    return "queued_for_extraction";
  }
  return session.status || "failed";
}

function applyVoiceSessionToDocument(document, voiceSession, options = {}) {
  if (!document || !voiceSession) return false;

  const transcript = buildVoiceTranscriptObject(voiceSession);
  const hasSavedExtraction = Boolean(voiceSession.extractedData && voiceSession.dashboardPayload);
  const candidateResult = hasSavedExtraction
    ? buildVoiceDocumentResult({
        documentId: document.id,
        uploadedAt: voiceSession.uploadedAt || document.uploadedAt,
        sttBackend: voiceSession.sttBackend,
        extractedData: voiceSession.extractedData,
        dashboardPayload: voiceSession.dashboardPayload,
      })
    : document.result;
  const validation = hasSavedExtraction
    ? validateVoiceDashboardResult(candidateResult)
    : { valid: false, error: null, details: [] };
  const hasReusableExtraction = Boolean(hasSavedExtraction && validation.valid);
  const nextStatus = hasReusableExtraction
    ? deriveVoiceDocumentStatus(voiceSession)
    : document.status;

  document.documentType = "voice";
  document.mimeType = voiceSession.mimeType || document.mimeType || "audio/wav";
  document.durationLabel = voiceSession.durationLabel || document.durationLabel || null;
  document.linkedPatient = voiceSession.linkedPatient || document.linkedPatient || "Encounter link pending";
  document.encounterLabel = voiceSession.encounterLabel || document.encounterLabel || "Not linked";
  document.segments = transcript.segments;
  document.transcript = {
    rawText: transcript.rawText,
    normalizedText: transcript.normalizedText,
    language: transcript.language,
    overallConfidence: transcript.overallConfidence,
  };
  document.transcriptQuality = voiceSession.transcriptQuality || document.transcriptQuality || null;
  document.reviewItems = Array.isArray(voiceSession.reviewItems) ? voiceSession.reviewItems : (document.reviewItems || []);
  document.extractionPreview = voiceSession.extractionPreview || document.extractionPreview || null;

  if (hasReusableExtraction) {
    document.result = candidateResult;
    document.status = nextStatus;
    document.error = null;
    document.processedAt = document.processedAt || options.processedAt || new Date().toISOString();
    document.agentInfo = document.agentInfo || {
      name: `${voiceExtractorAgent.name} (reused)`,
      version: voiceExtractorAgent.version || "unknown",
      latency: 0,
      tokensUsed: 0,
      providerTokens: { gemma: 0, gemini: 0 },
      steps: [{ name: "reuse_voice_extraction", status: "completed" }],
      validation: null,
    };
  } else if (hasSavedExtraction) {
    logVoiceDashboardValidationFailure("Rejecting persisted voice extraction during document hydration", validation, {
      documentId: document.id,
      sessionId: voiceSession.id,
    });
    document.status = "failed";
    document.error = validation.error || VOICE_DASHBOARD_INCOMPLETE_ERROR;
    document.result = null;
  }

  return hasReusableExtraction;
}

async function repairVoiceDocumentsFromSessions() {
  const voiceSessions = await readVoiceSessions();
  const sessionById = new Map(voiceSessions.map((session) => [session.id, session]));
  const repairedIds = [];

  await mutateDocuments(async (documents) => {
    for (const document of documents) {
      if ((document.documentType && document.documentType !== "voice") || !sessionById.has(document.id)) {
        continue;
      }

      const voiceSession = sessionById.get(document.id);
      const repaired = applyVoiceSessionToDocument(document, voiceSession);
      if (repaired) {
        repairedIds.push(document.id);
      }
    }
  });

  return repairedIds;
}

async function repairLiveConversationDocuments() {
  const liveSessions = await liveConversationRoutes.store.list();
  const sessionByDocumentId = new Map(
    liveSessions.map((session) => [`voice-live-${session.id}`, session]),
  );
  const repairedIds = [];

  await mutateDocuments(async (documents) => {
    for (const document of documents) {
      if (!isLiveConversationDocument(document)) continue;

      const liveSession = sessionByDocumentId.get(document.id) || null;
      const repaired = hydrateLiveConversationDocument(document, liveSession);
      if (repaired) {
        repairedIds.push(document.id);
      }
    }
  });

  return repairedIds;
}

async function resolveVoiceDocumentProcessing(document) {
  const voiceSessions = await readVoiceSessions();
  const voiceSession = voiceSessions.find((item) => item.id === document.id) || null;

  const storedExtractedData =
    voiceSession?.extractedData ||
    document.result?.extracted_data ||
    null;
  const storedDashboardPayload =
    voiceSession?.dashboardPayload ||
    document.result?.dashboard_cards ||
    document.result?.dashboard_payload ||
    null;
  const sttBackend =
    voiceSession?.sttBackend ||
    document.result?.meta?.stt_backend ||
    "unknown";

  if (storedExtractedData && storedDashboardPayload) {
    const reusedResult = buildVoiceDocumentResult({
      documentId: document.id,
      uploadedAt: document.uploadedAt,
      sttBackend,
      extractedData: storedExtractedData,
      dashboardPayload: storedDashboardPayload,
    });
    const reusedValidation = validateVoiceDashboardResult(reusedResult);
    if (!reusedValidation.valid) {
      logVoiceDashboardValidationFailure("Rejecting stale persisted voice extraction and recomputing", reusedValidation, {
        documentId: document.id,
        sessionId: voiceSession?.id || null,
      });
    } else {
      return {
        agentResult: {
          success: true,
          agent: `${voiceExtractorAgent.name} (reused)`,
          latency: 0,
          tokensUsed: 0,
          steps: [{ name: "reuse_voice_extraction", status: "completed" }],
          metadata: {},
        },
        result: reusedResult,
        reusedExistingExtraction: true,
      };
    }
  }

  let transcriptObject = buildVoiceTranscriptObject(voiceSession || document);

  if (!transcriptObject.normalizedText && transcriptObject.segments.length === 0) {
    const audioPath = voiceSession?.audioPath || document.filePath;
    const mimeType = voiceSession?.mimeType || document.mimeType || "audio/mpeg";

    if (!audioPath) {
      throw new Error("No transcript found for voice document");
    }

    const transcriptionResult = await voiceTranscriptionTool.execute(audioPath, { mimeType });
    if (!transcriptionResult.success) {
      throw new Error(transcriptionResult.error || "Voice transcription failed");
    }

    const transcript = transcriptionResult.data || {};
    const normalizedSegments = buildVoiceSegmentsFromTranscript(transcript);
    const normalizedQuality = buildVoiceTranscriptQuality(transcript, normalizedSegments);

    transcriptObject = {
      segments: normalizedSegments,
      rawText: normalizeVoiceText(transcript.rawText),
      normalizedText: normalizeVoiceText(transcript.normalizedText || transcript.rawText),
      language: transcript.language || null,
      overallConfidence: normalizedQuality.overallConfidence,
    };

    if (voiceSession) {
      await updateVoiceSession(document.id, async (currentSession) => {
        currentSession.sttBackend = `Gemini ${transcriptionResult.model || voiceTranscriptionTool.model}`;
        currentSession.transcriptQuality = normalizedQuality;
        currentSession.segments = normalizedSegments;
        currentSession.error = null;
      });
    }
  }

  if (!transcriptObject.normalizedText && transcriptObject.segments.length === 0) {
    throw new Error("No transcript found for voice document");
  }

  const voiceResult = await voiceExtractorAgent.execute(document.id, transcriptObject);
  if (!voiceResult.success) {
    throw new Error(voiceResult.errors?.[0]?.error || "Voice extraction failed");
  }

  const nextResult = buildVoiceDocumentResult({
    documentId: document.id,
    uploadedAt: document.uploadedAt,
    sttBackend,
    extractedData: voiceResult.extractedData,
    dashboardPayload: voiceResult.dashboardPayload,
  });
  const nextValidation = validateVoiceDashboardResult(nextResult);
  if (!nextValidation.valid) {
    logVoiceDashboardValidationFailure("Downgrading fresh voice extraction because dashboard payload was incomplete", nextValidation, {
      documentId: document.id,
      sessionId: voiceSession?.id || null,
    });
    throw new Error(nextValidation.error || VOICE_DASHBOARD_INCOMPLETE_ERROR);
  }

  if (voiceSession) {
    await updateVoiceSession(document.id, async (currentSession) => {
      currentSession.extractedData = voiceResult.extractedData;
      currentSession.dashboardPayload = voiceResult.dashboardPayload;
      currentSession.error = null;
    });
  }

  return {
    agentResult: {
      success: true,
      agent: voiceExtractorAgent.name,
      latency: 0,
      tokensUsed: 0,
      steps: voiceResult.steps || [],
      metadata: {},
    },
    result: nextResult,
    reusedExistingExtraction: false,
  };
}

function getSseCorsOrigin(req) {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && frontendOrigins.has(requestOrigin)) {
    return requestOrigin;
  }
  return process.env.FRONTEND_ORIGIN || "http://localhost:8081";
}

function setSseCorsHeaders(req, res) {
  res.setHeader("Access-Control-Allow-Origin", getSseCorsOrigin(req));
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

function buildRequestActor(req, fallback = "system") {
  const username = req?.user?.username;
  const role = req?.user?.role;
  if (!username || !role) {
    return fallback;
  }
  return `${role}:${username}`;
}

function buildRequestAuthMetadata(req, metadata = {}) {
  if (!req?.user) {
    return metadata;
  }

  return {
    ...metadata,
    authenticatedUser: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.displayName,
      role: req.user.role,
    },
    sessionId: req.authSession?.sessionId || null,
  };
}

async function logAuthEvent(type, req, details = {}, overrides = {}) {
  try {
    await auditLogger.appendEvent({
      workflow: "auth",
      requestId: buildAuditRequestId("auth"),
      type,
      status: overrides.status || "info",
      title: overrides.title || type,
      details: buildRequestAuthMetadata(req, details),
    });
  } catch (error) {
    console.error("Auth audit logging failure:", error);
  }
}

function isPublicApiRequest(req) {
  const method = String(req.method || "GET").toUpperCase();
  const routePath = req.path;

  return (
    (method === "GET" && routePath === "/api/health") ||
    (method === "GET" && routePath === "/api/auth/session") ||
    (method === "POST" && routePath === "/api/auth/login") ||
    (method === "POST" && routePath === "/api/auth/logout") ||
    // Prescription generation routes (TODO: require auth in production)
    (routePath.startsWith("/api/prescriptions"))
  );
}

function isAdminOnlyApiRequest(req) {
  const method = String(req.method || "GET").toUpperCase();
  const routePath = req.path;

  if ((method === "GET" && routePath === "/api/agent/status") || (method === "POST" && routePath === "/api/agent/test-pdf")) {
    return true;
  }

  if (
    (method === "GET" && routePath === "/api/chat/source-health") ||
    (method === "GET" && routePath === "/api/analytics/overview") ||
    routePath.startsWith("/api/audit/")
  ) {
    return true;
  }

  if (method === "DELETE" && /^\/api\/documents\/[^/]+$/.test(routePath)) {
    return true;
  }

  if (method === "DELETE" && /^\/api\/voice\/[^/]+$/.test(routePath)) {
    return true;
  }

  if (
    method === "POST" &&
    (/^\/api\/documents\/[^/]+\/alert-preview$/.test(routePath) ||
      /^\/api\/documents\/[^/]+\/send-alerts$/.test(routePath))
  ) {
    return true;
  }

  return false;
}

app.post("/api/auth/login", async (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  const loginResult = await authService.login(username, password);
  if (!loginResult) {
    await logAuthEvent(
      "auth_login_failed",
      null,
      {
        attemptedUsername: username,
      },
      {
        status: "warning",
        title: "Login failed",
      }
    );
    return res.status(401).json({ error: "Invalid username or password." });
  }

  authService.setSessionCookie(res, loginResult.session.sessionId);
  req.user = loginResult.user;
  req.authSession = loginResult.session;

  await logAuthEvent(
    "auth_login_succeeded",
    req,
    {
      username: loginResult.user.username,
      role: loginResult.user.role,
    },
    {
      status: "success",
      title: "Login succeeded",
    }
  );

  return res.json({ user: loginResult.user });
});

app.get("/api/auth/session", async (req, res) => {
  const session = await authService.getSessionFromRequest(req, { touch: true });
  if (!session) {
    authService.clearSessionCookie(res);
    return res.json({ authenticated: false, user: null });
  }

  return res.json({
    authenticated: true,
    user: session.user,
  });
});

app.post("/api/auth/logout", async (req, res) => {
  const session = await authService.getSessionFromRequest(req, { touch: false });
  if (session) {
    req.user = session.user;
    req.authSession = session;
    await authService.logout(session.sessionId);
    await logAuthEvent(
      "auth_logout",
      req,
      {
        username: session.user.username,
        role: session.user.role,
      },
      {
        status: "success",
        title: "Logout",
      }
    );
  }

  authService.clearSessionCookie(res);
  return res.json({ success: true });
});

app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api")) {
    return next();
  }

  if (req.method === "OPTIONS" || isPublicApiRequest(req)) {
    return next();
  }

  try {
    const session = await authService.getSessionFromRequest(req, { touch: true });
    if (!session) {
      authService.clearSessionCookie(res);
      return res.status(401).json({ error: "Authentication required" });
    }

    req.authSession = session;
    req.user = session.user;

    if (isAdminOnlyApiRequest(req) && req.user.role !== "admin") {
      await logAuthEvent(
        "auth_forbidden",
        req,
        {
          path: req.path,
          method: req.method,
        },
        {
          status: "warning",
          title: "Forbidden request",
        }
      );
      return res.status(403).json({ error: "Admin access required" });
    }

    return next();
  } catch (error) {
    console.error("Auth middleware failure:", error);
    return res.status(500).json({ error: "Authentication check failed" });
  }
});

registerAnalyticsRoutes(app, analyticsStore, readDocuments);

// Register Live Conversation routes
liveConversationRoutes.registerRoutes(app, authService);

async function requireAuthenticatedAssetAccess(req, res, next) {
  try {
    const session = await authService.getSessionFromRequest(req, { touch: true });
    if (!session) {
      authService.clearSessionCookie(res);
      return res.status(401).json({ error: "Authentication required" });
    }

    req.authSession = session;
    req.user = session.user;
    return next();
  } catch (error) {
    console.error("Asset auth failure:", error);
    return res.status(500).json({ error: "Authentication check failed" });
  }
}

app.get("/api/health", async (_req, res) => {
  res.json({
    status: "ok",
    server: "root",
    version: "2.0.0",
    model: MODEL,
    audit: { enabled: true },
    timestamp: new Date().toISOString()
  });
});

app.get("/api/agent/status", async (_req, res) => {
  const agentStatus = documentRouter.getStatus();
  res.json({
    agent: {
      name: agentStatus.name,
      version: agentStatus.version,
      type: agentStatus.type,
      skillsCount: agentStatus.skillsCount,
      toolsCount: agentStatus.toolsCount,
      config: {
        maxRetries: agentStatus.config.maxRetries,
        timeoutPerStep: agentStatus.config.timeoutPerStep,
        totalTimeout: agentStatus.config.totalTimeout,
        requireAllSteps: agentStatus.config.requireAllSteps,
        logSteps: agentStatus.config.logSteps,
        saveIntermediates: agentStatus.config.saveIntermediates
      }
    },
    gemma: {
      url: GEMMA_URL,
      model: MODEL
    },
    dashboardMapper: {
      name: dashboardMapper.name,
      version: dashboardMapper.version
    }
  });
});

// Audit endpoints
app.get("/api/audit/runs", async (req, res) => {
  try {
    const { workflow, documentId, chatId, status, limit } = req.query;
    const runs = await auditLogger.getRuns({ workflow, documentId, chatId, status, limit });
    res.json({ runs });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch audit runs" });
  }
});

app.get("/api/audit/runs/:runId", async (req, res) => {
  try {
    const run = await auditLogger.getRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ error: "Audit run not found" });
    }
    res.json({ run });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch audit run" });
  }
});

app.get("/api/audit/runs/:runId/events", async (req, res) => {
  try {
    const events = await auditLogger.getEvents(req.params.runId, req.query.limit);
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch audit events" });
  }
});

app.get("/api/documents", async (_req, res) => {
  const documents = await readDocuments();
  res.json({ documents: documents.map(publicDocument) });
});

app.get("/api/documents/:id", async (req, res) => {
  const documents = await readDocuments();
  const document = documents.find((item) => item.id === req.params.id);

  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  return res.json({ document: publicDocument(document) });
});

app.get("/api/voice", async (_req, res) => {
  const sessions = await readVoiceSessions();
  const sorted = [...sessions].sort((a, b) => Date.parse(b.uploadedAt || "") - Date.parse(a.uploadedAt || ""));
  res.json({ sessions: sorted.map(publicVoiceSession) });
});

app.get("/api/voice/:id", async (req, res) => {
  const sessions = await readVoiceSessions();
  const session = sessions.find((item) => item.id === req.params.id);

  if (!session) {
    return res.status(404).json({ error: "Voice session not found" });
  }

  return res.json({ session: publicVoiceSession(session) });
});

app.get("/api/voice/:id/audio", async (req, res) => {
  const sessions = await readVoiceSessions();
  const session = sessions.find((item) => item.id === req.params.id);

  if (!session) {
    return res.status(404).json({ error: "Voice session not found" });
  }

  res.setHeader("Content-Type", session.mimeType || "application/octet-stream");
  res.setHeader("Cache-Control", "private, no-store");
  return res.sendFile(session.audioPath);
});

app.post("/api/voice/upload", upload.array("files"), async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  const linkedPatient = typeof req.body?.linkedPatient === "string" ? req.body.linkedPatient.trim() : "";
  const encounterLabel = typeof req.body?.encounterLabel === "string" ? req.body.encounterLabel.trim() : "";

  if (files.length === 0) {
    return res.status(400).json({ error: "No audio files uploaded" });
  }

  const existingSessions = await readVoiceSessions();
  const existingDocuments = await readDocuments();
  const existingHashes = new Map();
  for (const session of existingSessions) {
    if (session.hash) {
      existingHashes.set(session.hash, session);
    }
  }
  // Also check for duplicates in documents collection
  for (const doc of existingDocuments) {
    if (doc.hash && doc.documentType === 'voice') {
      existingHashes.set(doc.hash, doc);
    }
  }

  const uploaded = [];
  const duplicates = [];

  await mutateVoiceSessions(async (sessions) => {
    for (const file of files) {
      const extension = (path.extname(file.originalname) || "").toLowerCase();
      const looksLikeAudio =
        file.mimetype?.startsWith("audio/") ||
        [".wav", ".mp3", ".m4a", ".aac", ".ogg"].includes(extension);

      if (!looksLikeAudio) {
        continue;
      }

      const hash = computeHash(file.buffer);
      const existing = existingHashes.get(hash);
      if (existing) {
        duplicates.push({
          name: file.originalname,
          existingSession: publicVoiceSession(existing),
        });
        continue;
      }

      const id = crypto.randomUUID();
      const safeExtension = extension || ".bin";
      const audioPath = path.join(voiceAudioDir, `${id}${safeExtension}`);
      await fs.writeFile(audioPath, file.buffer);

      const sessionData = {
        id,
        fileName: file.originalname,
        mimeType: file.mimetype || "application/octet-stream",
        size: file.size,
        uploadedAt: new Date().toISOString(),
        durationLabel: estimateVoiceDurationLabel(file.size),
        linkedPatient: linkedPatient || "Encounter link pending",
        encounterLabel: encounterLabel || "Not linked",
        status: "queued",
        sttBackend: "Transcription Service",
        transcriptQuality: {
          overallConfidence: null,
          lowConfidenceSegmentCount: 0,
          medicationRisk: "medium",
        },
        segments: [],
        reviewItems: [],
        extractionPreview: {
          linkedPatient: linkedPatient || "Encounter link pending",
          encounterLabel: encounterLabel || "Not linked",
          diagnosis: "",
          medications: [],
          labs: [],
          radiology: [],
          procedures: [],
          followUp: [],
          clinicalNotes: [],
        },
        audioPath,
        transcriptPath: null,
        dashboardDocumentId: null,
        hash,
        error: null,
      };

      sessions.unshift(sessionData);
      uploaded.push(publicVoiceSession(sessionData));
      existingHashes.set(hash, sessionData);
    }
  });

  // Also create entries in the documents collection for unified queue
  await mutateDocuments(async (documents) => {
    for (const uploadedSession of uploaded) {
      // Check if document already exists
      if (documents.some(d => d.id === uploadedSession.id)) {
        continue;
      }

      const document = {
        id: uploadedSession.id,
        name: uploadedSession.fileName,
        documentType: 'voice',
        size: uploadedSession.size,
        uploadedAt: uploadedSession.uploadedAt,
        status: uploadedSession.status,
        hash: uploadedSession.hash,
        // Voice-specific fields
        audioPath: uploadedSession.audioPath,
        mimeType: uploadedSession.mimeType,
        durationLabel: uploadedSession.durationLabel,
        linkedPatient: uploadedSession.linkedPatient,
        encounterLabel: uploadedSession.encounterLabel,
        // Transcript and extraction (will be populated later)
        segments: [],
        transcript: null,
        extractionPreview: uploadedSession.extractionPreview,
        reviewItems: [],
        // Placeholder for result (will be populated after extraction)
        result: null,
      };

      documents.unshift(document);
    }
  });

  return res.status(201).json({ sessions: uploaded, duplicates });
});

app.post("/api/voice/process", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];

  if (ids.length === 0) {
    return res.status(400).json({ error: "No voice session ids provided" });
  }

  const updated = [];
  const reviewEvents = [];

  for (const id of ids) {
    const queuedSession = await updateVoiceSession(id, async (currentSession) => {
      currentSession.status = "transcribing";
      currentSession.error = null;
    });

    // Sync transcribing status to documents collection
    await mutateDocuments(async (documents) => {
      const doc = documents.find(d => d.id === id && d.documentType === 'voice');
      if (doc) {
        doc.status = "transcribing";
      }
    });

    if (!queuedSession) {
      continue;
    }

    const transcriptionResult = await voiceTranscriptionTool.executeWithProgress(queuedSession.audioPath, {
      mimeType: queuedSession.mimeType,
    }, async (progress) => {
      // Update voice session with progress message
      await updateVoiceSession(id, async (currentSession) => {
        currentSession.progressMessage = progress.message;
        currentSession.progressStage = progress.stage;
        currentSession.progressPercent = progress.progress;
      });
    });

    if (!transcriptionResult.success) {
      const failedSession = await updateVoiceSession(id, async (currentSession) => {
        currentSession.status = "failed";
        currentSession.error = transcriptionResult.error || "Transcription failed.";
      });

      if (failedSession) {
        updated.push(publicVoiceSession(failedSession));
        reviewEvents.push({
          id: crypto.randomUUID(),
          sessionId: failedSession.id,
          type: "voice_transcription_failed",
          createdAt: new Date().toISOString(),
          error: failedSession.error,
        });

        // Sync failed status to documents collection
        await mutateDocuments(async (documents) => {
          const doc = documents.find(d => d.id === id && d.documentType === 'voice');
          if (doc) {
            doc.status = "failed";
            doc.error = failedSession.error;
          }
        });
      }

      continue;
    }

    const transcript = transcriptionResult.data || {};
    const normalizedSegments = buildVoiceSegmentsFromTranscript(transcript);
    const normalizedQuality = buildVoiceTranscriptQuality(transcript, normalizedSegments);

    // Build transcript object for voice extractor agent
    const transcriptForExtraction = {
      segments: normalizedSegments,
      rawText: normalizeVoiceText(transcript.rawText),
      normalizedText: normalizeVoiceText(transcript.normalizedText || transcript.rawText),
      language: transcript.language || null,
      overallConfidence: normalizedQuality.overallConfidence
    };

    // Phase 2: Run Voice Extractor Agent for structured clinical extraction
    let extractionResult = null;
    let structuredReviewItems = [];
    let extractionError = null;
    let validatedVoiceResult = null;

    try {
      extractionResult = await voiceExtractorAgent.execute(id, transcriptForExtraction);

      if (extractionResult.success) {
        // Convert agent review items to voice session format
        structuredReviewItems = (extractionResult.reviewItems || []).map((item) => ({
          id: item.id,
          category: item.category,
          severity: item.severity,
          reasonCode: item.reasonCode,
          title: item.title,
          extractedValue: JSON.stringify(item.extractedValue),
          suggestedValue: JSON.stringify(item.suggestedValue),
          provenanceText: item.provenanceText,
          provenanceTime: item.provenanceTime,
          resolution: item.resolution || "pending"
        }));

        console.log(`[VoiceExtractor] Session ${id}: extraction completed`, {
          status: extractionResult.status,
          medications: extractionResult.extractedData?.medications?.length || 0,
          diagnosis: extractionResult.extractedData?.diagnosis?.principal ? 1 : 0,
          reviewItems: structuredReviewItems.length
        });
      } else {
        console.error(`[VoiceExtractor] Session ${id}: extraction failed`, extractionResult.errors);
        extractionError = extractionResult.errors?.[0]?.error || "Extraction failed";
      }
    } catch (err) {
      console.error(`[VoiceExtractor] Session ${id}: extraction exception`, err.message);
      extractionError = err.message;
    }

    // Merge transcript-level and extraction-level review items
    const transcriptReviewItems = buildVoiceReviewItemsFromTranscript(normalizedSegments, transcript);
    const allReviewItems = [...transcriptReviewItems, ...structuredReviewItems];

    if (extractionResult?.success) {
      validatedVoiceResult = buildVoiceDocumentResult({
        documentId: id,
        uploadedAt: queuedSession.uploadedAt,
        sttBackend: `Gemini ${transcriptionResult.model || voiceTranscriptionTool.model}`,
        extractedData: extractionResult.extractedData,
        dashboardPayload: extractionResult.dashboardPayload,
      });
      const validation = validateVoiceDashboardResult(validatedVoiceResult);
      if (!validation.valid) {
        extractionError = validation.error || VOICE_DASHBOARD_INCOMPLETE_ERROR;
        validatedVoiceResult = null;
        logVoiceDashboardValidationFailure("Downgrading voice upload processing result because dashboard payload was incomplete", validation, {
          documentId: id,
          sessionId: id,
        });
      }
    }

    const session = await updateVoiceSession(id, async (currentSession) => {
      // If extraction failed, mark session as failed with error message
      if (extractionError) {
        currentSession.status = "failed";
        currentSession.error = `Extraction failed: ${extractionError}`;
        currentSession.sttBackend = `Gemini ${transcriptionResult.model || voiceTranscriptionTool.model}`;
        currentSession.transcriptQuality = normalizedQuality;
        currentSession.segments = normalizedSegments;
        currentSession.reviewItems = allReviewItems;
        currentSession.transcriptPath = path.join(voiceTranscriptsDir, `${currentSession.id}.json`);
        return; // Don't continue processing
      }

      // Determine status based on review items
      const hasPendingReview = allReviewItems.some((item) => item.resolution === "pending");
      currentSession.status = hasPendingReview ? "review_required" : "processed";
      currentSession.error = null;
      currentSession.sttBackend = transcriptionResult.backend || `Gemini ${transcriptionResult.model || voiceTranscriptionTool.model}`;
      currentSession.transcriptQuality = normalizedQuality;
      currentSession.segments = normalizedSegments;
      currentSession.reviewItems = allReviewItems;
      // Add STT audit trail for UI console logs
      currentSession.sttAudit = transcriptionResult.audit || {
        backend: transcriptionResult.backend,
        latency: transcriptionResult.latency,
        steps: transcriptionResult.steps?.map(s => ({ name: s.name, status: s.status })),
      };

      // Update durationLabel with actual duration from last segment's endMs
      const lastSegmentWithTime = [...normalizedSegments].reverse().find(s => typeof s.endMs === "number" && s.endMs > 0);
      if (lastSegmentWithTime) {
        const actualSeconds = Math.ceil(lastSegmentWithTime.endMs / 1000);
        currentSession.durationLabel = formatVoiceTimeLabel(actualSeconds);
      }

      // Store extraction result only when the dashboard payload is renderable
      if (extractionResult?.success && validatedVoiceResult) {
        currentSession.extractedData = extractionResult.extractedData;
        currentSession.dashboardPayload = extractionResult.dashboardPayload;
      }

      currentSession.extractionPreview = buildVoiceExtractionPreview(currentSession, transcript, allReviewItems);
      currentSession.transcriptPath = path.join(voiceTranscriptsDir, `${currentSession.id}.json`);

      const transcriptPayload = {
        transcriptId: currentSession.id,
        sourceType: "dictation_upload",
        fileName: currentSession.fileName,
        linkedPatient: currentSession.linkedPatient,
        encounterLabel: currentSession.encounterLabel,
        sttBackend: currentSession.sttBackend,
        model: transcriptionResult.model || voiceTranscriptionTool.model,
        usage: transcriptionResult.usage || null,
        language: transcript.language || null,
        rawText: normalizeVoiceText(transcript.rawText),
        normalizedText: normalizeVoiceText(transcript.normalizedText || transcript.rawText),
        speakers: Array.isArray(transcript.speakers) ? transcript.speakers : [],
        segments: normalizedSegments.map((segment) => ({
          segmentId: segment.id,
          speakerRole: segment.speakerRole,
          speakerLabel: segment.speakerLabel,
          startLabel: segment.startLabel,
          endLabel: segment.endLabel,
          text: segment.text,
          normalizedText: segment.text,
          confidence: segment.confidence,
          flags: segment.flags,
        })),
        quality: {
          ...transcript.quality,
          ...normalizedQuality,
        },
      };

      await fs.writeFile(currentSession.transcriptPath, JSON.stringify(transcriptPayload, null, 2), "utf8");
    });

    if (session) {
      updated.push(publicVoiceSession(session));
      reviewEvents.push({
        id: crypto.randomUUID(),
        sessionId: session.id,
        type: extractionError ? "voice_extraction_failed" : "voice_transcription_completed",
        createdAt: new Date().toISOString(),
        model: transcriptionResult.model || voiceTranscriptionTool.model,
        error: extractionError || undefined,
      });

      // Sync with documents collection
      await mutateDocuments(async (documents) => {
        const docIndex = documents.findIndex(d => d.id === session.id && d.documentType === 'voice');
        if (docIndex >= 0) {
          const doc = documents[docIndex];
          doc.status = extractionError ? "failed" : session.status;
          doc.error = extractionError ? `Extraction failed: ${extractionError}` : session.error;
          doc.sttBackend = session.sttBackend;
          doc.durationLabel = session.durationLabel;
          doc.segments = session.segments;
          doc.transcript = session.transcriptPath ? {
            rawText: normalizeVoiceText(transcript.rawText),
            normalizedText: normalizeVoiceText(transcript.normalizedText || transcript.rawText),
            language: transcript.language || null,
            overallConfidence: normalizedQuality.overallConfidence
          } : null;
          doc.transcriptQuality = session.transcriptQuality;
          doc.extractionPreview = session.extractionPreview;
          doc.reviewItems = session.reviewItems;
          doc.result = validatedVoiceResult;
        }
      });
    }
  }

  if (reviewEvents.length > 0) {
    const reviews = await readCollection(voiceReviewsPath, "reviews");
    reviews.unshift(...reviewEvents);
    await writeCollection(voiceReviewsPath, "reviews", reviews);
  }

  return res.json({ sessions: updated });
});

app.post("/api/voice/:id/review", async (req, res) => {
  const reviewItemId = typeof req.body?.reviewItemId === "string" ? req.body.reviewItemId : "";
  const resolution = typeof req.body?.resolution === "string" ? req.body.resolution : "";
  const editedValue = typeof req.body?.editedValue === "string" ? req.body.editedValue : "";

  if (!reviewItemId || !["approved", "edited", "rejected"].includes(resolution)) {
    return res.status(400).json({ error: "reviewItemId and valid resolution are required" });
  }

  const updatedSession = await updateVoiceSession(req.params.id, async (session) => {
    const reviewItem = session.reviewItems.find((item) => item.id === reviewItemId);
    if (!reviewItem) {
      console.log(`[review] Review item ${reviewItemId} not found in session ${req.params.id}`);
      return;
    }

    console.log(`[review] Before: resolution=${reviewItem.resolution}, status=${session.status}`);
    reviewItem.resolution = resolution;
    if (resolution === "edited") {
      reviewItem.editedValue = editedValue || reviewItem.suggestedValue || reviewItem.extractedValue;
    }

    const hasPending = session.reviewItems.some((item) => item.resolution === "pending");
    session.status = hasPending ? "review_required" : "processed";
    console.log(`[review] After: resolution=${reviewItem.resolution}, hasPending=${hasPending}, new status=${session.status}`);
  });

  if (!updatedSession) {
    return res.status(404).json({ error: "Voice session not found" });
  }

  // Sync review status to documents collection
  await mutateDocuments(async (documents) => {
    const doc = documents.find((d) => d.id === req.params.id && d.documentType === "voice");
    if (doc) {
      doc.status = updatedSession.status;
    }
  });

  const reviews = await readCollection(voiceReviewsPath, "reviews");
  reviews.unshift({
    id: crypto.randomUUID(),
    sessionId: updatedSession.id,
    reviewItemId,
    resolution,
    editedValue: resolution === "edited" ? editedValue : "",
    createdAt: new Date().toISOString(),
    username: req.user?.username || "unknown",
    role: req.user?.role || "unknown",
  });
  await writeCollection(voiceReviewsPath, "reviews", reviews);

  return res.json({ session: publicVoiceSession(updatedSession) });
});

app.post("/api/voice/:id/add-to-queue", async (req, res) => {
  const sessionId = req.params.id;

  const updatedSession = await updateVoiceSession(sessionId, async (session) => {
    // Verify transcript is ready
    if (session.segments.length === 0) {
      throw new Error("Transcript not ready. Please transcribe first.");
    }

    // Verify all reviews are resolved
    const pendingReviews = session.reviewItems.filter((item) => item.resolution === "pending");
    if (pendingReviews.length > 0) {
      throw new Error(`Please resolve ${pendingReviews.length} review item(s) before adding to queue.`);
    }

    // Update status to indicate ready for extraction queue
    session.status = "queued_for_extraction";
  });

  if (!updatedSession) {
    return res.status(404).json({ error: "Voice session not found" });
  }

  // Sync to documents collection with queued status for processing
  await mutateDocuments(async (documents) => {
    const existingDoc = documents.find((d) => d.id === sessionId && d.documentType === "voice");

    if (existingDoc) {
      // Update existing document
      existingDoc.status = "queued";
      existingDoc.segments = updatedSession.segments || [];
      existingDoc.transcript = {
        rawText: updatedSession.segments.map((s) => s.text).join(" "),
        normalizedText: updatedSession.segments.map((s) => s.text).join(" "),
        language: "en",
        overallConfidence: updatedSession.transcriptQuality?.overallConfidence || 0,
      };
    } else {
      // Create new document entry for the queue
      const newDoc = {
        id: updatedSession.id,
        name: updatedSession.fileName,
        size: updatedSession.size,
        uploadedAt: updatedSession.uploadedAt,
        status: "queued",
        department: "Voice Dictation",
        filePath: updatedSession.audioPath,
        hash: updatedSession.hash,
        documentType: "voice",
        durationLabel: updatedSession.durationLabel,
        linkedPatient: updatedSession.linkedPatient,
        encounterLabel: updatedSession.encounterLabel,
        segments: updatedSession.segments,
        transcript: {
          rawText: updatedSession.segments.map((s) => s.text).join(" "),
          normalizedText: updatedSession.segments.map((s) => s.text).join(" "),
          language: "en",
          overallConfidence: updatedSession.transcriptQuality?.overallConfidence || 0,
        },
        result: null,
        error: null,
      };
      documents.unshift(newDoc);
    }
  });

  return res.json({ success: true, session: publicVoiceSession(updatedSession) });
});

app.delete("/api/voice/:id", async (req, res) => {
  const session = await removeVoiceSession(req.params.id);

  if (!session) {
    return res.status(404).json({ error: "Voice session not found" });
  }

  await Promise.all([
    session.audioPath ? fs.rm(session.audioPath, { force: true }) : Promise.resolve(),
    session.transcriptPath ? fs.rm(session.transcriptPath, { force: true }) : Promise.resolve(),
  ]);

  const reviews = await readCollection(voiceReviewsPath, "reviews");
  const filteredReviews = reviews.filter((item) => item.sessionId !== session.id);
  if (filteredReviews.length !== reviews.length) {
    await writeCollection(voiceReviewsPath, "reviews", filteredReviews);
  }

  return res.status(204).end();
});

// Extract clinical data from voice transcripts (called after transcript is approved and added to queue)
app.post("/api/voice/extract", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];

  if (ids.length === 0) {
    return res.status(400).json({ error: "No voice session ids provided" });
  }

  console.log(`\n🔄 Voice extraction request for ${ids.length} session(s)`);
  const processed = [];
  const failed = [];

  for (const id of ids) {
    try {
      // Update status to processing
      await updateVoiceSession(id, async (session) => {
        session.status = "processing";
        session.error = null;
      });

      // Also update documents collection
      await mutateDocuments(async (documents) => {
        const doc = documents.find((d) => d.id === id && d.documentType === "voice");
        if (doc) {
          doc.status = "processing";
        }
      });

      // Get the voice session with transcript
      const voiceSessions = await readVoiceSessions();
      if (!voiceSessions || !Array.isArray(voiceSessions)) {
        throw new Error(`Failed to read voice sessions - got ${typeof voiceSessions}`);
      }
      const session = voiceSessions.find((s) => s.id === id);

      if (!session || !session.segments || session.segments.length === 0) {
        throw new Error("No transcript found for this session");
      }

      // Build transcript for extraction
      const transcriptForExtraction = {
        segments: session.segments.map((s) => ({
          id: s.id,
          speakerRole: s.speakerRole,
          speakerLabel: s.speakerLabel,
          startLabel: s.startLabel,
          endLabel: s.endLabel,
          text: s.text,
          confidence: s.confidence,
          flags: s.flags || [],
        })),
        rawText: session.segments.map((s) => s.text).join(" "),
        normalizedText: session.segments.map((s) => s.text).join(" "),
        language: null,
        overallConfidence: session.transcriptQuality?.overallConfidence || 0,
      };

      // Run VoiceExtractorAgent
      const extractionResult = await voiceExtractorAgent.execute(id, transcriptForExtraction);

      if (!extractionResult.success) {
        throw new Error(extractionResult.errors?.[0]?.error || "Extraction failed");
      }

      // Update session with extraction results
      await updateVoiceSession(id, async (currentSession) => {
        currentSession.extractedData = extractionResult.extractedData;
        currentSession.dashboardPayload = extractionResult.dashboardPayload;
        currentSession.status = "processed";
        currentSession.extractionPreview = {
          linkedPatient: currentSession.linkedPatient,
          encounterLabel: currentSession.encounterLabel,
          diagnosis: Array.isArray(extractionResult.extractedData?.diagnosis?.principal)
            ? (extractionResult.extractedData.diagnosis.principal[0]?.name || "")
            : (extractionResult.extractedData?.diagnosis?.principal?.name || ""),
          medications: extractionResult.extractedData?.medications?.map((med) => ({
            name: med.name,
            instruction: `${med.dose} ${med.frequency} ${med.route}`.trim(),
            status: "confirmed",
          })) || [],
          labs: extractionResult.extractedData?.lab_results?.map((lab) => lab.test_name) || [],
          radiology: extractionResult.extractedData?.radiology?.pending?.map((rad) => rad.type) || [],
          procedures: extractionResult.extractedData?.procedures?.map((proc) => proc.name) || [],
          followUp: extractionResult.extractedData?.follow_up?.items?.map((fu) => fu.reason || fu.timing) || [],
          clinicalNotes: ["Voice extraction completed via VoiceExtractorAgent"],
        };
      });

      // Sync to documents collection
      await mutateDocuments(async (documents) => {
        const docIndex = documents.findIndex((d) => d.id === id && d.documentType === "voice");
        if (docIndex >= 0) {
          const doc = documents[docIndex];
          doc.status = "processed";
          doc.result = buildVoiceDocumentResult({
            documentId: id,
            uploadedAt: session.uploadedAt,
            sttBackend: session.sttBackend,
            extractedData: extractionResult.extractedData,
            dashboardPayload: extractionResult.dashboardPayload,
          });
        }
      });

      processed.push(id);
      console.log(`   ✅ Extraction complete: ${session.fileName}`);
    } catch (error) {
      console.error(`   ❌ Extraction failed for ${id}:`, error.message);

      // Update status to failed
      await updateVoiceSession(id, async (currentSession) => {
        currentSession.status = "failed";
        currentSession.error = error.message;
      });

      await mutateDocuments(async (documents) => {
        const doc = documents.find((d) => d.id === id && d.documentType === "voice");
        if (doc) {
          doc.status = "failed";
          doc.error = error.message;
        }
      });

      failed.push(id);
    }
  }

  console.log(`📊 Voice extraction complete: ${processed.length} success, ${failed.length} failed\n`);
  return res.json({ processed, failed });
});

// ============================================================================
// PRESCRIPTION GENERATION API
// ============================================================================

/**
 * GET /api/prescriptions/data/:documentId
 * Get prescription data for review/edit (without generating files)
 */
app.get("/api/prescriptions/data/:documentId", async (req, res) => {
  try {
    const { documentId } = req.params;
    const data = await prescriptionService.getPrescriptionData(documentId);
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error getting prescription data:", error.message);
    res.status(404).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/prescriptions/generate
 * Generate prescription HTML/PDF from processed document
 * Body: { documentId, format: "html" | "pdf" | "both", updateData }
 */
app.post("/api/prescriptions/generate", async (req, res) => {
  try {
    const { documentId, format = "both", updateData = null } = req.body;

    if (!documentId) {
      return res.status(400).json({ success: false, error: "documentId is required" });
    }

    // Initialize service
    await prescriptionService.initialize();

    // Generate prescription
    const result = await prescriptionService.generatePrescription(documentId, {
      format,
      updateData
    });

    res.json(result);
  } catch (error) {
    console.error("Error generating prescription:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/prescriptions/download/:filename
 * Download generated prescription file
 */
app.get("/api/prescriptions/download/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, "storage", "prescriptions", filename);

    // Security check: ensure filename doesn't contain path traversal
    if (filename.includes("..") || filename.includes("/")) {
      return res.status(400).json({ success: false, error: "Invalid filename" });
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ success: false, error: "File not found" });
    }

    // Determine content type
    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === ".pdf" ? "application/pdf" : "text/html";

    // Send file
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error("Error downloading prescription:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve prescription files as static assets (no auth required for generated prescriptions)
app.use('/prescriptions', express.static(path.join(__dirname, "storage", "prescriptions")));

// Serve live conversation audio files with audio-friendly content types.
app.use('/live-conversation-audio', express.static(path.join(__dirname, "storage", "live_conversation_audio"), {
  setHeaders(res, filePath) {
    const lowerPath = String(filePath || "").toLowerCase();
    if (lowerPath.endsWith(".webm")) {
      res.setHeader("Content-Type", "audio/webm");
      return;
    }
    if (lowerPath.endsWith(".mp4") || lowerPath.endsWith(".m4a")) {
      res.setHeader("Content-Type", "audio/mp4");
      return;
    }
    if (lowerPath.endsWith(".mp3")) {
      res.setHeader("Content-Type", "audio/mpeg");
      return;
    }
    if (lowerPath.endsWith(".ogg")) {
      res.setHeader("Content-Type", "audio/ogg");
    }
  },
}));

// Serve masked images.
// First serve the correct storage location, then fall back to the legacy mistakenly nested path
// so previously generated masked images still load in the UI.
app.use('/storage/masked_images', requireAuthenticatedAssetAccess, express.static(path.join(storageDir, 'masked_images')));
app.use('/storage/masked_images', requireAuthenticatedAssetAccess, express.static(path.join(__dirname, 'server', 'storage', 'masked_images')));

app.use(express.static(distDir));

app.get(/^\/(?!api).*/, (_req, res) => {
  const indexHtml = path.join(distDir, "index.html");
  if (!require("fs").existsSync(indexHtml)) {
    return res.status(503).send("Frontend not built. Run `npm run build` or use Vite dev server at :8080.");
  }
  res.sendFile(indexHtml);
});

app.post("/api/documents/upload", upload.array("files"), async (req, res) => {
  const files = req.files || [];

  console.log(`\n📤 File upload request received: ${files.length} file(s)`);

  if (!Array.isArray(files) || files.length === 0) {
    console.log("❌ No files uploaded");
    return res.status(400).json({ error: "No files uploaded" });
  }

  files.forEach((file, i) => {
    console.log(`   ${i + 1}. ${file.originalname} (${(file.size / 1024).toFixed(1)} KB)`);
  });

  const uploaded = [];
  const duplicates = [];
  const existingDocuments = await readDocuments();

  // Build a map of existing hashes for quick lookup
  const existingHashes = new Map();
  for (const doc of existingDocuments) {
    if (doc.hash) {
      existingHashes.set(doc.hash, doc);
    }
  }

  await mutateDocuments(async (documents) => {
    for (const file of files) {
      // Compute hash of the file content
      const hash = computeHash(file.buffer);

      // Check if this file already exists
      const existingDoc = existingHashes.get(hash);
      if (existingDoc) {
        duplicates.push({
          name: file.originalname,
          existingDocument: publicDocument(existingDoc),
        });
        continue;
      }

      const id = crypto.randomUUID();
      const extension = path.extname(file.originalname) || ".pdf";
      const filePath = path.join(uploadsDir, `${id}${extension}`);

      await fs.writeFile(filePath, file.buffer);

      const document = {
        id,
        name: file.originalname,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        status: "queued",
        department: inferDepartment(file.originalname),
        filePath,
        hash,
        result: null,
        error: null,
      };

      console.log(`   ✅ Saved: ${file.originalname} -> ${id}`);
      documents.unshift(document);
      uploaded.push(publicDocument(document));
    }
  });

  console.log(`📊 Upload complete: ${uploaded.length} new, ${duplicates.length} duplicates\n`);
  res.status(201).json({ documents: uploaded, duplicates });
});

app.post("/api/documents/process", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  // Use provided key or fall back to env
  const geminiApiKey = req.body?.geminiApiKey || process.env.GEMINI_API_KEY || null;

  console.log(`\n🔄 Process request received for ${ids.length} document(s)`);
  console.log(`🔑 Gemini API Key: ${geminiApiKey ? '✓ Provided (' + geminiApiKey.slice(0, 10) + '...)' : '✗ Not provided'}`);

  if (ids.length === 0) {
    console.log("❌ No document ids provided");
    return res.status(400).json({ error: "No document ids provided" });
  }

  // Validate Gemini API key format if provided
  if (geminiApiKey && (typeof geminiApiKey !== "string" || !geminiApiKey.startsWith("AIza"))) {
    return res.status(400).json({
      error: "Invalid Gemini API key format",
      code: "GEMINI_API_KEY_INVALID"
    });
  }

  const queuedDocuments = await mutateDocuments(async (documents) => {
    const selected = [];

    for (const id of ids) {
      const document = documents.find((item) => item.id === id);
      if (!document) continue;

      document.status = "processing";
      document.error = null;
      selected.push({
        id: document.id,
        name: document.name,
        filePath: document.filePath,
        department: document.department,
        documentType: document.documentType || 'pdf',
        uploadedAt: document.uploadedAt,
        mimeType: document.mimeType,
        transcript: document.transcript,
        segments: document.segments,
        transcriptQuality: document.transcriptQuality,
        result: document.result,
      });
    }

    return selected;
  });

  console.log(`📋 Queued ${queuedDocuments.length} document(s) for processing:`);
  queuedDocuments.forEach((doc, i) => {
    console.log(`   ${i + 1}. ${doc.name} (${doc.department})`);
  });

  for (const document of queuedDocuments) {
    if (!document) continue;
    console.log(`\n🚀 Starting: ${document.name}`);

    const auditRun = await startAuditRunSafe({
      workflow: "extraction",
      documentId: document.id,
      requestId: buildAuditRequestId("extract"),
      title: document.name,
      actor: buildRequestActor(req, "system"),
      metadata: buildRequestAuthMetadata(req, {
        department: document.department,
        mode: "batch",
      }),
    });

    const audit = createAuditRunContext(auditRun, {
      workflow: "extraction",
      documentId: document.id,
      requestId: auditRun?.requestId || null,
      authMetadata: buildRequestAuthMetadata(req),
    });

    try {
      await audit.event("document_processing_started", "info", "Document processing started", {
        name: document.name,
        hasGeminiKey: !!geminiApiKey,
      });

      let agentResult;
      let result;

      // Handle voice documents with VoiceExtractorAgent
      if (document.documentType === 'voice') {
        console.log(`   🎤 Processing voice document with VoiceExtractorAgent: ${document.name}`);
        const voiceProcessing = await resolveVoiceDocumentProcessing(document);
        agentResult = voiceProcessing.agentResult;
        result = voiceProcessing.result;
      } else {
        // Process PDF documents through standard router
        agentResult = await documentRouter.process(document.filePath, {
          pdfName: document.name,
          geminiApiKey: geminiApiKey,
          onProgress: (progress) => {
            void audit.event("agent_progress", progress.type === "error" ? "error" : "info", progress.step || progress.type || "progress", extractStepSummary(progress));
          },
        });

        if (!agentResult.success) {
          throw new Error(agentResult.error);
        }

        result = await transformAgentResultToDashboard(agentResult);
      }

      const updatedDocument = await updateDocument(document.id, async (currentDocument) => {
        currentDocument.status = agentResult.metadata?.user_action_required ? "partial" : "processed";
        currentDocument.department = result?.meta?.department_type || currentDocument.department || (document.documentType === 'voice' ? 'Voice Dictation' : undefined);
        currentDocument.result = result;
        currentDocument.agentInfo = buildAgentInfo(agentResult);
        currentDocument.error = null;
        currentDocument.processedAt = new Date().toISOString();
        currentDocument.auditRunId = auditRun?.runId;
      });
      await analyticsStore.upsertDocumentMetrics(updatedDocument);

      await audit.complete({
        documentId: document.id,
        agentName: agentResult.agent,
        latency: agentResult.latency,
        tokensUsed: agentResult.tokensUsed,
        stepsCount: agentResult.steps?.length || 0,
      });
    } catch (error) {
      await audit.fail(error, {
        documentId: document.id,
      });
      await updateDocument(document.id, async (currentDocument) => {
        currentDocument.status = "failed";
        currentDocument.error = error instanceof Error ? error.message : "Unknown processing error";
        if (document.documentType === "voice") {
          currentDocument.result = null;
        }
      });
    }
  }

  const documents = await readDocuments();
  res.json({ documents: documents.map(publicDocument) });
});

app.delete("/api/documents/:id", async (req, res) => {
  const document = await removeDocument(req.params.id);

  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  if (document.documentType === "voice") {
    const session = await updateVoiceSession(document.id, async (currentSession) => {
      const hasPendingReview = Array.isArray(currentSession.reviewItems)
        && currentSession.reviewItems.some((item) => item.resolution === "pending");
      currentSession.status = hasPendingReview ? "review_required" : "processed";
    });

    if (session) {
      await analyticsStore.deleteDocumentMetrics(document.id);
      return res.status(204).end();
    }
  }

  const cleanupPaths = new Set(
    [document.filePath, document.audioPath, document.transcriptPath]
      .filter((value) => typeof value === "string" && value.trim())
  );

  await Promise.all(Array.from(cleanupPaths).map((filePath) => fs.rm(filePath, { force: true })));
  await analyticsStore.deleteDocumentMetrics(document.id);
  res.status(204).end();
});

// SSE endpoint for real-time processing progress
app.get("/api/documents/process/progress", async (req, res) => {
  const documentId = req.query.documentId;
  // Fall back to env key if not provided - allows bulk processing with server-side key
  const geminiApiKey = req.query.geminiApiKey || req.query.apiKey || process.env.GEMINI_API_KEY || null;

  if (!documentId) {
    return res.status(400).json({ error: "documentId required" });
  }

  // Set headers for SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  setSseCorsHeaders(req, res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: "connected", documentId, hasGeminiKey: !!geminiApiKey })}\n\n`);

  // Process the document with progress callbacks
  let audit;
  let auditRun;

  try {
    const documents = await readDocuments();
    const document = documents.find((item) => item.id === documentId);

    if (!document) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Document not found" })}\n\n`);
      res.end();
      return;
    }

    // Handle voice documents - use VoiceExtractorAgent with DashboardMapper
    if (document.documentType === 'voice') {
      console.log(`   🎤 Processing voice document with VoiceExtractorAgent: ${document.name}`);

      try {
        // Initialize audit run for voice processing
        auditRun = await startAuditRunSafe({
          workflow: "extraction",
          documentId: document.id,
          requestId: buildAuditRequestId("extract"),
          title: document.name,
          actor: buildRequestActor(req, "system"),
          metadata: buildRequestAuthMetadata(req, {
            department: document.department,
            mode: "interactive_sse",
          }),
        });
        audit = createAuditRunContext(auditRun, {
          workflow: "extraction",
          documentId: document.id,
          requestId: auditRun?.requestId || null,
          authMetadata: buildRequestAuthMetadata(req),
        });

        await audit.event("document_processing_started", "info", "Document processing started", {
          name: document.name,
          hasGeminiKey: !!geminiApiKey,
        });

        // Send SSE start event
        res.write(`data: ${JSON.stringify({ type: 'start', documentId, totalSteps: 4, stage: 'voice_extraction' })}\n\n`);

        const voiceProcessing = await resolveVoiceDocumentProcessing(document);

        // Send SSE complete event
        res.write(`data: ${JSON.stringify({
          type: 'complete',
          documentId,
          stepNumber: 4,
          totalSteps: 4,
          stepName: 'Voice extraction completed',
          tokensUsed: 0
        })}\n\n`);

        const result = voiceProcessing.result;
        const validation = validateVoiceDashboardResult(result);
        if (!validation.valid) {
          logVoiceDashboardValidationFailure("Rejecting voice SSE result because dashboard payload was incomplete", validation, {
            documentId,
            sessionId: document.id,
          });
          throw new Error(validation.error || VOICE_DASHBOARD_INCOMPLETE_ERROR);
        }
        const agentInfo = voiceProcessing.agentResult;

        // Update document with standard result structure including dashboard_cards
        const updatedDocument = await updateDocument(documentId, async (currentDocument) => {
          currentDocument.status = "processed";
          currentDocument.department = "Voice Dictation";
          currentDocument.result = result;
          currentDocument.agentInfo = {
            agent: agentInfo.agent,
            version: voiceExtractorAgent.version,
            latency: agentInfo.latency || 0,
            timestamp: new Date().toISOString()
          };
          currentDocument.error = null;
          currentDocument.processedAt = new Date().toISOString();
          currentDocument.auditRunId = auditRun?.runId;
        });

        // Sync voice session status to processed
        await updateVoiceSession(documentId, async (session) => {
          session.status = "processed";
          session.extractedData = result?.extracted_data || null;
          session.dashboardPayload = result || null;
        });

        await audit.complete({
          documentId: document.id,
          agentName: voiceExtractorAgent.name,
          latency: 0,
          tokensUsed: 0,
          stepsCount: voiceProcessing.agentResult?.steps?.length || 0,
        });

        res.write(`data: ${JSON.stringify({
          type: "done",
          document: updatedDocument,
          tokensUsed: 0,
        })}\n\n`);

        res.end();
        return;

      } catch (voiceError) {
        console.error(`   ❌ Voice processing error:`, voiceError);
        await updateDocument(documentId, async (currentDocument) => {
          currentDocument.status = "failed";
          currentDocument.error = voiceError instanceof Error ? voiceError.message : String(voiceError);
          currentDocument.result = null;
        });
        res.write(`data: ${JSON.stringify({
          type: "error",
          error: voiceError instanceof Error ? voiceError.message : String(voiceError),
        })}\n\n`);
        res.end();
        return;
      }
    }

    await updateDocument(documentId, async (currentDocument) => {
      currentDocument.status = "processing";
      currentDocument.error = null;
    });

    // Initialize audit run for regular document processing
    if (!auditRun) {
      auditRun = await startAuditRunSafe({
        workflow: "extraction",
        documentId: document.id,
        requestId: buildAuditRequestId("extract"),
        title: document.name,
        actor: buildRequestActor(req, "system"),
        metadata: buildRequestAuthMetadata(req, {
          department: document.department,
          mode: "interactive_sse",
        }),
      });
      audit = createAuditRunContext(auditRun, {
        workflow: "extraction",
        documentId: document.id,
        requestId: auditRun?.requestId || null,
        authMetadata: buildRequestAuthMetadata(req),
      });

      await audit.event("document_processing_started", "info", "Document processing started", {
        name: document.name,
        hasGeminiKey: !!geminiApiKey,
      });
    }

    const agentResult = await documentRouter.process(document.filePath, {
      pdfName: document.name,
      geminiApiKey: geminiApiKey, // Pass through to two-stage agent for Stage 3
      onProgress: (progress) => {
        // Also log to console for debugging (with immediate flush)
        logWithFlush(`[SSE Progress] ${progress.step || progress.type}:`, progress.data || "");
        res.write(`data: ${JSON.stringify({ ...progress, documentId })}\n\n`);
        void audit.event("agent_progress", progress.type === "error" ? "error" : "info", progress.step || progress.type || "progress", extractStepSummary(progress));
      }
    });

    if (!agentResult.success) {
      throw new Error(agentResult.error);
    }

    const result = await transformAgentResultToDashboard(agentResult);
    const updatedDocument = await updateDocument(documentId, async (currentDocument) => {
      currentDocument.status = "processed";
      currentDocument.department = result?.meta?.department_type || currentDocument.department;
      currentDocument.result = result;
      currentDocument.agentInfo = buildAgentInfo(agentResult);
      currentDocument.error = null;
      currentDocument.processedAt = new Date().toISOString();
      currentDocument.auditRunId = auditRun?.runId;
    });

    await audit.complete({
      documentId: document.id,
      agentName: agentResult.agent,
      latency: agentResult.latency,
      tokensUsed: agentResult.tokensUsed,
      stepsCount: agentResult.steps?.length || 0,
    });

    res.write(`data: ${JSON.stringify({
      type: "done",
      documentId,
      document: updatedDocument ? publicDocument(updatedDocument) : null
    })}\n\n`);
  } catch (error) {
    await audit.fail(error, {
      documentId: documentId,
    });
    await updateDocument(documentId, async (currentDocument) => {
      currentDocument.status = "failed";
      currentDocument.error = error instanceof Error ? error.message : "Unknown error";
    });

    res.write(`data: ${JSON.stringify({
      type: "error",
      documentId,
      error: error instanceof Error ? error.message : "Unknown error"
    })}\n\n`);
  }

  res.end();
});

// Test agent endpoint with verbose thinking output
app.post("/api/agent/test-pdf", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const id = crypto.randomUUID();
  const extension = path.extname(req.file.originalname) || ".pdf";
  const filePath = path.join(uploadsDir, `test_${id}${extension}`);

  await fs.writeFile(filePath, req.file.buffer);

  console.log("\n" + "=".repeat(60));
  console.log("🧪 AGENT TEST MODE - Verbose Thinking Output");
  console.log("=".repeat(60));

  const startTime = Date.now();

  try {
    // Process with the agent - logs will appear in console
    const agentResult = await documentRouter.process(filePath, {
      pdfName: req.file.originalname
    });

    const endTime = Date.now();

    // Clean up test file
    await fs.rm(filePath, { force: true });

    // Return detailed results including all step data
    res.json({
      success: agentResult.success,
      summary: {
        pdfName: req.file.originalname,
        agentName: agentResult.agent,
        agentVersion: agentResult.data?.meta?.agent_version || "2.0.0",
        totalLatency: endTime - startTime,
        tokensUsed: agentResult.tokensUsed,
        stepsCount: agentResult.steps?.length || 0
      },
      steps: agentResult.steps || [],
      validation: agentResult.validation,
      extractedData: agentResult.data,
      rawResult: agentResult
    });
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => {});
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.get("/api/chat/history/:documentId", async (req, res) => {
  const sessions = await readCollection(chatSessionsPath, "sessions");
  const session = sessions.find((item) => item.documentId === req.params.documentId) || null;
  res.json({ session });
});

app.delete("/api/chat/history/:documentId", async (req, res) => {
  const documentId = req.params.documentId;
  const chatId = typeof req.query.chatId === "string" ? req.query.chatId : "";

  const sessions = await readCollection(chatSessionsPath, "sessions");
  const sessionIndex = sessions.findIndex((item) => item.documentId === documentId && (!chatId || item.chatId === chatId));

  if (sessionIndex === -1) {
    return res.status(404).json({ error: "Chat session not found" });
  }

  const [removedSession] = sessions.splice(sessionIndex, 1);
  await writeCollection(chatSessionsPath, "sessions", sessions);

  const actions = await readCollection(chatActionsPath, "actions");
  const filteredActions = actions.filter((item) => item.documentId !== documentId || item.chatId !== removedSession.chatId);
  if (filteredActions.length !== actions.length) {
    await writeCollection(chatActionsPath, "actions", filteredActions);
  }

  const exportsList = await readCollection(chatExportsPath, "exports");
  const filteredExports = exportsList.filter((item) => item.documentId !== documentId || item.chatId !== removedSession.chatId);
  if (filteredExports.length !== exportsList.length) {
    await writeCollection(chatExportsPath, "exports", filteredExports);
  }

  return res.json({ cleared: true, chatId: removedSession.chatId });
});

app.get("/api/chat/source-health", async (_req, res) => {
  try {
    const sources = await sourceHealthTool.checkAll();
    return res.json({ sources });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Source health check failed" });
  }
});

app.post("/api/chat/query", async (req, res) => {
  const { documentId, message, sectionContext, chatId, geminiApiKey } = req.body || {};

  if (!documentId || !message) {
    return res.status(400).json({ error: "documentId and message are required" });
  }

  const documents = await readDocuments();
  const document = documents.find((item) => item.id === documentId);
  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  try {
    const response = await doctorAssistantAgent.execute({
      document,
      documentId,
      message,
      sectionContext,
      chatId,
      geminiApiKey,
    });

    return res.json({
      response: response.data,
      session: response.session,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Chat query failed" });
  }
});

app.post("/api/chat/action/confirm", async (req, res) => {
  const { documentId, chatId, actionId } = req.body || {};

  if (!documentId || !chatId || !actionId) {
    return res.status(400).json({ error: "documentId, chatId, and actionId are required" });
  }

  const sessions = await readCollection(chatSessionsPath, "sessions");
  const sessionIndex = sessions.findIndex((item) => item.chatId === chatId && item.documentId === documentId);
  if (sessionIndex === -1) {
    return res.status(404).json({ error: "Chat session not found" });
  }

  const session = sessions[sessionIndex];
  const action = session.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.proposed_actions || [])
    .find((proposal) => proposal.id === actionId);

  if (!action) {
    return res.status(404).json({ error: "Action proposal not found" });
  }

  const confirmedAction = {
    ...action,
    confirmedAt: new Date().toISOString(),
    documentId,
    chatId,
  };

  session.confirmedActions = Array.isArray(session.confirmedActions) ? session.confirmedActions : [];
  if (!session.confirmedActions.some((item) => item.id === actionId)) {
    session.confirmedActions.push(confirmedAction);
  }
  session.messages.push({
    id: crypto.randomUUID(),
    role: "system",
    content: `Confirmed action: ${action.title}`,
    createdAt: new Date().toISOString(),
  });
  session.updatedAt = new Date().toISOString();
  sessions[sessionIndex] = session;
  await writeCollection(chatSessionsPath, "sessions", sessions);

  const actions = await readCollection(chatActionsPath, "actions");
  actions.unshift(confirmedAction);
  await writeCollection(chatActionsPath, "actions", actions);

  return res.json({ action: confirmedAction, session });
});

app.post("/api/chat/export/:documentId", async (req, res) => {
  const documentId = req.params.documentId;
  const { chatId } = req.body || {};

  const documents = await readDocuments();
  const document = documents.find((item) => item.id === documentId);
  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  const sessions = await readCollection(chatSessionsPath, "sessions");
  const session = sessions.find((item) => item.documentId === documentId && (!chatId || item.chatId === chatId));
  if (!session) {
    return res.status(404).json({ error: "Chat session not found" });
  }

  try {
    const exportResult = chatExportBuilder.execute({ session, document });
    const exportRecord = {
      id: crypto.randomUUID(),
      documentId,
      chatId: session.chatId,
      createdAt: new Date().toISOString(),
      chart_note_appendix: exportResult.data.chart_note_appendix,
    };

    const exportsList = await readCollection(chatExportsPath, "exports");
    exportsList.unshift(exportRecord);
    await writeCollection(chatExportsPath, "exports", exportsList);

    await updateDocument(documentId, async (currentDocument) => {
      currentDocument.chatAssistantExport = exportRecord;
    });

    return res.json({ export: exportRecord });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Export failed" });
  }
});

// Chart Note Generation Endpoint
app.get("/api/documents/:id/chart-note", async (req, res) => {
  const documents = await readDocuments();
  const document = documents.find((item) => item.id === req.params.id);

  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  // Check if force regeneration is requested
  const forceRegenerate = req.query.regenerate === 'true' || req.query.force === 'true';

  // Return cached chart note if available and not forcing regeneration
  if (document.chartNote && !forceRegenerate) {
    return res.json({ chartNote: document.chartNote, cached: true });
  }

  // Force regeneration requested - proceed to generate new chart note
  if (forceRegenerate) {
    console.log(`Force regenerating chart note for document ${req.params.id}`);
  }

  // No chart note exists or force regenerate - delegate to POST logic
  req.method = 'POST'; // Temporarily change to POST for the chart note generation logic
  try {
    // Import and initialize the chart note agent
    const ChartNoteAgent = require("../agents/chart_note_agent.cjs");
    const CrossValidationAgentSkill = require("../skills/validation/cross_validation_agent.skill.cjs");
    const PdfReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");

    const chartNoteAgent = new ChartNoteAgent({
      gemma: {
        baseUrl: GEMMA_URL,
        model: MODEL,
        timeout: 90000
      }
    });
    const pdfReader = new PdfReaderTool();
    const crossValidator = new CrossValidationAgentSkill({ confidenceThreshold: 0.9 });

    // Get the extracted data from the document result
    const extractedData = document.result?.extracted_data || {};

    // Read PDF directly from storage for validation
    const pdfFilePath = document.filePath;

    let pdfText = "";
    let validationEnabled = false;

    if (pdfFilePath) {
      try {
        const pdfReaderResult = await pdfReader.execute(pdfFilePath);
        if (pdfReaderResult.success && pdfReaderResult.text && pdfReaderResult.text.length > 0) {
          // Truncate PDF text to avoid token limits (max ~12000 chars for PDF text)
          const maxPdfLength = 12000;
          pdfText = pdfReaderResult.text.length > maxPdfLength
            ? pdfReaderResult.text.substring(0, maxPdfLength) + '\n\n... [PDF truncated for token limit]'
            : pdfReaderResult.text;
          validationEnabled = true;
          console.log("PDF text extracted successfully, length:", pdfReaderResult.text.length, "-> truncated to:", pdfText.length);
        } else {
          console.log("PDF text extraction failed, proceeding without citations");
          if (pdfReaderResult.error) {
            console.log("PDF Reader error:", pdfReaderResult.error);
          }
        }
      } catch (pdfError) {
        console.log("PDF Reader exception:", pdfError.message);
      }
    }

    let validationResult = null;
    let citationSummary = null;

    // Only run validation if we have PDF text
    if (validationEnabled && pdfText) {
      console.log("Running cross-validation for citations...");
      validationResult = await crossValidator.execute({
        extractedData: extractedData,
        pdfText: pdfText,
        gemmaClient: chartNoteAgent.gemmaClient,
        promptBuilder: chartNoteAgent.promptBuilder
      });
      citationSummary = validationResult.data.citations.summary;
    } else {
      // Create empty validation result
      const CitationTrackerTool = require("../tools/llm/citation_tracker.tool.cjs");
      const citationTracker = new CitationTrackerTool();
      validationResult = {
        data: {
          validatedData: extractedData,
          citations: citationTracker.exportForChartNote(),
          validation: citationTracker.generateSummary(),
          fieldsNeedingReview: []
        }
      };
      citationSummary = validationResult.data.citations.summary;
    }

    // Generate chart note using ReAct agent
    const chartNoteResult = await chartNoteAgent.execute({
      extractedData: extractedData,
      pdfText: pdfText,
      citationData: validationResult.data.citations,
      validationSummary: `Confidence: ${(citationSummary.overallConfidence * 100).toFixed(0)}% | Fields reviewed: ${citationSummary.fieldsReviewed}/${citationSummary.totalFields}`
    });

    if (!chartNoteResult.success) {
      return res.status(500).json({ error: chartNoteResult.error });
    }

    // Update document with new chart note
    await updateDocument(req.params.id, async (currentDocument) => {
      currentDocument.chartNote = {
        content: chartNoteResult.data.chart_note,
        generatedAt: new Date().toISOString(),
        tokensUsed: chartNoteResult.data.metadata.total_tokens || 0,
        generationTime: chartNoteResult.data.metadata.generation_time_ms || 0,
        agentType: "react",
        reasoningSteps: chartNoteResult.data.reasoning_steps,
        validation: validationResult.data.validation,
        citations: validationResult.data.citations
      };
    });

    return res.json({
      chartNote: {
        content: chartNoteResult.data.chart_note,
        generatedAt: new Date().toISOString(),
        tokensUsed: chartNoteResult.data.metadata.total_tokens || 0,
        generationTime: chartNoteResult.data.metadata.generation_time_ms || 0,
        agentType: "react",
        reasoningSteps: chartNoteResult.data.reasoning_steps,
        validation: validationResult.data.validation,
        citations: validationResult.data.citations
      },
      cached: false,
      regenerated: true
    });

  } catch (error) {
    console.error("Chart note generation error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate chart note" });
  }
});

app.post("/api/documents/:id/chart-note", async (req, res) => {
  const documents = await readDocuments();
  const document = documents.find((item) => item.id === req.params.id);

  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  if (document.status !== "processed") {
    return res.status(400).json({ error: "Document must be processed before generating chart note" });
  }

  try {
    const auditRun = await startAuditRunSafe({
      workflow: "chart_note",
      documentId: document.id,
      requestId: buildAuditRequestId("chart_note"),
      title: document.name,
      actor: buildRequestActor(req, "system"),
      metadata: buildRequestAuthMetadata(req, {
        regenerated: false,
        hasCachedChartNote: !!document.chartNote,
      }),
    });

    const audit = createAuditRunContext(auditRun, {
      workflow: "chart_note",
      documentId: document.id,
      requestId: auditRun?.requestId || null,
      authMetadata: buildRequestAuthMetadata(req),
    });

    await audit.event("chart_note_generation_started", "info", "Chart note generation started");

    // Initialize ReAct-style Chart Note Agent
    const ChartNoteAgent = require("../agents/chart_note_agent.cjs");
    const CrossValidationAgentSkill = require("../skills/validation/cross_validation_agent.skill.cjs");
    const PdfReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");

    const chartNoteAgent = new ChartNoteAgent({
      gemma: {
        baseUrl: GEMMA_URL,
        model: MODEL,
        timeout: 90000
      }
    });
    const pdfReader = new PdfReaderTool();
    const crossValidator = new CrossValidationAgentSkill({ confidenceThreshold: 0.9 });

    // Get the extracted data from the document result
    const extractedData = document.result?.extracted_data || {};

    // Read PDF directly from storage for validation
    const pdfFilePath = document.filePath;

    let pdfText = "";
    let validationEnabled = false;

    if (pdfFilePath) {
      try {
        const pdfReaderResult = await pdfReader.execute(pdfFilePath);
        if (pdfReaderResult.success && pdfReaderResult.text && pdfReaderResult.text.length > 0) {
          // Truncate PDF text to avoid token limits (max ~12000 chars for PDF text)
          const maxPdfLength = 12000;
          pdfText = pdfReaderResult.text.length > maxPdfLength
            ? pdfReaderResult.text.substring(0, maxPdfLength) + '\n\n... [PDF truncated for token limit]'
            : pdfReaderResult.text;
          validationEnabled = true;
          console.log("PDF text extracted successfully, length:", pdfReaderResult.text.length, "-> truncated to:", pdfText.length);
        } else {
          console.log("PDF text extraction failed, proceeding without citations");
          if (pdfReaderResult.error) {
            console.log("PDF Reader error:", pdfReaderResult.error);
          }
        }
      } catch (pdfError) {
        console.log("PDF Reader exception:", pdfError.message);
      }
    }

    await audit.event("pdf_validation_complete", "info", "PDF validation complete", {
      validationEnabled,
      pdfTextLength: pdfText.length,
    });

    let validationResult = null;
    let citationSummary = null;

    // Only run validation if we have PDF text
    if (validationEnabled && pdfText) {
      console.log("Running cross-validation for citations...");
      validationResult = await crossValidator.execute({
        extractedData: extractedData,
        pdfText: pdfText,
        gemmaClient: chartNoteAgent.gemmaClient,
        promptBuilder: chartNoteAgent.promptBuilder
      });
      citationSummary = validationResult.data.citations.summary;
    } else {
      // Create empty validation result
      const CitationTrackerTool = require("../tools/llm/citation_tracker.tool.cjs");
      const citationTracker = new CitationTrackerTool();
      validationResult = {
        data: {
          validatedData: extractedData,
          citations: citationTracker.exportForChartNote(),
          validation: citationTracker.generateSummary(),
          fieldsNeedingReview: []
        }
      };
      citationSummary = validationResult.data.citations.summary;
    }

    await audit.event("cross_validation_complete", "info", "Cross-validation complete", {
      confidence: citationSummary.overallConfidence,
      fieldsReviewed: citationSummary.fieldsReviewed,
      totalFields: citationSummary.totalFields,
    });

    const needsReview = validationResult.data.fieldsNeedingReview.length > 0;
    const validationSummaryText = `Confidence: ${(citationSummary.overallConfidence * 100).toFixed(0)}% | Fields reviewed: ${citationSummary.fieldsReviewed}/${citationSummary.totalFields} | Flags: ${validationResult.data.validation.flags.length}`;

    // Use ReAct-style Chart Note Agent
    console.log("🤖 Using ReAct-style Chart Note Agent...");
    const chartNoteResult = await chartNoteAgent.execute({
      extractedData: extractedData,
      pdfText: pdfText,
      citationData: validationResult.data.citations,
      validationSummary: validationSummaryText
    }, (progress) => {
      console.log(`   Progress: ${progress.step} - ${progress.status}`);
      void audit.event("chart_note_progress", "info", `Progress: ${progress.step}`, {
        status: progress.status,
      });
    });

    if (!chartNoteResult.success) {
      await audit.fail(chartNoteResult.error, { step: "chart_note_generation" });
      return res.status(500).json({ error: chartNoteResult.error });
    }

    // Update document with chart note and validation data
    await updateDocument(req.params.id, async (currentDocument) => {
      currentDocument.chartNote = {
        content: chartNoteResult.data.chart_note,
        generatedAt: new Date().toISOString(),
        tokensUsed: chartNoteResult.data.metadata.total_tokens || 0,
        generationTime: chartNoteResult.data.metadata.generation_time_ms || 0,
        agentType: "react",
        reasoningSteps: chartNoteResult.data.reasoning_steps,
        validation: validationResult.data.validation,
        citations: validationResult.data.citations,
        auditRunId: auditRun?.runId,
      };
    });

    await audit.complete({
      documentId: document.id,
      tokensUsed: chartNoteResult.data.metadata.total_tokens || 0,
      generationTime: chartNoteResult.data.metadata.generation_time_ms || 0,
      reasoningSteps: chartNoteResult.data.reasoning_steps?.length || 0,
      needsReview,
    });

    res.json({
      chartNote: {
        content: chartNoteResult.data.chart_note,
        generatedAt: new Date().toISOString(),
        tokensUsed: chartNoteResult.data.metadata.total_tokens || 0,
        generationTime: chartNoteResult.data.metadata.generation_time_ms || 0,
        agentType: "react",
        reasoningSteps: chartNoteResult.data.reasoning_steps,
        validation: validationResult.data.validation,
        citations: validationResult.data.citations,
        auditRunId: auditRun?.runId,
      },
      needsReview: needsReview
    });

  } catch (error) {
    console.error("Chart note generation error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate chart note" });
  }
});

// Chart Note PDF Export Endpoint
app.post("/api/documents/:id/chart-note/pdf", async (req, res) => {
  const documents = await readDocuments();
  const document = documents.find((item) => item.id === req.params.id);

  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  try {
    // Get or generate chart note
    let chartNoteContent = document.chartNote?.content;

    if (!chartNoteContent) {
      // Generate chart note first using the full validation pipeline
      const GemmaClientTool = require("../tools/llm/gemma_client.tool.cjs");
      const PromptBuilderTool = require("../tools/llm/prompt_builder.tool.cjs");
      const CrossValidationAgentSkill = require("../skills/validation/cross_validation_agent.skill.cjs");
      const PdfReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");

      const gemmaClient = new GemmaClientTool({
        baseUrl: GEMMA_URL,
        model: MODEL,
        timeout: 180000
      });
      const promptBuilder = new PromptBuilderTool();
      const pdfReader = new PdfReaderTool();
      const crossValidator = new CrossValidationAgentSkill({ confidenceThreshold: 0.9 });

      const extractedData = document.result?.extracted_data || {};
      const pdfReaderResult = await pdfReader.execute(document.filePath);

      // Truncate PDF text to avoid token limits
      const maxPdfLength = 12000;
      const pdfText = (pdfReaderResult.text || "").length > maxPdfLength
        ? pdfReaderResult.text.substring(0, maxPdfLength) + '\n\n... [PDF truncated for token limit]'
        : (pdfReaderResult.text || "");

      const validationResult = await crossValidator.execute({
        extractedData: extractedData,
        pdfText: pdfText,
        gemmaClient: gemmaClient,
        promptBuilder: promptBuilder
      });

      const citationSummary = validationResult.data.citations.summary;
      const validationSummaryText = `Confidence: ${(citationSummary.overallConfidence * 100).toFixed(0)}% | Fields reviewed: ${citationSummary.fieldsReviewed}/${citationSummary.totalFields}`;

      // Calculate max output tokens based on input size
      // Model has 16384 token max context - leave room for output
      const MAX_CONTEXT = 16384;
      const MIN_OUTPUT = 800;
      const MAX_OUTPUT = 1800;
      const dataSize = (JSON.stringify(extractedData).length + JSON.stringify(validationResult.data.citations).length) / 4;
      // Prompt template adds ~7000 tokens for 11-section format
      const PROMPT_TEMPLATE_SIZE = 7000;
      const inputSize = dataSize + PROMPT_TEMPLATE_SIZE;
      // Small safety margin
      const maxOutputTokens = Math.max(MIN_OUTPUT, Math.min(MAX_OUTPUT, Math.floor(MAX_CONTEXT - inputSize - 100)));

      console.log(`Token budget: input=${Math.floor(inputSize)}, output=${maxOutputTokens}, total=${Math.floor(inputSize) + maxOutputTokens}/${MAX_CONTEXT}`);

      const prompt = promptBuilder.build("chart_note_composer", {
        extractedData: JSON.stringify(extractedData, null, 2),
        citationData: JSON.stringify(validationResult.data.citations, null, 2),
        validationSummary: validationSummaryText
      });

      const chartNoteResult = await gemmaClient.execute(prompt, {
        temperature: 0.3,
        maxTokens: maxOutputTokens
      });

      if (!chartNoteResult.success) {
        throw new Error(chartNoteResult.error);
      }

      chartNoteContent = chartNoteResult.content.trim();

      // Add end of record marker
      if (!chartNoteContent.includes("END OF RECORD")) {
        chartNoteContent += "\n\n***** END OF RECORD *****";
      }

      // Cache the chart note
      await updateDocument(req.params.id, async (currentDocument) => {
        currentDocument.chartNote = {
          content: chartNoteContent,
          generatedAt: new Date().toISOString(),
          tokensUsed: chartNoteResult.usage?.totalTokens || 0,
          validation: validationResult.data.validation,
          citations: validationResult.data.citations
        };
      });
    }

    // Generate professional PDF
    const PDFDocument = require("pdfkit");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=discharge-summary-${document.id}.pdf`);

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 45, bottom: 45, left: 50, right: 50 },
      info: {
        Title: "Discharge Summary",
        Subject: "Medical Chart Note",
        Creator: "Yavar.ai"
      }
    });

    doc.pipe(res);

    // ==================== HEADER ====================
    const primaryColor = "#059669";
    const lightBg = "#f0fdf4";
    const borderColor = "#d1fae5";

    // Top border
    doc.moveTo(50, 35).lineTo(560, 35).lineWidth(2).strokeColor(primaryColor).stroke();

    // Logos
    const manipalLogoPath = path.join(__dirname, "../public/manipal-logo.png");
    const yavarLogoPath = path.join(__dirname, "../public/yavar-logo.png");

    try {
      const manipalLogo = await fs.readFile(manipalLogoPath);
      doc.image(manipalLogo, 50, 42, { width: 40 });
    } catch (e) {}

    try {
      const yavarLogo = await fs.readFile(yavarLogoPath);
      doc.image(yavarLogo, 500, 42, { width: 40 });
    } catch (e) {}

    // Title
    doc.fontSize(15).font("Helvetica-Bold").fillColor("#1f2937").text("CLINICAL CHART NOTE", 100, 50);
    doc.fontSize(8).font("Helvetica").fillColor("#6b7280").text("Chart Note", 100, 67);

    // Header line
    doc.moveTo(50, 85).lineTo(560, 85).lineWidth(2).strokeColor(primaryColor).stroke();

    // ==================== PARSE & RENDER CONTENT ====================
    let yPosition = 100;
    const leftMargin = 50;
    const contentWidth = 510;

    doc.fontSize(10).font("Helvetica").fillColor("#374151");

    // Parse patient header
    const lines = chartNoteContent.split("\n");
    let contentStarted = false;
    let inPatientHeader = true;

    // Draw patient info box
    doc.roundedRect(leftMargin, yPosition, contentWidth, 45, 4).fillAndStroke(lightBg, borderColor);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Extract patient info from header line
      if (line.includes("Patient:") && line.includes("MRN:")) {
        const patientMatch = line.match(/Patient:\s*([^|]+?)\s*\|\s*MRN:\s*([^|]+?)\s*\|\s*Age:\s*([^|]+)/);
        if (patientMatch) {
          const name = patientMatch[1].trim();
          const mrn = patientMatch[2].trim();
          const age = patientMatch[3].trim();

          doc.fontSize(10).font("Helvetica-Bold").fillColor("#1f2937").text(name, leftMargin + 10, yPosition + 8);
          doc.fontSize(9).font("Helvetica").fillColor("#6b7280").text(`MRN: ${mrn}  |  Age: ${age}`, leftMargin + 10, yPosition + 24);

          // Extract admission/discharge from same line or next
          let admLine = line;
          if (i + 1 < lines.length && lines[i + 1].includes("Admission:")) {
            admLine = lines[i + 1];
          }
          const admMatch = admLine.match(/Admission:\s*([^|]+?)\s*\|\s*Discharge:\s*([^|]+)/);
          if (admMatch) {
            doc.fontSize(9).font("Helvetica").fillColor("#6b7280").text(
              `Admission: ${admMatch[1].trim()}  |  Discharge: ${admMatch[2].trim()}`,
              leftMargin + 10, yPosition + 37
            );
          }
        }
        yPosition += 55;
        break;
      }
    }

    // Render content sections
    let currentSection = null;
    let sectionContent = [];

    const sectionTitles = {
      "CHIEF COMPLAINT & HISTORY": "CHIEF COMPLAINT & HISTORY",
      "PHYSICAL EXAMINATION": "PHYSICAL EXAMINATION",
      "ASSESSMENT": "ASSESSMENT",
      "PLAN": "PLAN"
    };

    // Page height for A4 is ~842 points, footer at 750
    const MAX_Y = 750;
    const PAGE_MARGIN = 50;

    const checkPageBreak = (requiredSpace = 30) => {
      if (yPosition + requiredSpace > MAX_Y) {
        doc.addPage();
        yPosition = PAGE_MARGIN;
        return true;
      }
      return false;
    };

    const renderSection = (title, content) => {
      if (content.length === 0) return;

      // Check if we need a new page for section header
      checkPageBreak(50);

      // Special handling for ALLERGIES - use red/warning color for safety
      const isAllergies = title === "ALLERGIES & ADVERSE REACTIONS";
      const sectionColor = isAllergies ? "#dc2626" : primaryColor;

      // Section header
      doc.roundedRect(leftMargin, yPosition, contentWidth, 22, 3).fillAndStroke(sectionColor, sectionColor);
      doc.fontSize(11).font("Helvetica-Bold").fillColor("white").text(title, leftMargin + 10, yPosition + 6);
      yPosition += 28;

      const textIndent = 12;

      // Special handling for CHIEF COMPLAINT & HISTORY - more paragraph spacing
      const isChiefComplaint = title === "CHIEF COMPLAINT & HISTORY";
      const isAssessment = title === "ASSESSMENT";

      // Render content with consistent spacing
      let prevWasBullet = false;
      let prevWasHeader = false;

      content.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) {
          // Skip empty lines but add a small gap if next line is not a bullet
          if (index + 1 < content.length) {
            const nextLine = content[index + 1].trim();
            const nextIsBullet = /^[\*\-\••]\s+|^(\d+[\.\)])\s+/.test(nextLine);
            if (!nextIsBullet && !prevWasBullet) {
              yPosition += isChiefComplaint ? 14 : 8; // More spacing for CHIEF COMPLAINT
            }
          }
          return;
        }

        // Special handling for END OF RECORD marker
        if (trimmed.includes("END OF RECORD")) {
          yPosition += 20; // Extra spacing before END OF RECORD
          checkPageBreak(30);

          // Center aligned END OF RECORD
          doc.fontSize(9).font("Helvetica-Bold").fillColor("#374151");
          doc.text("***** END OF RECORD *****", leftMargin, yPosition, {
            width: contentWidth,
            align: "center"
          });
          yPosition += doc.heightOfString("***** END OF RECORD *****", { width: contentWidth, align: "center" }) + 15;
          return;
        }

        // Check if current line fits on page
        checkPageBreak(25);

        // Detect content type
        const isBullet = /^[\*\-\••]\s+|^(\d+[\.\)])\s+/.test(trimmed);
        const isSubsection = /^\*\*[^*]+\*\*:?$/.test(trimmed);
        const isBoldHeader = /^.+:\s*$/.test(trimmed) && trimmed.length < 60;
        const isMajorHeader = /^[A-Z][A-Z\s\/]+$/.test(trimmed) && trimmed.length < 30;

        if (isMajorHeader) {
          prevWasBullet = false;
          prevWasHeader = true;
          yPosition += 8;

          doc.fontSize(10).font("Helvetica-Bold").fillColor("#1f2937");
          doc.text(trimmed, leftMargin + textIndent, yPosition);
          yPosition += doc.heightOfString(trimmed) + 6;
        } else if (isSubsection) {
          prevWasBullet = false;
          prevWasHeader = true;
          yPosition += 8;

          const headerText = trimmed.replace(/\*\*/g, '').replace(/:$/, '');
          doc.fontSize(10).font("Helvetica-Bold").fillColor("#1f2937");
          doc.text(headerText, leftMargin + textIndent, yPosition);
          yPosition += doc.heightOfString(headerText) + 5;
        } else if (isBoldHeader) {
          prevWasBullet = false;
          prevWasHeader = true;
          yPosition += 8;

          doc.fontSize(10).font("Helvetica-Bold").fillColor("#374151");
          doc.text(trimmed.replace(/:$/, ''), leftMargin + textIndent, yPosition);
          yPosition += doc.heightOfString(trimmed.replace(/:$/, '')) + 5;
        } else if (isBullet) {
          // Bullet item - use proper bullet symbol
          if (!prevWasBullet) {
            yPosition += 6; // Space before bullet list starts
          }
          prevWasBullet = true;
          prevWasHeader = false;

          const bulletText = trimmed.replace(/^[\*\-\••]\s+|^(\d+[\.\)])\s+/, '');
          const bulletNum = trimmed.match(/^(\d+)[\.\)]/);
          const bulletChar = bulletNum ? `${bulletNum[1]}.` : '•';

          // Draw bullet in green
          doc.fillColor("#059669").fontSize(8).text(bulletChar, leftMargin + textIndent, yPosition + 2);
          // Draw text
          doc.fillColor("#374151").fontSize(9).font("Helvetica").text(bulletText, leftMargin + textIndent + 10, yPosition, {
            width: contentWidth - textIndent * 2 - 20
          });

          yPosition += Math.max(doc.heightOfString(bulletText, { width: contentWidth - textIndent * 2 - 20 }), 12) + 3;
        } else {
          // Regular paragraph text
          if (prevWasBullet || prevWasHeader) {
            yPosition += 6; // Space after bullets/headers
          }
          prevWasBullet = false;
          prevWasHeader = false;

          doc.fontSize(9).font("Helvetica").fillColor("#374151");
          const lineHeight = isChiefComplaint ? 2.0 : 1.5;
          const options = {
            width: contentWidth - textIndent * 2,
            align: 'justify',
            lineGap: lineHeight
          };
          doc.text(trimmed, leftMargin + textIndent, yPosition, options);
          yPosition += doc.heightOfString(trimmed, options) + (isChiefComplaint ? 10 : 6);
        }
      });

      yPosition += 12;
    };

    for (const line of lines) {
      const trimmed = line.trim();

      // Check for section headers - must be exact match on the line (not part of other text)
      // This prevents matching "Plan & Management Strategy:" as a PLAN section
      const isAllergies = trimmed === "ALLERGIES & ADVERSE REACTIONS" ||
                         trimmed === "ALLERGIES" ||
                         trimmed === "DRUG ALLERGIES";

      const isSubjective = trimmed === "CHIEF COMPLAINT & HISTORY" ||
                          trimmed === "SUBJECTIVE - HISTORY & PRESENTATION" ||
                          trimmed === "SUBJECTIVE" ||
                          trimmed === "S - SUBJECTIVE" ||
                          trimmed === "HISTORY & PRESENTATION";

      const isComorbidities = trimmed === "COMORBIDITIES" ||
                             trimmed === "PAST MEDICAL HISTORY" ||
                             trimmed === "CO-MORBIDITIES";

      const isObjective = trimmed === "PHYSICAL EXAMINATION" ||
                        trimmed === "OBJECTIVE - CLINICAL FINDINGS" ||
                        trimmed === "OBJECTIVE" ||
                        trimmed === "O - OBJECTIVE" ||
                        trimmed === "CLINICAL FINDINGS";

      const isProcedures = trimmed === "PROCEDURES & INTERVENTIONS" ||
                          trimmed === "PROCEDURES" ||
                          trimmed === "PROCEDURES PERFORMED";

      const isHospitalCourse = trimmed === "HOSPITAL COURSE" ||
                              trimmed === "COURSE IN HOSPITAL" ||
                              trimmed === "HOSPITALIZATION COURSE";

      const isAssessment = trimmed === "ASSESSMENT" ||
                          trimmed === "ASSESSMENT - DIAGNOSIS & CLINICAL JUDGMENT" ||
                          trimmed === "A - ASSESSMENT" ||
                          trimmed === "DIAGNOSIS & ASSESSMENT";

      const isPending = trimmed === "PENDING INVESTIGATIONS" ||
                       trimmed === "PENDING" ||
                       trimmed === "PENDING TESTS";

      const isPlan = trimmed === "PLAN" ||
                    trimmed === "PLAN - DISCHARGE PLAN & RECOMMENDATIONS" ||
                    trimmed === "P - PLAN" ||
                    trimmed === "DISCHARGE PLAN";

      const isNursing = trimmed === "NURSING CARE NEEDS" ||
                       trimmed === "NURSING CARE" ||
                       trimmed === "NURSING";

      const isRiskFlags = trimmed === "RISK FLAGS" ||
                         trimmed === "RISK FACTORS" ||
                         trimmed === "RISK ASSESSMENT";

      if (isAllergies || isSubjective || isComorbidities || isObjective ||
          isProcedures || isHospitalCourse || isAssessment || isPending ||
          isPlan || isNursing || isRiskFlags) {

        // Render previous section
        if (currentSection && sectionContent.length > 0) {
          renderSection(currentSection, sectionContent);
          sectionContent = [];
        }

        // Determine proper section title (new standard format)
        if (isAllergies) {
          currentSection = "ALLERGIES & ADVERSE REACTIONS";
        } else if (isSubjective) {
          currentSection = "CHIEF COMPLAINT & HISTORY";
        } else if (isComorbidities) {
          currentSection = "COMORBIDITIES";
        } else if (isObjective) {
          currentSection = "PHYSICAL EXAMINATION";
        } else if (isProcedures) {
          currentSection = "PROCEDURES & INTERVENTIONS";
        } else if (isHospitalCourse) {
          currentSection = "HOSPITAL COURSE";
        } else if (isAssessment) {
          currentSection = "ASSESSMENT";
        } else if (isPending) {
          currentSection = "PENDING INVESTIGATIONS";
        } else if (isPlan) {
          currentSection = "PLAN";
        } else if (isNursing) {
          currentSection = "NURSING CARE NEEDS";
        } else if (isRiskFlags) {
          currentSection = "RISK FLAGS";
        }
        continue;
      }

      // Skip patient header lines already processed
      if (trimmed.includes("Patient:") || trimmed.includes("MRN:") || trimmed.includes("Admission:")) {
        continue;
      }

      // Skip generated footer lines
      if (trimmed.includes("Generated:") || trimmed.includes("Note: This chart note") ||
          trimmed.includes("Validation Summary:") || trimmed.includes("____")) {
        continue;
      }

      // Add to current section content
      if (currentSection && trimmed) {
        sectionContent.push(trimmed);
      }
    }

    // Render last section
    if (currentSection && sectionContent.length > 0) {
      renderSection(currentSection, sectionContent);
    }

    // ==================== FOOTER ====================
    const footerY = 750;

    // Check if we need a new page
    if (yPosition > footerY - 50) {
      doc.addPage();
    }

    doc.moveTo(50, footerY).lineTo(560, footerY).lineWidth(1).strokeColor("#d1d5db").stroke();

    // Validation badge
    if (document.chartNote?.validation) {
      const validation = document.chartNote.validation;
      const confidence = validation.overallConfidence || 0;
      const badgeColor = confidence >= 0.9 ? "#059669" : confidence >= 0.7 ? "#d97706" : "#dc2626";

      doc.roundedRect(leftMargin, footerY + 8, 180, 16, 2).fillAndStroke(badgeColor, badgeColor);
      doc.fontSize(8).font("Helvetica-Bold").fillColor("white").text(
        `✓ ${(confidence * 100).toFixed(0)}% Confidence`,
        leftMargin + 8,
        footerY + 13
      );

      doc.fontSize(7).font("Helvetica").fillColor("white").text(
        `${validation.fieldsReviewed}/${validation.totalFields} verified`,
        leftMargin + 100,
        footerY + 13
      );
    }

    // Footer text
    doc.fontSize(7).font("Helvetica").fillColor("#9ca3af");
    doc.text("Generated by Yavar.ai | " + new Date().toLocaleString(), 240, footerY + 13);

    // Disclaimer
    doc.fontSize(6).font("Helvetica-Oblique").fillColor("#9ca3af");
    doc.text("This is an AI-generated document. Clinician review required.", leftMargin, footerY + 30, { width: contentWidth, align: "center" });

    doc.end();

  } catch (error) {
    console.error("PDF generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to complete handwriting extraction for prescriptions
// GET /api/documents/:id/handwriting-progress
// SSE endpoint for real-time handwriting extraction progress
app.get("/api/documents/:id/handwriting-progress", async (req, res) => {
  const { id } = req.params;
  const { apiKey } = req.query;

  if (!apiKey) {
    return res.status(400).json({ error: "API key required" });
  }

  // Set headers for SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  setSseCorsHeaders(req, res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: "connected", documentId: id })}\n\n`);

  let audit = createAuditRunContext(null, {
    authMetadata: buildRequestAuthMetadata(req),
  });

  try {
    const documents = await readDocuments();
    const document = documents.find((item) => item.id === id);

    if (!document) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Document not found" })}\n\n`);
      res.end();
      return;
    }

    // Verify API key format
    if (typeof apiKey !== "string" || !apiKey.startsWith("AIza")) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Invalid Gemini API key format" })}\n\n`);
      res.end();
      return;
    }

    // Check if this is a prescription document
    const metadata = document.result?.meta;
    const documentType = metadata?.router?.detected_type || metadata?.document_type;

    if (documentType !== "prescription") {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Handwriting extraction is only available for prescription documents" })}\n\n`);
      res.end();
      return;
    }

    // Check if Stage 3 is needed
    const pipelineMetadata = document.result?.meta;
    if (pipelineMetadata?.stage3_complete) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Handwriting extraction already completed" })}\n\n`);
      res.end();
      return;
    }

    if (!pipelineMetadata?.stage3_required) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Handwriting extraction not required for this document" })}\n\n`);
      res.end();
      return;
    }

    // Send key verified message
    res.write(`data: ${JSON.stringify({ type: "key_verified", message: "API key verified successfully" })}\n\n`);

    // Create audit run
    const auditRun = await startAuditRunSafe({
      workflow: "handwriting_extraction",
      documentId: document.id,
      requestId: buildAuditRequestId("handwriting"),
      title: `Handwriting Extraction: ${document.name}`,
      actor: buildRequestActor(req, "user"),
      metadata: buildRequestAuthMetadata(req, {
        original_run_id: document.auditRunId
      }),
    });

    audit = createAuditRunContext(auditRun, {
      workflow: "handwriting_extraction",
      documentId: document.id,
      requestId: auditRun?.requestId || null,
      authMetadata: buildRequestAuthMetadata(req),
    });

    await audit.event("handwriting_extraction_started", "info", "Stage 3 handwriting extraction started");

    // Send stage starting message
    res.write(`data: ${JSON.stringify({ type: "start", stage: "stage3", message: "Starting handwriting extraction...", totalSteps: 3 })}\n\n`);

    // Import the two-stage agent
    const PrescriptionTwoStageAgent = require("../agents/prescription_two_stage_agent.cjs");

    const twoStageAgent = new PrescriptionTwoStageAgent({
      gemma: {
        baseUrl: GEMMA_URL,
        model: MODEL,
        timeout: 180000
      },
      geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      handwritingThreshold: 15
    });

    // Run Stage 3 extraction with user-provided API key
    let stepCount = 0;
    const cachedStage1Data = document.result?.stage1;
    console.log('[Handwriting DEBUG] skipStage1=true, stage1Data exists:', !!cachedStage1Data);
    if (!cachedStage1Data) {
      console.error('[Handwriting ERROR] No stage1 data found in document.result!');
    }
    const result = await twoStageAgent.process(document.filePath, {
      pdfName: document.name,
      geminiApiKey: apiKey,
      skipStage1: true,
      stage1Data: cachedStage1Data,
      onProgress: (progress) => {
        stepCount++;
        console.log(`[Handwriting Progress] Step ${stepCount}:`, progress.step || progress.type || "processing");
        res.write(`data: ${JSON.stringify({
          type: "step",
          stepNumber: stepCount,
          totalSteps: 3,
          step: progress.step || progress.type || "processing",
          message: progress.message || progress.step || "Processing...",
          data: progress.data || {}
        })}\n\n`);
        void audit.event("agent_progress", "info", progress.step || progress.type || "progress", extractStepSummary(progress));
      }
    });

    if (!result.success) {
      throw new Error(result.error || "Handwriting extraction failed");
    }

    // Transform to dashboard format
    res.write(`data: ${JSON.stringify({ type: "step", stepNumber: 2, totalSteps: 3, step: "transforming", message: "Transforming extracted data..." })}\n\n`);
    const dashboardResult = await transformAgentResultToDashboard(result);

    // Update document with new data
    res.write(`data: ${JSON.stringify({ type: "step", stepNumber: 3, totalSteps: 3, step: "saving", message: "Saving results..." })}\n\n`);
    const updatedDocument = await updateDocument(id, async (currentDocument) => {
      currentDocument.result = {
        ...currentDocument.result,
        ...result.data,
        ...(dashboardResult.dashboard_cards && { dashboard_cards: dashboardResult.dashboard_cards }),
        ...(dashboardResult.sample_patient_data && { sample_patient_data: dashboardResult.sample_patient_data }),
        ...(dashboardResult.presentation && { presentation: dashboardResult.presentation }),
        meta: {
          ...(currentDocument.result?.meta || {}),
          ...(result.data?.meta || {}),
          stage3_complete: true,
          stage3_completed_at: new Date().toISOString(),
          user_action_required: false
        }
      };
      currentDocument.metadata = {
        ...currentDocument.metadata,
        ...result.metadata,
        stage3_complete: true,
        stage3_completed_at: new Date().toISOString()
      };
      currentDocument.agentInfo = mergeAgentInfoForResume(currentDocument.agentInfo, result);
      currentDocument.status = "processed";
      currentDocument.error = null;
    });
    await analyticsStore.upsertDocumentMetrics(updatedDocument);

    await audit.complete({
      documentId: id,
      agentName: result.agentInfo?.name || "Handwriting Extraction",
      latency: result.agentInfo?.latency || 0,
      stage3_complete: true
    });

    const updatedDocuments = await readDocuments();
    const finalDocument = updatedDocuments.find((d) => d.id === id);

    res.write(`data: ${JSON.stringify({
      type: "done",
      documentId: id,
      document: publicDocument(finalDocument),
      message: "Handwriting extraction completed successfully"
    })}\n\n`);
  } catch (error) {
    await audit.fail(error, { documentId: id });

    await updateDocument(id, async (currentDocument) => {
      currentDocument.metadata = {
        ...currentDocument.metadata,
        stage3_error: {
          message: error.message,
          code: "STAGE3_EXTRACTION_FAILED",
          user_action_required: true
        }
      };
    });

    res.write(`data: ${JSON.stringify({
      type: "error",
      documentId: id,
      error: error instanceof Error ? error.message : "Unknown error"
    })}\n\n`);
  }

  res.end();
});

// POST /api/documents/:id/complete-handwriting
// Accepts user's Gemini API key to run Stage 3 extraction
// Falls back to GEMINI_API_KEY from env if not provided
app.post("/api/documents/:id/complete-handwriting", async (req, res) => {
  const { id } = req.params;
  // Use provided key or fall back to env
  const geminiApiKey = req.body?.geminiApiKey || process.env.GEMINI_API_KEY;

  if (!geminiApiKey) {
    return res.status(400).json({
      error: "Gemini API key is required",
      code: "GEMINI_API_KEY_MISSING"
    });
  }

  // Basic validation of API key format
  if (typeof geminiApiKey !== "string" || !geminiApiKey.startsWith("AIza")) {
    return res.status(400).json({
      error: "Invalid Gemini API key format",
      code: "GEMINI_API_KEY_INVALID"
    });
  }

  const documents = await readDocuments();
  const document = documents.find((item) => item.id === id);

  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  // Check if this is a prescription document
  const metadata = document.result?.meta;
  const documentType = metadata?.router?.detected_type || metadata?.document_type;

  if (documentType !== "prescription") {
    return res.status(400).json({
      error: "Handwriting extraction is only available for prescription documents",
      code: "WRONG_DOCUMENT_TYPE",
      document_type: documentType
    });
  }

  // Check if Stage 3 is needed
  const pipelineMetadata = document.result?.meta;

  // Check if Stage 3 was actually successful (has data, not just marked complete)
  const stage3Data = document.result?.stage3 || document.result?.extracted_data?.stage3;
  const hasStage3Data = stage3Data && (
    (stage3Data.medications && stage3Data.medications.length > 0) ||
    (stage3Data.vitals && (stage3Data.vitals.blood_pressure?.systolic || stage3Data.vitals.pulse?.value)) ||
    (stage3Data.diagnosis?.principal) ||
    (stage3Data.diagnosis?.clinical_notes && stage3Data.diagnosis.clinical_notes.length > 0)
  );

  if (pipelineMetadata?.stage3_complete && hasStage3Data && !pipelineMetadata?.stage3_skipped_reason) {
    return res.status(400).json({
      error: "Handwriting extraction already completed",
      code: "ALREADY_COMPLETED",
      data: {
        medications_count: stage3Data.medications?.length || 0,
        vitals_count: Object.keys(stage3Data.vitals || {}).length,
        diagnosis_present: !!stage3Data.diagnosis?.principal
      }
    });
  }

  if (!pipelineMetadata?.stage3_required) {
    return res.status(400).json({
      error: "Handwriting extraction not required for this document",
      code: "STAGE3_NOT_REQUIRED",
      reason: "No significant handwriting detected"
    });
  }

  // Create audit run
  const auditRun = await startAuditRunSafe({
    workflow: "handwriting_extraction",
    documentId: document.id,
    requestId: buildAuditRequestId("handwriting"),
    title: `Handwriting Extraction: ${document.name}`,
    actor: buildRequestActor(req, "user"),
    metadata: buildRequestAuthMetadata(req, {
      original_run_id: document.auditRunId
    }),
  });

  const audit = createAuditRunContext(auditRun, {
    workflow: "handwriting_extraction",
    documentId: document.id,
    requestId: auditRun?.requestId || null,
    authMetadata: buildRequestAuthMetadata(req),
  });

  try {
    await audit.event("handwriting_extraction_started", "info", "Stage 3 handwriting extraction started");

    // Import the two-stage agent
    const PrescriptionTwoStageAgent = require("../agents/prescription_two_stage_agent.cjs");

    const twoStageAgent = new PrescriptionTwoStageAgent({
      gemma: {
        baseUrl: GEMMA_URL,
        model: MODEL,
        timeout: 180000
      },
      geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      handwritingThreshold: 15
    });

    // Run Stage 3 extraction with user-provided API key
    // Pass stage1Data from document.result.stage1 to resume without reprocessing
    // Also pass handwriting percentage from metadata since stage1Data may have fallback values
    const result = await twoStageAgent.process(document.filePath, {
      pdfName: document.name,
      geminiApiKey: geminiApiKey,
      skipStage1: true, // Skip Stage 1 as it was already done
      stage1Data: document.result?.stage1, // Provide existing Stage 1 data
      forceHandwritingPercentage: document.result?.meta?.handwriting_percentage, // Force this value for Stage 3 check
      onProgress: (progress) => {
        void audit.event("agent_progress", "info", progress.step || progress.type || "progress", extractStepSummary(progress));
      }
    });

    if (!result.success) {
      throw new Error(result.error || "Handwriting extraction failed");
    }

    // Transform to dashboard format
    const dashboardResult = await transformAgentResultToDashboard(result);

    // Update document with new data
    const updatedDocument = await updateDocument(id, async (currentDocument) => {
      // Merge result data - preserve existing structure and overlay new data
      currentDocument.result = {
        ...currentDocument.result,
        // Merge stage3 data into result root level (where dashboard transformer reads it)
        ...result.data,
        // Explicitly merge the dashboard-transformed data
        ...(dashboardResult.dashboard_cards && { dashboard_cards: dashboardResult.dashboard_cards }),
        ...(dashboardResult.sample_patient_data && { sample_patient_data: dashboardResult.sample_patient_data }),
        ...(dashboardResult.presentation && { presentation: dashboardResult.presentation }),
        // Update result.meta with pipeline metadata (where completion checks read it)
        meta: {
          ...(currentDocument.result?.meta || {}),
          ...(result.data?.meta || {}),
          stage3_complete: true,
          stage3_completed_at: new Date().toISOString(),
          user_action_required: false
        }
      };
      currentDocument.metadata = {
        ...currentDocument.metadata,
        ...result.metadata,
        stage3_complete: true,
        stage3_completed_at: new Date().toISOString()
      };
      currentDocument.agentInfo = mergeAgentInfoForResume(currentDocument.agentInfo, result);
      currentDocument.status = "processed";
      currentDocument.error = null;
    });
    await analyticsStore.upsertDocumentMetrics(updatedDocument);

    await audit.complete({
      documentId: id,
      agentName: result.agentInfo?.name || "Handwriting Extraction",
      latency: result.agentInfo?.latency || 0,
      stage3_complete: true
    });

    // Return updated document
    const updatedDocuments = await readDocuments();
    const finalDocument = updatedDocuments.find((d) => d.id === id);

    res.json({
      document: publicDocument(finalDocument),
      message: "Handwriting extraction completed successfully",
      data: {
        medications_count: result.data?.medications?.length || 0,
        lab_selections_count: result.data?.lab_investigations?.total_selected || 0
      }
    });

  } catch (error) {
    await audit.fail(error, { documentId: id });

    await updateDocument(id, async (currentDocument) => {
      currentDocument.metadata = {
        ...currentDocument.metadata,
        stage3_error: {
          message: error.message,
          code: "STAGE3_EXTRACTION_FAILED",
          user_action_required: true
        }
      };
    });

    res.status(500).json({
      error: "Handwriting extraction failed",
      code: "STAGE3_EXTRACTION_FAILED",
      message: error.message
    });
  }
});

// ============================================
// MANUAL ALERT TRIGGER ENDPOINT
// ============================================
// Import alert agents
const PharmacyAlertAgent = require("../agents/pharmacy/pharmacy_alert_agent.cjs");
const DepartmentAlertAgent = require("../agents/departments/department_alert_agent.cjs");
const PharmacyAlertFormatter = require("../tools/pharmacy/alert_formatter.tool.cjs");
const DepartmentAlertFormatter = require("../tools/pharmacy/department_alert_formatter.tool.cjs");
const PharmacyEmailNotifier = require("../agents/pharmacy/email_notifier.cjs");
const PharmacyWhatsAppNotifier = require("../agents/pharmacy/whatsapp_notifier.cjs");
const DepartmentNotifier = require("../agents/departments/department_notifier.cjs");

function buildAlertDashboardData(document) {
  return {
    ...document.result,
    id: document.id,
    documentId: document.id,
    medications: document.result?.extracted_data?.medications || document.result?.medications || [],
    investigations: document.result?.extracted_data?.investigations || document.result?.investigations || [],
    radiology: document.result?.extracted_data?.radiology || document.result?.radiology || [],
    nuclear_medicine: document.result?.extracted_data?.nuclear_medicine || document.result?.nuclear_medicine || [],
    procedures: document.result?.extracted_data?.procedures || document.result?.procedures || [],
    patient: document.result?.extracted_data?.patient || document.result?.sample_patient_data?.patient || document.result?.patient || {},
    doctor: document.result?.extracted_data?.doctor || document.result?.sample_patient_data?.doctor || document.result?.doctor || {},
    diagnosis: document.result?.extracted_data?.diagnosis || document.result?.diagnosis || {},
    meta: document.result?.meta || {}
  };
}

function getAvailableAlertTargets(dashboardData) {
  const departmentAgent = new DepartmentAlertAgent();
  const detectedDepartments = departmentAgent.detectDepartmentsWithOrders(dashboardData).map((entry) => entry.department);
  const targets = [];

  if ((dashboardData.medications || []).length > 0) {
    targets.push("pharmacy");
  }

  if (detectedDepartments.includes("lab")) {
    targets.push("lab");
  }

  if (detectedDepartments.includes("nuclear_medicine")) {
    targets.push("nuclear_medicine");
  }

  if (detectedDepartments.includes("radiology")) {
    targets.push("radiology");
  }

  if (detectedDepartments.includes("procedures")) {
    targets.push("procedures");
  }

  return targets;
}

function resolveAlertTargets(requestedTarget, dashboardData) {
  const availableTargets = getAvailableAlertTargets(dashboardData);

  switch (requestedTarget) {
    case "all":
      return availableTargets;
    case "medications":
      return availableTargets.filter((target) => target === "pharmacy");
    case "labs":
      return availableTargets.filter((target) => target === "lab" || target === "nuclear_medicine");
    case "radiology":
      return availableTargets.filter((target) => target === "radiology");
    case "treatment":
      return availableTargets.filter((target) => target === "procedures");
    case "pharmacy":
    case "lab":
    case "radiology":
    case "nuclear_medicine":
    case "procedures":
      return availableTargets.includes(requestedTarget) ? [requestedTarget] : [];
    default:
      return null;
  }
}

function buildAlertPreviewDeliveries(document, dashboardData, targets) {
  const pharmacyFormatter = new PharmacyAlertFormatter();
  const pharmacyEmailNotifier = new PharmacyEmailNotifier();
  const pharmacyWhatsAppNotifier = new PharmacyWhatsAppNotifier();
  const pharmacyAgent = new PharmacyAlertAgent();
  const departmentFormatter = new DepartmentAlertFormatter();
  const departmentNotifier = new DepartmentNotifier();
  const departmentAgent = new DepartmentAlertAgent();
  const deliveries = [];

  for (const target of targets) {
    if (target === "pharmacy") {
      const content = pharmacyFormatter.formatAlert(dashboardData);
      deliveries.push({
        key: "pharmacy",
        label: "Pharmacy",
        itemCount: content.medications.length,
        alreadySent: Boolean(document.result?.pharmacy_alert?.sent),
        channels: {
          email: {
            enabled: pharmacyAgent.config.sendEmail,
            recipient: pharmacyEmailNotifier.config.toEmail,
            subject: pharmacyEmailNotifier.buildSubject(content),
            body: pharmacyEmailNotifier.buildTextBody(content),
          },
          whatsapp: {
            enabled: pharmacyAgent.config.sendWhatsApp || Boolean(pharmacyWhatsAppNotifier.config.phoneNumber),
            recipient: pharmacyWhatsAppNotifier.config.phoneNumber || null,
            body: pharmacyWhatsAppNotifier.buildMessage(content),
          },
        },
      });
      continue;
    }

    const content = departmentFormatter.formatAlert(target, dashboardData);
    deliveries.push({
      key: target,
      label: content.department,
      itemCount: content.itemCount || 0,
      alreadySent: Boolean(document.result?.department_alerts?.departments?.[target]?.sent),
      channels: {
        email: {
          enabled: true,
          recipient: departmentAgent.departmentEmails[target] || null,
          subject: departmentNotifier.buildSubject(target, content),
          body: departmentNotifier.buildEmailBody(target, content),
        },
        whatsapp: {
          enabled: true,
          recipient: null,
          body: departmentNotifier.buildWhatsAppMessage(target, content),
        },
      },
    });
  }

  return deliveries;
}

function toStoredPharmacyAlert(result, medicationCount) {
  return {
    sent: result.sent || false,
    email_sent: result.emailSent || false,
    whatsapp_sent: result.whatsappSent || false,
    skipped: result.skipped || false,
    skip_reason: result.reason || null,
    error: result.error || null,
    medications_count: medicationCount,
  };
}

function mergeStoredDepartmentAlerts(existingAlerts, target, result, itemCount) {
  const nextAlerts = {
    sent: existingAlerts?.sent || false,
    skipped: false,
    skip_reason: null,
    error: existingAlerts?.error || null,
    departments: {
      ...(existingAlerts?.departments || {}),
    },
  };

  nextAlerts.departments[target] = {
    sent: result.sent || false,
    itemCount,
  };

  nextAlerts.sent = Object.values(nextAlerts.departments).some((entry) => entry?.sent);
  nextAlerts.error = result.error || null;

  return nextAlerts;
}

async function sendManualAlertsForTargets(document, dashboardData, targets) {
  const pharmacyAgent = new PharmacyAlertAgent();
  const departmentAgent = new DepartmentAlertAgent();
  const results = {};

  for (const target of targets) {
    if (target === "pharmacy") {
      console.log(`\n📋 Manual Pharmacy Alert Trigger for document: ${document.name}`);
      results.pharmacy = await pharmacyAgent.sendAlert(dashboardData, {
        documentId: document.id,
        manualTrigger: true
      });
      continue;
    }

    console.log(`\n📋 Manual ${target} Alert Trigger for document: ${document.name}`);
    const departmentResult = await departmentAgent.sendAlerts(dashboardData, {
      documentId: document.id,
      departments: [target]
    });
    results[target] = departmentResult.departments?.[target] || {
      sent: false,
      error: departmentResult.error || "Department alert failed",
    };
  }

  return results;
}

function buildStoredAlertPatch(existingResult, dashboardData, targets, sendResults) {
  const patch = {};

  if (targets.includes("pharmacy")) {
    patch.pharmacy_alert = toStoredPharmacyAlert(sendResults.pharmacy || {}, (dashboardData.medications || []).length);
  }

  const departmentCounts = {
    lab: (dashboardData.investigations || []).filter((item) => item.status === "ordered").length,
    radiology: (dashboardData.radiology || []).filter((item) => item.status === "ordered").length,
    nuclear_medicine: (dashboardData.nuclear_medicine || []).filter((item) => item.status === "ordered").length,
    procedures: (dashboardData.procedures || []).filter((item) => item.status === "ordered" || item.status === "mentioned").length,
  };

  const selectedDepartments = targets.filter((target) => target !== "pharmacy");
  if (selectedDepartments.length > 0) {
    let mergedDepartmentAlerts = existingResult?.department_alerts || null;
    for (const target of selectedDepartments) {
      mergedDepartmentAlerts = mergeStoredDepartmentAlerts(
        mergedDepartmentAlerts,
        target,
        sendResults[target] || {},
        departmentCounts[target] || 0
      );
    }
    patch.department_alerts = mergedDepartmentAlerts;
  }

  return patch;
}

/**
 * POST /api/documents/:id/alert-preview
 * Generate approval previews for dashboard alert cards without sending
 */
app.post("/api/documents/:id/alert-preview", async (req, res) => {
  const { id } = req.params;
  const { target = "all" } = req.body || {};

  try {
    const documents = await readDocuments();
    const document = documents.find((item) => item.id === id);

    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (!document.result || (document.status !== "processed" && document.status !== "partial")) {
      return res.status(400).json({
        error: "Document must be processed before previewing alerts",
        code: "DOCUMENT_NOT_PROCESSED"
      });
    }

    const dashboardData = buildAlertDashboardData(document);
    const targets = resolveAlertTargets(target, dashboardData);

    if (targets == null) {
      return res.status(400).json({
        error: `Unknown alert target: ${target}`,
        code: "INVALID_ALERT_TARGET"
      });
    }

    const deliveries = buildAlertPreviewDeliveries(document, dashboardData, targets);

    return res.json({
      success: true,
      documentId: id,
      documentName: document.name,
      target,
      deliveries,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Alert preview failed: ${error.message}`);
    return res.status(500).json({
      error: "Failed to build alert preview",
      code: "ALERT_PREVIEW_FAILED",
      message: error.message
    });
  }
});

/**
 * POST /api/documents/:id/send-alerts
 * Manually trigger pharmacy and department alerts for a processed document
 * Works for any document type (Prescription, Discharge, Outpatient)
 */
app.post("/api/documents/:id/send-alerts", async (req, res) => {
  const { id } = req.params;
  const { alertType = 'all', target = null } = req.body || {};

  try {
    const documents = await readDocuments();
    const document = documents.find((item) => item.id === id);

    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (!document.result || (document.status !== "processed" && document.status !== "partial")) {
      return res.status(400).json({
        error: "Document must be processed before sending alerts",
        code: "DOCUMENT_NOT_PROCESSED"
      });
    }

    const dashboardData = buildAlertDashboardData(document);
    const requestedTarget = target || alertType;
    const targets = resolveAlertTargets(requestedTarget, dashboardData);

    if (targets == null) {
      return res.status(400).json({
        error: `Unknown alert target: ${requestedTarget}`,
        code: "INVALID_ALERT_TARGET"
      });
    }

    const results = await sendManualAlertsForTargets(document, dashboardData, targets);
    const alertPatch = buildStoredAlertPatch(document.result, dashboardData, targets, results);
    const updatedDocument = await updateDocument(id, async (currentDocument) => {
      currentDocument.result = {
        ...(currentDocument.result || {}),
        ...alertPatch,
      };
    });

    return res.json({
      success: true,
      documentId: id,
      documentName: document.name,
      target: requestedTarget,
      results,
      document: updatedDocument ? publicDocument(updatedDocument) : null,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`Manual alert trigger failed: ${error.message}`);
    return res.status(500).json({
      error: "Failed to send alerts",
      code: "ALERT_SEND_FAILED",
      message: error.message
    });
  }
});

ensureStorage()
  .then(async () => {
    const repairedVoiceDocumentIds = await repairVoiceDocumentsFromSessions();
    if (repairedVoiceDocumentIds.length > 0) {
      console.log(`Repaired ${repairedVoiceDocumentIds.length} voice document record(s) from saved voice sessions.`);
    }
    const repairedLiveConversationDocumentIds = await repairLiveConversationDocuments();
    if (repairedLiveConversationDocumentIds.length > 0) {
      console.log(`Repaired ${repairedLiveConversationDocumentIds.length} live conversation document record(s).`);
    }
    const documents = await readDocuments();
    await analyticsStore.backfillDocuments(documents);

    // Create HTTP server and attach Express app
    const server = http.createServer(app);

    // Attach WebSocket server for live conversation
    liveConversationWebSocket.attach(server, authService);

    server.listen(PORT, () => {
      console.log(`Doctor dashboard processing server listening on http://localhost:${PORT}`);
      console.log(`Live conversation WebSocket: ws://localhost:${PORT}/api/voice/live/sessions/:sessionId/stream`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize storage", error);
    process.exit(1);
  });
