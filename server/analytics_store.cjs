const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { AnalyticsRepository } = require("./repositories/analytics_repository.cjs");

const CANONICAL_DOCUMENT_TYPES = [
  "prescription",
  "discharge_summary",
  "inpatient_record",
  "outpatient_record",
  "lab_report",
  "chart_note",
  "voice_dictation",
  "live_conversation",
  "voice",
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
  const isLiveConversation = result?.meta?.sessionType === "live_conversation";
  // For voice documents, check documentType first; otherwise check meta
  const documentType = normalizeDocumentType(
    document?.documentType === "voice"
      ? (isLiveConversation ? "live_conversation" : "voice_dictation")
      :
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

    // Phase 6: AnalyticsRepository is now the only source of truth
    this.analyticsRepo = new AnalyticsRepository();
    this.analyticsRepo.initialize().catch(err => {
      console.error('[AnalyticsStore] Failed to initialize AnalyticsRepository:', err.message);
    });
  }

  async initialize() {
    // Phase 6: SQLite is no longer used - this is a no-op
    // Analytics data is stored in PostgreSQL only
    return Promise.resolve();
  }

  async close() {
    // Phase 6: SQLite is no longer used - this is a no-op
    return Promise.resolve();
  }

  async upsertDocumentMetrics(document) {
    // Phase 6: Write to Postgres only (legacy SQLite writes removed)
    if (!document || document.status !== "processed") return null;

    const metrics = buildDocumentMetrics(document);
    if (!metrics.documentId) return null;

    try {
      await this.analyticsRepo.initialize();
      // Map legacy metrics structure to Postgres schema - FIXED: use upsertMetrics instead of upsertDocumentMetrics
      await this.analyticsRepo.upsertMetrics({
        document_id: metrics.documentId,
        document_name: metrics.documentName,
        document_type: metrics.documentType,
        processed_at: metrics.processedAt,
        uploaded_at: metrics.uploadedAt,
        gemma_tokens: metrics.gemmaTokens,
        gemini_tokens: metrics.geminiTokens,
        medications_count: metrics.medicationsCount,
        ordered_lab_count: metrics.labTestsCount,
        ordered_radiology_count: metrics.radiologyTestsCount,
        nuclear_medicine_count: metrics.nuclearMedicineTestsCount,
        procedures_count: metrics.proceduresCount
      });
    } catch (error) {
      console.error('[Analytics] Failed to write metrics to Postgres:', error.message);
    }

    return metrics;
  }

  async deleteDocumentMetrics(documentId) {
    // Phase 6: Delete from Postgres only (legacy SQLite writes removed) - FIXED: use deleteMetricsByDocumentId instead of deleteDocumentMetrics
    try {
      await this.analyticsRepo.initialize();
      await this.analyticsRepo.deleteMetricsByDocumentId(String(documentId || ""));
    } catch (error) {
      console.error('[Analytics] Failed to delete metrics from Postgres:', error.message);
    }
  }

  async backfillDocuments(documents = []) {
    // Phase 6: Backfill to Postgres only (legacy SQLite writes removed)
    for (const document of toArray(documents)) {
      if (document?.status === "processed") {
        await this.upsertDocumentMetrics(document);
      }
    }
  }

  async listMetrics() {
    // Phase 6: Read from Postgres only (legacy SQLite reads removed)
    await this.analyticsRepo.initialize();
    const metrics = await this.analyticsRepo.getAllMetrics();
    // Transform to legacy SQLite format for API compatibility
    return metrics.map(metric => ({
      documentId: metric.document_id,
      documentName: metric.document_name,
      documentType: metric.document_type,
      processedAt: metric.processed_at,
      uploadedAt: metric.uploaded_at,
      gemmaTokens: metric.gemma_tokens,
      geminiTokens: metric.gemini_tokens || 0, // May be 0 in Postgres data
      totalTokens: (metric.gemma_tokens || 0) + (metric.gemini_tokens || 0),
      medicationsCount: metric.medications_count,
      labTestsCount: metric.ordered_lab_count,
      radiologyTestsCount: metric.ordered_radiology_count,
      nuclearMedicineTestsCount: metric.nuclear_medicine_count,
      proceduresCount: metric.procedures_count
    }));
  }

  async getOverview() {
    const rows = await this.listMetrics();

    // Normalize inpatient_record to discharge_summary for analytics aggregation
    // since both use the same DischargeExtractorAgent
    function normalizeForAnalytics(documentType) {
      const normalized = normalizeDocumentType(documentType);
      if (normalized === "inpatient_record") return "discharge_summary";
      if (normalized === "voice") return "voice_dictation";
      return normalized;
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
