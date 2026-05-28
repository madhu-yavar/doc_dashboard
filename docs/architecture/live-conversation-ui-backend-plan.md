# Live Conversation UI + Backend Fit Plan

## Date
2026-05-26

## Purpose
Capture the current implementation fit and remaining work for **live doctor-patient conversation** inside the existing repository, without introducing a parallel product stack.

This plan is intentionally aligned to:
- the existing `/upload` intake workspace
- the current `/api/voice/*` backend area
- cookie-based auth via `AuthService`
- the shared processed-document dashboard route at `/dashboard?documentId=<id>`
- the current Express/CommonJS + file-backed persistence model

## Current Repo Constraints

### Frontend
- `src/pages/UploadCenter.tsx` already owns the `workspace` and `mode` query-state for the shared intake page.
- `src/components/voice/VoiceDictationWorkspace.tsx` is the existing upload-first voice UI.
- `src/components/voice/LiveConversationWorkspace.tsx` now exists as the live transcript-first shell.
- `src/hooks/useLiveConversationAPI.ts` and `src/hooks/useLiveConversationAudio.ts` split REST snapshot hydration from browser audio transport.
- The dashboard already knows how to open a validated processed voice document through the same route as PDFs.

### Backend
- `server/index.cjs` exposes both uploaded dictation and live-conversation APIs under `/api/voice`.
- The server now boots through `http.createServer(...)` and attaches `LiveConversationWebSocket`.
- `server/live_conversation_routes.cjs` owns live session lifecycle endpoints.
- `server/live_conversation_websocket.cjs` owns websocket auth, chunk buffering, transcript events, and periodic draft extraction.
- `server/live_conversation_store.cjs` persists sessions and audit-style events in dedicated `live_conversation_*` files under `server/storage/`.
- `agents/live_conversation_stt_agent.cjs` already supports a primary proprietary chunked transcription path, secondary clinical shadow transcription, reconciliation, optional speaker attribution, VAD segmentation, and an optional proprietary fallback path.
- The current websocket path still uses a conservative runtime profile:
  - fixed-window chunking
  - no VAD in the default live path
  - no speaker diarization in the default live path
  - validation skipped during live chunk transcription
- Auth is already enforced for `/api/*` and websocket session access via the same cookie-backed request authentication.

### Product Reality
- Voice now has **two active product shapes**:
  - uploaded dictation
  - live conversation
- The repo now contains browser microphone capture via `MediaRecorder`, device enumeration, and websocket audio transport.
- The live path already supports draft, live, paused, review-required, finalized, and failed session states.
- The remaining gap is publication fidelity: live finalize currently creates a lightweight `voice-live-*` queue row, but it does **not** yet publish the same validated dashboard payload that uploaded dictation uses.

## Current Implementation Status

### Implemented now
- live session creation, list, get, patch, pause, resume, review, finalize, delete, and event-history endpoints
- websocket audio transport at `WS /api/voice/live/sessions/:sessionId/stream`
- rolling transcript persistence under `live_conversation_sessions.json`
- timer-based draft note extraction during active sessions
- review UI and finalize action inside the Voice workspace

### Still incomplete
- the live finalize path does not yet reuse `buildVoiceDocumentResult(...)`
- finalized live sessions are not yet validated through `validateVoiceDashboardResult(...)`
- the frontend currently relies mainly on periodic REST refresh for transcript and draft hydration, even though the websocket emits transcript and draft events

## Recommended Product Shape

### Primary recommendation
Add live conversation as a **second mode inside the existing Voice workspace**, not as a new top-level page.

Why this fits best:
- users already go to `/upload` for intake workflows
- the current voice area already has the right mental model
- it keeps dictation and conversation under one product surface
- it reduces routing, auth, and navigation churn

### UX principle
Treat a live conversation session as a **draft workspace**, not as a processed document.

That means:
- a live session exists before any dashboard document exists
- the session has its own lifecycle, transcript, and draft extraction state
- `Finalize` is the only point where a `documents.json` row is created

That is still the cleanest fit with the existing dashboard contract, even though the current finalize implementation has not yet been upgraded to the full validated voice document shape.

## Information Architecture

### `/upload` page structure
- Keep `/upload` as the shared intake page.
- Use a **left workspace rail** with:
  - `Documents`
  - `Voice`
- Keep `Voice` as a single workspace entry in the rail. Do **not** show always-visible `Dictation` / `Live conversation` controls beside it.
- Switch voice modes from a **single compact control inside the Voice workspace header**. The user already knows they are in Voice; mode choice should not compete with the main workspace navigation.

### Live navigation behavior
The live conversation screen should use a compact left rail labeled `Visits`:
- `In progress`
- `Completed`
- `Interrupted`

The user resumes or reviews work by selecting a visit row.

Avoid showing both `New session` and `Start session` at the same time for the active draft visit. That felt redundant in UI review.

`Create new visit` should remain available as a secondary icon action when the current visit is already in `review_required`, `finalizing`, `finalized`, or `failed` state.

Phase 1 can keep this inside the `Voice` workspace. A dedicated route is not required initially.

### URL state
Recommended query params for resilience:
- `/upload?workspace=voice&mode=live`
- `/upload?workspace=voice&mode=live&sessionId=<id>`

This is worth doing early because live sessions are long-lived and refresh recovery matters.

## UI Plan

### Core screen flow

#### 1. Voice workspace entry
The user enters `Voice` from the left workspace rail.

Inside the voice workspace:
- a single `Mode` control switches `Dictation` vs `Live conversation`
- the rest of the screen is dedicated to the chosen mode

This keeps navigation quiet and reduces the number of visible toggles.

#### 2. Encounter prep
The live conversation screen opens with a transcript-first shell.

The right panel contains an `Encounter` section with:
- patient link
- encounter link
- microphone permission state
- input device selection

The primary action is:
- `Start`

There is no separate checklist card in the current UI. Readiness is conveyed through compact field state and badges.

#### 3. Starting
The UI shows:
- session status changes
- transport state
- mic initialization
- inline error state if permission or connection fails

#### 4. Live capture
The live mode now follows a **doctor-facing 3-zone layout**:

1. `Visits rail`
- compact left rail for in-progress, completed, and interrupted visits
- selecting a visit restores its current draft, review, or published state
- historical sections are collapsed by default

2. `Encounter header + Transcript`
- encounter title
- patient / encounter context
- status, duration, connection badges
- `Start`, `Pause`, `Resume`, `End`
- rolling transcript as the primary working surface
- speaker chips: `Doctor`, `Patient`, `Unknown`
- interim vs finalized styling
- low-confidence flags
- reconnect gap markers

3. `Encounter / Note / Review accordion`
- `Encounter`: patient, visit context, mic/device
- `Note`: note-style summary instead of feature cards
- `Review`: blocking review items and finalize action

The current note panel is intentionally closer to ambient documentation products than to a dashboard of cards. It reads as:
- `Assessment`
- `History`
- `Medications`
- `Orders`
- `Plan`

#### 5. Paused / reconnecting
The transcript remains visible.

State remains visible through compact status badges and inline error surfaces rather than large instructional banners.

The UI must not look like the session was lost unless it actually ended.

#### 6. Review and finalize
When the user ends the session:
- freeze transcript edits
- run final reconciliation
- surface a review queue for ambiguous content
- allow `Finalize to dashboard` only when blocking review items are resolved

#### 7. Published
After finalize:
- show `Open dashboard`
- show `Back to voice workspace`
- preserve the visit as a historical record in the `Completed` section

## Current UI Baseline

As of 2026-05-26, the implemented live UI shell is:
- left rail workspace entry for `Voice`, not nested voice tabs
- one `Mode` menu inside the voice workspace
- `Visits` rail on the left
- encounter/status/transcript in the center
- compact `Encounter`, `Note`, `Review` accordion on the right
- reduced explanatory copy and fewer competing actions

This is the UI shape the backend contract should now target.

## Recommended Frontend Structure

### Current implementation-aligned components
- `src/pages/UploadCenter.tsx`
  - owns the workspace rail and `workspace` query state
- `src/components/voice/VoiceWorkspace.tsx`
  - owns the compact `Mode` switch for `Dictation` vs `Live conversation`
- `src/components/voice/LiveConversationWorkspace.tsx`
  - owns the live transcript-first shell
- `src/hooks/useLiveConversationAPI.ts`
  - owns live session lifecycle, review/finalize actions, and polling hydration
- `src/hooks/useLiveConversationAudio.ts`
  - owns `MediaRecorder`, device enumeration, and websocket audio transport
- `server/live_conversation_routes.cjs`
  - owns `/api/voice/live/*` REST lifecycle
- `server/live_conversation_websocket.cjs`
  - owns chunk buffering, transcript emission, and draft extraction timers
- `server/live_conversation_store.cjs`
  - owns dedicated live session persistence

### Refactor guidance
The current single-file live workspace is acceptable for UI iteration.

Later, if backend wiring increases complexity, split into subcomponents such as:
- `LiveConversationVisitList`
- `LiveConversationControlBar`
- `LiveConversationTranscriptPanel`
- `LiveConversationEncounterPanel`
- `LiveConversationNotePanel`
- `LiveConversationReviewPanel`

The current implementation has already moved past mock-state-only UI. If client complexity keeps growing, consolidate transport, polling, transcript, and finalize state under a reducer-backed controller rather than adding more scattered `useState` branches.

The state machines that still need to stay coherent are:
- recorder state
- websocket state
- transcript state
- draft extraction state
- finalization state

### React Query recommendation
Best fit for this repo:
- keep active live session state in custom hooks
- keep REST snapshot loading simple while the websocket transport remains session-specific
- introduce React Query later only if history caching or invalidation becomes hard to reason about

Do **not** make the websocket event loop depend on React Query cache mutation from day one. That adds complexity without matching the current voice UI style.

## UI Implementation Matrix

This table reflects the **current UI shape** so backend work is planned against the interaction model users will actually see.

| Area | Component / UI element | UI type | What user does | Functionality | Frontend state involved | Backend API / event | Priority |
|---|---|---|---|---|---|---|---|
| Workspace navigation | `Documents` / `Voice` | Left workspace rail | Switch workspace | Moves user between document intake and voice workflows in `/upload` | `workspace` URL/query state | None | P1 |
| Voice mode | `Mode` menu | Compact dropdown menu | Switch mode | Separates upload-first dictation from live conversation without permanent nested toggles | `mode` URL/query state | None | P1 |
| Visits rail | `In progress` visit rows | Compact left rail list | Open current visit | Restores the selected draft/live/review visit | `selectedSessionId`, `session.status` | `GET /api/voice/live/sessions/:id` | P1 |
| Visits rail | `Completed` disclosure | Collapsible history section | Review published visits | Shows finalized visits without crowding the default UI | session history state | `GET /api/voice/live/sessions` | P2 |
| Visits rail | `Interrupted` disclosure | Collapsible history section | Recover failed work | Shows interrupted visits needing retry or review | session history state | `GET /api/voice/live/sessions` | P2 |
| Visits rail | `Create new visit` | Icon button | Start a new visit after closing the current one | Creates a new draft visit without competing with the active `Start` action | `sessionId`, `session.status` | `POST /api/voice/live/sessions` | P2 |
| Encounter | Patient control | Search/select or text input | Link patient | Associates the live visit with patient context | `session.linkedPatient` | `POST /api/voice/live/sessions` or patch later | P1 |
| Encounter | Encounter control | Search/select or text input | Link encounter | Associates encounter/workflow context | `session.encounterLabel` | `POST /api/voice/live/sessions` or patch later | P1 |
| Encounter | Mic permission badge | Status badge | Check readiness | Shows whether mic access is granted/denied/unknown | `recorder.permission` | Browser media permission only | P1 |
| Encounter | Input device selector | Dropdown | Choose mic | Selects capture device | `recorder.deviceId` | None | P1 |
| Control bar | `Start` | Primary button | Begin live recording | Starts mic capture and websocket session | `recorder.captureState`, `transport.connectionState`, `session.status` | `WS /api/voice/live/sessions/:id/stream` | P1 |
| Control bar | `Pause` | Secondary button | Pause capture | Temporarily stops sending audio without closing session | `recorder.captureState = paused`, `session.status = paused` | `POST /api/voice/live/sessions/:id/pause` or websocket `session.pause` | P1 |
| Control bar | `Resume` | Secondary button | Resume capture | Restarts audio streaming after pause | `recorder.captureState = recording`, `session.status = live` | `POST /api/voice/live/sessions/:id/resume` or websocket `session.resume` | P1 |
| Control bar | `End` | Primary button | End recording | Stops capture and transitions to review/finalization | `recorder.captureState = stopping`, `session.status` | websocket `session.end` | P1 |
| Control bar | Encounter status badges | Inline badges | Monitor visit | Shows status, duration, and connection state in one compact strip | `session.durationMs`, `transport.connectionState`, `session.status` | websocket `session.state` | P1 |
| Live capture | Elapsed time | Timer label | Monitor duration | Shows live session duration | `session.durationMs` | optional heartbeat/session state | P1 |
| Live capture | Connection state | Badge/pill | Monitor connection | Shows connected/reconnecting/error state | `transport.connectionState` | websocket `session.state` | P1 |
| Transcript | Transcript panel | Scrollable panel | Read transcript live | Displays rolling transcript as conversation unfolds | `transcript.segments`, `transcript.interimText` | websocket `transcript.partial`, `transcript.final` | P1 |
| Transcript | Transcript segment rows | Streamed text rows | Follow conversation | Shows segment-by-segment transcript | `transcript.segments` | websocket transcript events | P1 |
| Transcript | Speaker chips | Badge/chip | See attribution | Labels each segment as `Doctor`, `Patient`, or `Unknown` | segment speaker metadata | transcript normalization / diarization output | P1 |
| Transcript | Interim styling | Visual text state | Distinguish unstable text | Marks non-final transcript content | segment/interim flags | `transcript.partial` | P1 |
| Transcript | Final styling | Visual text state | Trust stable text | Marks stabilized transcript content | finalized segment flags | `transcript.final` | P1 |
| Transcript | Low-confidence flags | Warning badge/icon | Spot ambiguity | Highlights uncertain transcript spans | segment confidence / flags | transcript quality output | P1 |
| Transcript | Reconnect gap markers | Inline marker | Notice missing context | Shows likely missing audio/transcript gaps after reconnect | `transcript.hasGap` | connection + transcript events | P2 |
| Note panel | `Encounter` accordion section | Collapsible section | Review or edit visit metadata | Keeps patient/encounter/mic state visible without always occupying space | `session.linkedPatient`, `session.encounterLabel`, `recorder.*` | session snapshot + later patch API | P1 |
| Note panel | `Note` accordion section | Collapsible section | Review generated note summary | Shows draft note in clinical terms: assessment, history, medications, orders, plan | `draft.extractedData`, `draft.lastUpdatedAt` | websocket `draft.updated` | P2 |
| Note panel | Note review count | Badge/count | Monitor blockers | Shows unresolved review items without using a full dashboard card grid | `draft.reviewItems.length` | `draft.updated`, `review.item.created` | P2 |
| State handling | Paused / reconnecting / mic error states | Compact badges + inline error surface | Understand current state | Keeps the visit looking stable and in-progress rather than lost | `session.status`, `transport.connectionState`, `session.error`, `recorder.permission` | session state event | P1 |
| Review | Review queue | Review panel/list | Resolve ambiguities | Lists transcript/extraction items needing human review | `draft.reviewItems` | `GET /api/voice/live/sessions/:id`, review events | P2 |
| Review | Approve/edit/reject controls | Action buttons + text input | Resolve review item | Lets user confirm or edit ambiguous structured items | review item local edit state | `POST /api/voice/live/sessions/:id/review` | P2 |
| Review | Blocking review guard | Disabled state + helper text | Attempt finalize | Prevents finalize while blocking items remain | derived from review items | local + server validation | P2 |
| Finalization | `Finalize to dashboard` | Primary button | Publish session | Runs final reconciliation and creates processed document | `session.status = finalizing` | `POST /api/voice/live/sessions/:id/finalize` | P2 |
| Finalization | Finalizing progress state | Spinner/status | Wait for publish | Shows that final transcript + extraction + document creation are running | `session.status = finalizing` | finalize response / events | P2 |
| Published | `Open dashboard` | Button/link | Open final record | Opens `/dashboard?documentId=...` after successful publish | `documentId`, `session.status = finalized` | finalize response includes `documentId` | P2 |
| Published | `Back to voice workspace` | Secondary button | Return to list | Takes user back to live conversation workspace/history | route/query state | None | P2 |
| Published | Historical record row/view | Read-only view | Revisit session | Preserves finalized live session as history | session history state | `GET /api/voice/live/sessions` | P3 |

## UI Delivery Order

| Phase | UI scope |
|---|---|
| P1 | Workspace rail, quiet mode switch, visits rail, encounter shell, start/pause/resume/end, transcript shell |
| P2 | Note panel, review queue, finalize flow, open dashboard |
| P3 | Historical refinements, transcript-to-note evidence linking, richer recovery/admin polish |

## Key UI Dependencies

| UI feature | Backend dependency |
|---|---|
| `Start` | session creation + websocket handshake |
| Live transcript panel | `transcript.partial` and `transcript.final` websocket events |
| `Note` panel | incremental extraction + `draft.updated` events |
| Review queue | review item persistence + review API |
| `Finalize to dashboard` | final reconciliation + processed document creation |
| `Open dashboard` | finalize response returning `documentId` |

## Frontend State Model

Recommended local state shape:

```ts
type LiveConversationUiState = {
  sessionId: string | null;
  transport: {
    connectionState: "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";
    lastError: string | null;
    lastEventAt: string | null;
  };
  recorder: {
    permission: "unknown" | "granted" | "denied";
    deviceId: string | null;
    captureState: "idle" | "starting" | "recording" | "paused" | "stopping" | "failed";
    mimeType: string | null;
    chunkSequence: number;
  };
  session: {
    status: "draft" | "live" | "paused" | "review_required" | "finalizing" | "finalized" | "failed";
    linkedPatient: string;
    encounterLabel: string;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number;
  };
  transcript: {
    segments: LiveTranscriptSegment[];
    interimText: string;
    hasGap: boolean;
  };
  draft: {
    extractedData: Record<string, unknown> | null;
    reviewItems: LiveReviewItem[];
    lastUpdatedAt: string | null;
  };
};
```

## UI State Rules

### Important rules
- The live workspace should allow starting without a dashboard document.
- The `Open dashboard` action appears only after finalize creates a processed document.
- The user should be able to refresh the page and resume the same live session from `sessionId`.
- Pending transcript corrections should visibly supersede earlier interim text instead of appending duplicates.
- Ambiguous doctor/patient attribution must remain explicit in the UI.

### Speaker styling rule
Use color and label only. Do not imply certainty when diarization confidence is low.

Recommended labels:
- `Doctor`
- `Patient`
- `Unknown`

## Backend Plan

## API namespace
Best fit with the current server is to keep live conversation inside the existing voice area:

- `POST /api/voice/live/sessions`
- `GET /api/voice/live/sessions`
- `GET /api/voice/live/sessions/:id`
- `POST /api/voice/live/sessions/:id/pause`
- `POST /api/voice/live/sessions/:id/resume`
- `POST /api/voice/live/sessions/:id/finalize`
- `POST /api/voice/live/sessions/:id/review`
- `DELETE /api/voice/live/sessions/:id`
- `WS /api/voice/live/sessions/:id/stream`

This avoids fragmenting voice into multiple top-level backend domains.

## Transport recommendation

### Use websocket for live mode
Use websocket for:
- audio chunk upload
- transcript events
- extraction draft updates
- connection state / heartbeat

### Keep REST for lifecycle and recovery
Use REST for:
- create session
- list sessions
- fetch session snapshot after refresh
- review item resolution
- finalize
- delete / admin recovery

### Why not SSE-only
SSE is already present for processing progress, but it is one-way. Live conversation requires client-to-server audio transport, so SSE alone is not sufficient.

## Backend bootstrap change
To support websocket cleanly, change server startup from:
- `app.listen(PORT, ...)`

to:
- `const server = http.createServer(app)`
- attach websocket server to the same HTTP server
- `server.listen(PORT, ...)`

Recommended dependency: `ws`

This is the smallest architectural shift that matches the current Express setup.

## STT Strategy That Fits Current Tools

### Recommended phase 1 approach
Do **not** start by wiring directly to a vendor-specific full-duplex Live API.

Instead:
- receive short browser audio chunks over websocket
- persist chunks server-side
- batch them into rolling windows
- transcribe stable windows through a new adapter that can still call the current file-based STT tools

Why this fits best:
- current STT tools already accept file paths
- the rest of the voice pipeline already expects normalized transcript segments
- this minimizes the first architectural jump

### Phase 1 transcription adapter
Add a backend abstraction such as:

```ts
type LiveTranscriptionAdapter = {
  startSession(sessionId: string, options?: object): Promise<void>;
  appendChunk(sessionId: string, chunk: AudioChunk): Promise<void>;
  flushWindow(sessionId: string): Promise<NormalizedTranscriptWindow>;
  finalizeSession(sessionId: string): Promise<NormalizedTranscript>;
};
```

Under the hood in phase 1:
- chunks are assembled into short `.webm` or converted window files
- the adapter invokes the current proprietary file-based transcription path
- the backend emits `partial` and `final` transcript events to the UI

Later, the adapter can be swapped for a true streaming provider without changing the UI contract.

## Persistence Model

### New storage paths
- `server/storage/live_conversation_sessions.json`
- `server/storage/live_conversation_events.jsonl`
- `server/storage/live_conversation_audio/`
- `server/storage/live_conversation_transcripts/`
- `server/storage/live_conversation_checkpoints/`

### Session object

```ts
type LiveConversationSession = {
  id: string;
  status: "draft" | "live" | "paused" | "review_required" | "finalizing" | "finalized" | "failed";
  linkedPatient: string;
  encounterLabel: string;
  createdBy: { id: string; username: string; role: "doctor" | "admin" };
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  documentId: string | null;
  audio: {
    mimeType: string;
    chunkCount: number;
    combinedPath: string | null;
  };
  transcript: {
    segments: Array<object>;
    rawText: string;
    normalizedText: string;
    speakers: Array<object>;
    quality: object | null;
  };
  draftExtraction: {
    extractedData: object | null;
    reviewItems: Array<object>;
    lastStableSegmentId: string | null;
  };
  error: string | null;
};
```

## Session Lifecycle

### Recommended backend statuses
- `draft`
- `live`
- `paused`
- `review_required`
- `finalizing`
- `finalized`
- `failed`

Do not reuse the existing upload-first statuses exactly. Live mode has a different lifecycle.

## Websocket Event Contract

### Client -> server
- `audio.chunk`
- `session.pause`
- `session.resume`
- `session.end`
- `ping`

### Server -> client
- `session.ready`
- `session.state`
- `transcript.partial`
- `transcript.final`
- `draft.updated`
- `review.item.created`
- `review.item.updated`
- `session.finalizing`
- `session.finalized`
- `session.error`
- `pong`

### Event payload rule
All websocket messages should be JSON except binary audio chunk frames if binary transport is chosen.

If binary frames are used, keep one control message before each chunk with:
- `sequence`
- `mimeType`
- `durationMs`

## Incremental Extraction Plan

### Extraction trigger
Do not run full extraction on every chunk.

Recommended approach:
- accumulate finalized transcript segments
- every N stable seconds or M new finalized segments, run incremental extraction
- merge the draft result into session state

This reduces cost and UI thrash.

### Extraction output semantics
During the live session, mark everything as `draft`.

Only after final reconciliation should data be eligible for dashboard publication.

### Speaker-sensitive rules
- patient-attributed symptom statements can draft diagnoses context
- medication orders, procedures, and follow-up plans should not be promoted as confirmed unless doctor-attributed or explicitly reviewed
- uncertain speaker role should create a review item, not silent promotion

## Finalization Flow

When the user ends the session:

1. flush remaining audio
2. run final transcript normalization
3. resolve speaker roles one last time
4. run full extraction and reconciliation
5. build review items
6. block finalize if required review items remain unresolved
7. create the standard processed document row
8. write dashboard payload to the shared document format
9. return `documentId`

After that, the UI can open:
- `/dashboard?documentId=<id>`

## Shared Document Integration

### Key rule
Do not create a `documents.json` queue row at live-session start.

Create the document only when:
- final transcript exists
- final extraction passed validation
- blocking review is resolved

Why:
- the current dashboard contract expects a meaningful renderable result
- draft sessions are not queue documents yet
- this avoids half-processed live rows polluting the main queue

### Result mapping
Use the same voice result builder path already used for dictation wherever possible:
- normalized transcript
- extraction result
- dashboard mapper
- dashboard validation

## Auth and Access

### Role behavior
- `doctor`: create, run, resume, finalize own sessions
- `admin`: view, delete, recover, audit all sessions

### Websocket auth
Use the existing session cookie during websocket handshake.

The handshake should:
- validate the cookie
- attach `req.user`
- reject unauthenticated or unauthorized upgrades

### Asset access
Any recorded audio replay endpoints should use the same authenticated asset pattern already used elsewhere.

## Audit and Analytics

### Audit events
Add live conversation audit events for:
- session_created
- session_started
- microphone_connected
- chunk_received
- transcript_window_finalized
- extraction_draft_updated
- session_paused
- session_resumed
- websocket_reconnected
- review_item_resolved
- session_finalized
- session_failed

### Metrics
Track:
- average session duration
- average time-to-first-transcript
- average time-to-draft-update
- reconnect count per session
- review items per session
- finalize success rate

## Recommended Implementation Slices

Slices 1-3 are largely implemented in the current workspace. The biggest remaining work is Slice 4 publication fidelity and Slice 5 hardening.

### Slice 1: Session skeleton
- add storage bootstrap
- add REST session create/list/get/delete
- switch server bootstrap to shared HTTP server
- add websocket auth and heartbeat
- add UI encounter shell + start / pause / resume / end controls

Acceptance:
- a doctor can start a live session
- the UI survives reconnects
- the backend persists session state

### Slice 2: Audio ingest + rolling transcript
- stabilize browser `MediaRecorder` capture across devices
- send chunks over websocket
- persist chunks and rolling combined asset
- run micro-batch STT windows
- emit `transcript.partial` and `transcript.final`

Acceptance:
- transcript appears while recording
- refresh + resume works

### Slice 3: Draft extraction
- incremental extraction on stable transcript windows
- note panel updates in UI
- speaker-sensitive safety gating

Acceptance:
- medications / diagnosis / plan content updates inside the note panel during the session

### Slice 4: Review + finalize
- review queue UI
- final extraction reconciliation
- published live document creation
- dashboard-contract upgrade for live finalize
- `Open dashboard`

Acceptance:
- finalized session creates a renderable dashboard document

### Slice 5: Hardening
- failure recovery
- chunk deduplication
- session timeout handling
- better diarization policy
- retention / cleanup jobs
- admin audit views

## Testing Plan

### Frontend
- live session hook tests for session state transitions
- component tests for:
  - encounter panel
  - transcript rendering
  - compact reconnect / error state
  - finalize gating

### Backend
- websocket auth tests
- chunk ordering / dedupe tests
- transcript window assembly tests
- incremental extraction merge tests
- finalize-to-document integration tests

### End-to-end
- start session
- stream sample audio chunks
- receive transcript updates
- resolve review items
- finalize
- verify publication handoff, including the current lightweight live-document behavior

## Implementation Defaults To Keep

### Recommended defaults
- keep live conversation inside `/upload` -> `Voice`
- keep `Voice` as one left-rail entry and switch modes from a single compact control
- use `/api/voice/live/*` namespace
- use websocket for transport, REST for lifecycle
- use chunked micro-batch STT first, not vendor live API first
- create `documents.json` entry only on finalize
- use a dedicated live-session collection, not `voice_sessions.json`
- accept the current split of websocket transport + REST snapshot hydration until direct websocket state consumption is worth the extra complexity

## Open Questions
- Is encounter linking required before recording starts, or only before finalize?
- Is transcript text editable before final extraction, or should review stay structured-item only?
- Do we need clinician-only audio, or full doctor-patient diarization, in the first release?
- Should live finalize be upgraded to reuse `buildVoiceDocumentResult(...)` and `validateVoiceDashboardResult(...)` before publication?
- Should the client consume `transcript.final` / `draft.updated` directly instead of relying mainly on five-second REST refresh?
- What is the acceptable latency target for:
  - time to first transcript
  - time to first draft extraction
  - finalize to dashboard

## Recommendation Summary
The best fit for this repository is:
- a **quiet live conversation mode** inside the current Voice workspace
- a **dedicated live session resource** under `/api/voice/live/*`
- **websocket audio + event transport**
- **file-backed rolling session persistence**
- **micro-batch transcription first**, using the existing file-based STT boundary
- **shared dashboard publication only at finalize**
- a follow-up change that upgrades finalize from a lightweight `voice-live-*` row to the same validated dashboard contract used by uploaded dictation

That path keeps the current architecture coherent while still opening the door to a true streaming STT provider later.
