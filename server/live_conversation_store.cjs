const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { mergeLiveDraft, normalizeLiveDraft } = require("./live_conversation_draft.cjs");
const { LiveSessionsRepository } = require("./repositories/live_sessions_repository.cjs");

const VALID_UI_STATUSES = new Set([
  "draft",
  "live",
  "paused",
  "review_required",
  "finalizing",
  "finalized",
  "failed",
]);

const DEFAULT_TRANSPORT_STATE = {
  connectionState: "idle",
  lastError: null,
  lastEventAt: null,
};

const isUiStatus = (value) => VALID_UI_STATUSES.has(value);

const normalizeTransportState = (transportState = {}, workflowStatus) => {
  const source = transportState && typeof transportState === "object" ? transportState : {};
  const explicitWorkflowStatus = isUiStatus(workflowStatus)
    ? workflowStatus
    : isUiStatus(source.workflowStatus)
      ? source.workflowStatus
      : null;

  return {
    ...DEFAULT_TRANSPORT_STATE,
    ...source,
    connectionState: typeof source.connectionState === "string" && source.connectionState.trim()
      ? source.connectionState
      : DEFAULT_TRANSPORT_STATE.connectionState,
    lastError: typeof source.lastError === "string" && source.lastError.trim()
      ? source.lastError
      : null,
    lastEventAt: typeof source.lastEventAt === "string" && source.lastEventAt.trim()
      ? source.lastEventAt
      : null,
    workflowStatus: explicitWorkflowStatus,
  };
};

const mapDbStatusToUiStatus = (dbStatus, uiContext = {}) => {
  const explicitWorkflowStatus = isUiStatus(uiContext.workflowStatus)
    ? uiContext.workflowStatus
    : null;

  if (explicitWorkflowStatus) {
    return explicitWorkflowStatus;
  }

  switch (dbStatus) {
    case "active":
      if (uiContext.endedAt) return uiContext.documentId ? "finalized" : "review_required";
      if (uiContext.isPaused) return "paused";
      if (uiContext.isRecording) return "live";
      if (uiContext.hasReviewItems) return "review_required";
      if (uiContext.hasTranscript) return "live";
      return "draft";
    case "ended":
      return uiContext.documentId ? "finalized" : "review_required";
    case "abandoned":
      return "failed";
    default:
      return "draft";
  }
};

const mapUiStatusToDbStatus = (uiStatus) => {
  switch (uiStatus) {
    case "draft":
    case "live":
    case "paused":
    case "review_required":
    case "finalizing":
      return "active";
    case "finalized":
      return "ended";
    case "failed":
      return "abandoned";
    default:
      return "active";
  }
};

const buildPersistedTransportState = (transportState = {}, uiStatus) =>
  normalizeTransportState(transportState, uiStatus);

const resolveSessionUiStatus = ({
  status,
  transport,
  hasTranscript,
  hasReviewItems,
  documentId,
  endedAt,
}) => mapDbStatusToUiStatus(status, {
  workflowStatus: transport?.workflowStatus,
  hasTranscript,
  hasReviewItems,
  isRecording: transport?.connectionState === "connected",
  isPaused: transport?.connectionState === "paused",
  documentId,
  endedAt,
});

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const normalizeTranscriptArtifactText = (value = "") => String(value || "")
  .replace(/<\|[^>]+\|>/g, " ")
  .replace(/<\/?s>/gi, " ")
  .replace(/\[(?:music|silence|blank_audio|inaudible|noise)\]/gi, " ")
  .replace(/\s+/g, " ")
  .trim();
const isMeaningfulTranscriptString = (value = "") => {
  const cleaned = normalizeTranscriptArtifactText(value);
  return Boolean(cleaned && /[a-z0-9]/i.test(cleaned));
};

function countTranscriptSegmentRichness(segments = []) {
  if (!Array.isArray(segments)) return 0;
  return segments.reduce((score, segment) => {
    if (!segment || typeof segment !== "object") return score;
    return score
      + (isNonEmptyString(segment.text) ? 3 : 0)
      + (isNonEmptyString(segment.speakerRole) || isNonEmptyString(segment.speaker_role) ? 2 : 0)
      + (isNonEmptyString(segment.speakerLabel) || isNonEmptyString(segment.speaker_label) || isNonEmptyString(segment.speaker) ? 2 : 0)
      + (isNonEmptyString(segment.startLabel) || isNonEmptyString(segment.endLabel) ? 1 : 0)
      + (Array.isArray(segment.flags) && segment.flags.length > 0 ? 1 : 0);
  }, 0);
}

function scoreTranscriptPayload(transcript = null) {
  if (!transcript || typeof transcript !== "object") return 0;
  const rawText = normalizeTranscriptArtifactText(transcript.rawText || "");
  const normalizedText = normalizeTranscriptArtifactText(transcript.normalizedText || "");
  const speakers = Array.isArray(transcript.speakers) ? transcript.speakers.length : 0;
  const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
  return rawText.trim().length
    + normalizedText.trim().length
    + (segments.length * 20)
    + countTranscriptSegmentRichness(segments)
    + (speakers * 5);
}

function mergeTranscriptPayload(primaryTranscript = null, fallbackTranscript = null) {
  const primary = primaryTranscript && typeof primaryTranscript === "object" ? primaryTranscript : null;
  const fallback = fallbackTranscript && typeof fallbackTranscript === "object" ? fallbackTranscript : null;
  if (!primary && !fallback) return null;

  const primarySegments = Array.isArray(primary?.segments) ? primary.segments : [];
  const fallbackSegments = Array.isArray(fallback?.segments) ? fallback.segments : [];
  const useFallbackSegments = countTranscriptSegmentRichness(fallbackSegments) > countTranscriptSegmentRichness(primarySegments);
  const quality = primary?.quality && Object.keys(primary.quality).length > 0
    ? primary.quality
    : fallback?.quality && Object.keys(fallback.quality).length > 0
      ? fallback.quality
      : {};

  const merged = {
    ...(fallback || {}),
    ...(primary || {}),
    rawText: String(primary?.rawText || fallback?.rawText || ""),
    normalizedText: String(primary?.normalizedText || fallback?.normalizedText || primary?.rawText || fallback?.rawText || ""),
    language: primary?.language || fallback?.language || null,
    quality,
    speakers: Array.isArray(primary?.speakers) && primary.speakers.length > 0
      ? primary.speakers
      : Array.isArray(fallback?.speakers)
        ? fallback.speakers
        : [],
    segments: useFallbackSegments ? fallbackSegments : primarySegments,
  };

  return scoreTranscriptPayload(merged) > 0 ? merged : null;
}

function scoreLiveDraft(rawDraft = null) {
  const draft = normalizeLiveDraft(rawDraft || {});
  return [
    draft.chiefComplaint,
    draft.hpi,
    draft.diagnosis,
    draft.patient?.name,
    draft.patient?.gender,
  ].filter(isNonEmptyString).length * 10
    + (isFiniteNumber(draft.patient?.age) ? 5 : 0)
    + (Array.isArray(draft.ros) ? draft.ros.length : 0) * 2
    + (Array.isArray(draft.pastHistory) ? draft.pastHistory.length : 0) * 3
    + (Array.isArray(draft.symptoms) ? draft.symptoms.length : 0) * 3
    + (Array.isArray(draft.medications) ? draft.medications.filter((medication) => isNonEmptyString(medication?.name) || isNonEmptyString(medication?.instruction)).length : 0) * 4
    + (Array.isArray(draft.labs) ? draft.labs.length : 0) * 2
    + (Array.isArray(draft.radiology) ? draft.radiology.length : 0) * 2
    + (Array.isArray(draft.procedures) ? draft.procedures.length : 0) * 2
    + (Array.isArray(draft.followUp) ? draft.followUp.length : 0) * 2
    + (Array.isArray(draft.plan) ? draft.plan.length : 0) * 2
    + (isFiniteNumber(draft.vitals?.latest?.bp?.systolic) ? 2 : 0)
    + (isFiniteNumber(draft.vitals?.latest?.bp?.diastolic) ? 2 : 0)
    + (isFiniteNumber(draft.vitals?.latest?.pulse?.value) ? 1 : 0)
    + (isFiniteNumber(draft.vitals?.latest?.temperature?.value) ? 1 : 0)
    + (isFiniteNumber(draft.vitals?.latest?.spo2?.value) ? 1 : 0)
    + (isFiniteNumber(draft.vitals?.latest?.weight?.value) ? 1 : 0);
}

function extractDraftEnvelope(rawDraft = null) {
  if (!rawDraft || typeof rawDraft !== "object") return null;

  const source = rawDraft;
  const extractedSource = source.extracted_data || source.extractedData || source;
  const extractedData = normalizeLiveDraft(extractedSource && typeof extractedSource === "object" ? extractedSource : {});
  const reviewItems = Array.isArray(source.review_items)
    ? source.review_items
    : Array.isArray(source.reviewItems)
      ? source.reviewItems
      : [];
  const lastStableSegmentId = typeof source.last_stable_segment_id === "string"
    ? source.last_stable_segment_id
    : typeof source.lastStableSegmentId === "string"
      ? source.lastStableSegmentId
      : null;

  if (scoreLiveDraft(extractedData) === 0 && reviewItems.length === 0 && !lastStableSegmentId) {
    return null;
  }

  return {
    extractedData,
    reviewItems,
    lastStableSegmentId,
  };
}

function mergeDraftEnvelopes(primaryEnvelope = null, fallbackEnvelope = null) {
  if (!primaryEnvelope && !fallbackEnvelope) return null;

  const mergedExtractedData = mergeLiveDraft(
    fallbackEnvelope?.extractedData || {},
    primaryEnvelope?.extractedData || {},
  );
  const reviewItems = Array.isArray(primaryEnvelope?.reviewItems) && primaryEnvelope.reviewItems.length > 0
    ? primaryEnvelope.reviewItems
    : Array.isArray(fallbackEnvelope?.reviewItems)
      ? fallbackEnvelope.reviewItems
      : [];
  const lastStableSegmentId = primaryEnvelope?.lastStableSegmentId || fallbackEnvelope?.lastStableSegmentId || null;

  if (scoreLiveDraft(mergedExtractedData) === 0 && reviewItems.length === 0 && !lastStableSegmentId) {
    return null;
  }

  return {
    extractedData: mergedExtractedData,
    reviewItems,
    lastStableSegmentId,
  };
}

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

    // Store repository references for Phase 4 read cutover
    this.authService = config.authService || null;
    this.transcriptsRepository = config.transcriptsRepository || null;
    this.docsRepository = config.docsRepository || config.documentsRepository || null;
    this.legacySessionsSnapshot = null;

    // Phase 6: LiveSessionsRepository is now the only source of truth
    this.liveSessionsRepo = config.liveSessionsRepository || new LiveSessionsRepository();
    this.liveSessionsRepo.initialize().catch(err => {
      console.error('[LiveConversationStore] Failed to initialize LiveSessionsRepository:', err.message);
    });
  }

  log(message, data = {}) {
    console.log(`[LiveConversationStore] ${message}`, data);
  }

  buildMutationTraceSnapshot(session = null) {
    if (!session || typeof session !== "object") {
      return {
        id: null,
        status: null,
        startedAt: null,
        endedAt: null,
        durationMs: null,
        transcriptLength: 0,
        segmentCount: 0,
        chunkCount: 0,
        totalBytes: 0,
        transportState: null,
        workflowStatus: null,
        backend: null,
      };
    }

    return {
      id: session.id || null,
      status: session.status || null,
      startedAt: session.startedAt || null,
      endedAt: session.endedAt || null,
      durationMs: Number(session.durationMs || 0),
      transcriptLength: String(
        session.transcript?.normalizedText
        || session.transcript?.rawText
        || "",
      ).trim().length,
      segmentCount: Array.isArray(session.transcript?.segments) ? session.transcript.segments.length : 0,
      chunkCount: Number(session.audio?.chunkCount || 0),
      totalBytes: Number(session.audio?.totalBytes || 0),
      audioDurationMs: Number(session.audio?.durationMs || 0),
      transportState: session.transport?.connectionState || null,
      workflowStatus: session.transport?.workflowStatus || null,
      backend: session.sttBackend
        || session.transcript?.metadata?.backend
        || session.transcript?.quality?.backend
        || null,
    };
  }

  logMutationTrace(source, beforeSession, afterSession, extra = {}) {
    this.log("Session mutation trace", {
      source,
      sessionId: afterSession?.id || beforeSession?.id || null,
      before: this.buildMutationTraceSnapshot(beforeSession),
      after: this.buildMutationTraceSnapshot(afterSession),
      ...extra,
    });
  }

  async queueMutation(source, sessionId, mutator) {
    const run = this.mutationQueue.then(async () => {
      const currentSession = sessionId ? await this.get(sessionId) : null;
      return mutator(currentSession);
    }, (err) => {
      this.log("Mutation queue error", { error: err.message, source, sessionId });
      throw err;
    });

    this.mutationQueue = run.catch(() => {});
    return run;
  }

  mergeSessionPatch(currentSession = {}, updates = {}) {
    const nextStatus = updates.status || currentSession.status || "draft";
    const nextTransport = updates.transport
      ? normalizeTransportState({
          ...(currentSession.transport || {}),
          ...updates.transport,
        }, nextStatus)
      : normalizeTransportState(currentSession.transport, nextStatus);

    return {
      ...currentSession,
      ...updates,
      status: nextStatus,
      audio: updates.audio
        ? {
            ...(currentSession.audio || {}),
            ...updates.audio,
          }
        : currentSession.audio,
      transport: nextTransport,
      draftExtraction: updates.draftExtraction
        ? {
            ...(currentSession.draftExtraction || {}),
            ...updates.draftExtraction,
          }
        : currentSession.draftExtraction,
      transcript: updates.transcript
        ? {
            ...(currentSession.transcript || {}),
            ...updates.transcript,
          }
        : currentSession.transcript,
      updatedAt: new Date().toISOString(),
    };
  }

  buildPersistedTransportStateForSession(session = {}) {
    const captureStats = {
      chunkCount: Number(session.audio?.chunkCount || 0),
      totalBytes: Number(session.audio?.totalBytes || 0),
      combinedSize: Number(session.audio?.combinedSize || session.audio?.totalBytes || 0),
      durationMs: Number(session.audio?.durationMs || 0),
      mimeType: session.audio?.mimeType || "audio/webm",
    };

    return buildPersistedTransportState({
      ...(session.transport || {}),
      captureStats,
    }, session.status);
  }

  async persistSessionState(nextSession, previousSession = null, source = "store.persist") {
    if (!nextSession?.id) {
      return null;
    }

    await this.liveSessionsRepo.initialize();
    const existingSession = previousSession === null
      ? null
      : (previousSession || await this.get(nextSession.id));
    const transcriptId = await this.syncSessionTranscript(nextSession);
    const persistedFields = {
      status: mapUiStatusToDbStatus(nextSession.status),
      linked_patient_label: nextSession.linkedPatient || null,
      encounter_label: nextSession.encounterLabel || null,
      started_at: nextSession.startedAt || null,
      ended_at: nextSession.endedAt || null,
      document_id: nextSession.documentId || null,
      duration_ms: Number(nextSession.durationMs || 0),
      transport_state_jsonb: this.buildPersistedTransportStateForSession(nextSession),
      draft_extraction_jsonb: nextSession.draftExtraction || {},
      current_transcript_id: transcriptId || nextSession.currentTranscriptId || null,
    };

    if (existingSession) {
      await this.liveSessionsRepo.updateSession(nextSession.id, persistedFields);
    } else {
      await this.liveSessionsRepo.createSession({
        id: nextSession.id,
        created_by_user_id: nextSession.createdBy?.id || null,
        ...persistedFields,
      });
    }

    if (nextSession.audio?.combinedPath) {
      await this.syncLiveSessionAudioAsset(nextSession);
    }

    const canReloadPersistedSession = typeof this.liveSessionsRepo?.query === "function";
    const persistedSession = canReloadPersistedSession
      ? await this.get(nextSession.id)
      : nextSession;
    this.logMutationTrace(source, existingSession, persistedSession || nextSession, {
      transcriptId: transcriptId || nextSession.currentTranscriptId || null,
      selectedBackend: nextSession.sttBackend || null,
    });
    return persistedSession || nextSession;
  }

  getAudioExtensionFromMimeType(mimeType = "audio/webm") {
    const normalized = String(mimeType || "").toLowerCase();
    if (normalized.includes("mp4") || normalized.includes("m4a")) return ".mp4";
    if (normalized.includes("mpeg") || normalized.includes("mp3")) return ".mp3";
    if (normalized.includes("ogg")) return ".ogg";
    return ".webm";
  }

  async ensureStorage() {
    // Phase 6: Create only asset directories, not legacy metadata files
    await fs.mkdir(this.audioDir, { recursive: true });
    await fs.mkdir(this.checkpointsDir, { recursive: true });
    // Live session data is stored in PostgreSQL only, not in JSON files
  }

  async readLegacySessionsSnapshot() {
    if (this.legacySessionsSnapshot) {
      return this.legacySessionsSnapshot;
    }

    try {
      const raw = await fs.readFile(this.sessionsPath, "utf8");
      const parsed = JSON.parse(raw);
      const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
      this.legacySessionsSnapshot = new Map(
        sessions
          .filter((session) => session && typeof session.id === "string")
          .map((session) => [session.id, session]),
      );
    } catch (error) {
      this.legacySessionsSnapshot = new Map();
    }

    return this.legacySessionsSnapshot;
  }

  async findFlatAudioFile(sessionId, mimeType = "audio/webm") {
    const preferredExtension = this.getAudioExtensionFromMimeType(mimeType);
    const candidates = [
      path.join(this.audioDir, `${sessionId}${preferredExtension}`),
      path.join(this.audioDir, `${sessionId}.mp4`),
      path.join(this.audioDir, `${sessionId}.webm`),
      path.join(this.audioDir, `${sessionId}.mp3`),
      path.join(this.audioDir, `${sessionId}.ogg`),
    ];

    for (const candidate of candidates) {
      try {
        const stats = await fs.stat(candidate);
        if (stats.isFile()) {
          return {
            path: candidate,
            size: stats.size,
          };
        }
      } catch {}
    }

    return null;
  }

  async mergePersistedAudioMetadata(sessionId, audioMetadata = {}, legacySession = null) {
    let merged = {
      mimeType: "audio/webm",
      chunkCount: 0,
      combinedPath: null,
      totalBytes: 0,
      combinedSize: 0,
      durationMs: 0,
      ...(audioMetadata && typeof audioMetadata === "object" ? audioMetadata : {}),
    };

    if (legacySession?.audio && typeof legacySession.audio === "object") {
      merged = {
        ...merged,
        mimeType: legacySession.audio.mimeType || merged.mimeType,
        chunkCount: Math.max(merged.chunkCount || 0, Number(legacySession.audio.chunkCount || 0)),
        combinedPath: merged.combinedPath || legacySession.audio.combinedPath || null,
        totalBytes: Math.max(merged.totalBytes || 0, Number(legacySession.audio.totalBytes || 0)),
        combinedSize: Math.max(
          merged.combinedSize || 0,
          Number(legacySession.audio.totalBytes || 0),
          Number(legacySession.audio.combinedSize || 0),
        ),
        durationMs: Math.max(merged.durationMs || 0, Number(legacySession.audio.durationMs || 0)),
      };
    }

    if (this.docsRepository) {
      try {
        await this.docsRepository.initialize();
        const assets = await this.docsRepository.findAssetsByLiveSessionId(sessionId);
        const sourceAudioAsset = assets.find((asset) => asset.asset_role === "source_audio") || null;
        if (sourceAudioAsset) {
          const metadata = this.docsRepository.fromJSONB(sourceAudioAsset.metadata_jsonb || {});
          merged = {
            ...merged,
            mimeType: sourceAudioAsset.mime_type || merged.mimeType,
            chunkCount: Math.max(merged.chunkCount || 0, Number(metadata.chunkCount || 0)),
            combinedPath: merged.combinedPath || sourceAudioAsset.path_or_uri || null,
            totalBytes: Math.max(
              merged.totalBytes || 0,
              Number(sourceAudioAsset.size_bytes || 0),
            ),
            combinedSize: Math.max(
              merged.combinedSize || 0,
              Number(sourceAudioAsset.size_bytes || 0),
              Number(metadata.combinedSize || 0),
            ),
            durationMs: Math.max(merged.durationMs || 0, Number(metadata.durationMs || 0)),
          };
        }
      } catch (error) {
        this.log("Failed to hydrate audio asset metadata", {
          sessionId,
          error: error.message,
        });
      }
    }

    if (!merged.combinedPath) {
      const flatAudio = await this.findFlatAudioFile(sessionId, merged.mimeType);
      if (flatAudio) {
        merged = {
          ...merged,
          combinedPath: flatAudio.path,
          totalBytes: Math.max(merged.totalBytes || 0, Number(flatAudio.size || 0)),
          combinedSize: Math.max(merged.combinedSize || 0, Number(flatAudio.size || 0)),
        };
      }
    }

    return merged;
  }

  hasPersistableTranscript(session = {}) {
    return Boolean(
      (Array.isArray(session?.transcript?.segments) && session.transcript.segments.length > 0)
      || String(session?.transcript?.rawText || "").trim()
      || String(session?.transcript?.normalizedText || "").trim()
      || String(session?.transcript?.interimText || "").trim()
    );
  }

  mapSpeakerRoleToDb(role) {
    switch (role) {
      case "doctor":
      case "physician":
        return "physician";
      case "patient":
        return "patient";
      case "nurse":
        return "nurse";
      case "family":
        return "family";
      case "other":
        return "other";
      default:
        return "unknown";
    }
  }

  buildTranscriptPayload(session = {}) {
    const transcript = session?.transcript && typeof session.transcript === "object" ? session.transcript : {};
    return {
      rawText: String(transcript.rawText || ""),
      normalizedText: String(transcript.normalizedText || transcript.rawText || ""),
      interimText: String(transcript.interimText || ""),
      speakers: Array.isArray(transcript.speakers) ? transcript.speakers : [],
      quality: transcript.quality && typeof transcript.quality === "object" ? transcript.quality : {},
      segments: Array.isArray(transcript.segments) ? transcript.segments : [],
    };
  }

  async syncTranscriptSegments(transcriptId, segments = []) {
    if (!this.transcriptsRepository) return;

    await this.transcriptsRepository.initialize();
    await this.transcriptsRepository.deleteSegmentsByTranscriptId(transcriptId);

    for (const [segmentIndex, segment] of segments.entries()) {
      const text = String(segment?.text || segment?.normalizedText || "").trim();
      if (!text) continue;

      const startMs = Number.isFinite(segment?.startSeconds)
        ? Math.round(Number(segment.startSeconds) * 1000)
        : null;
      const endMs = Number.isFinite(segment?.endSeconds)
        ? Math.round(Number(segment.endSeconds) * 1000)
        : null;
      const rawSegmentId = String(segment?.id || `seg-${segmentIndex + 1}`);
      const persistedSegmentId = rawSegmentId.startsWith(`${transcriptId}:`)
        ? rawSegmentId
        : `${transcriptId}:${rawSegmentId}`;

      await this.transcriptsRepository.createSegment({
        id: persistedSegmentId,
        transcript_id: transcriptId,
        segment_order: segmentIndex + 1,
        speaker_id: segment?.speakerId || null,
        speaker_role: this.mapSpeakerRoleToDb(segment?.speakerRole),
        speaker_label: segment?.speakerLabel || null,
        start_ms: startMs,
        end_ms: endMs,
        text,
        normalized_text: String(segment?.normalizedText || text),
        confidence_score: typeof segment?.confidence === "number" ? segment.confidence : null,
        flags: Array.isArray(segment?.flags) ? segment.flags : [],
        status: segment?.status === "deleted" ? "deleted" : segment?.status === "edited" ? "edited" : "active",
      });
    }
  }

  async syncSessionTranscript(session = {}) {
    if (!this.transcriptsRepository || !session?.id) {
      return session?.currentTranscriptId || null;
    }

    await this.transcriptsRepository.initialize();
    const existingById = session.currentTranscriptId
      ? await this.transcriptsRepository.findTranscriptById(session.currentTranscriptId).catch(() => null)
      : null;
    const existingTranscript = existingById
      || (await this.transcriptsRepository.findTranscriptsByLiveSessionId(session.id).catch(() => []))[0]
      || null;

    if (!this.hasPersistableTranscript(session)) {
      return existingTranscript?.id || session.currentTranscriptId || null;
    }

    const transcriptPayload = this.buildTranscriptPayload(session);
    let transcriptRecord = existingTranscript;

    if (!transcriptRecord) {
      transcriptRecord = await this.transcriptsRepository.createTranscript({
        live_session_id: session.id,
        backend: session.sttBackend || null,
        language_code: transcriptPayload.language || null,
        raw_text: transcriptPayload.rawText || null,
        normalized_text: transcriptPayload.normalizedText || null,
        quality: transcriptPayload.quality || {},
        transcript: transcriptPayload,
      });
    } else {
      transcriptRecord = await this.transcriptsRepository.updateTranscript(transcriptRecord.id, {
        backend: session.sttBackend || null,
        language_code: transcriptPayload.language || null,
        raw_text: transcriptPayload.rawText || null,
        normalized_text: transcriptPayload.normalizedText || null,
        quality_jsonb: transcriptPayload.quality || {},
        transcript_jsonb: transcriptPayload,
      });
    }

    await this.syncTranscriptSegments(transcriptRecord.id, transcriptPayload.segments);
    return transcriptRecord.id;
  }

  async syncLiveSessionAudioAsset(session = {}) {
    if (!this.docsRepository || !session?.id || !session?.audio?.combinedPath) {
      return;
    }

    await this.docsRepository.initialize();
    await this.docsRepository.upsertDocumentAsset({
      id: `${session.id}:source_audio`,
      live_session_id: session.id,
      asset_role: "source_audio",
      storage_backend: "filesystem",
      path_or_uri: session.audio.combinedPath,
      mime_type: session.audio.mimeType || "audio/webm",
      size_bytes: session.audio.combinedSize || session.audio.totalBytes || null,
      metadata: {
        chunkCount: Number(session.audio.chunkCount || 0),
        combinedSize: Number(session.audio.combinedSize || session.audio.totalBytes || 0),
        durationMs: Number(session.audio.durationMs || 0),
      },
    });
  }

  async deleteLiveSessionAudioAssets(sessionId) {
    if (!this.docsRepository || !sessionId) return;

    await this.docsRepository.initialize();
    await this.docsRepository.deleteAssetsByLiveSessionId(sessionId, "source_audio");
  }

  async readSessions() {
    // Phase 6: Read from Postgres only (legacy filesystem reads removed)
    await this.liveSessionsRepo.initialize();
    const legacySessions = await this.readLegacySessionsSnapshot();
    // Get all sessions using direct query since repository doesn't have getAllSessions()
    const sessions = await this.liveSessionsRepo.query(`
      SELECT * FROM ${this.liveSessionsRepo.sessionsTableName}
      ORDER BY started_at DESC
    `);

    // Transform Postgres results to match legacy JSON structure with full hydration
    const hydratedSessions = await Promise.all(sessions.map(async (session) => {
      const legacySession = legacySessions.get(session.id) || null;
      // Fetch createdBy from auth service if user_id is available
      let createdBy = { id: "unknown", username: "unknown", role: "doctor" };
      if (session.created_by_user_id && this.authService) {
        try {
          // Try to get user info from auth service (if available)
          const users = await this.authService?.readUsers?.();
          const user = users?.find(u => u.id === session.created_by_user_id);
          if (user) {
            createdBy = {
              id: user.id,
              username: user.username,
              role: user.role
            };
          } else {
            createdBy = { id: session.created_by_user_id };
          }
        } catch (err) {
          createdBy = { id: session.created_by_user_id };
        }
      }

      // Reconstruct audio metadata from filesystem
      let audioMetadata = {
        mimeType: "audio/webm",
        chunkCount: 0,
        combinedPath: null,
        totalBytes: 0,
        combinedSize: 0,
        durationMs: 0,
      };

      // Try to read audio directory for this session to get actual metadata
      try {
        const sessionAudioDir = path.join(this.audioDir, session.id);
        const audioFiles = await fs.readdir(sessionAudioDir).catch(() => []);

        if (audioFiles.length > 0) {
          // Count audio chunks
          const chunkFiles = audioFiles.filter(f => f.endsWith('.webm') && f.includes('chunk'));
          audioMetadata.chunkCount = chunkFiles.length;

          // Check for combined audio file
          const combinedFile = audioFiles.find(f => f.includes('combined'));
          if (combinedFile) {
            const combinedPath = path.join(sessionAudioDir, combinedFile);
            const stats = await fs.stat(combinedPath).catch(() => null);
            if (stats) {
              audioMetadata.combinedPath = combinedPath;
              audioMetadata.combinedSize = stats.size;
            }
          }

          // Calculate total bytes from all chunks
          let totalBytes = 0;
          for (const chunkFile of chunkFiles) {
            const chunkPath = path.join(sessionAudioDir, chunkFile);
            const stats = await fs.stat(chunkPath).catch(() => null);
            if (stats) {
              totalBytes += stats.size;
            }
          }
          audioMetadata.totalBytes = totalBytes;
        }
      } catch (err) {
        // Audio directory doesn't exist or isn't accessible, keep defaults
      }
      audioMetadata = await this.mergePersistedAudioMetadata(session.id, audioMetadata, legacySession);

      // Reconstruct transport state from Postgres data (will be used later for status mapping)
      // Fetch transcript segments if current_transcript_id is available
      let transcriptSegments = [];
      let transcriptData = null;
      const transcriptId = session.current_transcript_id
        || (this.transcriptsRepository
          ? (await this.transcriptsRepository.findTranscriptsByLiveSessionId(session.id).catch(() => []))[0]?.id || null
          : null);
      if (transcriptId && this.transcriptsRepository) {
        try {
          // First, fetch the transcript to get the transcript data
          const transcript = await this.transcriptsRepository.findTranscriptById(transcriptId);
          if (transcript) {
            transcriptData = {
              rawText: transcript.raw_text,
              normalizedText: transcript.normalized_text,
              language: transcript.language_code,
              quality: transcript.quality_jsonb
            };

            // Then fetch the segments for this transcript
            const segments = await this.transcriptsRepository.findSegmentsByTranscriptId(transcriptId);
            transcriptSegments = segments.map(seg => ({
              id: typeof seg.id === "string" && seg.id.startsWith(`${transcriptId}:`)
                ? seg.id.slice(transcriptId.length + 1)
                : seg.id,
              speakerId: seg.speaker_id || null,
              speakerRole: seg.speaker_role === "physician" ? "doctor" : seg.speaker_role === "patient" ? "patient" : "unknown",
              speakerLabel: seg.speaker_label || "Unknown",
              startLabel: typeof seg.start_ms === "number"
                ? `${String(Math.floor(seg.start_ms / 60000)).padStart(2, "0")}:${String(Math.floor((seg.start_ms % 60000) / 1000)).padStart(2, "0")}`
                : "",
              endLabel: typeof seg.end_ms === "number"
                ? `${String(Math.floor(seg.end_ms / 60000)).padStart(2, "0")}:${String(Math.floor((seg.end_ms % 60000) / 1000)).padStart(2, "0")}`
                : "",
              startSeconds: typeof seg.start_ms === "number" ? seg.start_ms / 1000 : undefined,
              endSeconds: typeof seg.end_ms === "number" ? seg.end_ms / 1000 : undefined,
              text: seg.text,
              normalizedText: seg.normalized_text || seg.text,
              confidence: seg.confidence_score
            }));
          }
        } catch (err) {
          // No transcript segments available
        }
      }

      const transcript = mergeTranscriptPayload(
        transcriptData ? {
          rawText: transcriptData.rawText,
          normalizedText: transcriptData.normalizedText,
          language: transcriptData.language,
          quality: transcriptData.quality,
          speakers: [],
          segments: transcriptSegments,
        } : null,
        legacySession?.transcript || null,
      );
      const draftExtraction = mergeDraftEnvelopes(
        extractDraftEnvelope(session.draft_extraction_jsonb),
        extractDraftEnvelope(legacySession?.draftExtraction),
      );

      const hasTranscript = Array.isArray(transcript?.segments) && transcript.segments.length > 0
        || isMeaningfulTranscriptString(transcript?.rawText)
        || isMeaningfulTranscriptString(transcript?.normalizedText);
      const persistedReviewItems = draftExtraction?.reviewItems || [];
      const hasReviewItems = persistedReviewItems.length > 0;
      const transportState = normalizeTransportState(session.transport_state_jsonb);
      const captureStats = transportState?.captureStats && typeof transportState.captureStats === "object"
        ? transportState.captureStats
        : {};
      audioMetadata = {
        ...audioMetadata,
        mimeType: captureStats.mimeType || audioMetadata.mimeType,
        chunkCount: Math.max(audioMetadata.chunkCount || 0, Number(captureStats.chunkCount || 0)),
        totalBytes: Math.max(audioMetadata.totalBytes || 0, Number(captureStats.totalBytes || 0)),
        combinedSize: Math.max(audioMetadata.combinedSize || 0, Number(captureStats.combinedSize || 0)),
        durationMs: Math.max(audioMetadata.durationMs || 0, Number(captureStats.durationMs || 0)),
      };

      const uiStatus = resolveSessionUiStatus({
        status: session.status,
        transport: transportState,
        hasTranscript,
        hasReviewItems,
        documentId: session.document_id,
        endedAt: session.ended_at,
      });

      return {
        id: session.id,
        status: uiStatus,
        linkedPatient: session.linked_patient_label,
        encounterLabel: session.encounter_label,
        createdBy: createdBy,
        startedAt: session.started_at,
        updatedAt: session.updated_at,
        endedAt: session.ended_at,
        documentId: session.document_id,
        durationMs: session.duration_ms,
        lastTranscriptEventAt: null, // Would need to be reconstructed from events
        lastDraftEventAt: null, // Would need to be reconstructed from events
        audio: audioMetadata, // Properly hydrated from filesystem
        transcript,
        draftExtraction,
        transport: transportState, // Properly hydrated from Postgres
        currentTranscriptId: transcriptId,
      };
    }));

    return hydratedSessions;
  }

  async writeSessions(sessions) {
    // Phase 6: Write to Postgres only (legacy filesystem writes removed)
    // Note: This is a simplified approach - individual session mutations
    // should use repository methods for better performance

    // Get existing sessions from Postgres to determine which are new vs updates
    let existingSessionIds = new Set();
    try {
      await this.liveSessionsRepo.initialize();
      const existingSessions = await this.liveSessionsRepo.query(`
        SELECT id FROM ${this.liveSessionsRepo.sessionsTableName}
      `);
      existingSessionIds = new Set(existingSessions.map(s => s.id));
    } catch (error) {
      this.log("Failed to fetch existing sessions from Postgres", { error: error.message });
    }

    for (const session of sessions) {
      try {
        const isNewSession = !existingSessionIds.has(session.id);
        const transcriptId = isNewSession ? null : await this.syncSessionTranscript(session);

        if (isNewSession) {
          // Create new session in Postgres - map UI status to DB status
          await this.liveSessionsRepo.createSession({
            id: session.id,
            status: mapUiStatusToDbStatus(session.status),
            linked_patient_label: session.linkedPatient || null,
            encounter_label: session.encounterLabel || null,
            document_id: session.documentId || null,
            duration_ms: session.durationMs || 0,
            transport_state_jsonb: buildPersistedTransportState(session.transport, session.status),
            draft_extraction_jsonb: session.draftExtraction || {},
            started_at: session.startedAt || null,
            ended_at: session.endedAt || null,
            created_by_user_id: session.createdBy?.id || null,
            current_transcript_id: null,
          });
          const createdTranscriptId = await this.syncSessionTranscript(session);
          if (createdTranscriptId) {
            await this.liveSessionsRepo.updateSession(session.id, {
              current_transcript_id: createdTranscriptId,
            });
          }
          await this.syncLiveSessionAudioAsset(session);
          this.log("Session created in Postgres", { id: session.id, uiStatus: session.status, dbStatus: mapUiStatusToDbStatus(session.status) });
        } else {
          // Update existing session in Postgres - map UI status to DB status
          await this.liveSessionsRepo.updateSession(session.id, {
            status: mapUiStatusToDbStatus(session.status),
            linked_patient_label: session.linkedPatient || null,
            encounter_label: session.encounterLabel || null,
            started_at: session.startedAt || null,
            ended_at: session.endedAt || null,
            document_id: session.documentId || null,
            duration_ms: session.durationMs || 0,
            transport_state_jsonb: buildPersistedTransportState(session.transport, session.status),
            draft_extraction_jsonb: session.draftExtraction || {},
            current_transcript_id: transcriptId || session.currentTranscriptId || null,
          });
          await this.syncLiveSessionAudioAsset(session);
          this.log("Session updated in Postgres", { id: session.id, uiStatus: session.status, dbStatus: mapUiStatusToDbStatus(session.status) });
        }
      } catch (error) {
        this.log("Failed to write session to Postgres", { id: session.id, error: error.message });
      }
    }
  }

  async mutateSessions(mutator) {
    const run = this.mutationQueue.then(async () => {
      // Phase 6: Read from Postgres, apply mutations, write back to Postgres
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
        durationMs: 0,
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
        workflowStatus: "draft",
      },
      ...params.overrides,
    };
  }

  async create(params = {}) {
    return this.queueMutation("store.create", null, async () => {
      const session = this.createSession(params);
      const createdSession = await this.persistSessionState(session, null, "store.create");
      this.log("Session created", { id: session.id });
      return createdSession;
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

  hasCapturedSessionData(session = null) {
    if (!session || typeof session !== "object") return false;
    if (Number(session?.audio?.chunkCount || 0) > 0) return true;
    if (Number(session?.audio?.totalBytes || 0) > 0) return true;
    if (Number(session?.durationMs || 0) > 0) return true;
    if ((session?.transcript?.segments?.length || 0) > 0) return true;
    return isMeaningfulTranscriptString(
      session?.transcript?.normalizedText
      || session?.transcript?.rawText
      || "",
    );
  }

  isStaleActiveSession(session = null, staleMs = 120000) {
    if (!session || typeof session !== "object") return false;
    if (session.endedAt || session.documentId) return false;

    const workflowStatus = String(session?.transport?.workflowStatus || "").trim().toLowerCase();
    const connectionState = String(session?.transport?.connectionState || "").trim().toLowerCase();
    const isPersistedLive = session.status === "live"
      || workflowStatus === "live"
      || connectionState === "connected";
    if (!isPersistedLive) return false;

    const referenceTime = session?.transport?.lastEventAt || session?.updatedAt || session?.startedAt;
    const referenceTimeMs = referenceTime ? new Date(referenceTime).getTime() : NaN;
    if (!Number.isFinite(referenceTimeMs)) return true;
    return (Date.now() - referenceTimeMs) > Math.max(1000, Number(staleMs || 0));
  }

  inferEndedAtForStaleSession(session = null) {
    if (!session || typeof session !== "object") {
      return new Date().toISOString();
    }

    const startedAtMs = session.startedAt ? new Date(session.startedAt).getTime() : NaN;
    const durationMs = Number(session.durationMs || 0);
    if (Number.isFinite(startedAtMs) && Number.isFinite(durationMs) && durationMs > 0) {
      return new Date(startedAtMs + durationMs).toISOString();
    }

    return session.updatedAt || new Date().toISOString();
  }

  async reconcileStaleActiveSessions(options = {}) {
    const staleMs = Number(options.staleMs || 120000);
    const source = options.source || "store.reconcileStaleActiveSessions";
    const sessions = await this.list();
    const repaired = [];

    for (const session of sessions) {
      if (!this.isStaleActiveSession(session, staleMs)) continue;

      if (this.hasCapturedSessionData(session)) {
        const endedAt = this.inferEndedAtForStaleSession(session);
        const updated = await this.setEndedState(session.id, {
          status: "review_required",
          endedAt,
          durationMs: Number(session.durationMs || 0),
          transport: {
            workflowStatus: "review_required",
          },
        }, {
          source,
        });
        repaired.push({
          id: session.id,
          action: "ended",
          status: updated?.status || "review_required",
        });
        continue;
      }

      const updated = await this.update(session.id, {
        __source: source,
        status: "draft",
        startedAt: null,
        endedAt: null,
        durationMs: 0,
        transport: {
          connectionState: "idle",
          workflowStatus: "draft",
          lastError: null,
          lastEventAt: new Date().toISOString(),
        },
      });
      repaired.push({
        id: session.id,
        action: "reset_to_draft",
        status: updated?.status || "draft",
      });
    }

    return repaired;
  }

  async createDraftSession(params = {}) {
    return this.create(params);
  }

  async setSessionStarted(sessionId, {
    startedAt = null,
    mimeType = null,
    transport = null,
    source = "ws.begin",
  } = {}) {
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;
      const nextSession = this.mergeSessionPatch(currentSession, {
        status: "live",
        startedAt: currentSession.startedAt || startedAt || new Date().toISOString(),
        endedAt: null,
        error: null,
        audio: mimeType ? { mimeType } : undefined,
        transport: {
          connectionState: "connected",
          lastError: null,
          lastEventAt: new Date().toISOString(),
          ...(transport || {}),
        },
      });
      return this.persistSessionState(nextSession, currentSession, source);
    });
  }

  async setTransportState(sessionId, transportPatch = {}, {
    status,
    source = "store.transport",
  } = {}) {
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;
      const nextSession = this.mergeSessionPatch(currentSession, {
        ...(status ? { status } : {}),
        transport: {
          ...(transportPatch || {}),
          lastEventAt: transportPatch?.lastEventAt || new Date().toISOString(),
        },
      });
      return this.persistSessionState(nextSession, currentSession, source);
    });
  }

  async incrementAudioStats(sessionId, chunkInfo = {}, source = "ws.chunk") {
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;

      const nowIso = new Date(chunkInfo.recordedAt || Date.now()).toISOString();
      const startedAt = currentSession.startedAt || (!currentSession.endedAt ? nowIso : null);
      const nextAudio = {
        ...(currentSession.audio || {}),
        chunkCount: Number(currentSession.audio?.chunkCount || 0) + 1,
        totalBytes: Number(currentSession.audio?.totalBytes || 0) + Number(chunkInfo.bytes || 0),
      };
      const nextSession = this.mergeSessionPatch(currentSession, {
        status: currentSession.status === "draft" && currentSession.transport?.connectionState === "connected"
          ? "live"
          : currentSession.status,
        startedAt,
        audio: nextAudio,
      });

      if ((nextSession.status === "live" || nextSession.transport?.connectionState === "connected") && nextSession.startedAt) {
        nextSession.durationMs = Math.max(
          Number(nextSession.durationMs || 0),
          Math.max(0, Date.now() - new Date(nextSession.startedAt).getTime()),
        );
      }
      nextSession.updatedAt = nowIso;

      return this.persistSessionState(nextSession, currentSession, source);
    });
  }

  async setFinalAudioAsset(sessionId, audioPatch = {}, {
    source = "route.audio.final",
  } = {}) {
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;
      const nextSession = this.mergeSessionPatch(currentSession, {
        durationMs: Number.isFinite(Number(audioPatch.durationMs)) && Number(audioPatch.durationMs) > 0
          ? Number(audioPatch.durationMs)
          : currentSession.durationMs,
        audio: {
          ...(audioPatch || {}),
        },
      });
      return this.persistSessionState(nextSession, currentSession, source);
    });
  }

  async setEndedState(sessionId, patch = {}, {
    source = "ws.end",
  } = {}) {
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;
      const nextSession = this.mergeSessionPatch(currentSession, {
        status: patch.status || "review_required",
        endedAt: currentSession.endedAt || patch.endedAt || new Date().toISOString(),
        durationMs: Number.isFinite(Number(patch.durationMs))
          ? Number(patch.durationMs)
          : currentSession.durationMs,
        audio: patch.audio || undefined,
        transport: {
          connectionState: "closed",
          lastError: null,
          lastEventAt: new Date().toISOString(),
          ...(patch.transport || {}),
        },
      });
      return this.persistSessionState(nextSession, currentSession, source);
    });
  }

  async setFinalizedState(sessionId, documentId, {
    source = "store.finalize",
  } = {}) {
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;
      const nextSession = this.mergeSessionPatch(currentSession, {
        status: "finalized",
        documentId,
        endedAt: currentSession.endedAt || new Date().toISOString(),
        transport: {
          connectionState: "closed",
          lastError: null,
          lastEventAt: new Date().toISOString(),
        },
      });
      return this.persistSessionState(nextSession, currentSession, source);
    });
  }

  async update(sessionId, updates = {}) {
    const source = updates?.__source || "store.update";
    const sanitizedUpdates = { ...(updates || {}) };
    delete sanitizedUpdates.__source;
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;
      const nextSession = this.mergeSessionPatch(currentSession, sanitizedUpdates);
      const persistedSession = await this.persistSessionState(nextSession, currentSession, source);
      this.log("Session updated", { id: sessionId, status: persistedSession?.status || nextSession.status, source });
      return persistedSession;
    });
  }

  async updateAudioChunk(sessionId, chunkInfo) {
    return this.incrementAudioStats(sessionId, chunkInfo, "ws.chunk");
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

  async replaceTranscript(sessionId, transcriptData = {}, options = {}) {
    const source = options?.source || "store.replaceTranscript";
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;
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
      const nextSession = this.mergeSessionPatch(currentSession, {
        transcript: {
        segments,
        rawText,
        normalizedText,
        interimText: String(transcriptData.interimText || ""),
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
        },
        sttBackend: transcriptData.backend || transcriptData.metadata?.backend || currentSession.sttBackend || null,
      });

      nextSession.lastTranscriptEventAt = rawText.trim()
        ? new Date().toISOString()
        : currentSession.lastTranscriptEventAt;

      return this.persistSessionState(nextSession, currentSession, source);
    });
  }

  async updateDraftExtraction(sessionId, draftData, options = {}) {
    const source = options?.source || "store.updateDraftExtraction";
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;
      const currentDraftExtraction = currentSession.draftExtraction || {
        extractedData: null,
        reviewItems: [],
        lastStableSegmentId: null,
      };
      const nextDraftExtraction = {
        ...currentDraftExtraction,
      };
      nextDraftExtraction.extractedData = mergeLiveDraft(
        currentDraftExtraction.extractedData || {},
        draftData && typeof draftData === "object" ? draftData : {},
      );
      const nextSession = this.mergeSessionPatch(currentSession, {
        draftExtraction: nextDraftExtraction,
      });
      nextSession.lastDraftEventAt = new Date().toISOString();
      return this.persistSessionState(nextSession, currentSession, source);
    });
  }

  async updateDraftLastStableSegmentId(sessionId, lastStableSegmentId, options = {}) {
    const source = options?.source || "store.updateDraftLastStableSegmentId";
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;
      const nextDraftExtraction = {
        ...(currentSession.draftExtraction || {
        extractedData: null,
        reviewItems: [],
        lastStableSegmentId: null,
        }),
      };
      nextDraftExtraction.lastStableSegmentId = lastStableSegmentId;
      const nextSession = this.mergeSessionPatch(currentSession, {
        draftExtraction: nextDraftExtraction,
      });
      return this.persistSessionState(nextSession, currentSession, source);
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

  async replaceReviewItems(sessionId, reviewItems = [], options = {}) {
    const source = options?.source || "store.replaceReviewItems";
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;
      const nextDraftExtraction = {
        ...(currentSession.draftExtraction || {
        extractedData: null,
        reviewItems: [],
        lastStableSegmentId: null,
        }),
      };
      nextDraftExtraction.reviewItems = Array.isArray(reviewItems) ? reviewItems : [];
      const nextSession = this.mergeSessionPatch(currentSession, {
        draftExtraction: nextDraftExtraction,
      });
      return this.persistSessionState(nextSession, currentSession, source);
    });
  }

  async resolveReviewItem(sessionId, reviewItemId, resolution, editedValue, options = {}) {
    const source = options?.source || "review.resolve";
    return this.queueMutation(source, sessionId, async (currentSession) => {
      if (!currentSession) return null;
      const nextDraftExtraction = {
        ...(currentSession.draftExtraction || {
          extractedData: null,
          reviewItems: [],
          lastStableSegmentId: null,
        }),
        reviewItems: Array.isArray(currentSession.draftExtraction?.reviewItems)
          ? currentSession.draftExtraction.reviewItems.map((item) => ({ ...item }))
          : [],
      };
      const item = nextDraftExtraction.reviewItems.find((reviewItem) => reviewItem.id === reviewItemId);
      if (item) {
        item.resolution = resolution;
        if (resolution === "edited" && editedValue) {
          item.editedValue = editedValue;
        }
      }
      const nextSession = this.mergeSessionPatch(currentSession, {
        draftExtraction: nextDraftExtraction,
      });
      return this.persistSessionState(nextSession, currentSession, source);
    });
  }

  async finalize(sessionId, documentId) {
    const finalizedSession = await this.setFinalizedState(sessionId, documentId, {
      source: "store.finalize",
    });
    if (finalizedSession) {
      this.log("Session finalized", { id: sessionId, documentId });
    }
    return finalizedSession;
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

  async deleteAudio(sessionId) {
    return this.queueMutation("store.deleteAudio", sessionId, async (currentSession) => {
      if (!currentSession) return null;

      await this.deleteSessionArtifacts(currentSession);
      await this.deleteLiveSessionAudioAssets(currentSession.id);

      const nextSession = this.mergeSessionPatch(currentSession, {
        audio: {
          combinedPath: null,
          totalBytes: 0,
          combinedSize: 0,
          chunkCount: 0,
        },
      });
      const persistedSession = await this.persistSessionState(nextSession, currentSession, "store.deleteAudio");
      this.log("Session audio deleted", { id: sessionId });
      return persistedSession;
    });
  }

  async setError(sessionId, error) {
    return this.update(sessionId, {
      __source: "store.error",
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
    return this.queueMutation("store.delete", sessionId, async (currentSession) => {
      if (!currentSession) return null;

      await this.deleteSessionArtifacts(currentSession);
      await this.deleteLiveSessionAudioAssets(currentSession.id);
      if (this.liveSessionsRepo?.deleteSession) {
        await this.liveSessionsRepo.initialize();
        await this.liveSessionsRepo.deleteSession(currentSession.id);
      }
      this.logMutationTrace("store.delete", currentSession, null);
      this.log("Session deleted", { id: sessionId });
      return currentSession;
    });
  }

  async hasEventsColumn() {
    if (typeof this._hasEventsColumn === "boolean") {
      return this._hasEventsColumn;
    }

    try {
      await this.liveSessionsRepo.initialize();
      const result = await this.liveSessionsRepo.queryOne(`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = 'events_jsonb'
        ) AS has_events_column
      `, [this.liveSessionsRepo.sessionsTableName]);
      this._hasEventsColumn = Boolean(result?.has_events_column);
    } catch (error) {
      this._hasEventsColumn = false;
      this.log("Failed to inspect live session events column", { error: error.message });
    }

    return this._hasEventsColumn;
  }

  async logEvent(sessionId, eventType, data = {}) {
    // Phase 6: Store events in session.events_jsonb array (not audit_events to avoid FK issues)
    try {
      await this.liveSessionsRepo.initialize();
      if (!(await this.hasEventsColumn())) {
        return;
      }

      const eventData = {
        timestamp: new Date().toISOString(),
        eventType: eventType,
        ...data
      };

      // Update the session's events_jsonb field by appending the new event
      await this.liveSessionsRepo.query(`
        UPDATE ${this.liveSessionsRepo.sessionsTableName}
        SET events_jsonb = COALESCE(events_jsonb, '[]'::jsonb) || $1::jsonb
        WHERE id = $2
      `, [JSON.stringify([eventData]), sessionId]);

      this.log("Event logged to Postgres", { sessionId, eventType });
    } catch (error) {
      this.log("Failed to log event to Postgres", { sessionId, eventType, error: error.message });
    }
  }

  async getEvents(sessionId, limit = 100) {
    // Phase 6: Retrieve events from session.events_jsonb array
    try {
      await this.liveSessionsRepo.initialize();
      if (!(await this.hasEventsColumn())) {
        return [];
      }

      // Get the session's events
      const sessions = await this.liveSessionsRepo.query(`
        SELECT events_jsonb FROM ${this.liveSessionsRepo.sessionsTableName}
        WHERE id = $1
      `, [sessionId]);

      if (!sessions || sessions.length === 0) {
        return [];
      }

      const eventsJson = sessions[0].events_jsonb;
      if (!eventsJson) {
        return [];
      }

      let events = [];
      if (typeof eventsJson === 'string') {
        events = JSON.parse(eventsJson);
      } else if (Array.isArray(eventsJson)) {
        events = eventsJson;
      }

      // Sort by timestamp descending and apply limit
      events.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

      return events.slice(0, limit || 100);
    } catch (error) {
      this.log("Failed to retrieve events from Postgres", { sessionId, error: error.message });
      return [];
    }
  }

  toPublicSession(session = {}) {
    if (!session || !session.id) return null;

    const transport = normalizeTransportState(session.transport, session.status);
    const hasTranscript = session.transcript?.segments?.length > 0
      || isMeaningfulTranscriptString(session.transcript?.rawText)
      || isMeaningfulTranscriptString(session.transcript?.normalizedText);
    const hasReviewItems = session.draftExtraction?.reviewItems?.length > 0;
    const uiStatus = isUiStatus(session.status)
      ? session.status
      : resolveSessionUiStatus({
          status: session.status,
          transport,
          hasTranscript,
          hasReviewItems,
          documentId: session.documentId,
          endedAt: session.endedAt,
        });

    return {
      id: session.id,
      status: uiStatus,
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
        durationMs: session.audio?.durationMs || 0,
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
      transport,
    };
  }
}

module.exports = LiveConversationStore;
