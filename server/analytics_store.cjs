const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const CANONICAL_DOCUMENT_TYPES = [
  "prescription",
  "discharge_summary",
  "inpatient_record",
  "outpatient_record",
  "lab_report",
  "chart_note",
  "unknown",
];

function normalizeDocumentType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CANONICAL_DOCUMENT_TYPES.includes(normalized) ? normalized : "unknown";
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function extractMedicationCount(document) {
  const activeCount = document?.result?.dashboard_cards?.medications_card?.active_count;
  if (typeof activeCount === "number" && Number.isFinite(activeCount)) {
    return activeCount;
  }
  return toArray(document?.result?.extracted_data?.medications).length;
}

function isOrderedItem(item, allowedStatuses) {
  if (!item || typeof item !== "object") return false;
  const status = String(item.status || "").trim().toLowerCase();
  return allowedStatuses.includes(status);
}

function countOrderedItems(items, allowedStatuses) {
  return toArray(items).filter((item) => isOrderedItem(item, allowedStatuses)).length;
}

function extractNuclearMedicineItems(document) {
  const nuclearMedicine = document?.result?.extracted_data?.nuclear_medicine;
  if (Array.isArray(nuclearMedicine)) return nuclearMedicine;
  return toArray(nuclearMedicine?.selected_studies);
}

function resolveProviderTokens(document) {
  const totalTokens = toNumber(document?.agentInfo?.tokensUsed);
  const providerTokens = document?.agentInfo?.providerTokens;
  if (providerTokens && typeof providerTokens === "object") {
    const gemmaTokens = toNumber(providerTokens.gemma);
    const geminiTokens = toNumber(providerTokens.gemini);
    return {
      gemmaTokens,
      geminiTokens,
      totalTokens: gemmaTokens + geminiTokens,
    };
  }

  return {
    gemmaTokens: totalTokens,
    geminiTokens: 0,
    totalTokens,
  };
}

function buildDocumentMetrics(document) {
  const result = document?.result;
  const documentType = normalizeDocumentType(
    result?.meta?.router?.detected_type || result?.meta?.document_type
  );
  const investigations = toArray(result?.extracted_data?.investigations);
  const radiology = toArray(result?.extracted_data?.radiology);
  const procedures = toArray(result?.extracted_data?.procedures);
  const nuclearMedicine = extractNuclearMedicineItems(document);
  const { gemmaTokens, geminiTokens, totalTokens } = resolveProviderTokens(document);

  return {
    documentId: String(document?.id || ""),
    documentName: String(document?.name || ""),
    documentType,
    processedAt: document?.processedAt || null,
    uploadedAt: document?.uploadedAt || null,
    gemmaTokens,
    geminiTokens,
    totalTokens,
    medicationsCount: extractMedicationCount(document),
    labTestsCount: countOrderedItems(investigations, ["ordered"]),
    radiologyTestsCount: countOrderedItems(radiology, ["ordered"]),
    nuclearMedicineTestsCount: countOrderedItems(nuclearMedicine, ["ordered"]),
    proceduresCount: countOrderedItems(procedures, ["ordered", "mentioned"]),
  };
}

class AnalyticsStore {
  constructor(config = {}) {
    this.databasePath =
      config.databasePath ||
      path.join(config.storageDir || path.join(__dirname, "storage"), "analytics.sqlite");
    this.db = null;
  }

  async initialize() {
    if (this.db) return;

    this.db = new DatabaseSync(this.databasePath);
    // Enable WAL mode for better concurrency on cloud storage
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_metrics (
        document_id TEXT PRIMARY KEY,
        document_name TEXT NOT NULL,
        document_type TEXT NOT NULL,
        processed_at TEXT,
        uploaded_at TEXT,
        gemma_tokens INTEGER NOT NULL DEFAULT 0,
        gemini_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        medications_count INTEGER NOT NULL DEFAULT 0,
        lab_tests_count INTEGER NOT NULL DEFAULT 0,
        radiology_tests_count INTEGER NOT NULL DEFAULT 0,
        nuclear_medicine_tests_count INTEGER NOT NULL DEFAULT 0,
        procedures_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  async close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  async upsertDocumentMetrics(document) {
    await this.initialize();
    if (!document || document.status !== "processed") return null;

    const metrics = buildDocumentMetrics(document);
    if (!metrics.documentId) return null;

    this.db.prepare(`
      INSERT INTO document_metrics (
        document_id,
        document_name,
        document_type,
        processed_at,
        uploaded_at,
        gemma_tokens,
        gemini_tokens,
        total_tokens,
        medications_count,
        lab_tests_count,
        radiology_tests_count,
        nuclear_medicine_tests_count,
        procedures_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET
        document_name = excluded.document_name,
        document_type = excluded.document_type,
        processed_at = excluded.processed_at,
        uploaded_at = excluded.uploaded_at,
        gemma_tokens = excluded.gemma_tokens,
        gemini_tokens = excluded.gemini_tokens,
        total_tokens = excluded.total_tokens,
        medications_count = excluded.medications_count,
        lab_tests_count = excluded.lab_tests_count,
        radiology_tests_count = excluded.radiology_tests_count,
        nuclear_medicine_tests_count = excluded.nuclear_medicine_tests_count,
        procedures_count = excluded.procedures_count
    `).run(
      metrics.documentId,
      metrics.documentName,
      metrics.documentType,
      metrics.processedAt,
      metrics.uploadedAt,
      metrics.gemmaTokens,
      metrics.geminiTokens,
      metrics.totalTokens,
      metrics.medicationsCount,
      metrics.labTestsCount,
      metrics.radiologyTestsCount,
      metrics.nuclearMedicineTestsCount,
      metrics.proceduresCount,
    );

    return metrics;
  }

  async deleteDocumentMetrics(documentId) {
    await this.initialize();
    this.db.prepare("DELETE FROM document_metrics WHERE document_id = ?").run(String(documentId || ""));
  }

  async backfillDocuments(documents = []) {
    await this.initialize();
    for (const document of toArray(documents)) {
      if (document?.status === "processed") {
        await this.upsertDocumentMetrics(document);
      }
    }
  }

  async listMetrics() {
    await this.initialize();
    return this.db.prepare(`
      SELECT
        document_id AS documentId,
        document_name AS documentName,
        document_type AS documentType,
        processed_at AS processedAt,
        uploaded_at AS uploadedAt,
        gemma_tokens AS gemmaTokens,
        gemini_tokens AS geminiTokens,
        total_tokens AS totalTokens,
        medications_count AS medicationsCount,
        lab_tests_count AS labTestsCount,
        radiology_tests_count AS radiologyTestsCount,
        nuclear_medicine_tests_count AS nuclearMedicineTestsCount,
        procedures_count AS proceduresCount
      FROM document_metrics
    `).all();
  }

  async getOverview() {
    const rows = await this.listMetrics();

    // Normalize inpatient_record to discharge_summary for analytics aggregation
    // since both use the same DischargeExtractorAgent
    function normalizeForAnalytics(documentType) {
      const normalized = normalizeDocumentType(documentType);
      return normalized === "inpatient_record" ? "discharge_summary" : normalized;
    }

    const byType = new Map(
      CANONICAL_DOCUMENT_TYPES.map((documentType) => {
        const key = normalizeForAnalytics(documentType);
        return [
          key,
          {
            documentType: key,
            documents: 0,
            medications: 0,
            lab: 0,
            radiology: 0,
            nuclearMedicine: 0,
            procedures: 0,
          },
        ];
      }),
    );

    let gemma = 0;
    let gemini = 0;

    for (const row of rows) {
      const normalizedType = normalizeForAnalytics(row.documentType);
      const bucket = byType.get(normalizedType);
      if (!bucket) continue;

      bucket.documents += toNumber(row.documents) || 1;
      bucket.medications += toNumber(row.medicationsCount);
      bucket.lab += toNumber(row.labTestsCount);
      bucket.radiology += toNumber(row.radiologyTestsCount);
      bucket.nuclearMedicine += toNumber(row.nuclearMedicineTestsCount);
      bucket.procedures += toNumber(row.proceduresCount);

      gemma += toNumber(row.gemmaTokens);
      gemini += toNumber(row.geminiTokens);
    }

    // Get unique types after normalization (excludes inpatient_record since it maps to discharge_summary)
    const displayTypes = [...new Set(CANONICAL_DOCUMENT_TYPES.map(normalizeForAnalytics))];

    const documentsByType = displayTypes.map((documentType) => ({
      documentType,
      count: byType.get(documentType)?.documents || 0,
    }));
    const medicationsByDocumentType = displayTypes.map((documentType) => ({
      documentType,
      count: byType.get(documentType)?.medications || 0,
    }));
    const testsByDocumentType = displayTypes.map((documentType) => ({
      documentType,
      lab: byType.get(documentType)?.lab || 0,
      radiology: byType.get(documentType)?.radiology || 0,
      nuclearMedicine: byType.get(documentType)?.nuclearMedicine || 0,
      procedures: byType.get(documentType)?.procedures || 0,
    }));

    return {
      documentsByType,
      tokensByProvider: {
        gemma,
        gemini,
        total: gemma + gemini,
      },
      medicationsByDocumentType,
      testsByDocumentType,
      summary: {
        includedDocuments: rows.length,
        refreshedAt: new Date().toISOString(),
      },
    };
  }
}

function registerAnalyticsRoutes(app, analyticsStore, loadDocuments) {
  app.get("/api/analytics/overview", async (_req, res) => {
    try {
      if (typeof loadDocuments === "function") {
        const documents = await loadDocuments();
        await analyticsStore.backfillDocuments(documents);
      }
      const overview = await analyticsStore.getOverview();
      res.json(overview);
    } catch (error) {
      console.error("Failed to build analytics overview", error);
      res.status(500).json({ error: "Unable to load analytics overview." });
    }
  });
}

module.exports = {
  AnalyticsStore,
  CANONICAL_DOCUMENT_TYPES,
  buildDocumentMetrics,
  normalizeDocumentType,
  registerAnalyticsRoutes,
};
