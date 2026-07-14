import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

const {
  enrichDashboardPayload,
  enrichItem,
  hasDashboardPayloadEnrichment,
} = require("../../server/item_master_enrichment.cjs");

const telmaMatch = {
  itemCode: "1000006223",
  itemDesc: "TELMA 40 MG TABLET",
  bgCode: "M",
  bgDesc: "Pharmacy",
  bsgCode: "MPHY-C",
  bsgDesc: "PHARMACY",
  category: "Service",
  confidence: "high",
  score: 0.99,
};

describe("item master enrichment", () => {
  it("enriches the nested dashboard medication card rendered by the UI", () => {
    const lookup = {
      search: vi.fn(() => [telmaMatch]),
    };
    const payload = {
      dashboard_cards: {
        medications_card: {
          medication_list: [
            { name: "TAB TELMA", dose: "40mg", frequency: "1-0-0" },
          ],
        },
      },
    };

    const enriched = enrichDashboardPayload(payload, lookup);
    const enrichedMedication = enriched.dashboard_cards.medications_card.medication_list[0];

    expect(lookup.search).toHaveBeenCalledWith("TAB TELMA 40mg", {
      domain: "medication",
      limit: 1,
    });
    expect(enrichedMedication._itemMaster).toMatchObject({
      itemCode: "1000006223",
      itemDesc: "TELMA 40 MG TABLET",
      matched: true,
      confidence: "high",
    });
  });

  it("uses medication dose with the name when matching extracted medications", () => {
    const lookup = {
      search: vi.fn(() => [telmaMatch]),
    };

    enrichItem({ name: "TAB TELMA", dose: "40mg" }, lookup, "medication");

    expect(lookup.search).toHaveBeenCalledWith("TAB TELMA 40mg", {
      domain: "medication",
      limit: 1,
    });
  });

  it("does not treat a root-level mapping as enough when the nested dashboard card is stale", () => {
    const payload = {
      medications_card: {
        medication_list: [
          { name: "TAB TELMA", _itemMaster: { matched: true } },
        ],
      },
      dashboard_cards: {
        medications_card: {
          medication_list: [
            { name: "TAB TELMA", dose: "40mg" },
          ],
        },
      },
    };

    expect(hasDashboardPayloadEnrichment(payload)).toBe(false);
  });
});
