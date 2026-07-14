/**
 * Fix documents that have medications in extracted_data but not in dashboard_payload
 *
 * This script copies medications from extracted_data_jsonb to dashboard_payload_jsonb
 * for documents that are missing the medications_card.
 */

const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'doctor_dashboard',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  max: 5,
});

async function main() {
  console.log('Finding documents with medications in extracted_data but not in dashboard_payload...');

  try {
    await pool.query('SELECT NOW()');
    console.log('✓ Connected to PostgreSQL');

    // Find extractions that have medications in extracted_data but no medications_card in dashboard_payload
    const result = await pool.query(`
      SELECT
        de.id as extraction_id,
        de.document_id,
        de.extracted_data_jsonb,
        de.dashboard_payload_jsonb
      FROM document_extractions de
      WHERE de.status = 'completed'
        AND de.extracted_data_jsonb ? 'medications'
        AND jsonb_array_length(de.extracted_data_jsonb->'medications') > 0
        AND (de.dashboard_payload_jsonb->'medications_card' IS NULL
             OR jsonb_array_length(de.dashboard_payload_jsonb->'medications_card'->'medication_list') = 0)
    `);

    console.log(`Found ${result.rows.length} extractions needing fix`);

    let fixedCount = 0;

    for (const row of result.rows) {
      const { extraction_id, extracted_data_jsonb, dashboard_payload_jsonb } = row;

      // Get medications from extracted_data
      const medications = extracted_data_jsonb?.medications || [];

      if (!Array.isArray(medications) || medications.length === 0) {
        continue;
      }

      // Create or update dashboard_payload with medications_card
      const updatedDashboard = {
        ...(dashboard_payload_jsonb || {}),
        medications_card: {
          icon: '💊',
          title: 'Medications',
          medication_list: medications.map(med => ({
            name: med.name || '',
            dose: med.dose || '',
            dosage: med.dose || med.dosage || '',
            frequency: med.frequency || '',
            route: med.route || '',
            start: med.start || '',
            instructions: med.instructions || '',
            category: med.category || 'Other',
            is_uncertain: med.is_uncertain || false,
            verification_confidence: med.verification_confidence || 'medium',
            verification_uncertain_reason: med.verification_uncertain_reason || '',
            // Preserve _itemMaster if it exists
            ...(med._itemMaster ? { _itemMaster: med._itemMaster } : {})
          }))
        }
      };

      // Update the extraction
      await pool.query(
        'UPDATE document_extractions SET dashboard_payload_jsonb = $1 WHERE id = $2',
        [JSON.stringify(updatedDashboard), extraction_id]
      );

      fixedCount++;
      process.stdout.write(`\r✓ Fixed ${fixedCount}/${result.rows.length} extractions`);
    }

    console.log(`\n\n✓ Fixed ${fixedCount} extractions`);
    console.log('✓ Done!');

  } catch (error) {
    console.error('✗ Error:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
