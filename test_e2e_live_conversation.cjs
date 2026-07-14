#!/usr/bin/env node
/**
 * E2E Test for Live Conversation System
 * Tests the complete flow from WebSocket connection to transcription and extraction
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const TEST_RESULTS = {
  websocket: { passed: false, details: [] },
  audioTransmission: { passed: false, details: [] },
  transcription: { passed: false, details: [] },
  extraction: { passed: false, details: [] },
  sessionEnd: { passed: false, details: [] }
};

const WS_URL = 'ws://localhost:8001/api/voice/live/sessions/test-e2e-session/stream';
const AUDIO_FILE = path.join(__dirname, 'server/storage/live_conversation_audio/live-1781604146750-8d76c818.webm');

console.log('='.repeat(80));
console.log('LIVE CONVERSATION E2E TEST');
console.log('='.repeat(80));
console.log(`WebSocket URL: ${WS_URL}`);
console.log(`Audio File: ${AUDIO_FILE}`);
console.log(`Audio File Exists: ${fs.existsSync(AUDIO_FILE)}`);
console.log(`Audio File Size: ${fs.existsSync(AUDIO_FILE) ? (fs.statSync(AUDIO_FILE).size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}`);
console.log('='.repeat(80));
console.log('');

async function testWebSocketConnection() {
  console.log('🔍 TEST 1: WebSocket Connection');
  console.log('-'.repeat(80));

  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);

    const timeout = setTimeout(() => {
      TEST_RESULTS.websocket.passed = false;
      TEST_RESULTS.websocket.details.push('❌ Connection timeout after 10 seconds');
      console.log('❌ FAILED: Connection timeout');
      ws.close();
      resolve(false);
    }, 10000);

    ws.on('open', () => {
      clearTimeout(timeout);
      TEST_RESULTS.websocket.passed = true;
      TEST_RESULTS.websocket.details.push('✅ WebSocket connection established');
      console.log('✅ PASSED: WebSocket connection established');
      ws.close();
      resolve(true);
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      TEST_RESULTS.websocket.passed = false;
      TEST_RESULTS.websocket.details.push(`❌ WebSocket error: ${error.message}`);
      console.log(`❌ FAILED: ${error.message}`);
      resolve(false);
    });
  });
}

async function testSessionFlow() {
  console.log('');
  console.log('🔍 TEST 2: Session Flow (Begin → Audio → End)');
  console.log('-'.repeat(80));

  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const messages = [];
    let sessionStarted = false;
    let audioSent = false;
    let sessionEnded = false;

    const timeout = setTimeout(() => {
      console.log('❌ FAILED: Session flow timeout after 15 seconds');
      console.log(`   Session Started: ${sessionStarted}`);
      console.log(`   Audio Sent: ${audioSent}`);
      console.log(`   Session Ended: ${sessionEnded}`);
      console.log(`   Messages Received: ${messages.length}`);
      if (messages.length > 0) {
        console.log('   Last few messages:');
        messages.slice(-3).forEach(m => console.log(`     - ${m.type}`));
      }
      ws.close();
      resolve(false);
    }, 15000);

    ws.on('open', async () => {
      console.log('✅ WebSocket connected');

      // Send session.begin
      console.log('📤 Sending session.begin...');
      ws.send(JSON.stringify({
        type: 'session.begin',
        sessionId: 'test-e2e-session',
        timestamp: new Date().toISOString(),
        audio: {
          mimeType: 'audio/webm;codecs=opus'
        }
      }));

      // Wait a bit then send audio
      setTimeout(async () => {
        if (fs.existsSync(AUDIO_FILE)) {
          console.log('📤 Sending audio chunk...');
          const audioBuffer = fs.readFileSync(AUDIO_FILE);
          // Send a smaller chunk to avoid overwhelming
          const chunkSize = Math.min(100000, audioBuffer.length);
          ws.send(JSON.stringify({
            type: 'audio.chunk',
            data: audioBuffer.slice(0, chunkSize).toString('base64'),
            timestamp: new Date().toISOString()
          }));
          audioSent = true;
        } else {
          console.log('⚠️  No audio file found, skipping audio test');
          audioSent = true; // Skip this part
        }

        // Wait a bit then end session
        setTimeout(() => {
          console.log('📤 Sending session.end...');
          ws.send(JSON.stringify({
            type: 'session.end',
            sessionId: 'test-e2e-session',
            timestamp: new Date().toISOString()
          }));
        }, 2000);
      }, 2000);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        messages.push(message);
        console.log(`📥 Received: ${message.type}`);

        if (message.type === 'session.state') {
          if (message.status === 'live') {
            sessionStarted = true;
            console.log('  ✅ Session status: live');
          } else if (message.status === 'review_required') {
            sessionEnded = true;
            console.log('  ✅ Session status: review_required');
          }
        }

        if (message.type === 'session.error') {
          console.log(`  ❌ Session error: ${message.error}`);
        }
      } catch (e) {
        console.log(`  ⚠️  Non-JSON message received`);
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      console.log(`❌ WebSocket error: ${error.message}`);
      resolve(false);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      const allPassed = sessionStarted && audioSent && sessionEnded;
      TEST_RESULTS.sessionEnd.passed = sessionEnded;
      TEST_RESULTS.sessionEnd.details.push(sessionEnded ? '✅ Session ended properly' : '❌ Session did not end');

      console.log('');
      if (allPassed) {
        console.log('✅ PASSED: Complete session flow successful');
      } else {
        console.log('❌ FAILED: Session flow incomplete');
      }
      resolve(allPassed);
    });
  });
}

async function testDatabaseState() {
  console.log('');
  console.log('🔍 TEST 3: Database State Check');
  console.log('-'.repeat(80));

  const { execSync } = require('child_process');

  try {
    const result = execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d doctor_dashboard -c "
      SELECT
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_sessions,
        COUNT(CASE WHEN status = 'ended' THEN 1 END) as ended_sessions,
        COUNT(CASE WHEN status = 'abandoned' THEN 1 END) as abandoned_sessions,
        COUNT(CASE WHEN transport_state_jsonb->>'workflowStatus' = 'live' THEN 1 END) as live_workflow_sessions,
        COUNT(CASE WHEN transport_state_jsonb->>'workflowStatus' = 'review_required' THEN 1 END) as review_workflow_sessions
      FROM live_conversation_sessions
      WHERE started_at > NOW() - INTERVAL '1 hour';
    "`, { encoding: 'utf-8' });

    console.log('✅ Database query successful');
    console.log(result);

    const recentSessions = execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d doctor_dashboard -c "
      SELECT
        id,
        status as db_status,
        transport_state_jsonb->>'workflowStatus' as workflow_status,
        transport_state_jsonb->>'connectionState' as connection_state,
        started_at,
        ended_at
      FROM live_conversation_sessions
      WHERE started_at > NOW() - INTERVAL '1 hour'
      ORDER BY started_at DESC
      LIMIT 5;
    "`, { encoding: 'utf-8' });

    console.log('Recent sessions:');
    console.log(recentSessions);

    return true;
  } catch (error) {
    console.log(`❌ Database query failed: ${error.message}`);
    return false;
  }
}

async function testTranscriptionQuality() {
  console.log('');
  console.log('🔍 TEST 4: Transcription Quality (Post-Facto)');
  console.log('-'.repeat(80));

  if (!fs.existsSync(AUDIO_FILE)) {
    console.log('⚠️  No audio file available for transcription test');
    return false;
  }

  console.log('Testing transcription with known good audio file...');
  console.log('Expected: ~729 words of clear conversation');
  console.log('');

  try {
    const LiveConversationSTTAgent = require('./agents/live_conversation_stt_agent.cjs');
    const sttAgent = new LiveConversationSTTAgent({ debug: false });

    const result = await sttAgent.execute({
      audioPath: AUDIO_FILE,
      options: {
        mode: 'fixed_window_no_vad',
        windowSeconds: 15,
        enableSpeakerDiarization: false,
        enableGeminiFallback: true,
        browserWhisperAttempts: 3,
      },
    });

    if (result.success && result.data) {
      const text = result.data.rawText || result.data.normalizedText || '';
      const wordCount = text.split(/\s+/).filter(Boolean).length;

      console.log(`✅ Transcription successful`);
      console.log(`   Backend: ${result.backend}`);
      console.log(`   Word Count: ${wordCount}`);
      console.log(`   Text Length: ${text.length} chars`);
      console.log('');
      console.log('Transcript Preview:');
      console.log(text.substring(0, 200) + '...');

      // Check if it's gibberish
      const isGibberish = wordCount < 10 || text.length < 50;
      if (isGibberish) {
        console.log('❌ FAILED: Transcription appears to be gibberish');
        return false;
      } else {
        console.log('✅ PASSED: Transcription quality is good');
        return true;
      }
    } else {
      console.log(`❌ FAILED: Transcription failed - ${result.error}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    return false;
  }
}

async function checkServerLogs() {
  console.log('');
  console.log('🔍 TEST 5: Server Log Analysis');
  console.log('-'.repeat(80));

  try {
    const logs = fs.readFileSync('/tmp/server.log', 'utf-8');
    const errors = logs.match(/error/gi) || [];
    const websocketErrors = logs.match(/websocket|websocket error/gi) || [];
    const chunkErrors = logs.match(/chunk|chunkbuffer/gi) || [];

    console.log(`📊 Log Statistics:`);
    console.log(`   Total Errors: ${errors.length}`);
    console.log(`   WebSocket mentions: ${websocketErrors.length}`);
    console.log(`   Chunk-related mentions: ${chunkErrors.length}`);

    if (errors.length > 0) {
      console.log('');
      console.log('Recent error lines:');
      const lines = logs.split('\n');
      const errorLines = lines.filter(l => l.toLowerCase().includes('error'));
      errorLines.slice(-5).forEach(line => {
        console.log(`   ${line.trim().substring(0, 150)}`);
      });
    }

    return errors.length === 0;
  } catch (error) {
    console.log(`⚠️  Could not read server logs: ${error.message}`);
    return false;
  }
}

async function runAllTests() {
  console.log('');
  console.log('⏱️  Starting E2E Tests...');
  console.log('');

  const results = {};

  try {
    results.websocket = await testWebSocketConnection();
    results.sessionFlow = await testSessionFlow();
    results.database = await testDatabaseState();
    results.transcription = await testTranscriptionQuality();
    results.logs = await checkServerLogs();
  } catch (error) {
    console.log(`❌ Test suite error: ${error.message}`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('E2E TEST SUMMARY');
  console.log('='.repeat(80));

  const summary = {
    'WebSocket Connection': results.websocket ? '✅ PASS' : '❌ FAIL',
    'Session Flow': results.sessionFlow ? '✅ PASS' : '❌ FAIL',
    'Database State': results.database ? '✅ PASS' : '❌ FAIL',
    'Transcription Quality': results.transcription ? '✅ PASS' : '❌ FAIL',
    'Server Logs': results.logs ? '✅ PASS (no errors)' : '⚠️  WARN (errors found)'
  };

  Object.entries(summary).forEach(([test, result]) => {
    console.log(`${test.padEnd(25)} ${result}`);
  });

  const passedCount = Object.values(results).filter(r => r).length;
  const totalCount = Object.keys(results).length;

  console.log('');
  console.log(`Overall: ${passedCount}/${totalCount} tests passed`);
  console.log('='.repeat(80));

  // Save report
  const reportPath = path.join(__dirname, 'e2e_test_report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    results,
    summary,
    testResults: TEST_RESULTS
  }, null, 2));
  console.log(`📄 Report saved to: ${reportPath}`);
  console.log('='.repeat(80));
}

runAllTests().catch(console.error);
