# Voice Intake Phase 2 Implementation Summary

## Date: 2026-05-21

## Overview

Phase 2 is now the active voice runtime in this repository. The product supports uploaded physician dictation audio, transcribes it through a swappable STT boundary, extracts structured clinical content with `VoiceExtractorAgent`, and opens the result through the same dashboard route used by PDFs. In the current workspace Gemini STT is active; the intended architecture keeps Whisper as the primary STT target with Gemini as fallback.

The important current-state change is status truthfulness:

- voice `processed` means the stored result is dashboard-ready and renderable
- incomplete voice payloads are downgraded to `failed`
- stale stored voice extractions are rejected and recomputed instead of silently rendering a blank dashboard

## Current Runtime Path

### Primary user flow

1. Upload audio through `POST /api/voice/upload`.
2. Persist a voice session in `server/storage/voice_sessions.json`.
3. Create a matching voice row in the unified queue at `server/storage/documents.json`.
4. The frontend immediately calls `POST /api/voice/process`.
5. The active STT backend creates normalized transcript segments and transcript quality metadata.
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

### Shared dashboard flow

Voice and PDF records both open through:

```text
/dashboard?documentId=<id>
```

The dashboard page and queue now contain defensive voice checks so invalid processed voice records show an explicit unavailable/error state instead of a blank screen.

## Current Components

### Backend

- `server/index.cjs`
  - voice upload, retrieval, review, extraction, queue, and SSE routes
  - voice-session hydration into the shared documents queue
  - stale voice result reuse checks
- active STT tool in the current workspace:
  - `tools/llm/gemini_audio_transcription.tool.cjs`
  - future architecture direction: Whisper primary, Gemini fallback
- `server/voice_result_validation.cjs`
  - central validator for voice dashboard readiness
  - shared by direct processing, reused-session hydration, and SSE processing

### Agents and skills

- `agents/voice_extractor_agent.cjs`
  - orchestrates voice extraction across transcript-driven clinical categories
- voice extraction skills currently used by the voice agent include:
  - medications
  - diagnosis
  - clinical extraction
  - demographics
- `skills/clinical/dashboard_mapper.skill.cjs`
  - maps voice extraction output into the shared dashboard card schema

### Frontend

- `src/components/voice/VoiceDictationWorkspace.tsx`
  - uploads audio
  - auto-starts voice processing after upload
  - surfaces transcript review items and extraction preview
- `src/pages/UploadCenter.tsx`
  - shows voice and PDF documents in the same queue
  - blocks `View` for voice items whose stored payload is not dashboard-ready
- `src/pages/Index.tsx`
  - shows an explicit unavailable/error state for invalid voice dashboard payloads
- `src/lib/processedDocuments.ts`
  - mirrors the backend voice readiness check for UI guardrails

## Data Flow

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

## Storage Model

Voice state is file-backed under `server/storage/`:

- `voice_sessions.json`: session lifecycle, transcript-derived state, review items, extraction preview, stored extraction
- `voice_reviews.json`: review actions and voice workflow events
- `voice_audio/`: uploaded audio binaries
- `voice_transcripts/`: normalized transcript payloads written after STT
- `voice_graph_checkpoints/`: reserved checkpoint area for future resumable orchestration
- `documents.json`: unified queue and dashboard entry point for both PDF and voice records

## Status Semantics

| Status | Meaning |
|--------|---------|
| `queued` | uploaded but not yet transcribed |
| `transcribing` | STT in progress |
| `extracting` | structured extraction in progress |
| `review_required` | extraction completed but unresolved review items remain |
| `processed` | stored voice result passed dashboard-readiness validation |
| `failed` | transcription failed or extraction completed without a usable dashboard payload |

## Validation And Reuse Rules

The server now applies one shared readiness rule everywhere voice results can be reused or surfaced:

1. `publicDocument(...)` fails closed for invalid voice payloads.
2. `applyVoiceSessionToDocument(...)` only hydrates a document from persisted voice extraction if the stored result is still renderable.
3. `resolveVoiceDocumentProcessing(...)` rejects stale or incomplete persisted voice extraction and recomputes it.
4. `POST /api/voice/process` only persists `processed` for validated voice results.
5. `GET /api/documents/process/progress` only emits final voice success if the result passes validation.

Validation currently requires:

- a result object
- `dashboard_cards`
- `extracted_data`
- at least one meaningful clinical section such as diagnosis, medications, vitals, labs, radiology, treatment, notes, follow-up, or discharge content

## Manual And Legacy Paths

The repository still contains older/manual routes:

- `POST /api/voice/:id/add-to-queue`
- `POST /api/voice/extract`

Those remain useful for manual recovery or legacy review-driven workflows, but the primary current UI path is:

```text
upload -> auto-process -> queue row already present -> open shared dashboard
```

## Known Gaps

- the current voice path is not yet a full resumable LangGraph StateGraph runtime
- the current workspace still lacks a checked-in `WhisperTranscriptionTool`, even though the architecture is being kept ready for Whisper-primary / Gemini-fallback operation
- review-resolution semantics are still simpler than a full human-in-the-loop interrupt/resume workflow
- some planning docs in this directory still reflect earlier phase assumptions and should be treated as historical context
