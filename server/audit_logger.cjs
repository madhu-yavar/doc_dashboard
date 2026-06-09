const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { AuditRepository } = require("./repositories/audit_repository.cjs");

class AuditLogger {
  constructor(config = {}) {
    this.storageDir = config.storageDir;
    this.runsPath = config.runsPath || path.join(this.storageDir, "audit_runs.json");
    this.eventsPath = config.eventsPath || path.join(this.storageDir, "audit_events.jsonl");
    this.runMutationQueue = Promise.resolve();
    this.eventAppendQueue = Promise.resolve();

    // Phase 6: AuditRepository is now the only source of truth
    this.auditRepository = new AuditRepository();
    this.auditRepository.initialize().catch(err => {
      console.error('[AuditLogger] Failed to initialize AuditRepository:', err.message);
    });
  }

  normalizeWorkflow(workflow) {
    const normalized = String(workflow || "").trim().toLowerCase();
    switch (normalized) {
      case "document_processing":
      case "voice_upload":
      case "live_conversation":
      case "chat":
      case "audit":
      case "external_sync":
        return normalized;
      case "extraction":
      case "chart_note":
      case "handwriting_extraction":
        return "document_processing";
      default:
        return "audit";
    }
  }

  normalizeRunStatus(status) {
    const normalized = String(status || "").trim().toLowerCase();
    switch (normalized) {
      case "completed":
      case "success":
        return "completed";
      case "failed":
      case "error":
        return "failed";
      case "in_progress":
      case "running":
      case "started":
      default:
        return "in_progress";
    }
  }

  normalizeEventStatus(status) {
    const normalized = String(status || "").trim().toLowerCase();
    switch (normalized) {
      case "completed":
      case "success":
        return "completed";
      case "failed":
      case "error":
        return "failed";
      case "warning":
        return "warning";
      case "started":
      case "info":
      default:
        return "started";
    }
  }

  extractActorFields(actor, metadata = {}) {
    const authenticatedUser = metadata?.authenticatedUser;
    const actorUserId =
      authenticatedUser && typeof authenticatedUser.id === "string"
        ? authenticatedUser.id
        : null;
    const actorLabel =
      typeof actor === "string" && actor.trim()
        ? actor.trim()
        : (authenticatedUser?.username ? `${authenticatedUser.role || "user"}:${authenticatedUser.username}` : "system");

    return { actorUserId, actorLabel };
  }

  async ensureStorage() {
    // Phase 6: Create only storage directory, not legacy audit files
    await fs.mkdir(this.storageDir, { recursive: true });
    // Audit data is stored in PostgreSQL only, not in JSON/JSONL files
  }

  queueRunMutation(task) {
    const run = this.runMutationQueue.then(task, task);
    this.runMutationQueue = run.catch(() => {});
    return run;
  }

  queueEventAppend(task) {
    const run = this.eventAppendQueue.then(task, task);
    this.eventAppendQueue = run.catch(() => {});
    return run;
  }

  async readRuns() {
    // Phase 6: Read from Postgres only (legacy filesystem reads removed)
    await this.auditRepository.initialize();
    const runs = await this.auditRepository.getAllAuditRuns();
    // Transform to legacy format for API compatibility
    return runs.map(run => ({
      runId: run.id,
      workflow: run.workflow,
      documentId: run.document_id,
      chatId: run.chat_session_id,
      requestId: run.request_id,
      title: run.title,
      actor: run.actor_label || `user:${run.actor_user_id}`,
      status: run.status === "in_progress" ? "running" : run.status,
      metadata: run.metadata_jsonb || {},
      summary: run.summary_jsonb || {},
      error: run.error_message,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      durationMs: run.duration_ms
    }));
  }

  async writeRuns(runs) {
    // Phase 6: Write to Postgres only (legacy filesystem writes removed)
    // Note: This is a simplified approach - in practice, individual run updates
    // should use repository methods for better performance
    for (const run of runs) {
      try {
        await this.auditRepository.updateAuditRun(run.runId, {
          status: this.normalizeRunStatus(run.status),
          completed_at: run.completedAt,
          duration_ms: run.durationMs,
          summary_jsonb: run.summary || {},
          error_message: run.error || null
        });
      } catch (error) {
        console.error('[Audit] Failed to update audit run in Postgres:', error.message);
      }
    }
  }

  async mutateRuns(mutator) {
    return this.queueRunMutation(async () => {
      // Phase 6: Read from Postgres, apply mutations, write back to Postgres
      const runs = await this.readRuns();
      const result = await mutator(runs);
      await this.writeRuns(runs);
      return result;
    });
  }

  sanitizeDetails(details = {}) {
    if (!details || typeof details !== "object") return {};

    const replacer = (_key, value) => {
      if (typeof value === "string" && value.length > 4000) {
        return `${value.slice(0, 3997)}...`;
      }
      return value;
    };

    return JSON.parse(JSON.stringify(details, replacer));
  }

  async appendEvent(event = {}) {
    const payload = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
      details: this.sanitizeDetails(event.details || {}),
    };

    return this.queueEventAppend(async () => {
      // Phase 6: Write events to Postgres instead of JSONL file
      try {
        await this.auditRepository.createAuditEvent({
          id: payload.id,
          audit_run_id: payload.runId,
          workflow: this.normalizeWorkflow(payload.workflow),
          document_id: payload.documentId || null,
          chat_session_id: payload.chatId || null,
          event_type: payload.type || 'unknown',
          status: this.normalizeEventStatus(payload.status),
          title: payload.title || '',
          details: payload.details || {}
        });
      } catch (error) {
        console.error('[Audit] Failed to write event to Postgres:', error.message);
      }
      return payload;
    });
  }

  async startRun({
    workflow,
    documentId = null,
    chatId = null,
    requestId = null,
    title = "",
    actor = "system",
    metadata = {},
  }) {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const sanitizedMetadata = this.sanitizeDetails(metadata);
    const { actorUserId, actorLabel } = this.extractActorFields(actor, sanitizedMetadata);
    const workflowName = this.normalizeWorkflow(workflow);

    const run = {
      runId,
      workflow: workflowName,
      documentId,
      chatId,
      requestId,
      title,
      actor: actorLabel,
      status: "running",
      startedAt,
      completedAt: null,
      durationMs: null,
      metadata: sanitizedMetadata,
      summary: {},
      error: null,
    };

    await this.auditRepository.createAuditRun({
      id: runId,
      workflow: workflowName,
      document_id: documentId,
      chat_session_id: chatId,
      request_id: requestId,
      actor_user_id: actorUserId,
      actor_label: actorLabel,
      status: "in_progress",
      title,
      metadata: sanitizedMetadata,
      started_at: startedAt,
      completed_at: null,
      duration_ms: null,
      summary: {},
      error_message: null,
    });

    await this.appendEvent({
      runId,
      workflow: workflowName,
      documentId,
      chatId,
      requestId,
      type: "run_started",
      status: "started",
      title,
      details: {
        actor: actorLabel,
        metadata: sanitizedMetadata,
      },
    });

    return run;
  }

  async logEvent(runId, event = {}) {
    return this.appendEvent({
      runId,
      ...event,
    });
  }

  async completeRun(runId, summary = {}) {
    const completedAt = new Date().toISOString();
    const run = await this.auditRepository.findAuditRunById(runId);
    const durationMs = run?.started_at ? Math.max(0, Date.parse(completedAt) - Date.parse(run.started_at)) : null;
    const sanitizedSummary = this.sanitizeDetails(summary);

    await this.auditRepository.updateAuditRun(runId, {
      status: "completed",
      completed_at: completedAt,
      duration_ms: durationMs,
      summary_jsonb: sanitizedSummary,
      error_message: null,
    });

    await this.appendEvent({
      runId,
      type: "run_completed",
      status: "completed",
      details: sanitizedSummary,
    });

    // Return runId for traceability
    return { id: runId };
  }

  async failRun(runId, error, summary = {}) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    const run = await this.auditRepository.findAuditRunById(runId);
    const durationMs = run?.started_at ? Math.max(0, Date.parse(completedAt) - Date.parse(run.started_at)) : null;
    const sanitizedSummary = this.sanitizeDetails(summary);

    await this.auditRepository.updateAuditRun(runId, {
      status: "failed",
      completed_at: completedAt,
      duration_ms: durationMs,
      summary_jsonb: sanitizedSummary,
      error_message: message,
    });

    await this.appendEvent({
      runId,
      type: "run_failed",
      status: "failed",
      details: {
        error: message,
        ...sanitizedSummary,
      },
    });
  }

  async getRuns({ workflow, documentId, chatId, status, limit = 50 } = {}) {
    const runs = await this.readRuns();
    return runs
      .filter((run) => !workflow || run.workflow === workflow)
      .filter((run) => !documentId || run.documentId === documentId)
      .filter((run) => !chatId || run.chatId === chatId)
      .filter((run) => !status || run.status === status)
      .slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)));
  }

  async getRun(runId) {
    const runs = await this.readRuns();
    return runs.find((run) => run.runId === runId) || null;
  }

  async getEvents(runId, limit = 500) {
    // Phase 6: Read from Postgres only (legacy filesystem reads removed)
    await this.auditRepository.initialize();
    const events = await this.auditRepository.getAllAuditEventsByAuditRunId(runId);
    // Transform to legacy format for API compatibility
    return events.map(event => ({
      id: event.id,
      timestamp: event.occurred_at,
      runId: event.audit_run_id,
      workflow: event.workflow,
      documentId: event.document_id,
      chatId: event.chat_session_id,
      type: event.event_type,
      status: event.status,
      title: event.title,
      details: event.details_jsonb
    })).slice(-Math.max(1, Math.min(Number(limit) || 500, 2000)));
  }
}

module.exports = AuditLogger;
