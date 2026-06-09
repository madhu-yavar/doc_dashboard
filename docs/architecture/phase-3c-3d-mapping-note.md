# Phase 3C + 3D Mapping Note

**Date**: 2026-06-02
**Purpose**: Document source-to-target field mappings before coding backfill scripts
**Evidence**: Real source file samples collected at implementation time

---

## Critical Finding: Phase 3A/3B Blockers

**STOP**: Phase 3C/3D cannot proceed until Phase 3A/3B complete successfully.

From source file analysis:
- `chat_sessions.json`: **EMPTY** - {"sessions": []}
- `chat_actions.json`: **EMPTY** - {"actions": []}
- `chat_exports.json`: **EMPTY** - {"exports": []}

Phase 3D contract requires chat ownership from `chat_sessions.json`. Without data:
- Chat backfill is impossible
- User ownership for chat cannot be resolved
- Contract exit gates cannot be satisfied

**Action Required**: Confirm Phase 3A/3B status before proceeding.

---

## Phase 3C: Transcripts + Reviews + Live Workflow

### Source Data Summary

| Source File | Row Count | Status |
|---|---|---|
| `voice_sessions.json` | 1 session | ✅ Has data |
| `voice_reviews.json` | 4 rows (2 resolution + 2 lifecycle) | ✅ Has mixed data |
| `live_conversation_sessions.json` | 1 session | ✅ Has data |
| `live_conversation_events.jsonl` | 335 events | ✅ Has data |

---

### Voice Sessions → Transcripts

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `session.id = "ae86664a-..."` | `transcripts.id = "voice-tr:ae86664a-..."` | Namespace prefix | voice_sessions.json:4 |
| `session.sttBackend = "hybrid"` | `transcripts.backend = "hybrid"` | Direct copy | voice_sessions.json:13 |
| `session.transcript.rawText` | `transcripts.raw_text` | Direct copy | voice_sessions.json:65 |
| `session.transcript.normalizedText` | `transcripts.normalized_text` | Direct copy | voice_sessions.json:66 |
| `session.transcriptQuality` | `transcripts.quality_jsonb` | Preserve JSON object | voice_sessions.json:14-18 |
| `session.transcript` (full object) | `transcripts.transcript_jsonb` | Preserve full JSON | voice_sessions.json:26-84 |
| `session.uploadedAt` | `transcripts.created_at` | Direct ISO copy | voice_sessions.json:8 |
| Canonical document link (via Phase 3B) | `transcripts.document_id` | Deterministic only | - |
| - | `transcripts.live_session_id` | NULL for voice | - |

**Namespacing Rule**: `voice-tr:<session.id>` prevents collision with live transcripts

---

### Voice Sessions → Transcript Segments

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `segment.id = "seg_1"` | `transcript_segments.id = "voice-tr:ae86664a-...:seg_1"` | Namespace with transcript prefix | voice_sessions.json:21 |
| `transcript.id` | `transcript_segments.transcript_id` | FK to namespaced transcript | - |
| Array position (0-based) | `transcript_segments.segment_order` | Convert to 1-based | voice_sessions.json:19 |
| `segment.speakerRole = "unknown"` | `transcript_segments.speaker_role = "unknown"` | Enum validation (speaker_role_enum) | voice_sessions.json:22 |
| `segment.speakerLabel = "Speaker 1"` | `transcript_segments.speaker_label` | Direct copy | voice_sessions.json:23 |
| `segment.startSeconds` | `transcript_segments.start_ms` | Multiply by 1000 | voice_sessions.json:25 |
| `segment.endSeconds` | `transcript_segments.end_ms` | Multiply by 1000 | voice_sessions.json:26 |
| `segment.text` | `transcript_segments.text` | Direct copy | voice_sessions.json:27 |
| `segment.confidence = 0.95` | `transcript_segments.confidence_score = 0.95` | Direct numeric copy | voice_sessions.json:27 |
| `segment.flags[]` + raw segment | `transcript_segments.flags_jsonb` | Preserve metadata | voice_sessions.json:28-30 |
| Source has `"status": "final"` | `transcript_segments.status = "active"` | Normalize per contract rule 6 | voice_sessions.json:43 |

**Namespacing Issue**: `seg_1` is not globally unique. Must namespace as `<transcript_id>:<segment_id>`

**Status Normalization**: Source uses "final" but Postgres only allows "active/edited/deleted". All initial backfill = "active"

---

### Voice Sessions → Review Items

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `reviewItem.id = "a577e7a2-..."` | `review_items.id = "voice-ri:ae86664a-...:a577e7a2-..."` | Namespace with session prefix | voice_sessions.json:35 |
| Canonical document link | `review_items.document_id` | Deterministic only | - |
| - | `review_items.live_session_id` | NULL for voice | - |
| `voice-tr:ae86664a-..."` | `review_items.transcript_id` | FK to namespaced transcript | - |
| `reviewItem.category = "transcript"` | `review_items.category = "transcript"` | Direct copy | voice_sessions.json:36 |
| `reviewItem.severity = "low"` | `review_items.severity = "low"` | Direct copy | voice_sessions.json:37 |
| `reviewItem.reasonCode = "transcript_approval"` | `review_items.reason_code` | Direct copy | voice_sessions.json:38 |
| `reviewItem.title` | `review_items.title` | Direct copy | voice_sessions.json:39 |
| - | `review_items.field_path` | NULL (not in voice source) | - |
| - | `review_items.required_flag = FALSE` | Default (not in voice source) | - |
| `reviewItem.provenanceText` | `review_items.provenance_text` | Direct copy | voice_sessions.json:42 |
| `reviewItem.provenanceTime` + source id | `review_items.provenance_range_jsonb` | Preserve time range | voice_sessions.json:43 |
| `reviewItem.extractedValue` | `review_items.extracted_value_jsonb = {"value": ...}` | Wrap in value object | voice_sessions.json:40 |
| `reviewItem.suggestedValue` | `review_items.suggested_value_jsonb = {"value": ...}` | Wrap in value object | voice_sessions.json:41 |
| `reviewItem.resolution = "approved"` | `review_items.current_resolution = "approved"` | Enum validation (review_status_enum) | voice_sessions.json:44 |

**Resolution Normalization**: Source uses "approved" which is valid in review_status_enum

---

### Voice Reviews → Review Item Resolutions

**Critical**: Must split resolution rows from lifecycle rows

**Resolution History Rows** (have `reviewItemId`):
```
Row 1: { id: "219227bf-...", reviewItemId: "a577e7a2-...", resolution: "approved", ... }
Row 4: { id: "86bb374d-...", reviewItemId: "c8b5aebc-...", resolution: "approved", ... }
```

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `review.id = "219227bf-..."` | `review_item_resolutions.id = "219227bf-..."` | Preserve original ID | voice_reviews.json:4 |
| `voice-ri:<sessionId>:<reviewItemId>` | `review_item_resolutions.review_item_id` | Use namespaced review item ID | - |
| `review.username = "admin"` | `resolved_by_user_id` | Lookup users.id by username | voice_reviews.json:10 |
| `review.resolution = "approved"` | `review_item_resolutions.resolution = "approved"` | Direct copy | voice_reviews.json:7 |
| `review.editedValue = ""` | `review_item_resolutions.edited_value_jsonb = {}` | Wrap as empty when empty | voice_reviews.json:8 |
| - | `review_item_resolutions.notes` | NULL unless user match fails | - |
| `review.createdAt` | `review_item_resolutions.created_at` | Direct ISO copy | voice_reviews.json:9 |

**Lifecycle Event Rows** (have `type`, no `reviewItemId`):
```
Row 2: { id: "1899ac17-...", type: "voice_transcription_completed", ... }
Row 3: { id: "024cedf8-...", type: "voice_transcription_completed", ... }
```

These go to `audit_events`, NOT `review_item_resolutions`

---

### Lifecycle Events → Audit Events

**Voice Lifecycle Rows**:
```
Row 2: { type: "voice_transcription_completed", sessionId: "0bac7bcb-...", ... }
```

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `event.id = "1899ac17-..."` | `audit_events.id = "1899ac17-..."` | Preserve original ID | voice_reviews.json:14 |
| - | `audit_events.audit_run_id` | NULL (not part of a run) | - |
| Voice lifecycle | `audit_events.workflow = "voice_upload"` | Per contract rule 9 | - |
| Linked document | `audit_events.document_id` | Deterministic only | - |
| - | `audit_events.chat_session_id` | NULL for voice | - |
| `event.type = "voice_transcription_completed"` | `audit_events.event_type` | Direct copy | voice_reviews.json:16 |
| `event.type` ends with `_completed` | `audit_events.status = "completed"` | Per contract event-status table | voice_reviews.json:16 |
| Human-readable label | `audit_events.title` | Use best available | - |
| Event payload minus key fields | `audit_events.details_jsonb` | Preserve metadata | - |
| `event.createdAt` | `audit_events.occurred_at` | Direct ISO copy | voice_reviews.json:17 |

**Workflow Normalization**: Voice lifecycle → `voice_upload` (contract rule 9)
**Status Normalization**: `voice_transcription_completed` → `completed` (contract event-status table)

---

### Live Sessions → Live Conversation Sessions

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `session.id = "live-1780050028586-71263adf"` | `live_conversation_sessions.id = "live-1780050028586-71263adf"` | Preserve original ID | live_conversation_sessions.json:4 |
| `createdBy.username = "admin"` | `created_by_user_id` | Lookup users.id by username | live_conversation_sessions.json:9 |
| Phase 3A patient_id | `patient_id` | Nullable, from Phase 3A | - |
| Phase 3A encounter_id | `encounter_id` | Nullable, from Phase 3A | - |
| `session.status = "review_required"` | `status = "ended"` | Normalize per contract table | live_conversation_sessions.json:5 |
| `session.linkedPatient = "Madhu"` | `linked_patient_label = "Madhu"` | Direct copy | live_conversation_sessions.json:6 |
| `session.encounterLabel = ""` | `encounter_label = ""` | Direct copy | live_conversation_sessions.json:7 |
| `session.documentId = null` | `document_id = NULL` | Direct copy (no link) | live_conversation_sessions.json:16 |
| `session.durationMs = 36010` | `duration_ms = 36010` | Direct copy | live_conversation_sessions.json:17 |
| `session.transport` | `transport_state_jsonb` | Preserve full object | live_conversation_sessions.json:19 |
| `session.draftExtraction` | `draft_extraction_jsonb` | Preserve full draft | live_conversation_sessions.json:85 |
| `live-tr:live-1780050028586-71263adf"` | `current_transcript_id` | FK to namespaced transcript | - |
| `session.startedAt = "2026-05-29T..."` | `started_at = "2026-05-29T..."` | Direct ISO copy | live_conversation_sessions.json:13 |
| `session.endedAt = "2026-05-29T..."` | `ended_at = "2026-05-29T..."` | Direct ISO copy | live_conversation_sessions.json:15 |
| `session.startedAt` | `created_at` | Fallback when no earlier time | live_conversation_sessions.json:13 |
| `session.updatedAt = "2026-05-29T..."` | `updated_at = "2026-05-29T..."` | Direct ISO copy | live_conversation_sessions.json:14 |

**Status Normalization** (contract rule 7 table):
- `review_required` → `ended`

---

### Live Sessions → Live Transcripts

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `live-tr:<session.id>` | `transcripts.id = "live-tr:live-1780050028586-71263adf"` | Namespace prefix | - |
| - | `transcripts.document_id` | NULL for live (contract rule 3) | - |
| `session.id` | `transcripts.live_session_id` | Direct reference | live_conversation_sessions.json:4 |
| NULL | `transcripts.backend` | NULL (not determinable from source) | - |
| NULL | `transcripts.language_code` | NULL (not determinable from source) | - |
| `session.transcript.rawText` | `transcripts.raw_text` | Direct copy | live_conversation_sessions.json:63 |
| `session.transcript.normalizedText` | `transcripts.normalized_text` | Direct copy | live_conversation_sessions.json:64 |
| `session.transcript.quality` | `transcripts.quality_jsonb` | Preserve quality object | live_conversation_sessions.json:78-83 |
| `session.transcript` (full object) | `transcripts.transcript_jsonb` | Preserve full JSON | live_conversation_sessions.json:26-84 |
| `session.startedAt` | `transcripts.created_at` | Fallback timestamp | live_conversation_sessions.json:13 |

**Rule 3 Enforcement**: Live transcript rows MUST have `document_id = NULL` and `live_session_id = <session>`

---

### Live Segments → Transcript Segments

Same pattern as voice segments, but with live source:
- `segment.id = "seg-speaker-fallback-1"` → `transcript_segments.id = "live-tr:live-1780050028586-71263adf:seg-speaker-fallback-1"`
- `segment.speakerRole = "patient"` → `transcript_segments.speaker_role = "patient"` (enum validation)
- `segment.startSeconds = 0` → `transcript_segments.start_ms = 0`
- `segment.endSeconds = 6` → `transcript_segments.end_ms = 6000`

**Speaker Role Normalization** (contract rule table):
- `patient` → `patient` ✅
- `doctor` → `physician` (normalize per contract)

---

### Live Review Items → Review Items

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `reviewItem.id` | `review_items.id = "live-ri:<session.id>:<reviewItemId>"` | Namespace prefix | - |
| - | `review_items.document_id` | NULL for live | - |
| `session.id` | `review_items.live_session_id` | Direct reference | - |
| `live-tr:<session.id>` | `review_items.transcript_id` | FK to live transcript | - |
| `reviewItem.category` | `review_items.category` | Direct copy | - |
| `reviewItem.severity` | `review_items.severity` | Direct copy | - |
| - | `review_items.reason_code` | NULL (not in live source) | - |
| `reviewItem.title` | `review_items.title` | Direct copy | - |
| `reviewItem.fieldPath` | `review_items.field_path` | Direct copy | - |
| `reviewItem.required` | `review_items.required_flag` | Boolean copy | - |
| - | `review_items.provenance_text` | NULL (not in live source) | - |
| Source review id | `review_items.provenance_range_jsonb` | Preserve id only | - |
| `reviewItem.extractedValue` | `review_items.extracted_value_jsonb = {"value": ...}` | Wrap | - |
| `reviewItem.suggestedValue` | `review_items.suggested_value_jsonb = {"value": ...}` | Wrap | - |
| `reviewItem.resolution` | `review_items.current_resolution` | Normalize if needed | - |

**Rule 8 Enforcement**: Do NOT create `review_item_resolutions` for live sessions (source doesn't preserve history)

---

### Document Assets (Voice)

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `session.audioPath = "/Users/.../ae86664a-....wav"` | `document_assets.asset_role = "source_audio"` | Per contract table | voice_sessions.json:74 |
| Canonical document | `document_assets.document_id` | Deterministic only | - |
| - | `document_assets.live_session_id` | NULL for voice assets | - |
| `session.audioPath` | `document_assets.path_or_uri` | Direct copy | voice_sessions.json:74 |
| `session.mimeType = "audio/wav"` | `document_assets.mime_type` | Direct copy | voice_sessions.json:6 |
| `session.size = 501760` | `document_assets.size_bytes` | Direct copy | voice_sessions.json:7 |
| `session.hash = "c1069ad4..."` | `document_assets.sha256_hash` | Direct copy | voice_sessions.json:77 |
| `session.transcriptPath = "/Users/.../ae86664a-....json"` | `document_assets.asset_role = "transcript_json"` | Per contract table | voice_sessions.json:75 |

**File Existence Check**: Only create rows when file exists at migration time

---

### Document Assets (Live)

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `session.audio.combinedPath` | `document_assets.asset_role = "source_audio"` | Per contract table | live_conversation_sessions.json:23 |
| - | `document_assets.document_id` | NULL for live | - |
| `session.id` | `document_assets.live_session_id` | Direct reference | - |
| `session.audio.combinedPath` | `document_assets.path_or_uri` | Direct copy | live_conversation_sessions.json:23 |
| `session.audio.mimeType = "audio/mp4"` | `document_assets.mime_type` | Direct copy | live_conversation_sessions.json:21 |
| `session.audio.totalBytes = 575902` | `document_assets.size_bytes` | Direct copy | live_conversation_sessions.json:24 |

**Rule 8 Enforcement**: Live transcript state is in relational tables, do NOT invent `transcript_json` asset

---

## Phase 3D: Chat + Audit + Alerts + Analytics

### Source Data Summary

| Source File | Row Count | Status |
|---|---|---|
| `chat_sessions.json` | **0** | ❌ EMPTY |
| `chat_actions.json` | **0** | ❌ EMPTY |
| `chat_exports.json` | **0** | ❌ EMPTY |
| `audit_runs.json` | 2 runs | ✅ Has data |
| `audit_events.jsonl` | Many events | ✅ Has data |
| `pharmacy_alerts.jsonl` | Many rows | ✅ Has data |
| `department_alerts.jsonl` | Many rows | ✅ Has data |
| `analytics.sqlite` | 16 metrics | ✅ Has data |

**CRITICAL BLOCKER**: Chat files are empty. Phase 3D chat backfill is impossible without data.

---

### Audit Runs → Audit Runs

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `run.runId = "befff509-..."` | `audit_runs.id = "befff509-..."` | Preserve original ID | audit_runs.json:4 |
| `run.workflow = "extraction"` | `audit_runs.workflow` | **NORMALIZE** | audit_runs.json:5 |
| `run.documentId = "868a4881-..."` | `audit_runs.document_id` | Deterministic only | audit_runs.json:6 |
| `run.chatId = null` | `audit_runs.chat_session_id` | NULL (no chat data) | audit_runs.json:7 |
| `run.requestId = "extract_571e..."` | `audit_runs.request_id` | Direct copy | audit_runs.json:8 |
| `metadata.authenticatedUser.username = "admin"` | `audit_runs.actor_user_id` | Lookup users.id | audit_runs.json:19 |
| `run.actor = "admin:admin"` | `audit_runs.actor_label = "admin:admin"` | Direct copy | audit_runs.json:10 |
| `run.status = "completed"` | `audit_runs.status = "completed"` | Per contract table | audit_runs.json:11 |
| `run.title = "Doxper.pdf"` | `audit_runs.title = "Doxper.pdf"` | Direct copy | audit_runs.json:9 |
| `run.metadata` | `audit_runs.metadata_jsonb` | Preserve full object | audit_runs.json:15 |
| `run.summary` | `audit_runs.summary_jsonb` | Preserve full object | audit_runs.json:25 |
| `run.error = null` | `audit_runs.error_message` | Direct copy | audit_runs.json:32 |
| `run.startedAt = "2026-05-21T..."` | `audit_runs.started_at` | Direct ISO copy | audit_runs.json:12 |
| `run.completedAt = "2026-05-21T..."` | `audit_runs.completed_at` | Direct ISO copy | audit_runs.json:13 |
| `run.durationMs = 158823` | `audit_runs.duration_ms = 158823` | Direct copy | audit_runs.json:14 |
| `run.startedAt` | `audit_runs.created_at` | Fallback timestamp | audit_runs.json:12 |

**Workflow Normalization** (contract rule 4 table):
- `workflow = "extraction"` → MUST check `documents.source_kind`:
  - If `documents.source_kind = voice_dictation` → `voice_upload`
  - If `documents.source_kind = live_conversation` → `live_conversation`
  - Else → `document_processing`

**Status Normalization** (contract rule 5 table):
- `completed` → `completed` ✅

---

### Audit Events → Audit Events

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| `event.id = "2487b445-..."` | `audit_events.id = "2487b445-..."` | Preserve original ID | audit_events.jsonl:1 |
| `event.runId = "04d0fbc5-..."` | `audit_events.audit_run_id` | Reference to audit run | audit_events.jsonl:1 |
| `event.workflow = "extraction"` | `audit_events.workflow` | **NORMALIZE** (same as runs) | audit_events.jsonl:1 |
| `event.documentId = "02421636-..."` | `audit_events.document_id` | Deterministic only | audit_events.jsonl:1 |
| `event.chatId = null` | `audit_events.chat_session_id` | NULL (no chat data) | audit_events.jsonl:1 |
| `event.type = "run_started"` | `audit_events.event_type = "run_started"` | Direct copy | audit_events.jsonl:1 |
| `event.status = "info"` | `audit_events.status = "started"` | Per contract table | audit_events.jsonl:1 |
| `event.title = "Custom.MEXX...."` | `audit_events.title = "Custom.MEXX...."` | Direct copy | audit_events.jsonl:1 |
| `event.details` + `requestId` | `audit_events.details_jsonb` | Preserve metadata | audit_events.jsonl:1 |
| `event.timestamp = "2026-05-03T..."` | `audit_events.occurred_at = "2026-05-03T..."` | Direct ISO copy | audit_events.jsonl:1 |
| `event.timestamp` | `audit_events.created_at = "2026-05-03T..."` | Direct ISO copy | audit_events.jsonl:1 |

**Status Normalization** (contract rule 5 table):
- `info` → `started`
- `success` → `completed`
- `error` → `failed`
- `warning` → `warning`

---

### Pharmacy Alerts → Alert Deliveries

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| Deterministic generated id | `alert_deliveries.id` | Namespace by timestamp+documentId | - |
| `alert.documentId = "TEST-1777810594703"` | `alert_deliveries.document_id` | Deterministic only | pharmacy_alerts.jsonl:1 |
| - | `alert_deliveries.alert_family = "pharmacy"` | Fixed per contract | - |
| `alert.medicationCount = 3` | `alert_deliveries.target_name = "medication_batch"` | If >1 medication | pharmacy_alerts.jsonl:1 |
| `alert.medications = "Amlodipine..."` | `alert_deliveries.target_name = "Amlodipine 5mg,..."` | Single medication name | pharmacy_alerts.jsonl:1 |
| - | `alert_deliveries.channel = "email"` | Fixed per contract (no whatsapp enum) | - |
| `results.email.preview.to[0]` | `alert_deliveries.recipient = "pharmacy@hospital.com"` | Extract first email | pharmacy_alerts.jsonl:1 |
| `results.email.success = true` | `alert_deliveries.status = "sent"` | Normalize success → sent | pharmacy_alerts.jsonl:1 |
| `results.email.success = false` | `alert_deliveries.status = "failed"` | Normalize failure → failed | - |
| Source alert row minus nested results | `alert_deliveries.payload_jsonb` | Preserve clean alert | - |
| `results` object | `alert_deliveries.result_jsonb` | Preserve full results | pharmacy_alerts.jsonl:1 |
| `results.errors[0]` | `alert_deliveries.error_message` | First error if present | - |
| `alert.timestamp = "2026-05-03T..."` | `alert_deliveries.sent_at = "2026-05-03T..."` | Historical delivery time | pharmacy_alerts.jsonl:1 |
| `alert.timestamp` | `alert_deliveries.created_at = "2026-05-03T..."` | Direct copy | pharmacy_alerts.jsonl:1 |

**Enum Limitation** (contract rule 6):
- `channel = whatsapp` NOT allowed in schema → WhatsApp outcomes preserved only in `result_jsonb`
- Only email delivery gets standalone row

---

### Department Alerts → Alert Deliveries

| Source Field | Target Table/Column | Normalization Rule | Evidence |
|---|---|---|---|
| Deterministic generated id | `alert_deliveries.id` | Namespace by timestamp+documentId+dept | - |
| `alert.documentId = "TEST-WITH-ORDERS-..."` | `alert_deliveries.document_id` | Deterministic only | department_alerts.jsonl:1 |
| - | `alert_deliveries.alert_family = "department"` | Fixed per contract | - |
| `departments[0].department = "lab"` | `alert_deliveries.target_name = "lab"` | Specific department name | department_alerts.jsonl:1 |
| - | `alert_deliveries.channel = "email"` | Fixed per contract | - |
| `results.lab.recipient = "lab@hospital.com"` | `alert_deliveries.recipient = "lab@hospital.com"` | Extract email | department_alerts.jsonl:1 |
| `results.lab.emailSent = true` | `alert_deliveries.status = "sent"` | Normalize success → sent | department_alerts.jsonl:1 |

**One Row Per Department**: Each department in `departments[]` creates a separate row with `target_name = <department>`

**Enum Limitation**:
- `alert_family = lab` NOT allowed → Use `department` + `target_name = "lab"`
- WhatsApp outcomes preserved only in `result_jsonb`

---

### Analytics SQLite → Analytics Document Metrics

**SQLite Schema** (limited fields):
```
document_id, document_name, document_type, processed_at, uploaded_at,
gemma_tokens, gemini_tokens, total_tokens,
medications_count, lab_tests_count, radiology_tests_count,
nuclear_medicine_tests_count, procedures_count
```

**Postgres Schema** (richer fields):
```
Additional: gemma_cache_hit, transcript_takes, transcript_confidence,
voice_review_items, voice_review_items_resolved,
live_review_items, live_review_items_resolved,
diagnoses_count, lab_results_count, radiology_results_count,
ordered_medications_count, has_occupational_therapy,
has_dietary_recommendations, has_patient_education
```

| Source | Target | Rule |
|---|---|---|
| `sqlite.document_id` | `analytics_document_metrics.document_id` | Direct copy |
| `sqlite.document_name = "Prescription_03.pdf"` | `analytics_document_metrics.document_name = "Prescription_03.pdf"` | Direct copy |
| `sqlite.document_type = "prescription"` | `analytics_document_metrics.document_type = "prescription"` | Direct copy |
| `sqlite.processed_at` | `analytics_document_metrics.processed_at` | Direct copy |
| `sqlite.uploaded_at` | `analytics_document_metrics.uploaded_at` | Direct copy |
| `sqlite.gemma_tokens = 4758` | `analytics_document_metrics.gemma_tokens = 4758` | Direct copy |
| **Derived from Phase 3C** | `analytics_document_metrics.transcript_takes = 1` | Check if transcript exists |
| **Derived from Phase 3C** | `analytics_document_metrics.transcript_confidence = 0.95` | From transcript quality |
| **Derived from Phase 3C** | `analytics_document_metrics.voice_review_items = 1` | Count voice review items |
| **Derived from Phase 3C** | `analytics_document_metrics.voice_review_items_resolved = 1` | Count resolved |
| **Derived from Phase 3C** | `analytics_document_metrics.live_review_items = 1` | Count live review items |
| **Derived from Phase 3C** | `analytics_document_metrics.live_review_items_resolved = 0` | Count resolved |
| `sqlite.medications_count = 1` | `analytics_document_metrics.medications_count = 1` | Prefer document payload |
| **Derived from Phase 3B** | `analytics_document_metrics.diagnoses_count = 1` | Count from extraction |
| `sqlite.lab_tests_count = 5` | `analytics_document_metrics.ordered_lab_count = 5` | Fallback to SQLite |
| `sqlite.radiology_tests_count = 1` | `analytics_document_metrics.ordered_radiology_count = 1` | Fallback to SQLite |
| `sqlite.nuclear_medicine_tests_count = 0` | `analytics_document_metrics.nuclear_medicine_count = 0` | Fallback to SQLite |
| `sqlite.procedures_count = 0` | `analytics_document_metrics.procedures_count = 0` | Fallback to SQLite |
| **Default** | `analytics_document_metrics.gemma_cache_hit = FALSE` | Explicit default |
| **Default** | `analytics_document_metrics.lab_results_count = 0` | Explicit default |
| **Default** | `analytics_document_metrics.radiology_results_count = 0` | Explicit default |
| **Default** | `analytics_document_metrics.ordered_medications_count = 0` | Explicit default |
| **Default** | `analytics_document_metrics.has_occupational_therapy = FALSE` | Explicit default |
| **Default** | `analytics_document_metrics.has_dietary_recommendations = FALSE` | Explicit default |
| **Default** | `analytics_document_metrics.has_patient_education = FALSE` | Explicit default |
| `sqlite.gemini_tokens`, `sqlite.total_tokens` | `analytics_document_metrics.metadata_jsonb` | Preserve in metadata |

**Hybrid Strategy** (contract rule 7):
1. Direct copy: `gemma_tokens`, `document_name`, `uploaded_at`, etc.
2. Derived: `transcript_*`, `*_review_items_*` from Phase 3C
3. Derived: `diagnoses_count` from Phase 3B extraction payload
4. Fallback: `ordered_*_count` from SQLite if not in extraction
5. Default: `has_*` flags default to FALSE unless explicit

**Metadata Preservation**: SQLite-only fields (`gemini_tokens`, `total_tokens`) MUST be preserved in `metadata_jsonb`

---

## Required Repository Additions

**Phase 3C Contract Requirement**: "no dedicated repository for review_items or review_item_resolutions"

**Solution**: Create `server/repositories/review_workflow_repository.cjs` with:
- `createReviewItem(reviewItemData)`
- `createReviewItemResolution(resolutionData)`
- `findReviewItemsByDocumentId(documentId)`
- `findReviewItemsByLiveSessionId(sessionId)`
- `findReviewItemResolutionsByReviewItemId(reviewItemId)`

---

## Schema Enum Validation Checks

Before implementation, validate all enum values against `schema.cjs`:

### speaker_role_enum
- ✅ `physician` (normalize `doctor` → `physician`)
- ✅ `patient`
- ✅ `nurse`
- ✅ `family`
- ✅ `other`
- ✅ `unknown`

### segment_status_enum
- ✅ `active` (all source segments → `active` on backfill)
- ✅ `edited` (future use)
- ✅ `deleted` (future use)

### review_status_enum
- ✅ `pending`
- ✅ `approved` (source `"approved"` valid)
- ✅ `rejected`
- ✅ `superseded`

### session_status_enum
- ✅ `active` (normalize `draft`, `live`, `paused` → `active`)
- ✅ `ended` (normalize `review_required`, `finalized` → `ended`)
- ✅ `abandoned` (normalize `failed` → `abandoned`)

### event_status_enum
- ✅ `started` (normalize `info` → `started`)
- ✅ `completed` (normalize `success`/`*_completed` → `completed`)
- ✅ `failed` (normalize `error`/`*_failed` → `failed`)
- ✅ `warning`

### workflow_enum
- ✅ `document_processing` (default for `extraction` workflow)
- ✅ `voice_upload` (voice lifecycle events)
- ✅ `live_conversation` (live lifecycle events)
- ✅ `chat` (if chat data exists)
- ✅ `audit` (audit maintenance)
- ✅ `external_sync` (future use)

### alert_family_enum
- ✅ `pharmacy`
- ✅ `department`
- ✅ `system`
- ✅ `external`

### channel_enum
- ✅ `email` (only channel with standalone rows)
- ❌ `whatsapp` NOT ALLOWED → preserve in `result_jsonb` only
- ✅ `sms`
- ✅ `websocket`
- ✅ `http`
- ✅ `internal`

---

## Exit Gate Verification Checklist

### Phase 3C Exit Gates

- [ ] Every transcript anchored to exactly one owner (`document_id` OR `live_session_id`)
- [ ] No live transcript linked directly to `documents` (rule 3 enforcement)
- [ ] All segment IDs globally unique after namespacing
- [ ] All review item IDs globally unique after namespacing
- [ ] Voice resolution history rows inserted into `review_item_resolutions`
- [ ] Lifecycle rows NOT mistaken for resolutions (split validation)
- [ ] Live review current state backfilled without synthetic history (rule 8)
- [ ] All deterministic voice files have `document_assets` rows
- [ ] All deterministic live audio files have `document_assets` rows
- [ ] Live session statuses use only normalization table (rule 7)
- [ ] UI-only fields preserved in `draft_extraction_jsonb` (rule 10)

### Phase 3D Exit Gates

- [ ] Chat ownership resolved deterministically (BLOCKER: no chat data)
- [ ] No chat session assigned to guessed user
- [ ] `chat_actions.json` not duplicated with embedded `confirmedActions`
- [ ] `chat_exports.json` remains primary export history
- [ ] All audit runs/events use allowed `workflow_enum`
- [ ] All audit events use allowed `event_status_enum`
- [ ] No unsupported alert enum values invented
- [ ] Department alerts use `alert_family = department` + `target_name = <dept>`
- [ ] WhatsApp outcomes preserved without `channel = whatsapp` enum
- [ ] Analytics documents which fields were copied/derived/defaulted
- [ ] SQLite-only token fields preserved in `metadata_jsonb`

---

## Blockers Summary

### Critical Blocker: Phase 3A/3B Prerequisites

**Phase 3D contract explicitly requires**:
- Chat ownership from `chat_sessions.json`
- User resolution for chat sessions
- Document linking from Phase 3B

**Current state**:
- `chat_sessions.json` is EMPTY
- `chat_actions.json` is EMPTY
- `chat_exports.json` is EMPTY

**Impact**: Phase 3D chat backfill is IMPOSSIBLE without data.

**Required action**: Confirm Phase 3A/3B completion status before proceeding.

### Secondary Concern: Phase 3B Document Linking

Phase 3C requires deterministic document links from Phase 3B:
- `voice_sessions[].dashboardDocumentId`
- Live session `documentId` after finalization
- Analytics document linking

**Required verification**: Confirm Phase 3B backfill completed successfully with canonical `documents` rows.

---

## Next Steps

1. **STOP**: Do not proceed with implementation until:
   - Phase 3A completion confirmed
   - Phase 3B completion confirmed
   - Chat data availability confirmed (or chat backfill deemed out of scope)

2. **THEN** proceed with:
   - Create `review_workflow_repository.cjs`
   - Implement `backfill_phase_3c.cjs`
   - Implement `backfill_phase_3d.cjs` (skip chat sections if empty)
   - Validate against disposable Postgres database
   - Generate backfill reports
   - Verify all exit gates satisfied

---

**End of Mapping Note**
