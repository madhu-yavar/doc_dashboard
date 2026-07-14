import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { PrescriptionReview } from "@/components/prescription/PrescriptionReview";
import { toast } from "sonner";

const mockedToast = vi.mocked(toast);

const prescriptionData = {
  hospital: {
    name: "Manipal Hospitals",
    tagline: "Your Health, Our Priority",
    department: "Voice Dictation",
    branch: "Main Branch",
    address: "Generated from Live Voice Session",
  },
  patient: {
    name: "Voice Patient",
    ageSex: "N/A",
    hospitalNo: "VOICE-live-177",
    mobile: "",
    email: "",
  },
  visit: {
    episodeNo: "live-1779884",
    dateTime: "2026-05-27",
  },
  consultant: {
    name: "Doctor",
    regNo: "",
    department: "Voice Dictation",
  },
  vitals: {
    height: "",
    bp: "",
    weight: "",
  },
  clinical: {
    allergies: "No known drug allergy",
    diet: "Normal",
    vulnerable: false,
    knownHealthConditions: "",
  },
  doctorNotes: {
    freeText: "Diagnosis: Mild bacterial pneumonia",
  },
  labs: {
    other: "",
    cbc: true,
  },
  radiology: {
    other: "",
    xrayChestPa: true,
  },
  prescription: {
    medicines: [
      {
        srNo: 1,
        name: "TELMA 40MG",
        dose: "As prescribed",
        morning: true,
        noon: false,
        night: false,
        days: "",
        remarks: "once daily",
      },
    ],
  },
  nextVisitDate: "",
  _metadata: {
    sourceDocument: "Conversation - Live",
    sourceDocumentId: "voice-live-live-1779884407319-ecefd9a5",
    generatedAt: "2026-05-27T12:34:42.078Z",
    department: "Voice Dictation",
  },
};

describe("PrescriptionReview", () => {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = window.URL.createObjectURL;
  const originalRevokeObjectURL = window.URL.revokeObjectURL;
  const originalWindowOpen = window.open;

  beforeEach(() => {
    mockedToast.success.mockReset();
    mockedToast.error.mockReset();
    window.URL.createObjectURL = vi.fn(() => "blob:generated-prescription");
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

  it("downloads the generated PDF through the attachment route and keeps manual actions visible", async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: async () => ({ success: true, data: prescriptionData }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          documentId: "voice-live-live-1779884407319-ecefd9a5",
          urls: {
            pdf: "/prescriptions/Conversation - Live_prescription_1779885282081.pdf",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["pdf-bytes"], { type: "application/pdf" }),
      });

    global.fetch = fetchMock as typeof fetch;

    render(<PrescriptionReview documentId="voice-live-live-1779884407319-ecefd9a5" />);

    await screen.findByText("Prescription Review");

    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/prescriptions/download/Conversation%20-%20Live_prescription_1779885282081.pdf",
      );
    });

    expect(mockedToast.success).toHaveBeenCalledWith("Prescription generated successfully!");
    expect(anchorClick).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /download pdf/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open pdf/i })).toBeInTheDocument();
  });

  it("submits edited medications in the canonical update payload before generating", async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: async () => ({ success: true, data: prescriptionData }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          documentId: "voice-live-live-1779884407319-ecefd9a5",
          urls: {
            pdf: "/prescriptions/Conversation - Live_prescription_1779885282081.pdf",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["pdf-bytes"], { type: "application/pdf" }),
      });

    global.fetch = fetchMock as typeof fetch;

    render(<PrescriptionReview documentId="voice-live-live-1779884407319-ecefd9a5" />);

    await screen.findByText("Prescription Review");

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByDisplayValue("TELMA 40MG"), {
      target: { value: "AMOXICILLIN 500MG" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save and generate/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const generateCall = fetchMock.mock.calls[1];
    expect(generateCall?.[0]).toBe("/api/prescriptions/generate");
    expect(generateCall?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const payload = JSON.parse(String(generateCall?.[1]?.body));
    expect(payload.updateData.medications[0].name).toBe("AMOXICILLIN 500MG");
    expect(payload.updateData.prescription).toBeUndefined();
    expect(anchorClick).toHaveBeenCalled();
  });
});
