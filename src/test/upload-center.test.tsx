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

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/upload"]}>
        <AuthProvider>
          <UploadCenter />
        </AuthProvider>
      </MemoryRouter>,
    );

  beforeEach(() => {
    documents = [];
    processingStarted = false;
    role = "admin";

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

    expect(await screen.findByText(/documents queue/i)).toBeInTheDocument();
    expect(await screen.findByText(/no documents found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /process selected/i })).toBeDisabled();
    // Select PDFs button exists (there are multiple - nav + content)
    expect(screen.getAllByRole("button", { name: /select pdfs/i }).length).toBeGreaterThan(0);
  }, 15000);

  it("adds uploaded pdfs to the queue and processes them", async () => {
    const { container } = renderPage();

    await screen.findByText(/no documents found/i);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dummy"], "Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf")).toBeInTheDocument();

    const processButton = screen.getByRole("button", { name: /process selected/i });
    expect(processButton).toBeEnabled();

    fireEvent.click(processButton);

    // Wait for the document status to change to processed
    await waitFor(() => {
      expect(screen.getAllByText(/^Processed$/).length).toBeGreaterThan(0);
    }, { timeout: 8000 });
  }, 20000);

  it("searches processed records by patient name and MRN", async () => {
    const { container } = renderPage();

    await screen.findByText(/no documents found/i);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dummy"], "Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(await screen.findByRole("button", { name: /process selected/i }));

    // Wait for processed status first
    await waitFor(() => {
      expect(screen.getAllByText(/^Processed$/).length).toBeGreaterThan(0);
    }, { timeout: 8000 });

    // Then wait for patient info to appear
    await screen.findByText(/sample patient · mrn mrn-1/i, {}, { timeout: 4000 });

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
    const { container } = renderPage();

    await screen.findByText(/no documents found/i);

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
      expect(screen.getByText(/no documents found/i)).toBeInTheDocument();
    });
  }, 20000);

  it("hides admin-only controls for doctor logins", async () => {
    role = "doctor";
    const { container } = renderPage();

    await screen.findByText(/documents queue/i);
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
});
