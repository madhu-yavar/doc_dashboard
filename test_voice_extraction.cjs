const fs = require('fs');
const path = require('path');

// Read the voice sessions
const voiceSessionsPath = path.join(__dirname, 'server/storage/voice_sessions.json');
const voiceSessions = JSON.parse(fs.readFileSync(voiceSessionsPath, 'utf8'));

// Find the ESL session
const eslSession = voiceSessions.sessions.find(s => s.fileName.includes('ESL'));
if (eslSession) {
  console.log('Found ESL session:', eslSession.id);
  console.log('Status:', eslSession.status);

  // If it's queued for extraction, simulate extraction
  if (eslSession.status === 'queued_for_extraction') {
    console.log('Simulating extraction...');

    // Read the transcript
    const transcriptPath = path.join(__dirname, 'server/storage/voice_transcripts', `${eslSession.id}.json`);
    if (fs.existsSync(transcriptPath)) {
      const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
      console.log('Transcript segments:', transcript.segments.length);

      // Log the transcript content
      transcript.segments.forEach((seg, i) => {
        console.log(`\nSegment ${i + 1}:`);
        console.log(`  Time: ${seg.startLabel} - ${seg.endLabel}`);
        console.log(`  Text: ${seg.text}`);
        console.log(`  Confidence: ${seg.confidence}`);
      });
    }
  }
} else {
  console.log('ESL session not found');
}