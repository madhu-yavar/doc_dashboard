#!/usr/bin/env node
/**
 * PostgreSQL Connection Test
 * Tests database connectivity and basic functionality
 */

const { postgresClient } = require('./postgres_client.cjs');

async function testConnection() {
  console.log('Testing PostgreSQL Connection for Doctor Dashboard');
  console.log('==================================================\n');

  try {
    // Test 1: Connection
    console.log('Test 1: Establishing connection...');
    await postgresClient.connect();
    console.log('✓ Connection successful\n');

    // Test 2: Simple query
    console.log('Test 2: Running test query...');
    const timeResult = await postgresClient.queryOne('SELECT NOW() as current_time, version() as pg_version');
    console.log('✓ Query successful');
    console.log(`  Database Time: ${timeResult.current_time}`);
    console.log(`  PostgreSQL Version: ${timeResult.pg_version.split(' ')[0]}\n`);

    // Test 3: Connection status
    console.log('Test 3: Checking connection status...');
    const status = postgresClient.getStatus();
    console.log('✓ Status retrieved');
    console.log(`  Connected: ${status.isConnected}`);
    console.log(`  Database: ${status.config.database}`);
    console.log(`  Host: ${status.config.host}:${status.config.port}`);
    console.log(`  User: ${status.config.user}\n`);

    // Test 4: Check existing tables
    console.log('Test 4: Checking for existing tables...');
    const tablesQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    const tables = await postgresClient.query(tablesQuery);
    console.log(`✓ Found ${tables.length} existing tables`);
    if (tables.length > 0) {
      console.log('  Tables:', tables.map(t => t.table_name).join(', '));
    } else {
      console.log('  No tables found - schema needs to be created');
      console.log('  Run: node server/db/migrate.cjs');
    }
    console.log('');

    // Test 5: Check for custom types (enums)
    console.log('Test 5: Checking for custom types...');
    const typesQuery = `
      SELECT typname
      FROM pg_type
      WHERE typtype = 'e'
      AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      ORDER BY typname;
    `;
    const types = await postgresClient.query(typesQuery);
    console.log(`✓ Found ${types.length} custom types`);
    if (types.length > 0) {
      console.log('  Types:', types.map(t => t.typname).join(', '));
    } else {
      console.log('  No custom types found - schema needs to be created');
      console.log('  Run: node server/db/migrate.cjs');
    }
    console.log('');

    console.log('==================================================');
    console.log('✓ All connection tests passed successfully!');
    console.log('==================================================\n');

    if (tables.length === 0 || types.length === 0) {
      console.log('Next steps:');
      console.log('1. Run migration: node server/db/migrate.cjs');
      console.log('2. Verify schema: node server/db/migrate.cjs status\n');
    } else {
      console.log('Database schema is already installed.');
      console.log('For schema details, run: node server/db/migrate.cjs status\n');
    }

  } catch (error) {
    console.error('✗ Connection test failed:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Ensure PostgreSQL is running:');
    console.error('   brew services list  # macOS');
    console.error('   sudo systemctl status postgresql  # Linux');
    console.error('2. Check .env file has correct database credentials');
    console.error('3. Ensure database exists: createdb doctor_dashboard');
    console.error('4. Check database permissions\n');
    process.exit(1);
  } finally {
    await postgresClient.close();
  }
}

// Run the test
if (require.main === module) {
  testConnection().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { testConnection };