/**
 * Test Script: Hybrid STT Reconciliation with Gemma
 *
 * This script tests whether using Gemma to merge MedASR + Whisper
 * produces better transcripts than either alone.
 */

const path = require('path');
const { readFileSync } = require('fs');

// Load .env file
const envPath = path.join(__dirname, '../.env');
const envContent = readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && !key.startsWith('#') && valueParts.length > 0) {
    process.env[key] = valueParts.join('=');
  }
});

// Import STT skills
const MedASRSTTSkill = require('../skills/stt/medasr_stt_skill.cjs');
const WhisperSTTSkill = require('../skills/stt/whisper_stt_skill.cjs');

// Gemma configuration
const GEMMA_URL = process.env.GEMMA_URL?.replace('/v1/chat/completions', '') || 'http://localhost:11434';
const GEMMA_MODEL = process.env.GEMMA_MODEL || 'gemma:7b';

/**
 * Call Gemma API for reconciliation
 */
async function callGemma(prompt) {
  const startTime = Date.now();

  const response = await fetch(`${GEMMA_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GEMMA_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a medical transcription expert. Your task is to merge two speech-to-text transcripts into one accurate, clean medical transcript.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`Gemma API failed: ${response.status}`);
  }

  const data = await response.json();
  const elapsed = Date.now() - startTime;

  return {
    text: data.choices[0].message.content,
    elapsed,
    tokens: data.usage?.total_tokens || 0
  };
}

/**
 * Reconcile two transcripts using Gemma
 */
async function reconcileWithGemma(medasrResult, whisperResult) {
  const medasrText = medasrResult.data?.rawText || '';
  const whisperText = whisperResult.data?.rawText || '';

  console.log('\n📋 Sending to Gemma for reconciliation...\n');

  const prompt = `You are a medical transcription reconciliation expert. You have two transcripts of the same medical dictation:

TRANSCRIPT A (MedASR - Medical ASR specialized):
Strengths: Excellent at medical terminology, drug names, procedures
Weaknesses: May contain formatting artifacts, less natural flow

"${medasrText}"

TRANSCRIPT B (Whisper - General ASR):
Strengths: Better grammar, natural language flow, general accuracy
Weaknesses: May struggle with medical terms

"${whisperText}"

INSTRUCTIONS:
1. Create ONE best combined transcript
2. Prefer MedASR for: drug names, dosages, medical conditions, procedures, vital signs
3. Prefer Whisper for: grammar, sentence structure, general narrative flow
4. Fix any inconsistencies (e.g., if MedASR says "5 years old" but Whisper says "50 years old", use context to decide)
5. Remove artifacts like {next}, {period}, [ASSESSMENT], etc.
6. Return valid JSON only:
{
  "mergedTranscript": "the complete merged transcript",
  "rationale": "brief explanation of key decisions made",
  "confidence": "high/medium/low"
}`;

  const result = await callGemma(prompt);
  const parsed = JSON.parse(result.text);

  return {
    mergedTranscript: parsed.mergedTranscript,
    rationale: parsed.rationale,
    confidence: parsed.confidence,
    elapsed: result.elapsed,
    tokens: result.tokens
  };
}

/**
 * Main test function
 */
async function runTest() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║        Hybrid STT Reconciliation Test with Gemma               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const audioPath = path.join(__dirname, '../tests/fixtures/audio/ESL+pain+mgmt+sample.wav');

  if (!require('fs').existsSync(audioPath)) {
    console.error(`❌ Audio file not found: ${audioPath}`);
    process.exit(1);
  }

  console.log(`📁 Audio: ${path.basename(audioPath)}\n`);

  // Initialize STT skills
  const medasr = new MedASRSTTSkill({
    endpoint: process.env.MEDASR_ENDPOINT || 'http://206.1.62.28:8008/transcribe',
    timeout: 30000,
    debug: false
  });

  const whisper = new WhisperSTTSkill({
    url: process.env.WHISPER_STT_URL || 'http://202.88.209.11/whisper/transcribe',
    language: 'auto',
    timeout: 60000,
    debug: false
  });

  // Step 1: Run MedASR
  console.log('🔄 Step 1: Running MedASR...');
  const medasrStart = Date.now();
  const medasrResult = await medasr.execute({
    audioPath,
    mimeType: 'audio/wav'
  });
  const medasrElapsed = Date.now() - medasrStart;

  if (!medasrResult.success) {
    console.error(`❌ MedASR failed: ${medasrResult.error}`);
    process.exit(1);
  }

  console.log(`✅ MedASR completed in ${medasrElapsed}ms`);
  console.log(`📝 Text length: ${medasrResult.data.rawText.length} chars\n`);

  // Step 2: Run Whisper
  console.log('🔄 Step 2: Running Whisper...');
  const whisperStart = Date.now();
  const whisperResult = await whisper.execute({
    audioPath,
    mimeType: 'audio/wav'
  });
  const whisperElapsed = Date.now() - whisperStart;

  if (!whisperResult.success) {
    console.error(`❌ Whisper failed: ${whisperResult.error}`);
    process.exit(1);
  }

  console.log(`✅ Whisper completed in ${whisperElapsed}ms`);
  console.log(`📝 Text length: ${whisperResult.data.rawText.length} chars\n`);

  // Step 3: Display side-by-side comparison
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    TRANSCRIPT COMPARISON                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('┌─ MEDASR OUTPUT ────────────────────────────────────────────────┐');
  console.log(medasrResult.data.rawText);
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  console.log('┌─ WHISPER OUTPUT ───────────────────────────────────────────────┐');
  console.log(whisperResult.data.rawText);
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  // Step 4: Reconcile with Gemma
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              GEMMA HYBRID RECONCILIATION                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const reconciliationStart = Date.now();
  const reconciled = await reconcileWithGemma(medasrResult, whisperResult);
  const reconciliationElapsed = Date.now() - reconciliationStart;

  console.log(`✅ Reconciliation completed in ${reconciliationElapsed}ms`);
  console.log(`📊 Tokens used: ${reconciled.tokens}\n`);

  console.log('┌─ MERGED TRANSCRIPT (Gemma) ───────────────────────────────────┐');
  console.log(reconciled.mergedTranscript);
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  console.log(`💡 Rationale: ${reconciled.rationale}`);
  console.log(`📈 Confidence: ${reconciled.confidence}\n`);

  // Summary
  const totalElapsed = medasrElapsed + whisperElapsed + reconciliationElapsed;

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                 ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  MedASR:        ${String(medasrElapsed).padStart(8)}ms                                ║`);
  console.log(`║  Whisper:       ${String(whisperElapsed).padStart(8)}ms                                ║`);
  console.log(`║  Reconciliation:${String(reconciliationElapsed).padStart(8)}ms                                ║`);
  console.log(`║  ─────────────────────────────────────────                       ║`);
  console.log(`║  TOTAL:         ${String(totalElapsed).padStart(8)}ms                                ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('🎯 Question: Is the Gemma-merged transcript better than either alone?');
  console.log('   Consider medical accuracy, grammar, formatting, and completeness.\n');
}

// Run the test
runTest().catch(error => {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
});
