import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HandwritingExtractionAgent = require("../../agents/extraction/handwriting_extraction_agent.cjs");
const DataIntegrationAgent = require("../../agents/extraction/data_integration_agent.cjs");
const DashboardMapperSkill = require("../../skills/clinical/dashboard_mapper.skill.cjs");

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

  it("promotes note-derived structured orders through stage 3 reconciliation", () => {
    const stage3Agent = new HandwritingExtractionAgent();
    const compiled = stage3Agent.compileStage3Data({
      medications: { data: { medications: [], total_count: 0, has_unreadable: false, unreadable_count: 0 } },
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
      notes: {
        data: {
          notes: [
            {
              text: "Urine culture, USG abdomen pelvis, uroflowmetry + PVR advised",
              category: "advice",
              confidence: "high",
              is_inferred: false,
              confidence_reason: "",
              source_excerpt: "Urine culture, USG abdomen pelvis, uroflowmetry + PVR advised",
              page_number: 1,
              source_type: "handwritten",
              is_synthetic: false
            }
          ],
          has_notes: true,
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
          confidence: "medium"
        }
      },
      visualElements: {
        data: {
          lab_investigations: { selected_tests: [], total_available: 0, total_selected: 0 },
          radiology: { selected_studies: [] },
          has_selections: false,
          confidence: "high"
        }
      },
      structuredReconciliation: {
        data: {
          lab_investigations: [
            { test_name: "Urine Culture", category: "microbiology", is_uncertain: false, confidence_reason: "", source: "note_reconciliation" }
          ],
          radiology: {
            selected_studies: [
              { study_name: "Ultrasound Abdomen & Pelvis", category: "imaging", is_uncertain: false, confidence_reason: "", source: "note_reconciliation" }
            ]
          },
          nuclear_medicine: {
            selected_studies: [
              { study_name: "DTPA Renal Scan", category: "renal", is_uncertain: false, confidence_reason: "", source: "note_reconciliation" }
            ]
          },
          procedures: [
            { name: "Uroflowmetry + PVR", category: "urology", is_uncertain: false, confidence_reason: "", source: "note_reconciliation" }
          ],
          has_additions: true,
          confidence: "high"
        }
      }
    });

    expect(compiled.lab_investigations.selected_tests).toContainEqual(
      expect.objectContaining({ test_name: "Urine Culture", source: "note_reconciliation" })
    );
    expect(compiled.radiology_selections.selected_studies).toContainEqual(
      expect.objectContaining({ study_name: "Ultrasound Abdomen & Pelvis", source: "note_reconciliation" })
    );
    expect(compiled.nuclear_medicine.selected_studies).toContainEqual(
      expect.objectContaining({ study_name: "DTPA Renal Scan", source: "note_reconciliation" })
    );
    expect(compiled.procedures).toContainEqual(
      expect.objectContaining({ name: "Uroflowmetry + PVR", source: "note_reconciliation" })
    );
  });

  describe("Prescription dashboard mapping regression test", () => {
    it("correctly maps prescription extraction data to dashboard cards", () => {
      const integrationAgent = new DataIntegrationAgent();

      // Simulate Stage 1 (header) data
      const stage1Data = {
        patient: { name: "John Doe", age: 45, gender: "Male", mrn: "MRN-12345" },
        hospital: { name: "Test Hospital" },
        doctor: { name: "Dr. Smith (MD)" },
        visit: { date: "2026-04-30", visit_type: "OPD" }
      };

      // Simulate Stage 3 (handwriting) data with follow-up instructions
      const stage3Data = {
        medications: [
          { name: "Metformin 500mg", dosage: "500mg", frequency: "BD", route: "Oral" },
          { name: "Amlodipine", dosage: "5mg", frequency: "OD", route: "Oral", is_uncertain: true, verification_confidence: "low", verification_uncertain_reason: "Handwriting partially illegible" }
        ],
        medications_metadata: {
          unreadable_count: 1,
          has_unreadable: true,
          confidence: "medium"
        },
        diagnosis: {
          principal: "Type 2 Diabetes Mellitus",
          secondary: ["Hypertension"],
          symptoms: ["Polyuria"],
          clinical_notes: ["Follow up after 2 weeks", "Monitor blood sugar levels"]
        },
        lab_investigations: {
          selected_tests: [
            { test_name: "HbA1c", is_checked: true, source: "visual_selection" },
            { test_name: "Fasting Blood Sugar", is_checked: true, source: "text_order" }
          ],
          total_selected: 2
        },
        radiology_selections: {
          selected_studies: [
            { study_name: "Chest X-ray", is_checked: true, source: "text_order" }
          ]
        },
        vitals: {
          blood_pressure: { systolic: 140, diastolic: 90 },
          has_vitals: true
        }
      };

      // Merge and transform
      const merged = integrationAgent.mergeStageData(stage1Data, stage3Data);
      const dashboard = integrationAgent.transformToDashboardFormat(merged);

      // Verify medications
      expect(dashboard.medications).toHaveLength(2);
      expect(dashboard.medications[0].name).toBe("Metformin 500mg");
      expect(dashboard.medications[0].dose).toBe("500mg"); // Should use dosage
      expect(dashboard.medications[1].is_uncertain).toBe(true);
      expect(dashboard.medications[1].verification_confidence).toBe("low");

      // Verify labs (investigations)
      expect(dashboard.investigations).toHaveLength(2);
      expect(dashboard.investigations.some(i => i.type === "HbA1c")).toBe(true);
      expect(dashboard.investigations.some(i => i.type === "Fasting Blood Sugar")).toBe(true);

      // Verify radiology
      expect(dashboard.radiology).toHaveLength(1);
      expect(dashboard.radiology[0].type).toBe("Chest X-ray");
      expect(dashboard.radiology[0].status).toBe("ordered");

      // Verify follow-up extraction
      expect(dashboard.follow_up.next_appointment).not.toBeNull();
      expect(dashboard.follow_up.appointments).toHaveLength(1);
      expect(dashboard.follow_up.appointments[0].type).toBe("Follow-up");

      // Verify diagnosis
      expect(dashboard.diagnosis.principal).toBe("Type 2 Diabetes Mellitus");
      expect(dashboard.diagnosis.secondary).toContain("Hypertension");

      // Verify medications metadata is preserved
      expect(dashboard.medications_metadata.unreadable_count).toBe(1);
      expect(dashboard.medications_metadata.has_unreadable).toBe(true);
    });

    it("correctly maps dashboard cards from prescription data", async () => {
      const mapper = new DashboardMapperSkill();

      const prescriptionData = {
        patient: { name: "Jane Doe", age: 52, gender: "Female" },
        meta: { document_type: "prescription", rx_date: "2026-04-30" },
        medications: [
          { name: "Aspirin", dosage: "75mg", frequency: "OD", route: "Oral" },
          { name: "Unclear Med", dosage: "Unknown", frequency: "TDS", is_uncertain: true }
        ],
        medications_metadata: {
          unreadable_count: 1,
          has_unreadable: true,
          confidence: "low"
        },
        investigations: [
          { type: "Lipid Profile", status: "ordered" }
        ],
        radiology: [
          { type: "ECG", status: "ordered", source: "text_order" }
        ],
        diagnosis: {
          principal: "Hypertension",
          secondary: ["Dyslipidemia"]
        },
        follow_up: {
          next_appointment: "2026-05-14",
          appointments: [{ date: "2026-05-14", type: "Follow-up", status: "scheduled" }]
        },
        procedures: [
          { name: "ECG", source: "clinical_notes", status: "mentioned" }
        ]
      };

      const result = await mapper.execute({ agentResult: { data: prescriptionData } });

      expect(result.success).toBe(true);
      const cards = result.data.dashboard_cards;

      // Verify medications card
      expect(cards.medications_card.active_count).toBe(2);
      expect(cards.medications_card.unreadable_count).toBe(1);
      expect(cards.medications_card.medication_list).toHaveLength(2);

      // Verify first med uses dosage -> dose mapping
      const firstMed = cards.medications_card.medication_list[0];
      expect(firstMed.name).toBe("Aspirin");
      expect(firstMed.dose).toBe("75mg"); // Mapped from dosage
      expect(firstMed.dosage).toBe("75mg"); // Also included for compatibility

      // Verify uncertain med flags
      const uncertainMed = cards.medications_card.medication_list[1];
      expect(uncertainMed.is_uncertain).toBe(true);

      // Verify labs card
      expect(cards.labs_card.total_tests).toBe(1);
      expect(cards.labs_card.investigations_list).toContainEqual(
        expect.objectContaining({ type: "Lipid Profile" })
      );

      // Verify radiology card uses data.radiology, not data.investigations
      expect(cards.radiology_card.studies_completed).toBe(1);
      expect(cards.radiology_card.radiology_list).toContainEqual(
        expect.objectContaining({ type: "ECG" })
      );

      // Verify follow-up card
      expect(cards.follow_up_card.next_appointment).toBe("2026-05-14");
      expect(cards.follow_up_card.appointment_count).toBe(1);

      // Verify diagnosis card includes procedures count
      expect(cards.diagnosis_card.procedures_count).toBe(1);

      // Verify presentation cards surface actual structured order names
      const summaryCards = result.data.presentation.summary_cards;
      expect(summaryCards.labs.supporting_points).toContain("Lipid Profile");
      expect(summaryCards.radiology.supporting_points).toContain("ECG");
      expect(summaryCards.treatment.supporting_points.some((point: string) => point.includes("ECG"))).toBe(true);
    });
  });
});
