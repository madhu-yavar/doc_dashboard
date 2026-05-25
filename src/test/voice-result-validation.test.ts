import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  VOICE_DASHBOARD_INCOMPLETE_ERROR,
  validateVoiceDashboardResult,
} = require("../../server/voice_result_validation.cjs");

describe("validateVoiceDashboardResult", () => {
  it("accepts renderable voice dashboard payloads", () => {
    const validation = validateVoiceDashboardResult({
      dashboard_cards: {
        diagnosis_card: {
          principal_diagnosis: "Coronary artery disease",
        },
        clinical_notes_card: {
          total_notes: 1,
        },
      },
      extracted_data: {
        diagnosis: {
          principal: "Coronary artery disease",
        },
        clinical_notes: [
          {
            summary: "Assessment documented.",
          },
        ],
      },
    });

    expect(validation.valid).toBe(true);
    expect(validation.error).toBeNull();
  });

  it("rejects voice payloads missing dashboard cards", () => {
    const validation = validateVoiceDashboardResult({
      extracted_data: {
        diagnosis: {
          principal: "Coronary artery disease",
        },
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.error).toBe(VOICE_DASHBOARD_INCOMPLETE_ERROR);
    expect(validation.details).toContain("missing dashboard_cards");
  });

  it("rejects voice payloads with no meaningful clinical content", () => {
    const validation = validateVoiceDashboardResult({
      dashboard_cards: {},
      extracted_data: {
        meta: {
          source_type: "voice_transcript",
        },
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.error).toBe(VOICE_DASHBOARD_INCOMPLETE_ERROR);
    expect(validation.details).toContain("no renderable clinical content");
  });
});
