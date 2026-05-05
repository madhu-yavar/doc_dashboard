// @vitest-environment node

import fs from "fs/promises";
import os from "os";
import path from "path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const analyticsModulePromise = import("../../server/analytics_store.cjs");

function createDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    name: "Prescription.pdf",
    status: "processed",
    uploadedAt: "2026-05-04T08:00:00.000Z",
    processedAt: "2026-05-04T08:05:00.000Z",
    result: {
      meta: {
        router: {
          detected_type: "prescription",
        },
        document_type: "prescription",
      },
      dashboard_cards: {
        medications_card: {
          active_count: 2,
        },
      },
      extracted_data: {
        medications: [{ name: "A" }, { name: "B" }],
        investigations: [{ type: "CBC", status: "ordered" }],
        radiology: [{ type: "MRI", status: "ordered" }],
        nuclear_medicine: [{ type: "PET", status: "ordered" }],
        procedures: [{ name: "Biopsy", status: "mentioned" }],
      },
    },
    agentInfo: {
      tokensUsed: 180,
      providerTokens: {
        gemma: 120,
        gemini: 60,
      },
    },
    ...overrides,
  };
}

const tempDirs: string[] = [];
const stores: Array<{ close: () => Promise<void> }> = [];

async function makeStore() {
  const { AnalyticsStore } = await analyticsModulePromise;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "landing-analytics-"));
  tempDirs.push(dir);
  const store = new AnalyticsStore({
    storageDir: dir,
    databasePath: path.join(dir, "analytics.sqlite"),
  });
  await store.initialize();
  stores.push(store);
  return { store, dir };
}

afterEach(async () => {
  await Promise.all(
    stores.splice(0).map(async (store) => {
      await store.close();
    }),
  );
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("landing analytics backend", () => {
  it("derives provider tokens and ordered counts from processed documents", async () => {
    const { buildDocumentMetrics } = await analyticsModulePromise;
    const metrics = buildDocumentMetrics(createDocument());

    expect(metrics.documentType).toBe("prescription");
    expect(metrics.gemmaTokens).toBe(120);
    expect(metrics.geminiTokens).toBe(60);
    expect(metrics.totalTokens).toBe(180);
    expect(metrics.medicationsCount).toBe(2);
    expect(metrics.labTestsCount).toBe(1);
    expect(metrics.radiologyTestsCount).toBe(1);
    expect(metrics.nuclearMedicineTestsCount).toBe(1);
    expect(metrics.proceduresCount).toBe(1);
  });

  it("falls back to gemma-only tokens, supports backfill, and updates rows after handwriting completion", async () => {
    const { store } = await makeStore();
    const prescription = createDocument();
    const discharge = createDocument({
      id: "doc-2",
      name: "Discharge.pdf",
      result: {
        meta: {
          router: {
            detected_type: "discharge_summary",
          },
        },
        dashboard_cards: {
          medications_card: {
            active_count: 0,
          },
        },
        extracted_data: {
          medications: [],
          investigations: [{ type: "CBC", status: "completed" }],
          radiology: [],
          nuclear_medicine: [],
          procedures: [],
        },
      },
      agentInfo: {
        tokensUsed: 75,
      },
    });

    await store.backfillDocuments([prescription, discharge]);
    let overview = await store.getOverview();

    expect(overview.summary.includedDocuments).toBe(2);
    expect(overview.tokensByProvider.gemma).toBe(195);
    expect(overview.tokensByProvider.gemini).toBe(60);
    expect(overview.documentsByType.find((entry: { documentType: string }) => entry.documentType === "discharge_summary")?.count).toBe(1);
    expect(overview.testsByDocumentType.find((entry: { documentType: string }) => entry.documentType === "discharge_summary")?.lab).toBe(0);

    const completedHandwriting = createDocument({
      result: {
        meta: {
          router: {
            detected_type: "prescription",
          },
        },
        dashboard_cards: {
          medications_card: {
            active_count: 4,
          },
        },
        extracted_data: {
          medications: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }],
          investigations: [{ type: "CBC", status: "ordered" }, { type: "LFT", status: "ordered" }],
          radiology: [{ type: "MRI", status: "ordered" }],
          nuclear_medicine: [],
          procedures: [{ name: "Biopsy", status: "ordered" }],
        },
      },
      agentInfo: {
        tokensUsed: 220,
        providerTokens: {
          gemma: 120,
          gemini: 100,
        },
      },
    });

    await store.upsertDocumentMetrics(completedHandwriting);
    overview = await store.getOverview();

    const prescriptionMeds = overview.medicationsByDocumentType.find(
      (entry: { documentType: string }) => entry.documentType === "prescription",
    );
    const prescriptionTests = overview.testsByDocumentType.find(
      (entry: { documentType: string }) => entry.documentType === "prescription",
    );

    expect(overview.tokensByProvider.gemini).toBe(100);
    expect(prescriptionMeds?.count).toBe(4);
    expect(prescriptionTests?.lab).toBe(2);
    expect(prescriptionTests?.procedures).toBe(1);
  });

  it("removes deleted documents and serves the overview API payload", async () => {
    const { registerAnalyticsRoutes } = await analyticsModulePromise;
    const { store } = await makeStore();

    await store.backfillDocuments([
      createDocument(),
      createDocument({
        id: "doc-2",
        name: "Outpatient.pdf",
        result: {
          meta: {
            router: {
              detected_type: "outpatient_record",
            },
          },
          dashboard_cards: {
            medications_card: {
              active_count: 1,
            },
          },
          extracted_data: {
            medications: [{ name: "A" }],
            investigations: [{ type: "HbA1c", status: "ordered" }],
            radiology: [],
            nuclear_medicine: [],
            procedures: [],
          },
        },
        agentInfo: {
          tokensUsed: 80,
        },
      }),
    ]);

    await store.deleteDocumentMetrics("doc-2");
    const overviewAfterDelete = await store.getOverview();
    expect(overviewAfterDelete.summary.includedDocuments).toBe(1);

    const app = express();
    registerAnalyticsRoutes(app, store);
    const routeLayer = app.router.stack.find(
      (layer: { route?: { path?: string } }) => layer.route?.path === "/api/analytics/overview",
    );
    const handler = routeLayer?.route?.stack?.[0]?.handle as ((req: unknown, res: unknown) => Promise<void>) | undefined;
    expect(handler).toBeTypeOf("function");
    const req = {};
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await handler?.(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    const [overview] = res.json.mock.calls[0];
    expect(overview).toHaveProperty("documentsByType");
    expect(overview).toHaveProperty("tokensByProvider");
    expect(overview).toHaveProperty("medicationsByDocumentType");
    expect(overview).toHaveProperty("testsByDocumentType");
    expect(overview.summary.includedDocuments).toBe(1);
  });

  it("backfills processed documents from the live loader before serving overview", async () => {
    const { registerAnalyticsRoutes } = await analyticsModulePromise;
    const { store } = await makeStore();

    const app = express();
    registerAnalyticsRoutes(app, store, async () => [
      createDocument(),
      createDocument({
        id: "doc-2",
        name: "Discharge.pdf",
        result: {
          meta: {
            router: {
              detected_type: "discharge_summary",
            },
          },
          dashboard_cards: {
            medications_card: {
              active_count: 0,
            },
          },
          extracted_data: {
            medications: [],
            investigations: [{ type: "CBC", status: "ordered" }],
            radiology: [],
            nuclear_medicine: [],
            procedures: [],
          },
        },
        agentInfo: {
          tokensUsed: 75,
        },
      }),
    ]);

    const routeLayer = app.router.stack.find(
      (layer: { route?: { path?: string } }) => layer.route?.path === "/api/analytics/overview",
    );
    const handler = routeLayer?.route?.stack?.[0]?.handle as ((req: unknown, res: unknown) => Promise<void>) | undefined;
    expect(handler).toBeTypeOf("function");

    const req = {};
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await handler?.(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    const [overview] = res.json.mock.calls[0];
    expect(overview.summary.includedDocuments).toBe(2);
    expect(overview.documentsByType.find((entry: { documentType: string }) => entry.documentType === "prescription")?.count).toBe(1);
    expect(overview.documentsByType.find((entry: { documentType: string }) => entry.documentType === "discharge_summary")?.count).toBe(1);
  });
});
