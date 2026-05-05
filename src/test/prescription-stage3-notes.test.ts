import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HandwritingExtractionAgent = require("../../agents/extraction/handwriting_extraction_agent.cjs");
const DataIntegrationAgent = require("../../agents/extraction/data_integration_agent.cjs");
const NoteSelectorTool = require("../../tools/presentation/note_selector.tool.cjs");

describe("Prescription Stage 3 handwritten notes", () => {
  it("keeps handwritten notes separate from diagnosis and propagates them through stage 4", () => {
    const stage3Agent = new HandwritingExtractionAgent();

    const compiled = stage3Agent.compileStage3Data({
      medications: { data: { medications: [], total_count: 0, has_unreadable: false, unreadable_count: 0 } },
      notes: {
        data: {
          notes: [
            {
              text: "Follow up after 2 weeks",
              category: "follow_up",
              confidence: "high",
              is_inferred: false,
              confidence_reason: "",
              source_excerpt: "Follow up after 2 weeks",
              page_number: 1,
              source_type: "handwritten",
              is_synthetic: false
            },
            {
              text: "Uroflowmetry advised",
              category: "advice",
              confidence: "medium",
              is_inferred: false,
              confidence_reason: "partly compressed handwriting",
              source_excerpt: "Uroflowmetry advised",
              page_number: 1,
              source_type: "handwritten",
              is_synthetic: false
            }
          ],
          has_notes: true,
          confidence: "high"
        }
      },
      vitals: { data: { vitals: {}, has_vitals: false, confidence: "high" } },
      diagnosis: {
        data: {
          diagnosis: {
            principal: "LUTS",
            secondary: [],
            symptoms: ["urgency"]
          },
          has_diagnosis: true,
          confidence: "high"
        }
      },
      orders: {
        data: {
          lab_investigations: [],
          radiology: { selected_studies: [] },
          nuclear_medicine: { selected_studies: [] },
          procedures: [],
          has_orders: false,
          confidence: "high"
        }
      },
      visualElements: {
        data: {
          lab_investigations: { selected_tests: [], total_available: 0, total_selected: 0 },
          radiology: { selected_studies: [] },
          has_selections: false,
          confidence: "high"
        }
      }
    });

    expect(compiled.diagnosis.principal).toBe("LUTS");
    expect("clinical_notes" in compiled.diagnosis).toBe(false);
    expect(compiled.handwritten_notes).toHaveLength(2);
    expect(compiled.notes_metadata.total_notes).toBe(2);

    const integrationAgent = new DataIntegrationAgent();
    const merged = integrationAgent.mergeStageData(
      {
        doctor: { name: "Dr. Test (MBBS, MS)" },
        visit: { date: "2026-05-01" }
      },
      compiled
    );
    const dashboard = integrationAgent.transformToDashboardFormat(merged);

    expect(dashboard.diagnosis.clinical_notes).toEqual([
      "Follow up after 2 weeks",
      "Uroflowmetry advised"
    ]);
    expect(dashboard.follow_up.appointments).toHaveLength(1);
    expect(dashboard.follow_up.appointments[0].notes).toContain("follow up");
    expect(dashboard.procedures).toEqual([
      expect.objectContaining({ name: "Uroflowmetry advised", source: "clinical_notes", status: "mentioned" })
    ]);

    const handwrittenNote = dashboard.clinical_notes.find((note: { source_type: string; summary: string }) => note.source_type === "handwritten");
    expect(handwrittenNote).toBeTruthy();
    expect(handwrittenNote.summary).toBe("Follow up after 2 weeks");

    const syntheticNote = dashboard.clinical_notes.find((note: { source_type: string; type: string }) => note.source_type === "synthetic" && note.type === "Diagnosis");
    expect(syntheticNote).toBeTruthy();
  });

  it("prefers handwritten notes over synthetic notes in selection", () => {
    const selector = new NoteSelectorTool();
    const selected = selector.select([
      {
        type: "Clinical Summary",
        author: "System",
        summary: "Synthetic overview",
        source_type: "synthetic",
        is_synthetic: true
      },
      {
        type: "Diagnosis",
        author: "Dr. A",
        summary: "LUTS",
        source_type: "synthetic",
        is_synthetic: true
      },
      {
        type: "Clinical Note",
        author: "Dr. A",
        summary: "Follow up after 2 weeks",
        source_type: "handwritten",
        is_synthetic: false
      }
    ], 1);

    expect(selected).toHaveLength(1);
    expect(selected[0].summary).toBe("Follow up after 2 weeks");
  });

  it("merges fragmentary note prefixes into the following meaningful note", () => {
    const stage3Agent = new HandwritingExtractionAgent();
    const merged = stage3Agent.sanitizeMergedNotes([
      {
        text: "Pl. add:",
        category: "clinical_note",
        confidence: "high",
        source_excerpt: "Pl. add:",
        page_number: 1
      },
      {
        text: "All other treatment to be followed as advised earlier today",
        category: "advice",
        confidence: "high",
        source_excerpt: "All other treatment to be followed as advised earlier today",
        page_number: 1
      }
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("Pl. add: All other treatment to be followed as advised earlier today");
  });
});
