#!/usr/bin/env node
/**
 * Query PostgreSQL for documents with status="pending"
 */

const { PostgresClient } = require('./server/db/postgres_client.cjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function queryPendingDocuments() {
  const client = new PostgresClient();

  try {
    await client.connect();
    console.log('Connected to PostgreSQL database');
    console.log('Querying documents with status="pending"...');

    // Query for documents with status='pending'
    const query = `
      SELECT id, name, document_type, status, uploaded_at, processed_at, created_at
      FROM documents
      WHERE status = 'pending'
      ORDER BY created_at DESC;
    `;

    const rows = await client.query(query);

    console.log(`\nFound ${rows.length} documents with status="pending"\n`);
    console.log('='.repeat(100));
    console.log(sprintf('%-40s %-40s %-15s', 'Document ID', 'Name', 'Type'));
    console.log('='.repeat(100));

    rows.forEach(row => {
      console.log(sprintf('%-40s %-40s %-15s',
        row.id,
        row.name.length > 38 ? row.name.substring(0, 37) + '...' : row.name,
        row.document_type
      ));
    });

    console.log('='.repeat(100));
    console.log(`\nTotal count: ${rows.length}`);

    // Return as JSON for programmatic use
    return {
      count: rows.length,
      documents: rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.document_type,
        uploaded_at: row.uploaded_at,
        processed_at: row.processed_at,
        created_at: row.created_at
      }))
    };

  } catch (error) {
    console.error('Error querying pending documents:', error.message);
    throw error;
  } finally {
    if (client.pool) {
      await client.pool.end();
      console.log('\nDatabase connection closed');
    }
  }
}

// Simple sprintf implementation for formatting
function sprintf(format, ...args) {
  return format.replace(/%[-+0#]*\*?[0-9]*(\.[0-9]+)?[hlL]?[diuoxXfFeEgGaAcspn%]/g, (match) => {
    const arg = args.shift();
    if (match.includes('%-')) {
      return String(arg).padEnd(match.match(/\d+/)?.[0] || 0, ' ');
    } else {
      return String(arg).padStart(match.match(/\d+/)?.[0] || 0, ' ');
    }
  });
}

// Run the query
if (require.main === module) {
  queryPendingDocuments()
    .then(result => {
      // Also output raw JSON for easy parsing
      console.log('\n' + JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { queryPendingDocuments };
