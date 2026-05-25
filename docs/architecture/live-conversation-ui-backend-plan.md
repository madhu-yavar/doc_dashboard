# Live Conversation UI + Backend Fit Plan

## Date
2026-05-22

## Purpose
Define a detailed implementation plan for adding **live doctor-patient conversation** support that fits the current repository instead of introducing a parallel product stack.

This plan is intentionally aligned to:
- the existing `/upload` intake workspace
- the current `/api/voice/*` backend area
- cookie-based auth via `AuthService`
- the shared processed-document dashboard route at `/dashboard?documentId=<id>`
- the current Express/CommonJS + file-backed persistence model

## Current Repo Constraints

### Frontend
- `src/pages/UploadCenter.tsx` already contains a top-level `voice` workspace.
- `src/components/voice/VoiceDictationWorkspace.tsx` is the existing upload-first voice UI.
- The app uses `apiFetch(...)`, `EventSource`, and mostly local component state today.
- `@tanstack/react-query` is available globally, but the current codebase does not depend on it for the voice path.
- The dashboard already knows how to open a processed voice document through the same route as PDFs.

### Backend
- `server/index.cjs` exposes the current voice APIs under `/api/voice`.
- The server currently starts with `app.listen(...)`, not `http.createServer(...)`.
- Existing STT tools are **file-oriented**, not true streaming session adapters:
  - `GeminiAudioTranscriptionTool` uploads a file and asks for structured JSON.
  - `WhisperTranscriptionTool` posts a file to a Whisper HTTP endpoint.
- Storage is file-backed under `server/storage/`.
- Auth is already enforced for `/api/*` and asset access via session cookie.

### Product Reality
- Current voice is **uploaded dictation**.
- There is **no microphone capture**, `MediaRecorder`, `AudioContext`, or websocket transport in the repo today.
- Live conversation therefore needs both a new UI mode and a new backend session transport.

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
- only `Finalize` creates the standard `documents.json` row used by `/dashboard`

This is the cleanest fit with the existing dashboard contract.

## Information Architecture

### `/upload` page structure
- Keep the existing top-level tabs:
  - `Documents`
  - `Voice`
- Inside `Voice`, add nested mode tabs:
  - `Dictation`
  - `Live conversation`

### Session list behavior
The live conversation mode should show:
- `Start new session`
- `Resume active session`
- `Recent finalized sessions`
- `Failed / interrupted sessions`

Phase 1 can keep this inside the `Voice` workspace. A dedicated route is not required initially.

### URL state
Recommended query params for resilience:
- `/upload?workspace=voice&mode=live`
- `/upload?workspace=voice&mode=live&sessionId=<id>`

This is worth doing early because live sessions are long-lived and refresh recovery matters.

## UI Plan

### Core screen flow

#### 1. Idle / preflight
The user sees:
- patient / encounter link controls
- microphone permission status
- input device selection
- short checklist for recording readiness
- `Start session`

#### 2. Starting
The UI shows:
- connection spinner
- websocket / session bootstrap state
- mic initialization
- a clear failure state if permission or connection fails

#### 3. Live capture
The main live layout should be a 3-zone workspace:

1. `Session rail`
- elapsed time
- connection state
- device name
- pause / resume / stop
- quick markers such as `Medication discussed` or `Follow-up discussed` later if needed

2. `Transcript panel`
- rolling transcript
- speaker chips: `Doctor`, `Patient`, `Unknown`
- interim vs finalized styling
- low-confidence flags
- reconnect gap markers

3. `Draft extraction panel`
- symptoms / diagnosis draft
- medications draft
- labs / radiology / procedures draft
- follow-up / plan draft
- unresolved review items count

#### 4. Paused / reconnecting
The transcript remains visible.
The controls become stateful:
- `Paused`
- `Reconnecting`
- `Waiting for microphone`

The UI must not look like the session was lost unless it actually ended.

#### 5. Review and finalize
When the user ends the session:
- freeze transcript edits
- run final reconciliation
- surface a review queue for ambiguous content
- allow `Finalize to dashboard` only when blocking review items are resolved

#### 6. Published
After finalize:
- show `Open dashboard`
- show `Back to voice workspace`
- preserve the live session as a historical record

## Recommended Frontend Structure

### New components
- `src/components/voice/LiveConversationWorkspace.tsx`
- `src/components/voice/LiveConversationSessionList.tsx`
- `src/components/voice/LiveConversationSetupCard.tsx`
- `src/components/voice/LiveConversationStatusBar.tsx`
- `src/components/voice/LiveConversationTranscriptPanel.tsx`
- `src/components/voice/LiveConversationDraftPanel.tsx`
- `src/components/voice/LiveConversationReviewPanel.tsx`

### New hook
- `src/hooks/useLiveConversationSession.ts`

Use a dedicated hook with `useReducer`, not scattered `useState`, because live conversation has multiple concurrent state machines:
- recorder state
- websocket state
- transcript state
- draft extraction state
- finalization state

### React Query recommendation
Best fit for this repo:
- use the custom reducer hook for the active live session
- use React Query only later for session list/history caching if needed

Do **not** make the websocket event loop depend on React Query cache mutation from day one. That adds complexity without matching the current voice UI style.

## UI Implementation Matrix

This table converts the planned live conversation UI into implementation-facing rows so each control is tied to expected state and backend behavior.

| Area | Component / UI element | UI type | What user does | Functionality | Frontend state involved | Backend API / event | Priority |
|---|---|---|---|---|---|---|---|
| Workspace navigation | `Documents` / `Voice` | Top-level tabs | Switch workspace | Moves user between document intake and voice workflows in `/upload` | `workspace` URL/query state | None | P1 |
| Voice mode | `Dictation` / `Live conversation` | Nested tabs | Switch mode | Separates upload-first dictation from live conversation | `mode` URL/query state | None | P1 |
| Session list | `Start new session` | Primary button | Start a new live encounter | Creates a new draft live session and opens preflight | `sessionId`, `session.status = draft` | `POST /api/voice/live/sessions` | P1 |
| Session list | `Resume active session` | Button / row action | Resume interrupted or active session | Restores a session using `sessionId` | `sessionId`, snapshot hydration | `GET /api/voice/live/sessions/:id` | P1 |
| Session list | `Recent finalized sessions` | List / table | Review completed sessions | Shows past finalized sessions and lets user re-open context | session history state | `GET /api/voice/live/sessions` | P2 |
| Session list | `Failed / interrupted sessions` | List / table | Recover failed work | Shows sessions needing retry or review | session history state | `GET /api/voice/live/sessions` | P2 |
| Preflight | Patient link control | Search/select | Link patient | Associates the live session with patient context | `session.linkedPatient` | `POST /api/voice/live/sessions` or patch later | P1 |
| Preflight | Encounter link control | Search/select or text input | Link encounter | Associates encounter/workflow context | `session.encounterLabel` | `POST /api/voice/live/sessions` or patch later | P1 |
| Preflight | Microphone permission status | Status badge | Check permission | Shows whether mic access is granted/denied/unknown | `recorder.permission` | Browser media permission only | P1 |
| Preflight | Input device selector | Dropdown | Choose mic | Selects capture device | `recorder.deviceId` | None | P1 |
| Preflight | Recording readiness checklist | Info/checklist card | Verify setup | Confirms mic, patient context, and connection readiness | derived UI state | None | P2 |
| Preflight | `Start session` | Primary button | Begin live recording | Starts mic capture and websocket session | `recorder.captureState`, `transport.connectionState`, `session.status` | `WS /api/voice/live/sessions/:id/stream` | P1 |
| Starting | Connection spinner | Loading indicator | Wait for startup | Shows live startup progress | `transport.connectionState = connecting` | websocket handshake | P1 |
| Starting | Bootstrap status text | Inline status/banner | Observe startup | Shows websocket/session bootstrap progress | `transport.connectionState` | websocket `session.ready` / `session.state` | P1 |
| Starting | Failure banner | Error banner/dialog | Retry or stop | Explains permission or connection failures | `transport.lastError`, `recorder.captureState = failed` | websocket / REST error | P1 |
| Live capture | Session rail | Sticky side/top panel | Monitor session | Holds core live controls and status | whole session reducer | None | P1 |
| Live capture | Elapsed time | Timer label | Monitor duration | Shows live session duration | `session.durationMs` | optional heartbeat/session state | P1 |
| Live capture | Connection state | Badge/pill | Monitor connection | Shows connected/reconnecting/error state | `transport.connectionState` | websocket `session.state` | P1 |
| Live capture | Device name | Read-only text | Verify input | Shows active microphone name | local recorder/device state | None | P2 |
| Live capture | `Pause` | Button | Pause capture | Temporarily stops sending audio without closing session | `recorder.captureState = paused`, `session.status = paused` | `POST /api/voice/live/sessions/:id/pause` or websocket `session.pause` | P1 |
| Live capture | `Resume` | Button | Resume capture | Restarts audio streaming after pause | `recorder.captureState = recording`, `session.status = live` | `POST /api/voice/live/sessions/:id/resume` or websocket `session.resume` | P1 |
| Live capture | `Stop` / end session | Button | End recording | Stops capture and transitions to review/finalization | `recorder.captureState = stopping`, `session.status` | websocket `session.end` | P1 |
| Live capture | Quick marker buttons | Secondary buttons | Mark important moments | Adds lightweight semantic markers like meds/follow-up | marker state if added | later event endpoint | P3 |
| Transcript | Transcript panel | Scrollable panel | Read transcript live | Displays rolling transcript as conversation unfolds | `transcript.segments`, `transcript.interimText` | websocket `transcript.partial`, `transcript.final` | P1 |
| Transcript | Transcript segment rows | Streamed text rows | Follow conversation | Shows segment-by-segment transcript | `transcript.segments` | websocket transcript events | P1 |
| Transcript | Speaker chips | Badge/chip | See attribution | Labels each segment as `Doctor`, `Patient`, or `Unknown` | segment speaker metadata | transcript normalization / diarization output | P1 |
| Transcript | Interim styling | Visual text state | Distinguish unstable text | Marks non-final transcript content | segment/interim flags | `transcript.partial` | P1 |
| Transcript | Final styling | Visual text state | Trust stable text | Marks stabilized transcript content | finalized segment flags | `transcript.final` | P1 |
| Transcript | Low-confidence flags | Warning badge/icon | Spot ambiguity | Highlights uncertain transcript spans | segment confidence / flags | transcript quality output | P1 |
| Transcript | Reconnect gap markers | Inline marker | Notice missing context | Shows likely missing audio/transcript gaps after reconnect | `transcript.hasGap` | connection + transcript events | P2 |
| Draft extraction | Draft extraction panel | Side panel/cards | Watch structured draft | Shows live extracted clinical data | `draft.extractedData`, `draft.lastUpdatedAt` | websocket `draft.updated` | P2 |
| Draft extraction | Symptoms / diagnosis draft | Data card | Review early interpretation | Displays draft diagnosis/symptom extraction | `draft.extractedData` | incremental extraction | P2 |
| Draft extraction | Medications draft | Data card | Review med mentions/orders | Shows draft medications and possible orders | `draft.extractedData` | incremental extraction | P2 |
| Draft extraction | Labs / radiology / procedures draft | Data cards | Review planned workup | Shows draft tests/procedures from transcript | `draft.extractedData` | incremental extraction | P2 |
| Draft extraction | Follow-up / plan draft | Data card | Review care plan | Shows draft plan and follow-up content | `draft.extractedData` | incremental extraction | P2 |
| Draft extraction | Review items count | Counter/badge | Monitor blockers | Shows number of unresolved review items | `draft.reviewItems.length` | `draft.updated`, `review.item.created` | P2 |
| Pause/reconnect | `Paused` state banner | Status banner | Understand current state | Confirms session is paused, not lost | `session.status = paused` | session state event | P1 |
| Pause/reconnect | `Reconnecting` banner | Status banner | Wait safely | Indicates websocket recovery in progress | `transport.connectionState = reconnecting` | session state event | P1 |
| Pause/reconnect | `Waiting for microphone` banner | Status banner | Fix device issue | Indicates mic/device restoration is needed | `recorder.permission`, `recorder.captureState` | local/browser state | P1 |
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
| P1 | Navigation, preflight, start, pause, resume, stop, connection states, live transcript shell |
| P2 | Draft extraction panel, review queue, finalize flow, open dashboard |
| P3 | Historical refinements, quick markers, richer session history/admin polish |

## Key UI Dependencies

| UI feature | Backend dependency |
|---|---|
| `Start session` | session creation + websocket handshake |
| Live transcript panel | `transcript.partial` and `transcript.final` websocket events |
| Draft extraction panel | incremental extraction + `draft.updated` events |
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
- the adapter invokes the current Gemini or Whisper file-based transcription tool
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

### Slice 1: Session skeleton
- add storage bootstrap
- add REST session create/list/get/delete
- switch server bootstrap to shared HTTP server
- add websocket auth and heartbeat
- add UI preflight + start / pause / resume / stop shell

Acceptance:
- a doctor can start a live session
- the UI survives reconnects
- the backend persists session state

### Slice 2: Audio ingest + rolling transcript
- add browser `MediaRecorder`
- send chunks over websocket
- persist chunks and rolling combined asset
- run micro-batch STT windows
- emit `transcript.partial` and `transcript.final`

Acceptance:
- transcript appears while recording
- refresh + resume works

### Slice 3: Draft extraction
- incremental extraction on stable transcript windows
- draft cards in UI
- speaker-sensitive safety gating

Acceptance:
- medications / diagnosis / follow-up draft cards update during the session

### Slice 4: Review + finalize
- review queue UI
- final extraction reconciliation
- processed document creation
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
- reducer tests for session state transitions
- component tests for:
  - preflight
  - transcript rendering
  - reconnect banner
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
- open dashboard

## Decisions To Lock Before Coding

### Recommended defaults
- keep live conversation inside `/upload` -> `Voice`
- add nested mode tabs under Voice
- use `/api/voice/live/*` namespace
- use websocket for transport, REST for lifecycle
- use chunked micro-batch STT first, not vendor live API first
- create `documents.json` entry only on finalize
- use a dedicated live-session collection, not `voice_sessions.json`
- use `useReducer` + custom hook for the active live session UI

## Open Questions
- Is encounter linking required before recording starts, or only before finalize?
- Is transcript text editable before final extraction, or should review stay structured-item only?
- Do we need clinician-only audio, or full doctor-patient diarization, in the first release?
- Should live sessions appear in the main `/api/documents` queue after finalize only, or also in a separate history panel?
- What is the acceptable latency target for:
  - time to first transcript
  - time to first draft extraction
  - finalize to dashboard

## Recommendation Summary
The best fit for this repository is:
- a **nested live conversation mode** inside the current Voice workspace
- a **dedicated live session resource** under `/api/voice/live/*`
- **websocket audio + event transport**
- **file-backed rolling session persistence**
- **micro-batch transcription first**, using the existing file-based STT boundary
- **shared dashboard publication only at finalize**

That path keeps the current architecture coherent while still opening the door to a true streaming STT provider later.
