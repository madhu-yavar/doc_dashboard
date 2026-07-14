import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";
import { SOAPReview } from "@/components/soap/SOAPReview";

const mockedToast = vi.mocked(toast);

const soapData = {
  hospital: {
    name: "Manipal Hospitals",
    tagline: "Care • Safety • Trust",
    department: "Live Conversation",
    branch: "Main Branch",
    address: "Manipal Hospitals",
  },
  patient: {
    name: "Voice Patient",
    ageSex: "42 Yrs / Male",
    hospitalNo: "EN000123",
    mobile: "",
    email: "",
  },
  visit: {
    episodeNo: "live-123",
    dateTime: "2026-06-08T10:00:00.000Z",
  },
  consultant: {
    name: "Doctor",
    regNo: "",
    department: "Live Conversation",
  },
  soap: {
    subjective: ["Chief complaint: Chest pain", "HPI: Intermittent chest pain for two days."],
    objective: ["Blood pressure: 120/80", "Labs / investigations: CBC"],
    assessment: ["Primary diagnosis: Angina"],
    plan: ["Medications: Aspirin: 75mg | once daily", "Follow-up: Cardiology review in one week"],
  },
  _metadata: {
    sourceDocument: "Conversation - Live",
    sourceDocumentId: "voice-live-live-123",
    generatedAt: "2026-06-08T10:10:00.000Z",
    department: "Live Conversation",
    noteType: "SOAP",
    sessionType: "live_conversation",
  },
};

describe("SOAPReview", () => {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = window.URL.createObjectURL;
  const originalRevokeObjectURL = window.URL.revokeObjectURL;
  const originalWindowOpen = window.open;

  beforeEach(() => {
    mockedToast.success.mockReset();
    mockedToast.error.mockReset();
    window.URL.createObjectURL = vi.fn(() => "blob:generated-soap");
    window.URL.revokeObjectURL = vi.fn();
    window.open = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
    window.open = originalWindowOpen;
    vi.restoreAllMocks();
  });

  it("downloads the generated SOAP PDF through the attachment route and keeps manual actions visible", async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: soapData }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          documentId: "voice-live-live-123",
          urls: {
            pdf: "/soap-exports/Conversation - Live_soap_1780919999999.pdf",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["pdf-bytes"], { type: "application/pdf" }),
      });

    global.fetch = fetchMock as typeof fetch;

    render(<SOAPReview documentId="voice-live-live-123" />);

    await screen.findByText("Voice Patient");
    expect(screen.queryByText(/SOAP Note Agent/i)).not.toBeInTheDocument();
    expect(screen.getByText(/SOAP Clinical Note/i)).toBeInTheDocument();
    expect(screen.queryByText(/Clinical Documentation Format/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Manipal Hospitals\s*•\s*Live Conversation/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/soap/download/Conversation%20-%20Live_soap_1780919999999.pdf",
      );
    });

    expect(mockedToast.success).toHaveBeenCalledWith("SOAP note generated successfully!");
    expect(anchorClick).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /download pdf/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open pdf/i })).toBeInTheDocument();
  });
});
