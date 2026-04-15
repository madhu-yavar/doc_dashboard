// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const DocumentTypeRouter = require("../../agents/document_type_router.cjs");
const PromptBuilderTool = require("../../tools/llm/prompt_builder.tool.cjs");

describe("Document Classification Regression Tests", () => {
  const router = new DocumentTypeRouter({
    gemma: { baseUrl: "http://localhost:8000", model: "test" }
  });

  // Test cases with expected document types
  // All discharge summaries should classify as discharge_summary
  const dischargeTestCases = [
    "data/Custom.MEXX.Report.ZEN.DischargeSummary1.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary2.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary4.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary5.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary6.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary7.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary8.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary9.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary10.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary11.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary14.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary15.cls.pdf",
    "data/Custom.MEXX.Report.ZEN.DischargeSummary16.cls.pdf",
  ];

  const chartNoteTestCases = [
    "data/chart-note-3faab21f-0eff-404f-877b-8bea65378945.pdf",
    "data/chart-note-81c208d3-deb7-4958-b144-8e28e378a16a.pdf",
  ];

  // Test discharge summary classification with original filename
  describe("Discharge Summary Classification", () => {
    dischargeTestCases.forEach((file) => {
      it(`should classify ${file.split("/").pop()} as discharge_summary (original filename)`, async () => {
        const detectedType = await router.detectDocumentType(file, { pdfName: file });
        expect(detectedType).toBe("discharge_summary");
      });
    });

    // Test with UUID filename (simulating upload scenario)
    dischargeTestCases.forEach((file) => {
      it(`should classify ${file.split("/").pop()} as discharge_summary (UUID filename)`, async () => {
        const uuidName = "cc2d5891-1234-5678-9abc-def123456789.pdf";
        const detectedType = await router.detectDocumentType(file, { pdfName: uuidName });
        expect(detectedType).toBe("discharge_summary");
      });
    });
  });

  // Test chart note classification
  describe("Chart Note Classification", () => {
    chartNoteTestCases.forEach((file) => {
      it(`should classify ${file.split("/").pop()} as chart_note (original filename)`, async () => {
        const detectedType = await router.detectDocumentType(file, { pdfName: file });
        expect(detectedType).toBe("chart_note");
      });
    });

    // Test with UUID filename (simulating upload scenario)
    chartNoteTestCases.forEach((file) => {
      it(`should classify ${file.split("/").pop()} as chart_note (UUID filename)`, async () => {
        const uuidName = "cc2d5891-1234-5678-9abc-def123456789.pdf";
        const detectedType = await router.detectDocumentType(file, { pdfName: uuidName });
        expect(detectedType).toBe("chart_note");
      });
    });
  });

  // Test that classification is consistent regardless of filename format
  describe("Classification Consistency", () => {
    it("should classify the same document consistently regardless of filename", async () => {
      const testFile = dischargeTestCases[0];

      // Test with original filename
      const type1 = await router.detectDocumentType(testFile, { pdfName: testFile });

      // Test with UUID filename
      const type2 = await router.detectDocumentType(testFile, { pdfName: "random-uuid-name.pdf" });

      // Both should be discharge_summary
      expect(type1).toBe(type2);
      expect(type1).toBe("discharge_summary");
    });
  });

  // Test filename-based detection (fast path)
  describe("Filename-based Detection", () => {
    it("should detect discharge_summary from filename containing 'discharge'", async () => {
      const detectedType = await router.detectDocumentType("/fake/path/discharge-summary.pdf", { pdfName: "discharge-summary.pdf" });
      expect(detectedType).toBe("discharge_summary");
    });

    it("should detect chart_note from filename containing 'chart'", async () => {
      const detectedType = await router.detectDocumentType("/fake/path/chart-note.pdf", { pdfName: "chart-note.pdf" });
      expect(detectedType).toBe("chart_note");
    });

    it("should detect lab_report from filename containing 'lab'", async () => {
      const detectedType = await router.detectDocumentType("/fake/path/lab-report.pdf", { pdfName: "lab-report.pdf" });
      expect(detectedType).toBe("lab_report");
    });

    it("should detect outpatient_record from filename containing 'outpatient'", async () => {
      const detectedType = await router.detectDocumentType("/fake/path/outpatient-visit.pdf", { pdfName: "outpatient-visit.pdf" });
      expect(detectedType).toBe("outpatient_record");
    });
  });

  // Test override rules
  describe("Override Rules", () => {
    it("should prioritize discharge_summary over outpatient_record when inpatient risk signals present", async () => {
      // Simulate content with both OPD keywords and inpatient risk signals
      const testFile = dischargeTestCases[0];
      const uuidName = "opd-visit-file.pdf"; // OPD-sounding name but has inpatient content

      const detectedType = await router.detectDocumentType(testFile, { pdfName: uuidName });
      // Should detect as discharge_summary due to content (fall risk, ews, etc.)
      expect(detectedType).toBe("discharge_summary");
    });
  });

  // Test pending_items_extractor prompt registration
  describe("Pending Items Extractor Prompt Registration", () => {
    it("should have pending_items_extractor template registered", () => {
      const promptBuilder = new PromptBuilderTool();
      const templateNames = promptBuilder.getTemplateNames();
      expect(templateNames).toContain("pending_items_extractor");
    });

    it("should build pending_items_extractor prompt without error", () => {
      const promptBuilder = new PromptBuilderTool();
      const testPdfText = "Test PDF content with pending labs";

      expect(() => {
        const prompt = promptBuilder.build("pending_items_extractor", { pdfText: testPdfText });
        expect(prompt).toContain("PENDING ITEMS");
        expect(prompt).toContain(testPdfText);
      }).not.toThrow();
    });
  });
});
