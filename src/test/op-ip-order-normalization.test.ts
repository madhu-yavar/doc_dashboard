// @vitest-environment node

import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const OutpatientExtractorAgent = require("../../agents/outpatient_extractor_agent.cjs");
const DischargeExtractorAgent = require("../../agents/discharge_extractor_agent.cjs");
const DocumentTypeRouter = require("../../agents/document_type_router.cjs");
const { buildDocumentMetrics } = require("../../server/analytics_store.cjs");

describe("op/ip order normalization", () => {
  it("exposes an inpatient_record route without relying on fallback", () => {
    const router = new DocumentTypeRouter({
      gemma: { baseUrl: "http://localhost:8000", model: "test" }
    });
    expect(router.getAvailableTypes().map((item) => item.type)).toContain("inpatient_record");
  });

  it("normalizes outpatient investigations into analytics-ready ordered buckets", () => {
    const agent = new OutpatientExtractorAgent();
    const result = agent.assembleFinalResult(
      [
        {
          success: true,
          step: "clinical_data_extractor",
          data: {
            investigations: ["CBC", "USG Abdomen", "PET Scan"],
            treatment: {
              procedures: ["Uroflowmetry", "Biopsy"],
            },
          },
        },
      ],
      "outpatient.pdf",
      "OUTPATIENT RECORD",
    );

    expect(result.investigations).toEqual([
      expect.objectContaining({ type: "CBC", status: "ordered" }),
    ]);
    expect(result.radiology).toEqual([
      expect.objectContaining({ type: "USG Abdomen", status: "ordered" }),
    ]);
    expect(result.nuclear_medicine).toEqual([
      expect.objectContaining({ type: "PET Scan", status: "ordered" }),
    ]);
    expect(result.procedures).toEqual([
      expect.objectContaining({ name: "Uroflowmetry", status: "ordered" }),
      expect.objectContaining({ name: "Biopsy", status: "ordered" }),
    ]);
    expect(result.treatment.procedures).toEqual(["Uroflowmetry", "Biopsy"]);

    const metrics = buildDocumentMetrics({
      id: "op-1",
      name: "outpatient.pdf",
      status: "processed",
      uploadedAt: "2026-05-04T08:00:00.000Z",
      processedAt: "2026-05-04T08:05:00.000Z",
      result: {
        meta: result.meta,
        dashboard_cards: {
          medications_card: {
            active_count: 0,
          },
        },
        extracted_data: result,
      },
      agentInfo: {
        tokensUsed: 50,
      },
    });

    expect(metrics.documentType).toBe("outpatient_record");
    expect(metrics.labTestsCount).toBe(1);
    expect(metrics.radiologyTestsCount).toBe(1);
    expect(metrics.nuclearMedicineTestsCount).toBe(1);
    expect(metrics.proceduresCount).toBe(2);
  });

  it("normalizes discharge orders while preserving raw treatment procedures", () => {
    const agent = new DischargeExtractorAgent();
    const assembled = agent.assembleFinalResult(
      [
        {
          success: true,
          step: "clinical_data_extractor",
          data: {
            investigations: ["HbA1c", "Chest X-ray", "DTPA Scan"],
            treatment: {
              procedures: ["Endoscopy"],
            },
          },
        },
      ],
      "discharge.pdf",
    );

    expect(assembled.data.investigations).toEqual([
      expect.objectContaining({ type: "HbA1c", status: "ordered" }),
    ]);
    expect(assembled.data.radiology).toEqual([
      expect.objectContaining({ type: "Chest X-ray", status: "ordered" }),
    ]);
    expect(assembled.data.nuclear_medicine).toEqual([
      expect.objectContaining({ type: "DTPA Scan", status: "ordered" }),
    ]);
    expect(assembled.data.procedures).toEqual([
      expect.objectContaining({ name: "Endoscopy", status: "ordered" }),
    ]);
    expect(assembled.data.treatment.procedures).toEqual(["Endoscopy"]);

    const metrics = buildDocumentMetrics({
      id: "ip-1",
      name: "discharge.pdf",
      status: "processed",
      uploadedAt: "2026-05-04T08:00:00.000Z",
      processedAt: "2026-05-04T08:05:00.000Z",
      result: {
        meta: {
          ...assembled.data.meta,
          document_type: "discharge_summary",
        },
        dashboard_cards: {
          medications_card: {
            active_count: 0,
          },
        },
        extracted_data: assembled.data,
      },
      agentInfo: {
        tokensUsed: 75,
      },
    });

    expect(metrics.documentType).toBe("discharge_summary");
    expect(metrics.labTestsCount).toBe(1);
    expect(metrics.radiologyTestsCount).toBe(1);
    expect(metrics.nuclearMedicineTestsCount).toBe(1);
    expect(metrics.proceduresCount).toBe(1);
  });

  it("preserves middle clinical sections in the focused inpatient extraction slice", () => {
    const agent = new DischargeExtractorAgent();
    const filler = "Administrative content ".repeat(400);
    const pdfText = [
      "Inpatient Record Header\nPatient: Example",
      filler,
      "Current Medications:\nAspirin 75 mg OD\nClopidogrel 75 mg OD",
      filler,
      "Provisional Diagnosis: Acute coronary syndrome",
      filler,
      "Doctor's Handover\nContinue dual antiplatelets and monitor vitals",
      filler,
    ].join("\n");

    const focused = agent.buildClinicalExtractionText(pdfText, 6000);

    expect(focused).toContain("Current Medications");
    expect(focused).toContain("Aspirin 75 mg OD");
    expect(focused).toContain("Provisional Diagnosis");
    expect(focused).toContain("Doctor's Handover");
    expect(focused.length).toBeLessThanOrEqual(6000);
  });
});
