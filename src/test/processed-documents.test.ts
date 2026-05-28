import { describe, expect, it } from "vitest";

import {
  extractProcessedDocumentResponse,
  getVoiceDocumentDashboardError,
  isVoiceDocumentDashboardReady,
  transformProcessedDocument,
  type ProcessedDocument,
} from "@/lib/processedDocuments";

const createProcessedDocument = (overrides?: Partial<ProcessedDocument>): ProcessedDocument => ({
  id: "doc-1",
  name: "report.pdf",
  size: 1,
  uploadedAt: "2026-04-05T00:00:00Z",
  processedAt: "2026-04-05T00:10:00Z",
  status: "processed",
  department: "General",
  result: {
    meta: {
      pdf_file: "report.pdf",
      department_type: "General",
    },
    dashboard_cards: {},
    sample_patient_data: {
      name: "Test Patient",
      age: 50,
      mrn: "MRN-1",
      admission_date: "2026-04-01",
      discharge_date: "2026-04-05",
    },
    extracted_data: {},
  },
  ...overrides,
});

describe("transformProcessedDocument", () => {
  it("accepts both wrapped and flat processed document payloads", () => {
    const document = createProcessedDocument();

    expect(extractProcessedDocumentResponse(document)).toEqual(document);
    expect(extractProcessedDocumentResponse({ document })).toEqual(document);
    expect(extractProcessedDocumentResponse({})).toBeNull();
  });

  it("suppresses unsupported diagnosis, medications, and discharge sections when provenance is unsafe", () => {
    const transformed = transformProcessedDocument(
      createProcessedDocument({
        result: {
          meta: {
            pdf_file: "report.pdf",
            department_type: "General",
          },
          sample_patient_data: {
            name: "Test Patient",
            age: 50,
            mrn: "MRN-1",
            admission_date: "2026-04-01",
            discharge_date: "2026-04-05",
          },
          dashboard_cards: {
            diagnosis_card: {
              principal_diagnosis: "Hallucinated diagnosis",
              secondary_diagnoses: ["Hallucinated comorbidity"],
            },
            medications_card: {
              medication_list: [{ name: "INJ Imaginary", dose: "1 amp", frequency: "BD" }],
            },
          },
          extracted_data: {
            patient: {
              gender: "Male",
            },
            diagnosis: {
              principal: "Hallucinated diagnosis",
              secondary: ["Hallucinated comorbidity"],
            },
            medications: [{ name: "INJ Imaginary", dose: "1 amp", frequency: "BD" }],
            clinical_notes: [
              {
                type: "Discharge Planning",
                summary: "Report back if fever",
                recommendations: "Diet: Soft diet, Continue physiotherapy",
              },
            ],
            provenance: {
              diagnosis: {
                principal: {
                  value: "Hallucinated diagnosis",
                  source_section: "Diagnosis",
                  source_excerpt: "",
                  provenance_type: "normalized",
                },
                secondary: [
                  {
                    value: "Hallucinated comorbidity",
                    source_section: "Diagnosis",
                    source_excerpt: "",
                    provenance_type: "normalized",
                  },
                ],
              },
              medications: [
                {
                  value: "INJ Imaginary",
                  source_section: "Medication Orders",
                  source_excerpt: "",
                  provenance_type: "normalized",
                },
              ],
              discharge: {
                dietary: [
                  {
                    value: "Soft diet",
                    source_section: "Discharge Planning",
                    source_excerpt: "",
                    provenance_type: "normalized",
                  },
                ],
                instructions: [
                  {
                    value: "Continue physiotherapy",
                    source_section: "Discharge Planning",
                    source_excerpt: "",
                    provenance_type: "normalized",
                  },
                ],
                red_flags: [
                  {
                    value: "Fever",
                    source_section: "Discharge Planning",
                    source_excerpt: "",
                    provenance_type: "normalized",
                  },
                ],
              },
            },
          },
        },
      }),
    );

    expect(transformed.diagnosis.principal.description).toBe("");
    expect(transformed.admission.admissionDiagnosis).toBe("");
    expect(transformed.diagnosis.secondary).toEqual([]);
    expect(transformed.medications.active).toEqual([]);
    expect(transformed.dischargePlan.dietary).toEqual([]);
    expect(transformed.dischargePlan.activityRestrictions.okToDo).toEqual([]);
    expect(transformed.dischargePlan.redFlags).toEqual([]);
  });

  it("keeps legacy fallback behavior when provenance is absent", () => {
    const transformed = transformProcessedDocument(
      createProcessedDocument({
        result: {
          meta: {
            pdf_file: "report.pdf",
            department_type: "General",
          },
          sample_patient_data: {
            name: "Test Patient",
            age: 50,
            mrn: "MRN-1",
            admission_date: "2026-04-01",
            discharge_date: "2026-04-05",
          },
          dashboard_cards: {
            diagnosis_card: {
              principal_diagnosis: "Pneumonia",
              secondary_diagnoses: ["Hypertension"],
            },
            medications_card: {
              medication_list: [{ name: "TAB Paracetamol", dose: "500 mg", frequency: "TDS" }],
            },
          },
          extracted_data: {
            patient: {
              gender: "Male",
            },
            clinical_notes: [
              {
                type: "Discharge Planning",
                summary: "Report back if fever",
                recommendations: "Diet: Soft diet, Continue breathing exercises",
              },
            ],
          },
        },
      }),
    );

    expect(transformed.diagnosis.principal.description).toBe("Pneumonia");
    expect(transformed.admission.admissionDiagnosis).toBe("Pneumonia");
    expect(transformed.medications.active).toHaveLength(1);
    expect(transformed.dischargePlan.dietary).toEqual(["Diet: Soft diet"]);
    expect(transformed.dischargePlan.activityRestrictions.okToDo).toEqual(["Continue breathing exercises."]);
    expect(transformed.dischargePlan.redFlags).toEqual(["Fever."]);
  });

  it("dedupes medication entries and does not fabricate medication changes from the active list", () => {
    const transformed = transformProcessedDocument(
      createProcessedDocument({
        result: {
          meta: {
            pdf_file: "report.pdf",
            department_type: "General",
          },
          sample_patient_data: {
            name: "Test Patient",
            age: 50,
            mrn: "MRN-1",
            admission_date: "2026-04-01",
            discharge_date: "2026-04-05",
          },
          dashboard_cards: {
            medications_card: {
              medication_list: [
                { name: "TAB Paracetamol", dose: "500 mg", frequency: "TDS" },
                { name: "TAB Paracetamol", dose: "500 mg", frequency: "TDS" },
              ],
            },
          },
          extracted_data: {
            patient: {
              gender: "Male",
            },
          },
        },
      }),
    );

    expect(transformed.medications.active).toHaveLength(1);
    expect(transformed.medications.active[0].name).toBe("TAB Paracetamol");
    expect(transformed.medications.changes).toEqual({
      added: [],
      adjusted: [],
      discontinued: [],
    });
  });

  it("normalizes object-shaped allergies and investigations and falls back to document_type for department", () => {
    const transformed = transformProcessedDocument(
      createProcessedDocument({
        department: "Inpatient nursing / medical",
        result: {
          meta: {
            pdf_file: "Clinical_Summary.pdf",
            document_type: "outpatient_record",
            router: {
              detected_type: "outpatient_record",
            },
          },
          sample_patient_data: {
            name: "Atiar Rahaman Molla",
            age: 30,
            mrn: "MH004962073",
            admission_date: "",
            discharge_date: "2025-02-27",
          },
          dashboard_cards: {
            medications_card: {
              allergies: [
                { name: "Sulpha Drugs", status: "No" },
                { name: "Penicillin", status: "No" },
              ],
            },
            labs_card: {
              investigations_list: [
                {
                  test_name: "Ultrasonography",
                  finding: "Mild urinary bladder wall thickening with significant postvoid residue.",
                },
                { test_name: "ECG", finding: "WNL" },
              ],
            },
          },
          extracted_data: {
            patient: {
              gender: "Male",
            },
            investigations: [
              {
                test_name: "Echo Cardiography",
                finding: "Normal",
              },
            ],
          },
        },
      }),
    );

    expect(transformed.admission.department).toBe("Outpatient Record");
    expect(transformed.medications.allergies).toEqual([
      expect.objectContaining({ allergen: "Sulpha Drugs: No" }),
      expect.objectContaining({ allergen: "Penicillin: No" }),
    ]);
    expect(transformed.labs.investigations).toEqual([
      "Ultrasonography: Mild urinary bladder wall thickening with significant postvoid residue.",
      "ECG: WNL",
    ]);
  });

  it("does not duplicate source notes in the handover section cards", () => {
    const transformed = transformProcessedDocument(
      createProcessedDocument({
        result: {
          meta: {
            pdf_file: "report.pdf",
            department_type: "General",
          },
          sample_patient_data: {
            name: "Test Patient",
            age: 50,
            mrn: "MRN-1",
            admission_date: "2026-04-01",
            discharge_date: "2026-04-05",
          },
          dashboard_cards: {},
          extracted_data: {
            patient: {
              gender: "Male",
            },
            clinical_notes: [
              {
                type: "Handover Note",
                author: "Dr. A",
                date: "2026-04-05",
                summary: "**Watch closely** for overnight desaturation.",
                recommendations: "- Repeat pulse oximetry\n- Escalate if SpO2 drops",
              },
            ],
          },
        },
      }),
    );

    expect(transformed.clinicalNotes.notes).toHaveLength(1);
    expect(transformed.clinicalNotes.handover.sections.map((section) => section.title)).not.toContain("Source Notes");
  });

  it("preserves hospital number and exact department from stage1 prescription data", () => {
    const transformed = transformProcessedDocument(
      createProcessedDocument({
        result: {
          meta: {
            pdf_file: "Prescription_04.pdf",
            document_type: "prescription",
            visit_type: "OPD",
          },
          sample_patient_data: {
            name: "",
            age: null,
            mrn: "",
            admission_date: "",
            discharge_date: "",
          },
          dashboard_cards: {},
          extracted_data: {
            stage1: {
              patient: {
                name: "MR TEST PATIENT",
                age: 59,
                gender: "Male",
                hospital_no: "MH000004664",
              },
              visit: {
                department: "NEUROLOGY MHB",
                visit_type: "OPD",
                episode_number: "O00011843893",
              },
              doctor: {
                specialty: "NEUROLOGY",
              },
              phi: {
                hospital_no: "MH000004664",
              },
            },
          },
        },
      }),
    );

    expect(transformed.patient.name).toBe("MR TEST PATIENT");
    expect(transformed.patient.mrn).toBe("MH000004664");
    expect(transformed.admission.department).toBe("NEUROLOGY MHB");
    expect(transformed.admission.admissionDate).toBe("");
  });

  it("does not fabricate source-backed vitals for sparse outpatient prescriptions", () => {
    const transformed = transformProcessedDocument(
      createProcessedDocument({
        result: {
          meta: {
            pdf_file: "Prescription_03.pdf",
            document_type: "prescription",
          },
          sample_patient_data: {
            name: "MRS HELEN MARTIS",
            age: 77,
            mrn: "MH000003683",
            admission_date: "",
            discharge_date: "",
          },
          dashboard_cards: {
            vitals_card: {
              summary: {
                latest_bp: "",
                pulse: null,
                temp: null,
                spo2: null,
              },
              data_points: 0,
            },
          },
          extracted_data: {
            vitals: {
              latest: {
                bp: { systolic: 0, diastolic: 0 },
                pulse: { value: 0 },
                temperature: { value: 0 },
                spo2: { value: 0 },
                resp_rate: { value: 0 },
              },
              has_vitals: false,
            },
          },
          presentation: {
            summary_cards: {
              vitals: {
                headline_metric: "0/0 mmHg",
                secondary_line: "Pulse 0 bpm",
                supporting_points: ["SpO2 0%"],
                status: "warning",
              },
            },
          },
        },
      }),
    );

    expect(transformed.presentation.summaryCards.vitals.headlineMetric).toBe("");
    expect(transformed.presentation.summaryCards.vitals.supportingPoints).toContain("No source-backed vitals documented.");
  });

  it("maps voice follow-up appointments and weight into dashboard data", () => {
    const transformed = transformProcessedDocument(
      createProcessedDocument({
        documentType: "voice",
        result: {
          meta: {
            source_type: "voice_transcript",
            voice_session_id: "voice-1",
          },
          sample_patient_data: {
            name: "John Doe",
            age: 45,
            mrn: "MRN-77",
            admission_date: "",
            discharge_date: "",
            weight: { value: 77, unit: "kg" },
          },
          dashboard_cards: {
            vitals_card: {
              status: "stable",
              summary: {
                latest_bp: "120/80",
                pulse: 72,
                temp: null,
                spo2: null,
                weight: 77,
              },
              data_points: 2,
            },
            diagnosis_card: {
              principal_diagnosis: "Coronary artery disease",
              secondary_diagnoses: ["Hypertension"],
            },
            clinical_notes_card: {
              total_notes: 1,
              notes: [
                {
                  type: "Voice Dictation",
                  author: "Physician",
                  date: "2026-05-20",
                  summary: "Assessment coronary artery disease. Plan follow up in 2 weeks.",
                },
              ],
            },
            follow_up_card: {
              next_appointment: "in 2 weeks",
              appointment_count: 1,
              appointments: [
                {
                  department: "Cardiology",
                  physician: "",
                  date: "in 2 weeks",
                  time: "",
                  purpose: "review",
                },
              ],
            },
          },
          extracted_data: {
            patient: {
              name: "John Doe",
              mrn: "MRN-77",
              age: 45,
              gender: "Male",
            },
            diagnosis: {
              principal: "Coronary artery disease",
              secondary: ["Hypertension"],
              symptoms: ["Chest pain", "Denies shortness of breath"],
            },
            vitals: {
              latest: {
                bp: { systolic: 120, diastolic: 80 },
                pulse: { value: 72 },
                weight: { value: 77, unit: "kg" },
              },
            },
            follow_up: {
              items: [
                {
                  specialty: "Cardiology",
                  timing: "in 2 weeks",
                  reason: "review",
                },
              ],
            },
            clinical_notes: [
              {
                type: "Voice Dictation",
                author: "Physician",
                date: "2026-05-20",
                summary: "Assessment coronary artery disease. Plan follow up in 2 weeks.",
              },
            ],
          },
        },
      }),
    );

    expect(transformed.patient.weight).toEqual({ value: 77, unit: "kg" });
    expect(transformed.vitals.latest.weight).toEqual({ value: 77, unit: "kg" });
    expect(transformed.followUp).toEqual([
      expect.objectContaining({
        department: "Cardiology",
        date: "in 2 weeks",
        purpose: "review",
      }),
    ]);
  });

  it("normalizes indexed voice principal diagnosis objects into renderable text", () => {
    const document = createProcessedDocument({
      documentType: "voice",
      result: {
        meta: {
          source_type: "voice",
          voice_session_id: "voice-indexed-principal",
        },
        dashboard_cards: {
          diagnosis_card: {
            principal_diagnosis: "",
            secondary_diagnoses: ["Lumbar disc herniation"],
          },
          clinical_notes_card: {
            total_notes: 1,
            notes: [{ summary: "Lumbar foraminal stenosis documented." }],
          },
        },
        sample_patient_data: {
          name: "",
          age: 55,
          mrn: "",
        },
        extracted_data: {
          patient: {
            name: "",
            mrn: "",
            age: 55,
            gender: "female",
          },
          diagnosis: {
            principal: {
              0: {
                name: "Lumbar foraminal stenosis at L4-5",
                icd_code: "M48.068",
              },
              provenance: {},
            },
            secondary: [{ name: "Lumbar disc herniation" }],
          },
          clinical_notes: [
            {
              type: "Voice Dictation",
              summary: "Lumbar foraminal stenosis documented.",
            },
          ],
        },
      },
    });

    const transformed = transformProcessedDocument(document);

    expect(transformed.diagnosis.principal.description).toBe("Lumbar foraminal stenosis at L4-5");
    expect(transformed.diagnosis.principal.code).toBe("M48.068");
    expect(getVoiceDocumentDashboardError(document)).toBeNull();
    expect(isVoiceDocumentDashboardReady(document)).toBe(true);
  });

  it("treats valid processed voice documents as dashboard-ready", () => {
    const document = createProcessedDocument({
      documentType: "voice",
      result: {
        meta: {
          source_type: "voice",
          voice_session_id: "voice-ready",
        },
        dashboard_cards: {
          diagnosis_card: {
            principal_diagnosis: "Coronary artery disease",
          },
          clinical_notes_card: {
            total_notes: 1,
            notes: [{ summary: "Assessment documented." }],
          },
        },
        sample_patient_data: {
          name: "John Doe",
          age: 45,
          mrn: "MRN-77",
        },
        extracted_data: {
          diagnosis: {
            principal: "Coronary artery disease",
          },
          clinical_notes: [
            {
              type: "Voice Dictation",
              summary: "Assessment documented.",
            },
          ],
        },
      },
    });

    expect(getVoiceDocumentDashboardError(document)).toBeNull();
    expect(isVoiceDocumentDashboardReady(document)).toBe(true);
  });

  it("flags processed voice documents with incomplete payloads as not dashboard-ready", () => {
    const document = createProcessedDocument({
      documentType: "voice",
      error: null,
      result: {
        meta: {
          source_type: "voice",
          voice_session_id: "voice-bad",
        },
        dashboard_cards: {},
        sample_patient_data: {
          name: "",
          age: null,
          mrn: "",
        },
        extracted_data: {
          meta: {
            source_type: "voice_transcript",
          },
        },
      },
    });

    expect(getVoiceDocumentDashboardError(document)).toBe("Voice extraction completed but dashboard payload was incomplete.");
    expect(isVoiceDocumentDashboardReady(document)).toBe(false);
  });
});
