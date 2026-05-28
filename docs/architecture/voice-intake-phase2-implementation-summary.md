# Voice Intake Current Implementation Summary

## Date: 2026-05-26

## Overview

Voice is now a two-lane runtime in this repository:

1. uploaded physician dictation
2. live doctor-patient conversation

Uploaded dictation is the mature shared-dashboard path. It transcribes audio, runs `VoiceExtractorAgent`, maps into the shared dashboard contract, validates renderability, and only then exposes the result as `processed`.

Live conversation is now implemented as a parallel session runtime inside `/upload?workspace=voice&mode=live`. It supports microphone capture, websocket audio streaming, rolling transcript persistence, draft note extraction, review, and finalize. The important caveat is publication fidelity: the current live finalize step creates a lightweight `voice-live-*` row in `documents.json`, but it does **not** yet reuse the same `buildVoiceDocumentResult(...)` + `validateVoiceDashboardResult(...)` contract that uploaded dictation uses.

## Current Runtime Paths

### 1. Uploaded dictation flow

1. Upload audio through `POST /api/voice/upload`.
2. Persist a voice session in `server/storage/voice_sessions.json`.
3. Create a matching voice row in the unified queue at `server/storage/documents.json`.
4. The frontend immediately calls `POST /api/voice/process`.
5. The active STT backend produces normalized transcript segments and transcript quality metadata.
6. `agents/voice_extractor_agent.cjs` produces:
   - `extractedData`
   - `dashboardPayload`
   - `reviewItems`
7. `buildVoiceDocumentResult(...)` maps voice extraction into the shared dashboard contract:
   - `dashboard_cards`
   - `sample_patient_data`
   - `presentation`
   - `meta`
   - `extracted_data`
8. `server/voice_result_validation.cjs` validates that the stored voice result has renderable clinical content.
9. The session and queue document finish as:
   - `review_required` if pending review items remain
   - `processed` if the dashboard payload is renderable
   - `failed` if transcription fails or extraction completes without a usable dashboard payload

### 2. Live conversation flow

1. Open the live workspace through `/upload?workspace=voice&mode=live`.
2. Create or resume a live session through `/api/voice/live/sessions`.
3. Persist session state in `server/storage/live_conversation_sessions.json`.
4. Start browser microphone capture with `MediaRecorder` from `src/hooks/useLiveConversationAudio.ts`.
5. Stream binary audio chunks over `WS /api/voice/live/sessions/:sessionId/stream`.
6. `server/live_conversation_websocket.cjs` buffers chunks, flushes them into temp files, and calls `agents/live_conversation_stt_agent.cjs`.
7. The current websocket runtime uses:
   - fixed-window chunking
   - ~3 second buffer flushes
   - 5 second transcription windows
   - diarization disabled
   - validation skipped during live chunk transcription
8. The live STT agent still has broader capabilities available behind that conservative runtime:
   - primary proprietary chunked transcript
   - secondary clinical shadow transcript
   - proprietary reconciliation
   - optional proprietary fallback
   - optional VAD segmentation
   - optional speaker diarization
9. Final transcript segments are persisted back into the live session and surfaced in the live UI.
10. A timer-based draft extraction step uses a proprietary reasoning service to populate note sections such as assessment, history, medications, orders, and plan.
11. The session progresses through `draft -> live -> paused -> review_required -> finalized | failed`.
12. `POST /api/voice/live/sessions/:sessionId/finalize` creates `voice-live-${session.id}` in `documents.json`.
13. That published row currently contains transcript and extracted data, but it is not yet promoted into the same validated dashboard contract as uploaded dictation.

### Shared dashboard flow

Uploaded dictation and PDFs both open through:

```text
/dashboard?documentId=<id>
```

The queue and dashboard already fail closed for invalid processed voice payloads. That means the current lightweight live-finalize document will be treated defensively until it is upgraded to the shared voice dashboard contract.

## Current Components

### Backend

- `server/index.cjs`
  - uploaded dictation routes
  - live conversation route registration
  - shared queue/document access
  - dashboard-readiness validation for published voice records
- `server/live_conversation_routes.cjs`
  - create/list/get/patch/pause/resume/review/finalize/delete live sessions
  - event history endpoint
  - current lightweight finalize-to-document behavior
- `server/live_conversation_websocket.cjs`
  - websocket authentication
  - audio chunk buffering
  - transcript emission
  - periodic draft extraction
- `server/live_conversation_store.cjs`
  - live session persistence
  - live event log persistence
- `server/voice_result_validation.cjs`
  - shared validator for dashboard-ready voice queue records

### Agents and skills

- `agents/voice_extractor_agent.cjs`
  - uploaded-dictation extraction path
- `agents/live_conversation_stt_agent.cjs`
  - chunked live STT orchestration with primary/secondary transcription, reconciliation, optional VAD, optional diarization, and optional fallback
- `skills/clinical/dashboard_mapper.skill.cjs`
  - shared dashboard card mapper used by the uploaded-dictation path
- live draft note extraction currently happens directly inside `server/live_conversation_websocket.cjs`
  - this is separate from `VoiceExtractorAgent`
  - it is intentionally lighter-weight than the uploaded-dictation extraction path

### Frontend

- `src/components/voice/VoiceDictationWorkspace.tsx`
  - upload-first dictation UI
- `src/components/voice/LiveConversationWorkspace.tsx`
  - live conversation shell with visits rail, transcript, encounter panel, note panel, and review panel
- `src/hooks/useLiveConversationAPI.ts`
  - REST lifecycle actions and polling hydration for live sessions
- `src/hooks/useLiveConversationAudio.ts`
  - microphone permissions, device selection, `MediaRecorder`, websocket streaming
- `src/pages/UploadCenter.tsx`
  - shared documents + voice intake workspace
- `src/lib/processedDocuments.ts`
  - mirrors backend voice guardrails so incomplete published voice payloads fail closed in the UI

## Data Flow

### Uploaded dictation

```text
Audio file
  -> /api/voice/upload
  -> voice_sessions.json + documents.json row created
  -> /api/voice/process
  -> STT backend
  -> normalized transcript segments + transcript quality
  -> VoiceExtractorAgent
  -> dashboard mapper
  -> validateVoiceDashboardResult(...)
  -> processed | review_required | failed
  -> /api/documents/:id
  -> shared dashboard route
```

### Live conversation

```text
Microphone
  -> MediaRecorder
  -> WS /api/voice/live/sessions/:id/stream
  -> LiveConversationWebSocket
  -> temp chunk file
  -> LiveConversationSTTAgent
  -> transcript.final + persisted session snapshot
  -> draft extraction timer
  -> review_required | finalized | failed
  -> lightweight voice-live-* document row on finalize
  -> full dashboard contract still pending
```

## Storage Model

Voice state is file-backed under `server/storage/`:

- `voice_sessions.json`: uploaded-dictation lifecycle, review items, extraction preview, stored extraction
- `voice_reviews.json`: uploaded-dictation review actions and workflow events
- `voice_audio/`: uploaded dictation binaries
- `voice_transcripts/`: normalized dictation transcript payloads written after STT
- `voice_graph_checkpoints/`: reserved checkpoint area for future resumable orchestration
- `live_conversation_sessions.json`: live session lifecycle, transcript, draft note, review state, publication pointer
- `live_conversation_events.jsonl`: live session event log
- `live_conversation_audio/`: reserved live-session audio storage area
- `live_conversation_checkpoints/`: reserved live-session checkpoint area
- `documents.json`: unified queue and dashboard entry point for PDFs and published voice rows

## Status Semantics

### Uploaded dictation

| Status | Meaning |
|--------|---------|
| `queued` | uploaded but not yet transcribed |
| `transcribing` | STT in progress |
| `extracting` | structured extraction in progress |
| `review_required` | extraction completed but unresolved review items remain |
| `processed` | stored voice result passed dashboard-readiness validation |
| `failed` | transcription failed or extraction completed without a usable dashboard payload |

### Live conversation

| Status | Meaning |
|--------|---------|
| `draft` | session exists but capture has not started |
| `live` | microphone capture and websocket transport are active |
| `paused` | capture is paused but the session remains open |
| `review_required` | session ended and human review is required before finalize |
| `finalizing` | reserved UI state while finalize is in progress |
| `finalized` | live session is closed and points to a published `voice-live-*` document row |
| `failed` | websocket, recording, or transcription path failed |

## Validation And Publication Rules

The strict voice dashboard validation rules currently apply to the uploaded-dictation queue path:

1. `publicDocument(...)` fails closed for invalid published voice payloads.
2. `applyVoiceSessionToDocument(...)` only hydrates a document from persisted uploaded-dictation extraction if the stored result is still renderable.
3. `resolveVoiceDocumentProcessing(...)` rejects stale or incomplete uploaded-dictation extraction and recomputes it.
4. `POST /api/voice/process` only persists `processed` for validated uploaded-dictation voice results.
5. `GET /api/documents/process/progress` only emits final voice success if the uploaded-dictation result passes validation.

Validation currently requires:

- a result object
- `dashboard_cards`
- `extracted_data`
- at least one meaningful clinical section such as diagnosis, medications, vitals, labs, radiology, treatment, notes, follow-up, or discharge content

Live conversation finalize does **not** yet produce that shape. That is why live publication should still be treated as an in-progress integration rather than a finished shared-dashboard path.

## Manual And Legacy Paths

Older/manual uploaded-dictation routes still exist:

- `POST /api/voice/:id/add-to-queue`
- `POST /api/voice/extract`

Those remain useful for manual recovery or older review-driven dictation flows. The live conversation path is separate and uses `/api/voice/live/*`.

## Known Gaps

- live finalize does not yet reuse `buildVoiceDocumentResult(...)`
- live finalize does not yet pass through `validateVoiceDashboardResult(...)`
- the live client still relies mainly on periodic REST refresh rather than consuming all websocket transcript/draft events directly
- the default live websocket runtime still disables diarization, VAD, and live validation
- the overall voice platform is not yet a full resumable LangGraph `StateGraph` runtime
- some planning docs in this directory still reflect earlier pre-implementation assumptions and should be treated as historical context
