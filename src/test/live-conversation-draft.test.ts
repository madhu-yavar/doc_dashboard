import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  buildRequiredReviewItems,
  parseRequiredFieldPatch,
  normalizeLiveDraft,
  mergeLiveDraft,
  EMPTY_LIVE_DRAFT,
} = require("../../server/live_conversation_draft.cjs");

describe("live conversation draft required fields", () => {
  it("marks patient sex as a select with constrained options", () => {
    const reviewItems = buildRequiredReviewItems(
      { linkedPatient: "Anita Rao" },
      {
        patient: { age: 52, gender: "" },
        vitals: {
          latest: {
            bp: { systolic: 120, diastolic: 80 },
            pulse: { value: 72, unit: "bpm" },
            temperature: { value: 98.6, unit: "F" },
            spo2: { value: 99, unit: "%" },
            weight: { value: 62, unit: "kg" },
          },
        },
      },
    );

    expect(reviewItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: "patient.gender",
          inputType: "select",
          options: ["Male", "Female", "Other"],
        }),
      ]),
    );
  });

  it("rejects arbitrary patient sex text and accepts canonical values", () => {
    expect(() =>
      parseRequiredFieldPatch("patient.gender", "sometimes", {
        patient: { gender: "" },
      }),
    ).toThrow(/valid patient sex/i);

    expect(
      parseRequiredFieldPatch("patient.gender", "female", {
        patient: { gender: "" },
      }),
    ).toEqual({
      sessionPatch: {},
      draftPatch: {
        patient: {
          gender: "Female",
        },
      },
    });
  });

  it("mirrors required patient name edits into both session and draft state", () => {
    expect(
      parseRequiredFieldPatch("linkedPatient", "Ashiq", {
        patient: { name: "" },
      }),
    ).toEqual({
      sessionPatch: {
        linkedPatient: "Ashiq",
      },
      draftPatch: {
        patient: {
          name: "Ashiq",
        },
      },
    });
  });
});

describe("PR-3: live conversation draft assessment field", () => {
  it("initializes empty draft with assessment field separate from diagnosis", () => {
    const draft = normalizeLiveDraft({});

    expect(draft).toHaveProperty("assessment");
    expect(draft).toHaveProperty("diagnosis");
    expect(draft.assessment).toBe("");
    expect(draft.diagnosis).toBe("");
  });

  it("maintains assessment field separately from diagnosis during merge", () => {
    const existingDraft = {
      diagnosis: "Old diagnosis",
      assessment: "Acute viral upper respiratory tract infection",
      symptoms: ["Fever", "Cough"],
    };

    const incomingDraft = {
      assessment: "Viral upper respiratory infection",
      symptoms: ["Fever", "Cough", "Sore throat"],
    };

    const merged = mergeLiveDraft(existingDraft, incomingDraft);

    expect(merged.diagnosis).toBe("Old diagnosis"); // Diagnosis unchanged
    expect(merged.assessment).toBe("Viral upper respiratory infection"); // Assessment updated
    expect(merged.symptoms).toHaveLength(3); // Symptoms merged
  });

  it("falls back to diagnosis if assessment is not provided", () => {
    const draft = normalizeLiveDraft({
      diagnosis: "Fallback diagnosis",
      assessment: "",
    });

    expect(draft.diagnosis).toBe("Fallback diagnosis");
    expect(draft.assessment).toBe("");
  });

  it("preserves assessment when diagnosis is updated separately", () => {
    const existingDraft = {
      diagnosis: "",
      assessment: "Acute bronchitis",
      symptoms: ["Cough"],
    };

    const incomingDraft = {
      diagnosis: "Updated diagnosis", // Only diagnosis provided
    };

    const merged = mergeLiveDraft(existingDraft, incomingDraft);

    expect(merged.diagnosis).toBe("Updated diagnosis");
    expect(merged.assessment).toBe("Acute bronchitis"); // Assessment preserved
  });

  it("uses consistent fallback when assessment is empty but symptoms exist", () => {
    const draft = normalizeLiveDraft({
      assessment: "", // Empty assessment
      symptoms: ["Cough", "Fever"], // Non-empty symptoms
    });

    // Assessment should remain empty, not fall back to symptoms
    expect(draft.assessment).toBe("");
    expect(draft.symptoms).toEqual(["Cough", "Fever"]);
  });
});
