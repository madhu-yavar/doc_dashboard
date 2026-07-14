#!/usr/bin/env node
/**
 * Test script to verify the WebM chunk fix works correctly
 * This simulates what happens during live recording with chunk flushing
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { execSync } = require('child_process');

const sessionId = 'live-1781602876335-fc576ea5';
const sourceAudioPath = path.join(__dirname, 'server', 'storage', 'live_conversation_audio', `${sessionId}.webm`);
const tempDir = path.join(__dirname, 'server', 'storage', 'live_conversation_temp');

async function testChunkFix() {
  console.log('=== Testing WebM Chunk Fix ===\n');

  // Clean up temp dir
  fs.mkdirSync(tempDir, { recursive: true });

  // Read the source audio
  const sourceBuffer = await fsp.readFile(sourceAudioPath);
  console.log(`Source audio: ${(sourceBuffer.length / 1024).toFixed(2)} KB`);

  // Simulate browser recording: split into chunks (like what happens during live recording)
  const chunkSizes = [50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000, sourceBuffer.length - 400000];
  let offset = 0;
  const chunkFiles = [];

  console.log('\n--- Creating chunks (simulating live recording) ---');
  for (let i = 0; i < chunkSizes.length; i++) {
    const size = Math.min(chunkSizes[i], sourceBuffer.length - offset);
    if (size <= 0) break;

    const chunkBuffer = sourceBuffer.subarray(offset, offset + size);
    offset += size;

    const chunkPath = path.join(tempDir, `test-chunk-${i}.webm`);
    await fsp.writeFile(chunkPath, chunkBuffer);
    chunkFiles.push(chunkPath);
    console.log(`Chunk ${i}: ${(chunkBuffer.length / 1024).toFixed(2)} KB -> ${chunkPath}`);
  }

  // Test 1: WITHOUT fix (transcribing individual chunks without prepending)
  console.log('\n--- Test 1: WITHOUT Fix (transcribing chunk 3 directly) ---');
  try {
    const chunk3Path = chunkFiles[3];
    console.log(`Transcribing ${chunk3Path}...`);
    const result3 = execSync(
      `whisper "${chunk3Path}" --model tiny --output_format json --output_dir ${tempDir} 2>&1 || echo "WHISPER_FAILED"`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    console.log('Result:', result3.substring(0, 500) || 'EMPTY/GIBBERISH');
  } catch (e) {
    console.log('Result: FAILED or GIBBERISH (expected without fix)');
  }

  // Test 2: WITH fix (concatenating all previous chunks)
  console.log('\n--- Test 2: WITH Fix (concatenating chunks 0-3) ---');
  const combinedPath = path.join(tempDir, 'test-comfixed.webm');
  const combinedBuffers = [];
  for (let i = 0; i <= 3; i++) {
    const buffer = await fsp.readFile(chunkFiles[i]);
    combinedBuffers.push(buffer);
  }
  const combined = Buffer.concat(combinedBuffers);
  await fsp.writeFile(combinedPath, combined);
  console.log(`Combined file: ${(combined.length / 1024).toFixed(2)} KB`);

  try {
    console.log(`Transcribing ${combinedPath}...`);
    const resultFixed = execSync(
      `whisper "${combinedPath}" --model tiny --output_format json --output_dir ${tempDir} 2>&1 || echo "WHISPER_FAILED"`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    console.log('Result:', resultFixed.substring(0, 500));
  } catch (e) {
    console.log('Result:', e.output?.[1]?.substring(0, 500) || 'ERROR');
  }

  // Test 3: Full file transcription (baseline)
  console.log('\n--- Test 3: Baseline (full file) ---');
  try {
    console.log(`Transcribing full file...`);
    const resultFull = execSync(
      `whisper "${sourceAudioPath}" --model tiny --output_format json --output_dir ${tempDir} 2>&1 || echo "WHISPER_FAILED"`,
      { encoding: 'utf-8', timeout: 60000 }
    );
    console.log('Result:', resultFull.substring(0, 800));
  } catch (e) {
    console.log('Result:', e.output?.[1]?.substring(0, 800) || 'ERROR');
  }

  console.log('\n=== Test Complete ===');
}

testChunkFix().catch(console.error);
