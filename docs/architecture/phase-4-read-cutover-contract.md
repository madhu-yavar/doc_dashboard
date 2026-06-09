# Phase 4: Read Cutover Contract

## Date
2026-06-02

## Status
Implementation contract

## Purpose
Define the exact implementation contract for `Phase 4` so runtime metadata reads are cut over from filesystem/SQLite stores to PostgreSQL in a controlled, reversible order.

This document exists because the canonical interoperability plan defines the Phase 4 sequence but does not yet pin the work to the actual read seams in this repository. Phase 4 changes live runtime behavior. It must therefore be implemented behind explicit subsystem flags, with parity checks and rollback paths, not as an all-at-once rewrite.

## Phase Boundary

### In scope

- auth reads from `users.json` / `auth_sessions.json`
- document metadata reads from `documents.json`
- document-linked extraction/chart-note/prescription metadata reads from Postgres-backed relations
- uploaded voice transcript and review workflow reads from `voice_sessions.json` / `voice_reviews.json`
- live conversation workflow reads from `live_conversation_sessions.json`
- chat session/message/action/export reads from `chat_sessions.json`, `chat_actions.json`, `chat_exports.json`
- audit run/event reads from `audit_runs.json`, `audit_events.jsonl`
- alert delivery reads from `pharmacy_alerts.jsonl`, `department_alerts.jsonl`
- analytics reads from `analytics.sqlite`
- parity-reporting and rollback support for every cutover step

### Explicitly out of scope

- disabling dual-write
- deleting or archiving legacy JSON/JSONL/SQLite stores
- stopping filesystem metadata writes
- object-storage migration
- interop adapter enablement
- identity reconciliation
- search cache migration from `search_cache.json`
- binary file serving changes for uploaded PDFs, audio files, masked images, or generated prescriptions

`search_cache.json` remains file-backed in Phase 4 because it is not part of the current relational contract.

## Preconditions

- `Phase 3A`, `Phase 3B`, `Phase 3C`, and `Phase 3D` are complete and have passed their exit gates.
- Known correctness blockers from earlier phases are resolved before Phase 4 implementation starts.
- The target environment keeps `ENABLE_DUAL_WRITE_PHASE_2A=true` throughout Phase 4 rollout.
- PostgreSQL backfill parity has already been validated for the subsystem being cut over.
- The repository layer exists and is the only allowed Postgres read boundary:
  - `AuthRepository`
  - `DocumentsRepository`
  - `TranscriptsRepository`
  - `LiveSessionsRepository`
  - `ChatRepository`
  - `AuditRepository`
  - `AlertsRepository`
  - `AnalyticsRepository`
- Review-workflow read access introduced in `Phase 3C` exists as either:
  - a dedicated review-workflow repository, or
  - one tightly scoped read module for `review_items` and `review_item_resolutions`

Phase 4 must not bypass those boundaries with ad hoc SQL inside routes or service files.

## Current Runtime Truth

### Authoritative live read seams today

Current runtime metadata reads are still file-backed or SQLite-backed in these places:

| Subsystem | Current reader | Current source |
|---|---|---|
| Auth | `AuthService.readUsers()` / `AuthService.readSessions()` in `server/auth_service.cjs` | `users.json`, `auth_sessions.json` |
| Documents | `readDocuments()` in `server/index.cjs` | `documents.json` |
| Voice uploads | `readVoiceSessions()` / `updateVoiceSession()` / `mutateVoiceSessions()` in `server/index.cjs` | `voice_sessions.json` |
| Voice reviews | `readCollection(voiceReviewsPath, "reviews")` in `server/index.cjs` | `voice_reviews.json` |
| Live workflow | `LiveConversationStore.readSessions()` in `server/live_conversation_store.cjs`, consumed by `server/live_conversation_routes.cjs` | `live_conversation_sessions.json` |
| Chat | `readCollection(chatSessionsPath, "sessions")`, `readCollection(chatActionsPath, "actions")`, `readCollection(chatExportsPath, "exports")` in `server/index.cjs`; `DoctorAssistantAgent` closures are also wired to those readers | `chat_sessions.json`, `chat_actions.json`, `chat_exports.json` |
| Audit | `AuditLogger.readRuns()`, `getRuns()`, `getRun()`, `getEvents()` in `server/audit_logger.cjs` | `audit_runs.json`, `audit_events.jsonl` |
| Analytics | `AnalyticsStore.listMetrics()` and related methods in `server/analytics_store.cjs` | `analytics.sqlite` |

### Important current constraints

- `server/index.cjs` contains many direct callers of `readDocuments()` and `readCollection(...)`. Phase 4 must replace those through shared read abstractions, not by scattering one-off conditionals route by route.
- `DoctorAssistantAgent` currently receives closures for `readSessions`, `writeSessions`, `readSearchCache`, and `writeSearchCache`. Only chat-session reads are in scope for Postgres cutover. Search-cache reads remain file-backed.
- `LiveConversationRoutes` currently depends on `LiveConversationStore`, which is JSON-backed. Phase 4 live cutover must replace that dependency with a Postgres-backed read path while preserving API response shape.
- File assets remain on disk. Phase 4 changes metadata ownership, not file serving.

## Required Feature Flags

Phase 4 must use subsystem-specific read flags. No global "use Postgres for everything" flag is allowed.

Introduce these environment flags, all defaulting to `false`:

- `ENABLE_PG_READ_AUTH`
- `ENABLE_PG_READ_DOCUMENTS`
- `ENABLE_PG_READ_VOICE`
- `ENABLE_PG_READ_LIVE`
- `ENABLE_PG_READ_CHAT`
- `ENABLE_PG_READ_AUDIT`
- `ENABLE_PG_READ_ALERTS`
- `ENABLE_PG_READ_ANALYTICS`

Rules:

- each flag gates reads for exactly one subsystem family
- flags must be evaluated centrally in storage-access layers or service boundaries
- disabling a flag must immediately restore filesystem/SQLite reads for that subsystem
- flags must not affect write behavior; dual-write remains on during Phase 4

## Target Read Ownership

### Auth

Filesystem readers:

- `AuthService.readUsers()`
- `AuthService.readSessions()`

Target Postgres reader:

- `AuthRepository`

Required cutover behavior:

- login, session authentication, session refresh, and logout read from PostgreSQL when `ENABLE_PG_READ_AUTH=true`
- public auth response shape must remain unchanged

### Documents

Filesystem reader:

- `readDocuments()` in `server/index.cjs`

Target Postgres reader:

- `DocumentsRepository`

Required cutover behavior:

- document-list and document-detail reads come from PostgreSQL when `ENABLE_PG_READ_DOCUMENTS=true`
- document-linked extraction/chart-note/prescription pointers are read from relational tables, not inferred from legacy JSON helpers
- public API output must stay compatible with the current response shape

### Voice Transcript And Review Workflow

Filesystem readers:

- `readVoiceSessions()`
- `readCollection(voiceReviewsPath, "reviews")`

Target Postgres readers:

- `TranscriptsRepository`
- `DocumentsRepository`
- review-workflow repository/module from `Phase 3C`

Required cutover behavior:

- uploaded voice transcript state, segments, review items, and current review resolutions come from PostgreSQL when `ENABLE_PG_READ_VOICE=true`
- canonical document linkage for uploaded dictation comes from relational references created in `Phase 3B/3C`
- no route may read `voice_reviews.json` directly once the flag is enabled

### Live Conversation Workflow

Filesystem reader:

- `LiveConversationStore.readSessions()`

Target Postgres readers:

- `LiveSessionsRepository`
- `TranscriptsRepository`
- review-workflow repository/module from `Phase 3C`

Required cutover behavior:

- live-session list/detail reads, current transcript state, current review state, and draft extraction state come from PostgreSQL when `ENABLE_PG_READ_LIVE=true`
- live workflow must not rely on document-hydration repair from JSON
- current API response shape from `LiveConversationRoutes` must remain stable

### Chat

Filesystem readers:

- `readCollection(chatSessionsPath, "sessions")`
- `readCollection(chatActionsPath, "actions")`
- `readCollection(chatExportsPath, "exports")`
- `DoctorAssistantAgent` injected `readSessions` closure

Target Postgres reader:

- `ChatRepository`

Required cutover behavior:

- chat history, message history, confirmed actions, and exports read from PostgreSQL when `ENABLE_PG_READ_CHAT=true`
- `search_cache.json` remains file-backed and is not part of this cutover
- no chat session may be attached to a guessed user; Phase 3D deterministic ownership remains authoritative

### Audit

Filesystem readers:

- `AuditLogger.readRuns()`
- `AuditLogger.getRuns()`
- `AuditLogger.getRun()`
- `AuditLogger.getEvents()`

Target Postgres reader:

- `AuditRepository`

Required cutover behavior:

- audit run and event reads come from PostgreSQL when `ENABLE_PG_READ_AUDIT=true`
- workflow and status values must already conform to Phase 0 enums from Phase 3D backfill

### Alerts

Current source stores:

- `pharmacy_alerts.jsonl`
- `department_alerts.jsonl`

Target Postgres reader:

- `AlertsRepository`

Required cutover behavior:

- alert-delivery reads come from PostgreSQL when `ENABLE_PG_READ_ALERTS=true`
- WhatsApp outcomes remain preserved inside `result_jsonb`; do not invent unsupported channel enums

### Analytics

Current reader:

- `AnalyticsStore`

Target Postgres reader:

- `AnalyticsRepository`

Required cutover behavior:

- analytics and processing-insight reads come from `analytics_document_metrics` when `ENABLE_PG_READ_ANALYTICS=true`
- SQLite remains intact for rollback until Phase 6

## Implementation Rules

### 1. Cut over reads by subsystem, not by scattered route edits

Phase 4 must introduce shared read abstractions or service boundaries so the flag decision happens once per subsystem family.

Bad:

- dozens of unrelated `if (ENABLE_PG_READ_...)` branches spread through route handlers

Good:

- one auth read boundary
- one documents read boundary
- one voice read boundary
- one live-session read boundary
- one chat read boundary
- one audit read boundary
- one alerts read boundary
- one analytics read boundary

### 2. Keep public API response shapes stable

Repository-backed reads may require transformation into legacy API shapes. Phase 4 must preserve externally observed response contracts unless the user-facing API docs are deliberately revised.

### 3. Keep writes dual-written

Phase 4 is read cutover only. Metadata writes must continue to hit both stores until Phase 6 cleanup.

### 4. Do not remove fallback stores

JSON, JSONL, and SQLite files remain present and readable throughout Phase 4 for:

- rollback
- parity comparison
- operational debugging

### 5. Extend repositories before cutting over routes

If an existing repository lacks a required read method, add that method to the repository first. Do not drop back to ad hoc SQL in route files.

### 6. Treat missing parity as a blocker

If a subsystem cannot prove parity, its read flag stays `false`.

### 7. Interop remains disabled

No HL7/FHIR adapter or interop read/write path may be enabled during Phase 4.

## Required Parity Checks Before Each Cutover

### Auth

- user counts match filesystem users
- active session counts match filesystem sessions after expiry filtering
- login works
- authenticated requests succeed
- logout and session revocation work

### Documents

- document row counts match `documents.json`
- document IDs and normalized statuses match
- current extraction/chart-note/prescription pointers are present where expected
- chart-note and prescription related UI/API reads still render correctly

### Voice

- voice transcript counts match uploaded voice session counts eligible for relational ownership
- transcript segment counts match source payloads
- review item counts match source payloads
- current review resolutions match source state

### Live

- live session counts match relational backfill set
- live session statuses match explicit normalization rules from `Phase 3C`
- current transcript and review state match the source JSON session state
- draft extraction payloads are preserved

### Chat

- chat session counts match
- chat message counts match
- confirmed action counts match without double-counting embedded caches
- export counts match file history

### Audit

- audit run counts match
- audit event counts match
- workflows and statuses are valid Phase 0 enum values

### Alerts

- alert delivery counts match expanded JSONL history
- pharmacy/department families match the Phase 3D mapping
- WhatsApp results remain preserved in `result_jsonb`

### Analytics

- `analytics_document_metrics` count matches `analytics.sqlite`
- derived/defaulted fields are documented and stable
- existing processing-insights UI/API outputs remain compatible

## Execution Order

Run `Phase 4` in this exact order:

1. add the Phase 4 read flags with defaults of `false`
2. build shared read abstractions for each subsystem
3. implement auth Postgres-backed reads
4. validate auth parity and rollback
5. enable auth cutover
6. implement documents Postgres-backed reads
7. validate documents parity and rollback
8. enable documents cutover
9. implement uploaded voice transcript/review Postgres-backed reads
10. validate voice parity and rollback
11. enable voice cutover
12. implement live conversation workflow Postgres-backed reads
13. validate live parity and rollback
14. enable live cutover
15. implement chat Postgres-backed reads
16. validate chat parity and rollback
17. enable chat cutover
18. implement audit Postgres-backed reads
19. validate audit parity and rollback
20. enable audit cutover
21. implement alerts Postgres-backed reads
22. validate alerts parity and rollback
23. enable alerts cutover
24. implement analytics Postgres-backed reads
25. validate analytics parity and rollback
26. enable analytics cutover
27. emit the Phase 4 cutover report

No later subsystem may be enabled while an earlier subsystem is still failing parity.

## Required Cutover Report

Phase 4 must emit a machine-readable report with:

- the flag state for every subsystem
- which code boundary was cut over for each subsystem
- parity result per subsystem
- rollback result per subsystem
- auth login/session verification result
- document/extraction/chart-note/prescription read verification result
- voice transcript/review verification result
- live workflow verification result
- chat verification result
- audit verification result
- alert verification result
- analytics verification result
- any subsystem that remained disabled and the exact blocker

## Exit Gate

Phase 4 is complete only when all of the following are true:

- each in-scope subsystem reads from PostgreSQL behind its own flag
- each subsystem was validated for parity before enablement
- each subsystem rollback path was exercised successfully
- enabling one subsystem did not require enabling unrelated subsystems
- filesystem and SQLite stores remain intact for rollback
- `ENABLE_DUAL_WRITE_PHASE_2A` remains on during cutover validation
- public API response shapes remain compatible
- `search_cache.json` remains explicitly out of scope and still works
- interop adapters remain disabled

## Rollback Rules

- rollback for a subsystem is performed by setting only that subsystem's `ENABLE_PG_READ_*` flag back to `false`
- rollback must not require data migration, repair scripts, or manual file edits
- if parity diverges after enablement, the subsystem must be rolled back immediately and reported as blocked
- rollback of one subsystem must not disable or corrupt already validated earlier subsystems

## Non-Goals

- deleting legacy stores
- changing write ownership
- changing public API contracts by accident
- forcing `search_cache.json` into Postgres during Phase 4
- enabling interop before core read cutover is stable
- masking parity gaps with "best effort" fallbacks

