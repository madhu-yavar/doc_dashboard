import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useLiveConversationAudio", () => ({
  useLiveConversationAudio: vi.fn(),
}));

import { useLiveConversationAudio } from "@/hooks/useLiveConversationAudio";
import { useLiveConversationAPI } from "@/hooks/useLiveConversationAPI";

describe("useLiveConversationAPI", () => {
  const mockedUseLiveConversationAudio = vi.mocked(useLiveConversationAudio);
  let sessions: any[];
  let mockStartSession: ReturnType<typeof vi.fn>;
  let mockEndSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessions = [
      {
        id: "live-session-1",
        status: "draft",
        linkedPatient: "",
        encounterLabel: "",
        createdBy: {
          id: "user-1",
          username: "admin.user",
          role: "admin",
        },
        startedAt: null,
        updatedAt: "2026-05-27T09:27:00Z",
        endedAt: null,
        durationMs: 0,
        documentId: null,
        audio: {
          mimeType: "audio/webm;codecs=opus",
          chunkCount: 0,
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
          hasGap: false,
          interimText: "",
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
      },
    ];

    mockStartSession = vi.fn(async () => {
      sessions = [
        {
          ...sessions[0],
          status: "live",
          startedAt: "2026-05-27T09:28:00Z",
          updatedAt: "2026-05-27T09:28:00Z",
          transport: {
            connectionState: "connected",
            lastError: null,
            lastEventAt: "2026-05-27T09:28:00Z",
          },
        },
      ];
    });

    mockEndSession = vi.fn(async () => {
      sessions = [
        {
          ...sessions[0],
          status: "review_required",
          endedAt: "2026-05-27T09:29:00Z",
          updatedAt: "2026-05-27T09:29:00Z",
          transport: {
            connectionState: "closed",
            lastError: null,
            lastEventAt: "2026-05-27T09:29:00Z",
          },
        },
      ];
    });

    mockedUseLiveConversationAudio.mockReturnValue({
      permissionState: "granted",
      connectionState: "idle",
      recorderState: "idle",
      error: null,
      audioLevel: 0.42,
      devices: [{ deviceId: "default", label: "Default microphone" }] as MediaDeviceInfo[],
      selectedDevice: "default",
      startSession: mockStartSession,
      pauseSession: vi.fn(),
      resumeSession: vi.fn(),
      endSession: mockEndSession,
      selectDevice: vi.fn(),
      disconnect: vi.fn(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.endsWith("/api/voice/live/sessions")) {
          return new Response(JSON.stringify({ sessions }), { status: 200 });
        }

        if (url.endsWith("/api/voice/live/sessions/live-session-1")) {
          return new Response(JSON.stringify(sessions[0]), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "Unhandled request" }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("reloads the selected session after start so the UI reflects the live state", async () => {
    const { result } = renderHook(() => useLiveConversationAPI());

    await waitFor(() => {
      expect(result.current.selectedSession?.status).toBe("draft");
    });

    await act(async () => {
      await result.current.startSelectedSession();
    });

    await waitFor(() => {
      expect(mockStartSession).toHaveBeenCalledWith("live-session-1", "default");
      expect(result.current.selectedSession?.status).toBe("live");
      expect(result.current.selectedSession?.transport.connectionState).toBe("connected");
      expect(result.current.selectedSession?.recorder.permission).toBe("granted");
      expect(result.current.selectedSession?.recorder.deviceId).toBe("default");
      expect(result.current.selectedSession?.recorder.deviceLabel).toBe("Default microphone");
    });
  });

  it("reloads the selected session after end so the UI moves into review", async () => {
    mockedUseLiveConversationAudio.mockReturnValue({
      permissionState: "granted",
      connectionState: "connected",
      recorderState: "recording",
      error: null,
      audioLevel: 0.61,
      devices: [{ deviceId: "default", label: "Default microphone" }] as MediaDeviceInfo[],
      selectedDevice: "default",
      startSession: mockStartSession,
      pauseSession: vi.fn(),
      resumeSession: vi.fn(),
      endSession: mockEndSession,
      selectDevice: vi.fn(),
      disconnect: vi.fn(),
    });

    sessions = [
      {
        ...sessions[0],
        status: "live",
        startedAt: "2026-05-27T09:28:00Z",
        updatedAt: "2026-05-27T09:28:00Z",
        transport: {
          connectionState: "connected",
          lastError: null,
          lastEventAt: "2026-05-27T09:28:00Z",
        },
      },
    ];

    const { result } = renderHook(() => useLiveConversationAPI());

    await waitFor(() => {
      expect(result.current.selectedSession?.status).toBe("live");
    });

    await act(async () => {
      await result.current.stopSelectedSession();
    });

    await waitFor(() => {
      expect(mockEndSession).toHaveBeenCalled();
      expect(result.current.selectedSession?.status).toBe("review_required");
    });
  });
});
