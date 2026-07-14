/**
 * Test to verify what the STT agent returns when called with a single chunk
 */

const LiveConversationSTTAgent = require('./agents/live_conversation_stt_agent.cjs');
const path = require('path');

// Find the latest chunk file
const fs = require('fs');
const os = require('os');

async function testSingleChunkTranscription() {
  console.log('=== TESTING SINGLE CHUNK TRANSCRIPTION ===\n');

  const sttAgent = new LiveConversationSTTAgent({ debug: true });

  // Test with a sample chunk file
  const chunkPath = '/Users/yavar/Documents/CoE/Manipal/server/storage/live_conversation_temp/live-1781664595077-2d9881f4-17-1781664670465.webm';

  console.log('Testing chunk:', chunkPath);
  console.log('File exists:', fs.existsSync(chunkPath));
  console.log();

  const result = await sttAgent.execute({
    audioPath: chunkPath,
    options: {
      mode: 'fixed_window_no_vad',
      windowSeconds: 8,
      enableSpeakerDiarization: false,
      enableGeminiFallback: true,
      browserWhisperAttempts: 3,
    },
  });

  console.log('\n=== RESULT ===');
  console.log('Success:', result.success);
  if (result.data) {
    console.log('Raw text (first 200 chars):', (result.data.rawText || '').substring(0, 200));
    console.log('Normalized text (first 200 chars):', (result.data.normalizedText || '').substring(0, 200));
    console.log('Segments:', result.data.segments?.length || 0);
    console.log('Chunks:', result.data.chunks?.length || 0);
    if (result.data.chunks && result.data.chunks.length > 0) {
      console.log('\n--- Chunk Details ---');
      result.data.chunks.forEach((chunk, i) => {
        console.log(`Chunk ${i + 1}:`);
        console.log('  Transcript:', chunk.transcript?.substring(0, 100));
        console.log('  Start:', chunk.startSeconds, 'End:', chunk.endSeconds);
      });
    }
  }
  console.log('\nBackend:', result.backend);
  console.log('Model:', result.model);

  process.exit(0);
}

testSingleChunkTranscription().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
