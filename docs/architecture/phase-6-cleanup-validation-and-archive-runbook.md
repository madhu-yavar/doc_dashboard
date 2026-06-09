# Phase 6: Cleanup Validation And Archive Runbook

## Date
2026-06-04

## Status
Execution runbook

This runbook defines how to execute `Phase 6` safely. The key rule is simple: remove runtime dependence first, archive second, delete last.

## Recommended Rollout Model

Use two releases instead of one destructive jump.

### Release 6A: Postgres-only runtime, legacy files preserved

- remove runtime writes to legacy metadata stores
- keep old files on disk as rollback artifacts
- validate that normal app usage no longer mutates them

### Release 6B: archive and remove legacy metadata stores

- move retired metadata files into a dated archive location
- remove remaining bootstraps, repair logic, and file-based fallbacks
- update deployment/current-state docs after the runtime is proven stable

## Pre-Flight Checklist

- Phase 4 subsystem parity checks completed
- Phase 5 reconciliation implementation deployed
- PostgreSQL backups completed
- legacy metadata files snapshotted before cleanup
- any required bootstrap/admin users confirmed in PostgreSQL
- smoke-test plan agreed for auth, documents, voice, live, chat, audit, alerts, and analytics

## Archive Scope

Archive these metadata stores before deletion:

- `server/storage/users.json`
- `server/storage/auth_sessions.json`
- `server/storage/documents.json`
- `server/storage/voice_sessions.json`
- `server/storage/voice_reviews.json`
- `server/storage/live_conversation_sessions.json`
- `server/storage/live_conversation_events.jsonl`
- `server/storage/chat_sessions.json`
- `server/storage/chat_actions.json`
- `server/storage/chat_exports.json`
- `server/storage/audit_runs.json`
- `server/storage/audit_events.jsonl`
- `server/storage/pharmacy_alerts.jsonl`
- `server/storage/department_alerts.jsonl`
- `server/storage/analytics.sqlite`
- `server/storage/analytics.sqlite-shm`
- `server/storage/analytics.sqlite-wal`

Do not include binary asset directories in the retirement archive unless there is a separate asset-retention reason.

## Suggested Archive Layout

```text
server/storage/archive/
  phase-6-2026-06-04/
    manifest.json
    users.json
    auth_sessions.json
    documents.json
    voice_sessions.json
    voice_reviews.json
    live_conversation_sessions.json
    live_conversation_events.jsonl
    chat_sessions.json
    chat_actions.json
    chat_exports.json
    audit_runs.json
    audit_events.jsonl
    pharmacy_alerts.jsonl
    department_alerts.jsonl
    analytics.sqlite
    analytics.sqlite-shm
    analytics.sqlite-wal
```

`manifest.json` should record:

- archive timestamp
- app release SHA
- database name/environment
- file sizes
- file hashes if practical

## Execution Sequence

1. Implement Postgres-only write paths.
2. Remove startup repair flows that hydrate `documents.json` from voice/live sessions.
3. Deploy Release 6A with legacy files still present.
4. Run subsystem smoke tests.
5. Confirm retired metadata files are no longer changing.
6. Archive the legacy files.
7. Deploy Release 6B to remove residual file bootstraps and fallbacks.
8. Re-run smoke tests and deployment verification.

## Validation Focus By Subsystem

### Auth

- login works
- session refresh/authentication works
- logout/revocation works
- no new writes land in `users.json` or `auth_sessions.json`

### Documents

- document list/detail works
- upload and processing status updates work
- chart note and prescription-linked reads still resolve
- no startup repair is needed to make a processed document render correctly

### Uploaded Voice Workflow

- transcript reads work
- review-item reads/resolutions work
- no writes land in `voice_sessions.json` or `voice_reviews.json`

### Live Conversation Workflow

- create/list/detail/update/finalize flows work
- live-session events remain visible
- finalized live conversations publish through Postgres-backed document creation
- no writes land in `live_conversation_sessions.json` or `live_conversation_events.jsonl`

### Chat

- message history loads
- new messages persist
- confirmed actions persist
- exports persist
- no writes land in `chat_sessions.json`, `chat_actions.json`, or `chat_exports.json`

### Audit

- audit runs list correctly
- audit event timelines remain intact
- no writes land in `audit_runs.json` or `audit_events.jsonl`

### Alerts

- alert history still reads from `alert_deliveries`
- legacy alert JSONL files remain unused

### Analytics

- processing insights load
- metric updates continue after document changes
- no live dependency remains on `analytics.sqlite`

## Helpful Verification Commands

### 1. Find runtime references that still need cleanup

```bash
rg -n "users\\.json|auth_sessions\\.json|documents\\.json|voice_sessions\\.json|voice_reviews\\.json|live_conversation_sessions\\.json|live_conversation_events\\.jsonl|chat_sessions\\.json|chat_actions\\.json|chat_exports\\.json|audit_runs\\.json|audit_events\\.jsonl|analytics\\.sqlite" server --glob '!server/db/**'
```

Expected end state:

- no request-handling runtime path depends on those filenames
- remaining hits are limited to migration tooling, archive tooling, or comments that intentionally describe legacy behavior

### 2. Check that retired files stop changing during Release 6A

```bash
stat -f "%Sm %N" \
  server/storage/users.json \
  server/storage/auth_sessions.json \
  server/storage/documents.json \
  server/storage/voice_sessions.json \
  server/storage/voice_reviews.json \
  server/storage/live_conversation_sessions.json \
  server/storage/live_conversation_events.jsonl \
  server/storage/chat_sessions.json \
  server/storage/chat_actions.json \
  server/storage/chat_exports.json \
  server/storage/audit_runs.json \
  server/storage/audit_events.jsonl \
  server/storage/analytics.sqlite
```

Run normal auth/document/voice/live/chat flows, then re-run the command. File timestamps should remain unchanged.

### 3. Smoke-test the key app areas

```bash
npm test -- \
  src/test/auth-service.test.ts \
  src/test/upload-center.test.tsx \
  src/test/live-conversation-api.test.tsx \
  src/test/live-conversation-workspace.test.tsx \
  src/test/processing-insights.test.tsx
```

Add or swap targeted tests based on the final implementation split.

### 4. Confirm Postgres counts are present before archiving

```bash
psql -d doctor_dashboard -c "SELECT COUNT(*) FROM users;"
psql -d doctor_dashboard -c "SELECT COUNT(*) FROM auth_sessions;"
psql -d doctor_dashboard -c "SELECT COUNT(*) FROM documents;"
psql -d doctor_dashboard -c "SELECT COUNT(*) FROM live_conversation_sessions;"
psql -d doctor_dashboard -c "SELECT COUNT(*) FROM chat_sessions;"
psql -d doctor_dashboard -c "SELECT COUNT(*) FROM audit_runs;"
psql -d doctor_dashboard -c "SELECT COUNT(*) FROM analytics_document_metrics;"
```

## Rollback Model

Phase 6 is not a flag-toggle rollback.

Rollback requires:

1. redeploy the pre-Phase-6 application release
2. restore the archived legacy metadata files if they were removed from `server/storage/`
3. re-enable any prior cutover flags required by that older release
4. verify auth, documents, live workflow, chat, audit, and analytics behavior

If Release 6A fails before deletion, rollback is simpler because the files are still in place. That is the main reason to split the rollout.

## Completion Criteria

- Postgres-only runtime behavior verified in production-like conditions
- retired metadata files archived with manifest
- legacy-file writes absent during normal operation
- startup repair removed
- deployment/current-state docs updated after the cleanup release is live

## Final Note

If there is any doubt about a subsystem still mutating a legacy file, do not delete that file yet. Release 6A exists to surface exactly those misses before the destructive cleanup step.
