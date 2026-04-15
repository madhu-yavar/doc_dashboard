import { createRequire } from "module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const ChartNoteAgent = require("../../agents/chart_note_agent.cjs");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("ChartNoteAgent", () => {
  it("replaces truncated assessment content before final assembly", () => {
    const agent = new ChartNoteAgent();

    const note = agent.compileChartNote({
      allergies: "No Known Allergies (NKDA)",
      subjective: "Patient admitted with abdominal pain and monitored through the admission.",
      comorbidities: "Gestational diabetes.",
      objective: "Vitals stable. Abdomen soft. Fetal status reassuring.",
      procedures: "Observation and supportive management.",
      hospitalCourse: "Patient improved with inpatient monitoring and conservative treatment.",
      assessment: "PRIMARY DIAGNOSIS\n• G2P1L1 at 3\n***** END OF RECORD *****",
      pending: "No pending investigations documented at discharge.",
      plan: "Return precautions reviewed with the patient. Follow-up arranged with obstetrics.",
      nursing: "Routine nursing support provided.",
      riskFlags: "No significant risk flags identified.",
      extractedData: {
        patient: { name: "Test Patient", age: 30, gender: "Female" },
        admission: { admission_date: "2026-04-01", discharge_date: "2026-04-03" },
        diagnosis: {
          principal: "G2P1L1 at 37 weeks gestation",
          secondary: ["Gestational diabetes"]
        },
        treatment: {
          current_approach: "observation and supportive care",
          response: "symptoms improved during admission"
        }
      },
      validationSummary: "Confidence: 90%"
    });

    expect(note).toContain("ASSESSMENT\nPrincipal diagnosis: G2P1L1 at 37 weeks gestation.");
    expect(note).toContain("Secondary diagnoses: Gestational diabetes.");
    expect(note).not.toContain("• G2P1L1 at 3");
    expect(note.match(/END OF RECORD/g)?.length).toBe(1);
  });

  it("falls back when plan content is too thin to be clinically usable", () => {
    const agent = new ChartNoteAgent();

    const note = agent.compileChartNote({
      allergies: "No Known Allergies (NKDA)",
      subjective: "Patient admitted for evaluation and improved clinically.",
      comorbidities: "Hypertension.",
      objective: "Vitals stable and pain controlled.",
      procedures: "No procedures performed.",
      hospitalCourse: "Uneventful stay with supportive care.",
      assessment: "Principal diagnosis: Chest pain under evaluation with good response to treatment.",
      pending: "No pending investigations documented at discharge.",
      plan: "Stable.",
      nursing: "Routine nursing care.",
      riskFlags: "No significant risk flags identified.",
      extractedData: {
        diagnosis: { principal: "Chest pain" },
        medications: [{ name: "Aspirin", dose: "75 mg", frequency: "OD", route: "PO" }],
        follow_up: { specialty: "Cardiology", when: "within 1 week" },
        discharge_instructions: {
          activity: ["Avoid strenuous exertion"],
          red_flags: ["Return for worsening chest pain"]
        }
      },
      validationSummary: "Confidence: 90%"
    });

    expect(note).toContain("PLAN\nDischarge medications:");
    expect(note).toContain("Aspirin 75 mg OD PO");
    expect(note).toContain("Follow-up: Cardiology - within 1 week.");
  });

  it("parses refined sections from the review step", async () => {
    const agent = new ChartNoteAgent();
    agent.gemmaClient.execute = vi.fn().mockResolvedValue({
      success: true,
      content: `[[REVIEW]]
Assessment and plan were strengthened.

[[ALLERGIES]]
KEEP

[[SUBJECTIVE]]
KEEP

[[COMORBIDITIES]]
KEEP

[[OBJECTIVE]]
KEEP

[[PROCEDURES]]
KEEP

[[HOSPITAL_COURSE]]
KEEP

[[ASSESSMENT]]
Principal diagnosis: Community acquired pneumonia with improved oxygenation and readiness for discharge.

[[PENDING]]
KEEP

[[PLAN]]
Continue oral antibiotics, review in pulmonary clinic within 1 week, and return for worsening dyspnea.

[[NURSING]]
KEEP

[[RISK_FLAGS]]
KEEP`,
      usage: { totalTokens: 123 }
    });

    const result = await agent.reviewAndRefine({
      allergies: "No Known Allergies (NKDA)",
      subjective: "Patient presented with fever, cough, and shortness of breath over three days.",
      comorbidities: "Diabetes mellitus.",
      objective: "SpO2 improved to 97% on room air with stable blood pressure and pulse.",
      procedures: "No procedures performed.",
      hospitalCourse: "Improved with antibiotics and supportive care.",
      assessment: "Pneumonia.",
      pending: "No pending investigations documented at discharge.",
      plan: "Stable.",
      nursing: "Routine nursing care.",
      riskFlags: "No significant risk flags identified.",
      validationSummary: "Confidence: 92%",
      extractedData: {
        diagnosis: { principal: "Community acquired pneumonia" },
        follow_up: { specialty: "Pulmonary", when: "within 1 week" }
      }
    });

    expect(result.review).toContain("Assessment and plan were strengthened.");
    expect(result.refined.allergies).toBeNull();
    expect(result.refined.assessment).toContain("Community acquired pneumonia");
    expect(result.refined.plan).toContain("pulmonary clinic within 1 week");
  });

  it("runs independent chart note sections in parallel and applies refined consolidation", async () => {
    const agent = new ChartNoteAgent();
    let active = 0;
    let maxActive = 0;

    const trackedStep = (content: string, delay = 35) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(delay);
      active -= 1;
      return { content, usage: { totalTokens: 10 } };
    };

    agent.thinkAboutClinicalPicture = vi.fn().mockResolvedValue({
      insights: "Clinical picture understood.",
      usage: { totalTokens: 10 }
    });
    agent.thinkAboutSOAPStructure = vi.fn().mockResolvedValue({
      subjective: "History and symptoms",
      objective: "Clinical findings",
      assessment: "Clinical impression",
      plan: "Discharge planning",
      usage: { totalTokens: 10 }
    });

    agent.generateAllergies = trackedStep("No Known Allergies (NKDA)");
    agent.generateSubjective = trackedStep("Patient was admitted with worsening cough, fever, and dyspnea requiring inpatient monitoring.");
    agent.generateComorbidities = trackedStep("• Type 2 diabetes mellitus\n• Hypertension");
    agent.generateObjective = trackedStep("Vital signs stabilized prior to discharge. Oxygen saturation improved and chest findings were reassessed.");
    agent.generateProcedures = trackedStep("No invasive procedures were performed during this admission.");
    agent.generateHospitalCourse = async (_data: unknown, subjectiveContent: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(35);
      active -= 1;
      return {
        content: `Hospital course tracked from admission narrative: ${subjectiveContent}`,
        usage: { totalTokens: 10 }
      };
    };
    agent.generateAssessment = trackedStep("Initial assessment draft that is clinically thin and should be strengthened during consolidation.");
    agent.generatePendingInvestigations = trackedStep("No pending investigations documented at discharge.");
    agent.generatePlan = trackedStep("Initial plan draft that should be replaced by the consolidation phase because it lacks medication and follow-up detail.");
    agent.generateNursingCare = trackedStep("Routine nursing care with fall precautions education.");
    agent.generateRiskFlags = trackedStep("No significant risk flags identified.");
    agent.reviewAndRefine = vi.fn().mockResolvedValue({
      review: "Assessment and plan were consolidated.",
      refined: {
        allergies: null,
        subjective: null,
        comorbidities: null,
        objective: null,
        procedures: null,
        hospitalCourse: null,
        assessment: "Principal diagnosis: Community acquired pneumonia with clear improvement after inpatient therapy and safe discharge planning.",
        pending: null,
        plan: "Discharge medications:\n- Amoxicillin-clavulanate 625 mg TID PO\nFollow-up: Pulmonary - within 1 week.\nReturn precautions: worsening breathlessness or fever.",
        nursing: null,
        riskFlags: null
      },
      usage: { totalTokens: 10 }
    });

    const result = await agent.execute({
      extractedData: {
        patient: { name: "Test Patient", age: 62, gender: "Male" },
        diagnosis: { principal: "Community acquired pneumonia" }
      },
      pdfText: "Source text",
      citationData: { summary: {} },
      validationSummary: "Confidence: 91%"
    });

    expect(result.success).toBe(true);
    expect(maxActive).toBeGreaterThan(1);
    expect(result.data.chart_note).toContain("Principal diagnosis: Community acquired pneumonia");
    expect(result.data.chart_note).toContain("Amoxicillin-clavulanate 625 mg TID PO");
    expect(agent.reviewAndRefine).toHaveBeenCalledOnce();
  });
});
