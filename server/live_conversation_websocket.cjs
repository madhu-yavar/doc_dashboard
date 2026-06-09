const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { WebSocketServer } = require("ws");

const LiveConversationSTTAgent = require("../agents/live_conversation_stt_agent.cjs");
const LiveConversationStore = require("./live_conversation_store.cjs");
const GemmaClientTool = require("../tools/llm/gemma_client.tool.cjs");
const GeminiClientTool = require("../tools/llm/gemini_client.tool.cjs");
const {
  buildRequiredReviewItems,
  mergeLiveDraft,
  mergeRequiredReviewItems,
  normalizeGender,
  normalizeLiveDraft,
} = require("./live_conversation_draft.cjs");

class LiveConversationWebSocket {
  constructor(config = {}) {
    this.name = "LiveConversationWebSocket";
    this.version = "1.0.0";
    // Default to storage/ subdirectory relative to server directory
    const defaultStorageDir = path.join(__dirname, "..", "server", "storage");
    this.storageDir = config.storageDir || defaultStorageDir;
    this.store = new LiveConversationStore({
      storageDir: this.storageDir,
      transcriptsRepository: config.transcriptsRepository || null,
      docsRepository: config.docsRepository || null,
    });
    this.sttAgent = new LiveConversationSTTAgent({
      debug: config.debug || false,
    });
    this.gemmaClient = new GemmaClientTool({
      ...(config.gemma || {}),
      timeout: Number(config.gemma?.timeout || process.env.GEMMA_TIMEOUT_MS || 180000),
    });
    this.geminiClient = new GeminiClientTool({
      ...(config.gemini || {}),
      timeout: Number(config.gemini?.timeout || process.env.GEMMA_TIMEOUT_MS || 180000),
    });

    this.sessions = new Map();
    this.chunkBuffer = new Map();
    this.transcriptBuffer = new Map();
    this.draftBuffer = new Map();
    this.chunkFlushTimers = new Map();
    this.sessionChunkFiles = new Map(); // Track chunk files for each session
    this.transcriptionQueues = new Map();
    this.upgradeHandler = null;
    this.attachedServer = null;

    this.config = {
      pingInterval: Number(config.pingInterval || 30000),
      chunkFlushMs: Number(config.chunkFlushMs || 3000),
      liveTranscriptWindowChunks: Number(config.liveTranscriptWindowChunks || 8),
      maxBufferSize: Number(config.maxBufferSize || 5 * 1024 * 1024),
      enableDraftExtraction: config.enableDraftExtraction ?? true,
      draftExtractionInterval: Number(config.draftExtractionInterval || 15000),
      debug: config.debug || false,
      ...config,
    };

    this.draftTimers = new Map();
    this.draftInFlight = new Set();
  }

  log(message, data = {}) {
    if (this.config.debug) {
      console.log(`[LiveConversationWS] ${message}`, data);
    }
  }

  normalizeTranscriptText(value = "") {
    return String(value || "")
      .replace(/<\|[^>]+\|>/g, " ")
      .replace(/<\/?s>/gi, " ")
      .replace(/\[(?:music|silence|blank_audio|inaudible|noise)\]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  isMeaningfulTranscriptText(value = "") {
    const cleaned = this.normalizeTranscriptText(value);
    return Boolean(cleaned && /[a-z0-9]/i.test(cleaned));
  }

  isEmptySessionCapture(session) {
    return (session?.audio?.chunkCount || 0) === 0
      && (session?.transcript?.segments?.length || 0) === 0
      && !this.isMeaningfulTranscriptText(session?.transcript?.rawText || "")
      && !this.isMeaningfulTranscriptText(session?.transcript?.normalizedText || "");
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
    const normalizedDraft = normalizeLiveDraft(draft);
    return Boolean(
      String(normalizedDraft.chiefComplaint || "").trim()
      || String(normalizedDraft.hpi || "").trim()
      || normalizedDraft.ros.length > 0
      || String(normalizedDraft.diagnosis || "").trim()
      || normalizedDraft.symptoms.length > 0
      || normalizedDraft.medications.length > 0
      || normalizedDraft.labs.length > 0
      || normalizedDraft.radiology.length > 0
      || normalizedDraft.procedures.length > 0
      || normalizedDraft.followUp.length > 0
      || normalizedDraft.plan.length > 0
      || String(normalizedDraft.patient.name || "").trim()
      || Number.isFinite(normalizedDraft.patient.age)
      || String(normalizedDraft.patient.gender || "").trim()
      || Number.isFinite(normalizedDraft.vitals.latest.bp.systolic)
      || Number.isFinite(normalizedDraft.vitals.latest.bp.diastolic)
      || Number.isFinite(normalizedDraft.vitals.latest.pulse.value)
      || Number.isFinite(normalizedDraft.vitals.latest.temperature.value)
      || Number.isFinite(normalizedDraft.vitals.latest.spo2.value)
      || Number.isFinite(normalizedDraft.vitals.latest.weight.value)
    );
  }

  shouldBackfillTranscript(session) {
    return Boolean(session);
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
      [/palpitations/gi, "Palpitations"],
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
    if (lowerSymptoms.some((item) => item.includes("palpitations"))) return "Palpitations under evaluation";
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

  extractPatientFromTranscript(transcript) {
    const normalized = this.normalizeDraftText(transcript);
    const patient = {
      name: "",
      age: null,
      gender: "",
    };

    const explicitNamePatterns = [
      /\bmy name is ([a-z][a-z\s.'-]{1,40}?)(?=\s+\b(?:and|with|for|because|since|doctor|bp|blood pressure)\b|[.?!,]|$)/i,
      /\bpatient(?:'s)? name is ([a-z][a-z\s.'-]{1,40}?)(?=\s+\b(?:and|with|for|because|since|doctor|bp|blood pressure)\b|[.?!,]|$)/i,
      /\bthis is ([a-z][a-z\s.'-]{1,40}?)(?=\s+\b(?:and|with|for|because|since|doctor|bp|blood pressure)\b|[.?!,]|$)/i,
    ];
    for (const pattern of explicitNamePatterns) {
      const match = normalized.match(pattern);
      if (!match?.[1]) continue;
      const candidate = this.cleanDraftPhrase(match[1])
        .split(/\b(?:and|with|for|because|since|doctor)\b/i)[0]
        .trim();
      if (candidate && candidate.split(/\s+/).length <= 4) {
        patient.name = candidate
          .split(/\s+/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
        break;
      }
    }

    const ageMatch = normalized.match(/\b(\d{1,3})\s*(?:years? old|year old|yrs? old)\b/i)
      || normalized.match(/\bage(?: is|:)?\s*(\d{1,3})\b/i);
    if (ageMatch?.[1]) {
      const age = Number(ageMatch[1]);
      if (Number.isFinite(age) && age > 0) {
        patient.age = age;
      }
    }

    const genderMatch = normalized.match(/\b(?:male|female|man|woman|boy|girl)\b/i)
      || normalized.match(/\bgender(?: is|:)?\s*(male|female|other)\b/i)
      || normalized.match(/\bsex(?: is|:)?\s*(male|female|other)\b/i);
    if (genderMatch?.[0]) {
      patient.gender = normalizeGender(genderMatch[1] || genderMatch[0]);
    }

    return patient;
  }

  extractVitalsFromTranscript(transcript) {
    const normalized = this.normalizeDraftText(transcript);
    const vitals = {
      latest: {
        bp: { systolic: null, diastolic: null },
        pulse: { value: null, unit: "bpm" },
        temperature: { value: null, unit: "F" },
        spo2: { value: null, unit: "%" },
        weight: { value: null, unit: "kg" },
      },
    };

    const bpMatch = normalized.match(/\b(?:blood pressure|bp)(?: is| was| of|:)?\s*(\d{2,3})\s*(?:\/|over|bar)\s*(\d{2,3})\b/i);
    if (bpMatch) {
      vitals.latest.bp = {
        systolic: Number(bpMatch[1]),
        diastolic: Number(bpMatch[2]),
      };
    }

    const pulseMatch = normalized.match(/\b(?:pulse|heart rate|hr)(?: is| was| of|:)?\s*(\d{2,3})(?:\s*(?:bpm|beats per minute))?\b/i);
    if (pulseMatch) {
      vitals.latest.pulse.value = Number(pulseMatch[1]);
    }

    const spo2Match = normalized.match(/\b(?:spo2|oxygen saturation|o2 saturation|saturation)(?: is| was| of|:)?\s*(\d{2,3})(?:\s*%| percent)?\b/i);
    if (spo2Match) {
      vitals.latest.spo2.value = Number(spo2Match[1]);
    }

    const temperatureMatch = normalized.match(/\b(?:temperature|temp)(?: is| was| of|:)?\s*(\d{2,3}(?:\.\d+)?)(?:\s*degrees?)?\s*([fc]|celsius|fahrenheit)?\b/i);
    if (temperatureMatch) {
      vitals.latest.temperature.value = Number(temperatureMatch[1]);
      vitals.latest.temperature.unit = /c|celsius/i.test(temperatureMatch[2] || "") ? "C" : "F";
    }

    const weightMatch = normalized.match(/\b(?:weight|weighs?|wt)(?: is| was| of|:)?\s*(\d{2,3}(?:\.\d+)?)(?:\s*(kg|kgs|kilograms?|lb|lbs|pounds?))\b/i);
    if (weightMatch) {
      vitals.latest.weight.value = Number(weightMatch[1]);
      vitals.latest.weight.unit = /lb|lbs|pounds?/i.test(weightMatch[2]) ? "lb" : "kg";
    }

    return vitals;
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

  buildFallbackHpi(transcript, symptoms = [], vitals = null) {
    const normalized = this.normalizeDraftText(transcript);
    const parts = [];
    const lowerSymptoms = symptoms.map((item) => item.toLowerCase());
    const numberWords = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";

    const durationMatch = normalized.match(new RegExp(`\\b((?:${numberWords}|\\d+)\\s+days?\\s+ago\\s+started)\\b`, "i"))
      || normalized.match(new RegExp(`\\b(?:for|since)\\s+((?:${numberWords}|\\d+)\\s+days?)\\b`, "i"));
    const duration = durationMatch?.[1]
      ? this.cleanDraftPhrase(durationMatch[1]).replace(/\bago started\b/i, "").trim()
      : "";

    if (lowerSymptoms.some((item) => item.includes("palpitations"))) {
      let clause = "Reports palpitations";
      if (duration) clause += ` for ${duration}`;
      parts.push(clause);
    } else if (lowerSymptoms.length > 0) {
      parts.push(`Reports ${lowerSymptoms.join(", ")}`);
    }

    if (/\bcomes and goes\b/i.test(normalized)) {
      parts.push("Symptoms are intermittent");
    } else if (/\bconstant(?:ly)?\b/i.test(normalized)) {
      parts.push("Symptoms are constant");
    }

    if (/\b(?:mostly|worse|more)\s+(?:at\s+)?night\b/i.test(normalized)) {
      parts.push("Worse at night");
    }

    if (/\bstanding up\b/i.test(normalized) && lowerSymptoms.some((item) => item.includes("dizziness"))) {
      parts.push("Associated dizziness on standing");
    }

    if (
      vitals?.latest?.bp
      && Number.isFinite(vitals.latest.bp.systolic)
      && Number.isFinite(vitals.latest.bp.diastolic)
    ) {
      parts.push(`Blood pressure recorded at ${vitals.latest.bp.systolic}/${vitals.latest.bp.diastolic}`);
    }

    const hpi = this.dedupeDraftStrings(parts).join(". ").trim();
    return hpi || this.normalizeDraftText(transcript).slice(0, 320);
  }

  async applyDraftAndReviewRequirements(sessionId, draft, session = null) {
    let currentSession = session || await this.store.get(sessionId);
    const normalizedDraft = mergeLiveDraft(
      currentSession?.draftExtraction?.extractedData || {},
      draft,
    );

    if (
      currentSession
      && !String(currentSession.linkedPatient || "").trim()
      && String(normalizedDraft.patient.name || "").trim()
    ) {
      currentSession = await this.store.update(sessionId, {
        linkedPatient: normalizedDraft.patient.name,
      });
    }

    await this.store.updateDraftExtraction(sessionId, normalizedDraft);

    if (!currentSession) return normalizedDraft;

    const requiredItems = buildRequiredReviewItems(currentSession, normalizedDraft);
    const mergedItems = mergeRequiredReviewItems(
      currentSession.draftExtraction?.reviewItems || [],
      requiredItems,
    );
    await this.store.replaceReviewItems(sessionId, mergedItems);
    return normalizedDraft;
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
            enableSpeakerDiarization: true,
            skipValidation: true,
            mimeType: session.audio?.mimeType,
          },
        });

        let transcriptData = result?.data && this.isMeaningfulTranscriptText(
          result.data.normalizedText || result.data.rawText || "",
        )
          ? result.data
          : null;

        if (transcriptData) {
          if (!this.hasUsefulSpeakerSegmentation(transcriptData)) {
            const inferredTranscript = await this.inferSpeakerTurnsFromTranscript(transcriptData, session);
            if (inferredTranscript) {
              transcriptData = inferredTranscript;
            }
          }

          await this.store.replaceTranscript(sessionId, {
            ...transcriptData,
            interimText: "",
          });
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
      || session?.transcript?.interimText
      || "",
    ).trim();

    if (transcriptText.length < 20) {
      return;
    }

    try {
      const draft = await this.generateDraftExtraction(transcriptText, session);
      if (this.hasMeaningfulDraft(draft)) {
        await this.applyDraftAndReviewRequirements(sessionId, draft, session);
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

  async createStreamingAudioSnapshot(sessionId, recentChunkLimit = 0) {
    const chunkFiles = this.sessionChunkFiles.get(sessionId) || [];
    if (chunkFiles.length === 0) return null;
    const selectedChunkFiles = recentChunkLimit > 0
      ? chunkFiles.slice(-recentChunkLimit)
      : chunkFiles;

    const chunks = await Promise.all(
      selectedChunkFiles.map(async (chunkPath) => {
        try {
          return await fsp.readFile(chunkPath);
        } catch {
          return null;
        }
      }),
    );

    const validChunks = chunks.filter(Boolean);
    if (validChunks.length === 0) return null;

    const session = await this.store.get(sessionId);
    const extension = this.getAudioExtension(session?.audio?.mimeType);
    const tempDir = path.join(this.storageDir, "live_conversation_temp");
    await fsp.mkdir(tempDir, { recursive: true });

    const snapshotPath = path.join(tempDir, `${sessionId}-stream-${Date.now()}${extension}`);
    await fsp.writeFile(snapshotPath, Buffer.concat(validChunks));
    return snapshotPath;
  }

  normalizeComparableTranscript(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  formatTimeLabel(totalSeconds = 0) {
    const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
    const seconds = String(safeSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  hasUsefulSpeakerSegmentation(transcriptData = {}) {
    const segments = Array.isArray(transcriptData?.segments) ? transcriptData.segments : [];
    const attributedSegments = segments.filter((segment) => {
      const text = String(segment?.text || segment?.normalizedText || "").trim();
      return text && String(segment?.speakerRole || "").trim() && segment.speakerRole !== "unknown";
    });
    const distinctSpeakers = new Set(
      attributedSegments
        .map((segment) => String(segment?.speakerId || segment?.speakerLabel || "").trim())
        .filter(Boolean),
    );

    return attributedSegments.length >= 2 && distinctSpeakers.size >= 2;
  }

  buildSpeakerAttributedTranscriptFromTurns(transcriptData = {}, turns = [], durationSeconds = null) {
    const cleanedTurns = Array.isArray(turns)
      ? turns
        .map((turn) => ({
          speakerRole: ["doctor", "patient", "unknown"].includes(String(turn?.speakerRole || "").trim().toLowerCase())
            ? String(turn.speakerRole).trim().toLowerCase()
            : "unknown",
          text: String(turn?.text || "").replace(/\s+/g, " ").trim(),
        }))
        .filter((turn) => turn.text)
      : [];

    if (cleanedTurns.length < 2) {
      return null;
    }

    const totalWords = cleanedTurns.reduce((sum, turn) => sum + Math.max(1, turn.text.split(/\s+/).filter(Boolean).length), 0);
    const speakerCounters = new Map();
    const speakers = new Map();
    const segments = [];
    let cursorSeconds = 0;

    cleanedTurns.forEach((turn, index) => {
      const count = (speakerCounters.get(turn.speakerRole) || 0) + 1;
      speakerCounters.set(turn.speakerRole, count);

      const speakerId = turn.speakerRole === "doctor"
        ? "doctor_1"
        : turn.speakerRole === "patient"
          ? "patient_1"
          : `unknown_${count}`;
      const speakerLabel = turn.speakerRole === "doctor"
        ? "Doctor"
        : turn.speakerRole === "patient"
          ? "Patient"
          : `Speaker ${count}`;

      if (!speakers.has(speakerId)) {
        speakers.set(speakerId, {
          id: speakerId,
          label: speakerLabel,
          role: turn.speakerRole,
        });
      }

      const words = Math.max(1, turn.text.split(/\s+/).filter(Boolean).length);
      const allocatedSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Math.max(1, Math.round((durationSeconds * words) / Math.max(1, totalWords)))
        : null;
      const startSeconds = Number.isFinite(durationSeconds) ? cursorSeconds : null;
      const endSeconds = Number.isFinite(durationSeconds)
        ? (index === cleanedTurns.length - 1 ? durationSeconds : Math.min(durationSeconds, cursorSeconds + allocatedSeconds))
        : null;

      if (Number.isFinite(endSeconds)) {
        cursorSeconds = endSeconds;
      }

      segments.push({
        id: `seg-speaker-fallback-${index + 1}`,
        speakerId,
        speakerRole: turn.speakerRole,
        speakerLabel,
        startLabel: Number.isFinite(startSeconds) ? this.formatTimeLabel(startSeconds) : "00:00",
        endLabel: Number.isFinite(endSeconds) ? this.formatTimeLabel(endSeconds) : "00:00",
        startSeconds: Number.isFinite(startSeconds) ? startSeconds : undefined,
        endSeconds: Number.isFinite(endSeconds) ? endSeconds : undefined,
        text: turn.text,
        normalizedText: turn.text,
        confidence: null,
        flags: ["speaker_inferred_from_transcript"],
        status: "final",
      });
    });

    return {
      ...transcriptData,
      segments,
      speakers: Array.from(speakers.values()),
      quality: {
        ...(transcriptData?.quality || {}),
        speakerAmbiguityCount: segments.filter((segment) => segment.speakerRole === "unknown").length,
      },
    };
  }

  async inferSpeakerTurnsFromTranscript(transcriptData = {}, session = null) {
    const transcriptText = String(
      transcriptData?.normalizedText
      || transcriptData?.rawText
      || "",
    ).trim();

    if (transcriptText.length < 60) {
      return null;
    }

    const existingSegments = Array.isArray(transcriptData?.segments) ? transcriptData.segments : [];
    const lastEndSeconds = existingSegments.reduce((maxValue, segment) => {
      const endSeconds = Number(segment?.endSeconds);
      return Number.isFinite(endSeconds) ? Math.max(maxValue, endSeconds) : maxValue;
    }, 0);
    const durationSeconds = lastEndSeconds > 0
      ? lastEndSeconds
      : Number.isFinite(Number(session?.durationMs)) && Number(session.durationMs) > 0
        ? Math.max(1, Math.round(Number(session.durationMs) / 1000))
        : null;

    const prompt = `Split this doctor-patient transcript into ordered speaker turns.

Return JSON only in this shape:
{"turns":[{"speakerRole":"doctor","text":"utterance text"}]}

Rules:
- speakerRole must be only "doctor", "patient", or "unknown"
- preserve the transcript wording as much as possible while splitting it into turns
- do not add facts or commentary
- create at least 2 turns when the transcript contains a back-and-forth conversation

TRANSCRIPT:
${transcriptText}`;

    const attempts = [
      {
        responseMimeType: "application/json",
        thinkingBudget: 128,
        systemInstruction: "You are a medical transcript formatter. Return exactly one compact JSON object and nothing else.",
      },
      {
        thinkingBudget: 128,
        systemInstruction: "Return only valid JSON. Do not use markdown fences. Do not explain your answer.",
      },
    ];

    for (const attempt of attempts) {
      try {
        const result = await this.geminiClient.execute(prompt, {
          temperature: 0.1,
          maxTokens: 1600,
          ...attempt,
        });

        if (!result.success) {
          this.log("Speaker turn inference failed", {
            sessionId: session?.id,
            error: result.error,
          });
          continue;
        }

        const jsonMatch = String(result.content || "").match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        const inferredTranscript = this.buildSpeakerAttributedTranscriptFromTurns(
          transcriptData,
          parsed.turns,
          durationSeconds,
        );

        if (inferredTranscript) {
          return inferredTranscript;
        }
      } catch (error) {
        this.log("Speaker turn inference error", {
          sessionId: session?.id,
          error: error.message,
        });
      }
    }

    return null;
  }

  normalizeRealtimeTranscript(result, sessionId) {
    const transcriptData = result?.data || {};
    const rawSegments = Array.isArray(transcriptData.segments) && transcriptData.segments.length > 0
      ? transcriptData.segments
      : Array.isArray(transcriptData.chunks)
        ? transcriptData.chunks
          .filter((chunk) => chunk?.success && this.isMeaningfulTranscriptText(chunk?.transcript || chunk?.normalizedText || ""))
          .map((chunk, index) => ({
            id: `seg-${sessionId}-${Math.round((chunk.startSeconds || 0) * 10)}-${Math.round((chunk.endSeconds || 0) * 10)}-${index}`,
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
          }))
        : [];

    const segments = rawSegments
      .map((segment, index) => {
        const text = this.normalizeTranscriptText(segment?.text || segment?.normalizedText || "");
        if (!this.isMeaningfulTranscriptText(text)) return null;

        return {
          id: String(
            segment?.id
            || segment?.segmentId
            || `seg-${sessionId}-${Math.round((Number(segment?.startSeconds) || index) * 10)}-${Math.round((Number(segment?.endSeconds) || index + 1) * 10)}`,
          ),
          speakerId: segment?.speakerId || `spk_${index + 1}`,
          speakerRole: segment?.speakerRole || "unknown",
          speakerLabel: segment?.speakerLabel || "Unknown",
          startLabel: segment?.startLabel || "00:00",
          endLabel: segment?.endLabel || "00:00",
          startSeconds: Number.isFinite(segment?.startSeconds) ? segment.startSeconds : undefined,
          endSeconds: Number.isFinite(segment?.endSeconds) ? segment.endSeconds : undefined,
          text,
          normalizedText: String(segment?.normalizedText || text),
          confidence: typeof segment?.confidence === "number" ? segment.confidence : 0.85,
          flags: Array.isArray(segment?.flags) && segment.flags.length > 0
            ? segment.flags
            : ["live_stream", "speaker_unknown"],
          status: segment?.status === "interim" ? "interim" : "final",
        };
      })
      .filter(Boolean);

    const rawText = this.normalizeTranscriptText(
      transcriptData.rawText
      || transcriptData.normalizedText
      || segments.map((segment) => segment.text).join(" ").trim(),
    );
    const normalizedText = this.normalizeTranscriptText(
      transcriptData.normalizedText
      || transcriptData.rawText
      || rawText,
    );

    if (!this.isMeaningfulTranscriptText(rawText) && !this.isMeaningfulTranscriptText(normalizedText) && segments.length === 0) return null;

    return {
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
  }

  extractNovelTranscriptSuffix(previousWindowText = "", currentWindowText = "") {
    const previousComparable = this.normalizeComparableTranscript(previousWindowText);
    const currentComparable = this.normalizeComparableTranscript(currentWindowText);
    const currentOriginal = String(currentWindowText || "").replace(/\s+/g, " ").trim();

    if (!currentComparable) return "";
    if (!previousComparable) return currentOriginal;
    if (previousComparable === currentComparable || previousComparable.includes(currentComparable)) return "";

    const previousWords = previousComparable.split(/\s+/).filter(Boolean);
    const currentWords = currentComparable.split(/\s+/).filter(Boolean);
    const currentOriginalWords = currentOriginal.split(/\s+/).filter(Boolean);

    for (let overlap = Math.min(previousWords.length, currentWords.length); overlap >= 2; overlap -= 1) {
      if (previousWords.slice(-overlap).join(" ") === currentWords.slice(0, overlap).join(" ")) {
        return currentOriginalWords.slice(overlap).join(" ").trim();
      }
    }

    return currentOriginal;
  }

  appendTranscriptDelta(existingTranscript = {}, deltaText = "", sessionId, nextTranscript = {}) {
    const cleanedDelta = this.normalizeTranscriptText(deltaText);
    if (!this.isMeaningfulTranscriptText(cleanedDelta)) return existingTranscript;

    const existingSegments = Array.isArray(existingTranscript?.segments)
      ? existingTranscript.segments.filter(Boolean)
      : [];
    const existingEndSeconds = existingSegments.reduce((maxValue, segment) => {
      const endSeconds = Number(segment?.endSeconds);
      return Number.isFinite(endSeconds) ? Math.max(maxValue, endSeconds) : maxValue;
    }, 0);
    const durationSeconds = Math.max(1, Math.ceil(cleanedDelta.split(/\s+/).filter(Boolean).length / 3));
    const startSeconds = existingEndSeconds;
    const endSeconds = startSeconds + durationSeconds;
    const segment = {
      id: `seg-${sessionId}-${Date.now()}-${existingSegments.length + 1}`,
      speakerId: "spk_0",
      speakerRole: "unknown",
      speakerLabel: "Unknown",
      startLabel: this.formatTimeLabel(startSeconds),
      endLabel: this.formatTimeLabel(endSeconds),
      startSeconds,
      endSeconds,
      text: cleanedDelta,
      normalizedText: cleanedDelta,
      confidence: typeof nextTranscript?.quality?.overallConfidence === "number"
        ? nextTranscript.quality.overallConfidence
        : 0.85,
      flags: ["live_stream", "speaker_unknown"],
      status: "final",
    };

    const rawText = [existingTranscript?.rawText, cleanedDelta]
      .filter((value) => String(value || "").trim().length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const normalizedText = [existingTranscript?.normalizedText, cleanedDelta]
      .filter((value) => String(value || "").trim().length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      segments: [...existingSegments, segment],
      rawText,
      normalizedText: normalizedText || rawText,
      speakers: Array.isArray(existingTranscript?.speakers) && existingTranscript.speakers.length > 0
        ? existingTranscript.speakers
        : Array.isArray(nextTranscript?.speakers)
          ? nextTranscript.speakers
          : [],
      quality: {
        overallConfidence: typeof nextTranscript?.quality?.overallConfidence === "number"
          ? nextTranscript.quality.overallConfidence
          : existingTranscript?.quality?.overallConfidence ?? null,
        lowConfidenceSegmentCount: Number(existingTranscript?.quality?.lowConfidenceSegmentCount || 0)
          + Number(nextTranscript?.quality?.lowConfidenceSegmentCount || 0),
        speakerAmbiguityCount: Number(existingTranscript?.quality?.speakerAmbiguityCount || 0)
          + Number(nextTranscript?.quality?.speakerAmbiguityCount || 0),
        overlappingSpeechSuspected: Boolean(
          existingTranscript?.quality?.overlappingSpeechSuspected
          || nextTranscript?.quality?.overlappingSpeechSuspected,
        ),
      },
    };
  }

  enqueueTranscription(sessionId, chunkPath) {
    const previousTask = this.transcriptionQueues.get(sessionId) || Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(() => this.transcribeChunk(sessionId, chunkPath));

    this.transcriptionQueues.set(sessionId, nextTask);
    return nextTask.finally(() => {
      if (this.transcriptionQueues.get(sessionId) === nextTask) {
        this.transcriptionQueues.delete(sessionId);
      }
    });
  }

  async transcribeChunk(sessionId, chunkPath) {
    const ws = this.sessions.get(sessionId);
    const session = await this.store.get(sessionId);
    if (!ws || ws.readyState !== ws.OPEN || !session || session.status !== "live") return;

    let snapshotPath = null;
    try {
      snapshotPath = await this.createStreamingAudioSnapshot(sessionId, this.config.liveTranscriptWindowChunks);
      if (!snapshotPath) return;

      console.log(`[LiveConversationWS] Starting rolling-window transcription for session ${sessionId}`, {
        chunkPath,
        snapshotPath,
        windowChunks: this.config.liveTranscriptWindowChunks,
      });
      this.log("Starting rolling-window transcription", {
        sessionId,
        chunkPath,
        snapshotPath,
        windowChunks: this.config.liveTranscriptWindowChunks,
      });
      const result = await this.sttAgent.execute({
        audioPath: snapshotPath,
        options: {
          mode: "fixed_window_no_vad",
          windowSeconds: 15,
          enableSpeakerDiarization: true,
          skipValidation: true,
          mimeType: session?.audio?.mimeType,
        },
      });

      console.log(`[LiveConversationWS] Transcription result for session ${sessionId}`, {
        success: result.success,
        hasData: !!result.data,
        chunks: result.data?.chunks?.length || 0,
        error: result.error
      });
      this.log("Transcription result", { sessionId, success: result.success, hasData: !!result.data });

      const windowTranscript = result.success ? this.normalizeRealtimeTranscript(result, sessionId) : null;
      if (windowTranscript) {
        const currentWindowText = String(
          windowTranscript.normalizedText
          || windowTranscript.rawText
          || "",
        ).trim();
        if (!this.isMeaningfulTranscriptText(currentWindowText)) return;

        const previousWindowText = this.transcriptBuffer.get(sessionId) || "";
        this.transcriptBuffer.set(sessionId, currentWindowText);
        const deltaText = this.extractNovelTranscriptSuffix(previousWindowText, currentWindowText);
        const existingTranscript = session.transcript || {};
        const accumulatedTranscript = deltaText
          ? this.appendTranscriptDelta(existingTranscript, deltaText, sessionId, windowTranscript)
          : existingTranscript;

        const livePreviewTranscript = {
          segments: Array.isArray(accumulatedTranscript.segments) ? accumulatedTranscript.segments : [],
          rawText: this.isMeaningfulTranscriptText(accumulatedTranscript.rawText)
            ? accumulatedTranscript.rawText
            : currentWindowText,
          normalizedText: this.isMeaningfulTranscriptText(accumulatedTranscript.normalizedText)
            ? accumulatedTranscript.normalizedText
            : currentWindowText,
          interimText: currentWindowText,
          speakers: Array.isArray(windowTranscript.speakers) && windowTranscript.speakers.length > 0
            ? windowTranscript.speakers
            : Array.isArray(accumulatedTranscript.speakers)
              ? accumulatedTranscript.speakers
              : [],
          quality: windowTranscript.quality,
        };
        console.log(`[LiveConversationWS] Updating transcript for session ${sessionId}`, {
          mode: "live_preview",
          textLength: currentWindowText.length,
        });
        await this.store.replaceTranscript(sessionId, livePreviewTranscript);
        this.sendJson(ws, {
          type: "transcript.partial",
          sessionId,
          transcript: livePreviewTranscript,
          timestamp: new Date().toISOString(),
        });
        await this.publishLiveDraftUpdate(sessionId, {
          ...session,
          transcript: livePreviewTranscript,
        }, ws);
      } else if (result.error) {
        this.log("Transcription failed", { sessionId, error: result.error });
      }
    } catch (error) {
      this.log("Transcription error", { sessionId, error: error.message, stack: error.stack });
    } finally {
      if (snapshotPath && snapshotPath !== chunkPath) {
        await fsp.unlink(snapshotPath).catch(() => undefined);
      }
    }

    // Don't delete chunk files - they will be combined at the end for playback
  }

  async combineAudioChunks(sessionId) {
    const chunkFiles = this.sessionChunkFiles.get(sessionId) || [];

    try {
      const session = await this.store.get(sessionId);
      const uploadedFinalPath = session?.audio?.combinedPath;
      if (uploadedFinalPath) {
        const normalizedUploadedPath = path.resolve(uploadedFinalPath);
        if (normalizedUploadedPath.startsWith(path.resolve(this.storageDir))) {
          const exists = await fsp.access(normalizedUploadedPath).then(() => true).catch(() => false);
          if (exists) {
            for (const chunkPath of chunkFiles) {
              await fsp.unlink(chunkPath).catch(() => undefined);
            }
            this.sessionChunkFiles.set(sessionId, []);
            return normalizedUploadedPath;
          }
        }
      }

      if (chunkFiles.length === 0) return null;

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

      if (!ws || ws.readyState !== ws.OPEN) {
        console.log(`[LiveConversationWS] Stopping chunk flush for session ${sessionId}`);
        clearInterval(interval);
        this.chunkFlushTimers.delete(sessionId);
        return;
      }

      if (!session) {
        this.log("Chunk flush skipped because session could not be loaded", { sessionId });
        return;
      }

      if (["finalized", "failed"].includes(session.status)) {
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
          await this.enqueueTranscription(sessionId, chunkPath);
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
    await this.store.update(sessionId, {
      status: "paused",
      transport: {
        connectionState: "paused",
        lastError: null,
        lastEventAt: new Date().toISOString(),
      },
    });

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
    await this.store.update(sessionId, {
      status: "live",
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
      await this.enqueueTranscription(sessionId, chunkPath);
    }

    // Combine all audio chunks into a single file for playback
    const combinedAudioPath = await this.combineAudioChunks(sessionId);
    await this.backfillFinalTranscriptAndDraft(sessionId, combinedAudioPath);

    let currentSession = await this.store.get(sessionId);
    await this.applyDraftAndReviewRequirements(
      sessionId,
      currentSession?.draftExtraction?.extractedData || {},
      currentSession,
    );
    currentSession = await this.store.get(sessionId);

    await this.store.update(sessionId, {
      status: "review_required",
      endedAt: new Date().toISOString(),
      audio: {
        ...(currentSession?.audio || {}),
        combinedPath: combinedAudioPath || currentSession?.audio?.combinedPath || null,
        combinedSize: currentSession?.audio?.totalBytes || currentSession?.audio?.combinedSize || 0,
      },
      transport: {
        connectionState: "closed",
        lastError: null,
        lastEventAt: new Date().toISOString(),
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
    this.draftBuffer.delete(sessionId);
    this.transcriptionQueues.delete(sessionId);
    this.draftInFlight.delete(sessionId);

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
      if (!currentSession) {
        this.log("Draft extraction skipped because session could not be loaded", { sessionId });
        return;
      }

      if (currentSession.status !== "live") {
        clearInterval(timer);
        this.draftTimers.delete(sessionId);
        return;
      }

      await this.publishLiveDraftUpdate(sessionId, currentSession, ws);
    }, Math.min(this.config.draftExtractionInterval, 2500));

    this.draftTimers.set(sessionId, timer);
  }

  async publishLiveDraftUpdate(sessionId, session = null, ws = null) {
    const currentSession = session || await this.store.get(sessionId);
    const currentWs = ws || this.sessions.get(sessionId);
    if (!currentSession || currentSession.status !== "live" || !currentWs) return false;

    const transcript = String(
      currentSession.transcript?.interimText
      || currentSession.transcript?.normalizedText
      || currentSession.transcript?.rawText
      || "",
    ).trim();
    if (!transcript) return false;

    const draftSourceText = String(
      currentSession.transcript?.normalizedText
      || currentSession.transcript?.rawText
      || transcript,
    ).trim();
    const normalizedDraftSource = this.normalizeDraftText(draftSourceText || transcript);
    if (normalizedDraftSource.length < 20) return false;
    if (this.draftInFlight.has(sessionId)) return false;
    if (this.draftBuffer.get(sessionId) === normalizedDraftSource) return false;

    const segments = currentSession.transcript?.segments || [];
    const stableSegmentId = segments.length > 0 ? segments[segments.length - 1]?.id : null;

    this.draftInFlight.add(sessionId);
    try {
      const draft = await this.generateDraftExtraction(normalizedDraftSource, currentSession);
      this.draftBuffer.set(sessionId, normalizedDraftSource);
      if (!this.hasMeaningfulDraft(draft)) {
        this.log("Skipping empty draft update", { sessionId });
        return false;
      }

      const mergedDraft = await this.applyDraftAndReviewRequirements(sessionId, draft, currentSession);
      await this.store.updateDraftLastStableSegmentId(sessionId, stableSegmentId);

      this.sendJson(currentWs, {
        type: "draft.updated",
        sessionId,
        draft: mergedDraft,
        timestamp: new Date().toISOString(),
      });

      await this.store.logEvent(sessionId, "draft_updated", {
        segmentCount: segments.length,
      });
      return true;
    } catch (error) {
      this.log("Draft extraction error", { sessionId, error: error.message });
      return false;
    } finally {
      this.draftInFlight.delete(sessionId);
    }
  }

  async generateDraftExtraction(transcript, session) {
    const prompt = `Extract structured clinical data from this doctor-patient transcript.

Return one compact JSON object only. Do not echo the transcript. Use empty strings, nulls, or empty arrays when unknown.

Schema:
{"chiefComplaint":"","hpi":"","ros":[],"pastHistory":[],"diagnosis":"","symptoms":[],"patient":{"name":"","age":null,"gender":""},"vitals":{"latest":{"bp":{"systolic":null,"diastolic":null},"pulse":{"value":null,"unit":"bpm"},"temperature":{"value":null,"unit":"F"},"spo2":{"value":null,"unit":"%"},"weight":{"value":null,"unit":"kg"}}},"medications":[{"name":"","instruction":"","status":"draft"}],"labs":[],"radiology":[],"procedures":[],"followUp":[],"plan":[]}

Transcript:
${transcript}`;

    const parseDraft = (content = "") => {
      const jsonMatch = String(content || "").match(/\{[\s\S]*\}/);
      const extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      return normalizeLiveDraft(extracted);
    };

    try {
      const gemmaResult = await this.gemmaClient.execute(prompt, {
        temperature: 0.2,
        maxTokens: 2048,
      });

      if (gemmaResult.success) {
        const draft = parseDraft(gemmaResult.content || "{}");
        if (this.hasMeaningfulDraft(draft)) {
          return draft;
        }
        this.log("Gemma draft extraction returned no structured content", {
          sessionId: session?.id,
        });
      } else {
        this.log("Gemma draft extraction failed", {
          sessionId: session?.id,
          error: gemmaResult.error,
        });
      }
    } catch (error) {
      this.log("Gemma draft extraction error", {
        sessionId: session?.id,
        error: error.message,
      });
    }

    try {
      const geminiResult = await this.geminiClient.execute(prompt, {
        temperature: 0.2,
        maxTokens: 1200,
        responseMimeType: "application/json",
        thinkingBudget: 128,
        systemInstruction: "You extract structured clinical data from medical transcripts. Return exactly one compact JSON object, do not echo the transcript, do not add markdown, and keep HPI under 45 words.",
      });

      if (geminiResult.success) {
        const draft = parseDraft(geminiResult.content || "{}");
        if (this.hasMeaningfulDraft(draft)) {
          return draft;
        }
        this.log("Gemini draft extraction returned no structured content", {
          sessionId: session?.id,
        });
      } else {
        this.log("Gemini draft extraction failed", {
          sessionId: session?.id,
          error: geminiResult.error,
        });
      }
    } catch (error) {
      this.log("Gemini draft extraction error", {
        sessionId: session?.id,
        error: error.message,
      });
    }

    return normalizeLiveDraft({});
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
    this.transcriptionQueues.clear();
    this.draftInFlight.clear();

    this.wss?.close();
    this.log("WebSocket server shut down");
  }
}

module.exports = LiveConversationWebSocket;
