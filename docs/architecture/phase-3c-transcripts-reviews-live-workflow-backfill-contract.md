# Phase 3C: Transcripts + Reviews + Live Workflow Backfill Contract

## Date
2026-06-02

## Status
Planning-oriented implementation contract

## Purpose
Define the exact implementation contract for `Phase 3C` so the backfill of transcript state, transcript segments, review items, review resolution history, live conversation sessions, and workflow-linked assets is done against the real runtime stores in this repository.

This document exists to prevent the same class of drift that affected `Phase 2A`: assuming source ids are globally unique, inventing document links that the schema cannot represent, and guessing how live workflow states map into the coarser Phase 0 workflow enums.

## Phase Boundary

### In scope

- `voice_sessions.json -> transcripts`
- `voice_sessions.json -> transcript_segments`
- `voice_sessions.json -> review_items`
- deterministic voice audio/transcript files -> `document_assets`
- `voice_reviews.json -> review_item_resolutions`
- lifecycle rows in `voice_reviews.json -> audit_events`
- `live_conversation_sessions.json -> live_conversation_sessions`
- `live_conversation_sessions.json -> transcripts`
- `live_conversation_sessions.json -> transcript_segments`
- `live_conversation_sessions.json -> review_items`
- deterministic live audio files -> `document_assets`
- `live_conversation_events.jsonl -> audit_events`

### Explicitly out of scope

- inserting new canonical `documents` rows
- backfilling `document_extractions`, `chart_notes`, or `prescription_artifacts`
- chat history, audit run history, alert logs, or analytics metrics
- identity reconciliation
- live HL7/FHIR adapter activation

Canonical `documents` ownership remains `Phase 3B`. Chat, alerts, audit-run history, and analytics remain `Phase 3D`.

## Preconditions

- `Phase 3A` has already created deterministic `users`, provisional identity rows, and identifier rows.
- `Phase 3B` has already backfilled canonical `documents`, `document_assets`, and `document_extractions`.
- `Phase 3C` must reuse:
  - `TranscriptsRepository`
  - `LiveSessionsRepository`
  - `DocumentsRepository`
  - `AuditRepository`
- There is currently no dedicated repository for:
  - `review_items`
  - `review_item_resolutions`

`Phase 3C` must therefore either:

- add a dedicated review-workflow repository, or
- use one scoped migration module for review tables only

It must not scatter ad hoc raw SQL across routes or service files.

## Current Runtime Truth

### Authoritative source stores

- `server/storage/voice_sessions.json`
- `server/storage/voice_reviews.json`
- `server/storage/live_conversation_sessions.json`
- `server/storage/live_conversation_events.jsonl`

### Real wrapper shapes

- `voice_sessions.json` is `{ "sessions": [...] }`
- `voice_reviews.json` is `{ "reviews": [...] }`
- `live_conversation_sessions.json` is `{ "sessions": [...] }`
- `live_conversation_events.jsonl` is newline-delimited JSON objects

### Current voice session row family

Current voice-session fields seen in live data include:

| Field | Notes |
|---|---|
| `id` | stable voice session id; often also the canonical queue-document id |
| `fileName` | uploaded audio filename |
| `mimeType` | audio mime type |
| `size` | audio file size |
| `uploadedAt` | session upload time |
| `durationLabel` | UI convenience only |
| `linkedPatient` | label only, not a canonical identifier |
| `encounterLabel` | label only, not a canonical identifier |
| `status` | filesystem vocabulary, not Postgres vocabulary |
| `sttBackend` | transcription backend |
| `transcriptQuality` | current quality summary |
| `segments[]` | transcript segments |
| `reviewItems[]` | current review state |
| `extractionPreview` | UI preview, not transcript canonical state |
| `audioPath` | deterministic audio asset path when present |
| `transcriptPath` | deterministic transcript JSON asset path when present |
| `dashboardDocumentId` | convenience pointer; may be `NULL` |
| `hash` | audio hash when present |
| `error` | current workflow error |
| `sttAudit` | backend/debug metadata |
| `extractedData` | convenience extraction payload; canonical extraction ownership remains `Phase 3B` |

### Current `voice_reviews.json` row families

`voice_reviews.json` is a mixed log, not a single homogeneous table.

There are two row families:

1. resolution history rows
2. lifecycle event rows

Resolution history rows include:

- `reviewItemId`
- `resolution`
- `editedValue`
- `username`
- `role`

Lifecycle event rows include:

- `type`
- `sessionId`
- `createdAt`

Those two families must be split during backfill. They do not map to the same Postgres table.

### Current live session row family

Current live-session fields seen in live data include:

| Field | Notes |
|---|---|
| `id` | stable live session id |
| `status` | filesystem vocabulary, not Postgres vocabulary |
| `linkedPatient` | label only |
| `encounterLabel` | label only |
| `createdBy` | object with `id`, `username`, `role` |
| `startedAt` | session start |
| `updatedAt` | last mutation time |
| `endedAt` | session end when present |
| `documentId` | final canonical document id only after finalization |
| `durationMs` | live duration |
| `audio.combinedPath` | deterministic combined audio path when present |
| `transcript` | current transcript snapshot |
| `draftExtraction` | current structured draft plus review items |
| `transport` | websocket/runtime transport state |

### Current live event stream

`live_conversation_events.jsonl` is append-only history with fields such as:

- `timestamp`
- `sessionId`
- `eventType`
- arbitrary event-specific fields such as:
  - `createdBy`
  - `backend`
  - `segmentCount`
  - `documentId`
  - `resolution`
  - `reviewItemId`

## Core Rules

### 1. `Phase 3B` owns canonical `documents`

`Phase 3C` must not invent new canonical `documents` rows.

Use these ownership rules:

- voice transcript/review rows anchor to an existing canonical voice document when one exists
- live transcript/review rows anchor to `live_conversation_sessions`
- finalized live sessions may carry `documentId`, but their transcript/review rows still belong to `live_conversation_sessions`, not `documents`

### 2. Voice workflow rows anchor to canonical document ids only when deterministic

Use this precedence for voice-session document linkage:

1. existing `documents.id == voiceSession.id`
2. existing `documents.id == voiceSession.dashboardDocumentId` when non-null and unique

If no deterministic canonical document exists:

- do not invent one in `Phase 3C`
- skip transcript/review backfill for that voice session
- report the orphaned voice session in the backfill report

### 3. Live workflow rows anchor to `live_conversation_sessions`, not `documents`

This is required by the Phase 0 schema:

- `transcripts` must reference either `document_id` or `live_session_id`
- `review_items` must reference either `document_id` or `live_session_id`

For live workflow rows, always use:

- `live_session_id = session.id`
- `document_id = NULL`

even when `session.documentId` exists after finalization.

The indirect document link is preserved through `live_conversation_sessions.document_id`.

### 4. Source-local ids are not globally safe

Current source ids such as:

- `seg_1`
- `seg-speaker-fallback-1`
- `required:patient.age`

are not globally unique across sessions.

`Phase 3C` must not use those raw ids directly as global Postgres primary keys.

### 5. Backfill ids must be deterministic and namespaced

Use these deterministic id rules:

| Target table | Deterministic id rule |
|---|---|
| `transcripts` for voice sessions | `voice-tr:<session.id>` |
| `transcripts` for live sessions | `live-tr:<session.id>` |
| `transcript_segments` | `<transcript.id>:<sourceSegmentId or segmentOrder>` |
| `review_items` for voice sessions | `voice-ri:<session.id>:<sourceReviewItemId>` |
| `review_items` for live sessions | `live-ri:<session.id>:<sourceReviewItemId>` |
| `review_item_resolutions` | preserve source `voice_reviews[].id` |

Preserve the original source-local ids inside JSONB supporting fields where relevant.

### 6. Segment status is normalized, not copied literally

Source segment rows use statuses such as:

- `final`
- `interim`

Postgres `transcript_segments.status` only allows:

- `active`
- `edited`
- `deleted`

All source-backed segments must therefore be inserted as:

- `status = active`

Preserve the original source segment status in `flags_jsonb.source_status`.

### 7. Live-session status normalization is explicit

Current live filesystem statuses include:

- `draft`
- `live`
- `paused`
- `review_required`
- `finalized`
- `failed`

Postgres `live_conversation_sessions.status` only allows:

- `active`
- `ended`
- `abandoned`

Use only this mapping:

| Filesystem live status | Postgres `live_conversation_sessions.status` |
|---|---|
| `draft` | `active` |
| `live` | `active` |
| `paused` | `active` |
| `review_required` | `ended` |
| `finalized` | `ended` |
| `failed` | `abandoned` |

Do not guess beyond this table.

### 8. Live review history is not reconstructible from current sources

Current live stores preserve:

- current review item state inside `draftExtraction.reviewItems`
- lifecycle events in `live_conversation_events.jsonl`

They do not preserve a complete append-only live review-resolution history comparable to `voice_reviews.json`.

Therefore:

- backfill live `review_items.current_resolution`
- do not invent `review_item_resolutions` rows for live sessions unless a deterministic append-only source is later introduced

### 9. Voice lifecycle events and live lifecycle events both become `audit_events`

Use:

- lifecycle rows in `voice_reviews.json`
- all rows in `live_conversation_events.jsonl`

to backfill `audit_events`.

`Phase 3C` must not invent `audit_runs` rows from those event-only sources.

### 10. UI-only live review fields stay in `draft_extraction_jsonb`

Current live review rows may include UI-only fields such as:

- `placeholder`
- `inputType`

The Phase 0 `review_items` table has no dedicated columns for those.

`Phase 3C` must therefore:

- preserve the full raw live draft under `live_conversation_sessions.draft_extraction_jsonb`
- normalize only the canonical review fields into `review_items`
- not invent extra relational columns or misuse unrelated fields for UI-only metadata

## Required Field Mapping

### Voice sessions -> `transcripts`

| Voice source | Postgres transcript column | Rule |
|---|---|---|
| namespaced id | `id` | `voice-tr:<session.id>` |
| linked canonical voice document id | `document_id` | deterministic only |
| none | `live_session_id` | `NULL` |
| `sttBackend` | `backend` | preserve |
| transcript JSON `language` if present | `language_code` | else `NULL` |
| transcript JSON `rawText` or joined segment text | `raw_text` | deterministic best source |
| transcript JSON `normalizedText` or joined normalized text | `normalized_text` | deterministic best source |
| `transcriptQuality` plus transcript JSON `quality` | `quality_jsonb` | merge safely |
| transcript JSON payload if file exists, else constructed transcript snapshot | `transcript_jsonb` | preserve |
| `uploadedAt` | `created_at` | preserve when present |

### Live sessions -> `live_conversation_sessions`

| Live source | Postgres column | Rule |
|---|---|---|
| `id` | `id` | preserve |
| `createdBy.id` or resolved `createdBy.username` | `created_by_user_id` | deterministic user resolution only |
| `Phase 3A patient_id` | `patient_id` | nullable |
| `Phase 3A encounter_id` | `encounter_id` | nullable |
| normalized live status | `status` | use explicit table above |
| `linkedPatient` | `linked_patient_label` | label only |
| `encounterLabel` | `encounter_label` | label only |
| `documentId` | `document_id` | only if matching canonical document exists |
| `durationMs` | `duration_ms` | preserve |
| `transport` | `transport_state_jsonb` | preserve |
| `draftExtraction` | `draft_extraction_jsonb` | preserve full raw draft |
| namespaced live transcript id | `current_transcript_id` | `live-tr:<session.id>` when transcript exists |
| `startedAt` | `started_at` | preserve if present |
| `endedAt` | `ended_at` | preserve if present |
| `startedAt` or `updatedAt` | `created_at` | deterministic fallback |
| `updatedAt` | `updated_at` | preserve |

### Live sessions -> `transcripts`

| Live source | Postgres transcript column | Rule |
|---|---|---|
| namespaced id | `id` | `live-tr:<session.id>` |
| none | `document_id` | `NULL` |
| `session.id` | `live_session_id` | preserve |
| `NULL` unless deterministic backend source exists | `backend` | do not guess |
| `NULL` unless deterministic language exists | `language_code` | do not guess |
| `transcript.rawText` | `raw_text` | preserve |
| `transcript.normalizedText` | `normalized_text` | preserve |
| `transcript.quality` | `quality_jsonb` | preserve |
| `transcript` | `transcript_jsonb` | preserve |
| `startedAt` or `updatedAt` | `created_at` | deterministic fallback |

### Sessions -> `transcript_segments`

Apply this to both voice and live transcript rows.

| Source | Target | Rule |
|---|---|---|
| namespaced id | `id` | `<transcript.id>:<sourceSegmentId or order>` |
| transcript id | `transcript_id` | preserve |
| source array order | `segment_order` | 1-based stable order |
| `speakerId` if present | `speaker_id` | nullable |
| normalized speaker role | `speaker_role` | map `doctor -> physician`, `physician -> physician`, `patient -> patient`, `nurse -> nurse`, `family -> family`, `unknown -> unknown`, all others -> `other` |
| `speakerLabel` | `speaker_label` | preserve |
| `startSeconds * 1000` if numeric | `start_ms` | else `NULL` |
| `endSeconds * 1000` if numeric | `end_ms` | else `NULL` |
| `text` | `text` | preserve |
| `normalizedText` if present | `normalized_text` | else `text` |
| `confidence` | `confidence_score` | preserve |
| source flags plus raw ids/labels/status | `flags_jsonb` | preserve support metadata |
| normalized segment status | `status` | always `active` on initial backfill |

### Voice review items -> `review_items`

| Voice source | Postgres column | Rule |
|---|---|---|
| namespaced id | `id` | `voice-ri:<session.id>:<sourceReviewItemId>` |
| linked canonical voice document id | `document_id` | deterministic only |
| none | `live_session_id` | `NULL` |
| `voice-tr:<session.id>` | `transcript_id` | preserve |
| `category` | `category` | preserve |
| `severity` | `severity` | preserve |
| `reasonCode` | `reason_code` | preserve |
| `title` | `title` | preserve |
| none | `field_path` | `NULL` unless deterministic path exists |
| none | `required_flag` | `FALSE` |
| `provenanceText` | `provenance_text` | preserve |
| `provenanceTime` and raw source id | `provenance_range_jsonb` | preserve as label-range metadata |
| `extractedValue` | `extracted_value_jsonb` | wrap as `{ "value": ... }` |
| `suggestedValue` | `suggested_value_jsonb` | wrap as `{ "value": ..., "source_resolution": ... }` |
| normalized `resolution` | `current_resolution` | `edited -> approved`; all other allowed values preserve |

### Live review items -> `review_items`

| Live source | Postgres column | Rule |
|---|---|---|
| namespaced id | `id` | `live-ri:<session.id>:<sourceReviewItemId>` |
| none | `document_id` | `NULL` |
| `session.id` | `live_session_id` | preserve |
| `live-tr:<session.id>` when transcript exists | `transcript_id` | nullable |
| `category` | `category` | preserve |
| `severity` | `severity` | preserve |
| none | `reason_code` | `NULL` unless deterministic reason exists |
| `title` | `title` | preserve |
| `fieldPath` | `field_path` | preserve |
| `required` | `required_flag` | preserve boolean |
| `NULL` unless deterministic provenance text exists | `provenance_text` | do not guess |
| raw source id only | `provenance_range_jsonb` | preserve source review id |
| `extractedValue` | `extracted_value_jsonb` | wrap as `{ "value": ... }` |
| `suggestedValue` | `suggested_value_jsonb` | wrap as `{ "value": ... }` |
| normalized `resolution` | `current_resolution` | `edited -> approved`; all other allowed values preserve |

### `voice_reviews.json` resolution rows -> `review_item_resolutions`

Only rows that contain both:

- `reviewItemId`
- `resolution`

may be inserted into `review_item_resolutions`.

| Source | Target | Rule |
|---|---|---|
| `id` | `id` | preserve |
| namespaced review item id | `review_item_id` | use the same namespacing rule as `review_items` |
| matched `users.id` by `username` | `resolved_by_user_id` | else `NULL` |
| normalized `resolution` | `resolution` | `edited -> approved`; other allowed values preserve |
| `editedValue` | `edited_value_jsonb` | wrap as `{ "value": ... }` when non-empty |
| source actor fallback | `notes` | only when user match fails |
| `createdAt` | `created_at` | preserve |

### Lifecycle event rows -> `audit_events`

This applies to:

- `voice_reviews.json` rows with `type` and no `reviewItemId`
- all `live_conversation_events.jsonl` rows

#### Workflow normalization

Use only this mapping:

| Source family | Postgres `workflow` |
|---|---|
| voice lifecycle rows | `voice_upload` |
| live lifecycle rows | `live_conversation` |

#### Event-status normalization

Use this precedence:

1. if source event type ends with `_failed` -> `failed`
2. if source event type is one of:
   - `voice_transcription_completed`
   - `session_finalized`
   - `session_ended`
   - `final_transcript_backfilled`
   - `final_draft_backfilled`
   then `completed`
3. if source event type is one of:
   - `session_created`
   - `websocket_connected`
   - `websocket_disconnected`
   - `session_started`
   - `draft_updated`
   - `review_item_resolved`
   - `session_paused`
   - `session_resumed`
   - `session_deleted`
   then `started`
4. otherwise `warning`

Do not guess outside this table.

#### Event field mapping

| Source | Target | Rule |
|---|---|---|
| source `id` if present, else deterministic namespaced event id | `id` | preserve or derive |
| none | `audit_run_id` | `NULL` |
| normalized workflow | `workflow` | use table above |
| deterministic linked canonical document if one exists | `document_id` | else `NULL` |
| none | `chat_session_id` | `NULL` |
| `type` or `eventType` | `event_type` | preserve |
| normalized event status | `status` | use table above |
| event type or source title surrogate | `title` | preserve best available human label |
| remaining event payload | `details_jsonb` | preserve after removing key fields |
| `createdAt` or `timestamp` | `occurred_at` | preserve |

## `document_assets` Rules

### Voice assets

Create voice `document_assets` rows only when the linked canonical voice document exists and the file exists at migration time.

Use these roles:

| Voice source | `asset_role` |
|---|---|
| `audioPath` | `source_audio` |
| `transcriptPath` | `transcript_json` |

### Live assets

Create live `document_assets` rows only when the live session exists and the file exists at migration time.

Use these roles:

| Live source | `asset_role` |
|---|---|
| `audio.combinedPath` | `source_audio` |

Live transcript state is already preserved inside the relational transcript tables and `transcript_jsonb`; do not invent a `transcript_json` asset unless a deterministic standalone transcript file actually exists.

## Execution Order

Run `Phase 3C` in this exact order:

1. snapshot current source counts
2. load `voice_sessions.json`
3. resolve deterministic canonical document links for voice sessions
4. create voice transcript rows
5. create voice transcript segments
6. create voice review items
7. create deterministic voice asset rows
8. load `voice_reviews.json`
9. split voice review-history rows from lifecycle-event rows
10. create `review_item_resolutions` from review-history rows
11. create voice `audit_events` from lifecycle rows
12. load `live_conversation_sessions.json`
13. create `live_conversation_sessions` rows
14. create live transcript rows
15. create live transcript segments
16. create live review items
17. create deterministic live asset rows
18. load `live_conversation_events.jsonl`
19. create live `audit_events`
20. emit backfill report

## Required Backfill Report

`Phase 3C` must emit a machine-readable report with:

- total voice session count
- voice sessions linked to canonical documents
- orphaned voice sessions skipped because no deterministic document link existed
- inserted `transcripts` count by source family
- inserted `transcript_segments` count
- inserted `review_items` count by source family
- inserted `review_item_resolutions` count
- inserted `audit_events` count by source family
- inserted `document_assets` count by `asset_role`
- skipped missing audio files
- skipped missing transcript JSON files
- live sessions skipped because `createdBy` could not be resolved to an existing user
- source rows whose raw ids were not globally unique and were namespaced successfully

## Exit Gate

`Phase 3C` is complete only when all of the following are true:

- every inserted transcript row is anchored to exactly one valid owner:
  - `document_id` for voice, or
  - `live_session_id` for live
- no live transcript row was linked directly to `documents`
- every transcript segment id is globally unique after namespacing
- every review item id is globally unique after namespacing
- voice review history rows with `reviewItemId` were inserted into `review_item_resolutions`
- lifecycle rows from `voice_reviews.json` were not mistaken for review resolutions
- live review current state was backfilled without inventing synthetic resolution-history rows
- every existing deterministic voice audio/transcript file has the expected `document_assets` row
- every existing deterministic live audio file has the expected `document_assets` row
- live session statuses use only the explicit normalization table
- source helper/UI-only review fields were preserved inside `draft_extraction_jsonb`, not dropped silently

## Non-Goals

- creating new canonical `documents` rows
- replaying extraction payload backfill already owned by `Phase 3B`
- inventing live review-resolution history that the current runtime never stored
- using source-local segment/review ids as global primary keys
- linking live transcript/review rows directly to canonical documents
