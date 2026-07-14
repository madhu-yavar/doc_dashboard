/**
 * Item Master Enrichment Backfill Script
 *
 * This script processes all existing documents and enriches them with item master codes.
 * It runs the enrichment job for documents that haven't been enriched yet.
 *
 * Usage: node scripts/backfill_item_master_enrichment.cjs
 *
 * Environment variables:
 *   - DATABASE_URL: PostgreSQL connection string
 *   - ITEM_MASTER_DB_PATH: Path to item master SQLite DB (optional, defaults to server/storage/item_service_master.sqlite)
 */

const path = require('path');
const { Pool } = require('pg');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  enrichExtractedData,
  enrichDashboardPayload,
  calculateEnrichmentStats,
  DEFAULT_DATABASE_PATH
} = require('../server/item_master_enrichment.cjs');

// Local enrichment check that also checks dashboard_payload
function checkIfEnrichedWithDashboard(extractedData, dashboardPayload = null) {
  if (!extractedData && !dashboardPayload) return false;

  // Check extracted_data medications
  if (extractedData) {
    const meds = extractedData.medications || extractedData.ordered_medications || [];
    if (meds.length > 0 && meds[0]._itemMaster !== undefined) {
      // Also check if dashboard_payload has _itemMaster for medications
      const rootDashMeds = dashboardPayload?.medications_card?.medication_list || [];
      const nestedDashMeds = dashboardPayload?.dashboard_cards?.medications_card?.medication_list || [];
      const dashboardMeds = nestedDashMeds.length > 0 ? nestedDashMeds : rootDashMeds;
      if (dashboardMeds.length > 0) {
        if (dashboardMeds[0]._itemMaster !== undefined) {
          return true; // Both are enriched
        }
        return false; // Only extracted_data is enriched, dashboard needs enrichment
      }
      return true; // Only extracted_data exists and is enriched
    }
  }

  // Check dashboard_payload medications
  if (dashboardPayload?.medications_card?.medication_list || dashboardPayload?.dashboard_cards?.medications_card?.medication_list) {
    const meds = dashboardPayload.dashboard_cards?.medications_card?.medication_list || dashboardPayload.medications_card?.medication_list || [];
    if (meds.length > 0 && meds[0]._itemMaster !== undefined) {
      return true;
    }
  }

  return false;
}

// Configuration
const BATCH_SIZE = 10;
const DELAY_MS = 100; // Delay between batches to avoid overwhelming the database

// Database connection
let pool;

async function initializePool() {
  // Use individual PG environment variables (same as postgres_client.cjs)
  const config = {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'doctor_dashboard',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    max: 5,
  };

  pool = new Pool(config);

  // Test connection
  try {
    await pool.query('SELECT NOW()');
    console.log(`✓ Connected to PostgreSQL (${config.host}:${config.port}/${config.database})`);
  } catch (error) {
    throw new Error(`Failed to connect to PostgreSQL: ${error.message}`);
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    console.log('✓ Closed database connection');
  }
}

/**
 * Fetch extractions that need enrichment
 */
async function fetchExtractionsNeedingEnrichment(limit = 100, offset = 0) {
  const query = `
    SELECT
      de.id,
      de.document_id,
      de.extracted_data_jsonb,
      de.dashboard_payload_jsonb,
      d.document_type,
      d.created_at
    FROM document_extractions de
    JOIN documents d ON d.id = de.document_id
    WHERE de.extracted_data_jsonb IS NOT NULL
      AND de.status = 'completed'
    ORDER BY d.created_at DESC
    LIMIT $1 OFFSET $2
  `;

  const result = await pool.query(query, [limit, offset]);
  return result.rows;
}

/**
 * Fetch total count of extractions with extracted data
 */
async function fetchTotalExtractionCount() {
  const query = `
    SELECT COUNT(*) as count
    FROM document_extractions de
    WHERE de.extracted_data_jsonb IS NOT NULL
      AND de.status = 'completed'
  `;

  const result = await pool.query(query);
  return parseInt(result.rows[0].count);
}

/**
 * Enrich a single extraction
 */
async function enrichExtraction(extractionId, documentId, extractedData, dashboardPayload, options = {}) {
  try {
    // Run enrichment on extracted_data
    const enrichedData = enrichExtractedData(extractedData, options);

    // Also enrich dashboard_payload medications if they exist
    let enrichedDashboard = dashboardPayload;
    if (dashboardPayload && typeof dashboardPayload === 'object') {
      const { ItemServiceMasterLookup } = require('../server/item_service_master_lookup.cjs');
      const lookup = new ItemServiceMasterLookup({ databasePath: options.databasePath, minScore: options.minScore });

      try {
        if (lookup.isAvailable()) {
          enrichedDashboard = enrichDashboardPayload(dashboardPayload, lookup);
        }
      } catch (error) {
        console.error(`  Item master dashboard enrichment failed for ${documentId}:`, error.message);
      } finally {
        lookup.close();
      }
    }

    // Update extraction with enriched data
    await pool.query(
      'UPDATE document_extractions SET extracted_data_jsonb = $1, dashboard_payload_jsonb = $2 WHERE id = $3',
      [JSON.stringify(enrichedData), JSON.stringify(enrichedDashboard), extractionId]
    );

    // Calculate stats
    const stats = calculateEnrichmentStats(enrichedData);

    return { success: true, stats };
  } catch (error) {
    console.error(`  ✗ Failed to enrich extraction ${extractionId}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main backfill process
 */
async function runBackfill() {
  const startTime = Date.now();
  const itemMasterDbPath = process.env.ITEM_MASTER_DB_PATH || DEFAULT_DATABASE_PATH;
  const minScore = parseFloat(process.env.ITEM_MASTER_MIN_SCORE || '0.55');

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     Item Master Enrichment Backfill Script                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Item Master DB: ${itemMasterDbPath}`);
  console.log(`Min Score: ${minScore}`);
  console.log(`Batch Size: ${BATCH_SIZE}`);
  console.log('');

  try {
    await initializePool();

    // Get total count
    const totalCount = await fetchTotalExtractionCount();
    console.log(`Found ${totalCount} extractions with extracted data`);
    console.log('');

    let processedCount = 0;
    let enrichedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let offset = 0;

    const overallStats = {
      total: 0,
      matched: 0,
      unmatched: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    while (true) {
      // Fetch batch of extractions
      const extractions = await fetchExtractionsNeedingEnrichment(BATCH_SIZE, offset);

      if (extractions.length === 0) {
        break;
      }

      console.log(`Processing batch ${Math.floor(offset / BATCH_SIZE) + 1} (${offset + 1}-${offset + extractions.length} of ${totalCount})...`);

      // Process each extraction
      for (const ext of extractions) {
        processedCount++;

        // Check if already enriched (both extracted_data AND dashboard_payload)
        if (checkIfEnrichedWithDashboard(ext.extracted_data_jsonb, ext.dashboard_payload_jsonb)) {
          skippedCount++;
          process.stdout.write(`  ⊝ Skipped (already enriched): ${ext.id}\r`);
          continue;
        }

        // Enrich extraction
        const result = await enrichExtraction(
          ext.id,
          ext.document_id,
          ext.extracted_data_jsonb,
          ext.dashboard_payload_jsonb,
          { databasePath: itemMasterDbPath, minScore }
        );

        if (result.success) {
          enrichedCount++;

          // Accumulate stats
          if (result.stats) {
            overallStats.total += result.stats.total;
            overallStats.matched += result.stats.matched;
            overallStats.unmatched += result.stats.unmatched;
            overallStats.high += result.stats.high;
            overallStats.medium += result.stats.medium;
            overallStats.low += result.stats.low;
          }

          process.stdout.write(`  ✓ Enriched: ${ext.id}\r`);
        } else {
          failedCount++;
        }
      }

      // Clear the line
      process.stdout.write('\r' + ' '.repeat(80) + '\r');

      offset += BATCH_SIZE;

      // Small delay between batches
      await sleep(DELAY_MS);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const coverage = overallStats.total > 0 ? ((overallStats.matched / overallStats.total) * 100).toFixed(1) : 0;

    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                         Summary                                 ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`Total Extractions:      ${totalCount}`);
    console.log(`Processed:              ${processedCount}`);
    console.log(`  ✓ Enriched:           ${enrichedCount}`);
    console.log(`  ⊝ Skipped:            ${skippedCount} (already enriched)`);
    console.log(`  ✗ Failed:             ${failedCount}`);
    console.log('');
    console.log(`Total Items Processed:  ${overallStats.total}`);
    console.log(`Matched:                ${overallStats.matched} (${coverage}%)`);
    console.log(`  High Confidence:      ${overallStats.high}`);
    console.log(`  Medium Confidence:    ${overallStats.medium}`);
    console.log(`  Low Confidence:       ${overallStats.low}`);
    console.log(`Unmatched:              ${overallStats.unmatched}`);
    console.log('');
    console.log(`Duration:               ${duration}s`);
    console.log('');

    if (failedCount > 0) {
      console.warn(`⚠️ ${failedCount} extractions failed to enrich. Check logs above for details.`);
    }

  } catch (error) {
    console.error('✗ Backfill failed:', error);
    throw error;
  } finally {
    await closePool();
  }
}

// Run the backfill
if (require.main === module) {
  runBackfill()
    .then(() => {
      console.log('✓ Backfill completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('✗ Backfill failed:', error);
      process.exit(1);
    });
}

module.exports = { runBackfill };
