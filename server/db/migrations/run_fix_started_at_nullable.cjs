/**
 * Migration runner: Make live_conversation_sessions.started_at nullable
 *
 * Run with: node server/db/migrations/run_fix_started_at_nullable.cjs
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'doctor_dashboard',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
  });

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('✓ Connected');

    // Read the migration SQL
    const migrationPath = path.join(__dirname, 'fix_live_sessions_started_at_nullable.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running migration to make started_at nullable...');
    await client.query(migrationSQL);
    console.log('✓ Migration completed successfully');

    // Verify the change
    const result = await client.query(`
      SELECT
        column_name,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'live_conversation_sessions'
        AND column_name = 'started_at'
    `);

    if (result.rows.length > 0) {
      const columnInfo = result.rows[0];
      console.log('\nColumn info after migration:');
      console.log(`  column_name: ${columnInfo.column_name}`);
      console.log(`  is_nullable: ${columnInfo.is_nullable}`);
      console.log(`  column_default: ${columnInfo.column_default}`);
    }

    console.log('\n✓ Migration completed successfully!');
    console.log('The started_at column is now nullable for live_conversation_sessions table.');

  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\nConnection closed.');
  }
}

runMigration();
