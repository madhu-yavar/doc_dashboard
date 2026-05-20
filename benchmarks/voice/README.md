# Voice Dictation Benchmark Dataset

This directory contains sample voice dictation transcripts for testing and evaluation of the voice intake pipeline.

## Purpose
- Test the voice extraction pipeline end-to-end
- Evaluate medication extraction accuracy
- Evaluate diagnosis extraction accuracy
- Compare transcript quality from Gemini

## Format
Each benchmark file contains:
- Sample transcript (as would be returned by Gemini STT)
- Expected structured output (ground truth)
- Evaluation metrics

## Files

### 1. medication_heavy_dictation.json
A dictation focused on medication orders with multiple drugs, dosages, and frequencies.

### 2. complex_discharge_dictation.json
A comprehensive discharge dictation covering diagnosis, medications, follow-up, and instructions.

### 3. brief_progress_note.json
A shorter progress note dictation with vitals and clinical updates.

## Usage

```javascript
const benchmark = require("./benchmark/medication_heavy_dictation.json");

// Test extraction
const result = await voiceExtractorAgent.execute("test_session_1", benchmark.transcript);

// Compare with ground truth
const evaluation = compareExtraction(result.extractedData, benchmark.groundTruth);
```

## Evaluation Metrics

### Transcript Quality
- Word Error Rate (WER) - manual calculation needed
- Speaker diarization accuracy
- Timestamp accuracy

### Extraction Quality
- Medication precision/recall
- Diagnosis precision/recall
- Vitals extraction accuracy
- Follow-up item capture

### Review Burden
- Number of review items generated
- False positive review rate
- Missing critical items
