# Phase 6: Legacy Store Cleanup Mapping Note

## Date
2026-06-04

## Status
Implementation mapping

This note maps each remaining legacy metadata seam to its intended Postgres owner and the cleanup action required in `Phase 6`.

## Runtime Metadata Stores To Retire

| Store | Current runtime seam | Intended Postgres owner | Phase 6 action |
|---|---|---|---|
| `users.json` | `AuthService.ensureStorage()`, `readUsers()`, `writeUsers()`, `bootstrapUsersIfNeededRaw()` in [server/auth_service.cjs](../../server/auth_service.cjs) | `users` via `AuthRepository` | remove filesystem bootstrap and mutation path |
| `auth_sessions.json` | `AuthService.readSessions()`, `writeSessions()`, `mutateSessions()` in [server/auth_service.cjs](../../server/auth_service.cjs) | `auth_sessions` via `AuthRepository` | remove filesystem session ownership |
| `documents.json` | `readDocuments()`, `writeDocuments()`, `mutateDocuments()` in [server/index.cjs](../../server/index.cjs) | `documents`, `document_extractions`, `document_assets`, `chart_notes`, `prescription_artifacts` | replace file ownership with repository-backed writes |
| `voice_sessions.json` | `readVoiceSessions()`, `writeVoiceSessions()`, `mutateVoiceSessions()` in [server/index.cjs](../../server/index.cjs) | transcript, segment, review, and linked document tables | remove file-backed uploaded-dictation workflow state |
| `voice_reviews.json` | `readVoiceReviews()` and direct review-file writes in [server/index.cjs](../../server/index.cjs) | `review_item_resolutions`, `audit_events` | remove file-backed review history |
| `live_conversation_sessions.json` | `LiveConversationStore.readSessions()`, `writeSessions()`, `mutateSessions()` in [server/live_conversation_store.cjs](../../server/live_conversation_store.cjs) | `live_conversation_sessions`, `transcripts`, `review_items` | move session mutations to Postgres |
| `live_conversation_events.jsonl` | `LiveConversationStore.logEvent()` and `getEvents()` in [server/live_conversation_store.cjs](../../server/live_conversation_store.cjs) | `audit_events` or a dedicated relational event facade | retire file event log |
| `chat_sessions.json` | `readChatSessions()` / `writeChatSessions()` in [server/index.cjs](../../server/index.cjs) | `chat_sessions`, `chat_messages` | remove file-backed chat session ownership |
| `chat_actions.json` | `readChatActions()` / `writeChatActions()` in [server/index.cjs](../../server/index.cjs) | `chat_confirmed_actions` | remove file-backed action ownership |
| `chat_exports.json` | `readChatExports()` / `writeChatExports()` in [server/index.cjs](../../server/index.cjs) | `chat_exports` | remove file-backed export ownership |
| `audit_runs.json` | `AuditLogger.readRuns()`, `writeRuns()`, `mutateRuns()` in [server/audit_logger.cjs](../../server/audit_logger.cjs) | `audit_runs` | remove file-backed audit-run ownership |
| `audit_events.jsonl` | `AuditLogger.appendEvent()` and `getEvents()` in [server/audit_logger.cjs](../../server/audit_logger.cjs) | `audit_events` | remove file-backed audit-event ownership |
| `analytics.sqlite` | `AnalyticsStore.initialize()`, `upsertDocumentMetrics()`, `listMetrics()` in [server/analytics_store.cjs](../../server/analytics_store.cjs) | `analytics_document_metrics` via `AnalyticsRepository` | retire SQLite runtime storage |

## Legacy Files Already Orphaned At Runtime

| Store | Current state | Phase 6 action |
|---|---|---|
| `pharmacy_alerts.jsonl` | backfill source only; no active runtime writer found | archive or delete after sign-off |
| `department_alerts.jsonl` | backfill source only; no active runtime writer found | archive or delete after sign-off |
| `auth.db` | ignored artifact per canonical plan | leave ignored or remove manually outside runtime scope |

## Runtime Exceptions To Keep

| Path | Why it stays | Notes |
|---|---|---|
| `search_cache.json` | non-authoritative cache | explicit Phase 6 exception unless separately migrated |
| `uploads/` | uploaded source files | asset storage, not metadata authority |
| `voice_audio/` | uploaded dictation binaries | asset storage |
| `voice_transcripts/` | transcript artifact files | asset storage unless later consolidated |
| `voice_graph_checkpoints/` | dictation checkpoint area | operational asset area |
| `live_conversation_audio/` | live-session audio assets | asset storage |
| `live_conversation_checkpoints/` | live-session checkpoint area | operational asset area |
| `masked_images/` | PHI-masked image outputs | asset storage |
| `prescriptions/` | generated prescription files | asset storage |

## Runtime Branches And Flags To Retire

| Flag | Current purpose | Phase 6 outcome |
|---|---|---|
| `ENABLE_DUAL_WRITE_PHASE_2A` | write both legacy stores and Postgres | remove after Postgres-only writes land |
| `ENABLE_PG_READ_AUTH` | auth read cutover | remove once auth reads are always Postgres-backed |
| `ENABLE_PG_READ_DOCUMENTS` | document read cutover | remove once document reads are always Postgres-backed |
| `ENABLE_PG_READ_VOICE` | voice/read-review cutover | remove once voice reads are always Postgres-backed |
| `ENABLE_PG_READ_LIVE` | live-session read cutover | remove once live-session reads are always Postgres-backed |
| `ENABLE_PG_READ_CHAT` | chat read cutover | remove once chat reads are always Postgres-backed |
| `ENABLE_PG_READ_AUDIT` | audit read cutover | remove once audit reads are always Postgres-backed |
| `ENABLE_PG_READ_ALERTS` | alerts read cutover | remove once alerts reads are always Postgres-backed |
| `ENABLE_PG_READ_ANALYTICS` | analytics read cutover | remove once analytics reads are always Postgres-backed |

## Functions That Must Disappear Or Change Ownership

### [server/index.cjs](../../server/index.cjs)

- `ensureStorage()` must stop creating retired metadata files.
- `ensureCollectionFile()` must not be used for retired metadata stores.
- `readDocuments()` / `writeDocuments()` / `mutateDocuments()` must become Postgres-only or move behind repository/service boundaries.
- `readVoiceSessions()` / `readVoiceReviews()` / `writeVoiceSessions()` / `mutateVoiceSessions()` must stop using file-backed primary state.
- `writeChatSessions()` / `writeChatActions()` / `writeChatExports()` must stop shadow-writing and use Postgres as the only runtime sink.
- `repairVoiceDocumentsFromSessions()` and `repairLiveConversationDocuments()` must be removed.

### [server/auth_service.cjs](../../server/auth_service.cjs)

- `ensureCollectionFile()`, `readUsersFromFilesystem()`, and `readSessionsFromFilesystem()` must become migration-only history, not runtime behavior.
- `bootstrapUsersIfNeededRaw()` must seed Postgres directly or be replaced with a separate admin/bootstrap path.

### [server/live_conversation_store.cjs](../../server/live_conversation_store.cjs)

- `writeSessions()` and `mutateSessions()` must stop using `live_conversation_sessions.json`.
- `logEvent()` and `getEvents()` must stop using `live_conversation_events.jsonl`.
- session create/update/finalize/delete flows must map to relational persistence, not file edits.

### [server/live_conversation_routes.cjs](../../server/live_conversation_routes.cjs)

- `createDashboardDocument()` must stop appending to `documents.json` and publish via repository/service boundaries.

### [server/audit_logger.cjs](../../server/audit_logger.cjs)

- `writeRuns()`, `mutateRuns()`, and `appendEvent()` must stop treating filesystem state as primary.

### [server/analytics_store.cjs](../../server/analytics_store.cjs)

- SQLite initialization and the SQLite fallback in `listMetrics()` must be removed or isolated into migration-only tooling.
- `backfillDocuments()` should become a one-time migration utility or be replaced with repository-backed recomputation logic.

### [server/prescription_service.cjs](../../server/prescription_service.cjs)

- `loadDocument()` and `loadLiveConversationDocument()` must stop reading `documents.json` and `live_conversation_sessions.json` directly.

## Expected Runtime Ownership After Phase 6

| Subsystem | Runtime owner after cleanup |
|---|---|
| Auth | `AuthRepository` |
| Documents + assets + extractions | `DocumentsRepository` and related services |
| Uploaded voice workflow | transcript/review repositories and document services |
| Live conversation workflow | `LiveSessionsRepository`, transcript/review repositories, audit/event boundary |
| Chat | `ChatRepository` |
| Audit | `AuditRepository` |
| Alerts | `AlertsRepository` |
| Analytics | `AnalyticsRepository` |

## Verification Target

After Phase 6 implementation, runtime code under `server/` should reference retired metadata filenames only in:

- backfill scripts under `server/db/`
- archive/restore tooling if added
- historical or migration documentation comments

Normal request-handling paths should no longer depend on those files.
