const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

class AuditLogger {
  constructor(config = {}) {
    this.storageDir = config.storageDir;
    this.runsPath = config.runsPath || path.join(this.storageDir, "audit_runs.json");
    this.eventsPath = config.eventsPath || path.join(this.storageDir, "audit_events.jsonl");
    this.runMutationQueue = Promise.resolve();
    this.eventAppendQueue = Promise.resolve();
  }

  async ensureStorage() {
    await fs.mkdir(this.storageDir, { recursive: true });

    try {
      await fs.access(this.runsPath);
    } catch {
      await fs.writeFile(this.runsPath, JSON.stringify({ runs: [] }, null, 2), "utf8");
    }

    try {
      await fs.access(this.eventsPath);
    } catch {
      await fs.writeFile(this.eventsPath, "", "utf8");
    }
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
    await this.ensureStorage();
    const raw = await fs.readFile(this.runsPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.runs) ? parsed.runs : [];
  }

  async writeRuns(runs) {
    await this.ensureStorage();
    await fs.writeFile(this.runsPath, JSON.stringify({ runs }, null, 2), "utf8");
  }

  async mutateRuns(mutator) {
    return this.queueRunMutation(async () => {
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
      await this.ensureStorage();
      await fs.appendFile(this.eventsPath, `${JSON.stringify(payload)}\n`, "utf8");
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

    const run = {
      runId,
      workflow,
      documentId,
      chatId,
      requestId,
      title,
      actor,
      status: "running",
      startedAt,
      completedAt: null,
      durationMs: null,
      metadata: this.sanitizeDetails(metadata),
      summary: {},
      error: null,
    };

    await this.mutateRuns(async (runs) => {
      runs.unshift(run);
    });

    await this.appendEvent({
      runId,
      workflow,
      documentId,
      chatId,
      requestId,
      type: "run_started",
      status: "info",
      title,
      details: {
        actor,
        metadata,
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

    await this.mutateRuns(async (runs) => {
      const run = runs.find((item) => item.runId === runId);
      if (!run) return;
      run.status = "completed";
      run.completedAt = completedAt;
      run.durationMs = run.startedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(run.startedAt)) : null;
      run.summary = this.sanitizeDetails(summary);
      run.error = null;
    });

    await this.appendEvent({
      runId,
      type: "run_completed",
      status: "success",
      details: summary,
    });
  }

  async failRun(runId, error, summary = {}) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error || "Unknown error");

    await this.mutateRuns(async (runs) => {
      const run = runs.find((item) => item.runId === runId);
      if (!run) return;
      run.status = "failed";
      run.completedAt = completedAt;
      run.durationMs = run.startedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(run.startedAt)) : null;
      run.summary = this.sanitizeDetails(summary);
      run.error = message;
    });

    await this.appendEvent({
      runId,
      type: "run_failed",
      status: "error",
      details: {
        error: message,
        ...summary,
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
    await this.ensureStorage();
    const raw = await fs.readFile(this.eventsPath, "utf8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const events = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (!runId || parsed.runId === runId) {
          events.push(parsed);
        }
      } catch {
        // Ignore malformed historical lines rather than failing the audit API.
      }
    }

    return events.slice(-Math.max(1, Math.min(Number(limit) || 500, 2000)));
  }
}

module.exports = AuditLogger;
