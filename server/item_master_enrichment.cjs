/**
 * Item Master Enrichment Service
 *
 * Wraps extracted data with item master codes without disturbing the original extraction.
 * Runs as a background job after extraction completes.
 */

const {
  ItemServiceMasterLookup,
  buildMedicationMappingText,
} = require('./item_service_master_lookup.cjs');

const DEFAULT_DATABASE_PATH = require('path').join(__dirname, 'storage', 'item_service_master.sqlite');

/**
 * Enrich a single medication/item with item master codes
 */
function enrichItem(item, lookup, domain = 'medication') {
  if (!item || !item.name) {
    return { ...item, _itemMaster: null };
  }

  const itemName = String(item.name).trim();
  if (!itemName) {
    return { ...item, _itemMaster: null };
  }

  try {
    const lookupText = domain === 'medication' ? buildMedicationMappingText(item) : itemName;
    const matches = lookup.search(lookupText || itemName, { domain, limit: 1 });
    if (matches && matches.length > 0) {
      const match = matches[0];
      return {
        ...item,
        _itemMaster: {
          itemCode: match.itemCode,
          itemDesc: match.itemDesc,
          bgCode: match.bgCode || null,
          bgDesc: match.bgDesc || null,
          bsgCode: match.bsgCode || null,
          bsgDesc: match.bsgDesc || null,
          category: match.category || null,
          confidence: match.confidence || 'low',
          score: match.score || 0,
          matched: match.confidence !== 'unmatched'
        }
      };
    }
  } catch (error) {
    console.error(`Item master lookup failed for "${itemName}":`, error.message);
  }

  return { ...item, _itemMaster: null };
}

/**
 * Enrich medications with item master codes
 */
function enrichMedications(medications, lookup) {
  if (!Array.isArray(medications)) return [];
  return medications.map(med => enrichItem(med, lookup, 'medication'));
}

/**
 * Enrich lab results with item master codes
 */
function enrichLabResults(labResults, lookup) {
  if (!Array.isArray(labResults)) return [];
  return labResults.map(lab => enrichItem(lab, lookup, 'lab'));
}

/**
 * Enrich radiology results with item master codes
 */
function enrichRadiologyResults(radiologyResults, lookup) {
  if (!Array.isArray(radiologyResults)) return [];
  return radiologyResults.map(rad => enrichItem(rad, lookup, 'radiology'));
}

/**
 * Enrich procedures with item master codes
 */
function enrichProcedures(procedures, lookup) {
  if (!Array.isArray(procedures)) return [];
  return procedures.map(proc => enrichItem(proc, lookup, 'procedure'));
}

function enrichMedicationCard(medicationsCard, lookup) {
  if (!medicationsCard || !Array.isArray(medicationsCard.medication_list)) {
    return medicationsCard;
  }

  return {
    ...medicationsCard,
    medication_list: enrichMedications(medicationsCard.medication_list, lookup)
  };
}

function hasMedicationCardEnrichment(medicationsCard) {
  const meds = medicationsCard?.medication_list || [];
  return meds.length > 0 && meds[0]?._itemMaster !== undefined;
}

function hasDashboardPayloadEnrichment(dashboardPayload) {
  const nestedCard = dashboardPayload?.dashboard_cards?.medications_card;
  if (Array.isArray(nestedCard?.medication_list) && nestedCard.medication_list.length > 0) {
    return hasMedicationCardEnrichment(nestedCard);
  }

  return hasMedicationCardEnrichment(dashboardPayload?.medications_card);
}

function enrichDashboardPayload(dashboardPayload, lookup) {
  if (!dashboardPayload || typeof dashboardPayload !== 'object') {
    return dashboardPayload;
  }

  let enrichedDashboard = dashboardPayload;

  if (Array.isArray(dashboardPayload.medications_card?.medication_list)) {
    enrichedDashboard = {
      ...enrichedDashboard,
      medications_card: enrichMedicationCard(dashboardPayload.medications_card, lookup)
    };
  }

  if (Array.isArray(dashboardPayload.dashboard_cards?.medications_card?.medication_list)) {
    const dashboardCards = enrichedDashboard.dashboard_cards || {};
    enrichedDashboard = {
      ...enrichedDashboard,
      dashboard_cards: {
        ...dashboardCards,
        medications_card: enrichMedicationCard(dashboardCards.medications_card, lookup)
      }
    };
  }

  return enrichedDashboard;
}

/**
 * Main enrichment function - wraps extracted data with item master codes
 *
 * @param {object} extractedData - The extracted_data_jsonb from a document
 * @param {object} options - Configuration options
 * @returns {object} Enriched data with item master codes added
 */
function enrichExtractedData(extractedData, options = {}) {
  const {
    databasePath = DEFAULT_DATABASE_PATH,
    minScore = 0.55
  } = options;

  if (!extractedData || typeof extractedData !== 'object') {
    return extractedData;
  }

  // Create lookup instance
  const lookup = new ItemServiceMasterLookup({ databasePath, minScore });

  if (!lookup.isAvailable()) {
    console.log('Item master database not available, skipping enrichment');
    return extractedData;
  }

  try {
    // Clone to avoid mutating original
    const enriched = { ...extractedData };

    // Enrich each category
    if (Array.isArray(enriched.medications)) {
      enriched.medications = enrichMedications(enriched.medications, lookup);
    }

    if (Array.isArray(enriched.lab_results)) {
      enriched.lab_results = enrichLabResults(enriched.lab_results, lookup);
    }

    if (Array.isArray(enriched.radiology_results)) {
      enriched.radiology_results = enrichRadiologyResults(enriched.radiology_results, lookup);
    }

    if (Array.isArray(enriched.procedures)) {
      enriched.procedures = enrichProcedures(enriched.procedures, lookup);
    }

    // Also check for ordered medications (if present)
    if (Array.isArray(enriched.ordered_medications)) {
      enriched.ordered_medications = enrichMedications(enriched.ordered_medications, lookup);
    }

    return enriched;
  } finally {
    lookup.close();
  }
}

/**
 * Background job processor for item master enrichment
 * Call this after document extraction completes
 */
async function runEnrichmentJob(pgPool, documentId, options = {}) {
  const { databasePath = DEFAULT_DATABASE_PATH, minScore = 0.55 } = options;

  console.log(`[ItemMasterEnrichment] Starting enrichment for document ${documentId}`);

  try {
    // Fetch current extraction data and ID in one query
    const result = await pgPool.query(
      'SELECT id, extracted_data_jsonb, dashboard_payload_jsonb FROM document_extractions WHERE document_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
      [documentId, 'completed']
    );

    if (result.rows.length === 0) {
      console.log(`[ItemMasterEnrichment] No completed extraction found for document ${documentId}`);
      return { skipped: true, reason: 'no_extraction' };
    }

    const { id: extractionId, extracted_data_jsonb: extractedData, dashboard_payload_jsonb: dashboardPayload } = result.rows[0];

    if (!extractionId) {
      console.log(`[ItemMasterEnrichment] No extraction ID found for document ${documentId}`);
      return { skipped: true, reason: 'no_extraction_id' };
    }

    // Check if already enriched (has _itemMaster fields in extracted_data)
    const hasEnrichment = checkIfEnriched(extractedData);
    // Also check if dashboard_payload medications are enriched.
    // Older payloads may store cards at the root, while current payloads store them under dashboard_cards.
    const hasDashboardEnrichment = hasDashboardPayloadEnrichment(dashboardPayload);

    if (hasEnrichment && hasDashboardEnrichment) {
      console.log(`[ItemMasterEnrichment] Document ${documentId} already enriched, skipping`);
      return { skipped: true, reason: 'already_enriched' };
    }

    // Run enrichment on extracted_data
    const enrichedData = enrichExtractedData(extractedData, { databasePath, minScore });

    // Enrich dashboard_payload medications if they exist. This must update the same card path
    // read by the frontend, otherwise the UI falls back to "No item master mapping available".
    let enrichedDashboard = dashboardPayload;
    if (dashboardPayload && typeof dashboardPayload === 'object') {
      const lookup = new ItemServiceMasterLookup({ databasePath, minScore });

      if (lookup.isAvailable()) {
        try {
          enrichedDashboard = enrichDashboardPayload(dashboardPayload, lookup);
        } finally {
          lookup.close();
        }
      }
    }

    // Update extraction with enriched data
    await pgPool.query(
      'UPDATE document_extractions SET extracted_data_jsonb = $1, dashboard_payload_jsonb = $2 WHERE id = $3',
      [JSON.stringify(enrichedData), JSON.stringify(enrichedDashboard), extractionId]
    );

    // Calculate coverage stats
    const stats = calculateEnrichmentStats(enrichedData);

    console.log(`[ItemMasterEnrichment] Completed enrichment for document ${documentId}`, stats);

    return { success: true, stats };

  } catch (error) {
    console.error(`[ItemMasterEnrichment] Failed for document ${documentId}:`, error);
    throw error;
  }
}

/**
 * Check if data has already been enriched with item master codes
 */
function checkIfEnriched(extractedData) {
  if (!extractedData) return false;

  // Check medications
  const meds = extractedData.medications || extractedData.ordered_medications || [];
  if (meds.length > 0 && meds[0]._itemMaster !== undefined) {
    return true;
  }

  // Check other categories
  for (const key of ['lab_results', 'radiology_results', 'procedures']) {
    const items = extractedData[key] || [];
    if (items.length > 0 && items[0]._itemMaster !== undefined) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate enrichment statistics
 */
function calculateEnrichmentStats(enrichedData) {
  const stats = {
    total: 0,
    matched: 0,
    unmatched: 0,
    high: 0,
    medium: 0,
    low: 0,
    byCategory: {}
  };

  const categories = {
    medications: enrichedData.medications || [],
    ordered_medications: enrichedData.ordered_medications || [],
    lab_results: enrichedData.lab_results || [],
    radiology_results: enrichedData.radiology_results || [],
    procedures: enrichedData.procedures || []
  };

  for (const [category, items] of Object.entries(categories)) {
    if (items.length === 0) continue;

    const categoryStats = { total: items.length, matched: 0, unmatched: 0, high: 0, medium: 0, low: 0 };

    for (const item of items) {
      stats.total++;
      categoryStats.total = items.length;

      if (item._itemMaster && item._itemMaster.matched) {
        stats.matched++;
        categoryStats.matched++;

        const conf = item._itemMaster.confidence;
        if (conf === 'high') {
          stats.high++;
          categoryStats.high++;
        } else if (conf === 'medium') {
          stats.medium++;
          categoryStats.medium++;
        } else {
          stats.low++;
          categoryStats.low++;
        }
      } else {
        stats.unmatched++;
        categoryStats.unmatched++;
      }
    }

    stats.byCategory[category] = categoryStats;
  }

  stats.coverage = stats.total > 0 ? stats.matched / stats.total : 0;

  return stats;
}

module.exports = {
  enrichExtractedData,
  enrichDashboardPayload,
  enrichItem,
  hasDashboardPayloadEnrichment,
  runEnrichmentJob,
  checkIfEnriched,
  calculateEnrichmentStats,
  DEFAULT_DATABASE_PATH
};
