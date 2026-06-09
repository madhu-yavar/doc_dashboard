# Phase 4: Read Cutover Mapping Note

## Date: 2026-06-03
## Status: Implementation Mapping

This document maps current runtime read seams to their Phase 4 Postgres cutover targets.

### Current Reader → Source Store → Target Repository → Controlling Flag

| Subsystem | Current Reader | Current Source Store | Target Repository | Controlling Flag |
|-----------|---------------|---------------------|-------------------|------------------|
| **Auth** | `AuthService.readUsers()` / `AuthService.readSessions()` in `server/auth_service.cjs` | `users.json`, `auth_sessions.json` | `AuthRepository` | `ENABLE_PG_READ_AUTH` |
| **Documents** | `readDocuments()` in `server/index.cjs` | `documents.json` | `DocumentsRepository` | `ENABLE_PG_READ_DOCUMENTS` |
| **Voice Uploads** | `readVoiceSessions()` / `updateVoiceSession()` / `mutateVoiceSessions()` in `server/index.cjs` | `voice_sessions.json` | `TranscriptsRepository` + `DocumentsRepository` | `ENABLE_PG_READ_VOICE` |
| **Voice Reviews** | `readCollection(voiceReviewsPath, "reviews")` in `server/index.cjs` | `voice_reviews.json` | `ReviewWorkflowRepository` | `ENABLE_PG_READ_VOICE` |
| **Live Workflow** | `LiveConversationStore.readSessions()` consumed by `server/live_conversation_routes.cjs` | `live_conversation_sessions.json` | `LiveSessionsRepository` + `TranscriptsRepository` | `ENABLE_PG_READ_LIVE` |
| **Chat** | `readCollection(chatSessionsPath, "sessions")`, `readCollection(chatActionsPath, "actions")`, `readCollection(chatExportsPath, "exports")` in `server/index.cjs` | `chat_sessions.json`, `chat_actions.json`, `chat_exports.json` | `ChatRepository` | `ENABLE_PG_READ_CHAT` |
| **Audit** | `AuditLogger.readRuns()`, `getRuns()`, `getRun()`, `getEvents()` in `server/audit_logger.cjs` | `audit_runs.json`, `audit_events.jsonl` | `AuditRepository` | `ENABLE_PG_READ_AUDIT` |
| **Alerts** | Alert delivery reads from `pharmacy_alerts.jsonl`, `department_alerts.jsonl` | `pharmacy_alerts.jsonl`, `department_alerts.jsonl` | `AlertsRepository` | `ENABLE_PG_READ_ALERTS` |
| **Analytics** | `AnalyticsStore.listMetrics()` and related methods in `server/analytics_store.cjs` | `analytics.sqlite` | `AnalyticsRepository` | `ENABLE_PG_READ_ANALYTICS` |

## Explicitly Out of Scope

- `search_cache.json` remains file-backed
- Interop adapter reads/writes (remain disabled)
- Binary file serving changes (uploads, audio, PDFs, prescriptions)
- Public API response shape changes

## Implementation Strategy

### Phase 4-1: Auth Read Cutover
Modify `AuthService.readUsers()` and `AuthService.readSessions()` to use `AuthRepository` when `ENABLE_PG_READ_AUTH=true`.

### Phase 4-2: Documents Read Cutover  
Modify `readDocuments()` to use `DocumentsRepository.readDocuments()` when `ENABLE_PG_READ_DOCUMENTS=true`.

### Phase 4-3: Voice Read Cutover
Modify voice session and review readers to use `TranscriptsRepository` and `ReviewWorkflowRepository` when `ENABLE_PG_READ_VOICE=true`.

### Phase 4-4: Live Read Cutover
Modify `LiveConversationStore.readSessions()` to use `LiveSessionsRepository` when `ENABLE_PG_READ_LIVE=true`.

### Phase 4-5: Chat/Audit/Alerts/Analytics Read Cutover
Modify chat, audit, alerts, and analytics readers to use their respective repositories when their flags are enabled.

## Parity Check Requirements

Each subsystem must pass parity checks before enablement:
- Row count matches between legacy and Postgres sources
- Data shape matches expected API contracts
- Rollback by flag toggle restores legacy reads
- No filesystem/SQLite store deletion