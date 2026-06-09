/**
 * Repository Layer Test Suite - Phase 1
 *
 * Basic health check and validation tests for all repository classes.
 * This file tests that each repository can initialize and perform basic operations.
 *
 * Run with: node server/repositories/test_repositories.cjs
 */

const { postgresClient } = require('../db/postgres_client.cjs');
const {
  AuthRepository,
  DocumentsRepository,
  TranscriptsRepository,
  ChatRepository,
  LiveSessionsRepository,
  AuditRepository,
  AlertsRepository,
  AnalyticsRepository,
  InteropRepository
} = require('./index.cjs');

// Test configuration
const TEST_TIMEOUT = 30000; // 30 seconds
let testResults = [];

/**
 * Helper function to run a test
 */
async function runTest(testName, testFunction) {
  const startTime = Date.now();
  try {
    await testFunction();
    const duration = Date.now() - startTime;
    testResults.push({ test: testName, status: 'PASS', duration, error: null });
    console.log(`✓ ${testName} (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - startTime;
    testResults.push({ test: testName, status: 'FAIL', duration, error: error.message });
    console.error(`✗ ${testName} (${duration}ms): ${error.message}`);
  }
}

/**
 * Test repository initialization
 */
async function testRepositoryInitialization(repositoryClass, repositoryName) {
  await runTest(`${repositoryName} - Initialize`, async () => {
    const repository = new repositoryClass(postgresClient);
    await repository.initialize();
    await repository.close();
  });
}

/**
 * Test repository health check
 */
async function testRepositoryHealth(repositoryClass, repositoryName) {
  await runTest(`${repositoryName} - Health Check`, async () => {
    const repository = new repositoryClass(postgresClient);
    await repository.initialize();
    const health = await repository.healthCheck();
    if (health.status !== 'healthy') {
      throw new Error(`Repository health check failed: ${health.error || 'Unknown error'}`);
    }
    await repository.close();
  });
}

/**
 * Test repository statistics
 */
async function testRepositoryStats(repositoryClass, repositoryName) {
  await runTest(`${repositoryName} - Get Stats`, async () => {
    const repository = new repositoryClass(postgresClient);
    await repository.initialize();
    const stats = await repository.getStats();
    if (!stats || typeof stats !== 'object') {
      throw new Error('Invalid stats response');
    }
    await repository.close();
  });
}

/**
 * Test basic CRUD operations for each repository
 */
async function testAuthRepositoryBasicOps() {
  await runTest('AuthRepository - Basic Operations', async () => {
    const repository = new AuthRepository(postgresClient);
    await repository.initialize();

    // Test user operations
    const users = await repository.readUsers();
    if (!Array.isArray(users)) {
      throw new Error('readUsers should return an array');
    }

    // Test session operations
    const sessions = await repository.readSessions();
    if (!Array.isArray(sessions)) {
      throw new Error('readSessions should return an array');
    }

    await repository.close();
  });
}

async function testDocumentsRepositoryBasicOps() {
  await runTest('DocumentsRepository - Basic Operations', async () => {
    const repository = new DocumentsRepository(postgresClient);
    await repository.initialize();

    // Test document operations
    const documents = await repository.readDocuments({ limit: 1 });
    if (!Array.isArray(documents)) {
      throw new Error('readDocuments should return an array');
    }

    // Test stats
    const stats = await repository.getStats();
    if (typeof stats.totalDocuments !== 'number') {
      throw new Error('Invalid stats response');
    }

    await repository.close();
  });
}

async function testTranscriptsRepositoryBasicOps() {
  await runTest('TranscriptsRepository - Basic Operations', async () => {
    const repository = new TranscriptsRepository(postgresClient);
    await repository.initialize();

    // Test basic query (should work even if no transcripts exist)
    await repository.query(`SELECT COUNT(*) as count FROM ${repository.transcriptsTableName}`);

    await repository.close();
  });
}

async function testLiveSessionsRepositoryBasicOps() {
  await runTest('LiveSessionsRepository - Basic Operations', async () => {
    const repository = new LiveSessionsRepository(postgresClient);
    await repository.initialize();

    // Test basic query
    await repository.query(`SELECT COUNT(*) as count FROM ${repository.sessionsTableName}`);

    await repository.close();
  });
}

async function testChatRepositoryBasicOps() {
  await runTest('ChatRepository - Basic Operations', async () => {
    const repository = new ChatRepository(postgresClient);
    await repository.initialize();

    // Test basic query
    await repository.query(`SELECT COUNT(*) as count FROM ${repository.chatSessionsTableName}`);

    await repository.close();
  });
}

async function testAuditRepositoryBasicOps() {
  await runTest('AuditRepository - Basic Operations', async () => {
    const repository = new AuditRepository(postgresClient);
    await repository.initialize();

    // Test basic query
    await repository.query(`SELECT COUNT(*) as count FROM ${repository.auditRunsTableName}`);

    await repository.close();
  });
}

async function testAlertsRepositoryBasicOps() {
  await runTest('AlertsRepository - Basic Operations', async () => {
    const repository = new AlertsRepository(postgresClient);
    await repository.initialize();

    // Test basic query
    await repository.query(`SELECT COUNT(*) as count FROM ${repository.alertDeliveriesTableName}`);

    await repository.close();
  });
}

async function testAnalyticsRepositoryBasicOps() {
  await runTest('AnalyticsRepository - Basic Operations', async () => {
    const repository = new AnalyticsRepository(postgresClient);
    await repository.initialize();

    // Test basic query
    await repository.query(`SELECT COUNT(*) as count FROM ${repository.analyticsTableName}`);

    await repository.close();
  });
}

async function testInteropRepositoryBasicOps() {
  await runTest('InteropRepository - Basic Operations', async () => {
    const repository = new InteropRepository(postgresClient);
    await repository.initialize();

    // Test basic query
    await repository.query(`SELECT COUNT(*) as count FROM ${repository.endpointsTableName}`);

    await repository.close();
  });
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('🧪 Phase 1 Repository Layer Test Suite\n');
  console.log('Testing repository initialization and basic operations...\n');

  const startTime = Date.now();

  try {
    // Test database connection
    await runTest('Database Connection', async () => {
      await postgresClient.connect();
      const result = await postgresClient.query('SELECT 1 as test');
      if (result[0].test !== 1) {
        throw new Error('Database connection test failed');
      }
    });

    // Test repository initialization for all repositories
    await testRepositoryInitialization(AuthRepository, 'AuthRepository');
    await testRepositoryInitialization(DocumentsRepository, 'DocumentsRepository');
    await testRepositoryInitialization(TranscriptsRepository, 'TranscriptsRepository');
    await testRepositoryInitialization(ChatRepository, 'ChatRepository');
    await testRepositoryInitialization(LiveSessionsRepository, 'LiveSessionsRepository');
    await testRepositoryInitialization(AuditRepository, 'AuditRepository');
    await testRepositoryInitialization(AlertsRepository, 'AlertsRepository');
    await testRepositoryInitialization(AnalyticsRepository, 'AnalyticsRepository');
    await testRepositoryInitialization(InteropRepository, 'InteropRepository');

    console.log('\n--- Testing repository health checks ---\n');

    // Test health checks for all repositories
    await testRepositoryHealth(AuthRepository, 'AuthRepository');
    await testRepositoryHealth(DocumentsRepository, 'DocumentsRepository');
    await testRepositoryHealth(TranscriptsRepository, 'TranscriptsRepository');
    await testRepositoryHealth(ChatRepository, 'ChatRepository');
    await testRepositoryHealth(LiveSessionsRepository, 'LiveSessionsRepository');
    await testRepositoryHealth(AuditRepository, 'AuditRepository');
    await testRepositoryHealth(AlertsRepository, 'AlertsRepository');
    await testRepositoryHealth(AnalyticsRepository, 'AnalyticsRepository');
    await testRepositoryHealth(InteropRepository, 'InteropRepository');

    console.log('\n--- Testing repository statistics ---\n');

    // Test stats for all repositories
    await testRepositoryStats(AuthRepository, 'AuthRepository');
    await testRepositoryStats(DocumentsRepository, 'DocumentsRepository');
    await testRepositoryStats(TranscriptsRepository, 'TranscriptsRepository');
    await testRepositoryStats(ChatRepository, 'ChatRepository');
    await testRepositoryStats(LiveSessionsRepository, 'LiveSessionsRepository');
    await testRepositoryStats(AuditRepository, 'AuditRepository');
    await testRepositoryStats(AlertsRepository, 'AlertsRepository');
    await testRepositoryStats(AnalyticsRepository, 'AnalyticsRepository');
    await testRepositoryStats(InteropRepository, 'InteropRepository');

    console.log('\n--- Testing basic repository operations ---\n');

    // Test basic operations for each repository
    await testAuthRepositoryBasicOps();
    await testDocumentsRepositoryBasicOps();
    await testTranscriptsRepositoryBasicOps();
    await testLiveSessionsRepositoryBasicOps();
    await testChatRepositoryBasicOps();
    await testAuditRepositoryBasicOps();
    await testAlertsRepositoryBasicOps();
    await testAnalyticsRepositoryBasicOps();
    await testInteropRepositoryBasicOps();

  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    try {
      await postgresClient.close();
    } catch (error) {
      console.error('Error closing database connection:', error);
    }
  }

  const totalDuration = Date.now() - startTime;

  // Print test results summary
  console.log('\n' + '='.repeat(60));
  console.log('Test Results Summary');
  console.log('='.repeat(60));

  const passedTests = testResults.filter(r => r.status === 'PASS');
  const failedTests = testResults.filter(r => r.status === 'FAIL');

  console.log(`\nTotal Tests: ${testResults.length}`);
  console.log(`Passed: ${passedTests.length} ✓`);
  console.log(`Failed: ${failedTests.length} ✗`);
  console.log(`Duration: ${totalDuration}ms`);
  console.log(`Success Rate: ${((passedTests.length / testResults.length) * 100).toFixed(1)}%`);

  if (failedTests.length > 0) {
    console.log('\n❌ Failed Tests:');
    failedTests.forEach(test => {
      console.log(`  - ${test.test}: ${test.error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed! Phase 1 Repository Layer is ready for integration.');
    process.exit(0);
  }
}

// Run the tests
runAllTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
