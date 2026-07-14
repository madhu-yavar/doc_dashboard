import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/lib/auth";
import UploadCenter from "@/pages/UploadCenter";
import type { ProcessedDocument } from "@/lib/processedDocuments";

vi.mock("@/components/dashboard/ProcessingInsights", () => ({
  default: () => <div data-testid="processing-insights">Processing Insights</div>,
}));

describe("UploadCenter", () => {
  let documents: ProcessedDocument[];
  let processingStarted: boolean;
  let role: "admin" | "doctor";
  let liveSessions: any[];

  const renderPage = (initialEntry = "/upload") =>
    render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthProvider>
          <UploadCenter />
        </AuthProvider>
      </MemoryRouter>,
    );

  beforeEach(() => {
    documents = [];
    processingStarted = false;
    role = "admin";
    liveSessions = [];

    class MockEventSource {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(_url: string) {
        processingStarted = true;
      }

      close() {}
    }

    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";

        if (url.endsWith("/auth/session") && method === "GET") {
          return new Response(JSON.stringify({
            authenticated: true,
            user: {
              id: "user-1",
              username: role === "admin" ? "admin.user" : "doctor.user",
              displayName: role === "admin" ? "Admin User" : "Doctor User",
              role,
            },
          }), { status: 200 });
        }

        if (url.endsWith("/documents") && method === "GET") {
          if (processingStarted && documents[0]?.status === "queued") {
            documents = [
              {
                ...documents[0],
                status: "processed",
                department: "Cardiology / Cath Lab",
                processedAt: "2026-04-04T00:02:00Z",
                result: {
                  meta: { pdf_file: documents[0].name, department_type: "Cardiology / Cath Lab" },
                  dashboard_cards: {},
                  sample_patient_data: { name: "Sample Patient", age: 64, mrn: "MRN-1" },
                },
              },
            ];
          }
          return new Response(JSON.stringify({ documents }), { status: 200 });
        }

        if (url.endsWith("/api/voice/live/sessions") && method === "GET") {
          return new Response(JSON.stringify({ sessions: liveSessions }), { status: 200 });
        }

        if (url.endsWith("/api/voice/live/sessions") && method === "POST") {
          const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
          const session = {
            id: "live-session-1",
            status: "draft",
            linkedPatient: requestBody.linkedPatient || "",
            encounterLabel: requestBody.encounterLabel || "",
            createdBy: {
              id: "user-1",
              username: role === "admin" ? "admin.user" : "doctor.user",
              role,
            },
            startedAt: null,
            updatedAt: "2026-05-27T07:30:00Z",
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
          };
          liveSessions = [session];
          return new Response(JSON.stringify(session), { status: 201 });
        }

        if (url.endsWith("/voice") && method === "GET") {
          return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
        }

        if (url.endsWith("/analytics/overview") && method === "GET") {
          const processedDocuments = documents.filter((document) => document.status === "processed");
          return new Response(JSON.stringify({
            documentsByType: [
              { documentType: "prescription", count: 0 },
              { documentType: "discharge_summary", count: processedDocuments.length },
              { documentType: "outpatient_record", count: 0 },
              { documentType: "lab_report", count: 0 },
              { documentType: "chart_note", count: 0 },
              { documentType: "unknown", count: 0 },
            ],
            tokensByProvider: {
              gemma: processedDocuments.length * 100,
              gemini: 0,
              total: processedDocuments.length * 100,
            },
            medicationsByDocumentType: [
              { documentType: "prescription", count: 0 },
              { documentType: "discharge_summary", count: 0 },
              { documentType: "outpatient_record", count: 0 },
              { documentType: "lab_report", count: 0 },
              { documentType: "chart_note", count: 0 },
              { documentType: "unknown", count: 0 },
            ],
            testsByDocumentType: [
              { documentType: "prescription", lab: 0, radiology: 0, nuclearMedicine: 0, procedures: 0 },
              { documentType: "discharge_summary", lab: 0, radiology: 0, nuclearMedicine: 0, procedures: 0 },
              { documentType: "outpatient_record", lab: 0, radiology: 0, nuclearMedicine: 0, procedures: 0 },
              { documentType: "lab_report", lab: 0, radiology: 0, nuclearMedicine: 0, procedures: 0 },
              { documentType: "chart_note", lab: 0, radiology: 0, nuclearMedicine: 0, procedures: 0 },
              { documentType: "unknown", lab: 0, radiology: 0, nuclearMedicine: 0, procedures: 0 },
            ],
            summary: {
              includedDocuments: processedDocuments.length,
              refreshedAt: "2026-05-04T08:00:00Z",
            },
          }), { status: 200 });
        }

        if (url.endsWith("/documents/upload") && method === "POST") {
          documents = [
            {
              id: "doc-1",
              name: "Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf",
              size: 5,
              uploadedAt: "2026-04-04T00:00:00Z",
              status: "queued",
              department: "Cardiology / Cath Lab",
              result: null,
              error: null,
            },
          ];
          return new Response(JSON.stringify({ documents }), { status: 201 });
        }

        if (url.includes("/documents/") && method === "DELETE") {
          documents = [];
          return new Response(null, { status: 204 });
        }

        return new Response(JSON.stringify({ error: "Unhandled request" }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the intake page with the process action disabled initially", async () => {
    renderPage();

    expect(await screen.findByText(/document queue/i)).toBeInTheDocument();
    expect(await screen.findByText(/no documents found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /process selected/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /select pdfs/i })).not.toBeInTheDocument();
  }, 15000);

  it("adds uploaded pdfs to the queue and processes them", async () => {
    const { container } = renderPage("/upload?tab=prescription");

    await screen.findByText(/prescription queue/i);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dummy"], "Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", {
      name: /select custom\.mexx\.report/i,
    }));

    const processButton = screen.getByRole("button", { name: /process selected/i });
    expect(processButton).toBeEnabled();

    fireEvent.click(processButton);

    // Wait for the document status to change to processed
    await waitFor(() => {
      expect(screen.getAllByText(/^Processed$/).length).toBeGreaterThan(0);
    }, { timeout: 8000 });
  }, 20000);

  it("searches processed records by patient name and MRN", async () => {
    const { container } = renderPage("/upload?tab=prescription");

    await screen.findByText(/prescription queue/i);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dummy"], "Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(await screen.findByRole("checkbox", {
      name: /select custom\.mexx\.report/i,
    }));
    fireEvent.click(await screen.findByRole("button", { name: /process selected/i }));

    // Wait for processed status first
    await waitFor(() => {
      expect(screen.getAllByText(/^Processed$/).length).toBeGreaterThan(0);
    }, { timeout: 8000 });

    // Then wait for patient info to appear
    await screen.findByText(/sample patient/i, {}, { timeout: 4000 });
    expect(screen.getByText(/mrn mrn-1/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search by pdf, patient, or mrn/i), {
      target: { value: "MRN-1" },
    });

    expect(screen.getByText("Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search by pdf, patient, or mrn/i), {
      target: { value: "Sample Patient" },
    });

    expect(screen.getByText("Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf")).toBeInTheDocument();
  }, 20000);

  it("supports selecting and deleting queued documents", async () => {
    const { container } = renderPage("/upload?tab=prescription");

    await screen.findByText(/prescription queue/i);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dummy"], "Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(input, { target: { files: [file] } });

    // Wait for document to appear and checkbox to be available
    const rowCheckbox = await screen.findByRole("checkbox", {
      name: /select custom\.mexx\.report/i,
    }, { timeout: 10000 });

    fireEvent.click(rowCheckbox);

    expect(screen.getByRole("button", { name: /delete selected/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /delete selected/i }));

    await waitFor(() => {
      expect(screen.getByText(/no prescription documents found/i)).toBeInTheDocument();
    });
  }, 20000);

  it("hides admin-only controls for doctor logins", async () => {
    role = "doctor";
    const { container } = renderPage("/upload?tab=prescription");

    await screen.findByText(/prescription queue/i);
    // Admin-only controls should not be visible for doctor role
    expect(screen.queryByRole("button", { name: /delete selected/i })).not.toBeInTheDocument();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dummy"], "Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText("Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf");
    expect(screen.queryByTitle(/audit trail/i)).not.toBeInTheDocument();
  }, 15000);

  it("renders the live conversation UI shell without disturbing the dictation workspace", async () => {
    const firstView = renderPage("/upload?workspace=voice");
    expect(await screen.findByText(/dictation review queue/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^dictation$/i })).toHaveAttribute("aria-selected", "true");

    firstView.unmount();

    renderPage("/upload?workspace=voice&mode=live");
    expect(screen.getByRole("tab", { name: /^live$/i })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText(/no session selected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /new session/i }));

    expect(await screen.findByRole("heading", { name: /^live conversation$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^start$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /transcript/i })).toBeInTheDocument();
  }, 15000);

  it("loads saved live sessions even when transcript segments are missing optional fields", async () => {
    liveSessions = [
      {
        id: "live-poc-test-001",
        status: "review_required",
        linkedPatient: "Rajesh Kumar",
        encounterLabel: "Fever and Body Ache",
        createdBy: {
          id: "doctor_001",
          username: "dr_sharma",
          role: "doctor",
        },
        startedAt: "2026-05-27T10:15:00Z",
        updatedAt: "2026-05-27T10:30:00Z",
        endedAt: "2026-05-27T10:30:00Z",
        durationMs: 900000,
        transcript: {
          segments: [
            {
              id: "seg-1",
              speakerRole: "doctor",
              speakerLabel: "Doctor",
              text: "Hello, what brings you in today?",
            },
            {
              id: "seg-2",
              speakerRole: "patient",
              speakerLabel: "Patient",
              text: "I've had fever for three days, along with body ache and headache.",
            },
          ],
          rawText: "Hello, what brings you in today? I've had fever for three days, along with body ache and headache.",
          normalizedText: "Doctor: Hello, what brings you in today? Patient: I've had fever for three days, along with body ache and headache.",
        },
        draftExtraction: {
          extractedData: {
            diagnosis: "Viral febrile illness",
            symptoms: ["Fever for 3 days", "Body ache", "Headache"],
            medications: [],
            labs: ["CBC"],
            radiology: [],
            procedures: [],
            followUp: ["After 3 days if symptoms persist"],
            plan: ["Hydration advised"],
          },
          reviewItems: [],
          lastStableSegmentId: "seg-2",
        },
        audio: {
          mimeType: "audio/webm",
          chunkCount: 45,
        },
        transport: {
          connectionState: "disconnected",
          lastError: null,
          lastEventAt: "2026-05-27T10:30:00Z",
        },
        error: null,
      },
    ];

    renderPage("/upload?workspace=voice&mode=live");

    expect(await screen.findByRole("heading", { name: /^live conversation$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /rajesh kumar/i })).toBeInTheDocument();
    expect(screen.getByText(/hello, what brings you in today\\?/i)).toBeInTheDocument();
    expect(screen.getByText(/^viral febrile illness$/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /create new visit/i }));

    expect(await screen.findByRole("button", { name: /^start$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^(new conversation|en\d{6})$/i })).toBeInTheDocument();
  }, 15000);

  it("shows finalized live conversations as processed live records with the encounter label in the queue", async () => {
    documents = [
      {
        id: "voice-live-live-1779875406515-a35c20bd",
        name: "Madhu - EN001",
        fileName: "Madhu - EN001",
        size: 1669865,
        uploadedAt: "2026-05-27T10:50:26.816Z",
        processedAt: "2026-05-27T10:50:26.816Z",
        status: "processed",
        department: "Live Conversation",
        documentType: "voice",
        mimeType: "audio/webm",
        durationLabel: "01:24",
        linkedPatient: "Madhu",
        encounterLabel: "EN001",
        result: {
          meta: {
            source_type: "voice",
            sessionType: "live_conversation",
            sessionId: "live-1779875406515-a35c20bd",
            patientName: "Madhu",
            encounterLabel: "EN001",
          },
          dashboard_cards: {
            diagnosis_card: {
              principal_diagnosis: "Chest pain under evaluation",
            },
            medications_card: {
              active_count: 0,
              medication_list: [],
            },
            labs_card: {
              total_tests: 0,
              investigations_list: [],
            },
            radiology_card: {
              studies_completed: 0,
              radiology_list: [],
            },
            treatment_card: {
              procedures_performed: 0,
              management_items: [],
            },
            clinical_notes_card: {
              total_notes: 1,
              notes: [],
            },
            follow_up_card: {
              appointment_count: 0,
              appointments: [],
            },
          },
          sample_patient_data: {
            name: "Madhu",
            mrn: "EN001",
            age: null,
            gender: "",
            admission_date: "",
            discharge_date: "",
            los_days: null,
            summary: "Processed via Agent System v2.0.0.",
            vitals: {
              latest: {
                bloodPressure: { systolic: null, diastolic: null },
                heartRate: { value: null },
                spo2: { value: null },
                temperature: { value: null },
                weight: { value: null, unit: "" },
                respiratoryRate: { value: null },
                painScore: { value: null },
                grbs: { value: null },
              },
              status: "stable",
              trend: "stable",
              alerts: [],
            },
          },
          extracted_data: {
            patient: {
              name: "Madhu",
              mrn: "EN001",
            },
            diagnosis: {
              principal: { name: "Chest pain under evaluation" },
              secondary: [],
              symptoms: ["Chest pain"],
            },
            medications: [],
            investigations: [],
            radiology: [],
            procedures: [],
            follow_up: { items: [] },
            treatment: {
              current_approach: "",
              management_items: [],
              procedures: [],
            },
            clinical_notes: [
              {
                type: "Live Conversation Summary",
                date: "2026-05-27T10:50:26.816Z",
                summary: "Chest pain under evaluation",
              },
            ],
          },
        },
        error: null,
      } as ProcessedDocument,
    ];

    renderPage();

    expect(await screen.findByText("Madhu - EN001")).toBeInTheDocument();
    expect(screen.getAllByText(/^processed$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^live$/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/madhu · en001/i)).toBeInTheDocument();
  }, 15000);
});
