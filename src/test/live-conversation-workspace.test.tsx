import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useLiveConversationAPI", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useLiveConversationAPI")>("@/hooks/useLiveConversationAPI");
  return {
    ...actual,
    useLiveConversationAPI: vi.fn(),
  };
});

import LiveConversationWorkspace from "@/components/voice/LiveConversationWorkspace";
import { useLiveConversationAPI } from "@/hooks/useLiveConversationAPI";

const mockedUseLiveConversationAPI = vi.mocked(useLiveConversationAPI);

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "live-session-1",
    status: "live",
    linkedPatient: "Anita Rao",
    encounterLabel: "Follow-up",
    createdBy: {
      id: "doctor-1",
      username: "doctor.user",
      role: "doctor",
    },
    startedAt: "2026-05-27T09:28:00Z",
    updatedAt: "2026-05-27T09:28:00Z",
    endedAt: null,
    durationMs: 0,
    documentId: null,
    audio: {
      mimeType: "audio/webm",
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
    draft: {
      extractedData: {
        diagnosis: "",
        symptoms: [],
        medications: [],
        labs: [],
        radiology: [],
        procedures: [],
        followUp: [],
        plan: [],
      },
      reviewItems: [],
    },
    draftExtraction: {
      extractedData: null,
      reviewItems: [],
      lastStableSegmentId: null,
    },
    error: null,
    transport: {
      connectionState: "connected",
      lastError: null,
      lastEventAt: "2026-05-27T09:28:00Z",
    },
    title: "Anita Rao",
    recorder: {
      permission: "granted",
      deviceId: "default",
      deviceLabel: "Default microphone",
    },
    ...overrides,
  };
}

describe("LiveConversationWorkspace", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows explicit listening feedback while a live visit is recording", async () => {
    const selectedSession = makeSession();

    mockedUseLiveConversationAPI.mockReturnValue({
      isPreview: false,
      isLoading: false,
      error: null,
      sessions: [selectedSession],
      selectedSession,
      selectedSessionId: selectedSession.id,
      hasPendingReview: false,
      availableDevices: [{ id: "default", label: "Default microphone" }],
      createDraftSession: vi.fn(),
      selectSession: vi.fn(),
      returnToDraft: vi.fn(),
      updateSelectedSession: vi.fn(),
      startSelectedSession: vi.fn(),
      pauseSelectedSession: vi.fn(),
      resumeSelectedSession: vi.fn(),
      stopSelectedSession: vi.fn(),
      finalizeSelectedSession: vi.fn(),
      deleteSession: vi.fn(),
      refreshSessions: vi.fn(),
      disconnectAudio: vi.fn(),
      resolveReviewItem: vi.fn(),
      captureState: "recording",
      transportState: "connected",
      audioLevel: 0.54,
    });

    render(<LiveConversationWorkspace />);

    expect(screen.getByText(/listening\. voice detected\./i)).toBeInTheDocument();
    expect(screen.getByText(/speech is uploaded in chunks/i)).toBeInTheDocument();
    expect(screen.getByText(/listening now/i)).toBeInTheDocument();
    expect(screen.getByText(/transcript appears here after the first processed audio chunk/i)).toBeInTheDocument();
  });

  it("shows an ending state while the session is being finalized into review", async () => {
    const selectedSession = makeSession();

    mockedUseLiveConversationAPI.mockReturnValue({
      isPreview: false,
      isLoading: false,
      error: null,
      sessions: [selectedSession],
      selectedSession,
      selectedSessionId: selectedSession.id,
      hasPendingReview: false,
      availableDevices: [{ id: "default", label: "Default microphone" }],
      createDraftSession: vi.fn(),
      selectSession: vi.fn(),
      returnToDraft: vi.fn(),
      updateSelectedSession: vi.fn(),
      startSelectedSession: vi.fn(),
      pauseSelectedSession: vi.fn(),
      resumeSelectedSession: vi.fn(),
      stopSelectedSession: vi.fn(),
      finalizeSelectedSession: vi.fn(),
      deleteSession: vi.fn(),
      refreshSessions: vi.fn(),
      disconnectAudio: vi.fn(),
      resolveReviewItem: vi.fn(),
      captureState: "stopping",
      transportState: "connected",
      audioLevel: 0,
    });

    render(<LiveConversationWorkspace />);

    expect(screen.getByRole("button", { name: /ending\.\.\./i })).toBeDisabled();
    expect(screen.getAllByText(/processing the final audio chunk/i).length).toBeGreaterThan(0);
  });

  it("tells the user that Start will request the browser default microphone when no devices are listed yet", async () => {
    const selectedSession = makeSession({
      status: "draft",
      recorder: {
        permission: "prompt",
        deviceId: null,
        deviceLabel: "",
      },
    });

    mockedUseLiveConversationAPI.mockReturnValue({
      isPreview: false,
      isLoading: false,
      error: null,
      sessions: [selectedSession],
      selectedSession,
      selectedSessionId: selectedSession.id,
      hasPendingReview: false,
      availableDevices: [],
      createDraftSession: vi.fn(),
      selectSession: vi.fn(),
      returnToDraft: vi.fn(),
      updateSelectedSession: vi.fn(),
      startSelectedSession: vi.fn(),
      pauseSelectedSession: vi.fn(),
      resumeSelectedSession: vi.fn(),
      stopSelectedSession: vi.fn(),
      finalizeSelectedSession: vi.fn(),
      deleteSession: vi.fn(),
      refreshSessions: vi.fn(),
      disconnectAudio: vi.fn(),
      resolveReviewItem: vi.fn(),
      captureState: "idle",
      transportState: "idle",
      audioLevel: 0,
    });

    render(<LiveConversationWorkspace />);

    expect(screen.getByText(/browser default microphone will be requested on start/i)).toBeInTheDocument();
    expect(screen.getByText(/press start to grant access; the browser default microphone will still be used/i)).toBeInTheDocument();
    expect(screen.getAllByText(/browser default microphone/i).length).toBeGreaterThan(0);
  });

  it("shows saved recording playback actions after a session ends", async () => {
    const selectedSession = makeSession({
      status: "review_required",
      endedAt: "2026-05-27T09:30:00Z",
      audio: {
        mimeType: "audio/webm",
        chunkCount: 12,
        combinedPath: "/Users/yavar/Documents/CoE/Manipal/server/storage/live_conversation_audio/live-session-1.webm",
      },
      transcript: {
        segments: [
          {
            id: "seg-1",
            speakerRole: "unknown",
            speakerLabel: "Speaker 1",
            startLabel: "00:00",
            endLabel: "00:10",
            text: "Thank you.",
            confidence: 0.95,
            flags: ["requires_review"],
            status: "final",
          },
        ],
        rawText: "Thank you.",
        normalizedText: "Thank you.",
        speakers: [],
        quality: {
          overallConfidence: 0.95,
          lowConfidenceSegmentCount: 0,
          speakerAmbiguityCount: 1,
          overlappingSpeechSuspected: false,
        },
        hasGap: false,
        interimText: "",
      },
    });

    mockedUseLiveConversationAPI.mockReturnValue({
      isPreview: false,
      isLoading: false,
      error: null,
      sessions: [selectedSession],
      selectedSession,
      selectedSessionId: selectedSession.id,
      hasPendingReview: false,
      availableDevices: [{ id: "default", label: "Default microphone" }],
      createDraftSession: vi.fn(),
      selectSession: vi.fn(),
      returnToDraft: vi.fn(),
      updateSelectedSession: vi.fn(),
      startSelectedSession: vi.fn(),
      pauseSelectedSession: vi.fn(),
      resumeSelectedSession: vi.fn(),
      stopSelectedSession: vi.fn(),
      finalizeSelectedSession: vi.fn(),
      deleteSession: vi.fn(),
      refreshSessions: vi.fn(),
      disconnectAudio: vi.fn(),
      resolveReviewItem: vi.fn(),
      captureState: "idle",
      transportState: "closed",
      audioLevel: 0,
    });

    render(<LiveConversationWorkspace />);

    expect(screen.getByText(/saved recording/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete recording/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open recording/i })).toHaveAttribute(
      "href",
      "/api/voice/live/sessions/live-session-1/audio",
    );
    expect(screen.getByRole("link", { name: /download recording/i })).toHaveAttribute(
      "href",
      "/api/voice/live/sessions/live-session-1/audio",
    );
    expect(screen.getByRole("link", { name: /download recording/i })).toHaveAttribute(
      "download",
      "live-session-1.webm",
    );
  });
});
