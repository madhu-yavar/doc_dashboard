# Live Conversation STT Testing Plan

## Date
2026-05-26

## Scope

The live-conversation backend now exists. This plan covers the **next hardening step for the implemented live STT path**, not pre-implementation research.

The goal is to answer:
- whether the current fixed-window live runtime is good enough to keep as default
- whether VAD should move from optional capability to default live behavior
- whether speaker diarization should be enabled in the default live path
- whether the secondary clinical STT path plus reconciliation materially improve quality enough to justify their runtime cost

Provider-specific script names and environment variables are intentionally abstracted below. Use the current deployment equivalents when running the benchmarks.

## Current Runtime Reality

### Implemented live path
- browser microphone capture uses `MediaRecorder`
- audio streams to `WS /api/voice/live/sessions/:sessionId/stream`
- `server/live_conversation_websocket.cjs` buffers chunks and flushes roughly every 3 seconds
- each flushed chunk is passed to `agents/live_conversation_stt_agent.cjs`

### Current websocket STT profile
- chunk mode: `fixed_window_no_vad`
- transcription window: 5 seconds
- speaker diarization: disabled
- transcript validation: skipped

### Capabilities already present in the repo
- internal direct-transcription benchmark scripts
- live-window simulation scripts
- matrix comparison scripts
- reconciliation benchmark scripts
- VAD segmentation scripts
- speaker-attribution benchmark scripts

## What Needs Validation Now

### 1. Default chunking strategy
Decide whether the live websocket should stay on fixed windows or move to VAD-assisted chunking.

### 2. Speaker attribution strategy
Decide whether diarization should remain disabled by default, or whether the current speaker-attribution stack is good enough for doctor/patient separation in real sessions.

### 3. Quality vs latency tradeoff
Measure whether the secondary clinical shadow transcription path plus reconciliation meaningfully improve medication, dosage, order, and follow-up accuracy.

### 4. Review-signal quality
The websocket path currently skips validation. Confirm whether that is acceptable for v1, or whether review items need to be generated during the live path itself.

## Audio Set

Start with these existing fixtures:
- `tests/fixtures/audio/ESL+pain+mgmt+sample.wav`
- `tests/fixtures/audio/ESL-Cardio-sample.wav`

Then add a broader mix from `tests/fixtures/audio/audio_recordings/`:
- one cleaner dictation sample
- one medication-heavy sample
- one longer conversational sample with pauses
- one noisier room recording

## Execution Plan

### Phase 0: config sanity

```bash
node -e "console.log({ PRIMARY_STT_URL: process.env.<primary_stt_url>, SECONDARY_CLINICAL_STT_URL: process.env.<secondary_clinical_stt_url>, PRIMARY_INFERENCE_URL: process.env.<primary_inference_url>, ENABLE_PROVIDER_FALLBACK: process.env.<provider_fallback>, SPEAKER_ATTRIBUTION_PROVIDER: process.env.<speaker_attribution_provider>, SPEAKER_ATTRIBUTION_FALLBACK: process.env.<speaker_attribution_fallback> })"
find . -maxdepth 3 -name 'silero_vad_v4.onnx' -print
```

Expected outcome:
- confirm live STT dependencies are reachable
- confirm one canonical VAD asset path before enabling VAD in the websocket runtime

### Phase 1: direct backend baseline

```bash
node scripts/<primary_direct_stt_test>.cjs tests/fixtures/audio/ESL+pain+mgmt+sample.wav
node scripts/<secondary_direct_stt_test>.cjs tests/fixtures/audio/ESL+pain+mgmt+sample.wav

node scripts/<primary_direct_stt_test>.cjs tests/fixtures/audio/ESL-Cardio-sample.wav
node scripts/<secondary_direct_stt_test>.cjs tests/fixtures/audio/ESL-Cardio-sample.wav
```

Measure:
- total latency
- medication and dosage accuracy
- procedure/order recall
- obvious transcript corruption
- full-text readability

### Phase 2: current live-shape simulation

Match the current websocket runtime as closely as possible:

```bash
node scripts/<live_window_simulation>.cjs tests/fixtures/audio/ESL+pain+mgmt+sample.wav --window-seconds 5 --hop-seconds 5
node scripts/<live_window_simulation>.cjs tests/fixtures/audio/ESL-Cardio-sample.wav --window-seconds 5 --hop-seconds 5
```

Measure:
- time to first useful transcript
- per-window latency
- chunk boundary duplication
- chunk boundary omissions
- medication line quality across boundaries

### Phase 3: compare improved chunking candidates

Test overlapping windows:

```bash
node scripts/<live_window_simulation>.cjs tests/fixtures/audio/ESL+pain+mgmt+sample.wav --window-seconds 10 --hop-seconds 5
node scripts/<live_window_simulation>.cjs tests/fixtures/audio/ESL-Cardio-sample.wav --window-seconds 10 --hop-seconds 5
```

Test VAD segmentation:

```bash
node scripts/<vad_segmentation_benchmark>.cjs tests/fixtures/audio/ESL+pain+mgmt+sample.wav
node scripts/<vad_segmentation_benchmark>.cjs tests/fixtures/audio/ESL-Cardio-sample.wav
```

Decision point:
- if VAD materially reduces duplication/omission without hurting latency, it becomes a candidate for the default websocket runtime

### Phase 4: reconciliation value

```bash
node scripts/test_stt_matrix.cjs tests/fixtures/audio/ESL+pain+mgmt+sample.wav tests/fixtures/audio/ESL-Cardio-sample.wav
node scripts/<reconciliation_benchmark>.cjs tests/fixtures/audio/ESL+pain+mgmt+sample.wav
```

Measure:
- whether the secondary clinical transcript improves medication and clinical-term recall
- whether hybrid reconciliation reduces false positives or transcript drift
- whether the gain is large enough for live latency budgets

### Phase 5: speaker attribution

```bash
node scripts/<speaker_attribution_benchmark>.cjs tests/fixtures/audio/ESL+pain+mgmt+sample.wav
node scripts/<speaker_attribution_benchmark>.cjs tests/fixtures/audio/ESL-Cardio-sample.wav
```

Measure:
- doctor vs patient separation quality
- ambiguous/mixed speaker count
- additional latency and operational cost

## Outputs

Expected artifacts:
- JSON reports under `tests/results/`
- per-chunk transcripts and latency summaries
- a decision memo on:
  - default chunking mode
  - whether to enable VAD by default
  - whether to enable diarization by default
  - whether the secondary clinical STT path/reconciliation remain on the live critical path

## Pass / Fail Gates

### Keep the current fixed-window runtime if
- first useful transcript arrives quickly enough for the UI
- medication and dosage lines survive chunk boundaries acceptably
- duplication/omission is manageable without heavy cleanup

### Enable VAD by default if
- it materially improves transcript continuity
- it does not meaningfully delay first transcript or average chunk completion
- the team has chosen one canonical VAD asset path

### Keep secondary STT + reconciliation in the live path if
- they materially improve medication, order, or diagnosis recall
- the added latency remains acceptable for live use

### Keep diarization optional if
- attribution quality remains too ambiguous
- runtime/cost overhead is high relative to the UI value

## Recommended Follow-up After Testing

Choose one concrete operating mode for the websocket runtime:

1. Fixed windows, no VAD, no diarization
2. Overlapping windows, no VAD, no diarization
3. VAD-enabled chunking, no diarization
4. VAD-enabled chunking with diarization

Then wire that choice into `server/live_conversation_websocket.cjs` so the production live path matches the benchmarked testing path.
