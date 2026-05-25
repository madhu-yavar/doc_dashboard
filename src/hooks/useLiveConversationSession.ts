import { useEffect, useReducer } from "react";

export type LiveSpeakerRole = "doctor" | "patient" | "unknown";
export type LiveConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";
export type LiveCaptureState = "idle" | "starting" | "recording" | "paused" | "stopping" | "failed";
export type LiveSessionStatus = "draft" | "live" | "paused" | "review_required" | "finalizing" | "finalized" | "failed";
export type LiveReviewResolution = "pending" | "approved" | "edited" | "rejected";

export type LiveDeviceOption = {
  id: string;
  label: string;
};

export type LiveTranscriptSegment = {
  id: string;
  speakerRole: LiveSpeakerRole;
  speakerLabel: string;
  startLabel: string;
  endLabel: string;
  text: string;
  confidence: number | null;
  flags: string[];
  status: "interim" | "final";
};

export type LiveReviewItem = {
  id: string;
  category: "transcript" | "medication" | "follow_up";
  severity: "low" | "medium" | "high";
  title: string;
  extractedValue: string;
  suggestedValue: string;
  resolution: LiveReviewResolution;
  editedValue?: string;
};

export type LiveDraftExtraction = {
  diagnosis: string;
  symptoms: string[];
  medications: Array<{ name: string; instruction: string; status: "draft" | "needs_review" }>;
  labs: string[];
  radiology: string[];
  procedures: string[];
  followUp: string[];
  plan: string[];
};

export type LiveConversationSession = {
  id: string;
  title: string;
  status: LiveSessionStatus;
  linkedPatient: string;
  encounterLabel: string;
  startedAt: string | null;
  updatedAt: string;
  endedAt: string | null;
  durationMs: number;
  documentId: string | null;
  transport: {
    connectionState: LiveConnectionState;
    lastError: string | null;
    lastEventAt: string | null;
  };
  recorder: {
    permission: "unknown" | "granted" | "denied";
    deviceId: string | null;
    deviceLabel: string;
    captureState: LiveCaptureState;
  };
  transcript: {
    segments: LiveTranscriptSegment[];
    interimText: string;
    hasGap: boolean;
  };
  draft: {
    extractedData: LiveDraftExtraction;
    reviewItems: LiveReviewItem[];
    lastUpdatedAt: string | null;
  };
  error: string | null;
  nextScriptIndex: number;
};

type LiveConversationState = {
  availableDevices: LiveDeviceOption[];
  sessions: LiveConversationSession[];
  selectedSessionId: string | null;
};

type Action =
  | { type: "select_session"; sessionId: string }
  | { type: "create_draft_session" }
  | { type: "return_to_draft" }
  | { type: "update_selected_session"; linkedPatient?: string; encounterLabel?: string; deviceId?: string }
  | { type: "start_selected_session" }
  | { type: "pause_selected_session" }
  | { type: "resume_selected_session" }
  | { type: "stop_selected_session" }
  | { type: "set_interim_text"; text: string }
  | { type: "commit_script_segment"; segment: LiveTranscriptSegment; draft: LiveDraftExtraction }
  | { type: "resolve_review_item"; reviewItemId: string; resolution: LiveReviewResolution; editedValue?: string }
  | { type: "begin_finalize" }
  | { type: "complete_finalize" }
  | { type: "tick_duration" };

const MOCK_DEVICES: LiveDeviceOption[] = [
  { id: "built-in-mic", label: "Built-in Microphone" },
  { id: "room-array", label: "Consult Room Array Mic" },
  { id: "headset-mic", label: "Clinician Headset Mic" },
];

const MOCK_SCRIPT = [
  {
    speakerRole: "doctor" as const,
    speakerLabel: "Doctor",
    text: "Good morning. This is a follow-up review for Anita Rao. She has had cough and low-grade fever for three days.",
    confidence: 0.98,
    flags: ["symptoms"],
  },
  {
    speakerRole: "patient" as const,
    speakerLabel: "Patient",
    text: "Fever is better today, but I still feel tired and breathless when walking.",
    confidence: 0.95,
    flags: ["symptoms"],
  },
  {
    speakerRole: "doctor" as const,
    speakerLabel: "Doctor",
    text: "Continue azithromycin 500 milligrams once daily for three more days and paracetamol as needed.",
    confidence: 0.77,
    flags: ["medication", "dosage", "low_confidence"],
  },
  {
    speakerRole: "doctor" as const,
    speakerLabel: "Doctor",
    text: "Order a complete blood count and a chest X-ray today.",
    confidence: 0.93,
    flags: ["labs", "radiology"],
  },
  {
    speakerRole: "doctor" as const,
    speakerLabel: "Doctor",
    text: "Review again in pulmonology clinic after five days if symptoms persist.",
    confidence: 0.88,
    flags: ["follow_up"],
  },
] as const;

function createDraftFromProgress(segmentCount: number): LiveDraftExtraction {
  return {
    diagnosis: segmentCount >= 2 ? "Respiratory infection under review" : "",
    symptoms: segmentCount >= 1 ? ["Cough", "Low-grade fever"] : [],
    medications: segmentCount >= 3 ? [
      {
        name: "Azithromycin",
        instruction: "500 mg once daily for three more days",
        status: "needs_review",
      },
      {
        name: "Paracetamol",
        instruction: "As needed for fever",
        status: "draft",
      },
    ] : [],
    labs: segmentCount >= 4 ? ["Complete blood count"] : [],
    radiology: segmentCount >= 4 ? ["Chest X-ray"] : [],
    procedures: [],
    followUp: segmentCount >= 5 ? ["Pulmonology clinic review in five days if symptoms persist"] : [],
    plan: segmentCount >= 5 ? [
      "Continue current treatment for three more days",
      "Check CBC and chest X-ray today",
    ] : [],
  };
}

function createReviewItems(): LiveReviewItem[] {
  return [
    {
      id: "review-med-1",
      category: "medication",
      severity: "medium",
      title: "Confirm azithromycin duration and spoken dosage",
      extractedValue: "Azithromycin 500 mg once daily",
      suggestedValue: "Azithromycin 500 mg once daily for three more days",
      resolution: "pending",
    },
    {
      id: "review-follow-1",
      category: "follow_up",
      severity: "low",
      title: "Confirm follow-up timing and clinic context",
      extractedValue: "Pulmonology review",
      suggestedValue: "Pulmonology clinic review in five days if symptoms persist",
      resolution: "pending",
    },
  ];
}

function createTranscriptSegment(index: number): LiveTranscriptSegment {
  const item = MOCK_SCRIPT[index];
  const startSeconds = index * 18;
  const endSeconds = startSeconds + 15;
  const toLabel = (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return {
    id: `live-seg-${index + 1}`,
    speakerRole: item.speakerRole,
    speakerLabel: item.speakerLabel,
    startLabel: toLabel(startSeconds),
    endLabel: toLabel(endSeconds),
    text: item.text,
    confidence: item.confidence,
    flags: [...item.flags],
    status: "final",
  };
}

function createSession(overrides: Partial<LiveConversationSession> = {}): LiveConversationSession {
  const now = new Date().toISOString();
  const device = MOCK_DEVICES[0];
  return {
    id: `live-session-${Math.random().toString(36).slice(2, 10)}`,
    title: "Live conversation draft",
    status: "draft",
    linkedPatient: "",
    encounterLabel: "",
    startedAt: null,
    updatedAt: now,
    endedAt: null,
    durationMs: 0,
    documentId: null,
    transport: {
      connectionState: "idle",
      lastError: null,
      lastEventAt: null,
    },
    recorder: {
      permission: "unknown",
      deviceId: device.id,
      deviceLabel: device.label,
      captureState: "idle",
    },
    transcript: {
      segments: [],
      interimText: "",
      hasGap: false,
    },
    draft: {
      extractedData: createDraftFromProgress(0),
      reviewItems: [],
      lastUpdatedAt: null,
    },
    error: null,
    nextScriptIndex: 0,
    ...overrides,
  };
}

const initialDraft = createSession({
  linkedPatient: "Anita Rao",
  encounterLabel: "Pulmonology follow-up",
  title: "Anita Rao",
});

const finalizedPreview = createSession({
  id: "live-session-finalized-preview",
  title: "Nikhil Varma",
  status: "finalized",
  linkedPatient: "Nikhil Varma",
  encounterLabel: "General medicine review",
  startedAt: "2026-05-21T05:30:00.000Z",
  updatedAt: "2026-05-21T05:41:00.000Z",
  endedAt: "2026-05-21T05:39:00.000Z",
  durationMs: 9 * 60 * 1000,
  documentId: "mock-live-document-1001",
  transport: {
    connectionState: "closed",
    lastError: null,
    lastEventAt: "2026-05-21T05:39:00.000Z",
  },
  recorder: {
    permission: "granted",
    deviceId: "room-array",
    deviceLabel: "Consult Room Array Mic",
    captureState: "idle",
  },
  transcript: {
    segments: [createTranscriptSegment(0), createTranscriptSegment(1), createTranscriptSegment(2)],
    interimText: "",
    hasGap: false,
  },
  draft: {
    extractedData: createDraftFromProgress(5),
    reviewItems: [],
    lastUpdatedAt: "2026-05-21T05:38:00.000Z",
  },
  nextScriptIndex: MOCK_SCRIPT.length,
});

const failedPreview = createSession({
  id: "live-session-failed-preview",
  title: "Ward round recovery",
  status: "failed",
  linkedPatient: "Room 412 consult",
  encounterLabel: "Interrupted capture",
  updatedAt: "2026-05-20T09:15:00.000Z",
  error: "The browser session was closed before the microphone stream stabilized.",
  transport: {
    connectionState: "error",
    lastError: "Microphone stream ended unexpectedly",
    lastEventAt: "2026-05-20T09:15:00.000Z",
  },
  recorder: {
    permission: "granted",
    deviceId: "built-in-mic",
    deviceLabel: "Built-in Microphone",
    captureState: "failed",
  },
});

const initialState: LiveConversationState = {
  availableDevices: MOCK_DEVICES,
  sessions: [initialDraft, finalizedPreview, failedPreview],
  selectedSessionId: initialDraft.id,
};

function updateSelected(
  state: LiveConversationState,
  updater: (session: LiveConversationSession) => LiveConversationSession,
) {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === state.selectedSessionId ? updater(session) : session,
    ),
  };
}

function sessionTitle(linkedPatient: string, encounterLabel: string) {
  if (linkedPatient.trim()) return linkedPatient.trim();
  if (encounterLabel.trim()) return encounterLabel.trim();
  return "Live conversation draft";
}

function reducer(state: LiveConversationState, action: Action): LiveConversationState {
  switch (action.type) {
    case "select_session":
      return { ...state, selectedSessionId: action.sessionId };
    case "create_draft_session": {
      const created = createSession();
      return {
        ...state,
        sessions: [created, ...state.sessions],
        selectedSessionId: created.id,
      };
    }
    case "return_to_draft": {
      const existingDraft = state.sessions.find((session) => session.status === "draft");
      if (existingDraft) {
        return { ...state, selectedSessionId: existingDraft.id };
      }
      const created = createSession();
      return {
        ...state,
        sessions: [created, ...state.sessions],
        selectedSessionId: created.id,
      };
    }
    case "update_selected_session":
      return updateSelected(state, (session) => {
        const device = state.availableDevices.find((item) => item.id === action.deviceId) || state.availableDevices[0];
        const linkedPatient = action.linkedPatient ?? session.linkedPatient;
        const encounterLabel = action.encounterLabel ?? session.encounterLabel;
        return {
          ...session,
          title: sessionTitle(linkedPatient, encounterLabel),
          linkedPatient,
          encounterLabel,
          updatedAt: new Date().toISOString(),
          recorder: {
            ...session.recorder,
            deviceId: action.deviceId === undefined ? session.recorder.deviceId : device.id,
            deviceLabel: action.deviceId === undefined ? session.recorder.deviceLabel : device.label,
          },
        };
      });
    case "start_selected_session":
      return updateSelected(state, (session) => ({
        ...session,
        status: "live",
        startedAt: session.startedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        endedAt: null,
        error: null,
        transport: {
          connectionState: "connecting",
          lastError: null,
          lastEventAt: new Date().toISOString(),
        },
        recorder: {
          ...session.recorder,
          permission: "granted",
          captureState: "starting",
        },
      }));
    case "pause_selected_session":
      return updateSelected(state, (session) => ({
        ...session,
        status: "paused",
        updatedAt: new Date().toISOString(),
        transport: {
          ...session.transport,
          connectionState: "connected",
          lastEventAt: new Date().toISOString(),
        },
        recorder: {
          ...session.recorder,
          captureState: "paused",
        },
      }));
    case "resume_selected_session":
      return updateSelected(state, (session) => ({
        ...session,
        status: "live",
        updatedAt: new Date().toISOString(),
        transport: {
          ...session.transport,
          connectionState: "connected",
          lastEventAt: new Date().toISOString(),
        },
        recorder: {
          ...session.recorder,
          captureState: "recording",
        },
      }));
    case "stop_selected_session":
      return updateSelected(state, (session) => ({
        ...session,
        status: "review_required",
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        transport: {
          ...session.transport,
          connectionState: "closed",
          lastEventAt: new Date().toISOString(),
        },
        recorder: {
          ...session.recorder,
          captureState: "idle",
        },
        transcript: {
          ...session.transcript,
          interimText: "",
        },
        draft: {
          ...session.draft,
          reviewItems: createReviewItems(),
          lastUpdatedAt: new Date().toISOString(),
        },
      }));
    case "set_interim_text":
      return updateSelected(state, (session) => ({
        ...session,
        updatedAt: new Date().toISOString(),
        transport: {
          ...session.transport,
          connectionState: "connected",
          lastEventAt: new Date().toISOString(),
        },
        recorder: {
          ...session.recorder,
          captureState: "recording",
        },
        transcript: {
          ...session.transcript,
          interimText: action.text,
        },
      }));
    case "commit_script_segment":
      return updateSelected(state, (session) => ({
        ...session,
        updatedAt: new Date().toISOString(),
        nextScriptIndex: session.nextScriptIndex + 1,
        transport: {
          ...session.transport,
          connectionState: "connected",
          lastEventAt: new Date().toISOString(),
        },
        recorder: {
          ...session.recorder,
          captureState: "recording",
        },
        transcript: {
          ...session.transcript,
          segments: [...session.transcript.segments, action.segment],
          interimText: "",
          hasGap: session.nextScriptIndex >= 2,
        },
        draft: {
          ...session.draft,
          extractedData: action.draft,
          lastUpdatedAt: new Date().toISOString(),
        },
      }));
    case "resolve_review_item":
      return updateSelected(state, (session) => ({
        ...session,
        updatedAt: new Date().toISOString(),
        draft: {
          ...session.draft,
          reviewItems: session.draft.reviewItems.map((item) =>
            item.id === action.reviewItemId
              ? {
                  ...item,
                  resolution: action.resolution,
                  editedValue: action.resolution === "edited" ? action.editedValue || item.suggestedValue : item.editedValue,
                }
              : item,
          ),
        },
      }));
    case "begin_finalize":
      return updateSelected(state, (session) => ({
        ...session,
        status: "finalizing",
        updatedAt: new Date().toISOString(),
      }));
    case "complete_finalize":
      return updateSelected(state, (session) => ({
        ...session,
        status: "finalized",
        updatedAt: new Date().toISOString(),
        documentId: session.documentId || `mock-live-document-${session.id.split("-").pop()}`,
        transport: {
          ...session.transport,
          connectionState: "closed",
        },
      }));
    case "tick_duration":
      return updateSelected(state, (session) => ({
        ...session,
        durationMs: session.durationMs + 1000,
      }));
    default:
      return state;
  }
}

export function formatLiveDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function useLiveConversationSession() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const selectedSession = state.sessions.find((session) => session.id === state.selectedSessionId) || null;

  useEffect(() => {
    if (!selectedSession || selectedSession.status !== "live" || selectedSession.nextScriptIndex >= MOCK_SCRIPT.length) {
      return;
    }

    const nextSegment = MOCK_SCRIPT[selectedSession.nextScriptIndex];
    const interimTimer = window.setTimeout(() => {
      dispatch({ type: "set_interim_text", text: nextSegment.text });
    }, 250);
    const commitTimer = window.setTimeout(() => {
      dispatch({
        type: "commit_script_segment",
        segment: createTranscriptSegment(selectedSession.nextScriptIndex),
        draft: createDraftFromProgress(selectedSession.nextScriptIndex + 1),
      });
    }, 1350);

    return () => {
      window.clearTimeout(interimTimer);
      window.clearTimeout(commitTimer);
    };
  }, [selectedSession?.id, selectedSession?.status, selectedSession?.nextScriptIndex]);

  useEffect(() => {
    if (!selectedSession || selectedSession.status !== "live") {
      return;
    }

    const timer = window.setInterval(() => {
      dispatch({ type: "tick_duration" });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [selectedSession?.id, selectedSession?.status]);

  useEffect(() => {
    if (!selectedSession || selectedSession.status !== "finalizing") {
      return;
    }

    const timer = window.setTimeout(() => {
      dispatch({ type: "complete_finalize" });
    }, 1400);

    return () => window.clearTimeout(timer);
  }, [selectedSession?.id, selectedSession?.status]);

  const hasPendingReview = (selectedSession?.draft.reviewItems || []).some((item) => item.resolution === "pending");

  return {
    isPreview: true,
    availableDevices: state.availableDevices,
    sessions: state.sessions,
    selectedSession,
    selectedSessionId: state.selectedSessionId,
    hasPendingReview,
    createDraftSession: () => dispatch({ type: "create_draft_session" }),
    selectSession: (sessionId: string) => dispatch({ type: "select_session", sessionId }),
    returnToDraft: () => dispatch({ type: "return_to_draft" }),
    updateSelectedSession: (patch: { linkedPatient?: string; encounterLabel?: string; deviceId?: string }) =>
      dispatch({ type: "update_selected_session", ...patch }),
    startSelectedSession: () => dispatch({ type: "start_selected_session" }),
    pauseSelectedSession: () => dispatch({ type: "pause_selected_session" }),
    resumeSelectedSession: () => dispatch({ type: "resume_selected_session" }),
    stopSelectedSession: () => dispatch({ type: "stop_selected_session" }),
    resolveReviewItem: (reviewItemId: string, resolution: LiveReviewResolution, editedValue?: string) =>
      dispatch({ type: "resolve_review_item", reviewItemId, resolution, editedValue }),
    finalizeSelectedSession: () => dispatch({ type: "begin_finalize" }),
  };
}
