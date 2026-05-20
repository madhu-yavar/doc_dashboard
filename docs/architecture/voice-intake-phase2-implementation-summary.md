# Voice Intake Phase 2 Implementation Summary

## Date: 2026-05-13

## Overview
Phase 2 implements structured clinical data extraction from voice transcripts using LangGraph.js orchestration and Gemma 4-26B-A4B model.

## What Was Implemented

### 1. LangGraph.js Installation
- Added `@langchain/langgraph` and `@langchain/core` dependencies
- Ready for full LangGraph StateGraph implementation

### 2. Voice Extraction Skills
Created 3 voice-specific extraction skills:

#### `VoiceMedicationsExtractorSkill`
- Extracts medications from transcript segments
- Handles spoken medication names and dosages
- Tracks provenance (segment ID, timestamps, quoted text)
- Flags items needing review (phonetic ambiguity, unclear doses)

#### `VoiceDiagnosisExtractorSkill`
- Extracts principal and secondary diagnoses
- Classifies as: principal, secondary, rule_out, historical
- Expands spoken abbreviations (e.g., "CHF" → "Congestive Heart Failure")
- Tracks provenance for each diagnosis

#### `VoiceClinicalExtractorSkill`
- Extracts vitals, labs, radiology, procedures, follow-up, allergies
- Handles spoken numbers ("One twenty over eighty" → 120/80 BP)
- Categorizes imaging types and procedures
- Tracks provenance for all extracted items

### 3. Voice Extractor Agent
**File**: `agents/voice_extractor_agent.cjs`

Orchestration using simplified LangGraph pattern:
```
transcript → extract_medications → extract_diagnosis → extract_clinical
→ merge_reconcile → map_dashboard → decide_review
```

Key features:
- Maintains `VoiceIntakeState` throughout pipeline
- Generates review items for low-confidence extractions
- Builds dashboard-ready payload
- Comprehensive audit trail with steps and errors

### 4. Backend Integration
**File**: `server/index.cjs`

Updated `/api/voice/process` endpoint:
1. Transcribes audio with Gemini (existing Phase 1)
2. **NEW**: Runs VoiceExtractorAgent on transcript
3. Merges transcript-level and extraction-level review items
4. Stores `extractedData` and `dashboardPayload` in session
5. Returns complete session with extraction results

### 5. Dashboard Mapper Extension
**File**: `skills/clinical/dashboard_mapper.skill.cjs`

Added `mapVoiceData()` function to ensure voice data is compatible with existing dashboard schema.

### 6. Benchmark Dataset
**Directory**: `benchmarks/voice/`

Three sample dictation transcripts with ground truth:
1. `medication_heavy_dictation.json` - Focus on medication extraction
2. `complex_discharge_dictation.json` - Comprehensive discharge dictation
3. `brief_progress_note.json` - Short progress note with vitals

## Data Flow

```
Audio File
  ↓ (Gemini STT - Phase 1)
Transcript (segments with timestamps, confidence, speaker labels)
  ↓ (VoiceExtractorAgent - Phase 2)
┌─────────────────────────────────────────────────────────────┐
│ VoiceIntakeState                                              │
│  - transcript: { segments, rawText, confidence }             │
│  - medications: extracted with provenance                   │
│  - diagnosis: principal + secondary + rule_out              │
│  - clinical: vitals, labs, radiology, procedures, follow-up │
│  - extractedData: merged structured output                   │
│  - dashboardPayload: dashboard-ready format                  │
│  - reviewItems: items needing human review                  │
└─────────────────────────────────────────────────────────────┘
  ↓
Dashboard (existing visualization)
```

## Key Design Decisions

### Provenance Model
Voice uses different provenance than PDFs:
```js
{
  source_type: "audio_transcript",
  segment_id: "seg_3",
  time_range_ms: { start: 25000, end: 45000 },
  quoted_text: "Starting the following medications...",
  speaker_role: "doctor",
  confidence: 0.91
}
```

### Review Item Generation
Items require review when:
- Medication name is phonetically ambiguous
- Dose or frequency is unclear
- Diagnosis is stated with uncertainty
- Confidence score < 0.7

### Sequential Extraction
Current implementation runs extractions sequentially:
1. Medications (can be slow due to list processing)
2. Diagnosis (typically fast)
3. Clinical data (varies based on content)

Future: Parallel extraction of independent categories.

## Configuration

Uses Gemma 4-26B-A4B (from `.env`):
```
GEMMA_URL=http://206.1.62.28:8000/v1/chat/completions
GEMMA_MODEL=google/gemma-4-26B-A4B-it
```

Timeouts:
- Per step: 180 seconds (3 minutes)
- Total: 600 seconds (10 minutes)

## Next Steps

### Immediate
1. Test with real voice audio files
2. Evaluate extraction quality on benchmark dataset
3. Fine-tune prompts based on results

### Phase 3
1. Implement full LangGraph StateGraph with checkpointing
2. Add human-in-the-loop interrupts for review
3. Implement resume-after-review workflow
3. Add progress streaming (SSE) for long extractions

### Future Enhancements
1. Parallel extraction for better performance
2. Cross-validation between extraction skills
3. Learn from review decisions to improve confidence
4. Add Whisper STT backend option

## Files Created/Modified

### Created
- `agents/voice_extractor_agent.cjs`
- `skills/extraction/voice_medications_extractor.skill.cjs`
- `skills/extraction/voice_diagnosis_extractor.skill.cjs`
- `skills/extraction/voice_clinical_extractor.skill.cjs`
- `benchmarks/voice/README.md`
- `benchmarks/voice/medication_heavy_dictation.json`
- `benchmarks/voice/complex_discharge_dictation.json`
- `benchmarks/voice/brief_progress_note.json`

### Modified
- `server/index.cjs` - Added VoiceExtractorAgent import and integration
- `skills/clinical/dashboard_mapper.skill.cjs` - Added mapVoiceData method
- `package.json` - Added LangGraph dependencies
