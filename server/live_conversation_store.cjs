const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

class LiveConversationStore {
  constructor(config = {}) {
    // Default to storage/ subdirectory relative to server directory
    const defaultStorageDir = path.join(__dirname, "..", "server", "storage");
    this.storageDir = config.storageDir || defaultStorageDir;
    this.sessionsPath = path.join(this.storageDir, "live_conversation_sessions.json");
    this.eventsPath = path.join(this.storageDir, "live_conversation_events.jsonl");
    this.audioDir = path.join(this.storageDir, "live_conversation_audio");
    this.checkpointsDir = path.join(this.storageDir, "live_conversation_checkpoints");
    this.mutationQueue = Promise.resolve();
  }

  log(message, data = {}) {
    console.log(`[LiveConversationStore] ${message}`, data);
  }

  async ensureStorage() {
    await fs.mkdir(this.audioDir, { recursive: true });
    await fs.mkdir(this.checkpointsDir, { recursive: true });
    try {
      await fs.access(this.sessionsPath);
    } catch {
      await fs.writeFile(this.sessionsPath, JSON.stringify({ sessions: [] }, null, 2), "utf8");
    }
    try {
      await fs.access(this.eventsPath);
    } catch {
      await fs.writeFile(this.eventsPath, "", "utf8");
    }
  }

  async readSessions() {
    await this.ensureStorage();
    try {
      const raw = await fs.readFile(this.sessionsPath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.sessions) ? parsed.sessions : [];
    } catch (error) {
      this.log("Error reading sessions", { error: error.message });
      return [];
    }
  }

  async writeSessions(sessions) {
    await this.ensureStorage();
    await fs.writeFile(this.sessionsPath, JSON.stringify({ sessions }, null, 2), "utf8");
  }

  async mutateSessions(mutator) {
    const run = this.mutationQueue.then(async () => {
      const sessions = await this.readSessions();
      const result = await mutator(sessions);
      await this.writeSessions(sessions);
      return result;
    }, (err) => {
      this.log("Mutation queue error", { error: err.message });
      throw err;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  generateId() {
    return `live-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }

  createSession(params = {}) {
    const now = new Date().toISOString();
    return {
      id: this.generateId(),
      status: "draft",
      linkedPatient: params.linkedPatient || "",
      encounterLabel: params.encounterLabel || "",
      createdBy: params.createdBy || { id: "unknown", username: "unknown", role: "doctor" },
      startedAt: null,
      updatedAt: now,
      endedAt: null,
      documentId: null,
      durationMs: 0,
      lastTranscriptEventAt: null,
      lastDraftEventAt: null,
      audio: {
        mimeType: "audio/webm",
        chunkCount: 0,
        combinedPath: null,
        totalBytes: 0,
      },
      transcript: {
        segments: [],
        rawText: "",
        normalizedText: "",
        speakers: [],
        quality: {
          overallConfidence: null,
          lowConfidenceSegmentCount: 0,
          speakerAmbiguityCount: 0,
          overlappingSpeechSuspected: false,
        },
      },
      draftExtraction: {
        extractedData: null,
        reviewItems: [],
        lastStableSegmentId: null,
      },
      error: null,
      transport: {
        connectionState: "idle",
        lastError: null,
        lastEventAt: null,
      },
      ...params.overrides,
    };
  }

  async create(params = {}) {
    return this.mutateSessions((sessions) => {
      const session = this.createSession(params);
      sessions.unshift(session);
      this.log("Session created", { id: session.id });
      return session;
    });
  }

  async get(sessionId) {
    const sessions = await this.readSessions();
    return sessions.find((s) => s.id === sessionId) || null;
  }

  async list(filters = {}) {
    const sessions = await this.readSessions();
    let filtered = sessions;

    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      filtered = filtered.filter((s) => statuses.includes(s.status));
    }
    if (filters.createdBy) {
      filtered = filtered.filter((s) => s.createdBy?.id === filters.createdBy);
    }

    return filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async update(sessionId, updates = {}) {
    return this.mutateSessions((sessions) => {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) {
        return null;
      }

      const session = sessions[index];
      Object.assign(session, {
        ...updates,
        updatedAt: new Date().toISOString(),
      });

      this.log("Session updated", { id: sessionId, status: session.status });
      return { ...session };
    });
  }

  async updateAudioChunk(sessionId, chunkInfo) {
    return this.mutateSessions((sessions) => {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return null;

      const session = sessions[index];
      session.audio.chunkCount = (session.audio.chunkCount || 0) + 1;
      session.audio.totalBytes = (session.audio.totalBytes || 0) + (chunkInfo.bytes || 0);
      session.updatedAt = new Date().toISOString();

      if (session.status === "live") {
        const now = Date.now();
        if (session.startedAt) {
          session.durationMs = now - new Date(session.startedAt).getTime();
        }
      }

      return { ...session };
    });
  }

  async appendTranscriptSegment(sessionId, segment) {
    return this.mutateSessions((sessions) => {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return null;

      const session = sessions[index];
      if (!session.transcript.segments.find((s) => s.id === segment.id)) {
        session.transcript.segments.push(segment);
        session.transcript.rawText = segment.text
          ? (session.transcript.rawText + " " + segment.text).trim()
          : session.transcript.rawText;
        session.transcript.normalizedText = segment.normalizedText || session.transcript.rawText;
        session.lastTranscriptEventAt = new Date().toISOString();

        if (segment.confidence !== null && segment.confidence < 0.7) {
          session.transcript.quality.lowConfidenceSegmentCount++;
        }
        if (segment.speakerRole === "unknown") {
          session.transcript.quality.speakerAmbiguityCount++;
        }
      }

      session.updatedAt = new Date().toISOString();
      return { ...session };
    });
  }

  async replaceTranscript(sessionId, transcriptData = {}) {
    return this.mutateSessions((sessions) => {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return null;

      const session = sessions[index];
      const segments = Array.isArray(transcriptData.segments)
        ? transcriptData.segments
          .map((segment, segmentIndex) => {
            const text = String(segment?.text || segment?.normalizedText || "").trim();
            if (!text) return null;

            return {
              id: String(segment?.id || segment?.segmentId || `seg-${sessionId}-${segmentIndex + 1}`),
              speakerId: segment?.speakerId || `spk_${segmentIndex + 1}`,
              speakerRole: segment?.speakerRole || "unknown",
              speakerLabel: segment?.speakerLabel || "Unknown",
              startLabel: segment?.startLabel || "00:00",
              endLabel: segment?.endLabel || "00:00",
              startSeconds: Number.isFinite(segment?.startSeconds) ? segment.startSeconds : undefined,
              endSeconds: Number.isFinite(segment?.endSeconds) ? segment.endSeconds : undefined,
              text,
              normalizedText: String(segment?.normalizedText || text),
              confidence: typeof segment?.confidence === "number" ? segment.confidence : null,
              flags: Array.isArray(segment?.flags) ? segment.flags.filter(Boolean) : [],
              status: segment?.status === "interim" ? "interim" : "final",
            };
          })
          .filter(Boolean)
        : [];

      const rawText = String(
        transcriptData.rawText
        || transcriptData.normalizedText
        || segments.map((segment) => segment.text).join(" ").trim(),
      );
      const normalizedText = String(
        transcriptData.normalizedText
        || transcriptData.rawText
        || rawText,
      );

      session.transcript = {
        segments,
        rawText,
        normalizedText,
        speakers: Array.isArray(transcriptData.speakers) ? transcriptData.speakers : [],
        quality: {
          overallConfidence: typeof transcriptData.quality?.overallConfidence === "number"
            ? transcriptData.quality.overallConfidence
            : null,
          lowConfidenceSegmentCount: Number(
            transcriptData.quality?.lowConfidenceSegmentCount
            || segments.filter((segment) => typeof segment.confidence === "number" && segment.confidence < 0.7).length
            || 0,
          ),
          speakerAmbiguityCount: Number(
            transcriptData.quality?.speakerAmbiguityCount
            || segments.filter((segment) => segment.speakerRole === "unknown").length
            || 0,
          ),
          overlappingSpeechSuspected: Boolean(transcriptData.quality?.overlappingSpeechSuspected),
        },
      };

      session.lastTranscriptEventAt = rawText.trim() ? new Date().toISOString() : session.lastTranscriptEventAt;
      session.updatedAt = new Date().toISOString();
      return { ...session };
    });
  }

  async updateDraftExtraction(sessionId, draftData) {
    return this.mutateSessions((sessions) => {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return null;

      const session = sessions[index];
      // Merge draft data with existing data to avoid race conditions
      session.draftExtraction = session.draftExtraction || {
        extractedData: null,
        reviewItems: [],
        lastStableSegmentId: null,
      };
      session.draftExtraction.extractedData = {
        ...(session.draftExtraction.extractedData || {}),
        ...draftData,
      };
      session.lastDraftEventAt = new Date().toISOString();
      session.updatedAt = new Date().toISOString();

      return { ...session };
    });
  }

  async updateDraftLastStableSegmentId(sessionId, lastStableSegmentId) {
    return this.mutateSessions((sessions) => {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return null;

      const session = sessions[index];
      session.draftExtraction = session.draftExtraction || {
        extractedData: null,
        reviewItems: [],
        lastStableSegmentId: null,
      };
      session.draftExtraction.lastStableSegmentId = lastStableSegmentId;
      session.updatedAt = new Date().toISOString();

      return { ...session };
    });
  }

  async addReviewItem(sessionId, reviewItem) {
    return this.mutateSessions((sessions) => {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return null;

      const session = sessions[index];
      const existing = session.draftExtraction.reviewItems.find((r) => r.id === reviewItem.id);
      if (existing) {
        Object.assign(existing, reviewItem);
      } else {
        session.draftExtraction.reviewItems.push(reviewItem);
      }

      session.updatedAt = new Date().toISOString();
      return { ...session };
    });
  }

  async resolveReviewItem(sessionId, reviewItemId, resolution, editedValue) {
    return this.mutateSessions((sessions) => {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return null;

      const session = sessions[index];
      const item = session.draftExtraction.reviewItems.find((r) => r.id === reviewItemId);
      if (item) {
        item.resolution = resolution;
        if (resolution === "edited" && editedValue) {
          item.editedValue = editedValue;
        }
      }

      session.updatedAt = new Date().toISOString();
      return { ...session };
    });
  }

  async finalize(sessionId, documentId) {
    return this.mutateSessions((sessions) => {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return null;

      const session = sessions[index];
      session.status = "finalized";
      session.documentId = documentId;
      session.endedAt = new Date().toISOString();
      session.updatedAt = new Date().toISOString();

      this.log("Session finalized", { id: sessionId, documentId });
      return { ...session };
    });
  }

  async deleteSessionArtifacts(session) {
    const combinedPath = session?.audio?.combinedPath;
    if (!combinedPath) return;

    const normalizedAudioDir = path.resolve(this.audioDir);
    const normalizedCombinedPath = path.resolve(combinedPath);
    if (!normalizedCombinedPath.startsWith(normalizedAudioDir + path.sep) && normalizedCombinedPath !== normalizedAudioDir) {
      this.log("Skipped deleting audio outside live conversation storage", {
        path: combinedPath,
      });
      return;
    }

    try {
      await fs.unlink(normalizedCombinedPath);
      this.log("Deleted live conversation audio", { path: normalizedCombinedPath });
    } catch (error) {
      if (error && error.code === "ENOENT") return;
      this.log("Failed to delete live conversation audio", {
        path: normalizedCombinedPath,
        error: error?.message || String(error),
      });
    }
  }

  async setError(sessionId, error) {
    return this.update(sessionId, {
      status: "failed",
      error: String(error),
      transport: {
        connectionState: "error",
        lastError: String(error),
        lastEventAt: new Date().toISOString(),
      },
    });
  }

  async delete(sessionId) {
    return this.mutateSessions(async (sessions) => {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return null;

      const [deleted] = sessions.splice(index, 1);
      await this.deleteSessionArtifacts(deleted);
      this.log("Session deleted", { id: sessionId });
      return deleted;
    });
  }

  async logEvent(sessionId, eventType, data = {}) {
    const timestamp = new Date().toISOString();
    const event = {
      timestamp,
      sessionId,
      eventType,
      ...data,
    };

    const line = JSON.stringify(event) + "\n";
    await fs.appendFile(this.eventsPath, line, "utf8");
  }

  async getEvents(sessionId, limit = 100) {
    await this.ensureStorage();
    try {
      const raw = await fs.readFile(this.eventsPath, "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const events = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((e) => e && e.sessionId === sessionId)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return events.slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  toPublicSession(session = {}) {
    if (!session || !session.id) return null;

    return {
      id: session.id,
      status: session.status,
      linkedPatient: session.linkedPatient,
      encounterLabel: session.encounterLabel,
      createdBy: session.createdBy,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      endedAt: session.endedAt,
      durationMs: session.durationMs || 0,
      documentId: session.documentId,
      audio: {
        mimeType: session.audio?.mimeType,
        chunkCount: session.audio?.chunkCount || 0,
        combinedPath: session.audio?.combinedPath || null,
        totalBytes: session.audio?.totalBytes || 0,
      },
      transcript: session.transcript || {
        segments: [],
        rawText: "",
        normalizedText: "",
        speakers: [],
        quality: {
          overallConfidence: null,
          lowConfidenceSegmentCount: 0,
          speakerAmbiguityCount: 0,
          overlappingSpeechSuspected: false,
        },
      },
      draftExtraction: session.draftExtraction || {
        extractedData: null,
        reviewItems: [],
        lastStableSegmentId: null,
      },
      error: session.error,
      transport: session.transport || {
        connectionState: "idle",
        lastError: null,
        lastEventAt: null,
      },
    };
  }
}

module.exports = LiveConversationStore;
