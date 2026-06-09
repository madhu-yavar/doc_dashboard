# Phase 3D: Chat + Audit + Alerts + Analytics Backfill Contract

## Date
2026-06-02

## Status
Planning-oriented implementation contract

## Purpose
Define the exact implementation contract for `Phase 3D` so the backfill of chat history, confirmed chat actions, chat exports, audit runs, audit events, alert delivery history, and analytics metrics is done against the real runtime stores in this repository.

This document exists to prevent schema drift during implementation. The current runtime stores are denormalized, partially cached, and in several places richer or poorer than the Phase 0 relational schema. `Phase 3D` must therefore use explicit deterministic rules instead of “best guess” migrations.

## Phase Boundary

### In scope

- `chat_sessions.json -> chat_sessions`
- embedded chat messages in `chat_sessions.json -> chat_messages`
- `chat_actions.json -> chat_confirmed_actions`
- `chat_exports.json -> chat_exports`
- `audit_runs.json -> audit_runs`
- `audit_events.jsonl -> audit_events`
- `pharmacy_alerts.jsonl -> alert_deliveries`
- `department_alerts.jsonl -> alert_deliveries`
- `analytics.sqlite -> analytics_document_metrics`

### Explicitly out of scope

- new transcript/review/workflow rows from voice or live session stores
- canonical document backfill
- patient/encounter reconciliation
- interop message ingestion
- retrofitting new enum values into the Phase 0 schema

Transcript/review ownership remains `Phase 3C`. Interop remains later work.

## Preconditions

- `Phase 3A`, `3B`, and `3C` have already completed.
- `Phase 3D` must reuse:
  - `ChatRepository`
  - `AuditRepository`
  - `AlertsRepository`
  - `AnalyticsRepository`
- `Phase 3D` must not invent parallel repositories or raw-SQL helpers when an existing repository already covers the target table.

## Current Runtime Truth

### Authoritative source stores

- `server/storage/chat_sessions.json`
- `server/storage/chat_actions.json`
- `server/storage/chat_exports.json`
- `server/storage/audit_runs.json`
- `server/storage/audit_events.jsonl`
- `server/storage/pharmacy_alerts.jsonl`
- `server/storage/department_alerts.jsonl`
- `server/storage/analytics.sqlite`

### Real wrapper shapes

- `chat_sessions.json` is `{ "sessions": [...] }`
- `chat_actions.json` is `{ "actions": [...] }`
- `chat_exports.json` is `{ "exports": [...] }`
- `audit_runs.json` is `{ "runs": [...] }`
- `audit_events.jsonl` is newline-delimited JSON objects

### Current chat session row family

Current chat sessions are stored as denormalized objects with fields such as:

| Field | Notes |
|---|---|
| `chatId` | stable chat session key |
| `documentId` | canonical document link |
| `createdAt` | first turn time |
| `updatedAt` | last mutation time |
| `messages[]` | all chat turns |
| `confirmedActions[]` | convenience current-state cache, not guaranteed complete history |
| `pendingExternalConsent` | pending external-search consent state |
| `pendingClarification` | pending clarification state |
| `pendingGeminiKeyPrompt` | pending provider prompt state |

Important limitation:

- current chat sessions do not persist `userId`

Postgres `chat_sessions.user_id` is required, so `Phase 3D` must use deterministic ownership rules rather than inventing a user.

### Current chat message row families

`session.messages[]` is heterogeneous.

Current message families include:

1. user/system messages with:
   - `id`
   - `role`
   - `content`
   - `createdAt`
2. assistant messages with:
   - `id`
   - `role`
   - `answer`
   - `citations`
   - `confidence`
   - `confidence_label`
   - `source_class`
   - `proposed_actions`
   - `decision_prompt`
   - `llm_provider`
   - `trace`
   - `createdAt`

### Current confirmed action sources

Confirmed chat actions exist in two places:

1. embedded in `chat_sessions[].confirmedActions`
2. append-only in `chat_actions.json`

`chat_actions.json` is the authoritative history source when both are present.

### Current export sources

Chat exports exist in two places:

1. append-only `chat_exports.json`
2. convenience cache `documents[].chatAssistantExport`

`chat_exports.json` is the authoritative history source when both are present.

### Current audit-run shape

Current `audit_runs.json` rows include:

| Field | Notes |
|---|---|
| `runId` | stable run id |
| `workflow` | current filesystem vocabulary, not Postgres vocabulary |
| `documentId` | nullable |
| `chatId` | nullable |
| `requestId` | nullable |
| `title` | run title |
| `actor` | string like `role:username` |
| `status` | current filesystem vocabulary, not Postgres vocabulary |
| `startedAt` | start time |
| `completedAt` | completion time |
| `durationMs` | latency |
| `metadata` | arbitrary metadata object |
| `summary` | arbitrary summary object |
| `error` | nullable error message |

### Current audit-event shape

Current `audit_events.jsonl` rows include:

| Field | Notes |
|---|---|
| `id` | stable event id |
| `timestamp` | event time |
| `runId` | nullable |
| `workflow` | current filesystem vocabulary |
| `documentId` | nullable |
| `chatId` | nullable |
| `requestId` | nullable |
| `type` | event type |
| `status` | current filesystem vocabulary such as `info`, `success`, `error` |
| `title` | human-readable label |
| `details` | arbitrary object |

### Current alert-log shapes

`pharmacy_alerts.jsonl` stores one row per pharmacy-alert attempt with nested channel results.

Important fields include:

- `timestamp`
- `documentId`
- `patientName`
- `patientMrn`
- `doctorName`
- `medicationCount`
- `medications`
- `trigger`
- `results.email`
- `results.whatsapp`
- `results.errors`

`department_alerts.jsonl` stores one row per department-alert attempt with:

- `timestamp`
- `documentId`
- `patientName`
- `patientMrn`
- `doctorName`
- `departments[]`
- `results.<department>`

### Current analytics source shape

`analytics.sqlite` contains `document_metrics` rows with:

- `document_id`
- `document_name`
- `document_type`
- `processed_at`
- `uploaded_at`
- `gemma_tokens`
- `gemini_tokens`
- `total_tokens`
- `medications_count`
- `lab_tests_count`
- `radiology_tests_count`
- `nuclear_medicine_tests_count`
- `procedures_count`

The Phase 0 `analytics_document_metrics` table is richer than this source and must therefore use a mix of:

- direct-copy fields from SQLite
- deterministic derived fields from already-backfilled relational data
- explicit defaults for fields that have no reliable historical source

## Core Rules

### 1. Chat ownership must be deterministic

Postgres `chat_sessions.user_id` is required.

Use this precedence:

1. if a future chat session row explicitly contains `userId`, use it
2. else if there is exactly one matching audit run with:
   - matching `chatId`, and
   - resolvable `metadata.authenticatedUser.username`
   then use that resolved `users.id`
3. else skip the chat session and report `missing_chat_user_id`

Do not guess chat ownership from:

- document uploader
- current authenticated admin
- document patient/doctor names

### 2. `chat_actions.json` is primary history, embedded `confirmedActions` is fallback only

When both exist:

- backfill `chat_confirmed_actions` from `chat_actions.json`
- use embedded `session.confirmedActions` only to fill gaps for sessions whose action file history is empty

Do not double-insert actions that appear in both places.

### 3. `chat_exports.json` is primary history, document cache is fallback only

When both exist:

- backfill `chat_exports` from `chat_exports.json`
- use `documents[].chatAssistantExport` only when no matching row exists in the exports file

### 4. Audit workflow normalization is explicit

Current filesystem audit vocabulary includes values such as:

- `extraction`

Postgres `workflow_enum` only allows:

- `document_processing`
- `voice_upload`
- `live_conversation`
- `chat`
- `audit`
- `external_sync`

Use only this mapping:

| Source workflow / source evidence | Postgres `workflow` |
|---|---|
| `workflow = chat` | `chat` |
| `workflow = extraction` and linked canonical document is `voice_dictation` | `voice_upload` |
| `workflow = extraction` and linked canonical document is `live_conversation` | `live_conversation` |
| `workflow = extraction` and linked canonical document is not voice/live | `document_processing` |
| audit-maintenance workflow rows if later introduced | `audit` |

If no deterministic workflow mapping exists, skip the row and report it. Do not invent enum values.

### 5. Audit status normalization is explicit

Use only this mapping for `audit_runs.status`:

| Filesystem audit-run status | Postgres `audit_runs.status` |
|---|---|
| `running` | `in_progress` |
| `completed` | `completed` |
| `failed` | `failed` |

Use only this mapping for `audit_events.status`:

| Filesystem event status | Postgres `audit_events.status` |
|---|---|
| `info` | `started` |
| `success` | `completed` |
| `error` | `failed` |
| `warning` | `warning` |

### 6. Alert enums are coarser than the current log vocabulary

The Phase 0 schema does not allow:

- `channel = whatsapp`
- `alert_family = lab`
- `alert_family = radiology`
- `alert_family = nuclear_medicine`
- `alert_family = procedures`

Therefore:

- pharmacy alert rows use `alert_family = pharmacy`
- department alert rows use `alert_family = department`
- specific department names go in `target_name`
- only email delivery rows are inserted as standalone `alert_deliveries`
- WhatsApp outcomes are preserved inside `result_jsonb`, not as separate rows

Do not invent unsupported enum values.

### 7. Analytics backfill is hybrid: direct copy + deterministic derivation + explicit defaults

Use:

- `analytics.sqlite` for the fields it actually tracks
- already-backfilled relational data from `3B` and `3C` for deterministic derived metrics
- explicit defaults for unsupported historical fields

Do not pretend `analytics.sqlite` already contains columns it never stored.

## Required Field Mapping

### `chat_sessions.json -> chat_sessions`

| Filesystem | Postgres | Rule |
|---|---|---|
| `chatId` | `id` | preserve |
| `documentId` | `document_id` | preserve when canonical document exists |
| deterministic user resolution | `user_id` | required; skip if missing |
| none | `status` | `active` unless session was explicitly deleted from source |
| `pendingExternalConsent` | `pending_external_consent_jsonb` | preserve |
| `pendingClarification` | `pending_clarification_jsonb` | preserve |
| `pendingGeminiKeyPrompt` | `pending_provider_prompt_jsonb` | preserve |
| `createdAt` | `created_at` | preserve |
| `updatedAt` | `updated_at` | preserve |

### `chat_sessions[].messages[] -> chat_messages`

#### General rules

- preserve source message order
- use `message.createdAt` when present
- if a source message is missing `createdAt`, assign a deterministic monotonic fallback based on `session.createdAt + messageOrderMillis`

#### User/system message mapping

| Source | Target |
|---|---|
| `id` | `id` |
| `chatId` | `chat_session_id` |
| `role` | `role` |
| `content` | `content` |
| none | `citations_jsonb = []` |
| none | `confidence_score = NULL` |
| none | `confidence_label = NULL` |
| none | `source_class = NULL` |
| none | `proposed_actions_jsonb = []` |
| none | `decision_prompt_jsonb = {}` |
| raw source message | `trace_jsonb.source_message` |
| none | `provider = NULL` |
| `createdAt` | `created_at` |

#### Assistant message mapping

| Source | Target |
|---|---|
| `id` | `id` |
| `chatId` | `chat_session_id` |
| `role` | `role` |
| `answer` | `content` |
| `citations` | `citations_jsonb` |
| `confidence` | `confidence_score` |
| `confidence_label` | `confidence_label` |
| `source_class` | `source_class` |
| `proposed_actions` | `proposed_actions_jsonb` |
| `decision_prompt` | `decision_prompt_jsonb` |
| `trace` plus raw source message | `trace_jsonb` |
| `llm_provider` | `provider` |
| `createdAt` | `created_at` |

### Confirmed actions -> `chat_confirmed_actions`

#### Primary source: `chat_actions.json`

| Source | Target | Rule |
|---|---|---|
| `id` | `id` | preserve |
| `chatId` | `chat_session_id` | preserve |
| `documentId` | `document_id` | preserve |
| `type` or equivalent | `action_type` | preserve |
| `title` | `title` | preserve |
| `rationale` | `rationale` | preserve |
| full action object | `payload_jsonb` | preserve |
| none unless deterministic user resolution exists | `confirmed_by_user_id` | nullable |
| `confirmedAt` | `confirmed_at` | preserve |
| `confirmedAt` or fallback | `created_at` | preserve best available |

#### Fallback source: embedded `session.confirmedActions[]`

Use only when no matching action exists in `chat_actions.json`.

### Chat exports -> `chat_exports`

#### Primary source: `chat_exports.json`

| Source | Target | Rule |
|---|---|---|
| `id` | `id` | preserve |
| `chatId` | `chat_session_id` | preserve |
| `documentId` | `document_id` | preserve |
| raw export row | `export_payload_jsonb` | preserve |
| none unless deterministic user resolution exists | `created_by_user_id` | nullable |
| `createdAt` | `created_at` | preserve |

#### Fallback source: `documents[].chatAssistantExport`

Use only when the exports file has no matching row.

### `audit_runs.json -> audit_runs`

| Source | Target | Rule |
|---|---|---|
| `runId` | `id` | preserve |
| normalized workflow | `workflow` | use explicit workflow table |
| `documentId` | `document_id` | preserve when canonical document exists |
| `chatId` | `chat_session_id` | preserve when matching chat session exists |
| `requestId` | `request_id` | preserve |
| resolved user from `actor` or `metadata.authenticatedUser.username` | `actor_user_id` | nullable |
| raw `actor` string | `actor_label` | preserve |
| normalized run status | `status` | use explicit table |
| `title` | `title` | preserve |
| `metadata` | `metadata_jsonb` | preserve |
| `summary` | `summary_jsonb` | preserve |
| `error` | `error_message` | preserve |
| `startedAt` | `started_at` | preserve |
| `completedAt` | `completed_at` | preserve |
| `durationMs` | `duration_ms` | preserve |
| `startedAt` or fallback | `created_at` | preserve best available |

### `audit_events.jsonl -> audit_events`

| Source | Target | Rule |
|---|---|---|
| `id` | `id` | preserve |
| `runId` | `audit_run_id` | preserve when matching run exists |
| normalized workflow | `workflow` | use explicit workflow table |
| `documentId` | `document_id` | preserve when canonical document exists |
| `chatId` | `chat_session_id` | preserve when matching chat session exists |
| `type` | `event_type` | preserve |
| normalized event status | `status` | use explicit status table |
| `title` | `title` | preserve |
| `details` plus `requestId` when useful | `details_jsonb` | preserve |
| `timestamp` | `occurred_at` | preserve |
| `timestamp` | `created_at` | preserve |

### Pharmacy alert log -> `alert_deliveries`

Create one row per pharmacy log row for the email channel only.

| Source | Target | Rule |
|---|---|---|
| deterministic generated id | `id` | namespaced by source log row |
| `documentId` | `document_id` | preserve when canonical document exists |
| none | `alert_family` | always `pharmacy` |
| medication batch cardinality | `target_name` | one medication -> medication name; more than one -> `medication_batch` |
| none | `channel` | always `email` |
| `results.email.to[0]` or equivalent | `recipient` | preserve |
| normalized email outcome | `status` | `sent` or `failed` only |
| source alert row without nested results | `payload_jsonb` | preserve |
| full `results` object | `result_jsonb` | preserve, including WhatsApp outcome if present |
| first error when present | `error_message` | preserve |
| `timestamp` | `sent_at` | preserve for historical delivery time |
| `timestamp` | `created_at` | preserve |

### Department alert log -> `alert_deliveries`

Create one email-channel row per department result key.

Use:

- `alert_family = department`
- `target_name = department key` such as `lab`, `radiology`, `nuclear_medicine`, `procedures`

Do not create separate WhatsApp rows because the Phase 0 channel enum cannot represent them.

### `analytics.sqlite -> analytics_document_metrics`

#### Direct-copy fields from SQLite

| SQLite source | Postgres target | Rule |
|---|---|---|
| `document_id` | `document_id` | preserve |
| `document_name` | `document_name` | preserve |
| normalized `document_type` | `document_type` | map `voice -> voice_dictation`; preserve allowed canonical values |
| `processed_at` | `processed_at` | preserve |
| `uploaded_at` | `uploaded_at` | preserve |
| `gemma_tokens` | `gemma_tokens` | preserve |

#### Deterministic derived fields

Use already-backfilled relational data for:

| Postgres metric | Derivation rule |
|---|---|
| `transcript_takes` | `1` when a voice/live transcript exists, else `0` |
| `transcript_confidence` | transcript quality overall confidence from `3C` when present |
| `voice_review_items` | count of `review_items` linked to voice documents |
| `voice_review_items_resolved` | count of voice review items whose `current_resolution != pending` |
| `live_review_items` | count of `review_items` linked to live sessions |
| `live_review_items_resolved` | count of live review items whose `current_resolution != pending` |
| `medications_count` | prefer current `documents` payload count; fall back to SQLite `medications_count` |
| `diagnoses_count` | deterministic count from canonical document extraction payload |
| `ordered_lab_count` | prefer canonical document extraction count; fall back to SQLite `lab_tests_count` |
| `ordered_radiology_count` | prefer canonical document extraction count; fall back to SQLite `radiology_tests_count` |
| `nuclear_medicine_count` | prefer canonical document extraction count; fall back to SQLite `nuclear_medicine_tests_count` |
| `procedures_count` | prefer canonical document extraction count; fall back to SQLite `procedures_count` |

#### Explicit default fields

Use these defaults unless a deterministic source is later proven:

| Postgres field | Default |
|---|---|
| `gemma_cache_hit` | `FALSE` |
| `lab_results_count` | `0` |
| `radiology_results_count` | `0` |
| `ordered_medications_count` | `0` |
| `has_occupational_therapy` | `FALSE` unless explicitly present in canonical extraction payload |
| `has_dietary_recommendations` | `FALSE` unless explicitly present in canonical extraction payload |
| `has_patient_education` | `FALSE` unless explicitly present in canonical extraction payload |

#### Metadata preservation

Preserve these SQLite-only values inside `metadata_jsonb`:

- `gemini_tokens`
- `total_tokens`
- original SQLite row
- derivation flags showing which fields were copied vs derived vs defaulted

## Execution Order

Run `Phase 3D` in this exact order:

1. snapshot current source counts
2. load `chat_sessions.json`
3. resolve deterministic chat-session user ownership
4. create `chat_sessions`
5. create `chat_messages`
6. load `chat_actions.json`
7. create `chat_confirmed_actions` from file history
8. fill any remaining deterministic gaps from embedded `confirmedActions`
9. load `chat_exports.json`
10. create `chat_exports` from file history
11. fill any remaining deterministic gaps from `documents[].chatAssistantExport`
12. load `audit_runs.json`
13. create `audit_runs`
14. load `audit_events.jsonl`
15. create `audit_events`
16. load `pharmacy_alerts.jsonl`
17. create pharmacy `alert_deliveries`
18. load `department_alerts.jsonl`
19. create department `alert_deliveries`
20. read `analytics.sqlite`
21. create `analytics_document_metrics`
22. emit backfill report

## Required Backfill Report

`Phase 3D` must emit a machine-readable report with:

- total chat session count
- inserted `chat_sessions` count
- inserted `chat_messages` count
- skipped chat sessions because `user_id` could not be resolved deterministically
- inserted `chat_confirmed_actions` count from file history
- inserted fallback `chat_confirmed_actions` count from embedded session cache
- inserted `chat_exports` count from file history
- inserted fallback `chat_exports` count from document cache
- inserted `audit_runs` count
- inserted `audit_events` count
- inserted `alert_deliveries` count by `alert_family`
- alert rows whose WhatsApp outcomes were preserved only inside `result_jsonb`
- inserted `analytics_document_metrics` count
- analytics rows with derived fields
- analytics rows with defaulted fields
- skipped rows because enum normalization was impossible

## Exit Gate

`Phase 3D` is complete only when all of the following are true:

- every inserted `chat_sessions.user_id` was resolved deterministically
- no chat session was assigned to a guessed user
- `chat_actions.json` history was not duplicated with embedded `confirmedActions`
- `chat_exports.json` remained the primary export history source
- every inserted audit run/event uses an allowed Phase 0 `workflow_enum`
- every inserted audit event uses an allowed Phase 0 `event_status_enum`
- no unsupported alert enum values were invented for channel or family
- department alerts were stored with `alert_family = department` and the specific department in `target_name`
- WhatsApp outcomes were preserved without inventing unsupported `channel = whatsapp`
- every analytics row documents which fields were copied, derived, or defaulted
- SQLite-only token fields such as `gemini_tokens` and `total_tokens` were preserved in `metadata_jsonb`

## Non-Goals

- guessing chat ownership from document uploader or current admin
- inventing unsupported alert enum values
- forcing WhatsApp into a nonexistent channel enum
- duplicating convenience caches as if they were primary history
- pretending `analytics.sqlite` already contains every Phase 0 analytics field
