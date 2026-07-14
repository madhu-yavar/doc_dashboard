#!/usr/bin/env node
/**
 * Migration Runner: Add events_jsonb column
 *
 * This script applies the add_events_jsonb_column.sql migration to add
 * the missing events_jsonb column to the live_conversation_sessions table.
 */

const fs = require('fs');
const path = require('path');

// Load the PostgreSQL client
const postgresClientPath = path.join(__dirname, '../../db/postgres_client.cjs');
const { PostgresClient } = require(postgresClientPath);

async function runMigration() {
  console.log('='.repeat(60));
  console.log('Migration: Add events_jsonb column to live_conversation_sessions');
  console.log('='.repeat(60));

  let postgresClient;

  try {
    // Initialize PostgreSQL client
    postgresClient = new PostgresClient({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DATABASE || 'doctor_dashboard',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres'
    });

    await postgresClient.connect();
    console.log('✓ Connected to PostgreSQL');

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'add_events_jsonb_column.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('\nApplying migration...');
    console.log('--- SQL ---');
    console.log(migrationSQL);
    console.log('--- END SQL ---\n');

    // Execute the migration
    const result = await postgresClient.query(migrationSQL);

    if (result && result.length > 0) {
      console.log('✓ Migration verification result:');
      console.table(result);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✓ Migration completed successfully');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('✗ Migration failed:', error.message);
    console.error('='.repeat(60));
    process.exit(1);
  } finally {
    if (postgresClient) {
      try {
        await postgresClient.close();
        console.log('✓ Database connection closed');
      } catch (closeError) {
        console.error('Warning: Failed to close database connection:', closeError.message);
      }
    }
  }
}

// Run the migration
runMigration();