# Live Conversation Evaluation Matrix

## Purpose

This evaluation is the gate between "transport works" and "clinically usable live conversation."

The goal is to measure:

- transcript quality under live-style chunking
- medication and order safety
- chunk boundary stability
- speaker attribution quality
- review burden introduced by the pipeline

## Dataset Rule

Use deterministic lexical ordering for batch picks from:

`tests/fixtures/audio/audio_recordings/Audio_Recordings`

For the first batch, the first 10 files are:

1. `CAR0001.mp3`
2. `CAR0002.mp3`
3. `CAR0003.mp3`
4. `CAR0004.mp3`
5. `CAR0005.mp3`
6. `DER0001.mp3`
7. `GAS0001.mp3`
8. `GAS0002.mp3`
9. `GAS0003.mp3`
10. `GAS0004.mp3`

## Exact Test Matrix

| Variant | Purpose | VAD | Diarization | Validation | Expected use |
|---|---|---:|---:|---:|---|
| `whisper_direct` | Raw transcript baseline | No | No | No | Wording and latency baseline |
| `medasr_direct` | Medical transcript baseline | No | No | No | Clinical term baseline |
| `live_fixed` | Naive live chunking baseline | No | No | Skipped | Detect chunk-boundary regressions |
| `live_vad` | Live chunking with speech-only segmentation | Yes | No | Skipped | Measure VAD value |
| `live_vad_diarized` | Candidate v1 live pipeline | Yes | Yes | Yes | Main go/no-go path |

## Automatic Metrics To Record

For each file and variant, capture:

- `success`
- `latencyMs`
- `durationSeconds`
- `transcriptLength`
- `backend`
- `totalChunks`
- `successfulChunks`
- `failedChunks`
- `timeToFirstTranscriptMs`
- `averageChunkLatencyMs`
- `validationRecommendation`
- `validationConfidence`
- `reviewItemCount`
- `diarizationBackend`
- `speakerCount`
- `error`

## Manual Scoring Template

Manual scoring is required at minimum for `live_vad_diarized`.

Score each category from `1` to `5`:

- `Transcript readability`
- `Medication accuracy`
- `Diagnosis and symptom capture`
- `Orders and follow-up capture`
- `Speaker attribution`
- `Chunk boundary integrity`

Interpretation:

- `5`: clinically strong, low reviewer burden
- `4`: usable with minor review
- `3`: mixed quality, significant review needed
- `2`: frequent errors, unsafe without deep correction
- `1`: unusable

Also record:

- `Publish safe`: `yes` or `no`
- `Reviewer notes`

## Go / No-Go Gates

The candidate pipeline is `live_vad_diarized`.

Recommended gate:

- `timeToFirstTranscriptMs <= 4000`
- `failedChunks = 0` or clearly recoverable
- `Medication accuracy >= 4`
- `Speaker attribution >= 3`, or speaker role remains conservatively `unknown`
- `Chunk boundary integrity >= 4`
- `Publish safe = no` is acceptable for v1
- `Review safe = yes` is the real bar for v1

## Commands

Run the full first-10 batch:

```bash
node scripts/evaluate_live_conversation_matrix.cjs \
  --dir tests/fixtures/audio/audio_recordings/Audio_Recordings \
  --limit 10 \
  --variants whisper_direct,medasr_direct,live_fixed,live_vad,live_vad_diarized \
  --diarization-provider pyannote
```

Run a lighter screening pass:

```bash
node scripts/evaluate_live_conversation_matrix.cjs \
  --dir tests/fixtures/audio/audio_recordings/Audio_Recordings \
  --limit 10 \
  --variants whisper_direct,medasr_direct,live_vad_diarized \
  --diarization-provider pyannote
```

## Output Artifacts

The batch runner writes:

- JSON summary report in `tests/results/`
- CSV scoring template in `tests/results/`

The CSV is pre-seeded for the `live_vad_diarized` rows because that is the main manual review target.
