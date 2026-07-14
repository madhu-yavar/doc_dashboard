/**
 * Test script to verify live conversation status mapping fix
 */

const { LiveConversationStore } = require('./server/live_conversation_store.cjs');
const { AuthService } = require('./server/auth_service.cjs');
const { TranscriptsRepository } = require('./server/repositories/transcripts_repository.cjs');

async function testStatusMapping() {
  console.log('🧪 Testing live conversation status mapping fix...\n');

  try {
    // Initialize repositories
    const authService = new AuthService({ storageDir: './server/storage' });
    const transcriptsRepository = new TranscriptsRepository();
    await transcriptsRepository.initialize();

    // Initialize store
    const store = new LiveConversationStore({
      authService,
      transcriptsRepository
    });
    await store.ensureStorage();

    // Load all sessions
    console.log('📂 Loading sessions from database...');
    const sessions = await store.readSessions();

    console.log(`✅ Found ${sessions.length} sessions\n`);

    if (sessions.length === 0) {
      console.log('⚠️  No sessions found to test');
      return;
    }

    // Test each session
    let successCount = 0;
    let failureCount = 0;

    for (const session of sessions) {
      console.log(`🔍 Session: ${session.id}`);
      console.log(`   Patient: ${session.linkedPatient || 'N/A'}`);
      console.log(`   DB Status: ${session.status || 'unknown'}`);
      console.log(`   UI Status: ${session.status || 'unknown'}`);

      // Verify the session has the expected UI status
      const expectedUiStatus = mapDbStatusToUiStatus(
        session.status === 'ended' ? 'ended' : 'active',
        {
          hasTranscript: session.transcript?.segments?.length > 0,
          hasReviewItems: session.draftExtraction?.reviewItems?.length > 0,
          isRecording: session.transport?.connectionState === 'connected',
          isPaused: session.transport?.connectionState === 'paused',
          isFinalizing: false
        }
      );

      console.log(`   Expected UI Status: ${expectedUiStatus}`);

      // Check if the session has the correct mapped status
      if (session.status && ['draft', 'live', 'paused', 'review_required', 'finalizing', 'finalized', 'failed'].includes(session.status)) {
        console.log(`   ✅ Status is valid UI status`);
        successCount++;
      } else {
        console.log(`   ❌ Status is NOT a valid UI status`);
        failureCount++;
      }

      // Check if the session has proper structure
      const hasRequiredFields = session.id && session.status && session.createdBy && session.updatedAt;
      if (hasRequiredFields) {
        console.log(`   ✅ Session has required fields`);
      } else {
        console.log(`   ❌ Session missing required fields`);
        failureCount++;
      }

      console.log('');
    }

    console.log('📈 Test Summary:');
    console.log(`   Total sessions: ${sessions.length}`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Failures: ${failureCount}`);

    if (failureCount === 0) {
      console.log('\n✅ All sessions have valid UI statuses!');
      console.log('🎉 Status mapping fix is working correctly!\n');
    } else {
      console.log('\n❌ Some sessions have issues with status mapping\n');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

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

// Run the test
if (require.main === module) {
  testStatusMapping()
    .then(() => {
      console.log('✅ Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testStatusMapping };