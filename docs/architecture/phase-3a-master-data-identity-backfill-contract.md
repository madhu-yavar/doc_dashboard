# Phase 3A: Master Data + Identity Backfill Contract

## Date
2026-06-02

## Status
Planning-oriented implementation contract

## Purpose
Define the exact implementation contract for `Phase 3A` so the backfill of app identity, provisional master data, and observed identifiers is done against the real runtime stores in this repository.

This document is intentionally narrower than the canonical architecture plan. It exists to remove ambiguity for the implementation team.

## Phase Boundary

### In scope

- `users.json -> users`
- `auth_sessions.json -> auth_sessions`
- provisional `patients`
- provisional `encounters`
- `patient_identifiers`
- `encounter_identifiers`
- deterministic `practitioners`
- nullable `users.practitioner_id` linkage

### Explicitly out of scope

- transcript/review/session backfill from `voice_sessions.json` and `live_conversation_sessions.json`
- document payload backfill into `documents`, `document_extractions`, `document_assets`
- alert delivery history
- analytics migration
- live HL7/FHIR adapter activation

Those belong to later phases even though `3A` is allowed to read document and session stores for identity harvesting.

## Preconditions

- `Phase 0` schema exists and has been code-review approved.
- `Phase 1` repositories exist and have been code-review approved.
- `Phase 2A` auth/document dual-write is stable enough that current filesystem shapes are known and preserved.
- `Phase 3A` must use the existing repositories:
  - `AuthRepository`
  - future identity/master-data repository layer or direct migration script scoped to the Phase 0 schema
- `Phase 3A` must not invent parallel data-access classes that duplicate repository behavior.

## Current Runtime Truth

### Authoritative source stores

- `server/storage/users.json`
- `server/storage/auth_sessions.json`
- `server/storage/documents.json`
- `server/storage/voice_sessions.json`
- `server/storage/live_conversation_sessions.json`

### Real wrapper shapes

- `users.json` is `{ "users": [...] }`
- `auth_sessions.json` is `{ "sessions": [...] }`
- `documents.json` is `{ "documents": [...] }`
- `voice_sessions.json` is `{ "sessions": [...] }`
- `live_conversation_sessions.json` is `{ "sessions": [...] }`

The implementation must preserve those shapes during read-only harvesting. No temporary rewrite of the source files is allowed in `Phase 3A`.

## Source Records To Harvest

### Users

Current filesystem user fields:

| Filesystem field | Notes |
|---|---|
| `id` | already stable |
| `username` | unique app login identifier |
| `passwordHash` | bcrypt hash |
| `role` | currently `admin` or `doctor` |
| `displayName` | human-readable app label |
| `createdAt` | may be the only timestamp present |

### Sessions

Current filesystem session fields:

| Filesystem field | Notes |
|---|---|
| `sessionId` | current session token and stable unique key |
| `userId` | references `users.json.id` |
| `username` | denormalized convenience field |
| `role` | denormalized convenience field |
| `displayName` | denormalized convenience field |
| `createdAt` | session creation time |
| `expiresAt` | required for active/expired filtering |
| `lastSeenAt` | last-touch timestamp |

### Identity-bearing signals from documents and sessions

Identity harvesting is read-only from these fields:

- `documents[].linkedPatient`
- `documents[].encounterLabel`
- `documents[].result.extracted_data.patient.*`
- `documents[].result.sample_patient_data.*`
- `documents[].result.meta.*`
- `documents[].result.stage1.*`
- `voice_sessions[].linkedPatient`
- `voice_sessions[].encounterLabel`
- `voice_sessions[].extractedData.patient.*`
- `live_conversation_sessions[].linkedPatient`
- `live_conversation_sessions[].encounterLabel`
- `live_conversation_sessions[].draftExtraction.extractedData.patient.*`

## Implementation Rules

### 1. Reuse existing auth repository

Use `server/repositories/auth_repository.cjs` for `users` and `auth_sessions`. Do not bypass it with new ad hoc SQL.

### 2. Skip expired sessions

`auth_sessions.json` is not migrated 1:1 blindly. Backfill only sessions whose `expiresAt` is still in the future at migration time.

The backfill report must record:

- total sessions seen
- active sessions inserted
- expired sessions skipped

### 3. Do not merge people by name alone

Patient or encounter creation must never merge two source records using only:

- `linkedPatient`
- patient name
- `encounterLabel`

If no deterministic identifier exists, create a source-scoped provisional record.

### 4. Labels are not master identifiers

These values are labels, not canonical identifiers:

- `linkedPatient`
- `encounterLabel`

They may populate:

- `patients.display_name`
- `encounters.details_jsonb.observed_labels`
- `documents.linked_patient_label`
- `documents.encounter_label`

They must not be promoted to `patient_identifiers` or `encounter_identifiers` in `Phase 3A`.

### 5. Only true identifier-like values go into identifier tables

Allowed patient identifier candidates:

- `mrn`
- `hospital_no`
- `hospital_number`

Allowed encounter identifier candidates:

- `ipd_number`
- `opd_number`
- `episode_number`

`Phase 3A` must not invent regex-based identifier extraction from arbitrary strings.

### 6. Backfill statuses are conservative

- new `patients.identity_state = provisional`
- new `encounters.identity_state = provisional`
- new identifier rows use `status = observed`
- no `verified` status is allowed during backfill
- no reconciliation case is auto-resolved during backfill

## Required Field Mapping

### `users.json -> users`

| Filesystem | Postgres | Rule |
|---|---|---|
| `id` | `id` | preserve |
| `username` | `username` | preserve |
| `passwordHash` | `password_hash` | preserve |
| `role` | `role` | preserve |
| `displayName` | `display_name` | preserve |
| `createdAt` | `created_at` | preserve if present |
| `createdAt` or backfill time | `updated_at` | use `createdAt` if no better timestamp |
| none | `status` | set `active` |

### `auth_sessions.json -> auth_sessions`

| Filesystem | Postgres | Rule |
|---|---|---|
| `sessionId` | `id` | preserve for deterministic backfill |
| `sessionId` | `session_token` | preserve |
| `userId` | `user_id` | preserve |
| `expiresAt` | `expires_at` | preserve |
| `lastSeenAt` | `last_seen_at` | preserve |
| none | `revoked_at` | `NULL` |
| `createdAt` | `created_at` | preserve |

### `users -> practitioners`

Create practitioner rows only for clinically meaningful roles.

Current rule:

- create practitioner for `role = doctor`
- do not create practitioner for `role = admin`

| User source | Practitioner target | Rule |
|---|---|---|
| `users.id` | `practitioner_jsonb.backfill_user_id` | preserve as trace |
| `displayName` or `username` | `display_name` | deterministic fallback |
| `role` | `role_code` | preserve |
| none | `npi_or_registration_no` | `NULL` |

Then set `users.practitioner_id` only when a practitioner row was deterministically created.

## Provisional Identity Creation Rules

### Patient natural-key strategy

Use this precedence:

1. `mrn`
2. `hospital_no` or `hospital_number`

If one of those exists:

- normalize to lowercase trimmed string
- create or reuse one `patients` row per unique (`identifier_system`, `identifier_value`)
- create one `patient_identifiers` row with:
  - `status = observed`
  - `source_system` set to the source store name
  - `identifier_type` set from the original field name

If neither exists:

- create one source-scoped provisional patient per source record
- do not deduplicate across records by name
- put the observed label/name in `patients.display_name`
- put supporting evidence in `demographics_jsonb`

### Encounter natural-key strategy

Use this precedence:

1. `episode_number`
2. `ipd_number`
3. `opd_number`

If one exists:

- normalize to lowercase trimmed string
- create or reuse one `encounters` row per unique (`identifier_system`, `identifier_value`)
- create one `encounter_identifiers` row with `status = observed`

If none exist:

- create one source-scoped provisional encounter per source record only if the source clearly represents an encounter-level record
- store label evidence in `details_jsonb`
- do not turn `encounterLabel` into an identifier row

## Harvesting Order

Run `Phase 3A` in this exact order:

1. Backfill `users`
2. Backfill active `auth_sessions`
3. Create `practitioners` for doctor users
4. Link `users.practitioner_id`
5. Scan `documents.json` for patient/encounter signals
6. Scan `voice_sessions.json` for patient/encounter signals not already represented in canonical `documents.json`
7. Scan `live_conversation_sessions.json` for patient/encounter signals not already represented in canonical `documents.json`
8. Create provisional `patients`
9. Create `patient_identifiers`
10. Create provisional `encounters`
11. Create `encounter_identifiers`
12. Emit backfill report

## Source-Priority Rules

When more than one source contains the same observed identifier:

1. `documents.json`
2. `voice_sessions.json`
3. `live_conversation_sessions.json`

Use the highest-priority source to seed primary display fields. Lower-priority sources may only add evidence, not overwrite canonical values during `3A`.

## Backfill Report Requirements

`Phase 3A` must emit a machine-readable report with:

- inserted user count
- inserted session count
- skipped expired session count
- inserted practitioner count
- inserted patient count
- inserted patient identifier count
- inserted encounter count
- inserted encounter identifier count
- source-record count per store
- duplicate identifier collisions handled idempotently
- skipped malformed identifier values

## Exit Gate

`Phase 3A` is complete only when all of the following are true:

- `users` row count matches `users.json.users.length`
- active `auth_sessions` count matches non-expired filesystem sessions
- every `auth_sessions.user_id` references an existing `users.id`
- doctor-role users have deterministic `practitioner_id` links
- admin users remain allowed to have `practitioner_id = NULL`
- every identifier row has `source_system`
- every identifier row is `observed`, not `verified`
- no patient or encounter was merged by name-only heuristics
- `linkedPatient` and `encounterLabel` were not inserted into identifier tables

## Non-Goals

- reconciliation of ambiguous identities
- external-system trust scoring
- demographic fuzzy matching
- promotion of labels into identifiers
- writing back canonical IDs into source JSON stores during `3A`

