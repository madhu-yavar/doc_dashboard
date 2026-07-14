import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SOAPService } = require("../../server/soap_service.cjs");

describe("SOAPService", () => {
  it("maps live conversation documents into SOAP sections", () => {
    const service = new SOAPService();

    const soap = service.mapDocumentToSOAP({
      id: "voice-live-live-123",
      name: "Conversation - Live",
      documentType: "voice",
      linkedPatient: "Ashiq",
      encounterLabel: "EN000123",
      result: {
        meta: {
          sessionType: "live_conversation",
          sessionId: "live-123",
          patientName: "Ashiq",
        },
        dashboard_cards: {
          vitals_card: {
            summary: {
              latest_bp: "120/80",
            },
          },
        },
        extracted_data: {
          patient_info: {
            name: "Ashiq",
            age: 42,
            gender: "Male",
          },
          chief_complaint: "Chest pain",
          hpi: "Intermittent chest pain for two days.",
          ros: ["Positive: Shortness of breath"],
          pastHistory: ["Type 2 diabetes"],
          diagnosis: "Angina",
          symptoms: ["Chest pain"],
          medications: [{ name: "Aspirin", instruction: "75mg once daily" }],
          labs: ["CBC"],
          radiology: ["ECG"],
          plan: ["Start aspirin"],
          follow_up: ["Cardiology review in one week"],
        },
      },
    });

    expect(soap.patient.name).toBe("Ashiq");
    expect(soap.soap.subjective).toContain("HPI: Intermittent chest pain for two days.");
    expect(soap.soap.objective).toContain("Blood pressure: 120/80");
    // PR-3: Changed from "Primary diagnosis:" to "Assessment:" for live conversations
    expect(soap.soap.assessment).toContain("Assessment: Angina");
    expect(soap.soap.plan.some((item) => item.includes("Medications: Aspirin"))).toBe(true);
  });

  it("maps processed dashboard documents into SOAP sections", () => {
    const service = new SOAPService();

    const soap = service.mapDocumentToSOAP({
      id: "doc-123",
      name: "OPD Visit",
      department: "General Medicine",
      processedAt: "2026-06-08T09:00:00.000Z",
      result: {
        meta: {
          episode_number: "EP-0091",
          rx_date: "2026-06-08",
        },
        extracted_data: {
          patient: {
            name: "Madhu",
            age: 35,
            gender: "Female",
            mrn: "MRN-55",
          },
          doctor: {
            name: "Dr. Patel",
            registration_number: "KA-12345",
          },
          diagnosis: {
            principal: "Viral fever",
            secondary: ["Dehydration"],
            comorbidities: ["Diabetes mellitus"],
            symptoms: ["Fever"],
          },
          review_of_systems: {
            positives: ["Fever"],
            negatives: ["Chest pain"],
          },
          vitals: {
            latest: {
              temperature: {
                value: 101,
                unit: "F",
              },
            },
          },
          physical_exam: {
            abnormal_findings: ["Mild dehydration"],
          },
          medications: [
            {
              name: "Paracetamol",
              dose: "650mg",
              frequency: "TID",
            },
          ],
          follow_up: {
            items: ["Review in 3 days"],
          },
          treatment: {
            current_approach: "Supportive care",
            management_items: ["Hydration"],
          },
        },
        dashboard_cards: {},
      },
    });

    expect(soap.patient.ageSex).toBe("35 Yrs / Female");
    expect(soap.soap.subjective.some((item) => item.includes("Review of systems: Positive: Fever"))).toBe(true);
    expect(soap.soap.objective).toContain("Temperature: 101 F");
    expect(soap.soap.assessment).toContain("Primary diagnosis: Viral fever");
    expect(soap.soap.plan.some((item) => item.includes("Management approach: Supportive care"))).toBe(true);
  });

  it("renders a compact hospital-form SOAP HTML with both Manipal and Yavar branding", async () => {
    const service = new SOAPService();

    const html = await service.renderSOAPHTML({
      hospital: {
        name: "Manipal Hospitals",
        tagline: "Care • Safety • Trust",
        department: "GENERAL MEDICINE",
        branch: "Main Branch",
        address: "Manipal Hospitals",
      },
      patient: {
        name: "Ashiq",
        ageSex: "42 Yrs / Male",
        hospitalNo: "MRN-100",
        mobile: "",
        email: "",
      },
      visit: {
        episodeNo: "EP-100",
        dateTime: "2026-06-09T09:00:00.000Z",
      },
      consultant: {
        name: "Dr. Yavar",
        regNo: "KA-1000",
        department: "GENERAL MEDICINE",
      },
      soap: {
        subjective: ["Chief complaint: Chest pain"],
        objective: ["Blood pressure: 120/80"],
        assessment: ["Primary diagnosis: Angina"],
        plan: ["Medications: Aspirin"],
      },
      _metadata: {
        sourceDocument: "OPD Visit",
        sourceDocumentId: "doc-100",
        generatedAt: "2026-06-09T09:10:00.000Z",
        department: "GENERAL MEDICINE",
        noteType: "SOAP",
      },
    });

    expect(html).toContain("SOAP Clinical Note");
    expect(html).toContain("template-14");
    expect(html).toContain("Patient and visit details");
    expect(html).toContain("alt=\"Manipal Hospitals\"");
    expect(html).toContain("alt=\"Yavar\"");
    expect(html).not.toContain("SOAP Note Agent");
    expect(html).not.toContain("Clinical Documentation Format");
    expect(html).not.toContain("Manipal Hospitals • GENERAL MEDICINE");
  });

  it("uses consistent fallback for empty assessment with non-empty symptoms in live conversations", () => {
    const service = new SOAPService();

    const soap = service.mapDocumentToSOAP({
      id: "voice-doc-123",
      name: "Live Conversation",
      department: "General Medicine",
      processedAt: "2026-06-11T10:00:00.000Z",
      documentType: "voice",
      result: {
        meta: {
          sessionType: "live_conversation",
          sessionId: "live-session-456",
        },
        extracted_data: {
          assessment: "", // Empty assessment
          symptoms: ["Cough", "Fever"], // Non-empty symptoms
          chief_complaint: "Cough and fever",
          hpi: "Patient reports symptoms",
        },
        dashboard_cards: {},
      },
      createdBy: { username: "test-doctor" },
      linkedPatient: "Test Patient",
    } as any);

    // Should show consistent fallback message
    expect(soap.soap.assessment).toEqual(["Assessment pending clinician review."]);

    // Should NOT show symptoms as assessment
    expect(soap.soap.assessment).not.toContain("Cough");
    expect(soap.soap.assessment).not.toContain("Fever");
  });
});
