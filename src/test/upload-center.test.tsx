import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import UploadCenter from "@/pages/UploadCenter";
import type { ProcessedDocument } from "@/lib/processedDocuments";

describe("UploadCenter", () => {
  let documents: ProcessedDocument[];

  beforeEach(() => {
    documents = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";

        if (url.endsWith("/documents") && method === "GET") {
          return new Response(JSON.stringify({ documents }), { status: 200 });
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

        if (url.endsWith("/documents/process") && method === "POST") {
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
          return new Response(JSON.stringify({ documents }), { status: 200 });
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
    render(
      <MemoryRouter>
        <UploadCenter />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", {
        name: /upload the pdf batch, process it once, and move straight into doctor review/i,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/no pdfs in the queue yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /process batch/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /upload pdfs/i })).toBeInTheDocument();
  });

  it("adds uploaded pdfs to the queue and processes them", async () => {
    const { container } = render(
      <MemoryRouter>
        <UploadCenter />
      </MemoryRouter>,
    );

    await screen.findByText(/no pdfs in the queue yet/i);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dummy"], "Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf")).toBeInTheDocument();

    const processButton = screen.getByRole("button", { name: /process batch/i });
    expect(processButton).toBeEnabled();

    fireEvent.click(processButton);

    await waitFor(() => {
      expect(screen.getAllByText(/^Processed$/).length).toBeGreaterThan(0);
    });

    expect(screen.getByRole("button", { name: /open dashboard/i })).toBeEnabled();
  });

  it("searches processed records by patient name and MRN", async () => {
    const { container } = render(
      <MemoryRouter>
        <UploadCenter />
      </MemoryRouter>,
    );

    await screen.findByText(/no pdfs in the queue yet/i);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dummy"], "Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(await screen.findByRole("button", { name: /process batch/i }));

    await screen.findByText(/sample patient · mrn mrn-1/i);

    fireEvent.change(screen.getByPlaceholderText(/search by pdf, patient, or mrn/i), {
      target: { value: "MRN-1" },
    });

    expect(screen.getByText("Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search by pdf, patient, or mrn/i), {
      target: { value: "Sample Patient" },
    });

    expect(screen.getByText("Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf")).toBeInTheDocument();
  });
});
