import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveConversationAudio } from "./useLiveConversationAudio";

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
  category: "transcript" | "medication" | "follow_up" | "demographics" | "vitals";
  severity: "low" | "medium" | "high";
  title: string;
  extractedValue: string;
  suggestedValue: string;
  resolution: LiveReviewResolution;
  editedValue?: string;
  required?: boolean;
  fieldPath?: string;
  placeholder?: string;
  inputType?: "text" | "number";
};

export type LiveDraftExtraction = {
  chiefComplaint: string;
  hpi: string;
  ros: string[];
  diagnosis: string;
  symptoms: string[];
  medications: Array<{ name: string; instruction: string; status: "draft" | "needs_review" }>;
  labs: string[];
  radiology: string[];
  procedures: string[];
  followUp: string[];
  plan: string[];
  patient: {
    name: string;
    age: number | null;
    gender: string;
  };
  vitals: {
    latest: {
      bp: {
        systolic: number | null;
        diastolic: number | null;
      };
      pulse: {
        value: number | null;
        unit: string;
      };
      temperature: {
        value: number | null;
        unit: string;
      };
      spo2: {
        value: number | null;
        unit: string;
      };
      weight: {
        value: number | null;
        unit: string;
      };
    };
  };
};

/**
 * Empty draft object to prevent null dereference crashes
 */
const EMPTY_DRAFT: LiveDraftExtraction = {
  chiefComplaint: "",
  hpi: "",
  ros: [],
  diagnosis: "",
  symptoms: [],
  medications: [],
  labs: [],
  radiology: [],
  procedures: [],
  followUp: [],
  plan: [],
  patient: {
    name: "",
    age: null,
    gender: "",
  },
  vitals: {
    latest: {
      bp: {
        systolic: null,
        diastolic: null,
      },
      pulse: {
        value: null,
        unit: "bpm",
      },
      temperature: {
        value: null,
        unit: "F",
      },
      spo2: {
        value: null,
        unit: "%",
      },
      weight: {
        value: null,
        unit: "kg",
      },
    },
  },
};

function normalizeTranscriptSegment(segment: any): LiveTranscriptSegment {
  return {
    id: String(segment?.id || `seg-${Math.random().toString(36).slice(2, 10)}`),
    speakerRole: segment?.speakerRole || "unknown",
    speakerLabel: segment?.speakerLabel || "Unknown",
    startLabel: segment?.startLabel || "",
    endLabel: segment?.endLabel || "",
    text: String(segment?.text || ""),
    confidence: typeof segment?.confidence === "number" ? segment.confidence : null,
    flags: Array.isArray(segment?.flags) ? segment.flags.filter((flag: unknown) => typeof flag === "string") : [],
    status: segment?.status === "interim" ? "interim" : "final",
  };
}

function deriveEncounterNumber(sessionId: string): string {
  const digits = String(sessionId || "").replace(/\D/g, "");
  if (!digits) return "EN000001";
  return `EN${digits.slice(-6).padStart(6, "0")}`;
}

function deriveEncounterLabel(sessionId: string, _encounterLabel: string): string {
  return deriveEncounterNumber(sessionId);
}

function normalizeTranscriptState(rawTranscript: any) {
  const normalizedSegments = Array.isArray(rawTranscript?.segments)
    ? rawTranscript.segments.map(normalizeTranscriptSegment)
    : [];

  return {
    ...rawTranscript,
    segments: normalizedSegments,
    rawText: String(rawTranscript?.rawText || ""),
    normalizedText: String(rawTranscript?.normalizedText || rawTranscript?.rawText || ""),
    speakers: Array.isArray(rawTranscript?.speakers) ? rawTranscript.speakers : [],
    quality: {
      overallConfidence: typeof rawTranscript?.quality?.overallConfidence === "number" ? rawTranscript.quality.overallConfidence : null,
      lowConfidenceSegmentCount: Number(rawTranscript?.quality?.lowConfidenceSegmentCount || 0),
      speakerAmbiguityCount: Number(rawTranscript?.quality?.speakerAmbiguityCount || 0),
      overlappingSpeechSuspected: Boolean(rawTranscript?.quality?.overlappingSpeechSuspected),
    },
    hasGap: Boolean(rawTranscript?.hasGap),
    interimText: String(rawTranscript?.interimText || ""),
  };
}

export type LiveConversationSession = {
  id: string;
  status: LiveSessionStatus;
  linkedPatient: string;
  encounterLabel: string;
  createdBy: { id: string; username: string; role: string };
  startedAt: string | null;
  updatedAt: string;
  endedAt: string | null;
  durationMs: number;
  documentId: string | null;
  audio: {
    mimeType: string;
    chunkCount: number;
    combinedPath?: string | null;
  };
  transcript: {
    segments: LiveTranscriptSegment[];
    rawText: string;
    normalizedText: string;
    speakers: Array<{ id: string; label: string; role: LiveSpeakerRole; confidence: number | null }>;
    quality: {
      overallConfidence: number | null;
      lowConfidenceSegmentCount: number;
      speakerAmbiguityCount: number;
      overlappingSpeechSuspected: boolean;
    };
    hasGap: boolean;
    interimText: string;
  };
  draftExtraction: {
    extractedData: LiveDraftExtraction | null;
    reviewItems: LiveReviewItem[];
    lastStableSegmentId: string | null;
  };
  error: string | null;
  transport: {
    connectionState: LiveConnectionState;
    lastError: string | null;
    lastEventAt: string | null;
  };
} & {
  // Computed/normalized fields for UI compatibility
  title: string;
  draft: {
    extractedData: LiveDraftExtraction | null;
    reviewItems: LiveReviewItem[];
  };
  recorder: {
    permission: PermissionState;
    deviceId: string | null;
    deviceLabel: string;
  };
};

const API_BASE = "/api/voice/live";

/**
 * Normalize the API response to include computed fields for UI compatibility
 */
function normalizeSession(session: any): LiveConversationSession {
  const baseSession = { ...session };
  const rawTranscript = baseSession.transcript || {};
  const normalizedDraftExtraction = baseSession.draftExtraction?.extractedData || {};
  const transcript = normalizeTranscriptState(rawTranscript);
  const encounterLabel = deriveEncounterLabel(baseSession.id || "", baseSession.encounterLabel || "");

  return {
    ...baseSession,
    // Computed title from patient and encounter
    get title() {
      return sessionTitle(
        baseSession.linkedPatient || normalizedDraftExtraction?.patient?.name || "",
        encounterLabel,
      );
    },
    // Normalize transcript to add missing UI fields
    transcript,
    // Normalize draftExtraction to draft for UI - use empty draft to prevent null crashes
    draft: {
      extractedData: {
        ...EMPTY_DRAFT,
        ...(baseSession.draftExtraction?.extractedData || {}),
        patient: {
          ...EMPTY_DRAFT.patient,
          ...(baseSession.draftExtraction?.extractedData?.patient || {}),
        },
        vitals: {
          ...EMPTY_DRAFT.vitals,
          ...(baseSession.draftExtraction?.extractedData?.vitals || {}),
          latest: {
            ...EMPTY_DRAFT.vitals.latest,
            ...(baseSession.draftExtraction?.extractedData?.vitals?.latest || {}),
            bp: {
              ...EMPTY_DRAFT.vitals.latest.bp,
              ...(baseSession.draftExtraction?.extractedData?.vitals?.latest?.bp || {}),
            },
            pulse: {
              ...EMPTY_DRAFT.vitals.latest.pulse,
              ...(baseSession.draftExtraction?.extractedData?.vitals?.latest?.pulse || {}),
            },
            temperature: {
              ...EMPTY_DRAFT.vitals.latest.temperature,
              ...(baseSession.draftExtraction?.extractedData?.vitals?.latest?.temperature || {}),
            },
            spo2: {
              ...EMPTY_DRAFT.vitals.latest.spo2,
              ...(baseSession.draftExtraction?.extractedData?.vitals?.latest?.spo2 || {}),
            },
            weight: {
              ...EMPTY_DRAFT.vitals.latest.weight,
              ...(baseSession.draftExtraction?.extractedData?.vitals?.latest?.weight || {}),
            },
          },
        },
      },
      reviewItems: baseSession.draftExtraction?.reviewItems || [],
    },
    // Normalize audio/transport to recorder for UI - will be synced via effect
    recorder: {
      permission: "prompt",
      deviceId: null,
      deviceLabel: "",
    },
    audio: {
      mimeType: baseSession.audio?.mimeType || "audio/webm",
      chunkCount: Number(baseSession.audio?.chunkCount || 0),
      combinedPath: baseSession.audio?.combinedPath || null,
    },
    transport: {
      connectionState: baseSession.transport?.connectionState || "idle",
      lastError: baseSession.transport?.lastError || null,
      lastEventAt: baseSession.transport?.lastEventAt || null,
    },
  };
}

async function apiFetch(endpoint: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || error.message || "API request failed");
  }

  return response.json();
}

export function formatLiveDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function sessionTitle(linkedPatient: string, encounterLabel: string): string {
  if (linkedPatient.trim()) return linkedPatient.trim();
  if (encounterLabel.trim()) return encounterLabel.trim();
  return "New conversation";
}

export function useLiveConversationAPI() {
  const [sessions, setSessions] = useState<LiveConversationSession[]>([]);
  const sessionsRef = useRef<LiveConversationSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep sessionsRef in sync with sessions state for polling interval
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const audio = useLiveConversationAudio({
    enableDebugLogs: process.env.NODE_ENV === "development",
    onTranscriptPartial: (transcript) => {
      setSessions((prevSessions) =>
        prevSessions.map((s) => {
          if (s.id === selectedSessionId) {
            return {
              ...s,
              transcript: normalizeTranscriptState(transcript),
            };
          }
          return s;
        }),
      );
    },
    onTranscriptFinal: (segment) => {
      // Merge realtime transcript into the session state
      setSessions((prevSessions) =>
        prevSessions.map((s) => {
          if (s.id === selectedSessionId) {
            const existing = s.transcript.segments.find((seg) => seg.id === segment.id);
            if (!existing) {
              return {
                ...s,
                transcript: {
                  ...s.transcript,
                  segments: [...s.transcript.segments, segment],
                  rawText: s.transcript.rawText + " " + segment.text,
                  normalizedText: s.transcript.normalizedText + " " + segment.text,
                },
              };
            }
          }
          return s;
        })
      );
    },
    onDraftUpdated: (draft) => {
      // Merge realtime draft into the session state
      setSessions((prevSessions) =>
        prevSessions.map((s) => {
          if (s.id === selectedSessionId) {
            return {
              ...s,
              draft: {
                ...s.draft,
                extractedData: {
                  ...s.draft.extractedData,
                  ...draft,
                  patient: {
                    ...s.draft.extractedData.patient,
                    ...(draft?.patient || {}),
                  },
                  vitals: {
                    ...s.draft.extractedData.vitals,
                    ...(draft?.vitals || {}),
                    latest: {
                      ...s.draft.extractedData.vitals.latest,
                      ...(draft?.vitals?.latest || {}),
                      bp: {
                        ...s.draft.extractedData.vitals.latest.bp,
                        ...(draft?.vitals?.latest?.bp || {}),
                      },
                      pulse: {
                        ...s.draft.extractedData.vitals.latest.pulse,
                        ...(draft?.vitals?.latest?.pulse || {}),
                      },
                      temperature: {
                        ...s.draft.extractedData.vitals.latest.temperature,
                        ...(draft?.vitals?.latest?.temperature || {}),
                      },
                      spo2: {
                        ...s.draft.extractedData.vitals.latest.spo2,
                        ...(draft?.vitals?.latest?.spo2 || {}),
                      },
                      weight: {
                        ...s.draft.extractedData.vitals.latest.weight,
                        ...(draft?.vitals?.latest?.weight || {}),
                      },
                    },
                  },
                },
              },
            };
          }
          return s;
        })
      );
    },
    onSessionStateChange: (status) => {
      // Trigger a session refresh when state changes
      if (selectedSessionId && ["live", "paused", "review_required"].includes(status)) {
        loadSessions();
      }
    },
  });

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) || null;

  const resolveRecorderState = useCallback((currentRecorder?: LiveConversationSession["recorder"]) => {
    const deviceLabel = audio.selectedDevice && audio.devices.length > 0
      ? (audio.devices.find((device) => device.deviceId === audio.selectedDevice)?.label || audio.selectedDevice)
      : currentRecorder?.deviceLabel || "";

    return {
      permission: audio.permissionState,
      deviceId: audio.selectedDevice,
      deviceLabel,
    };
  }, [audio.devices, audio.permissionState, audio.selectedDevice]);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/sessions");
      const normalizedSessions = (data.sessions || []).map((session: any) => {
        const normalized = normalizeSession(session);
        const existing = sessionsRef.current.find((currentSession) => currentSession.id === normalized.id);

        if (normalized.id === selectedSessionId) {
          return {
            ...normalized,
            recorder: resolveRecorderState(existing?.recorder),
          };
        }

        if (existing) {
          return {
            ...normalized,
            recorder: existing.recorder,
          };
        }

        return normalized;
      });
      setSessions(normalizedSessions);
      setSelectedSessionId((currentSelectedSessionId) => {
        if (currentSelectedSessionId && normalizedSessions.some((session) => session.id === currentSelectedSessionId)) {
          return currentSelectedSessionId;
        }
        return normalizedSessions[0]?.id || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setIsLoading(false);
    }
  }, [resolveRecorderState, selectedSessionId]);

  const createSession = useCallback(async (params?: { linkedPatient?: string; encounterLabel?: string }) => {
    setIsLoading(true);
    setError(null);
    try {
      const safeParams =
        params && typeof params === "object" && !("nativeEvent" in params)
          ? {
              linkedPatient: typeof params.linkedPatient === "string" ? params.linkedPatient : undefined,
              encounterLabel: typeof params.encounterLabel === "string" ? params.encounterLabel : undefined,
            }
          : {};
      const data = await apiFetch("/sessions", {
        method: "POST",
        body: JSON.stringify(safeParams),
      });
      const normalized = normalizeSession(data);
      await loadSessions();
      setSelectedSessionId(normalized.id);
      return normalized;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loadSessions]);

  const getSession = useCallback(async (sessionId: string) => {
    try {
      const data = await apiFetch(`/sessions/${sessionId}`);
      return normalizeSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get session");
      return null;
    }
  }, []);

  const updateSession = useCallback(async (sessionId: string, updates: { linkedPatient?: string; encounterLabel?: string; draftPatch?: Partial<LiveDraftExtraction> }) => {
    setIsLoading(true);
    setError(null);
    try {
      await apiFetch(`/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update session");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loadSessions]);

  const pauseSession = useCallback(async (sessionId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await apiFetch(`/sessions/${sessionId}/pause`, { method: "POST" });
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause session");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loadSessions]);

  const resumeSession = useCallback(async (sessionId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await apiFetch(`/sessions/${sessionId}/resume`, { method: "POST" });
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume session");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loadSessions]);

  const resolveReviewItem = useCallback(async (sessionId: string, reviewItemId: string, resolution: LiveReviewResolution, editedValue?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await apiFetch(`/sessions/${sessionId}/review`, {
        method: "POST",
        body: JSON.stringify({ reviewItemId, resolution, editedValue }),
      });
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve review item");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loadSessions]);

  const finalizeSession = useCallback(async (sessionId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/sessions/${sessionId}/finalize`, { method: "POST" });
      await loadSessions();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finalize session");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loadSessions]);

  const deleteSession = useCallback(async (sessionId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await apiFetch(`/sessions/${sessionId}`, { method: "DELETE" });
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete session");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loadSessions]);

  const startSession = useCallback(async (sessionId: string, deviceId?: string) => {
    setError(null);
    try {
      await audio.startSession(sessionId, deviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
      throw err;
    }
  }, [audio]);

  const pauseRecording = useCallback(() => {
    audio.pauseSession();
  }, [audio]);

  const resumeRecording = useCallback(() => {
    audio.resumeSession();
  }, [audio]);

  const endRecording = useCallback(async () => {
    await audio.endSession();
  }, [audio]);

  const disconnectAudio = useCallback(() => {
    audio.disconnect();
  }, [audio]);

  const hasPendingReview = (selectedSession?.draft?.reviewItems || [])
    .some((item) => item.resolution === "pending");

  useEffect(() => {
    loadSessions();

    // Poll for updates when a live/paused/review session is selected
    const interval = setInterval(() => {
      if (selectedSessionId) {
        // Use ref to get fresh sessions state, avoiding stale closure
        const currentSession = sessionsRef.current.find(s => s.id === selectedSessionId);
        if (currentSession && ["live", "paused", "review_required"].includes(currentSession.status)) {
          loadSessions();
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [loadSessions, selectedSessionId]);

  // Sync audio state to selected session's recorder field
  useEffect(() => {
    if (selectedSessionId) {
      setSessions((prevSessions) =>
        prevSessions.map((s) => {
          if (s.id === selectedSessionId) {
            const deviceLabel = audio.selectedDevice && audio.devices.length > 0
              ? (audio.devices.find(d => d.deviceId === audio.selectedDevice)?.label || audio.selectedDevice)
              : s.recorder.deviceLabel;

            return {
              ...s,
              recorder: {
                ...s.recorder,
                permission: audio.permissionState,
                deviceId: audio.selectedDevice,
                deviceLabel,
              },
              transport: {
                ...s.transport,
                connectionState: audio.connectionState,
              },
            };
          }
          return s;
        })
      );
    }
  }, [selectedSessionId, audio.permissionState, audio.selectedDevice, audio.devices, audio.connectionState]);

  return {
    isPreview: false,
    isLoading,
    error,
    sessions,
    selectedSession,
    selectedSessionId,
    hasPendingReview,
    availableDevices: audio.devices.map((d) => ({ id: d.deviceId, label: d.label || d.deviceId })),
    createDraftSession: createSession,
    selectSession: setSelectedSessionId,
    returnToDraft: () => {
      const draft = sessions.find((s) => s.status === "draft");
      if (draft) {
        setSelectedSessionId(draft.id);
      } else {
        createSession();
      }
    },
    updateSelectedSession: async (patch: { linkedPatient?: string; encounterLabel?: string; deviceId?: string; draftPatch?: Partial<LiveDraftExtraction> }) => {
      // Wire device selection to audio hook
      if (patch.deviceId !== undefined) {
        audio.selectDevice(patch.deviceId);
      }
      // Update server metadata or draft fields when needed.
      if (
        selectedSessionId
        && (
          patch.linkedPatient !== undefined
          || patch.encounterLabel !== undefined
          || patch.draftPatch !== undefined
        )
      ) {
        await updateSession(selectedSessionId, {
          linkedPatient: patch.linkedPatient,
          encounterLabel: patch.encounterLabel,
          draftPatch: patch.draftPatch,
        });
      }
    },
    startSelectedSession: async () => {
      if (selectedSessionId) {
        await getSession(selectedSessionId); // Refresh session data
        const deviceId = audio.selectedDevice || undefined;
        await startSession(selectedSessionId, deviceId);
        await loadSessions();
      }
    },
    pauseSelectedSession: async () => {
      if (selectedSessionId) {
        await pauseSession(selectedSessionId);
        pauseRecording();
      }
    },
    resumeSelectedSession: async () => {
      if (selectedSessionId) {
        await resumeSession(selectedSessionId);
        resumeRecording();
      }
    },
    stopSelectedSession: async () => {
      await endRecording();
      await loadSessions();
    },
    captureState: audio.recorderState,
    transportState: audio.connectionState,
    audioLevel: audio.audioLevel,
    disconnectAudio,
    resolveReviewItem: (reviewItemId: string, resolution: LiveReviewResolution, editedValue?: string) => {
      if (selectedSessionId) {
        resolveReviewItem(selectedSessionId, reviewItemId, resolution, editedValue);
      }
    },
    finalizeSelectedSession: async () => {
      if (selectedSessionId) {
        await finalizeSession(selectedSessionId);
      }
    },
    deleteSession,
    refreshSessions: loadSessions,
  };
}
