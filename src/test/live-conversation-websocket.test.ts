import { afterEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LiveConversationWebSocket = require("../../server/live_conversation_websocket.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LiveConversationRoutes = require("../../server/live_conversation_routes.cjs");

function createFakeWs() {
  const handlers: Record<string, (...args: any[]) => void> = {};

  return {
    OPEN: 1,
    readyState: 1,
    sent: [] as any[],
    on(event: string, handler: (...args: any[]) => void) {
      handlers[event] = handler;
    },
    send(message: string) {
      this.sent.push(JSON.parse(message));
    },
    close: vi.fn(),
    ping: vi.fn(),
    handlers,
  };
}

function createFakeApp() {
  const routes = new Map<string, (...args: any[]) => void>();
  return {
    get(path: string, handler: (...args: any[]) => void) {
      routes.set(`GET ${path}`, handler);
    },
    post(path: string, handler: (...args: any[]) => void) {
      routes.set(`POST ${path}`, handler);
    },
    patch(path: string, handler: (...args: any[]) => void) {
      routes.set(`PATCH ${path}`, handler);
    },
    delete(path: string, handler: (...args: any[]) => void) {
      routes.set(`DELETE ${path}`, handler);
    },
    routes,
  };
}

describe("live conversation websocket handshake", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a draft session in draft until capture explicitly begins", async () => {
    const websocket = new LiveConversationWebSocket({ debug: false });
    websocket.startChunkFlush = vi.fn();
    websocket.startDraftExtraction = vi.fn();

    const session = {
      id: "live-session-1",
      status: "draft",
      linkedPatient: "",
      encounterLabel: "",
      createdBy: { id: "admin", username: "admin", role: "admin" },
      startedAt: null,
      updatedAt: "2026-05-27T10:30:00Z",
      endedAt: null,
      audio: { mimeType: "audio/webm", chunkCount: 0, totalBytes: 0 },
      transcript: { segments: [], rawText: "", normalizedText: "" },
      draftExtraction: { extractedData: null, reviewItems: [], lastStableSegmentId: null },
      transport: { connectionState: "idle", lastError: null, lastEventAt: null },
    };

    websocket.store = {
      get: vi.fn(async () => ({ ...session })),
      update: vi.fn(async (_id: string, updates: any) => {
        Object.assign(session, updates, { updatedAt: "2026-05-27T10:30:01Z" });
        return { ...session };
      }),
      logEvent: vi.fn(async () => undefined),
    };

    const ws = createFakeWs();
    const req = {
      url: "/api/voice/live/sessions/live-session-1/stream",
      headers: { "user-agent": "vitest" },
    };
    const authService = {
      authenticateFromRequest: vi.fn(async () => ({ id: "admin", username: "admin", role: "admin" })),
    };

    await websocket.handleConnection(ws as any, req as any, authService as any);

    expect(session.status).toBe("draft");
    expect(ws.sent[0]).toMatchObject({
      type: "session.ready",
      sessionId: "live-session-1",
      status: "draft",
    });
    expect(websocket.startChunkFlush).not.toHaveBeenCalled();

    await websocket.handleMessage(
      "live-session-1",
      ws as any,
      Buffer.from(JSON.stringify({ type: "session.begin", mimeType: "audio/mp4" })),
      false,
      { id: "admin", username: "admin", role: "admin" },
    );

    expect(session.status).toBe("live");
    expect(session.startedAt).toBeTruthy();
    expect(session.audio.mimeType).toBe("audio/mp4");
    expect(ws.sent.at(-1)).toMatchObject({
      type: "session.state",
      sessionId: "live-session-1",
      status: "live",
    });
    expect(websocket.startChunkFlush).toHaveBeenCalledWith("live-session-1");
    expect(websocket.startDraftExtraction).toHaveBeenCalledWith("live-session-1");
  });
});

describe("live conversation stale session recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resets stale empty live sessions back to draft", async () => {
    const routes = new LiveConversationRoutes({});
    const staleSession = {
      id: "live-stale-1",
      status: "live",
      startedAt: "2000-01-01T00:00:00Z",
      updatedAt: "2000-01-01T00:00:00Z",
      endedAt: null,
      audio: { chunkCount: 0 },
      transcript: { segments: [], rawText: "", normalizedText: "" },
      transport: { connectionState: "connected", lastError: null, lastEventAt: null },
    };

    routes.store = {
      update: vi.fn(async (_id: string, updates: any) => ({ ...staleSession, ...updates })),
    };

    const normalized = await routes.normalizeRecoverableSession(staleSession);

    expect(routes.store.update).toHaveBeenCalled();
    expect(normalized.status).toBe("draft");
    expect(normalized.startedAt).toBeNull();
    expect(normalized.transport.connectionState).toBe("idle");
  });

  it("resets stale empty draft sessions stuck in connected back to idle", async () => {
    const routes = new LiveConversationRoutes({});
    const staleSession = {
      id: "live-stale-draft-1",
      status: "draft",
      startedAt: null,
      updatedAt: "2000-01-01T00:00:00Z",
      endedAt: null,
      audio: { chunkCount: 0 },
      transcript: { segments: [], rawText: "", normalizedText: "" },
      transport: {
        connectionState: "connected",
        lastError: null,
        lastEventAt: "2000-01-01T00:00:00Z",
      },
    };

    routes.store = {
      update: vi.fn(async (_id: string, updates: any) => ({ ...staleSession, ...updates })),
    };

    const normalized = await routes.normalizeRecoverableSession(staleSession);

    expect(routes.store.update).toHaveBeenCalled();
    expect(normalized.status).toBe("draft");
    expect(normalized.transport.connectionState).toBe("idle");
  });
});

describe("live conversation audio route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves the saved combined recording through the authenticated api route", async () => {
    const routes = new LiveConversationRoutes({});
    const app = createFakeApp();
    const authService = {
      authenticateFromRequest: vi.fn(async () => ({ id: "doctor-1", username: "doctor.user", role: "doctor" })),
    };
    const session = {
      id: "live-session-1",
      status: "review_required",
      linkedPatient: "Anita Rao",
      encounterLabel: "Follow-up",
      createdBy: { id: "doctor-1", username: "doctor.user", role: "doctor" },
      startedAt: "2026-05-27T09:28:00Z",
      updatedAt: "2026-05-27T09:30:00Z",
      endedAt: "2026-05-27T09:30:00Z",
      audio: {
        mimeType: "audio/webm;codecs=opus",
        chunkCount: 12,
        combinedPath: "/tmp/live-session-1.webm",
      },
      transcript: { segments: [{ id: "seg-1", text: "Thank you." }], rawText: "Thank you.", normalizedText: "Thank you." },
      draftExtraction: { extractedData: null, reviewItems: [], lastStableSegmentId: null },
      transport: { connectionState: "closed", lastError: null, lastEventAt: "2026-05-27T09:30:00Z" },
    };

    routes.store = {
      get: vi.fn(async () => session),
    } as any;

    const accessSpy = vi.spyOn(require("fs/promises"), "access").mockResolvedValue(undefined as any);

    routes.registerRoutes(app as any, authService as any);
    const handler = app.routes.get("GET /api/voice/live/sessions/:sessionId/audio");

    const req = {
      params: { sessionId: "live-session-1" },
      headers: {},
    };
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json: vi.fn(),
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      sendFile: vi.fn(),
    };

    await handler?.(req as any, res as any);

    expect(accessSpy).toHaveBeenCalledWith("/tmp/live-session-1.webm");
    expect(res.headers["Content-Type"]).toBe("audio/webm");
    expect(res.sendFile).toHaveBeenCalledWith("/tmp/live-session-1.webm");
  });
});

describe("live conversation draft fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds a local draft when the model request fails", async () => {
    const websocket = new LiveConversationWebSocket({ debug: false });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("fetch failed");
    }));

    const transcript = "this is a conversation between the doctor and the patient hey hi what happened oh I am suffering from fever since last night oh that's okay don't panic I'll help you let me look into a temperature okay the temperature is 100 degrees you have mild fever do not worry I want to cough I feel nauseous I'm giving you a medicine dolo 650 for five days three times a day have it continuously also take pan 40 every day in the morning before you eat anything I will review you after five days take care";

    const draft = await websocket.generateDraftExtraction(transcript, {
      id: "live-session-1",
    });

    expect(draft.diagnosis).toMatch(/mild fever|fever/i);
    expect(draft.symptoms).toEqual(expect.arrayContaining(["Fever", "Cough", "Nausea"]));
    expect(draft.medications).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Dolo 650" }),
      expect.objectContaining({ name: "Pan 40" }),
    ]));
    expect(draft.followUp).toEqual(expect.arrayContaining(["Review after five days"]));
    expect(draft.plan.length).toBeGreaterThan(0);
  });
});

describe("live conversation final backfill", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("backfills transcript and draft from the combined recording before review", async () => {
    const websocket = new LiveConversationWebSocket({ debug: false });
    const session = {
      id: "live-session-final-backfill",
      status: "live",
      linkedPatient: "Anita Rao",
      encounterLabel: "Follow-up",
      createdBy: { id: "admin", username: "admin", role: "admin" },
      startedAt: "2026-05-27T10:30:00Z",
      updatedAt: "2026-05-27T10:30:05Z",
      endedAt: null,
      audio: {
        mimeType: "audio/mp4",
        chunkCount: 4,
        totalBytes: 4096,
        combinedPath: null,
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
      transport: { connectionState: "connected", lastError: null, lastEventAt: null },
      error: null,
    };

    websocket.store = {
      get: vi.fn(async () => ({ ...session })),
      update: vi.fn(async (_id: string, updates: any) => {
        Object.assign(session, updates, { updatedAt: "2026-05-27T10:30:30Z" });
        return { ...session };
      }),
      replaceTranscript: vi.fn(async (_id: string, transcript: any) => {
        session.transcript = {
          segments: transcript.segments,
          rawText: transcript.rawText,
          normalizedText: transcript.normalizedText,
          speakers: transcript.speakers || [],
          quality: transcript.quality,
        };
        return { ...session };
      }),
      updateDraftExtraction: vi.fn(async (_id: string, draft: any) => {
        session.draftExtraction = {
          ...(session.draftExtraction || {}),
          extractedData: draft,
        };
        return { ...session };
      }),
      logEvent: vi.fn(async () => undefined),
    } as any;

    websocket.flushAudioBuffer = vi.fn(async () => null);
    websocket.transcribeChunk = vi.fn(async () => undefined);
    websocket.combineAudioChunks = vi.fn(async () => "/tmp/live-session-final-backfill.mp4");
    websocket.sttAgent = {
      execute: vi.fn(async () => ({
        success: true,
        backend: "whisper_direct",
        data: {
          rawText: "Patient reports fever and cough. Start paracetamol. Review in five days.",
          normalizedText: "Patient reports fever and cough. Start paracetamol. Review in five days.",
          speakers: [],
          segments: [
            {
              id: "seg-1",
              speakerRole: "unknown",
              speakerLabel: "Unknown",
              startLabel: "00:00",
              endLabel: "00:30",
              text: "Patient reports fever and cough. Start paracetamol. Review in five days.",
              normalizedText: "Patient reports fever and cough. Start paracetamol. Review in five days.",
              flags: ["live_stream"],
            },
          ],
          quality: {
            overallConfidence: 0.9,
            lowConfidenceSegmentCount: 0,
            speakerAmbiguityCount: 1,
            overlappingSpeechSuspected: false,
          },
        },
      })),
    } as any;
    websocket.generateDraftExtraction = vi.fn(async () => ({
      diagnosis: "Respiratory infection",
      symptoms: ["Fever", "Cough"],
      medications: [
        { name: "Paracetamol", instruction: "As needed", status: "draft" },
      ],
      labs: [],
      radiology: [],
      procedures: [],
      followUp: ["Review in five days"],
      plan: ["Start paracetamol"],
    }));

    const ws = createFakeWs();
    websocket.sessions.set(session.id, ws as any);

    await websocket.handleEnd(session.id);

    expect(websocket.sttAgent.execute).toHaveBeenCalledWith({
      audioPath: "/tmp/live-session-final-backfill.mp4",
      options: expect.objectContaining({
        mimeType: "audio/mp4",
      }),
    });
    expect(websocket.store.replaceTranscript).toHaveBeenCalled();
    expect(websocket.store.updateDraftExtraction).toHaveBeenCalled();
    expect(session.transcript.rawText).toContain("Patient reports fever and cough");
    expect(session.draftExtraction.extractedData?.diagnosis).toBe("Respiratory infection");
    expect(session.status).toBe("review_required");
    expect(session.audio.combinedPath).toBe("/tmp/live-session-final-backfill.mp4");
    expect(ws.sent.at(-1)).toMatchObject({
      type: "session.state",
      sessionId: session.id,
      status: "review_required",
    });
  });
});
