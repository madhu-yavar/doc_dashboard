/**
 * Test to verify the transcript accumulation issue
 *
 * The hypothesis: When the STT agent processes each chunk, it's building
 * a cumulative transcript that includes ALL previous chunks. When this gets
 * passed through extractNovelTranscriptSuffix, the delta extraction fails
 * because the current window already contains all previous text.
 */

const LiveConversationSTTAgent = require('./agents/live_conversation_stt_agent.cjs');

// Simulate the accumulation pattern
console.log('=== SIMULATING TRANSCRIPT ACCUMULATION ===\n');

// Chunk 1: "26-year-old, generally healthy,"
const chunk1Text = "26-year-old, generally healthy,";
let accumulated = chunk1Text;

console.log('Chunk 1 transcript:', chunk1Text);
console.log('Accumulated after chunk 1:', accumulated);
console.log();

// Chunk 2: "presents with fever"
const chunk2Text = "presents with fever";
// This simulates what happens in the STT agent's buildChunkTranscriptResult
const chunk2Cumulative = [accumulated, chunk2Text].join("\n");

console.log('Chunk 2 transcript:', chunk2Text);
console.log('Cumulative after chunk 2 (what STT returns):', chunk2Cumulative);
console.log();

// Now simulate extractNovelTranscriptSuffix
function simulateExtractNovelTranscriptSuffix(previousWindowText, currentWindowText) {
  const previousComparable = previousWindowText.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const currentComparable = currentWindowText.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  console.log('  Previous normalized:', `"${previousComparable}"`);
  console.log('  Current normalized:', `"${currentComparable}"`);

  if (!currentComparable) return "";
  if (!previousComparable) return currentWindowText;
  if (previousComparable === currentComparable) return "";

  const previousWords = previousComparable.split(/\s+/).filter(Boolean);
  const currentWords = currentComparable.split(/\s+/).filter(Boolean);
  const currentOriginalWords = currentWindowText.split(/\s+/).filter(Boolean);

  // Check for overlap at the end of previous and start of current
  for (let overlap = Math.min(previousWords.length, currentWords.length); overlap >= 2; overlap -= 1) {
    if (previousWords.slice(-overlap).join(" ") === currentWords.slice(0, overlap).join(" ")) {
      const delta = currentOriginalWords.slice(overlap).join(" ").trim();
      console.log(`  Found overlap of ${overlap} words, delta: "${delta}"`);
      return delta;
    }
  }

  console.log('  No overlap found, returning full current text');
  return currentWindowText;
}

console.log('=== DELTA EXTRACTION TEST ===\n');

// After chunk 1
let previousWindow = "";
let currentWindow = accumulated;
let delta = simulateExtractNovelTranscriptSuffix(previousWindow, currentWindow);
console.log('Result: Delta =', `"${delta}"`);
console.log('Expected: Same as chunk 1 ✓');
console.log();

// After chunk 2 - THIS IS WHERE THE BUG HAPPENS
previousWindow = accumulated;
currentWindow = chunk2Cumulative;
delta = simulateExtractNovelTranscriptSuffix(previousWindow, currentWindow);
console.log('Result: Delta =', `"${delta}"`);
console.log('Expected: "presents with fever"');
console.log();

// Now test with NEWLINE as separator (this is the actual issue!)
console.log('=== TESTING WITH NEWLINE SEPARATOR (ACTUAL BUG) ===\n');

const chunk2CumulativeWithNewline = [accumulated, chunk2Text].join("\n");
console.log('Current window with newline:', `"${chunk2CumulativeWithNewline}"`);
console.log();

// The extractNovelTranscriptSuffix normalizes by replacing \s+ with space
// So "26-year-old, generally healthy,\npresents with fever" becomes
// "26-year-old, generally healthy, presents with fever"

const normalizedWithNewline = chunk2CumulativeWithNewline.replace(/\s+/g, ' ').trim();
console.log('Normalized current window:', `"${normalizedWithNewline}"`);
console.log('Previous window:', `"${accumulated}"`);
console.log();

// Now compare
const previousNormalized = accumulated.replace(/\s+/g, ' ').trim().toLowerCase();
const currentNormalized = normalizedWithNewline.toLowerCase();

console.log('Previous normalized:', `"${previousNormalized}"`);
console.log('Current normalized:', `"${currentNormalized}"`);
console.log('Match?', previousNormalized === currentNormalized ? 'YES - BUG!' : 'NO');
console.log();

if (previousNormalized === currentNormalized) {
  console.log('🐛 BUG CONFIRMED: Delta extraction returns empty string!');
  console.log('   This happens because the cumulative transcript includes ALL previous text.');
  console.log('   The delta extraction logic assumes there will be new content to extract,');
  console.log('   but when the cumulative already has everything, it returns empty.');
}

console.log('\n=== SUMMARY ===');
console.log('The issue is in buildChunkTranscriptResult at line 697:');
console.log('  const cumulativeTranscript = successfulChunks.map((chunk) => chunk.transcript).join("\\n");');
console.log('');
console.log('When processing individual chunks in live mode, this creates a cumulative transcript');
console.log('that includes ALL chunks. The websocket then tries to extract the delta, but since');
console.log('the cumulative already contains everything, the delta is empty or incorrect.');
console.log('');
console.log('Solution: The STT agent should return ONLY the current chunk transcript, not cumulative.');
