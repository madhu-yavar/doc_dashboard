# Phase 6: Legacy Store Cleanup Contract

## Date
2026-06-04

## Status
Planning-oriented implementation contract

## Purpose
Define the exact implementation contract for `Phase 6` so PostgreSQL becomes the sole authoritative metadata store and the remaining legacy JSON/JSONL/SQLite metadata stores can be retired without breaking current runtime behavior.

This document is narrower than the canonical migration plan. It translates `Phase 6` into the concrete runtime seams, file stores, flags, and cleanup rules that still exist in this repository.

## Phase Boundary

### In scope

- stop runtime metadata reads and writes to:
  - `users.json`
  - `auth_sessions.json`
  - `documents.json`
  - `voice_sessions.json`
  - `voice_reviews.json`
  - `live_conversation_sessions.json`
  - `live_conversation_events.jsonl`
  - `chat_sessions.json`
  - `chat_actions.json`
  - `chat_exports.json`
  - `audit_runs.json`
  - `audit_events.jsonl`
  - `analytics.sqlite`
- remove `ENABLE_DUAL_WRITE_PHASE_2A` and the subsystem `ENABLE_PG_READ_*` runtime branches after Postgres-only paths exist
- move live-conversation finalize/publication flows off direct `documents.json` writes
- remove startup repair flows that republish document state from session stores
- archive or delete obsolete legacy metadata files after validation sign-off
- keep binary asset serving intact while metadata ownership moves fully to PostgreSQL

### Explicitly out of scope

- deleting binary assets under `uploads/`, `voice_audio/`, `voice_transcripts/`, `voice_graph_checkpoints/`, `live_conversation_audio/`, `live_conversation_checkpoints/`, `masked_images/`, or `prescriptions/`
- object-storage migration
- HL7/FHIR adapter enablement
- public API contract redesign
- migrating `search_cache.json` into PostgreSQL in this phase
- treating `auth.db` as an authoritative store; it remains a non-runtime artifact

`search_cache.json` is not part of the current relational contract. It may remain file-backed as a non-authoritative cache unless a separate migration scope is approved.

## Preconditions

- `Phase 4` read cutover has been validated for auth, documents, voice, live, chat, audit, alerts, and analytics in the target environment.
- `Phase 5` reconciliation code is deployed and PostgreSQL owns canonical `patients`, `encounters`, identifiers, and reconciliation cases.
- final parity checks between Postgres and legacy metadata stores have been captured before deletion or archival
- backup or archive copies of all legacy metadata stores exist before any destructive cleanup step
- Postgres-backed write ownership exists for all subsystems whose legacy files will be retired
- cleanup does not start by deleting files first; it starts by removing runtime dependence on them

## Current Runtime Truth

The repository is not yet in a Postgres-only runtime state. The following file-backed seams still exist in running code:

- [server/auth_service.cjs](../../server/auth_service.cjs)
  - bootstraps and mutates `users.json` and `auth_sessions.json`
- [server/index.cjs](../../server/index.cjs)
  - ensures and mutates `documents.json`, `voice_sessions.json`, `voice_reviews.json`, `chat_sessions.json`, `chat_actions.json`, and `chat_exports.json`
  - still runs startup repair from voice/live session stores into `documents.json`
- [server/live_conversation_store.cjs](../../server/live_conversation_store.cjs)
  - persists live-session state to `live_conversation_sessions.json`
  - persists live-session events to `live_conversation_events.jsonl`
- [server/live_conversation_routes.cjs](../../server/live_conversation_routes.cjs)
  - still materializes finalized live-conversation dashboard documents by writing directly into `documents.json`
- [server/audit_logger.cjs](../../server/audit_logger.cjs)
  - still writes `audit_runs.json` and `audit_events.jsonl`
- [server/analytics_store.cjs](../../server/analytics_store.cjs)
  - still maintains `analytics.sqlite` as a live derived store
- [server/prescription_service.cjs](../../server/prescription_service.cjs)
  - still reads `documents.json` and `live_conversation_sessions.json` directly

Some legacy files are already effectively obsolete at runtime but still present on disk:

- `pharmacy_alerts.jsonl`
- `department_alerts.jsonl`
- `auth.db`

Phase 6 must clean up both categories: actively used legacy stores and stale post-backfill leftovers.

## Required Cleanup Boundaries

### 1. Auth boundary

`AuthService` must stop treating `users.json` and `auth_sessions.json` as primary state.

Required Phase 6 outcomes:

- [server/auth_service.cjs](../../server/auth_service.cjs) reads and writes auth state only through `AuthRepository`
- bootstrap-user seeding, if still required, creates users in PostgreSQL rather than creating `users.json`
- `ensureStorage()` no longer creates auth metadata files as part of normal runtime boot

### 2. Documents boundary

`documents` must remain the canonical final record, but its runtime source must be PostgreSQL only.

Required Phase 6 outcomes:

- [server/index.cjs](../../server/index.cjs) removes filesystem `readDocuments()`, `writeDocuments()`, and `mutateDocuments()` ownership
- finalized document creation and updates flow through `DocumentsRepository`
- no route or service writes directly to `documents.json`

### 3. Voice and live-workflow boundary

Uploaded voice and live-session workflow state must stop using filesystem metadata as the mutation source of truth.

Required Phase 6 outcomes:

- [server/index.cjs](../../server/index.cjs) no longer uses `voice_sessions.json` or `voice_reviews.json` as primary workflow state
- [server/live_conversation_store.cjs](../../server/live_conversation_store.cjs) persists sessions and events in PostgreSQL-backed tables/services
- `live_conversation_events.jsonl` is retired in favor of relational/audit-backed event storage
- [server/live_conversation_routes.cjs](../../server/live_conversation_routes.cjs) stops publishing finalized live records by editing `documents.json`
- [server/prescription_service.cjs](../../server/prescription_service.cjs) loads documents and live-session-linked records from repository-backed sources

### 4. Chat boundary

Chat must stop dual-writing and stop treating the filesystem copies as authoritative.

Required Phase 6 outcomes:

- [server/index.cjs](../../server/index.cjs) removes filesystem ownership of `chat_sessions.json`, `chat_actions.json`, and `chat_exports.json`
- `ChatRepository` is the only runtime persistence owner for chat sessions, messages, confirmed actions, and exports

### 5. Audit boundary

Audit history must be append-only in PostgreSQL, not split across relational reads and file-backed writes.

Required Phase 6 outcomes:

- [server/audit_logger.cjs](../../server/audit_logger.cjs) reads and writes only through `AuditRepository`
- `audit_runs.json` and `audit_events.jsonl` become archived legacy artifacts
- live-conversation lifecycle events converge on the same audit/event storage model instead of staying in `live_conversation_events.jsonl`

### 6. Analytics boundary

Analytics is already modeled as derived data in PostgreSQL and must stop relying on SQLite at runtime.

Required Phase 6 outcomes:

- [server/analytics_store.cjs](../../server/analytics_store.cjs) stops using `analytics.sqlite` as a live store
- `analytics_document_metrics` becomes the only runtime analytics source
- SQLite sidecar files (`analytics.sqlite`, `analytics.sqlite-shm`, `analytics.sqlite-wal`) are archived after validation

### 7. Archive boundary

File deletion is not the cleanup strategy by itself. Archival and rollbackability are mandatory.

Required Phase 6 outcomes:

- every retired metadata file is snapshotted before removal
- the archive location and manifest are documented
- rollback uses the archived files plus the pre-cleanup application release; it is not a flag-only rollback

## Implementation Rules

### 1. PostgreSQL becomes the only metadata authority

After Phase 6, runtime metadata must not be reconstructed from JSON/JSONL/SQLite stores.

### 2. No runtime bootstrap may recreate retired metadata files

Functions such as `ensureStorage()`, `ensureCollectionFile()`, and similar helpers may continue to create asset directories, but they must not recreate retired metadata files during normal boot.

### 3. Remove cleanup blockers before removing files

Code that still writes legacy files is the blocker. File deletion happens only after those writers are gone.

### 4. `documents` remains canonical final record

Voice and live workflows may produce drafts and events, but startup repair must not republish final document state from session stores after cleanup.

### 5. Preserve file assets

Phase 6 removes metadata stores, not uploaded PDFs, audio, transcript artifacts, masked images, or generated prescriptions.

### 6. Keep `search_cache.json` as an explicit exception

It is allowed to remain file-backed in Phase 6 if it continues to be treated as a disposable cache rather than authoritative business data.

### 7. Do not bypass repositories with ad hoc SQL in routes

Cleanup work may consolidate boundaries, but route handlers must not replace file I/O with direct scattered SQL.

### 8. Rollback is release rollback plus archive restore

Once Phase 6 removes flag-based filesystem fallbacks, recovery requires restoring a prior app release and the archived legacy files if they are needed.

## Legacy Store Retirement Targets

| Legacy store | Current runtime owner | Postgres authority | Phase 6 action |
|---|---|---|---|
| `users.json` | `AuthService` | `users` | retire runtime file bootstrap and writes |
| `auth_sessions.json` | `AuthService` | `auth_sessions` | retire runtime file reads and writes |
| `documents.json` | `server/index.cjs`, `LiveConversationRoutes`, `PrescriptionService` | `documents`, `document_extractions`, `document_assets`, `chart_notes`, `prescription_artifacts` | retire file ownership and startup repair |
| `voice_sessions.json` | `server/index.cjs` | `transcripts`, `transcript_segments`, `review_items`, linked document tables | retire filesystem mutation path |
| `voice_reviews.json` | `server/index.cjs` | `review_item_resolutions`, `audit_events` | retire filesystem fallback |
| `live_conversation_sessions.json` | `LiveConversationStore`, `PrescriptionService` | `live_conversation_sessions`, transcript/review tables | retire filesystem session ownership |
| `live_conversation_events.jsonl` | `LiveConversationStore` | `audit_events` or dedicated relational event boundary | retire append-only file log |
| `chat_sessions.json` | `server/index.cjs` | `chat_sessions`, `chat_messages` | retire filesystem writes |
| `chat_actions.json` | `server/index.cjs` | `chat_confirmed_actions` | retire filesystem writes |
| `chat_exports.json` | `server/index.cjs` | `chat_exports` | retire filesystem writes |
| `audit_runs.json` | `AuditLogger` | `audit_runs` | retire filesystem writes |
| `audit_events.jsonl` | `AuditLogger` | `audit_events` | retire filesystem writes |
| `pharmacy_alerts.jsonl` | no active runtime owner | `alert_deliveries` | archive or delete stale legacy artifact |
| `department_alerts.jsonl` | no active runtime owner | `alert_deliveries` | archive or delete stale legacy artifact |
| `analytics.sqlite` | `AnalyticsStore` | `analytics_document_metrics` | retire SQLite runtime ownership |
| `analytics.sqlite-shm` | SQLite sidecar | none | archive/delete with SQLite store |
| `analytics.sqlite-wal` | SQLite sidecar | none | archive/delete with SQLite store |

## Exit Criteria

- no runtime metadata path depends on the retired stores listed above
- no metadata file in the retirement list is mutated during normal app operation
- startup succeeds without repair/hydration from legacy metadata stores
- auth, documents, voice, live, chat, audit, alerts, and analytics smoke tests pass with Postgres-only metadata ownership
- archival snapshots exist for all retired files
- deployment and current-state docs are updated after implementation lands

## Suggested PR Slices

1. auth and documents Postgres-only cleanup
2. voice/live workflow and live-document publication cleanup
3. chat and audit cleanup
4. analytics SQLite retirement and archive manifest
5. deployment/docs follow-through and legacy-file removal

## Conclusion

Phase 6 is not just "delete the JSON files." It is the point where PostgreSQL becomes the only metadata runtime, startup repair disappears, live workflows stop back-writing into legacy stores, and the remaining filesystem metadata artifacts become archival rather than operational.
