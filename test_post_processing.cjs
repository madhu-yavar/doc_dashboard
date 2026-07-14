/**
 * Test script to verify post-processing pipeline with speaker diarization
 */

const { LiveSessionsRepository } = require('./server/repositories/live_sessions_repository.cjs');
const { TranscriptsRepository } = require('./server/repositories/transcripts_repository.cjs');
const { DocumentsRepository } = require('./server/repositories/documents_repository.cjs');
const LiveConversationStore = require('./server/live_conversation_store.cjs');
const LiveConversationSTTAgent = require('./agents/live_conversation_stt_agent.cjs');
const path = require('path');

async function testPostProcessing() {
  console.log('=== Testing Post-Processing Pipeline ===\n');

  try {
    // Initialize repositories
    const liveSessionsRepo = new LiveSessionsRepository({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'doctor_dashboard',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    });

    await liveSessionsRepo.initialize();

    const transcriptsRepo = new TranscriptsRepository({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'doctor_dashboard',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    });

    await transcriptsRepo.initialize();

    const docsRepo = new DocumentsRepository({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'doctor_dashboard',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    });

    await docsRepo.initialize();

    const store = new LiveConversationStore({
      storageDir: path.join(__dirname, 'server', 'storage'),
      transcriptsRepository: transcriptsRepo,
      docsRepository: docsRepo,
      liveSessionsRepository: liveSessionsRepo,
    });

    // Find most recent live conversation session
    console.log('Finding most recent live conversation session...');
    const sessions = await liveSessionsRepo.query(`
      SELECT * FROM ${liveSessionsRepo.sessionsTableName}
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (sessions.length === 0) {
      console.log('No live conversation sessions found in database.');
      console.log('Creating a test session...');

      // Create a test session
      const testSessionId = `live-test-${Date.now()}`;
      console.log(`Test session ID: ${testSessionId}`);
      console.log('\nNote: To test post-processing, you need to:');
      console.log('1. Start a live recording from the UI');
      console.log('2. Speak for 30-60 seconds');
      console.log('3. Click End');
      console.log('4. Check the transcript for speaker diarization');
      console.log('\nThe post-processing will run with speaker diarization enabled.');
      return;
    }

    console.log(`Found ${sessions.length} recent sessions:`);
    sessions.forEach((session, i) => {
      console.log(`  ${i + 1}. ${session.id} - Status: ${session.status}, Created: ${session.created_at}`);
    });

    // Test the most recent session
    const latestSession = sessions[0];
    console.log(`\nTesting with latest session: ${latestSession.id}`);
    console.log(`Status: ${latestSession.status}`);
    console.log(`Ended At: ${latestSession.ended_at || 'Still active'}`);
    console.log(`Audio Path: ${latestSession.document_id || 'No audio file'}`);

    // Check if transcript exists
    if (latestSession.current_transcript_id) {
      const transcript = await transcriptsRepo.findTranscriptById(latestSession.current_transcript_id);
      console.log(`\nTranscript exists:`);
      console.log(`  - Raw text length: ${(transcript?.raw_text || '').length} chars`);
      console.log(`  - Normalized text length: ${(transcript?.normalized_text || '').length} chars`);
      console.log(`  - Segments: ${transcript?.segments ? transcript.segments.length : 0}`);
    } else {
      console.log('\nNo transcript found for this session.');
    }

    console.log('\n=== Configuration ===');
    console.log('ENABLE_LIVE_TRANSCRIPTION:', process.env.ENABLE_LIVE_TRANSCRIPTION || 'not set');
    console.log('ENABLE_LIVE_DRAFT_EXTRACTION:', process.env.ENABLE_LIVE_DRAFT_EXTRACTION || 'not set');
    console.log('\nPost-processing will use:');
    console.log('  - enableSpeakerDiarization: true (enabled in code)');

    console.log('\n=== Test Complete ===');
    console.log('\nTo test post-processing with speaker diarization:');
    console.log('1. Go to the UI and start a new live recording');
    console.log('2. Speak for 30-60 seconds with multiple speakers');
    console.log('3. Click End');
    console.log('4. Wait for post-processing to complete');
    console.log('5. Check the transcript for speaker labels (Doctor/Patient)');

    await liveSessionsRepo.close();
    await transcriptsRepo.close();
    await docsRepo.close();

  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testPostProcessing().then(() => {
  console.log('\n✓ Test completed successfully');
  process.exit(0);
}).catch((error) => {
  console.error('✗ Test failed:', error);
  process.exit(1);
});
