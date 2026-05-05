const cors = require("cors");
const crypto = require("crypto");
const express = require("express");
const fs = require("fs/promises");
const multer = require("multer");
const path = require("path");

// Import Agent System
const AuditLogger = require("./audit_logger.cjs");
const DocumentTypeRouter = require("../../agents/document_type_router.cjs");
const DashboardMapperSkill = require("../skills/clinical/dashboard_mapper.skill.cjs");
const DoctorAssistantAgent = require("../../agents/doctor_assistant_agent.cjs");
const ChatExportBuilderSkill = require("../skills/chat/chat_export_builder.skill.cjs");
const SourceHealthTool = require("../tools/chat/source_health.tool.cjs");

const app = express();
const PORT = Number(process.env.PORT || 8001);
const GEMMA_URL = process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
const MODEL = process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it";
const USE_GEMINI_FOR_EXTERNAL = process.env.USE_GEMINI_FOR_EXTERNAL !== "false";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const EXTRACTION_PER_DOCUMENT_CONCURRENCY = parsePositiveInt(process.env.EXTRACTION_PER_DOCUMENT_CONCURRENCY, 3);
const GEMMA_MAX_INFLIGHT = parsePositiveInt(process.env.GEMMA_MAX_INFLIGHT, 4);
const CHART_NOTE_PARALLEL_CONCURRENCY = parsePositiveInt(process.env.CHART_NOTE_PARALLEL_CONCURRENCY, 4);
const ENABLE_PENDING_ITEMS_EXTRACTION = process.env.ENABLE_PENDING_ITEMS_EXTRACTION !== "false";
const ENABLE_DOCUMENT_ANALYZER = process.env.ENABLE_DOCUMENT_ANALYZER === "true";

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 50,
  },
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Serve static test page
app.get('/test-agent', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-agent.html'));
});

function publicDocument(document) {
  const { filePath, ...rest } = document;
  return rest;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  await ensureCollectionFile(documentsPath, { documents: [] });
  await ensureCollectionFile(chatSessionsPath, { sessions: [] });
  await ensureCollectionFile(chatActionsPath, { actions: [] });
  await ensureCollectionFile(chatExportsPath, { exports: [] });
  await ensureCollectionFile(searchCachePath, { entries: [] });
  await auditLogger.ensureStorage();
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
  await ensureStorage();
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed[key]) ? parsed[key] : [];
}

async function writeCollection(filePath, key, items) {
  await ensureStorage();
  await fs.writeFile(filePath, JSON.stringify({ [key]: items }, null, 2), "utf8");
}

let documentMutationQueue = Promise.resolve();

function queueDocumentMutation(task) {
  const run = documentMutationQueue.then(task, task);
  documentMutationQueue = run.catch(() => {});
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
  if (!agentResult) return null;

  return {
    name: agentResult.agent,
    version: agentResult.data?.meta?.agent_version,
    latency: agentResult.latency,
    tokensUsed: agentResult.tokensUsed,
    steps: agentResult.steps,
    validation: agentResult.validation,
  };
}

function isCatastrophicProcessingFailure(agentResult) {
  if (!agentResult) return true;
  if (agentResult.success === false) return true;

  const steps = Array.isArray(agentResult.steps) ? agentResult.steps : [];
  if (steps.length === 0) return false;

  const failedSteps = steps.filter((step) => step && step.success === false);
  return (agentResult.tokensUsed || 0) === 0 && failedSteps.length === steps.length;
}

function getProcessingFailureMessage(agentResult, fallbackMessage = "Unknown processing error") {
  if (!agentResult) return fallbackMessage;
  if (agentResult.error_type === "model_unreachable") {
    return agentResult.error;
  }
  if (isCatastrophicProcessingFailure(agentResult)) {
    return (
      "Model service unavailable. The extraction model could not be reached during processing. " +
      "Check GEMMA_URL or model server health, then retry."
    );
  }
  return agentResult.error || fallbackMessage;
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

// NOTE: Agent System now handles PDF processing and data extraction
// The legacy functions have been replaced by:
// - DischargeExtractorAgent (multi-step extraction with validation)
// - DashboardMapperSkill (transforms data to dashboard card format)

// Initialize Agent
const documentRouter = new DocumentTypeRouter({
  gemma: {
    baseUrl: GEMMA_URL,
    model: MODEL,
    timeout: 180000,
    maxInflight: GEMMA_MAX_INFLIGHT,
  },
  extractionPerDocumentConcurrency: EXTRACTION_PER_DOCUMENT_CONCURRENCY,
  enablePendingItemsExtraction: ENABLE_PENDING_ITEMS_EXTRACTION,
  enableDocumentAnalyzer: ENABLE_DOCUMENT_ANALYZER,
});

// Initialize Dashboard Mapper
const dashboardMapper = new DashboardMapperSkill();
const chatExportBuilder = new ChatExportBuilderSkill();
const sourceHealthTool = new SourceHealthTool();
const auditLogger = new AuditLogger({
  storageDir,
  runsPath: auditRunsPath,
  eventsPath: auditEventsPath,
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

const EXTRACTION_DEVIATION_THRESHOLD = 0.5;

// Document type specific core section requirements
// Each document type has different expected sections based on typical content
const DOCUMENT_TYPE_REQUIREMENTS = {
  // Default/unknown - assume discharge summary (most comprehensive)
  default: {
    type: "discharge_summary",
    core_sections: ["patient", "vitals", "diagnosis", "medications", "risk", "treatment", "clinical_notes"],
    optional_sections: ["labs", "radiology", "discharge", "follow_up", "pending_items"]
  },
  // Discharge summary - all core sections expected
  discharge_summary: {
    type: "discharge_summary",
    core_sections: ["patient", "vitals", "diagnosis", "medications", "risk", "treatment", "clinical_notes"],
    optional_sections: ["labs", "radiology", "discharge", "follow_up", "pending_items"],
    description: "Inpatient discharge summary"
  },
  // Outpatient record - no risk assessment typically, minimal treatment
  outpatient_record: {
    type: "outpatient_record",
    core_sections: ["patient", "vitals", "diagnosis", "medications", "clinical_notes"],
    optional_sections: ["labs", "radiology", "follow_up", "pending_items"],
    skipped_sections: ["risk", "treatment"],
    description: "Outpatient/OPD visit record"
  },
  // Lab report - focused on lab results only
  lab_report: {
    type: "lab_report",
    core_sections: ["labs"],
    optional_sections: ["vitals", "patient", "radiology"],
    skipped_sections: ["diagnosis", "medications", "risk", "treatment", "clinical_notes", "follow_up", "pending_items", "discharge"],
    description: "Laboratory investigation report"
  },
  // Chart note - focused on clinical narrative
  chart_note: {
    type: "chart_note",
    core_sections: ["clinical_notes", "diagnosis"],
    optional_sections: ["patient", "medications", "pending_items", "treatment"],
    skipped_sections: ["vitals", "risk", "labs", "radiology", "follow_up", "discharge"],
    description: "Clinical chart/progress/nursing note"
  },
  // Nursing assessment - similar to discharge but less treatment
  nursing_assessment: {
    type: "nursing_assessment",
    core_sections: ["patient", "vitals", "risk", "clinical_notes"],
    optional_sections: ["diagnosis", "medications", "labs"],
    skipped_sections: ["treatment", "radiology", "discharge", "follow_up"],
    description: "Nursing assessment record"
  }
};

// Detect document type from agent metadata or content
function detectDocumentType(extractedData = {}) {
  // Check if agent already specified document type
  const meta = extractedData.meta || {};
  const agentDocumentType = meta.document_type || meta.agentType;

  if (agentDocumentType) {
    const normalized = agentDocumentType.toLowerCase().replace(/[_\s]/g, '_');
    if (normalized.includes('outpatient') || normalized.includes('opd')) {
      return 'outpatient_record';
    }
    if (normalized.includes('lab')) {
      return 'lab_report';
    }
    if (normalized.includes('chart') || normalized.includes('note')) {
      return 'chart_note';
    }
    if (normalized.includes('nursing')) {
      return 'nursing_assessment';
    }
    if (normalized.includes('discharge')) {
      return 'discharge_summary';
    }
  }

  // Heuristic detection from content
  const hasLabResults = extractedData.lab_results?.length > 0 ||
                       (extractedData.investigations?.length > 0 && extractedData.investigations.length > 3);
  const hasClinicalNotes = extractedData.clinical_notes?.length > 0;
  const hasRiskScores = extractedData.risk_scores &&
                        (extractedData.risk_scores.ews_score ||
                         extractedData.risk_scores.fall_risk?.score);
  const hasDiagnosis = extractedData.diagnosis?.principal;
  const hasMedications = extractedData.medications?.length > 0;
  const hasTreatment = extractedData.treatment?.current_approach ||
                       extractedData.treatment?.procedures?.length > 0;

  // Lab report detection
  if (hasLabResults && !hasDiagnosis && !hasMedications && !hasTreatment) {
    return 'lab_report';
  }

  // Chart note detection
  if (hasClinicalNotes && !hasRiskScores && !hasMedications) {
    return 'chart_note';
  }

  // Nursing assessment detection
  if (hasRiskScores && !hasTreatment && hasClinicalNotes) {
    return 'nursing_assessment';
  }

  // Outpatient detection
  if (!hasRiskScores && hasDiagnosis && hasMedications) {
    return 'outpatient_record';
  }

  // Default to discharge summary
  return 'discharge_summary';
}

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

  return {
    runId,
    requestId,
    event(type, status, title, details = {}) {
      return track(() =>
        auditLogger.logEvent(runId, {
          ...base,
          type,
          status,
          title,
          details: sanitizeAuditSummary(details),
        })
      );
    },
    complete(summary = {}) {
      return track(() => auditLogger.completeRun(runId, sanitizeAuditSummary(summary)));
    },
    fail(error, summary = {}) {
      return track(() => auditLogger.failRun(runId, error, sanitizeAuditSummary(summary)));
    },
    async flush() {
      await Promise.allSettled(Array.from(pending));
    },
  };
}

function extractStepSummary(progress = {}) {
  return {
    type: progress.type || "step",
    step: progress.step || null,
    stepNumber: progress.stepNumber || null,
    totalSteps: progress.totalSteps || null,
    status: progress.status || null,
    error: progress.error || null,
    confidence: progress.confidence || null,
    latency: progress.latency || null,
    tokensUsed: progress.tokensUsed || null,
    data: sanitizeAuditSummary(progress.data || {}),
  };
}

function summarizeExtractionAudit(agentResult, dashboardResult = null) {
  const escalation = dashboardResult?.meta?.extraction_escalation || null;

  return {
    success: !!agentResult?.success,
    latencyMs: agentResult?.latency || 0,
    tokensUsed: agentResult?.tokensUsed || 0,
    confidence: agentResult?.validation?.confidence_level || null,
    stepsCompleted: Array.isArray(agentResult?.steps) ? agentResult.steps.length : 0,
    weakItems: escalation?.weak_items || [],
    escalationRequired: escalation?.required || false,
    deviationPct: escalation?.deviation_pct || 0,
  };
}

function summarizeChartNoteAudit(chartNote, validationResult, extra = {}) {
  const summary = validationResult?.data?.citations?.summary || {};
  const flags = validationResult?.data?.validation?.flags || [];

  return {
    generatedAt: chartNote?.generatedAt || null,
    tokensUsed: chartNote?.tokensUsed || 0,
    generationTime: chartNote?.generationTime || 0,
    reasoningSteps: Array.isArray(chartNote?.reasoningSteps) ? chartNote.reasoningSteps.length : 0,
    citationsReviewed: summary.fieldsReviewed || 0,
    citationsTotal: summary.totalFields || 0,
    overallConfidence: summary.overallConfidence || 0,
    validationFlags: Array.isArray(flags) ? flags.length : 0,
    ...sanitizeAuditSummary(extra),
  };
}

function summarizeChatAudit(responseData = {}) {
  return {
    provider: responseData.llm_provider || "unknown",
    sourceClass: responseData.source_class || "unknown",
    confidence: responseData.confidence_label || null,
    citations: Array.isArray(responseData.citations) ? responseData.citations.length : 0,
    proposedActions: Array.isArray(responseData.proposed_actions) ? responseData.proposed_actions.length : 0,
    refused: !!responseData.refused,
    finalState: responseData.trace?.final_state || null,
  };
}

function hasNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasEntries(list) {
  return Array.isArray(list) && list.length > 0;
}

function hasProvenanceItem(item) {
  return !!item && typeof item === "object" && hasNonEmptyString(item.value || "") && hasNonEmptyString(item.source_excerpt || "");
}

function hasProvenanceList(items) {
  return Array.isArray(items) && items.some((item) => hasProvenanceItem(item));
}

function hasRadiologySignal(investigations = [], provenance = {}) {
  const investigationHit = Array.isArray(investigations) && investigations.some((item) =>
    /\b(?:xray|x-ray|ct|mri|usg|ultrasound|echo|echocardiogram|scan|doppler)\b/i.test(String(item || ""))
  );
  const provenanceHit =
    hasProvenanceList(provenance.findings) ||
    hasProvenanceList(provenance.pending);

  return investigationHit || provenanceHit;
}

async function hydrateDocumentHashes(documents = []) {
  let changed = false;

  for (const document of documents) {
    if (document?.hash || !document?.filePath) continue;

    try {
      const buffer = await fs.readFile(document.filePath);
      document.hash = computeHash(buffer);
      changed = true;
    } catch (_error) {
      // Leave hash empty if the file is unavailable.
    }
  }

  return changed;
}

function buildExtractionEscalation(extractedData = {}, dashboardCards = {}) {
  // Detect document type to determine expected sections
  const documentType = detectDocumentType(extractedData);
  const requirements = DOCUMENT_TYPE_REQUIREMENTS[documentType] || DOCUMENT_TYPE_REQUIREMENTS.default;

  const patient = extractedData.patient || {};
  const vitals = extractedData.vitals || {};
  const diagnosis = extractedData.diagnosis || {};
  const riskScores = extractedData.risk_scores || {};
  const treatment = extractedData.treatment || {};
  const pendingItems = extractedData.pending_items || {};
  const provenance = extractedData.provenance || {};

  const clinicalNotes = Array.isArray(extractedData.clinical_notes)
    ? extractedData.clinical_notes
    : (Array.isArray(extractedData.nursing_needs)
        ? extractedData.nursing_needs.map((need, i) => ({
            type: "Nursing Care Plan",
            summary: typeof need === "string" ? need : need.toString(),
            date: new Date().toISOString().split('T')[0]
          }))
        : []);

  // Define all possible section checks
  const allSectionChecks = {
    patient: {
      key: "patient",
      label: "Patient Summary",
      reliable:
        hasNonEmptyString(patient.name) ||
        hasNonEmptyString(patient.mrn) ||
        hasPositiveNumber(patient.age) ||
        hasNonEmptyString(patient.gender),
    },
    vitals: {
      key: "vitals",
      label: "Vitals",
      reliable:
        hasNonEmptyString(dashboardCards.vitals_card?.summary?.latest_bp) ||
        hasPositiveNumber(dashboardCards.vitals_card?.summary?.pulse) ||
        hasPositiveNumber(dashboardCards.vitals_card?.summary?.spo2) ||
        hasPositiveNumber(dashboardCards.vitals_card?.summary?.temp) ||
        hasPositiveNumber(vitals.bp?.systolic) ||
        hasPositiveNumber(vitals.pulse?.value) ||
        hasPositiveNumber(vitals.spo2?.value) ||
        hasPositiveNumber(vitals.temperature?.value),
    },
    diagnosis: {
      key: "diagnosis",
      label: "Diagnosis",
      reliable:
        hasNonEmptyString(diagnosis.principal) ||
        hasNonEmptyString(diagnosis.icd_code) ||
        hasEntries(diagnosis.secondary) ||
        hasProvenanceItem(provenance.diagnosis?.principal) ||
        hasProvenanceList(provenance.diagnosis?.secondary),
    },
    medications: {
      key: "medications",
      label: "Medications",
      reliable:
        hasEntries(extractedData.medications) ||
        hasEntries(extractedData.allergies) ||
        hasProvenanceList(provenance.medications) ||
        hasEntries(dashboardCards.medications_card?.medication_list),
    },
    risk: {
      key: "risk",
      label: "Risk Assessment",
      reliable:
        hasPositiveNumber(riskScores.ews_score) ||
        hasPositiveNumber(riskScores.fall_risk?.score) ||
        hasPositiveNumber(riskScores.dvt_risk?.score) ||
        hasPositiveNumber(riskScores.pressure_ulcer_risk?.score) ||
        hasPositiveNumber(riskScores.aspiration_risk?.score) ||
        hasPositiveNumber(riskScores.gcs?.total) ||
        hasNonEmptyString(riskScores.fall_risk?.level) ||
        hasNonEmptyString(riskScores.dvt_risk?.level) ||
        hasNonEmptyString(riskScores.pressure_ulcer_risk?.level) ||
        hasNonEmptyString(riskScores.aspiration_risk?.level),
    },
    treatment: {
      key: "treatment",
      label: "Treatment",
      reliable:
        hasNonEmptyString(treatment.current_approach) ||
        hasEntries(treatment.management_items) ||
        hasEntries(treatment.procedures) ||
        hasEntries(treatment.complications) ||
        hasEntries(extractedData.nursing_needs) ||
        hasNonEmptyString(dashboardCards.treatment_card?.current_approach) ||
        hasPositiveNumber(dashboardCards.treatment_card?.procedures_performed),
    },
    clinical_notes: {
      key: "clinical_notes",
      label: "Clinical Notes",
      reliable: clinicalNotes.some((note) =>
        hasNonEmptyString(note.summary) ||
        hasNonEmptyString(note.assessment) ||
        hasNonEmptyString(note.recommendations)
      ),
    },
    labs: {
      key: "labs",
      label: "Laboratory Results",
      reliable:
        hasEntries(extractedData.lab_results) ||
        hasEntries(extractedData.investigations) ||
        hasProvenanceList(provenance.labs?.results) ||
        hasProvenanceList(provenance.labs?.investigations),
    },
    radiology: {
      key: "radiology",
      label: "Radiology & Imaging",
      reliable: hasRadiologySignal(extractedData.investigations, provenance.radiology || {}),
    },
    discharge: {
      key: "discharge",
      label: "Discharge Planning",
      reliable:
        hasProvenanceList(provenance.discharge?.dietary) ||
        hasProvenanceList(provenance.discharge?.instructions) ||
        hasProvenanceList(provenance.discharge?.red_flags) ||
        hasEntries(pendingItems.pending_discharge_items) ||
        clinicalNotes.some((note) => /discharge/i.test(String(note.type || ""))),
    },
    follow_up: {
      key: "follow_up",
      label: "Follow-Up",
      reliable:
        hasEntries(extractedData.follow_up?.appointments) ||
        hasEntries(pendingItems.pending_followups) ||
        hasProvenanceList(provenance.follow_up?.items),
    },
    pending_items: {
      key: "pending_items",
      label: "Pending Items",
      reliable:
        hasEntries(pendingItems.pending_labs) ||
        hasEntries(pendingItems.pending_radiology) ||
        hasEntries(pendingItems.pending_followups) ||
        hasEntries(pendingItems.pending_discharge_items),
    },
  };

  // Filter sections based on document type requirements
  const coreSections = requirements.core_sections
    .map(key => allSectionChecks[key])
    .filter(Boolean);

  const optionalSections = requirements.optional_sections
    .map(key => allSectionChecks[key])
    .filter(Boolean);

  // Calculate deviation only on REQUIRED core sections for this document type
  const coreReliableCount = coreSections.filter((item) => item.reliable).length;
  const coreTotalCount = coreSections.length;
  const deviationRatio = coreTotalCount === 0 ? 0 : (coreTotalCount - coreReliableCount) / coreTotalCount;
  const weakCoreSections = coreSections.filter((item) => !item.reliable).map((item) => item.label);
  const supportedOptionalSections = optionalSections.filter((item) => item.reliable).map((item) => item.label);
  const escalationRequired = deviationRatio >= EXTRACTION_DEVIATION_THRESHOLD;

  // Build helpful summary message
  const getSummary = () => {
    if (!escalationRequired) {
      return `Core dashboard extraction coverage is above threshold (${coreReliableCount}/${coreTotalCount} sections reliable) for ${requirements.description}.`;
    }
    const skippedList = requirements.skipped_sections?.length
      ? ` (Skipped sections not expected: ${requirements.skipped_sections.join(', ')})`
      : '';
    return `Review required for ${requirements.description}${skippedList}. ${coreReliableCount}/${coreTotalCount} expected sections reliable. Weak/missing: ${weakCoreSections.join(', ') || 'none'}.`;
  };

  return {
    required: escalationRequired,
    threshold_pct: Math.round(EXTRACTION_DEVIATION_THRESHOLD * 100),
    deviation_pct: Math.round(deviationRatio * 100),
    reliable_items: coreReliableCount,
    total_items: coreTotalCount,
    weak_items: weakCoreSections,
    supported_optional_items: supportedOptionalSections,
    document_type: documentType,
    document_description: requirements.description,
    skipped_sections: requirements.skipped_sections || [],
    plan_b: escalationRequired
      ? {
          mode: "safe_minimal_dashboard",
          action: "manual_review_required",
          summary: getSummary(),
        }
      : {
          mode: "standard_dashboard",
          action: "continue",
          summary: getSummary(),
        },
  };
}

// Helper function to transform agent result to dashboard format
async function transformAgentResultToDashboard(agentResult) {
  // Use the dashboard mapper skill to transform the data
  const mapperResult = await dashboardMapper.execute({ agentResult });

  const meta = {
    ...(agentResult.data?.meta || {}),
  };

  if (!mapperResult.success) {
    const fallbackCards = buildFallbackDashboardCards(agentResult.data);
    meta.extraction_escalation = buildExtractionEscalation(agentResult.data || {}, fallbackCards);

    // Fallback to basic transformation if mapper fails
    return {
      meta,
      dashboard_cards: fallbackCards,
      sample_patient_data: buildFallbackPatientData(agentResult.data),
      presentation: {
        summary_cards: {},
        notes_rail: [],
      },
      extracted_data: agentResult.data || {}
    };
  }

  meta.extraction_escalation = buildExtractionEscalation(
    agentResult.data || {},
    mapperResult.data.dashboard_cards || {}
  );

  return {
    meta,
    dashboard_cards: mapperResult.data.dashboard_cards,
    sample_patient_data: mapperResult.data.sample_patient_data,
    presentation: mapperResult.data.presentation || {
      summary_cards: {},
      notes_rail: [],
    },
    extracted_data: agentResult.data || {}
  };
}

async function generateChartNoteForDocument(document, { regenerated = false } = {}) {
  const auditRun = await startAuditRunSafe({
    workflow: "chart_note",
    documentId: document.id,
    requestId: buildAuditRequestId("chart_note"),
    title: document.name,
    actor: "system",
    metadata: {
      regenerated,
      hasCachedChartNote: !!document.chartNote,
    },
  });
  const audit = createAuditRunContext(auditRun, {
    workflow: "chart_note",
    documentId: document.id,
    requestId: auditRun?.requestId || null,
  });

  try {
    const ChartNoteAgent = require("../../agents/chart_note_agent.cjs");
    const CrossValidationAgentSkill = require("../skills/validation/cross_validation_agent.skill.cjs");
    const PdfReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");
    const CitationTrackerTool = require("../tools/llm/citation_tracker.tool.cjs");

    const chartNoteAgent = new ChartNoteAgent({
      gemma: {
        baseUrl: GEMMA_URL,
        model: MODEL,
        timeout: 90000,
        maxInflight: GEMMA_MAX_INFLIGHT,
      },
      parallelSectionConcurrency: CHART_NOTE_PARALLEL_CONCURRENCY,
    });
    const pdfReader = new PdfReaderTool();
    const crossValidator = new CrossValidationAgentSkill({ confidenceThreshold: 0.9 });

    const extractedData = document.result?.extracted_data || {};
    const pdfFilePath = document.filePath;

    await audit.event("chart_note_started", "info", "Chart note generation started", {
      regenerated,
      hasPdfPath: !!pdfFilePath,
      extractedDataKeys: Object.keys(extractedData || {}),
    });

    let pdfText = "";
    let validationEnabled = false;

    if (pdfFilePath) {
      try {
        const pdfReaderResult = await pdfReader.execute(pdfFilePath);
        if (pdfReaderResult.success && pdfReaderResult.text && pdfReaderResult.text.length > 0) {
          const maxPdfLength = 12000;
          pdfText = pdfReaderResult.text.length > maxPdfLength
            ? `${pdfReaderResult.text.substring(0, maxPdfLength)}\n\n... [PDF truncated for token limit]`
            : pdfReaderResult.text;
          validationEnabled = true;
          await audit.event("pdf_read", "success", "PDF text extracted for chart note validation", {
            originalChars: pdfReaderResult.text.length,
            truncatedChars: pdfText.length,
            pages: pdfReaderResult.pages || null,
          });
        } else {
          await audit.event("pdf_read", "warning", "PDF text extraction returned no usable text", {
            error: pdfReaderResult.error || null,
          });
        }
      } catch (pdfError) {
        await audit.event("pdf_read", "warning", "PDF text extraction failed", {
          error: pdfError instanceof Error ? pdfError.message : String(pdfError),
        });
      }
    }

    let validationResult = null;
    let citationSummary = null;

    if (validationEnabled && pdfText) {
      await audit.event("cross_validation_started", "info", "Cross-validation started", {
        pdfChars: pdfText.length,
      });
      validationResult = await crossValidator.execute({
        extractedData,
        pdfText,
        gemmaClient: chartNoteAgent.gemmaClient,
        promptBuilder: chartNoteAgent.promptBuilder,
      });
      citationSummary = validationResult.data.citations.summary;
      await audit.event("cross_validation_completed", "success", "Cross-validation completed", {
        fieldsReviewed: citationSummary.fieldsReviewed || 0,
        totalFields: citationSummary.totalFields || 0,
        overallConfidence: citationSummary.overallConfidence || 0,
        flags: validationResult.data.validation?.flags?.length || 0,
      });
    } else {
      const citationTracker = new CitationTrackerTool();
      validationResult = {
        data: {
          validatedData: extractedData,
          citations: citationTracker.exportForChartNote(),
          validation: citationTracker.generateSummary(),
          fieldsNeedingReview: [],
        },
      };
      citationSummary = validationResult.data.citations.summary;
      await audit.event("cross_validation_skipped", "warning", "Cross-validation skipped because PDF text was unavailable", {});
    }

    const needsReview = validationResult.data.fieldsNeedingReview.length > 0;
    const validationSummaryText = `Confidence: ${(citationSummary.overallConfidence * 100).toFixed(0)}% | Fields reviewed: ${citationSummary.fieldsReviewed}/${citationSummary.totalFields} | Flags: ${validationResult.data.validation.flags.length}`;

    const chartNoteResult = await chartNoteAgent.execute(
      {
        extractedData,
        pdfText,
        citationData: validationResult.data.citations,
        validationSummary: validationSummaryText,
      },
      (progress) => {
        console.log(`   Progress: ${progress.step} - ${progress.status}`);
        void audit.event("chart_note_progress", progress.status === "error" ? "error" : "info", progress.step || "chart_note_progress", {
          step: progress.step,
          status: progress.status,
          hasData: !!progress.data,
        });
      }
    );

    if (!chartNoteResult.success) {
      throw new Error(chartNoteResult.error || "Chart note generation failed");
    }

    const chartNote = {
      content: chartNoteResult.data.chart_note,
      generatedAt: new Date().toISOString(),
      tokensUsed: chartNoteResult.data.metadata.total_tokens || 0,
      generationTime: chartNoteResult.data.metadata.generation_time_ms || 0,
      agentType: "react",
      reasoningSteps: chartNoteResult.data.reasoning_steps,
      validation: validationResult.data.validation,
      citations: validationResult.data.citations,
      auditRunId: audit.runId,
    };

    await updateDocument(document.id, async (currentDocument) => {
      currentDocument.chartNote = chartNote;
    });

    await audit.complete(
      summarizeChartNoteAudit(chartNote, validationResult, {
        needsReview,
        regenerated,
      })
    );
    await audit.flush();

    return { chartNote, needsReview };
  } catch (error) {
    await audit.fail(error, {
      regenerated,
      status: "failed",
    });
    await audit.flush();
    throw error;
  }
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
    name: patient.name || "Sample Patient Name",
    age: patient.age || 0,
    mrn: patient.mrn || "",
    admission_date: patient.admission_date || "",
    discharge_date: patient.discharge_date || "",
    los_days: patient.los_days || 0,
    summary: `Patient processed via Agent System v2.0.0`
  };
}

app.get("/api/health", async (_req, res) => {
  res.json({ status: "ok", model: MODEL });
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

app.use(express.static(distDir));

app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.post("/api/documents/upload", upload.array("files"), async (req, res) => {
  const files = req.files || [];

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  const uploaded = [];
  const duplicates = [];
  const existingDocuments = await readDocuments();

  // Build a map of existing hashes for quick lookup
  const hydratedHashes = await hydrateDocumentHashes(existingDocuments);
  if (hydratedHashes) {
    await writeDocuments(existingDocuments);
  }

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

      documents.unshift(document);
      uploaded.push(publicDocument(document));
    }
  });

  res.status(201).json({ documents: uploaded, duplicates });
});

app.post("/api/documents/process", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];

  if (ids.length === 0) {
    return res.status(400).json({ error: "No document ids provided" });
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
      });
    }

    return selected;
  });

  for (const document of queuedDocuments) {
    if (!document) continue;

    const auditRun = await startAuditRunSafe({
      workflow: "extraction",
      documentId: document.id,
      requestId: buildAuditRequestId("extract"),
      title: document.name,
      actor: "system",
      metadata: {
        department: document.department,
        mode: "batch",
      },
    });
    const audit = createAuditRunContext(auditRun, {
      workflow: "extraction",
      documentId: document.id,
      requestId: auditRun?.requestId || null,
    });

    try {
      await audit.event("document_processing_started", "info", "Document processing started", {
        name: document.name,
      });

      const agentResult = await documentRouter.process(document.filePath, {
        pdfName: document.name,
        onProgress: (progress) => {
          void audit.event("agent_progress", progress.type === "error" ? "error" : "info", progress.step || progress.type || "progress", extractStepSummary(progress));
        },
      });

      if (!agentResult.success || isCatastrophicProcessingFailure(agentResult)) {
        throw new Error(getProcessingFailureMessage(agentResult, "Document processing failed"));
      }

      const result = await transformAgentResultToDashboard(agentResult);
      await updateDocument(document.id, async (currentDocument) => {
        currentDocument.status = "processed";
        currentDocument.department = result?.meta?.department_type || currentDocument.department;
        currentDocument.result = result;
        currentDocument.agentInfo = {
          ...buildAgentInfo(agentResult),
          auditRunId: audit.runId,
        };
        currentDocument.error = null;
        currentDocument.processedAt = new Date().toISOString();
      });

      for (const step of agentResult.steps || []) {
        await audit.event("step_result", step.success === false ? "error" : "success", step.step || step.name || "step", step);
      }
      await audit.complete(summarizeExtractionAudit(agentResult, result));
    } catch (error) {
      await updateDocument(document.id, async (currentDocument) => {
        currentDocument.status = "failed";
        currentDocument.result = null;
        currentDocument.agentInfo = null;
        currentDocument.error = error instanceof Error ? error.message : "Unknown processing error";
      });
      await audit.fail(error, {
        name: document.name,
        status: "failed",
      });
    } finally {
      await audit.flush();
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

  await fs.rm(document.filePath, { force: true });
  res.status(204).end();
});

// SSE endpoint for real-time processing progress
app.get("/api/documents/process/progress", async (req, res) => {
  const documentId = req.query.documentId;
  if (!documentId) {
    return res.status(400).json({ error: "documentId required" });
  }

  // Set headers for SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: "connected", documentId })}\n\n`);

  // Process the document with progress callbacks
  let audit = createAuditRunContext(null);
  try {
    const documents = await readDocuments();
    const document = documents.find((item) => item.id === documentId);

    if (!document) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Document not found" })}\n\n`);
      res.end();
      return;
    }

    await updateDocument(documentId, async (currentDocument) => {
      currentDocument.status = "processing";
      currentDocument.error = null;
    });

    const auditRun = await startAuditRunSafe({
      workflow: "extraction",
      documentId: document.id,
      requestId: buildAuditRequestId("extract"),
      title: document.name,
      actor: "system",
      metadata: {
        department: document.department,
        mode: "interactive_sse",
      },
    });
    audit = createAuditRunContext(auditRun, {
      workflow: "extraction",
      documentId: document.id,
      requestId: auditRun?.requestId || null,
    });

    const agentResult = await documentRouter.process(document.filePath, {
      pdfName: document.name,
      onProgress: (progress) => {
        res.write(`data: ${JSON.stringify({ ...progress, documentId })}\n\n`);
        void audit.event("agent_progress", progress.type === "error" ? "error" : "info", progress.step || progress.type || "progress", extractStepSummary(progress));
      },
    });

    if (!agentResult.success || isCatastrophicProcessingFailure(agentResult)) {
      throw new Error(getProcessingFailureMessage(agentResult, "Document processing failed"));
    }

    const result = await transformAgentResultToDashboard(agentResult);
    const updatedDocument = await updateDocument(documentId, async (currentDocument) => {
      currentDocument.status = "processed";
      currentDocument.department = result?.meta?.department_type || currentDocument.department;
      currentDocument.result = result;
      currentDocument.agentInfo = {
        ...buildAgentInfo(agentResult),
        auditRunId: audit.runId,
      };
      currentDocument.error = null;
      currentDocument.processedAt = new Date().toISOString();
    });

    for (const step of agentResult.steps || []) {
      await audit.event("step_result", step.success === false ? "error" : "success", step.step || step.name || "step", step);
    }
    await audit.complete(summarizeExtractionAudit(agentResult, result));
    await audit.flush();

    res.write(`data: ${JSON.stringify({
      type: "done",
      documentId,
      document: updatedDocument ? publicDocument(updatedDocument) : null
    })}\n\n`);
  } catch (error) {
    await updateDocument(documentId, async (currentDocument) => {
      currentDocument.status = "failed";
      currentDocument.result = null;
      currentDocument.error = error instanceof Error ? error.message : "Unknown error";
    });
    await audit.fail(error, {
      status: "failed",
      mode: "interactive_sse",
    });
    await audit.flush();

    res.write(`data: ${JSON.stringify({
      type: "error",
      documentId,
      error: error instanceof Error ? error.message : "Unknown error"
    })}\n\n`);
  }

  res.end();
});

app.get("/api/audit/runs", async (req, res) => {
  try {
    const runs = await auditLogger.getRuns({
      workflow: req.query.workflow,
      documentId: req.query.documentId,
      chatId: req.query.chatId,
      status: req.query.status,
      limit: req.query.limit,
    });
    return res.json({ runs });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to read audit runs" });
  }
});

app.get("/api/audit/runs/:runId", async (req, res) => {
  try {
    const run = await auditLogger.getRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ error: "Audit run not found" });
    }

    const events = await auditLogger.getEvents(req.params.runId, req.query.limit);
    return res.json({ run, events });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to read audit run" });
  }
});

app.get("/api/audit/runs/:runId/events", async (req, res) => {
  try {
    const run = await auditLogger.getRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ error: "Audit run not found" });
    }

    const events = await auditLogger.getEvents(req.params.runId, req.query.limit);
    return res.json({ events });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to read audit events" });
  }
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

  const auditRun = await startAuditRunSafe({
    workflow: "chat",
    documentId,
    chatId: chatId || null,
    requestId: buildAuditRequestId("chat"),
    title: message.slice(0, 120),
    actor: "user",
    metadata: {
      sectionContext: sectionContext || null,
      hasGeminiApiKey: !!String(geminiApiKey || "").trim(),
    },
  });
  const audit = createAuditRunContext(auditRun, {
    workflow: "chat",
    documentId,
    chatId: chatId || null,
    requestId: auditRun?.requestId || null,
  });

  try {
    await audit.event("chat_query_received", "info", "Chat query received", {
      message,
      sectionContext: sectionContext || null,
    });

    const response = await doctorAssistantAgent.execute({
      document,
      documentId,
      message,
      sectionContext,
      chatId,
      geminiApiKey,
    });

    const traceSteps = response?.data?.trace?.steps || [];
    for (const step of traceSteps) {
      await audit.event("trace_step", step.status === "blocked" ? "warning" : step.status === "warning" ? "warning" : "info", step.label || step.key || "trace", {
        key: step.key,
        summary: step.summary,
        meta: step.meta || {},
        createdAt: step.createdAt || null,
      });
    }

    await audit.complete(summarizeChatAudit(response.data));
    await audit.flush();

    return res.json({
      response: {
        ...response.data,
        auditRunId: audit.runId,
      },
      session: response.session,
    });
  } catch (error) {
    await audit.fail(error, {
      message,
      sectionContext: sectionContext || null,
    });
    await audit.flush();
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

  try {
    const result = await generateChartNoteForDocument(document, { regenerated: true });

    return res.json({
      chartNote: result.chartNote,
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
    const result = await generateChartNoteForDocument(document, { regenerated: false });

    res.json({
      chartNote: result.chartNote,
      needsReview: result.needsReview
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

ensureStorage()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Doctor dashboard processing server listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize storage", error);
    process.exit(1);
  });
