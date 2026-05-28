const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { WebSocketServer } = require("ws");

const LiveConversationSTTAgent = require("../agents/live_conversation_stt_agent.cjs");
const LiveConversationStore = require("./live_conversation_store.cjs");

class LiveConversationWebSocket {
  constructor(config = {}) {
    this.name = "LiveConversationWebSocket";
    this.version = "1.0.0";
    // Default to storage/ subdirectory relative to server directory
    const defaultStorageDir = path.join(__dirname, "..", "server", "storage");
    this.storageDir = config.storageDir || defaultStorageDir;
    this.store = new LiveConversationStore({ storageDir: this.storageDir });
    this.sttAgent = new LiveConversationSTTAgent({
      debug: config.debug || false,
    });

    this.sessions = new Map();
    this.chunkBuffer = new Map();
    this.transcriptBuffer = new Map();
    this.draftBuffer = new Map();
    this.chunkFlushTimers = new Map();
    this.sessionChunkFiles = new Map(); // Track chunk files for each session
    this.upgradeHandler = null;
    this.attachedServer = null;

    this.config = {
      pingInterval: Number(config.pingInterval || 30000),
      chunkFlushMs: Number(config.chunkFlushMs || 3000),
      maxBufferSize: Number(config.maxBufferSize || 5 * 1024 * 1024),
      enableDraftExtraction: config.enableDraftExtraction ?? true,
      draftExtractionInterval: Number(config.draftExtractionInterval || 15000),
      debug: config.debug || false,
      ...config,
    };

    this.draftTimers = new Map();
  }

  log(message, data = {}) {
    if (this.config.debug) {
      console.log(`[LiveConversationWS] ${message}`, data);
    }
  }

  isEmptySessionCapture(session) {
    return (session?.audio?.chunkCount || 0) === 0
      && (session?.transcript?.segments?.length || 0) === 0
      && !(session?.transcript?.rawText || "").trim()
      && !(session?.transcript?.normalizedText || "").trim();
  }

  isRecoverableLiveSession(session) {
    if (!session || session.status !== "live" || session.endedAt) return false;
    if (!this.isEmptySessionCapture(session)) return false;

    const referenceTime = session.startedAt || session.updatedAt;
    const startedAtMs = referenceTime ? new Date(referenceTime).getTime() : NaN;
    if (!Number.isFinite(startedAtMs)) return true;

    return (Date.now() - startedAtMs) > 15000;
  }

  isRecoverableDraftTransportSession(session) {
    if (!session || session.status !== "draft") return false;
    if (session.transport?.connectionState !== "connected") return false;
    if (!this.isEmptySessionCapture(session)) return false;

    const referenceTime = session.transport?.lastEventAt || session.updatedAt;
    const timestampMs = referenceTime ? new Date(referenceTime).getTime() : NaN;
    if (!Number.isFinite(timestampMs)) return true;

    return (Date.now() - timestampMs) > 15000;
  }

  sendJson(ws, payload) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  sendError(ws, error) {
    this.sendJson(ws, {
      type: "session.error",
      error: String(error),
      timestamp: new Date().toISOString(),
    });
  }

  getAudioExtension(mimeType = "audio/webm") {
    const normalized = String(mimeType || "").toLowerCase();
    if (normalized.includes("mp4") || normalized.includes("m4a")) return ".mp4";
    if (normalized.includes("mpeg") || normalized.includes("mp3")) return ".mp3";
    if (normalized.includes("ogg")) return ".ogg";
    return ".webm";
  }

  hasMeaningfulDraft(draft = null) {
    if (!draft || typeof draft !== "object") return false;
    return Boolean(
      String(draft.diagnosis || "").trim()
      || (Array.isArray(draft.symptoms) && draft.symptoms.length > 0)
      || (Array.isArray(draft.medications) && draft.medications.length > 0)
      || (Array.isArray(draft.labs) && draft.labs.length > 0)
      || (Array.isArray(draft.radiology) && draft.radiology.length > 0)
      || (Array.isArray(draft.procedures) && draft.procedures.length > 0)
      || (Array.isArray(draft.followUp) && draft.followUp.length > 0)
      || (Array.isArray(draft.plan) && draft.plan.length > 0)
    );
  }

  shouldBackfillTranscript(session) {
    const transcriptText = String(
      session?.transcript?.normalizedText
      || session?.transcript?.rawText
      || "",
    ).trim();
    const segmentCount = session?.transcript?.segments?.length || 0;
    return segmentCount === 0 || transcriptText.length < 40;
  }

  normalizeDraftText(value) {
    return String(value || "")
      .replace(/\bthis is a conversation between the doctor and the patient\b[:,-]?\s*/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  cleanDraftPhrase(value) {
    return this.normalizeDraftText(value)
      .replace(/^[,.;:\-\s]+/, "")
      .replace(/[,.;:\-\s]+$/, "")
      .trim();
  }

  dedupeDraftStrings(items = []) {
    const seen = new Set();
    const ordered = [];
    for (const item of items) {
      const cleaned = this.cleanDraftPhrase(item);
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(cleaned);
    }
    return ordered;
  }

  truncateAtDraftBoundary(value) {
    return this.cleanDraftPhrase(String(value || "").split(
      /\b(?:also take|also start|also continue|i will review|we will review|follow up|come back|take care|good night|goodbye|bye|don't worry|do not worry)\b/i,
    )[0]);
  }

  extractSymptomsFromTranscript(transcript) {
    const normalized = this.normalizeDraftText(transcript);
    const symptoms = [];
    const add = (value) => {
      const cleaned = this.cleanDraftPhrase(value);
      if (cleaned) symptoms.push(cleaned);
    };

    const keywordPatterns = [
      [/chest pain/gi, "Chest pain"],
      [/pain in (?:my|your) chest|pain in chest/gi, "Chest pain"],
      [/sharp pain/gi, "Sharp pain"],
      [/fever/gi, "Fever"],
      [/cough(?:ing)?/gi, "Cough"],
      [/nause(?:a|ous)/gi, "Nausea"],
      [/vomit(?:ing)?/gi, "Vomiting"],
      [/headache/gi, "Headache"],
      [/body ache|body pain/gi, "Body ache"],
      [/shortness of breath|breathlessness|difficulty breathing/gi, "Shortness of breath"],
      [/sore throat/gi, "Sore throat"],
      [/fatigue|tired(?:ness)?/gi, "Fatigue"],
      [/dizziness|lightheaded(?:ness)?/gi, "Dizziness"],
      [/abdominal pain|stomach pain/gi, "Abdominal pain"],
      [/diarrhea|loose stools/gi, "Diarrhea"],
      [/palpitations/gi, "Palpitations"],
    ];

    for (const [pattern, label] of keywordPatterns) {
      if (pattern.test(normalized)) add(label);
    }

    const feverSinceMatch = normalized.match(/fever since ([a-z0-9\s-]{1,30}?)(?:\b(?:oh|okay|and|but|i|doctor)\b|$)/i);
    if (feverSinceMatch?.[1]) {
      add(`Fever since ${this.cleanDraftPhrase(feverSinceMatch[1])}`);
    }

    const feelMatch = normalized.match(/feel(?:ing)? ([a-z0-9\s'-]{1,30}?)(?:\b(?:and|but|i|doctor|okay)\b|$)/i);
    if (feelMatch?.[1]) {
      add(this.cleanDraftPhrase(feelMatch[1]).charAt(0).toUpperCase() + this.cleanDraftPhrase(feelMatch[1]).slice(1));
    }

    const worseWhenMatch = normalized.match(/worse when ([^.?!]{1,80})/i);
    if (worseWhenMatch?.[1]) {
      const phrase = this.cleanDraftPhrase(worseWhenMatch[1]).replace(/^i(?:'m| am)\s+/i, "");
      if (phrase) add(`Worse when ${phrase}`);
    }

    return this.dedupeDraftStrings(symptoms);
  }

  inferDiagnosisFromTranscript(transcript, symptoms = []) {
    const normalized = this.normalizeDraftText(transcript);
    const explicitPatterns = [
      /(?:you have|looks like|this is|assessment[:\-]?|diagnosis[:\-]?)([^.?!]+)/i,
    ];

    for (const pattern of explicitPatterns) {
      const match = normalized.match(pattern);
      if (!match?.[1]) continue;
      const diagnosis = this.truncateAtDraftBoundary(match[1]);
      if (diagnosis) {
        return diagnosis.charAt(0).toUpperCase() + diagnosis.slice(1);
      }
    }

    const lowerSymptoms = symptoms.map((item) => item.toLowerCase());
    if (lowerSymptoms.some((item) => item.includes("fever"))) return "Fever";
    if (lowerSymptoms.some((item) => item.includes("chest pain"))) return "Chest pain under evaluation";
    if (lowerSymptoms.some((item) => item.includes("cough"))) return "Upper respiratory symptoms";
    return "";
  }

  extractMedicationsFromTranscript(transcript) {
    const normalized = this.normalizeDraftText(transcript)
      .replace(/\balso take\b/gi, ". take")
      .replace(/\balso start\b/gi, ". start")
      .replace(/\balso continue\b/gi, ". continue")
      .replace(/\bthen take\b/gi, ". take")
      .replace(/\bthen start\b/gi, ". start");

    const sentences = normalized
      .split(/(?<=[.!?])\s+/)
      .map((item) => this.cleanDraftPhrase(item))
      .filter(Boolean);

    const stopNames = new Set(["care", "food", "anything", "temperature", "rest", "water"]);
    const medications = [];

    for (const sentence of sentences) {
      const medicationRegex = /(?:giving you(?:\s+a\s+medicine)?|prescribe(?:d)?|start|take|continue|use)\s+([a-z][a-z0-9/-]*)(?:\s+(\d+(?:\.\d+)?(?:\s*(?:mg|mcg|g|ml))?))?([\s\S]*?)(?=\b(?:giving you(?:\s+a\s+medicine)?|prescribe(?:d)?|start|take|continue|use)\b|[.!?]|$)/gi;
      let match;
      while ((match = medicationRegex.exec(sentence)) !== null) {
        const baseName = this.cleanDraftPhrase(match[1]);
        if (!baseName || stopNames.has(baseName.toLowerCase())) continue;

        const dose = this.cleanDraftPhrase(match[2] || "");
        const instruction = this.truncateAtDraftBoundary(match[3] || "");
        const displayName = this.cleanDraftPhrase([baseName, dose].filter(Boolean).join(" "));

        medications.push({
          name: displayName.charAt(0).toUpperCase() + displayName.slice(1),
          instruction: instruction || "As directed",
          status: "draft",
        });
      }
    }

    const seen = new Set();
    return medications.filter((item) => {
      const key = `${item.name}::${item.instruction}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  extractFollowUpFromTranscript(transcript) {
    const normalized = this.normalizeDraftText(transcript);
    const followUp = [];
    const regex = /(?:review(?: you)?|follow(?: |-)?up|come back|see me|return)\s+(?:again\s+)?(?:after|in)\s+([^.!?]+)/gi;
    let match;
    while ((match = regex.exec(normalized)) !== null) {
      const phrase = this.truncateAtDraftBoundary(match[1]);
      if (phrase) {
        followUp.push(`Review after ${phrase}`);
      }
    }
    return this.dedupeDraftStrings(followUp);
  }

  buildFallbackPlan(draft) {
    const plan = [];
    for (const medication of draft.medications || []) {
      const instruction = this.cleanDraftPhrase(medication.instruction || "");
      plan.push(instruction ? `Take ${medication.name}: ${instruction}` : `Take ${medication.name}`);
    }
    for (const followUp of draft.followUp || []) {
      plan.push(followUp);
    }
    return this.dedupeDraftStrings(plan);
  }

  buildFallbackDraftExtraction(transcript) {
    const symptoms = this.extractSymptomsFromTranscript(transcript);
    const medications = this.extractMedicationsFromTranscript(transcript);
    const followUp = this.extractFollowUpFromTranscript(transcript);
    const diagnosis = this.inferDiagnosisFromTranscript(transcript, symptoms);

    const draft = {
      diagnosis,
      symptoms,
      medications,
      labs: [],
      radiology: [],
      procedures: [],
      followUp,
      plan: [],
    };

    draft.plan = this.buildFallbackPlan(draft);
    return draft;
  }

  async backfillFinalTranscriptAndDraft(sessionId, combinedAudioPath) {
    if (!combinedAudioPath) return;

    let session = await this.store.get(sessionId);
    if (!session) return;

    if (this.shouldBackfillTranscript(session)) {
      try {
        const result = await this.sttAgent.execute({
          audioPath: combinedAudioPath,
          options: {
            mode: "fixed_window_no_vad",
            windowSeconds: 15,
            enableSpeakerDiarization: false,
            skipValidation: true,
            mimeType: session.audio?.mimeType,
          },
        });

        const transcriptData = result?.data && (
          String(result.data.normalizedText || result.data.rawText || "").trim()
        )
          ? result.data
          : null;

        if (transcriptData) {
          await this.store.replaceTranscript(sessionId, transcriptData);
          await this.store.logEvent(sessionId, "final_transcript_backfilled", {
            backend: result.backend || result?.data?.metadata?.backend || null,
            segmentCount: transcriptData.segments?.length || 0,
          });
          session = await this.store.get(sessionId);
        }
      } catch (error) {
        this.log("Final transcript backfill error", { sessionId, error: error.message });
      }
    }

    const transcriptText = String(
      session?.transcript?.normalizedText
      || session?.transcript?.rawText
      || "",
    ).trim();

    if (transcriptText.length < 20 || this.hasMeaningfulDraft(session?.draftExtraction?.extractedData)) {
      return;
    }

    try {
      const draft = await this.generateDraftExtraction(transcriptText, session);
      if (this.hasMeaningfulDraft(draft)) {
        await this.store.updateDraftExtraction(sessionId, draft);
        await this.store.logEvent(sessionId, "final_draft_backfilled", {
          diagnosis: draft.diagnosis || "",
        });
      }
    } catch (error) {
      this.log("Final draft backfill error", { sessionId, error: error.message });
    }
  }

  async handleConnection(ws, req, authService) {
    // Extract sessionId from URL pathname (e.g., /api/voice/live/sessions/abc-123/stream)
    const pathname = new URL(req.url, "http://dummy").pathname;
    const match = pathname.match(/\/api\/voice\/live\/sessions\/([^/]+)\/stream/);
    const sessionId = match ? match[1] : null;

    if (!sessionId) {
      ws.close(1008, "Missing sessionId");
      return;
    }

    this.log("Connection attempt", { sessionId, pathname });

    const authResult = await this.authenticate(ws, req, authService);
    if (!authResult.success) {
      ws.close(1008, authResult.error);
      return;
    }

    const session = await this.store.get(sessionId);
    if (!session) {
      this.sendError(ws, "Session not found");
      ws.close(1008, "Session not found");
      return;
    }

    const currentSession = this.isRecoverableLiveSession(session)
      ? await this.store.update(sessionId, {
        status: "draft",
        startedAt: null,
        transport: {
          connectionState: "idle",
          lastError: null,
          lastEventAt: new Date().toISOString(),
        },
      })
      : this.isRecoverableDraftTransportSession(session)
        ? await this.store.update(sessionId, {
          transport: {
            connectionState: "idle",
            lastError: null,
            lastEventAt: new Date().toISOString(),
          },
        })
        : session;

    // Enforce ownership check
    const userId = authResult.user?.id || authResult.user?.username;
    if (currentSession.createdBy?.id !== userId && authResult.user?.role !== "admin") {
      this.sendError(ws, "Forbidden");
      ws.close(1003, "Forbidden");
      return;
    }

    if (["finalized", "failed"].includes(currentSession.status)) {
      this.sendError(ws, `Session is ${currentSession.status}`);
      ws.close(1000, `Session is ${currentSession.status}`);
      return;
    }

    this.sessions.set(sessionId, ws);
    this.chunkBuffer.set(sessionId, []);
    this.transcriptBuffer.set(sessionId, []);

    const updates = {
      transport: {
        connectionState: "connected",
        lastError: null,
        lastEventAt: new Date().toISOString(),
      },
    };

    await this.store.update(sessionId, updates);

    this.sendJson(ws, {
      type: "session.ready",
      sessionId,
      status: currentSession.status,
      timestamp: new Date().toISOString(),
    });

    await this.store.logEvent(sessionId, "websocket_connected", {
      userAgent: req.headers["user-agent"],
      recoveredFromStaleLive: currentSession.status === "draft" && session.status === "live",
    });

    // Only start live processing for an already-active session.
    if (currentSession.status === "live") {
      this.startChunkFlush(sessionId);
      this.startDraftExtraction(sessionId);
    }

    ws.on("message", async (data, isBinary) => {
      await this.handleMessage(sessionId, ws, data, isBinary, authResult.user);
    });

    ws.on("close", async (code, reason) => {
      await this.handleClose(sessionId, ws, code, reason);
    });

    ws.on("error", async (error) => {
      this.log("WebSocket error", { sessionId, error: error.message });
      await this.store.setError(sessionId, `WebSocket error: ${error.message}`);
    });

    this.startPing(ws);
  }

  async authenticate(ws, req, authService) {
    try {
      const user = await authService.authenticateFromRequest(req);
      if (!user) {
        return { success: false, error: "Unauthorized" };
      }
      return { success: true, user };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleMessage(sessionId, ws, data, isBinary, user) {
    if (isBinary) {
      await this.handleAudioChunk(sessionId, data);
      return;
    }

    try {
      const message = JSON.parse(data.toString());
      this.log("Message received", { sessionId, type: message.type });

      switch (message.type) {
        case "audio.chunk":
          await this.handleAudioChunkMessage(sessionId, message);
          break;
        case "session.begin":
          await this.handleBegin(sessionId, message);
          break;
        case "session.pause":
          await this.handlePause(sessionId);
          break;
        case "session.resume":
          await this.handleResume(sessionId);
          break;
        case "session.end":
          await this.handleEnd(sessionId);
          break;
        case "ping":
          this.sendJson(ws, { type: "pong", timestamp: new Date().toISOString() });
          break;
        default:
          this.log("Unknown message type", { sessionId, type: message.type });
      }
    } catch (error) {
      this.log("Message handling error", { sessionId, error: error.message });
    }
  }

  async handleAudioChunk(sessionId, buffer) {
    const chunks = this.chunkBuffer.get(sessionId) || [];
    chunks.push({ buffer, timestamp: Date.now() });

    const totalSize = chunks.reduce((sum, c) => sum + c.buffer.length, 0);
    if (totalSize > this.config.maxBufferSize) {
      this.log("Buffer overflow", { sessionId, totalSize });
      this.chunkBuffer.set(sessionId, []);
    }

    this.chunkBuffer.set(sessionId, chunks);

    await this.store.updateAudioChunk(sessionId, { bytes: buffer.length });

    // Log every 10 chunks for debugging
    if (chunks.length % 10 === 0) {
      console.log(`[LiveConversationWS] Session ${sessionId}: received ${chunks.length} chunks, total size: ${totalSize} bytes`);
    }
  }

  async handleAudioChunkMessage(sessionId, message) {
    if (message.data) {
      const buffer = Buffer.isBuffer(message.data)
        ? message.data
        : Buffer.from(message.data, "base64");
      await this.handleAudioChunk(sessionId, buffer);
    }
  }

  async flushAudioBuffer(sessionId) {
    const chunks = this.chunkBuffer.get(sessionId) || [];
    if (chunks.length === 0) return null;

    console.log(`[LiveConversationWS] Flushing audio buffer for session ${sessionId}: ${chunks.length} chunks`);

    this.chunkBuffer.set(sessionId, []);

    const combined = Buffer.concat(chunks.map((c) => c.buffer));
    const tempDir = path.join(this.storageDir, "live_conversation_temp");
    await fsp.mkdir(tempDir, { recursive: true });

    const session = await this.store.get(sessionId);
    const extension = this.getAudioExtension(session?.audio?.mimeType);
    const chunkPath = path.join(tempDir, `${sessionId}-${Date.now()}${extension}`);
    await fsp.writeFile(chunkPath, combined);

    console.log(`[LiveConversationWS] Wrote chunk file: ${chunkPath}, size: ${combined.length} bytes`);

    // Track chunk files for this session for later combination
    const chunkFiles = this.sessionChunkFiles.get(sessionId) || [];
    chunkFiles.push(chunkPath);
    this.sessionChunkFiles.set(sessionId, chunkFiles);

    return chunkPath;
  }

  async transcribeChunk(sessionId, chunkPath) {
    const ws = this.sessions.get(sessionId);
    if (!ws || ws.readyState !== ws.OPEN) return;

    try {
      console.log(`[LiveConversationWS] Starting transcription for session ${sessionId}`, { chunkPath });
      this.log("Starting transcription", { sessionId, chunkPath });
      const result = await this.sttAgent.execute({
        audioPath: chunkPath,
        options: {
          mode: "fixed_window_no_vad",
          windowSeconds: 10, // Increase window for better transcription
          enableSpeakerDiarization: false,
          skipValidation: true,
        },
      });

      console.log(`[LiveConversationWS] Transcription result for session ${sessionId}`, {
        success: result.success,
        hasData: !!result.data,
        chunks: result.data?.chunks?.length || 0,
        error: result.error
      });
      this.log("Transcription result", { sessionId, success: result.success, hasData: !!result.data });

      if (result.success && result.data?.chunks) {
        console.log(`[LiveConversationWS] Processing ${result.data.chunks.length} chunks for session ${sessionId}`);
        for (const chunk of result.data.chunks) {
          if (chunk.success && chunk.transcript) {
            console.log(`[LiveConversationWS] Sending transcript segment for session ${sessionId}`, {
              text: chunk.transcript.substring(0, 50),
              startSeconds: chunk.startSeconds,
              endSeconds: chunk.endSeconds
            });
            // When speaker diarization is disabled, mark as unknown instead of hardcoding as doctor
            const segment = {
              id: `seg-${sessionId}-${Date.now()}-${chunk.chunkIndex}`,
              speakerId: "spk_0",
              speakerRole: "unknown",
              speakerLabel: "Unknown",
              startLabel: chunk.startLabel,
              endLabel: chunk.endLabel,
              startSeconds: chunk.startSeconds,
              endSeconds: chunk.endSeconds,
              text: chunk.transcript,
              normalizedText: chunk.transcript,
              confidence: 0.85,
              flags: ["live_stream", "speaker_unknown"],
              status: "final",
            };

            await this.store.appendTranscriptSegment(sessionId, segment);

            this.sendJson(ws, {
              type: "transcript.final",
              sessionId,
              segment,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } else if (result.error) {
        this.log("Transcription failed", { sessionId, error: result.error });
      }
    } catch (error) {
      this.log("Transcription error", { sessionId, error: error.message, stack: error.stack });
    }

    // Don't delete chunk files - they will be combined at the end for playback
  }

  async combineAudioChunks(sessionId) {
    const chunkFiles = this.sessionChunkFiles.get(sessionId) || [];
    if (chunkFiles.length === 0) return null;

    try {
      // Read all chunk files and combine them
      const chunks = await Promise.all(
        chunkFiles.map(async (chunkPath) => {
          try {
            return await fsp.readFile(chunkPath);
          } catch {
            return null;
          }
        })
      );

      const validChunks = chunks.filter((c) => c !== null);
      if (validChunks.length === 0) return null;

      const combined = Buffer.concat(validChunks);

      // Save combined audio to permanent location
      const audioDir = path.join(this.storageDir, "live_conversation_audio");
      await fsp.mkdir(audioDir, { recursive: true });

      const session = await this.store.get(sessionId);
      const extension = this.getAudioExtension(session?.audio?.mimeType);
      const audioPath = path.join(audioDir, `${sessionId}${extension}`);
      await fsp.writeFile(audioPath, combined);

      // Clean up temp chunk files
      for (const chunkPath of chunkFiles) {
        try {
          await fsp.unlink(chunkPath);
        } catch {}
      }
      this.sessionChunkFiles.set(sessionId, []);

      return audioPath;
    } catch (error) {
      this.log("Error combining audio chunks", { sessionId, error: error.message });
      return null;
    }
  }

  startChunkFlush(sessionId) {
    // Clear any existing timer for this session
    if (this.chunkFlushTimers.has(sessionId)) {
      clearInterval(this.chunkFlushTimers.get(sessionId));
    }

    console.log(`[LiveConversationWS] Starting chunk flush for session ${sessionId}, interval: ${this.config.chunkFlushMs}ms`);

    const interval = setInterval(async () => {
      const ws = this.sessions.get(sessionId);
      const session = await this.store.get(sessionId);

      // Stop if session closed, finalized, or failed
      if (!ws || ws.readyState !== ws.OPEN || !session ||
          ["finalized", "failed"].includes(session.status)) {
        console.log(`[LiveConversationWS] Stopping chunk flush for session ${sessionId}`);
        clearInterval(interval);
        this.chunkFlushTimers.delete(sessionId);
        return;
      }

      // Only flush when session is live (not paused)
      if (session.status === "live") {
        console.log(`[LiveConversationWS] Session ${sessionId} is live, flushing buffer...`);
        const chunkPath = await this.flushAudioBuffer(sessionId);
        if (chunkPath) {
          await this.transcribeChunk(sessionId, chunkPath);
        }
      } else {
        console.log(`[LiveConversationWS] Session ${sessionId} status is ${session.status}, skipping flush`);
      }
    }, this.config.chunkFlushMs);

    this.chunkFlushTimers.set(sessionId, interval);
    return interval;
  }

  async handlePause(sessionId) {
    const ws = this.sessions.get(sessionId);
    await this.store.update(sessionId, { status: "paused" });

    this.sendJson(ws, {
      type: "session.state",
      sessionId,
      status: "paused",
      timestamp: new Date().toISOString(),
    });

    await this.store.logEvent(sessionId, "session_paused");
  }

  async handleResume(sessionId) {
    const ws = this.sessions.get(sessionId);
    await this.store.update(sessionId, { status: "live" });

    this.sendJson(ws, {
      type: "session.state",
      sessionId,
      status: "live",
      timestamp: new Date().toISOString(),
    });

    await this.store.logEvent(sessionId, "session_resumed");

    // Restart draft extraction after resume
    this.startDraftExtraction(sessionId);
  }

  async handleBegin(sessionId, message = {}) {
    const ws = this.sessions.get(sessionId);
    const session = await this.store.get(sessionId);
    if (!session) return;

    if (session.status === "live") {
      this.sendJson(ws, {
        type: "session.state",
        sessionId,
        status: "live",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const startedAt = session.startedAt || new Date().toISOString();
    const mimeType = typeof message.mimeType === "string" && message.mimeType.trim()
      ? message.mimeType.trim()
      : session.audio?.mimeType || "audio/webm";
    await this.store.update(sessionId, {
      status: "live",
      startedAt,
      endedAt: null,
      error: null,
      audio: {
        ...(session.audio || {}),
        mimeType,
      },
      transport: {
        connectionState: "connected",
        lastError: null,
        lastEventAt: new Date().toISOString(),
      },
    });

    this.sendJson(ws, {
      type: "session.state",
      sessionId,
      status: "live",
      timestamp: new Date().toISOString(),
    });

    await this.store.logEvent(sessionId, "session_started");
    this.startChunkFlush(sessionId);
    this.startDraftExtraction(sessionId);
  }

  async handleEnd(sessionId) {
    const ws = this.sessions.get(sessionId);

    const chunkPath = await this.flushAudioBuffer(sessionId);
    if (chunkPath) {
      await this.transcribeChunk(sessionId, chunkPath);
    }

    // Combine all audio chunks into a single file for playback
    const combinedAudioPath = await this.combineAudioChunks(sessionId);
    await this.backfillFinalTranscriptAndDraft(sessionId, combinedAudioPath);

    const currentSession = await this.store.get(sessionId);

    await this.store.update(sessionId, {
      status: "review_required",
      endedAt: new Date().toISOString(),
      audio: {
        ...(currentSession?.audio || {}),
        combinedPath: combinedAudioPath || currentSession?.audio?.combinedPath || null,
      },
    });

    this.sendJson(ws, {
      type: "session.state",
      sessionId,
      status: "review_required",
      timestamp: new Date().toISOString(),
    });

    await this.store.logEvent(sessionId, "session_ended");

    setTimeout(() => {
      if (ws.readyState === ws.OPEN) {
        ws.close(1000, "Session ended");
      }
    }, 500);
  }

  async handleClose(sessionId, ws, code, reason) {
    this.sessions.delete(sessionId);
    this.chunkBuffer.delete(sessionId);
    this.transcriptBuffer.delete(sessionId);

    // Clear the chunk flush timer
    if (this.chunkFlushTimers.has(sessionId)) {
      clearInterval(this.chunkFlushTimers.get(sessionId));
      this.chunkFlushTimers.delete(sessionId);
    }

    if (this.draftTimers.has(sessionId)) {
      clearInterval(this.draftTimers.get(sessionId));
      this.draftTimers.delete(sessionId);
    }

    const session = await this.store.get(sessionId);
    if (session) {
      if (this.isRecoverableLiveSession(session)) {
        await this.store.update(sessionId, {
          status: "draft",
          startedAt: null,
          transport: {
            connectionState: "idle",
            lastError: null,
            lastEventAt: new Date().toISOString(),
          },
        });
      } else if (session.status === "draft") {
        await this.store.update(sessionId, {
          transport: {
            connectionState: "idle",
            lastError: null,
            lastEventAt: new Date().toISOString(),
          },
        });
      } else {
        await this.store.update(sessionId, {
          transport: {
            connectionState: "closed",
            lastError: null,
            lastEventAt: new Date().toISOString(),
          },
        });
      }
    }

    await this.store.logEvent(sessionId, "websocket_disconnected", {
      code,
      reason: reason?.toString || "Unknown",
    });

    this.log("Connection closed", { sessionId, code });
  }

  startPing(ws) {
    const interval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.ping();
      } else {
        clearInterval(interval);
      }
    }, this.config.pingInterval);
  }

  async startDraftExtraction(sessionId) {
    if (!this.config.enableDraftExtraction) return;

    // Clear any existing draft timer for this session before starting a new one
    if (this.draftTimers.has(sessionId)) {
      clearInterval(this.draftTimers.get(sessionId));
      this.draftTimers.delete(sessionId);
    }

    const ws = this.sessions.get(sessionId);
    const timer = setInterval(async () => {
      const currentSession = await this.store.get(sessionId);
      if (!currentSession || currentSession.status !== "live") {
        clearInterval(timer);
        this.draftTimers.delete(sessionId);
        return;
      }

      const segments = currentSession.transcript?.segments || [];
      if (segments.length === 0) return;

      const lastStableId = currentSession.draftExtraction?.lastStableSegmentId;
      const newSegments = lastStableId
        ? segments.filter((s) => {
            const lastIdx = segments.findIndex((seg) => seg.id === lastStableId);
            const currentIdx = segments.findIndex((seg) => seg.id === s.id);
            return currentIdx > lastIdx;
          })
        : segments;

      if (newSegments.length === 0) return;

      const transcript = newSegments.map((s) => s.text).join(" ");
      if (transcript.length < 50) return;

      try {
        const draft = await this.generateDraftExtraction(transcript, currentSession);

        // Use atomic update to avoid race conditions
        await this.store.updateDraftExtraction(sessionId, draft);
        await this.store.updateDraftLastStableSegmentId(
          sessionId,
          segments[segments.length - 1]?.id,
        );

        this.sendJson(ws, {
          type: "draft.updated",
          sessionId,
          draft,
          timestamp: new Date().toISOString(),
        });

        await this.store.logEvent(sessionId, "draft_updated", {
          segmentCount: newSegments.length,
        });
      } catch (error) {
        this.log("Draft extraction error", { sessionId, error: error.message });
      }
    }, this.config.draftExtractionInterval);

    this.draftTimers.set(sessionId, timer);
  }

  async generateDraftExtraction(transcript, session) {
    const prompt = `Extract clinical information from this transcript of a doctor-patient conversation:

TRANSCRIPT:
${transcript}

Extract and return JSON only (no markdown):
{
  "diagnosis": "brief assessment or empty string",
  "symptoms": ["list of symptoms mentioned"],
  "medications": [
    { "name": "medication name", "instruction": "dosage and instructions", "status": "draft" }
  ],
  "labs": ["lab tests ordered"],
  "radiology": ["imaging ordered"],
  "procedures": ["procedures mentioned"],
  "followUp": ["follow-up instructions"],
  "plan": ["action items"]
}`;

    try {
      const response = await fetch(process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 2048,
        }),
      });

      if (!response.ok) {
        throw new Error(`Draft extraction failed: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "{}";

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      const draft = {
        diagnosis: extracted.diagnosis || "",
        symptoms: Array.isArray(extracted.symptoms) ? extracted.symptoms : [],
        medications: Array.isArray(extracted.medications) ? extracted.medications : [],
        labs: Array.isArray(extracted.labs) ? extracted.labs : [],
        radiology: Array.isArray(extracted.radiology) ? extracted.radiology : [],
        procedures: Array.isArray(extracted.procedures) ? extracted.procedures : [],
        followUp: Array.isArray(extracted.followUp) ? extracted.followUp : [],
        plan: Array.isArray(extracted.plan) ? extracted.plan : [],
      };

      if (this.hasMeaningfulDraft(draft)) {
        return draft;
      }

      this.log("Draft extraction returned no structured content, using fallback", {
        sessionId: session?.id,
      });
    } catch (error) {
      this.log("Draft extraction model request failed, using fallback", {
        sessionId: session?.id,
        error: error.message,
      });
    }

    return this.buildFallbackDraftExtraction(transcript);
  }

  attach(server, authService) {
    // ws library doesn't support wildcard paths - use noServer and handle upgrade manually
    this.wss = new WebSocketServer({ noServer: true });
    this.attachedServer = server;

    // Handle HTTP upgrade events for our WebSocket route
    this.upgradeHandler = (req, socket, head) => {
      const pathname = new URL(req.url, "http://dummy").pathname;

      // Check if this is a live conversation session WebSocket upgrade
      if (pathname.startsWith("/api/voice/live/sessions/") && pathname.endsWith("/stream")) {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit("connection", ws, req);
        });
      }
    };

    server.on("upgrade", this.upgradeHandler);

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req, authService);
    });

    this.log("WebSocket server attached", {
      route: "/api/voice/live/sessions/:sessionId/stream (manual routing)",
    });
  }

  async shutdown() {
    // Remove the upgrade event listener to prevent memory leaks
    if (this.attachedServer && this.upgradeHandler) {
      this.attachedServer.off("upgrade", this.upgradeHandler);
      this.upgradeHandler = null;
      this.attachedServer = null;
    }

    for (const [sessionId, timer] of this.draftTimers.entries()) {
      clearInterval(timer);
    }
    this.draftTimers.clear();

    for (const [sessionId, timer] of this.chunkFlushTimers.entries()) {
      clearInterval(timer);
    }
    this.chunkFlushTimers.clear();

    this.wss?.close();
    this.log("WebSocket server shut down");
  }
}

module.exports = LiveConversationWebSocket;
