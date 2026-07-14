#!/usr/bin/env node
const LiveConversationSTTAgent = require('./agents/live_conversation_stt_agent.cjs');
const path = require('path');
const fs = require('fs');

const sessionId = 'live-1781602876335-fc576ea5';
const audioPath = path.join(__dirname, 'server', 'storage', 'live_conversation_audio', `${sessionId}.webm`);

console.log('Testing audio file:', audioPath);
console.log('File size:', (fs.statSync(audioPath).size / 1024 / 1024).toFixed(2), 'MB');

const sttAgent = new LiveConversationSTTAgent({ debug: true });

sttAgent.execute({
  audioPath,
  options: {
    mode: 'fixed_window_no_vad',
    windowSeconds: 15,
    enableSpeakerDiarization: false,
    enableGeminiFallback: true,
    browserWhisperAttempts: 3,
  },
}).then(result => {
  console.log('\n=== Result ===');
  console.log('Success:', result.success);
  console.log('Backend:', result.backend);
  console.log('Error:', result.error);
  if (result.data) {
    console.log('Raw text:', result.data.rawText || result.data.normalizedText || '');
    console.log('Segments:', result.data.segments?.length || 0);
  }
}).catch(error => {
  console.error('Error:', error.message);
});
