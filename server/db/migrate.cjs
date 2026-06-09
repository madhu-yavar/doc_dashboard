#!/usr/bin/env node
/**
 * PostgreSQL Migration Runner for Doctor Dashboard
 * Phase 0: Schema Foundation
 *
 * Usage:
 *   node server/db/migrate.cjs              # Create schema
 *   node server/db/migrate.cjs --status      # Show schema status
 *   node server/db/migrate.cjs --drop        # Drop all tables (use with caution!)
 *   node server/db/migrate.cjs --help       # Show help
 */

const { postgresClient } = require('./postgres_client.cjs');
const { PostgresSchema } = require('./schema.cjs');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'migrate';

  console.log('Doctor Dashboard PostgreSQL Migration Runner');
  console.log('=============================================');

  try {
    // Connect to PostgreSQL
    await postgresClient.connect();

    const schema = new PostgresSchema(postgresClient);

    switch (command) {
      case 'migrate':
      case 'create':
      case 'init':
        console.log('Starting schema creation...\n');
        const startTime = Date.now();

        await schema.createCompleteSchema();

        // Record the migration
        const migrationVersion = '001';
        const migrationName = 'phase_0_schema_foundation';
        const migrationDescription = 'Phase 0: Complete PostgreSQL schema with all tables, enums, indexes, and constraints';
        const executionTime = Date.now() - startTime;

        await schema.recordMigration(
          migrationVersion,
          migrationName,
          migrationDescription,
          { execution_time_ms: executionTime, phase: '0' }
        );

        console.log('\n✓ Schema creation completed successfully');
        console.log(`✓ Migration recorded: ${migrationVersion} - ${migrationName}`);
        console.log(`✓ Execution time: ${executionTime}ms`);
        console.log('\nYou can now proceed with Phase 1: Repository & Data-Access Layer');
        break;

      case 'status':
        console.log('Checking schema status...\n');
        const summary = await schema.getSchemaSummary();
        console.log('Database Status:');
        console.log(`Connected: ${summary.databaseStatus.isConnected}`);
        console.log(`Database: ${summary.databaseStatus.config.database}`);
        console.log(`Total Tables: ${summary.totalTables}\n`);
        console.log('Tables:');
        summary.tables.forEach(table => {
          const rowInfo = summary.rowCounts.find(r => r.table === table);
          const count = rowInfo ? rowInfo.count : 0;
          console.log(`  ${table}: ${count} rows`);
        });
        console.log('');

        // Show migration history
        console.log('Migration History:');
        const migrations = await schema.getMigrationHistory();
        if (migrations.length === 0) {
          console.log('  No migrations recorded yet');
        } else {
          migrations.forEach(migration => {
            console.log(`  ${migration.version} - ${migration.name} (${migration.applied_at})`);
          });
        }
        break;

      case 'history':
        console.log('Migration History...\n');
        const migrationHistory = await schema.getMigrationHistory();
        if (migrationHistory.length === 0) {
          console.log('No migrations recorded yet.');
        } else {
          console.log('Applied Migrations:');
          migrationHistory.forEach(migration => {
            console.log(`  ${migration.version} - ${migration.name}`);
            console.log(`    Description: ${migration.description}`);
            console.log(`    Applied: ${migration.applied_at}`);
            if (migration.execution_time_ms) {
              console.log(`    Execution Time: ${migration.execution_time_ms}ms`);
            }
            console.log('');
          });
        }
        break;

      case 'drop':
        console.log('⚠️  DROPPING ALL TABLES - THIS WILL DELETE ALL DATA!');
        console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await schema.dropAllTables();
        console.log('✓ All tables dropped successfully');
        break;

      case 'help':
      case '--help':
      case '-h':
        console.log('\nUsage:');
        console.log('  node server/db/migrate.cjs              Create schema and record migration');
        console.log('  node server/db/migrate.cjs status       Show schema status and migration history');
        console.log('  node server/db/migrate.cjs drop          Drop all tables (caution!)');
        console.log('  node server/db/migrate.cjs history      Show migration history');
        console.log('  node server/db/migrate.cjs help          Show this help\n');
        console.log('Migration Versioning:');
        console.log('  Each schema creation is tracked with version, name, description');
        console.log('  and execution time in the schema_migrations table.\n');
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.log('Run "node server/db/migrate.cjs help" for usage information');
        process.exit(1);
    }

  } catch (error) {
    console.error('\n✗ Migration failed:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Ensure PostgreSQL is running');
    console.error('2. Check your .env file for correct database credentials');
    console.error('3. Ensure the database exists: createdb doctor_dashboard');
    console.error('4. Check database permissions');
    process.exit(1);
  } finally {
    await postgresClient.close();
  }
}

// Run the migration
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };