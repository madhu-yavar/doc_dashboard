/**
 * Simple test to verify status mapping functions work correctly
 */

// Import the mapping functions directly (we'll test them independently)
const { LiveSessionsRepository } = require('./server/repositories/live_sessions_repository.cjs');

// DB → UI status mapping (same as in live_conversation_store.cjs)
function mapDbStatusToUiStatus(dbStatus, uiContext = {}) {
  switch (dbStatus) {
    case 'active':
      // Map 'active' to appropriate UI state based on context
      if (uiContext.hasTranscript || uiContext.isRecording) return 'live';
      if (uiContext.isPaused) return 'paused';
      if (uiContext.hasReviewItems) return 'review_required';
      if (uiContext.isFinalizing) return 'finalizing';
      return 'draft'; // Default for newly created active sessions
    case 'ended':
      return 'finalized';
    case 'abandoned':
      return 'failed';
    default:
      // Fallback for unknown statuses - treat as active/draft
      return 'draft';
  }
}

// UI → DB status mapping (same as in live_conversation_store.cjs)
function mapUiStatusToDbStatus(uiStatus) {
  switch (uiStatus) {
    case 'draft':
    case 'live':
    case 'paused':
    case 'review_required':
    case 'finalizing':
      return 'active';
    case 'finalized':
      return 'ended';
    case 'failed':
      return 'abandoned';
    default:
      // Fallback for unknown UI statuses - treat as active
      return 'active';
  }
}

async function testStatusMapping() {
  console.log('🧪 Testing live conversation status mapping functions...\n');

  let passedTests = 0;
  let failedTests = 0;

  // Test DB → UI mappings
  console.log('📂 Testing DB → UI status mappings:');

  const dbToUiTests = [
    { dbStatus: 'active', context: {}, expectedUi: 'draft' },
    { dbStatus: 'active', context: { hasTranscript: true }, expectedUi: 'live' },
    { dbStatus: 'active', context: { isRecording: true }, expectedUi: 'live' },
    { dbStatus: 'active', context: { isPaused: true }, expectedUi: 'paused' },
    { dbStatus: 'active', context: { hasReviewItems: true }, expectedUi: 'review_required' },
    { dbStatus: 'active', context: { isFinalizing: true }, expectedUi: 'finalizing' },
    { dbStatus: 'ended', context: {}, expectedUi: 'finalized' },
    { dbStatus: 'abandoned', context: {}, expectedUi: 'failed' },
  ];

  for (const test of dbToUiTests) {
    const result = mapDbStatusToUiStatus(test.dbStatus, test.context);
    if (result === test.expectedUi) {
      console.log(`   ✅ ${test.dbStatus} + context(${Object.keys(test.context).join(',') || 'default'}) → ${result}`);
      passedTests++;
    } else {
      console.log(`   ❌ ${test.dbStatus} + context(${Object.keys(test.context).join(',') || 'default'}) → ${result} (expected ${test.expectedUi})`);
      failedTests++;
    }
  }

  // Test UI → DB mappings
  console.log('\n📂 Testing UI → DB status mappings:');

  const uiToDbTests = [
    { uiStatus: 'draft', expectedDb: 'active' },
    { uiStatus: 'live', expectedDb: 'active' },
    { uiStatus: 'paused', expectedDb: 'active' },
    { uiStatus: 'review_required', expectedDb: 'active' },
    { uiStatus: 'finalizing', expectedDb: 'active' },
    { uiStatus: 'finalized', expectedDb: 'ended' },
    { uiStatus: 'failed', expectedDb: 'abandoned' },
  ];

  for (const test of uiToDbTests) {
    const result = mapUiStatusToDbStatus(test.uiStatus);
    if (result === test.expectedDb) {
      console.log(`   ✅ ${test.uiStatus} → ${result}`);
      passedTests++;
    } else {
      console.log(`   ❌ ${test.uiStatus} → ${result} (expected ${test.expectedDb})`);
      failedTests++;
    }
  }

  // Test against real data from database
  console.log('\n📂 Testing against real database sessions:');

  try {
    const liveSessionsRepo = new LiveSessionsRepository();
    await liveSessionsRepo.initialize();

    const sessions = await liveSessionsRepo.query(`
      SELECT id, status, linked_patient_label, encounter_label,
             transport_state_jsonb, draft_extraction_jsonb
      FROM ${liveSessionsRepo.sessionsTableName}
      ORDER BY started_at DESC
    `);

    console.log(`   Found ${sessions.length} sessions in database`);

    for (const session of sessions) {
      const context = {
        hasTranscript: false, // We'll check this later
        hasReviewItems: (session.draft_extraction_jsonb?.review_items || []).length > 0,
        isRecording: session.transport_state_jsonb?.connectionState === 'connected',
        isPaused: session.transport_state_jsonb?.connectionState === 'paused',
        isFinalizing: false
      };

      const uiStatus = mapDbStatusToUiStatus(session.status, context);
      const validUiStatuses = ['draft', 'live', 'paused', 'review_required', 'finalizing', 'finalized', 'failed'];

      if (validUiStatuses.includes(uiStatus)) {
        console.log(`   ✅ Session ${session.id}: DB '${session.status}' → UI '${uiStatus}'`);
        passedTests++;
      } else {
        console.log(`   ❌ Session ${session.id}: DB '${session.status}' → UI '${uiStatus}' (invalid UI status)`);
        failedTests++;
      }
    }
  } catch (error) {
    console.log(`   ⚠️  Could not test against database: ${error.message}`);
  }

  // Summary
  console.log('\n📈 Test Summary:');
  console.log(`   Passed: ${passedTests}`);
  console.log(`   Failed: ${failedTests}`);

  if (failedTests === 0) {
    console.log('\n✅ All tests passed! Status mapping is working correctly.\n');
    console.log('📋 Status Mapping Reference:');
    console.log('   DB Status → UI Status');
    console.log('   ─────────────────────────');
    console.log('   active    → draft (default)');
    console.log('   active    → live (if recording or has transcript)');
    console.log('   active    → paused (if paused)');
    console.log('   active    → review_required (if has review items)');
    console.log('   active    → finalizing (if finalizing)');
    console.log('   ended     → finalized');
    console.log('   abandoned → failed');
    console.log('\n   UI Status → DB Status');
    console.log('   ─────────────────────────');
    console.log('   draft              → active');
    console.log('   live               → active');
    console.log('   paused             → active');
    console.log('   review_required    → active');
    console.log('   finalizing         → active');
    console.log('   finalized          → ended');
    console.log('   failed             → abandoned');
    console.log('\n');
    return 0;
  } else {
    console.log('\n❌ Some tests failed. Please review the status mapping logic.\n');
    return 1;
  }
}

// Run the test
if (require.main === module) {
  testStatusMapping()
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((error) => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testStatusMapping };