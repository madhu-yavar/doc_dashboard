# ReAct + Voice Architecture Diagrams

**Version:** 3.1.0
**Last Updated:** 2026-05-26

> Current runtime note
> The repository now has three active intake shapes: PDF upload, uploaded voice dictation, and live conversation streaming. PDFs still use the ReAct document router path. Uploaded dictation uses the validated voice extraction path. Live conversation now has an implemented session runtime, but its finalize-to-dashboard publication is still lighter than the dictation contract.

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                               DOCTOR DASHBOARD CURRENT RUNTIME                              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

  FRONTEND
  ┌────────────────────────────┐
  │ Upload Center             │
  │  • Documents workspace    │
  │  • Voice / Dictation      │
  │  • Voice / Live session   │
  └──────────────┬─────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────────────────────────────────────────────────────────┐
  │                                      EXPRESS API                                         │
  │  /api/documents/*   /api/voice/*   /api/voice/live/*   /api/chat/*   /api/analytics/*  │
  └──────────────┬───────────────────────────────┬───────────────────────────────┬──────────┘
                 │                               │                               │
                 │                               │                               │
                 ▼                               ▼                               ▼
      PDF Intake Path                  Uploaded Dictation Path           Live Conversation Path
```

## PDF Intake Path

```text
PDF upload
  -> DocumentTypeRouter
     -> rule-based or agentic classification
     -> specialized extractor agent
  -> extraction skills + validation skills
  -> dashboard mapping
  -> documents.json
  -> /dashboard?documentId=<id>
```

```text
┌──────────────────────────┐
│ DocumentTypeRouter       │
│  • classify document     │
│  • route to specialist   │
└──────────────┬───────────┘
               ▼
┌──────────────────────────┐
│ ReAct extractor agent    │
│  • THINK                 │
│  • ACT                   │
│  • OBSERVE               │
└──────────────┬───────────┘
               ▼
┌──────────────────────────┐
│ Shared dashboard payload │
└──────────────────────────┘
```

## Uploaded Dictation Path

```text
Audio upload
  -> POST /api/voice/upload
  -> voice_sessions.json + documents.json row
  -> POST /api/voice/process
  -> STT boundary
  -> normalized transcript segments + transcript quality
  -> VoiceExtractorAgent
  -> DashboardMapperSkill
  -> buildVoiceDocumentResult(...)
  -> validateVoiceDashboardResult(...)
  -> review_required | processed | failed
  -> /dashboard?documentId=<id>
```

```text
┌──────────────────────────────┐
│ Uploaded dictation STT       │
│  Implemented proprietary path│
│  Backend remains pluggable   │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ VoiceExtractorAgent          │
│  • transcript-aware extract  │
│  • review item generation    │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ Shared voice dashboard       │
│  • dashboard_cards           │
│  • extracted_data            │
│  • presentation              │
└──────────────────────────────┘
```

## Live Conversation Streaming Path

```text
Microphone
  -> MediaRecorder
  -> WS /api/voice/live/sessions/:sessionId/stream
  -> LiveConversationWebSocket
  -> chunk buffer + temp chunk file
  -> LiveConversationSTTAgent
  -> transcript.final events + persisted session snapshot
  -> periodic draft note extraction
  -> review_required | finalized | failed
  -> POST /api/voice/live/sessions/:sessionId/finalize
  -> voice-live-* row in documents.json
  -> full validated dashboard publication still pending
```

```text
┌──────────────────────────────┐
│ Browser capture              │
│  • mic permission            │
│  • device selection          │
│  • MediaRecorder chunks      │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ LiveConversationWebSocket    │
│  • auth                      │
│  • chunk buffering           │
│  • transcript events         │
│  • draft extraction timer    │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ LiveConversationSTTAgent     │
│  • primary chunked STT       │
│  • secondary clinical shadow │
│  • proprietary reconciliation│
│  • optional fallback path    │
│  • optional VAD/diarization  │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ Live session draft state     │
│  • transcript                │
│  • note draft                │
│  • review items              │
└──────────────────────────────┘
```

## Live Session Lifecycle

```text
draft
  -> live
     -> paused
        -> live
     -> review_required
        -> finalized
        -> failed
```

```text
draft            session exists but capture has not started
live             mic + websocket + chunk transcription active
paused           capture paused, session still open
review_required  session ended, review items can block finalize
finalized        session closed and points to a voice-live-* document row
failed           recording, websocket, or transcription failure
```

## Shared Storage And Publication Contract

```text
server/storage/
  ├─ documents.json
  │   ├─ PDF queue rows
  │   ├─ uploaded dictation queue rows
  │   └─ live conversation voice-live-* rows
  ├─ voice_sessions.json
  ├─ voice_reviews.json
  ├─ voice_audio/
  ├─ voice_transcripts/
  ├─ live_conversation_sessions.json
  ├─ live_conversation_events.jsonl
  └─ live_conversation_checkpoints/
```

```text
Publication contract today:

PDF
  -> shared dashboard route

Uploaded dictation
  -> shared dashboard route after dashboard validation

Live conversation
  -> session finalize creates a queue row
  -> shared dashboard mapping/validation still needs to be wired
```

## Current Architectural Gaps

- live finalize does not yet reuse `buildVoiceDocumentResult(...)`
- live finalize does not yet pass `validateVoiceDashboardResult(...)`
- the live client still relies mainly on REST polling for session hydration, even though transcript and draft websocket events already exist
- the live websocket runtime currently keeps VAD, diarization, and validation disabled by default
