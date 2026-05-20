const VoiceExtractorAgent = require('./agents/voice_extractor_agent.cjs');
const GeminiClientTool = require('./tools/llm/gemma_client.tool.cjs');
const PromptBuilderTool = require('./tools/llm/prompt_builder.tool.cjs');

// Initialize the voice extractor
const voiceExtractor = new VoiceExtractorAgent({
  gemma: {
    baseUrl: process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions",
    model: process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it",
    timeout: 180000,
    defaultJsonMode: false // Disabled for better compatibility
  },
  logSteps: true
});

// Load the transcript
const transcript = {
  segments: [
    {
      id: "seg_0",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:00",
      endLabel: "00:06",
      text: "diagnosis low back pain with left lower extremity numbness, lumbar disc herniation, lumbar foraminal stenosis.",
      confidence: 0.98,
      flags: []
    },
    {
      id: "seg_1",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:06",
      endLabel: "00:13",
      text: "55-year-old white female who underwent sacroiliac joint injection right with 80% improvement in right-sided low back pain.",
      confidence: 0.99,
      flags: []
    },
    {
      id: "seg_2",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:13",
      endLabel: "00:23",
      text: "Patient now presents to the pain clinic with left lower extremity pain and numbness. Patient's MRI shows foraminal stenosis L4-5.",
      confidence: 0.98,
      flags: []
    },
    {
      id: "seg_3",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:23",
      endLabel: "00:26",
      text: "As a result, we decided to proceed with a lumbar epidural steroid injection.",
      confidence: 0.99,
      flags: []
    },
    {
      id: "seg_4",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:26",
      endLabel: "00:30",
      text: "In the end, plan: If patient is doing well, no further intervention will be done.",
      confidence: 0.99,
      flags: []
    },
    {
      id: "seg_5",
      speakerRole: "doctor",
      speakerLabel: "Doctor",
      startLabel: "00:30",
      endLabel: "00:31",
      text: "End of dictation.",
      confidence: 0.99,
      flags: []
    }
  ],
  rawText: "diagnosis low back pain with left lower extremity numbness, lumbar disc herniation, lumbar foraminal stenosis. 55-year-old white female who underwent sacroiliac joint injection right with 80% improvement in right-sided low back pain. Patient now presents to the pain clinic with left lower extremity pain and numbness. Patient's MRI shows foraminal stenosis L4-5. As a result, we decided to proceed with a lumbar epidural steroid injection. In the end, plan: If patient is doing well, no further intervention will be done. End of dictation.",
  language: "en",
  overallConfidence: 0.98
};

console.log('Starting voice extraction test...');
console.log('Transcript segments:', transcript.segments.length);

// Execute the extraction
voiceExtractor.execute('test-esl-session', transcript)
  .then(result => {
    console.log('\nExtraction completed:');
    console.log('Success:', result.success);
    console.log('Status:', result.status);
    console.log('Review items:', result.reviewItems.length);

    if (result.errors && result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach(err => console.log('- ', err.error));
    }

    if (result.extractedData) {
      console.log('\nExtracted data:');
      console.log('- Diagnosis:', result.extractedData.diagnosis?.principal?.[0]?.name || 'None');
      console.log('- Medications:', result.extractedData.medications?.length || 0, 'medications');
      console.log('- Vitals:', result.extractedData.vitals);
    }
  })
  .catch(error => {
    console.error('Extraction failed:', error);
  });