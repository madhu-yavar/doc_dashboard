import { createRequire } from "module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const VoiceExtractorAgent = require("../../agents/voice_extractor_agent.cjs");
const DashboardMapperSkill = require("../../skills/clinical/dashboard_mapper.skill.cjs");

const transcript = {
  rawText: "John Doe is a 45-year-old male with chest pain. He denies shortness of breath. Weight is 77 kilograms. Physical exam lungs clear. Assessment coronary artery disease. Plan follow up in 2 weeks.",
  language: "en-US",
  overallConfidence: 0.97,
  segments: [
    { id: "seg-1", speakerRole: "doctor", speakerLabel: "Doctor", startLabel: "00:00", endLabel: "00:05", startMs: 0, endMs: 5000, text: "John Doe is a 45-year-old male with chest pain.", confidence: 0.99 },
    { id: "seg-2", speakerRole: "doctor", speakerLabel: "Doctor", startLabel: "00:05", endLabel: "00:10", startMs: 5000, endMs: 10000, text: "He denies shortness of breath.", confidence: 0.99 },
    { id: "seg-3", speakerRole: "doctor", speakerLabel: "Doctor", startLabel: "00:10", endLabel: "00:15", startMs: 10000, endMs: 15000, text: "Weight is 77 kilograms, blood pressure 120 over 80, heart rate 72.", confidence: 0.98 },
    { id: "seg-4", speakerRole: "doctor", speakerLabel: "Doctor", startLabel: "00:15", endLabel: "00:20", startMs: 15000, endMs: 20000, text: "Review of systems otherwise negative. Physical exam lungs clear and no edema.", confidence: 0.98 },
    { id: "seg-5", speakerRole: "doctor", speakerLabel: "Doctor", startLabel: "00:20", endLabel: "00:25", startMs: 20000, endMs: 25000, text: "Assessment coronary artery disease with hypertension.", confidence: 0.98 },
    { id: "seg-6", speakerRole: "doctor", speakerLabel: "Doctor", startLabel: "00:25", endLabel: "00:30", startMs: 25000, endMs: 30000, text: "Plan follow up in 2 weeks with cardiology for review.", confidence: 0.98 },
  ],
};

describe("Voice pipeline regressions", () => {
  it("merges flat demographics, preserves weight and structured voice findings, and keeps late transcript details in the note summary", async () => {
    const agent = new VoiceExtractorAgent({ logSteps: false });

    agent.medicationsSkill.execute = vi.fn().mockResolvedValue({
      success: true,
      data: {
        medications: [
          {
            name: "Aspirin",
            dose: "81 mg",
            frequency: "daily",
            route: "oral",
            status: "continue",
            provenance: { segment_id: "seg-6", time_range: { start_ms: 25000, end_ms: 30000 }, quoted_text: "Plan follow up in 2 weeks with cardiology for review." },
          },
        ],
      },
    });
    agent.demographicsSkill.execute = vi.fn().mockResolvedValue({
      success: true,
      data: {
        name: "John Doe",
        mrn: "MRN-77",
        age: 45,
        gender: "Male",
        admission_date: "",
        discharge_date: "",
      },
    });
    agent.diagnosisSkill.execute = vi.fn().mockResolvedValue({
      success: true,
      data: {
        diagnosis: {
          principal: {
            name: "Coronary artery disease",
            icd_code: "I25.10",
            status: "active",
            provenance: { segment_id: "seg-5", time_range: { start_ms: 20000, end_ms: 25000 }, quoted_text: "Assessment coronary artery disease with hypertension." },
          },
          secondary: [
            {
              name: "Hypertension",
              icd_code: "I10",
              status: "chronic",
              provenance: { segment_id: "seg-5", time_range: { start_ms: 20000, end_ms: 25000 }, quoted_text: "Assessment coronary artery disease with hypertension." },
            },
          ],
          rule_out: [],
        },
        symptoms: [
          {
            name: "chest pain",
            status: "present",
            duration: "current visit",
            provenance: { segment_id: "seg-1", time_range: { start_ms: 0, end_ms: 5000 }, quoted_text: "John Doe is a 45-year-old male with chest pain." },
          },
          {
            name: "shortness of breath",
            status: "denied",
            duration: "",
            provenance: { segment_id: "seg-2", time_range: { start_ms: 5000, end_ms: 10000 }, quoted_text: "He denies shortness of breath." },
          },
        ],
      },
    });
    agent.clinicalSkill.execute = vi.fn().mockResolvedValue({
      success: true,
      data: {
        vitals: {
          bp_systolic: 120,
          bp_diastolic: 80,
          pulse: 72,
          weight: { value: 77, unit: "kg" },
          provenance: { segment_id: "seg-3", time_range: { start_ms: 10000, end_ms: 15000 }, quoted_text: "Weight is 77 kilograms, blood pressure 120 over 80, heart rate 72." },
        },
        lab_results: [],
        radiology: [],
        procedures: [],
        follow_up: [
          {
            specialty: "Cardiology",
            timing: "in 2 weeks",
            reason: "review",
            provenance: { segment_id: "seg-6", time_range: { start_ms: 25000, end_ms: 30000 }, quoted_text: "Plan follow up in 2 weeks with cardiology for review." },
          },
        ],
        allergies: [],
        review_of_systems: [
          {
            system: "Respiratory",
            finding: "shortness of breath",
            status: "denied",
            provenance: { segment_id: "seg-2", time_range: { start_ms: 5000, end_ms: 10000 }, quoted_text: "He denies shortness of breath." },
          },
        ],
        physical_exam: [
          {
            system: "Respiratory",
            finding: "lungs clear",
            status: "normal",
            provenance: { segment_id: "seg-4", time_range: { start_ms: 15000, end_ms: 20000 }, quoted_text: "Physical exam lungs clear and no edema." },
          },
          {
            system: "Extremities",
            finding: "no edema",
            status: "normal",
            provenance: { segment_id: "seg-4", time_range: { start_ms: 15000, end_ms: 20000 }, quoted_text: "Physical exam lungs clear and no edema." },
          },
        ],
      },
    });

    const result = await agent.execute("voice-session-1", transcript);

    expect(result.success).toBe(true);
    expect(result.extractedData.patient).toEqual(
      expect.objectContaining({
        name: "John Doe",
        mrn: "MRN-77",
        age: 45,
        gender: "Male",
      }),
    );
    expect(result.extractedData.vitals.latest.weight).toEqual({ value: 77, unit: "kg" });
    expect(result.extractedData.diagnosis.symptoms).toEqual(
      expect.arrayContaining(["chest pain (current visit)", "Denies shortness of breath"]),
    );
    expect(result.extractedData.review_of_systems.negatives).toContain("Respiratory: Denies shortness of breath");
    expect(result.extractedData.physical_exam.normal_findings).toEqual(
      expect.arrayContaining(["Respiratory: lungs clear", "Extremities: no edema"]),
    );
    expect(result.extractedData.follow_up.items).toHaveLength(1);
    expect(result.extractedData.clinical_notes[0].summary).toContain("Plan follow up in 2 weeks with cardiology for review.");
    expect(result.extractedData.clinical_notes[0].source_excerpt).toContain("Plan follow up in 2 weeks with cardiology for review.");
    expect(result.dashboardPayload.follow_up_card).toEqual(
      expect.objectContaining({
        next_appointment: "in 2 weeks",
        appointment_count: 1,
      }),
    );
  });

  it("maps voice follow-up items and weight into dashboard sample data", async () => {
    const mapper = new DashboardMapperSkill();

    const result = await mapper.execute({
      agentResult: {
        data: {
          patient: { name: "John Doe", age: 45, gender: "Male", mrn: "MRN-77" },
          diagnosis: {
            principal: { name: "Coronary artery disease", icd_code: "I25.10" },
            secondary: [{ name: "Hypertension" }],
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
          meta: {
            source_type: "voice_transcript",
          },
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.data.dashboard_cards.follow_up_card).toEqual(
      expect.objectContaining({
        next_appointment: "in 2 weeks",
        appointment_count: 1,
      }),
    );
    expect(result.data.dashboard_cards.follow_up_card.appointments[0]).toEqual(
      expect.objectContaining({
        department: "Cardiology",
        date: "in 2 weeks",
        purpose: "review",
      }),
    );
    expect(result.data.sample_patient_data.weight).toEqual({ value: 77, unit: "kg" });
    expect(result.data.sample_patient_data.vitals.latest.weight).toEqual({ value: 77, unit: "kg" });
  });
});
