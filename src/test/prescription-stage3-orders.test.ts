import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HandwritingExtractionAgent = require("../../agents/extraction/handwriting_extraction_agent.cjs");
const DataIntegrationAgent = require("../../agents/extraction/data_integration_agent.cjs");

describe("Prescription Stage 3 order fusion", () => {
  it("merges text orders with visual selections and keeps them ordered in dashboard data", () => {
    const stage3Agent = new HandwritingExtractionAgent();
    const compiled = stage3Agent.compileStage3Data({
      medications: { data: { medications: [], total_count: 0, has_unreadable: false, unreadable_count: 0 } },
      vitals: { data: { vitals: {}, has_vitals: false, confidence: "high" } },
      diagnosis: {
        data: {
          diagnosis: {
            principal: "Ulnar neuropathy",
            secondary: [],
            symptoms: ["numbness"],
            clinical_notes: ["Persistent paresthesia in both upper limbs"]
          },
          has_diagnosis: true,
          confidence: "high"
        }
      },
      orders: {
        data: {
          lab_investigations: [
            { test_name: "CBC", category: "hematology", is_uncertain: false, confidence_reason: "" },
            { test_name: "TSH", category: "endocrinology", is_uncertain: true, confidence_reason: "abbreviation partly unclear" }
          ],
          radiology: {
            selected_studies: [
              { study_name: "NCS both ULs", category: "procedure", is_uncertain: true, confidence_reason: "trailing text partially obscured" }
            ]
          },
          has_orders: true,
          confidence: "high"
        }
      },
      visualElements: {
        data: {
          lab_investigations: {
            selected_tests: [
              { test_name: "TSH", is_checked: true, is_circled: false, is_underlined: false, priority: "routine" }
            ],
            total_available: 12,
            total_selected: 1
          },
          radiology: {
            selected_studies: [
              { study_name: "NCS both ULs", is_checked: true }
            ]
          },
          has_selections: true,
          confidence: "high"
        }
      }
    });

    expect("investigations" in compiled).toBe(false);
    expect(compiled.lab_investigations.selected_tests).toHaveLength(2);
    expect(compiled.lab_investigations.total_selected).toBe(2);
    expect(compiled.lab_investigations.selected_tests.find((item: { test_name: string }) => item.test_name === "CBC")?.source).toBe("text_order");
    expect(compiled.lab_investigations.selected_tests.find((item: { test_name: string }) => item.test_name === "TSH")?.source).toBe("text+visual");
    expect(compiled.lab_investigations.selected_tests.find((item: { test_name: string }) => item.test_name === "TSH")?.is_uncertain).toBe(true);
    expect(compiled.radiology_selections.selected_studies).toHaveLength(1);
    expect(compiled.radiology_selections.selected_studies[0].source).toBe("text+visual");
    expect(compiled.radiology_selections.selected_studies[0].is_uncertain).toBe(true);

    const integrationAgent = new DataIntegrationAgent();
    const merged = integrationAgent.mergeStageData({}, compiled);
    const dashboard = integrationAgent.transformToDashboardFormat(merged);

    expect(dashboard.investigations).toEqual([
      expect.objectContaining({ type: "CBC", status: "ordered", source: "text_order", is_uncertain: false }),
      expect.objectContaining({ type: "TSH", status: "ordered", source: "text+visual", is_uncertain: true, confidence_reason: "abbreviation partly unclear" })
    ]);
    expect(dashboard.radiology).toEqual([
      expect.objectContaining({ type: "NCS both ULs", status: "ordered", source: "text+visual", is_uncertain: true, confidence_reason: "trailing text partially obscured" })
    ]);
    expect(dashboard.provenance.labs.source).toBe("text_order+visual_selection");
    expect(dashboard.provenance.radiology.source).toBe("text_order+visual_selection");
  });
});
