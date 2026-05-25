import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import Index from "@/pages/Index";

vi.mock("@/components/auth/AppShellHeader", () => ({
  default: () => <div data-testid="app-shell-header">Header</div>,
}));

vi.mock("@/components/dashboard/ChatAssistantPanel", () => ({
  default: () => <div data-testid="chat-assistant-panel">Chat Assistant</div>,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { role: "admin" },
  }),
}));

const validVoiceDocument = {
  id: "voice-valid-1",
  name: "esl-cardio-sample.wav",
  size: 1024,
  uploadedAt: "2026-05-21T03:00:00Z",
  processedAt: "2026-05-21T03:01:00Z",
  status: "processed",
  department: "Voice Dictation",
  documentType: "voice",
  result: {
    meta: {
      source_type: "voice",
      voice_session_id: "voice-valid-1",
    },
    dashboard_cards: {
      diagnosis_card: {
        principal_diagnosis: "Coronary artery disease",
        secondary_diagnoses: ["Hypertension"],
      },
      clinical_notes_card: {
        total_notes: 1,
        notes: [
          {
            type: "Voice Dictation",
            author: "Physician",
            date: "2026-05-20",
            summary: "Assessment coronary artery disease. Plan follow up in 2 weeks.",
          },
        ],
      },
      follow_up_card: {
        next_appointment: "in 2 weeks",
        appointment_count: 1,
        appointments: [
          {
            department: "Cardiology",
            physician: "",
            date: "in 2 weeks",
            time: "",
            purpose: "review",
          },
        ],
      },
    },
    sample_patient_data: {
      name: "John Doe",
      age: 45,
      mrn: "MRN-77",
      admission_date: "",
      discharge_date: "",
    },
    extracted_data: {
      patient: {
        name: "John Doe",
        mrn: "MRN-77",
        age: 45,
        gender: "Male",
      },
      diagnosis: {
        principal: "Coronary artery disease",
        secondary: ["Hypertension"],
      },
      clinical_notes: [
        {
          type: "Voice Dictation",
          author: "Physician",
          date: "2026-05-20",
          summary: "Assessment coronary artery disease. Plan follow up in 2 weeks.",
        },
      ],
      follow_up: {
        items: [
          {
            specialty: "Cardiology",
            timing: "in 2 weeks",
            reason: "review",
          },
        ],
      },
    },
  },
};

const invalidVoiceDocument = {
  id: "voice-invalid-1",
  name: "empty-dictation.wav",
  size: 512,
  uploadedAt: "2026-05-21T04:00:00Z",
  processedAt: "2026-05-21T04:01:00Z",
  status: "processed",
  department: "Voice Dictation",
  documentType: "voice",
  result: {
    meta: {
      source_type: "voice",
      voice_session_id: "voice-invalid-1",
    },
    dashboard_cards: {},
    sample_patient_data: {
      name: "",
      age: null,
      mrn: "",
      admission_date: "",
      discharge_date: "",
    },
    extracted_data: {
      meta: {
        source_type: "voice_transcript",
      },
    },
  },
};

describe("Index voice dashboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a processed voice document without blanking the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.endsWith("/documents")) {
          return new Response(JSON.stringify({ documents: [validVoiceDocument] }), { status: 200 });
        }

        if (url.includes("/documents/voice-valid-1")) {
          return new Response(JSON.stringify({ document: validVoiceDocument }), { status: 200 });
        }

        if (url.includes("/chat/history/")) {
          return new Response(JSON.stringify({ session: null }), { status: 200 });
        }

        return new Response(JSON.stringify({ error: `Unhandled request: ${url}` }), { status: 500 });
      }),
    );

    render(
      <MemoryRouter initialEntries={["/dashboard?documentId=voice-valid-1"]}>
        <Routes>
          <Route path="/dashboard" element={<Index />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/clinical chartboard/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/showing processed output for esl-cardio-sample\.wav/i)).toBeInTheDocument();
    expect(screen.getAllByText(/coronary artery disease/i).length).toBeGreaterThan(0);
  });

  it("shows an explicit unavailable state for invalid processed voice payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.endsWith("/documents")) {
          return new Response(JSON.stringify({ documents: [invalidVoiceDocument] }), { status: 200 });
        }

        if (url.includes("/documents/voice-invalid-1")) {
          return new Response(JSON.stringify({ document: invalidVoiceDocument }), { status: 200 });
        }

        if (url.includes("/chat/history/")) {
          return new Response(JSON.stringify({ session: null }), { status: 200 });
        }

        return new Response(JSON.stringify({ error: `Unhandled request: ${url}` }), { status: 500 });
      }),
    );

    render(
      <MemoryRouter initialEntries={["/dashboard?documentId=voice-invalid-1"]}>
        <Routes>
          <Route path="/dashboard" element={<Index />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(/processed document unavailable/i);
    await screen.findByText(/voice extraction completed but dashboard payload was incomplete\./i);
  });
});
