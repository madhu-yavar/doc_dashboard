#!/usr/bin/env node
/**
 * Direct test: Simulate the WebM chunk fix using the actual STT agent
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const LiveConversationSTTAgent = require('./agents/live_conversation_stt_agent.cjs');

const sessionId = 'live-1781602876335-fc576ea5';
const sourceAudioPath = path.join(__dirname, 'server', 'storage', 'live_conversation_audio', `${sessionId}.webm`);
const tempDir = path.join(__dirname, 'server', 'storage', 'live_conversation_temp');

async function testWithSTTAgent() {
  console.log('=== Testing WebM Chunk Fix with STT Agent ===\n');

  await fsp.mkdir(tempDir, { recursive: true });

  // Read source audio
  const sourceBuffer = await fsp.readFile(sourceAudioPath);
  console.log(`Source audio: ${(sourceBuffer.length / 1024).toFixed(2)} KB`);

  // Simulate chunks
  const chunkCount = 5;
  const chunkSize = Math.floor(sourceBuffer.length / chunkCount);
  const chunkFiles = [];

  console.log('\n--- Creating chunks ---');
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = i === chunkCount - 1 ? sourceBuffer.length : start + chunkSize;
    const chunkBuffer = sourceBuffer.subarray(start, end);
    const chunkPath = path.join(tempDir, `test-chunk-${i}.webm`);
    await fsp.writeFile(chunkPath, chunkBuffer);
    chunkFiles.push(chunkPath);
    console.log(`Chunk ${i}: ${(chunkBuffer.length / 1024).toFixed(2)} KB`);
  }

  const sttAgent = new LiveConversationSTTAgent({ debug: true });

  // Test 1: Middle chunk WITHOUT fix (gibberish expected)
  console.log('\n--- Test 1: Chunk 3 WITHOUT fix (should be gibberish) ---');
  try {
    const result1 = await sttAgent.execute({
      audioPath: chunkFiles[3],
      options: { mode: 'fixed_window_no_vad', windowSeconds: 8 },
    });
    console.log('Result:', result1.data?.rawText?.substring(0, 200) || 'NO TEXT');
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Test 2: WITH fix (concatenating chunks 0-3)
  console.log('\n--- Test 2: Chunks 0-3 WITH fix ---');
  const combinedBuffers = [];
  for (let i = 0; i <= 3; i++) {
    combinedBuffers.push(await fsp.readFile(chunkFiles[i]));
  }
  const combined = Buffer.concat(combinedBuffers);
  const combinedPath = path.join(tempDir, 'test-fixed.webm');
  await fsp.writeFile(combinedPath, combined);
  console.log(`Combined: ${(combined.length / 1024).toFixed(2)} KB`);

  try {
    const result2 = await sttAgent.execute({
      audioPath: combinedPath,
      options: { mode: 'fixed_window_no_vad', windowSeconds: 8 },
    });
    console.log('Result:', result2.data?.rawText?.substring(0, 400) || 'NO TEXT');
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Test 3: Full file (baseline)
  console.log('\n--- Test 3: Full file baseline ---');
  try {
    const result3 = await sttAgent.execute({
      audioPath: sourceAudioPath,
      options: { mode: 'fixed_window_no_vad', windowSeconds: 8 },
    });
    console.log('Result:', result3.data?.rawText?.substring(0, 400) || 'NO TEXT');
  } catch (e) {
    console.log('Error:', e.message);
  }

  console.log('\n=== Test Complete ===');
}

testWithSTTAgent().catch(console.error);
