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
const { DocumentsRepository } = require('./repositories/documents_repository.cjs');
const { TranscriptsRepository } = require('./repositories/transcripts_repository.cjs');
const { ReviewWorkflowRepository } = require('./repositories/review_workflow_repository.cjs');
const { ChatRepository } = require('./repositories/chat_repository.cjs');
const { AlertsRepository } = require('./repositories/alerts_repository.cjs');
const { LiveSessionsRepository } = require('./repositories/live_sessions_repository.cjs');

// Live Conversation Support
const LiveConversationWebSocket = require("./live_conversation_websocket.cjs");
const LiveConversationRoutes = require("./live_conversation_routes.cjs");
const VoiceDailyNotesRoutes = require("./voice_daily_notes_routes.cjs");
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
const { SOAPService } = require("./soap_service.cjs");
const { registerAbdmRoutes } = require("./abdm/routes.cjs");
const { registerItemServiceMasterRoutes } = require("./item_service_master_routes.cjs");
const { runEnrichmentJob } = require("./item_master_enrichment.cjs");
// Phase 6: Initialize PrescriptionService with repositories (will be configured after repositories are created)
let prescriptionService = null;
let soapService = null;

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
    process.env.FRONTEND_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:8001",
    "http://127.0.0.1:8001",
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

// Phase 6: Initialize repositories (always required - no conditional initialization)
let docsRepository = new DocumentsRepository();
docsRepository.initialize().catch(err => {
  console.error('[Server] Failed to initialize DocumentsRepository:', err.message);
});

let transcriptsRepository = new TranscriptsRepository();
transcriptsRepository.initialize().catch(err => {
  console.error('[Server] Failed to initialize TranscriptsRepository:', err.message);
});

let reviewWorkflowRepository = new ReviewWorkflowRepository();
reviewWorkflowRepository.initialize().catch(err => {
  console.error('[Server] Failed to initialize ReviewWorkflowRepository:', err.message);
});

let alertsRepository = new AlertsRepository();
alertsRepository.initialize().catch(err => {
  console.error('[Server] Failed to initialize AlertsRepository:', err.message);
});

// ChatRepository: Initialize
let chatRepository = new ChatRepository();
chatRepository.initialize().catch(err => {
  console.error('[Server] Failed to initialize ChatRepository:', err.message);
});

// LiveSessionsRepository: Initialize for live conversation support
let liveSessionsRepo = new LiveSessionsRepository();
liveSessionsRepo.initialize().catch(err => {
  console.error('[Server] Failed to initialize LiveSessionsRepository:', err.message);
});

// Phase 6: Initialize PrescriptionService with repositories
prescriptionService = new PrescriptionService({
  documentsRepository: docsRepository,
  liveSessionsRepository: liveSessionsRepo
});

soapService = new SOAPService({
  documentsRepository: docsRepository,
  liveSessionsRepository: liveSessionsRepo
});

// Initialize Live Conversation components
const liveConversationWebSocket = new LiveConversationWebSocket({
  storageDir,
  transcriptsRepository,
  docsRepository,
  authService,
  debug: process.env.LIVE_CONVERSATION_DEBUG === "true",
});
const liveConversationRoutes = new LiveConversationRoutes({
  storageDir,
  documentsPath,
  authService,
  transcriptsRepository,
  docsRepository // Phase 6: Pass docsRepository for Postgres-only document creation
});

// Voice Daily Notes Routes
const voiceDailyNotesRoutes = new VoiceDailyNotesRoutes({
  storageDir: path.join(storageDir, 'voice_daily_notes'),
  uploadDir: path.join(storageDir, 'voice_daily_notes', 'uploads')
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
  // Strip internal helper fields that should never leak to API responses
  const { filePath, audioPath, transcriptPath, _needsPgUpdate, _pgShadowPending, ...rest } = document;

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

function toPostgresDocumentStatus(status) {
  switch (String(status || "").trim().toLowerCase()) {
    case "processed":
    case "partial":
    case "completed":
      return "completed";
    case "processing":
    case "transcribing":
    case "extracting":
      return "processing";
    case "failed":
      return "failed";
    case "archived":
      return "archived";
    case "pending":
    case "queued":
    case "queued_for_extraction":
    case "review_required":
    default:
      return "pending";
  }
}

function fromPostgresDocumentStatus(status) {
  switch (String(status || "").trim().toLowerCase()) {
    case "processing":
      return "processing";
    case "completed":
      return "processed";
    case "failed":
      return "failed";
    case "archived":
      return "processed";
    case "pending":
    default:
      return "queued";
  }
}

function toLegacyDocumentType(documentType, sourceKind) {
  const normalizedDocumentType = String(documentType || "").trim().toLowerCase();
  const normalizedSourceKind = String(sourceKind || "").trim().toLowerCase();

  if (
    normalizedSourceKind === "voice_upload"
    || normalizedSourceKind === "live_conversation"
    || normalizedDocumentType === "voice_dictation"
    || normalizedDocumentType === "live_conversation"
  ) {
    return "voice";
  }

  return "pdf";
}

/**
 * Compute SHA-256 hash of a buffer
 * @param {Buffer} buffer - File content buffer
 * @returns {string} Hex-encoded SHA-256 hash
 */
function computeHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

async function ensureStorage() {
  // Phase 6: Create only asset directories, not legacy metadata files
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(voiceAudioDir, { recursive: true });
  await fs.mkdir(voiceTranscriptsDir, { recursive: true });
  await fs.mkdir(voiceGraphCheckpointsDir, { recursive: true });

  // Keep search_cache.json (explicit Phase 6 exception)
  await ensureCollectionFile(searchCachePath, { entries: [] });

  // Legacy metadata files are no longer created at runtime
  // Auth, documents, chat, audit, and analytics data are stored in PostgreSQL only

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
  // Phase 6: Read from Postgres only (legacy filesystem reads removed)
  await docsRepository.initialize();
  const documents = await docsRepository.readDocuments();

  // Transform Postgres results to match legacy JSON structure with full hydration
  const hydratedDocuments = await Promise.all(documents.map(async (doc) => {
    // Fetch related data to reconstruct full legacy shape
    const [assets, extraction, chartNotes, alertDeliveries] = await Promise.all([
      docsRepository.findAssetsByDocumentId(doc.id).catch(() => []),
      docsRepository.findCurrentExtraction(doc.id).catch(() => null),
      docsRepository.findChartNotesByDocumentId(doc.id).catch(() => []),
      alertsRepository ? alertsRepository.findAlertDeliveriesByDocumentId(doc.id).catch(() => []) : []
    ]);

    // Reconstruct filePath from assets or use legacy pattern
    let filePath = null;
    let primaryAsset = null;
    if (assets && assets.length > 0) {
      // Look for original source file using correct schema enum values
      primaryAsset = assets.find(a => a.asset_role === 'source_pdf' || a.asset_role === 'source_audio') || assets[0];
      if (primaryAsset && primaryAsset.path_or_uri) {
        filePath = primaryAsset.path_or_uri;
      }
    }

    // Fallback to legacy pattern if no asset found
    if (!filePath) {
      const extension =
        path.extname(doc.original_filename || doc.name || "")
        || (doc.mime_type?.includes('pdf') ? '.pdf' : '');
      filePath = path.join(uploadsDir, `${doc.id}${extension}`);
    }

    let resolvedSize = toFiniteNumber(doc.size_bytes);
    if (!Number.isFinite(resolvedSize) && primaryAsset) {
      resolvedSize = toFiniteNumber(primaryAsset.size_bytes);
    }
    if (!Number.isFinite(resolvedSize) && filePath) {
      try {
        const fileStats = await fs.stat(filePath);
        resolvedSize = fileStats.size;
      } catch {
        resolvedSize = null;
      }
    }

    // Reconstruct result from extraction data with proper legacy structure
    let result = null;
    let agentInfo = null;
    if (extraction) {
      const extractedData =
        extraction.extracted_data_jsonb && typeof extraction.extracted_data_jsonb === "object"
          ? extraction.extracted_data_jsonb
          : {};
      const dashboardPayload =
        extraction.dashboard_payload_jsonb && typeof extraction.dashboard_payload_jsonb === "object"
          ? extraction.dashboard_payload_jsonb
          : {};

      result = Object.keys(dashboardPayload).length > 0 ? { ...dashboardPayload } : {};
      result.extracted_data =
        result.extracted_data && typeof result.extracted_data === "object" && Object.keys(result.extracted_data).length > 0
          ? result.extracted_data
          : (
            Object.keys(extractedData).length > 0
              ? extractedData
              : {
                  medications: [],
                  labTests: [],
                  radiologyTests: [],
                  nuclearMedicineTests: [],
                  procedures: [],
                  diagnoses: [],
                  vitalSigns: [],
                  patientInfo: null,
                }
          );
      result.meta = {
        ...(extraction.meta_jsonb || {}),
        ...(result.meta || {}),
      };
      if (!result.presentation && extraction.presentation_jsonb) {
        result.presentation = extraction.presentation_jsonb;
      }
      if (!result.stage1 && extraction.stage1_jsonb) {
        result.stage1 = extraction.stage1_jsonb;
      }
      if (!result.stage3 && extraction.stage3_jsonb) {
        result.stage3 = extraction.stage3_jsonb;
      }
      if (!result.processedAt) {
        result.processedAt = doc.processed_at || extraction.created_at;
      }

      // Reconstruct alert metadata from alert deliveries
      if (alertDeliveries && alertDeliveries.length > 0) {
        // Reconstruct pharmacy_alert
        const pharmacyAlerts = alertDeliveries.filter(ad => ad.alert_family === 'pharmacy');
        if (pharmacyAlerts.length > 0) {
          const latestPharmacyAlert = pharmacyAlerts[0]; // Most recent first
          result.pharmacy_alert = {
            sent: latestPharmacyAlert.status === 'sent',
            email_sent: latestPharmacyAlert.channel === 'email' && latestPharmacyAlert.status === 'sent',
            whatsapp_sent: latestPharmacyAlert.result_jsonb?.whatsappSent || false, // Use result_jsonb for WhatsApp
            skipped: latestPharmacyAlert.status === 'skipped',
            skip_reason: latestPharmacyAlert.error_message || null,
            error: latestPharmacyAlert.error_message || null,
            medications_count: result.extracted_data.medications?.length || 0
          };
        }

        // Reconstruct department_alerts
        const departmentAlerts = alertDeliveries.filter(ad => ad.alert_family !== 'pharmacy');
        if (departmentAlerts.length > 0) {
          const departmentsMap = {};
          let anyDepartmentSent = false;

          for (const deptAlert of departmentAlerts) {
            const targetName = deptAlert.target_name || deptAlert.alert_family;
            departmentsMap[targetName] = {
              sent: deptAlert.status === 'sent',
              itemCount: deptAlert.payload_jsonb?.itemCount || 0
            };
            if (deptAlert.status === 'sent') {
              anyDepartmentSent = true;
            }
          }

          result.department_alerts = {
            sent: anyDepartmentSent,
            skipped: false,
            skip_reason: null,
            error: departmentAlerts.find(da => da.error_message)?.error_message || null,
            departments: departmentsMap
          };
        }
      }

      // Reconstruct agentInfo from metadata
      const providerTokens = extraction.provider_tokens_jsonb || {};
      const tokensUsed = Object.values(providerTokens).reduce(
        (sum, value) => sum + (typeof value === "number" ? value : 0),
        0
      );
      agentInfo = {
        name: extraction.agent_name || 'unknown',
        agent: extraction.agent_name || 'unknown',
        version: extraction.agent_version || 'unknown',
        auditRunId: extraction.audit_run_id || null,
        providerTokens,
        tokensUsed,
        latency: 0,
        meta: extraction.meta_jsonb || {}
      };
    }

    // Reconstruct chartNote from chart notes (fix field mapping)
    let chartNote = null;
    if (chartNotes && chartNotes.length > 0) {
      const currentChartNote = chartNotes[0]; // Most recent first
      chartNote = {
        content: currentChartNote.content || '', // Use content field directly (no content_jsonb)
        format: 'text', // Chart notes don't have separate format field in Postgres
        createdAt: currentChartNote.created_at,
        createdBy: currentChartNote.created_by_user_id || 'system'
      };
    }

    return {
      id: doc.id,
      status: fromPostgresDocumentStatus(doc.status),
      name: doc.name,
      size: Number.isFinite(resolvedSize) ? resolvedSize : 0,
      uploadedAt: doc.uploaded_at || doc.created_at,
      processedAt: doc.processed_at,
      department: doc.department,
      filePath: filePath,
      hash: doc.sha256_hash,
      error: doc.error_message,
      documentType: toLegacyDocumentType(doc.document_type, doc.source_kind),
      documentSubtype: doc.document_subtype,
      mimeType: doc.mime_type,
      fileName: doc.original_filename,
      linkedPatient: doc.linked_patient_label,
      encounterLabel: doc.encounter_label,
      result: result,
      chartNote: chartNote,
      agentInfo: agentInfo
    };
  }));

  const voiceDocuments = hydratedDocuments.filter((document) => document.documentType === "voice");
  if (voiceDocuments.length > 0) {
    const voiceSessions = await readVoiceSessions().catch(() => []);
    const voiceSessionById = new Map((Array.isArray(voiceSessions) ? voiceSessions : []).map((session) => [session.id, session]));

    for (const document of voiceDocuments) {
      const voiceSession = voiceSessionById.get(document.id);
      if (!voiceSession) continue;
      applyVoiceSessionToDocument(document, voiceSession, {
        processedAt: document.processedAt,
      });
    }
  }

  return hydratedDocuments;
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

// Phase 6: Document mutation wrappers that use Postgres instead of filesystem
// These maintain API compatibility while removing filesystem dependency
async function mutateDocuments(mutator) {
  // Phase 6: Read from Postgres, apply mutations, write back to Postgres
  await docsRepository.initialize();
  const documents = await readDocuments();

  const value = await mutator(documents);

  // Write mutated documents back to Postgres
  // This is a simplified approach - in practice, individual document updates
  // should use repository methods for better performance and concurrency
  for (const document of documents) {
    try {
      await docsRepository.updateDocument(document.id, {
        status: toPostgresDocumentStatus(document.status),
        processed_at: document.processedAt,
        error_code: document.error ? 'PROCESSING_ERROR' : null,
        error_message: document.error || null
      });
    } catch (error) {
      console.error(`[Documents] Failed to update document ${document.id} in Postgres:`, error.message);
    }
  }

  return value;
}

async function persistDocumentExtraction(document) {
  if (!document?.id || !document.result || document.documentType === "voice") {
    return null;
  }

  await docsRepository.initialize();

  let persistedAuditRunId = null;
  const candidateAuditRunId = document.auditRunId || document.agentInfo?.auditRunId || null;
  if (candidateAuditRunId) {
    try {
      const auditRun = await docsRepository.queryOne(
        "SELECT id FROM audit_runs WHERE id = $1",
        [candidateAuditRunId]
      );
      persistedAuditRunId = auditRun?.id || null;
    } catch {
      persistedAuditRunId = null;
    }
  }

  const result = document.result || {};
  const providerTokens = document.agentInfo?.providerTokens || {};
  const existingCurrentExtraction = await docsRepository.findCurrentExtraction(document.id).catch(() => null);

  const extractionPayload = {
    status: document.status === "failed" ? "failed" : "completed",
    agent_name: document.agentInfo?.name || document.agentInfo?.agent || null,
    agent_version: document.agentInfo?.version || null,
    audit_run_id: persistedAuditRunId,
    provider_tokens: providerTokens,
    extracted_data:
      result.extracted_data && typeof result.extracted_data === "object"
        ? result.extracted_data
        : result,
    dashboard_payload: result,
    meta: result.meta || {},
    stage1: result.stage1 || {},
    stage3: result.stage3 || {},
    presentation: result.presentation || {},
  };

  if (existingCurrentExtraction) {
    const updatedExtraction = await docsRepository.queryOne(
      `UPDATE ${docsRepository.documentExtractionsTableName}
       SET status = $1,
           agent_name = $2,
           agent_version = $3,
           audit_run_id = $4,
           provider_tokens_jsonb = $5,
           extracted_data_jsonb = $6,
           dashboard_payload_jsonb = $7,
           meta_jsonb = $8,
           stage1_jsonb = $9,
           stage3_jsonb = $10,
           presentation_jsonb = $11
       WHERE id = $12
       RETURNING *`,
      [
        extractionPayload.status,
        extractionPayload.agent_name,
        extractionPayload.agent_version,
        extractionPayload.audit_run_id,
        docsRepository.toJSONB(extractionPayload.provider_tokens || {}),
        docsRepository.toJSONB(extractionPayload.extracted_data || {}),
        docsRepository.toJSONB(extractionPayload.dashboard_payload || {}),
        docsRepository.toJSONB(extractionPayload.meta || {}),
        docsRepository.toJSONB(extractionPayload.stage1 || {}),
        docsRepository.toJSONB(extractionPayload.stage3 || {}),
        docsRepository.toJSONB(extractionPayload.presentation || {}),
        existingCurrentExtraction.id,
      ]
    );

    // Trigger item master enrichment in background (non-blocking)
    if (updatedExtraction?.id) {
      setImmediate(async () => {
        try {
          await runEnrichmentJob(docsRepository.client.pool, document.id);
        } catch (error) {
          console.error(`[ItemMasterEnrichment] Background job failed for document ${document.id}:`, error.message);
        }
      });
    }

    return updatedExtraction?.id || existingCurrentExtraction.id;
  }

  const previousExtractions = await docsRepository.findDocumentExtractions(document.id).catch(() => []);
  const latestVersionNo =
    Array.isArray(previousExtractions) && previousExtractions.length > 0
      ? Number(previousExtractions[0].version_no || previousExtractions.length)
      : 0;

  const createdExtraction = await docsRepository.createDocumentExtraction({
    document_id: document.id,
    version_no: latestVersionNo + 1,
    ...extractionPayload,
  });

  await docsRepository.updateDocument(document.id, {
    current_extraction_id: createdExtraction.id,
  });

  // Trigger item master enrichment in background (non-blocking)
  if (createdExtraction.id) {
    setImmediate(async () => {
      try {
        await runEnrichmentJob(docsRepository.client.pool, document.id);
      } catch (error) {
        console.error(`[ItemMasterEnrichment] Background job failed for document ${document.id}:`, error.message);
      }
    });
  }

  return createdExtraction.id;
}

async function updateDocument(id, updater) {
  // Phase 6: Update document in Postgres
  await docsRepository.initialize();

  const documents = await readDocuments();
  const document = documents.find((item) => item.id === id);
  if (!document) {
    return null;
  }

  await updater(document, documents);

  // Update the document in Postgres
  try {
    await docsRepository.updateDocument(id, {
      status: toPostgresDocumentStatus(document.status),
      processed_at: document.processedAt,
      error_code: document.error ? 'PROCESSING_ERROR' : null,
      error_message: document.error || null
    });

    const extractionId = await persistDocumentExtraction(document);
    if (extractionId) {
      document.currentExtractionId = extractionId;
    }

    return { ...document };
  } catch (error) {
    console.error(`[Documents] Failed to update document ${id} in Postgres:`, error.message);
    return null;
  }
}

// Phase 6: Voice sessions are fully hydrated from Postgres-backed documents,
// transcript assets, transcript rows, transcript segments, and review workflow rows.

function toVoiceReviewValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toPostgresReviewResolution(resolution) {
  switch (String(resolution || "").trim().toLowerCase()) {
    case "approved":
    case "edited":
      return "approved";
    case "rejected":
      return "rejected";
    case "pending":
    default:
      return "pending";
  }
}

function toVoiceReviewResolution(resolution, editedValue = "") {
  if (resolution === "approved" && editedValue) {
    return "edited";
  }
  if (resolution === "approved" || resolution === "rejected" || resolution === "pending") {
    return resolution;
  }
  return "pending";
}

function buildStoredVoiceTranscriptPayload(session = {}) {
  const transcript = buildVoiceTranscriptObject(session);
  return {
    status: session.status || "queued",
    transcript: {
      rawText: transcript.rawText,
      normalizedText: transcript.normalizedText,
      language: transcript.language,
      speakers: Array.isArray(session.transcript?.speakers) ? session.transcript.speakers : [],
      segments: transcript.segments,
    },
    extracted_data: session.extractedData || null,
    dashboard_payload: session.dashboardPayload || null,
    extraction_preview: session.extractionPreview || null,
    stt_audit: session.sttAudit || null,
    progress: {
      message: session.progressMessage || null,
      stage: session.progressStage || null,
      percent: typeof session.progressPercent === "number" ? session.progressPercent : null,
    },
    duration_label: session.durationLabel || null,
    transcript_path: session.transcriptPath || null,
    file_name: session.fileName || null,
    mime_type: session.mimeType || null,
    size: typeof session.size === "number" ? session.size : null,
    hash: session.hash || null,
  };
}

function buildVoiceSegmentForSession(segment = {}, index = 0, payloadSegment = {}) {
  const startMs = typeof segment.start_ms === "number"
    ? segment.start_ms
    : (typeof segment.startMs === "number" ? segment.startMs : null);
  const endMs = typeof segment.end_ms === "number"
    ? segment.end_ms
    : (typeof segment.endMs === "number" ? segment.endMs : null);
  const confidenceValue = typeof segment.confidence_score === "number"
    ? segment.confidence_score
    : Number(segment.confidence);
  const id = segment.id || payloadSegment.id || payloadSegment.segmentId || `seg_${index + 1}`;

  return {
    id,
    speakerRole: normalizeSpeakerRole(segment.speaker_role || segment.speakerRole || payloadSegment.speakerRole),
    speakerLabel:
      normalizeVoiceText(segment.speaker_label || segment.speakerLabel || payloadSegment.speakerLabel || `Speaker ${index + 1}`) ||
      `Speaker ${index + 1}`,
    startLabel:
      normalizeVoiceText(payloadSegment.startLabel) ||
      (startMs !== null ? formatVoiceTimeLabel(Math.floor(startMs / 1000)) : fallbackVoiceTimeLabel(index)),
    endLabel:
      normalizeVoiceText(payloadSegment.endLabel) ||
      (endMs !== null ? formatVoiceTimeLabel(Math.floor(endMs / 1000)) : fallbackVoiceTimeLabel(index + 1)),
    text:
      normalizeVoiceText(segment.text || segment.normalized_text || segment.normalizedText || payloadSegment.text) ||
      "[No transcript text returned]",
    confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : null,
    flags: normalizeVoiceFlags(segment.flags_jsonb || segment.flags || payloadSegment.flags || []),
  };
}

async function loadVoiceReviewItems(documentId) {
  if (!reviewWorkflowRepository) return [];

  await reviewWorkflowRepository.initialize();
  const items = await reviewWorkflowRepository.findReviewItemsByDocumentId(documentId);
  const hydrated = [];

  for (const item of items) {
    const resolutions = await reviewWorkflowRepository.findReviewItemResolutionsByReviewItemId(item.id);
    const latestResolution = resolutions[resolutions.length - 1] || null;
    const editedValue = toVoiceReviewValue(latestResolution?.edited_value_jsonb?.value || "");

    hydrated.push({
      id: item.id,
      category: item.category || "transcript",
      severity: item.severity || "low",
      reasonCode: item.reason_code || "low_confidence",
      title: item.title || "Review item",
      extractedValue: toVoiceReviewValue(item.extracted_value_jsonb?.value || ""),
      suggestedValue: toVoiceReviewValue(item.suggested_value_jsonb?.value || ""),
      provenanceText: item.provenance_text || "",
      provenanceTime: item.provenance_range_jsonb?.provenance_time || "",
      resolution: toVoiceReviewResolution(latestResolution?.resolution || item.current_resolution, editedValue),
      editedValue,
      createdAt: item.created_at,
      resolvedAt: latestResolution?.created_at || null,
    });
  }

  return hydrated;
}

async function upsertVoiceDocumentAsset(documentId, assetRole, assetData = {}) {
  await docsRepository.initialize();

  const assetId = assetData.id || `${documentId}:${assetRole}`;
  const existing = await docsRepository.queryOne(
    `SELECT * FROM ${docsRepository.documentAssetsTableName} WHERE id = $1`,
    [assetId]
  ).catch(() => null);

  if (existing) {
    await docsRepository.queryOne(
      `UPDATE ${docsRepository.documentAssetsTableName}
       SET path_or_uri = $1,
           mime_type = $2,
           size_bytes = $3,
           sha256_hash = $4,
           metadata_jsonb = $5
       WHERE id = $6
       RETURNING *`,
      [
        assetData.path_or_uri,
        assetData.mime_type || null,
        assetData.size_bytes || null,
        assetData.sha256_hash || null,
        docsRepository.toJSONB(assetData.metadata || {}),
        assetId,
      ]
    );
    return;
  }

  await docsRepository.createDocumentAsset({
    id: assetId,
    document_id: documentId,
    asset_role: assetRole,
    storage_backend: assetData.storage_backend || "filesystem",
    path_or_uri: assetData.path_or_uri,
    mime_type: assetData.mime_type || null,
    size_bytes: assetData.size_bytes || null,
    sha256_hash: assetData.sha256_hash || null,
    metadata: assetData.metadata || {},
  });
}

async function deleteVoiceDocumentAsset(documentId, assetRole) {
  await docsRepository.initialize();
  await docsRepository.execute(
    `DELETE FROM ${docsRepository.documentAssetsTableName}
     WHERE document_id = $1 AND asset_role = $2`,
    [documentId, assetRole]
  );
}

function buildVoiceReviewItemRecord(sessionId, transcriptId, reviewItem = {}) {
  return {
    id: reviewItem.id || crypto.randomUUID(),
    document_id: sessionId,
    live_session_id: null,
    transcript_id: transcriptId,
    category: reviewItem.category || "transcript",
    severity: reviewItem.severity || "low",
    reason_code: reviewItem.reasonCode || null,
    title: normalizeVoiceText(reviewItem.title) || "Review item",
    field_path: null,
    required_flag: false,
    provenance_text: normalizeVoiceText(reviewItem.provenanceText) || null,
    provenance_range: {
      provenance_time: normalizeVoiceText(reviewItem.provenanceTime) || null,
    },
    extracted_value: reviewItem.extractedValue ? { value: reviewItem.extractedValue } : {},
    suggested_value: reviewItem.suggestedValue ? { value: reviewItem.suggestedValue } : {},
    current_resolution: toPostgresReviewResolution(reviewItem.resolution),
  };
}

async function syncVoiceReviewItems(sessionId, transcriptId, reviewItems = []) {
  if (!reviewWorkflowRepository) return;

  await reviewWorkflowRepository.initialize();
  const existingItems = await reviewWorkflowRepository.findReviewItemsByDocumentId(sessionId);
  const existingById = new Map(existingItems.map((item) => [item.id, item]));
  const nextItems = Array.isArray(reviewItems) ? reviewItems : [];
  const nextIds = new Set(nextItems.map((item) => item.id).filter(Boolean));

  for (const existingItem of existingItems) {
    if (!nextIds.has(existingItem.id)) {
      await reviewWorkflowRepository.execute(
        `DELETE FROM ${reviewWorkflowRepository.reviewItemsTableName} WHERE id = $1`,
        [existingItem.id]
      );
    }
  }

  for (const reviewItem of nextItems) {
    const record = buildVoiceReviewItemRecord(sessionId, transcriptId, reviewItem);

    if (!existingById.has(record.id)) {
      await reviewWorkflowRepository.createReviewItem(record);
      continue;
    }

    await reviewWorkflowRepository.queryOne(
      `UPDATE ${reviewWorkflowRepository.reviewItemsTableName}
       SET transcript_id = $1,
           category = $2,
           severity = $3,
           reason_code = $4,
           title = $5,
           field_path = $6,
           required_flag = $7,
           provenance_text = $8,
           provenance_range_jsonb = $9,
           extracted_value_jsonb = $10,
           suggested_value_jsonb = $11,
           current_resolution = $12,
           updated_at = $13
       WHERE id = $14
       RETURNING *`,
      [
        record.transcript_id,
        record.category,
        record.severity,
        record.reason_code,
        record.title,
        record.field_path,
        record.required_flag,
        record.provenance_text,
        reviewWorkflowRepository.toJSONB(record.provenance_range || {}),
        reviewWorkflowRepository.toJSONB(record.extracted_value || {}),
        reviewWorkflowRepository.toJSONB(record.suggested_value || {}),
        record.current_resolution,
        new Date().toISOString(),
        record.id,
      ]
    );
  }
}

async function appendVoiceReviewResolution(reviewItemId, resolution, editedValue, userId, notes = null) {
  if (!reviewWorkflowRepository) return null;

  await reviewWorkflowRepository.initialize();
  return reviewWorkflowRepository.createReviewItemResolution({
    id: crypto.randomUUID(),
    review_item_id: reviewItemId,
    resolved_by_user_id: userId || null,
    resolution: toPostgresReviewResolution(resolution),
    edited_value: resolution === "edited" ? { value: editedValue || "" } : {},
    notes,
  });
}

async function syncVoiceTranscriptSegments(transcriptId, segments = []) {
  await transcriptsRepository.initialize();
  await transcriptsRepository.execute(
    `DELETE FROM ${transcriptsRepository.transcriptSegmentsTableName} WHERE transcript_id = $1`,
    [transcriptId]
  );

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] || {};
    const startMs = typeof segment.startMs === "number"
      ? segment.startMs
      : (typeof segment.startTime === "number" ? segment.startTime : null);
    const endMs = typeof segment.endMs === "number"
      ? segment.endMs
      : (typeof segment.endTime === "number" ? segment.endTime : null);

    await transcriptsRepository.createSegment({
      id: segment.id || crypto.randomUUID(),
      transcript_id: transcriptId,
      segment_order: index,
      speaker_role: normalizeSpeakerRole(segment.speakerRole),
      speaker_label: normalizeVoiceText(segment.speakerLabel || `Speaker ${index + 1}`) || `Speaker ${index + 1}`,
      start_ms: startMs,
      end_ms: endMs,
      text: normalizeVoiceText(segment.text) || "[No transcript text returned]",
      normalized_text: normalizeVoiceText(segment.normalizedText || segment.text) || "[No transcript text returned]",
      confidence_score: typeof segment.confidence === "number" ? segment.confidence : null,
      flags: normalizeVoiceFlags(segment.flags || []),
      status: "active",
    });
  }
}

async function persistVoiceSession(session) {
  await docsRepository.initialize();
  await transcriptsRepository.initialize();

  const documentName = session.fileName || `voice_${session.id}`;
  const documentUpdates = {
    document_type: "voice_dictation",
    document_subtype: "unknown",
    source_kind: "voice_upload",
    status: toPostgresDocumentStatus(session.status),
    department: "Voice Dictation",
    name: documentName,
    original_filename: documentName,
    mime_type: session.mimeType || "audio/wav",
    size_bytes: typeof session.size === "number" ? session.size : null,
    sha256_hash: session.hash || null,
    linked_patient_label: session.linkedPatient || null,
    encounter_label: session.encounterLabel || null,
    uploaded_at: session.uploadedAt || null,
    processed_at: session.status === "processed" ? (session.processedAt || new Date().toISOString()) : null,
    error_code: session.error ? "PROCESSING_ERROR" : null,
    error_message: session.error || null,
  };

  const existingDocument = await docsRepository.findDocumentById(session.id);
  if (!existingDocument) {
    await docsRepository.createDocument({
      id: session.id,
      ...documentUpdates,
    });
  } else {
    await docsRepository.updateDocument(session.id, documentUpdates);
  }

  const existingTranscripts = await transcriptsRepository.findTranscriptsByDocumentId(session.id);
  let transcript = null;
  if (existingDocument?.current_transcript_id) {
    transcript = await transcriptsRepository.findTranscriptById(existingDocument.current_transcript_id).catch(() => null);
  }
  if (!transcript) {
    transcript = existingTranscripts[0] || null;
  }

  const transcriptPayload = buildStoredVoiceTranscriptPayload(session);
  const transcriptObject = buildVoiceTranscriptObject(session);

  if (!transcript) {
    transcript = await transcriptsRepository.createTranscript({
      id: crypto.randomUUID(),
      document_id: session.id,
      backend: session.sttBackend || null,
      language_code: transcriptObject.language || null,
      raw_text: transcriptObject.rawText || null,
      normalized_text: transcriptObject.normalizedText || null,
      quality: session.transcriptQuality || {},
      transcript: transcriptPayload,
    });
  } else {
    transcript = await transcriptsRepository.updateTranscript(transcript.id, {
      backend: session.sttBackend || null,
      language_code: transcriptObject.language || null,
      raw_text: transcriptObject.rawText || null,
      normalized_text: transcriptObject.normalizedText || null,
      quality_jsonb: session.transcriptQuality || {},
      transcript_jsonb: transcriptPayload,
    });
  }

  await docsRepository.updateDocument(session.id, {
    current_transcript_id: transcript.id,
    status: toPostgresDocumentStatus(session.status),
    linked_patient_label: session.linkedPatient || null,
    encounter_label: session.encounterLabel || null,
    error_code: session.error ? "PROCESSING_ERROR" : null,
    error_message: session.error || null,
    processed_at: session.status === "processed" ? (session.processedAt || new Date().toISOString()) : null,
  });

  await syncVoiceTranscriptSegments(transcript.id, Array.isArray(session.segments) ? session.segments : []);
  await syncVoiceReviewItems(session.id, transcript.id, Array.isArray(session.reviewItems) ? session.reviewItems : []);

  if (session.audioPath) {
    await upsertVoiceDocumentAsset(session.id, "source_audio", {
      id: `${session.id}:source_audio`,
      path_or_uri: session.audioPath,
      mime_type: session.mimeType || "audio/wav",
      size_bytes: typeof session.size === "number" ? session.size : null,
      sha256_hash: session.hash || null,
      metadata: {
        originalFilename: documentName,
        durationLabel: session.durationLabel || null,
      },
    });
  }

  if (session.transcriptPath) {
    await upsertVoiceDocumentAsset(session.id, "transcript_json", {
      id: `${session.id}:transcript_json`,
      path_or_uri: session.transcriptPath,
      mime_type: "application/json",
      metadata: {
        transcriptId: transcript.id,
      },
    });
  } else {
    await deleteVoiceDocumentAsset(session.id, "transcript_json");
  }

  return transcript;
}

// ========================================
// Phase 4: Chat Read Functions (Postgres-ready)
// ========================================

function normalizeOptionalChatState(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
    return null;
  }
  return value;
}

function toLegacyChatMessage(messageRow) {
  const citations = chatRepository.fromJSONB(messageRow.citations_jsonb) || [];
  const proposedActions = chatRepository.fromJSONB(messageRow.proposed_actions_jsonb) || [];
  const decisionPrompt = normalizeOptionalChatState(chatRepository.fromJSONB(messageRow.decision_prompt_jsonb));
  const trace = normalizeOptionalChatState(chatRepository.fromJSONB(messageRow.trace_jsonb));

  const baseMessage = {
    id: messageRow.id,
    role: messageRow.role,
    citations,
    createdAt: messageRow.created_at
  };

  if (messageRow.role === "assistant") {
    return {
      ...baseMessage,
      content: messageRow.content,
      answer: messageRow.content,
      confidence: messageRow.confidence_score,
      confidence_label: messageRow.confidence_label || undefined,
      source_class: messageRow.source_class || undefined,
      llm_provider: messageRow.provider || undefined,
      proposed_actions: proposedActions,
      decision_prompt: decisionPrompt,
      trace: trace || undefined
    };
  }

  return {
    ...baseMessage,
    content: messageRow.content,
    trace: trace || undefined
  };
}

function toLegacyConfirmedAction(actionRow) {
  const payload = chatRepository.fromJSONB(actionRow.payload_jsonb) || {};
  const citations = Array.isArray(payload.citations) ? payload.citations : [];

  return {
    id: actionRow.id,
    chatId: actionRow.chat_session_id,
    documentId: actionRow.document_id,
    type: actionRow.action_type,
    title: actionRow.title,
    payload,
    rationale: actionRow.rationale,
    citations,
    requires_confirmation: true,
    confirmedAt: actionRow.confirmed_at,
    confirmedBy: actionRow.confirmed_by_user_id,
    createdAt: actionRow.created_at,
    actionType: actionRow.action_type,
    actionLabel: actionRow.title
  };
}

function toLegacyChatExport(exportRow) {
  const payload = chatRepository.fromJSONB(exportRow.export_payload_jsonb) || {};
  const content = payload.content || payload.data || payload.chart_note_appendix || null;

  return {
    id: exportRow.id,
    chatId: exportRow.chat_session_id,
    documentId: exportRow.document_id,
    exportType: payload.type || "chart_note_appendix",
    format: payload.format || "text/plain",
    content,
    chart_note_appendix: payload.chart_note_appendix || content || "",
    createdBy: exportRow.created_by_user_id,
    createdAt: exportRow.created_at
  };
}

function toChatMessageRecord(session, message) {
  const messageId = message.id || crypto.randomUUID();
  const assistantAnswer = typeof message.answer === "string" ? message.answer : "";
  const normalizedContent =
    typeof message.content === "string"
      ? message.content
      : assistantAnswer;

  return {
    id: messageId,
    chat_session_id: session.chatId,
    role: message.role,
    content: normalizedContent,
    citations: Array.isArray(message.citations) ? message.citations : [],
    confidence_score: message.confidence ?? message.confidenceScore ?? null,
    confidence_label: message.confidence_label ?? message.confidenceLabel ?? null,
    source_class: message.source_class ?? message.sourceClass ?? null,
    proposed_actions: message.proposed_actions ?? message.proposedActions ?? [],
    decision_prompt: normalizeOptionalChatState(message.decision_prompt ?? message.decisionPrompt) || {},
    trace: normalizeOptionalChatState(message.trace) || {},
    provider: message.llm_provider ?? message.provider ?? null,
    created_at: message.createdAt || new Date().toISOString()
  };
}

function toConfirmedActionRecord(action) {
  const payload = {
    ...(action.payload || {}),
    citations: Array.isArray(action.citations) ? action.citations : [],
    requires_confirmation: true
  };

  return {
    id: action.id || crypto.randomUUID(),
    chat_session_id: action.chatId,
    document_id: action.documentId,
    action_type: action.actionType || action.type,
    title: action.actionLabel || action.title,
    rationale: action.rationale,
    payload,
    confirmed_by_user_id: action.confirmedBy || action.confirmedByUserId || action.confirmed_by_user_id || null,
    confirmed_at: action.confirmedAt || action.confirmed_at || new Date().toISOString(),
    created_at: action.createdAt || action.confirmedAt || action.confirmed_at || new Date().toISOString()
  };
}

function toChatExportRecord(exp) {
  return {
    id: exp.id || crypto.randomUUID(),
    chat_session_id: exp.chatId,
    document_id: exp.documentId,
    export_payload: {
      type: exp.exportType || "chart_note_appendix",
      format: exp.format || "text/plain",
      content: exp.content || exp.data || exp.chart_note_appendix || null,
      chart_note_appendix: exp.chart_note_appendix || exp.content || exp.data || ""
    },
    created_by_user_id: exp.createdBy || null,
    created_at: exp.createdAt || new Date().toISOString()
  };
}

async function readChatSessions() {
  // Phase 6: Read from Postgres only (legacy filesystem reads removed)
  await chatRepository.initialize();
  const sessions = await chatRepository.query(`
    SELECT * FROM ${chatRepository.chatSessionsTableName}
    ORDER BY created_at DESC
  `);

  // Transform to legacy format with full hydration including messages and actions
  const hydratedSessions = await Promise.all(sessions.map(async (session) => {
    // Fetch messages for this session
    const messages = await chatRepository.findMessagesByChatSessionId(session.id).catch(() => []);

    // Fetch confirmed actions for this session
    const confirmedActions = await chatRepository.findActionsBySessionId(session.id).catch(() => []);

    const legacyMessages = messages.map(toLegacyChatMessage);
    const legacyConfirmedActions = confirmedActions.map(toLegacyConfirmedAction);
    const pendingExternalConsent = normalizeOptionalChatState(chatRepository.fromJSONB(session.pending_external_consent_jsonb));
    const pendingClarification = normalizeOptionalChatState(chatRepository.fromJSONB(session.pending_clarification_jsonb));
    const pendingGeminiKeyPrompt = normalizeOptionalChatState(chatRepository.fromJSONB(session.pending_provider_prompt_jsonb));

    return {
      chatId: session.id,
      documentId: session.document_id,
      userId: session.user_id,
      status: session.status,
      pendingExternalConsent,
      pendingClarification,
      pendingGeminiKeyPrompt,
      pendingProviderPrompt: pendingGeminiKeyPrompt,
      messages: legacyMessages,
      confirmedActions: legacyConfirmedActions,
      createdAt: session.created_at,
      updatedAt: session.updated_at
    };
  }));

  return hydratedSessions;
}

async function writeChatSessions(sessions) {
  // Phase 6: Write to Postgres only (legacy filesystem writes removed)
  for (const session of sessions) {
    try {
      // Check if session exists in Postgres
      const existingSession = await chatRepository.findChatSessionById(session.chatId).catch(() => null);

      if (existingSession) {
        // Update existing session
        await chatRepository.updateChatSession(session.chatId, {
          status: session.status,
          pending_external_consent_jsonb: normalizeOptionalChatState(session.pendingExternalConsent) || {},
          pending_clarification_jsonb: normalizeOptionalChatState(session.pendingClarification) || {},
          pending_provider_prompt_jsonb:
            normalizeOptionalChatState(session.pendingGeminiKeyPrompt ?? session.pendingProviderPrompt) || {}
        });
      } else {
        // Create new session
        await chatRepository.createChatSession({
          id: session.chatId,
          document_id: session.documentId,
          user_id: session.userId,
          status: session.status,
          pending_external_consent: normalizeOptionalChatState(session.pendingExternalConsent) || {},
          pending_clarification: normalizeOptionalChatState(session.pendingClarification) || {},
          pending_provider_prompt:
            normalizeOptionalChatState(session.pendingGeminiKeyPrompt ?? session.pendingProviderPrompt) || {}
        });
      }

      // Sync messages to Postgres (Phase 6 critical fix)
      // Messages must be written to chat_messages table
      if (session.messages && Array.isArray(session.messages)) {
        // Get existing messages for this session
        const existingMessages = await chatRepository.findMessagesByChatSessionId(session.chatId).catch(() => []);
        const existingMessageIds = new Set(existingMessages.map(msg => msg.id));
        const currentMessageIds = new Set();

        // Create or update messages
        for (const message of session.messages) {
          const messageData = toChatMessageRecord(session, message);
          message.id = messageData.id;
          currentMessageIds.add(messageData.id);

          if (existingMessageIds.has(message.id)) {
            // Message exists, update it
            await chatRepository.query(`
              UPDATE ${chatRepository.chatMessagesTableName}
              SET role = $1, content = $2, citations_jsonb = $3, confidence_score = $4,
                  confidence_label = $5, source_class = $6, proposed_actions_jsonb = $7,
                  decision_prompt_jsonb = $8, trace_jsonb = $9, provider = $10
              WHERE id = $11
            `, [
              messageData.role, messageData.content, chatRepository.toJSONB(messageData.citations),
              messageData.confidence_score, messageData.confidence_label, messageData.source_class,
              chatRepository.toJSONB(messageData.proposed_actions), chatRepository.toJSONB(messageData.decision_prompt),
              chatRepository.toJSONB(messageData.trace), messageData.provider, message.id
            ]).catch(err => console.error('[Chat] Failed to update message:', err.message));
          } else {
            // Create new message
            await chatRepository.createMessage({
              id: message.id,
              ...messageData
            }).catch(err => console.error('[Chat] Failed to create message:', err.message));
          }
        }

        // Delete messages that are no longer in the session (optional cleanup)
        for (const existingMsg of existingMessages) {
          if (!currentMessageIds.has(existingMsg.id)) {
            await chatRepository.query(`
              DELETE FROM ${chatRepository.chatMessagesTableName} WHERE id = $1
            `, [existingMsg.id]).catch(err => console.error('[Chat] Failed to delete message:', err.message));
          }
        }
      }
    } catch (pgError) {
      console.error('[Chat] Failed to write chat session to Postgres:', pgError.message);
    }
  }
}

async function readChatActions() {
  // Phase 6: Read from Postgres only (legacy filesystem reads removed)
  await chatRepository.initialize();
  const actions = await chatRepository.query(`
    SELECT * FROM ${chatRepository.chatConfirmedActionsTableName}
    ORDER BY created_at DESC
  `);
  return actions.map(toLegacyConfirmedAction);
}

async function writeChatActions(actions) {
  // Phase 6: Write to Postgres only (legacy filesystem writes removed)
  for (const action of actions) {
    try {
      const actionData = toConfirmedActionRecord(action);

      // Check if action exists in Postgres
      const existingAction = await chatRepository.queryOne(`
        SELECT * FROM ${chatRepository.chatConfirmedActionsTableName}
        WHERE id = $1
      `, [actionData.id]).catch(() => null);

      if (!existingAction && actionData.action_type && actionData.title) {
        await chatRepository.createConfirmedAction(actionData);
      }
    } catch (pgError) {
      console.error('[Chat] Failed to write chat action to Postgres:', pgError.message);
    }
  }
}

async function readChatExports() {
  // Phase 6: Read from Postgres only (legacy filesystem reads removed)
  await chatRepository.initialize();
  const exports = await chatRepository.query(`
    SELECT * FROM ${chatRepository.chatExportsTableName}
    ORDER BY created_at DESC
  `);
  return exports.map(toLegacyChatExport);
}

async function writeChatExports(exports) {
  // Phase 6: Write to Postgres only (legacy filesystem writes removed)
  for (const exp of exports) {
    try {
      const exportData = toChatExportRecord(exp);

      // Check if export exists in Postgres
      const existingExport = await chatRepository.queryOne(`
        SELECT * FROM ${chatRepository.chatExportsTableName}
        WHERE id = $1
      `, [exportData.id]).catch(() => null);

      if (!existingExport) {
        await chatRepository.createExport(exportData);
      }
    } catch (pgError) {
      console.error('[Chat] Failed to write chat export to Postgres:', pgError.message);
    }
  }
}

async function readVoiceSessions() {
  await transcriptsRepository.initialize();
  await docsRepository.initialize();
  const voiceDocuments = await docsRepository.query(`
    SELECT *
    FROM ${docsRepository.documentsTableName}
    WHERE source_kind = 'voice_upload'
    ORDER BY COALESCE(uploaded_at, created_at) DESC
  `);

  const hydratedSessions = [];
  for (const document of voiceDocuments) {
    let transcript = null;
    if (document.current_transcript_id) {
      transcript = await transcriptsRepository.findTranscriptById(document.current_transcript_id).catch(() => null);
    }
    if (!transcript) {
      const transcripts = await transcriptsRepository.findTranscriptsByDocumentId(document.id).catch(() => []);
      transcript = transcripts[0] || null;
    }

    const transcriptPayload = transcript ? transcriptsRepository.fromJSONB(transcript.transcript_jsonb) : {};
    const transcriptSegments = transcript
      ? await transcriptsRepository.findSegmentsByTranscriptId(transcript.id).catch(() => [])
      : [];
    const payloadSegments = Array.isArray(transcriptPayload?.transcript?.segments) ? transcriptPayload.transcript.segments : [];
    const assets = await docsRepository.findAssetsByDocumentId(document.id).catch(() => []);
    const sourceAudioAsset = assets.find((asset) => asset.asset_role === "source_audio") || null;
    const transcriptAsset = assets.find((asset) => asset.asset_role === "transcript_json") || null;
    const sourceAudioMetadata = docsRepository.fromJSONB(sourceAudioAsset?.metadata_jsonb || {});

    const segmentsSource = transcriptSegments.length > 0 ? transcriptSegments : payloadSegments;
    const segments = segmentsSource.map((segment, index) => {
      const payloadSegment = payloadSegments[index] || segment;
      return buildVoiceSegmentForSession(segment, index, payloadSegment);
    });
    const reviewItems = await loadVoiceReviewItems(document.id);

    const rawStatus = transcriptPayload.status || "";
    const fallbackStatus = document.status === "completed"
      ? (segments.length > 0 && reviewItems.some((item) => item.resolution === "pending") ? "review_required" : "processed")
      : document.status === "processing"
        ? "transcribing"
        : document.status === "failed"
          ? "failed"
          : "queued";
    const transcriptQuality = transcript?.quality_jsonb || {};
    const extractedData = transcriptPayload.extracted_data || null;
    const dashboardPayload = transcriptPayload.dashboard_payload || null;
    const durationFromSegments = segments
      .map((segment, index) => {
        const source = transcriptSegments[index] || {};
        return typeof source.end_ms === "number" ? source.end_ms : null;
      })
      .filter((value) => typeof value === "number")
      .pop();

    const session = {
      id: document.id,
      documentId: document.id,
      documentType: "voice",
      status: rawStatus || fallbackStatus,
      name: document.name || `voice_${document.id}`,
      fileName: document.original_filename || document.name || transcriptPayload.file_name || `voice_${document.id}`,
      mimeType: document.mime_type || sourceAudioAsset?.mime_type || transcriptPayload.mime_type || "audio/wav",
      size: Number(document.size_bytes || transcriptPayload.size || sourceAudioAsset?.size_bytes || 0),
      uploadedAt: document.uploaded_at || document.created_at,
      processedAt: document.processed_at || null,
      sttBackend: transcript?.backend || "Transcription Service",
      transcriptQuality,
      extractedData,
      dashboardPayload,
      transcript: {
        segments,
        rawText: transcript?.raw_text || transcriptPayload?.transcript?.rawText || "",
        normalizedText: transcript?.normalized_text || transcriptPayload?.transcript?.normalizedText || "",
        language: transcript?.language_code || transcriptPayload?.transcript?.language || null,
        speakers: Array.isArray(transcriptPayload?.transcript?.speakers) ? transcriptPayload.transcript.speakers : [],
        quality: transcriptQuality,
      },
      segments,
      reviewItems,
      linkedPatient: document.linked_patient_label || "Encounter link pending",
      encounterLabel: document.encounter_label || "Not linked",
      durationLabel:
        transcriptPayload.duration_label ||
        sourceAudioMetadata.durationLabel ||
        (typeof durationFromSegments === "number"
          ? formatVoiceTimeLabel(Math.ceil(durationFromSegments / 1000))
          : estimateVoiceDurationLabel(Number(document.size_bytes || 0))),
      extractionPreview: transcriptPayload.extraction_preview || null,
      sttAudit: transcriptPayload.stt_audit || null,
      progressMessage: transcriptPayload.progress?.message || null,
      progressStage: transcriptPayload.progress?.stage || null,
      progressPercent: typeof transcriptPayload.progress?.percent === "number" ? transcriptPayload.progress.percent : null,
      audioPath: sourceAudioAsset?.path_or_uri || null,
      transcriptPath: transcriptAsset?.path_or_uri || transcriptPayload.transcript_path || null,
      hash: document.sha256_hash || sourceAudioAsset?.sha256_hash || transcriptPayload.hash || null,
      error: document.error_message || null,
    };

    if (!session.extractionPreview) {
      session.extractionPreview = buildVoiceExtractionPreview(session, session.transcript, reviewItems);
    }

    hydratedSessions.push(session);
  }

  return hydratedSessions;
}

// ========================================
// Phase 4: Alerts Read Functions (Postgres-ready)
// ========================================

async function readAlerts() {
  // Phase 4 Read Cutover: Use Postgres when ENABLE_PG_READ_ALERTS=true
  if (process.env.ENABLE_PG_READ_ALERTS === 'true' && alertsRepository) {
    await alertsRepository.initialize();
    const alerts = await alertsRepository.query(`
      SELECT * FROM ${alertsRepository.alertDeliveriesTableName}
      ORDER BY created_at DESC
    `);
    // Transform to legacy format for API compatibility
    return alerts.map(alert => ({
      id: alert.id,
      documentId: alert.document_id,
      alertFamily: alert.alert_family,
      targetName: alert.target_name,
      channel: alert.channel,
      recipient: alert.recipient,
      status: alert.status,
      payload: alertsRepository.fromJSONB(alert.payload_jsonb) || {},
      result: alertsRepository.fromJSONB(alert.result_jsonb) || {},
      errorMessage: alert.error_message,
      sentAt: alert.sent_at,
      createdAt: alert.created_at
    }));
  }

  // Legacy: Return empty array (no filesystem alerts storage exists)
  return [];
}

async function writeVoiceSessions(sessions) {
  for (const session of sessions) {
    try {
      await persistVoiceSession(session);
    } catch (error) {
      console.error("[Voice] Failed to write session to Postgres:", error.message);
    }
  }
}

async function mutateVoiceSessions(mutator) {
  const sessions = await readVoiceSessions();
  const result = await mutator(sessions);
  await writeVoiceSessions(sessions);
  return result;
}

async function updateVoiceSession(id, updater) {
  const sessions = await readVoiceSessions();
  const session = sessions.find((item) => item.id === id);
  if (!session) {
    return null;
  }

  try {
    await updater(session);
    await persistVoiceSession(session);
    return { ...session };
  } catch (error) {
    console.error("[Voice] Failed to update session:", error.message);
    return null;
  }
}

async function removeVoiceSession(id) {
  const sessions = await readVoiceSessions();
  const session = sessions.find((item) => item.id === id);
  if (!session) {
    return null;
  }

  try {
    const transcripts = await transcriptsRepository.findTranscriptsByDocumentId(id).catch(() => []);
    for (const transcript of transcripts) {
      await transcriptsRepository.deleteTranscript(transcript.id).catch(() => {});
    }

    await docsRepository.deleteDocument(id);
    return session;
  } catch (error) {
    console.error("[Voice] Failed to remove session:", error.message);
    return null;
  }
}

async function removeDocument(id) {
  // First delete from PostgreSQL (primary storage)
  let pgDeleted = false;
  let pgDocument = null;
  try {
    await docsRepository.initialize();
    // Try to get the document first for cleanup
    const docs = await docsRepository.readDocuments({ where: { id } });
    if (docs && docs.length > 0) {
      pgDocument = docs[0];
    }
    pgDeleted = await docsRepository.deleteDocument(id);
    if (pgDeleted) {
      console.log(`[removeDocument] Deleted ${id} from PostgreSQL`);
    }
  } catch (error) {
    console.error(`[removeDocument] Failed to delete from PostgreSQL:`, error.message);
  }

  // Also clean up from legacy JSON storage for compatibility
  return mutateDocuments(async (documents) => {
    const index = documents.findIndex((item) => item.id === id);
    if (index === -1) {
      // Return PostgreSQL document if JSON doesn't have it
      if (pgDocument) {
        console.log(`[removeDocument] Document ${id} not in JSON, returning PG document`);
        return publicDocument(pgDocument);
      }
      return null;
    }

    const [document] = documents.splice(index, 1);
    console.log(`[removeDocument] Deleted ${id} from documents.json`);
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
  readSessions: async () => readChatSessions(),
  writeSessions: async (sessions) => writeChatSessions(sessions),
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

function toIsoDateOnly(value) {
  const fallback = new Date().toISOString().split("T")[0];

  if (value == null) {
    return fallback;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }

    return trimmed.includes("T") ? trimmed.split("T")[0] : trimmed.slice(0, 10);
  }

  if (value instanceof Date || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
    return fallback;
  }

  if (typeof value === "object" && typeof value.toISOString === "function") {
    try {
      const isoValue = value.toISOString();
      return typeof isoValue === "string" && isoValue
        ? isoValue.split("T")[0]
        : fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
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
      transcript_date: toIsoDateOnly(uploadedAt),
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
// Phase 6: Startup repair functions removed - no longer needed with Postgres as authoritative source
// Voice and live conversation data is now stored in relational tables, not rebuilt from session files

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
  const requestedStatus = String(overrides.status || "info").toLowerCase();
  const normalizedStatus =
    requestedStatus === "success" ? "completed" :
    requestedStatus === "error" ? "failed" :
    requestedStatus === "info" ? "started" :
    requestedStatus;

  try {
    await auditLogger.appendEvent({
      // workflow_enum does not include an "auth" member; record auth lifecycle
      // events under the audit workflow and preserve auth semantics in event_type/title/details.
      workflow: "audit",
      requestId: buildAuditRequestId("auth"),
      type,
      status: normalizedStatus,
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
    (method === "GET" && routePath === "/api/abdm/callbacks/health") ||
    // Prescription generation routes (TODO: require auth in production)
    (routePath.startsWith("/api/prescriptions")) ||
    (routePath.startsWith("/api/soap"))
  );
}

function isAdminOnlyApiRequest(req) {
  const method = String(req.method || "GET").toUpperCase();
  const routePath = req.path;

  if (
    (method === "GET" && routePath === "/api/abdm/status") ||
    (method === "POST" && routePath === "/api/abdm/session/verify")
  ) {
    return true;
  }

  if ((method === "GET" && routePath === "/api/agent/status") || (method === "POST" && routePath === "/api/agent/test-pdf")) {
    return true;
  }

  if (
    (method === "GET" && routePath === "/api/chat/source-health") ||
    (method === "GET" && routePath === "/api/analytics/overview") ||
    routePath.startsWith("/api/item-service-master") ||
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

registerAbdmRoutes(app);

registerAnalyticsRoutes(app, analyticsStore, readDocuments);

registerItemServiceMasterRoutes(app, {
  upload,
  storageDir,
  readDocuments,
  repoRoot: path.join(__dirname, ".."),
});

// Register Live Conversation routes
liveConversationRoutes.registerRoutes(app, authService);

// Register Voice Daily Notes routes
voiceDailyNotesRoutes.registerRoutes(app, authService);

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

// TEMPORARY: Disable Phase 2A dual-write health router until properly integrated
// Phase 2A: Dual-write health endpoints
// const dualWriteHealthRouter = require('./health_dual_write.cjs');
// app.use('/api/health', dualWriteHealthRouter);

// ============================================
// PHASE 2A PARITY ENDPOINTS
// ============================================
// Add parity endpoints when dual-write is enabled
if (process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true' && authService.authRepository) {
  const authRepo = authService.authRepository; // Use existing initialized repository
  authRepo.initialize().catch(err => {
    console.error('[Parity] Failed to initialize AuthRepository:', err.message);
  });

  app.get('/api/parity/sessions', async (req, res) => {
    try {
      if (!authRepo) {
        return res.status(503).json({ error: 'Dual-write is not enabled', status: 'disabled' });
      }

      // Read ACTUAL filesystem format: { sessions: [...] }
      const fsData = JSON.parse(await fs.readFile(path.join(__dirname, 'storage', 'auth_sessions.json'), 'utf8'));
      const fsSessions = fsData.sessions || [];

      // Read Postgres sessions (note: different field names)
      const pgSessions = await authRepo.readSessions();

      // Compare by sessionId (filesystem) vs session_token (postgres)
      const mismatches = [];
      fsSessions.forEach(fsSession => {
        const pgSession = pgSessions.find(s => s.session_token === fsSession.sessionId);
        if (!pgSession) {
          mismatches.push({
            type: 'missing_in_postgres',
            sessionId: fsSession.sessionId,
            username: fsSession.username
          });
        } else {
          // Compare key fields
          if (pgSession.user_id !== fsSession.userId) {
            mismatches.push({
              type: 'user_id_mismatch',
              sessionId: fsSession.sessionId,
              fs: fsSession.userId,
              pg: pgSession.user_id
            });
          }

          // Compare lastSeenAt (with tolerance for timestamp differences)
          const fsLastSeen = new Date(fsSession.lastSeenAt).getTime();
          const pgLastSeen = new Date(pgSession.last_seen_at).getTime();
          if (Math.abs(fsLastSeen - pgLastSeen) > 1000) { // 1 second tolerance
            mismatches.push({
              type: 'last_seen_at_mismatch',
              sessionId: fsSession.sessionId,
              fs: fsSession.lastSeenAt,
              pg: pgSession.last_seen_at
            });
          }

          // Compare expiresAt (with tolerance for timestamp differences)
          const fsExpires = new Date(fsSession.expiresAt).getTime();
          const pgExpires = new Date(pgSession.expires_at).getTime();
          if (Math.abs(fsExpires - pgExpires) > 1000) { // 1 second tolerance
            mismatches.push({
              type: 'expires_at_mismatch',
              sessionId: fsSession.sessionId,
              fs: fsSession.expiresAt,
              pg: pgSession.expires_at
            });
          }
        }
      });

      // Check for Postgres-only sessions
      pgSessions.forEach(pgSession => {
        const fsSession = fsSessions.find(s => s.sessionId === pgSession.session_token);
        if (!fsSession) {
          mismatches.push({
            type: 'missing_in_filesystem',
            sessionId: pgSession.session_token,
            userId: pgSession.user_id
          });
        }
      });

      res.json({
        mismatches,
        fsCount: fsSessions.length,
        pgCount: pgSessions.length,
        status: mismatches.length === 0 ? 'healthy' : 'diverged'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/parity/documents', async (req, res) => {
    try {
      if (!docsRepository) {
        return res.status(503).json({ error: 'Dual-write is not enabled', status: 'disabled' });
      }

      // Read ACTUAL filesystem format: { documents: [...] }
      const fsData = JSON.parse(await fs.readFile(path.join(__dirname, 'storage', 'documents.json'), 'utf8'));
      const fsDocuments = fsData.documents || [];

      // Read Postgres documents
      const pgDocuments = await docsRepository.readDocuments();

      // Compare by id, but ONLY for document types that have shadow writes implemented
      // Currently only PDF uploads have full shadow-write coverage
      // Voice and live-conversation documents are created file-only and should be excluded from parity check
      const mismatches = [];
      fsDocuments.forEach(fsDoc => {
        // Skip voice and live_conversation documents - they don't have shadow writes yet
        if (fsDoc.documentType === 'voice' || fsDoc.documentType === 'live_conversation') {
          return;
        }

        const pgDoc = pgDocuments.find(d => d.id === fsDoc.id);
        if (!pgDoc) {
          mismatches.push({
            type: 'missing_in_postgres',
            id: fsDoc.id,
            name: fsDoc.name,
            documentType: fsDoc.documentType
          });
        } else {
          // Compare key fields (filesystem uses camelCase, Postgres uses snake_case)
          if (pgDoc.name !== fsDoc.name) {
            mismatches.push({
              type: 'name_mismatch',
              id: fsDoc.id,
              fs: fsDoc.name,
              pg: pgDoc.name
            });
          }
          // Normalize filesystem status to Postgres status for comparison
          let normalizedFsStatus = fsDoc.status;
          if (fsDoc.status === 'queued') normalizedFsStatus = 'pending';
          else if (fsDoc.status === 'processed' || fsDoc.status === 'partial') normalizedFsStatus = 'completed';

          if (pgDoc.status !== normalizedFsStatus) {
            mismatches.push({
              type: 'status_mismatch',
              id: fsDoc.id,
              fs: fsDoc.status,
              pg: pgDoc.status,
              normalized_fs: normalizedFsStatus
            });
          }
        }
      });

      // Check for Postgres-only documents
      // Only compare document types that have shadow-write coverage (PDF uploads only for now)
      pgDocuments.forEach(pgDoc => {
        // Skip voice and live_conversation documents - they don't have shadow writes yet
        if (pgDoc.source_kind === 'voice_upload' || pgDoc.source_kind === 'live_conversation') {
          return;
        }

        const fsDoc = fsDocuments.find(d => d.id === pgDoc.id);
        if (!fsDoc) {
          mismatches.push({
            type: 'missing_in_filesystem',
            id: pgDoc.id,
            name: pgDoc.name,
            source_kind: pgDoc.source_kind
          });
        }
      });

      res.json({
        mismatches,
        fsCount: fsDocuments.length,
        pgCount: pgDocuments.length,
        status: mismatches.length === 0 ? 'healthy' : 'diverged'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/parity/users', async (req, res) => {
    try {
      if (!authRepo) {
        return res.status(503).json({ error: 'Dual-write is not enabled', status: 'disabled' });
      }

      // Read ACTUAL filesystem format: { users: [...] }
      const fsData = JSON.parse(await fs.readFile(path.join(__dirname, 'storage', 'users.json'), 'utf8'));
      const fsUsers = fsData.users || [];

      // Read Postgres users
      const pgUsers = await authRepo.readUsers();

      // Compare by username
      const mismatches = [];
      fsUsers.forEach(fsUser => {
        const pgUser = pgUsers.find(u => u.username === fsUser.username);
        if (!pgUser) {
          mismatches.push({
            type: 'missing_in_postgres',
            username: fsUser.username,
            id: fsUser.id
          });
        }
      });

      // Check for Postgres-only users (bidirectional check)
      pgUsers.forEach(pgUser => {
        const fsUser = fsUsers.find(u => u.username === pgUser.username);
        if (!fsUser) {
          mismatches.push({
            type: 'missing_in_filesystem',
            username: pgUser.username,
            id: pgUser.id
          });
        }
      });

      res.json({
        mismatches,
        fsCount: fsUsers.length,
        pgCount: pgUsers.length,
        status: mismatches.length === 0 ? 'healthy' : 'diverged'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

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
    } else {
      reviewItem.editedValue = "";
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

  try {
    await appendVoiceReviewResolution(
      reviewItemId,
      resolution,
      resolution === "edited" ? editedValue : "",
      req.user?.id || null,
      req.user?.username ? `Resolved by ${req.user.username} (${req.user.role || "unknown"})` : null,
    );
  } catch (error) {
    console.error("[Voice] Failed to append review resolution:", error.message);
  }

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

  // Shadow update to Postgres AFTER filesystem commit (for successful processing)
  if (process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true' && docsRepository) {
    for (const id of processed) {
      try {
        await docsRepository.updateDocument(id, {
          status: 'completed',
          processed_at: new Date().toISOString(),
          error_code: null,
          error_message: null
        });
      } catch (pgError) {
        console.error('[DualWrite] Failed to shadow update document in Postgres:', pgError.message);
      }
    }
  }

  console.log(`📊 Voice extraction complete: ${processed.length} succeeded, ${failed.length} failed\n`);
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

// ============================================================================
// SOAP NOTE GENERATION API
// ============================================================================

/**
 * GET /api/soap/data/:documentId
 * Get SOAP note data for preview/review
 */
app.get("/api/soap/data/:documentId", async (req, res) => {
  try {
    const { documentId } = req.params;
    const data = await soapService.getSOAPData(documentId);
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error getting SOAP data:", error.message);
    res.status(404).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/soap/generate
 * Generate SOAP HTML/PDF from processed document
 * Body: { documentId, format: "html" | "pdf" | "both" }
 */
app.post("/api/soap/generate", async (req, res) => {
  try {
    const { documentId, format = "pdf" } = req.body;

    if (!documentId) {
      return res.status(400).json({ success: false, error: "documentId is required" });
    }

    await soapService.initialize();
    const result = await soapService.generateSOAP(documentId, { format });
    res.json(result);
  } catch (error) {
    console.error("Error generating SOAP note:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/soap/download/:filename
 * Download generated SOAP note file
 */
app.get("/api/soap/download/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, "storage", "soap_exports", filename);

    if (filename.includes("..") || filename.includes("/")) {
      return res.status(400).json({ success: false, error: "Invalid filename" });
    }

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ success: false, error: "File not found" });
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === ".pdf" ? "application/pdf" : "text/html";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error("Error downloading SOAP note:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve prescription files as static assets (no auth required for generated prescriptions)
app.use('/prescriptions', express.static(path.join(__dirname, "storage", "prescriptions")));
app.use('/soap-exports', express.static(path.join(__dirname, "storage", "soap_exports")));

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

      await docsRepository.createDocument({
        id: document.id,
        document_type: "unknown",
        document_subtype: "unknown",
        source_kind: "pdf_upload",
        status: "pending",
        department: document.department,
        name: document.name,
        original_filename: document.name,
        mime_type: file.mimetype || "application/pdf",
        size_bytes: document.size,
        sha256_hash: document.hash,
        uploaded_at: document.uploadedAt,
      });

      await docsRepository.createDocumentAsset({
        id: `${document.id}:source_pdf`,
        document_id: document.id,
        asset_role: "source_pdf",
        storage_backend: "filesystem",
        path_or_uri: filePath,
        mime_type: file.mimetype || "application/pdf",
        size_bytes: document.size,
        sha256_hash: document.hash,
        metadata: {
          originalFilename: file.originalname,
        },
      });

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

  // NEW: Shadow write status changes to "processing" if enabled
  if (process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true' && docsRepository) {
    for (const doc of queuedDocuments) {
      try {
        await docsRepository.updateDocument(doc.id, {
          status: 'processing',
          error_code: null,
          error_message: null
        });
      } catch (pgError) {
        console.error(`[DualWrite] Failed to shadow update document ${doc.id} to processing:`, pgError.message);
      }
    }
  }

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
        currentDocument.processedAt = new Date().toISOString();
        // Clear error on successful processing (maintain existing filesystem behavior)
        currentDocument.error = null;
      });

      // NEW: Shadow update to Postgres if enabled
      if (process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true' && updatedDocument && docsRepository) {
        try {
          // Map filesystem status to Postgres enum: processed/partial -> completed
          const pgStatus = (updatedDocument.status === 'processed' || updatedDocument.status === 'partial') ? 'completed' : updatedDocument.status;
          await docsRepository.updateDocument(document.id, {
            status: pgStatus,
            processed_at: updatedDocument.processedAt,
            error_code: null,
            error_message: null
          });
        } catch (pgError) {
          console.error('[DualWrite] Failed to shadow update document in Postgres:', pgError.message);
        }
      }

      await analyticsStore.upsertDocumentMetrics(updatedDocument);

      const auditRun = await audit.complete({
        documentId: document.id,
        agentName: agentResult.agent,
        latency: agentResult.latency,
        tokensUsed: agentResult.tokensUsed,
        stepsCount: agentResult.steps?.length || 0,
      });

      // Record audit run ID in document for traceability
      if (auditRun?.id) {
        await updateDocument(document.id, async (currentDocument) => {
          currentDocument.auditRunId = auditRun.id;
        });
      }
    } catch (error) {
      await audit.fail(error, {
        documentId: document.id,
      });
      const failedDocument = await updateDocument(document.id, async (currentDocument) => {
        currentDocument.status = "failed";
        currentDocument.error = error instanceof Error ? error.message : "Unknown processing error";
        if (document.documentType === "voice") {
          currentDocument.result = null;
        }
      });

      // NEW: Shadow update to Postgres if enabled
      if (process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true' && failedDocument) {
        try {
          await docsRepository.updateDocument(document.id, {
            status: 'failed',
            error_code: 'PROCESSING_ERROR',
            error_message: failedDocument.error || 'Unknown processing error'
          });
        } catch (pgError) {
          console.error('[DualWrite] Failed to shadow update document in Postgres:', pgError.message);
        }
      }
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
  const sessions = await readChatSessions();
  const session = sessions.find((item) => item.documentId === req.params.documentId) || null;
  res.json({ session });
});

// Phase 4: Alerts Read Endpoint (Postgres-ready)
app.get("/api/alerts", async (req, res) => {
  const alerts = await readAlerts();
  res.json({ alerts });
});

app.get("/api/alerts/:documentId", async (req, res) => {
  const alerts = await readAlerts();
  const documentAlerts = alerts.filter((item) => item.documentId === req.params.documentId);
  res.json({ alerts: documentAlerts });
});

app.delete("/api/chat/history/:documentId", async (req, res) => {
  const documentId = req.params.documentId;
  const chatId = typeof req.query.chatId === "string" ? req.query.chatId : "";

  const sessions = await readChatSessions();
  const sessionIndex = sessions.findIndex((item) => item.documentId === documentId && (!chatId || item.chatId === chatId));

  if (sessionIndex === -1) {
    return res.status(404).json({ error: "Chat session not found" });
  }

  const [removedSession] = sessions.splice(sessionIndex, 1);
  await writeChatSessions(sessions);

  // Phase 4: Delete from Postgres when enabled (cascades to actions and exports)
  if (process.env.ENABLE_PG_READ_CHAT === 'true' && chatRepository) {
    try {
      await chatRepository.deleteChatSession(removedSession.chatId);
    } catch (pgError) {
      console.error('[Chat] Failed to delete session from Postgres:', pgError.message);
    }
  }

  const actions = await readChatActions();
  const filteredActions = actions.filter((item) => item.documentId !== documentId || item.chatId !== removedSession.chatId);
  if (filteredActions.length !== actions.length) {
    await writeChatActions(filteredActions);
  }

  const exportsList = await readChatExports();
  const filteredExports = exportsList.filter((item) => item.documentId !== documentId || item.chatId !== removedSession.chatId);
  if (filteredExports.length !== exportsList.length) {
    await writeChatExports(filteredExports);
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

  const sessions = await readChatSessions();
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
  await writeChatSessions(sessions);

  const actions = await readChatActions();
  actions.unshift(confirmedAction);
  await writeChatActions(actions);

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

  const sessions = await readChatSessions();
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

    const exportsList = await readChatExports();
    exportsList.unshift(exportRecord);
    await writeChatExports(exportsList);

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
    // Phase 6: Startup repair removed - Postgres is authoritative source
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
