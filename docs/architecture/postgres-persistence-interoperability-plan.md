# Postgres Persistence + HL7/FHIR Interoperability Plan

## Date
2026-06-01

## Status
Planning document

## Purpose
Define the target PostgreSQL persistence architecture for Doctor Dashboard as an interoperability-aware system, not just a file-to-SQL migration. This plan makes the data model decision-complete for:

- current app persistence migration from JSON/filesystem stores
- FHIR-first canonical persistence
- HL7 v2 adapter boundaries
- inbound and outbound interoperability
- hybrid patient and encounter identity handling

This document is intentionally explicit about what is true today versus what is target architecture.

## Current Runtime Truth

### Actual persisted stores in the repository today

The running application is still file-backed under `server/storage/` plus one SQLite analytics store. The active persisted stores are:

- `documents.json`
- `users.json`
- `auth_sessions.json`
- `voice_sessions.json`
- `voice_reviews.json`
- `live_conversation_sessions.json`
- `live_conversation_events.jsonl`
- `chat_sessions.json`
- `chat_actions.json`
- `chat_exports.json`
- `audit_runs.json`
- `audit_events.jsonl`
- `pharmacy_alerts.jsonl`
- `department_alerts.jsonl`
- `analytics.sqlite`
- filesystem assets under `uploads/`, `voice_audio/`, `voice_transcripts/`, `live_conversation_audio/`, `masked_images/`, and `prescriptions/`

### What is not implemented today

- No PostgreSQL-backed runtime persistence exists in the app code.
- No live HL7 v2 runtime exists in the app code.
- No live FHIR server, FHIR resource store, or FHIR synchronization runtime exists in the app code.
- Patient and encounter identity are currently derived from uploaded content, queue metadata, or live-session labels rather than a canonical master-data service.

### Current data ownership problems

- `documents.json` acts as the final published record for PDFs and voice-derived dashboard content.
- `voice_sessions.json` also stores transcript, review, extraction, and dashboard-adjacent state for uploaded dictation.
- `live_conversation_sessions.json` stores transcript and draft extraction state before a final document exists.
- Startup repair logic currently rehydrates `documents.json` from session stores for voice and live-conversation records.
- Chat, audit, and alert logs each have their own file-backed persistence and no shared relational identity model.

### Migration baseline assumptions

- The current file-backed stores are authoritative until Postgres cutover is complete.
- Existing public API routes remain unchanged during the documentation phase.
- The initial Postgres rollout must coexist with current JSON/filesystem stores through a dual-write and staged read-cutover period.

## Target Architecture Principles

### Canonical ownership rules

- `documents` is the canonical final clinical record owned by this application.
- `document_extractions` stores versioned structured outputs and rich clinical payloads for a document.
- `patients` and `encounters` become first-class master-data entities because interoperability is in scope.
- `documents.patient_id` and `documents.encounter_id` reference resolved master records when known, but document-level extracted identity remains preserved as observed data.
- `live_conversation_sessions` remains a workflow table for in-progress capture and review; it is not a competing final record store.
- `interop_messages` records inbound and outbound HL7/FHIR exchange state; it does not replace `documents`, `audit_runs`, or `audit_events`.
- Binary files remain outside Postgres and are referenced through `document_assets`.

### Storage strategy

- Relational columns store identity, ownership, lifecycle, and query-critical metadata.
- `JSONB` stores rich extraction payloads, stage artifacts, citations, traces, dashboard payloads, alert payloads, and interoperability normalization payloads.
- Filesystem or object storage keeps uploaded PDFs, audio, transcript JSON artifacts, masked images, and generated prescription/chart-note files.

### Interoperability strategy

- The canonical persistence model is FHIR-first where a healthcare domain shape is needed.
- HL7 v2 is treated as an ingress/egress adapter and transport concern around the canonical model.
- The app must support both inbound and outbound flows.
- Patient and encounter identity use a hybrid merge model:
  - internal records may exist before external identifiers arrive
  - external records may arrive before internal app records exist
  - multiple identifiers per patient and encounter are allowed
  - unresolved conflicts create reconciliation work instead of silent merge

## Target Persistence Foundation

### Core master-data tables

| Table | Purpose | Required key columns | Required indexes / constraints |
|------|---------|----------------------|--------------------------------|
| `patients` | Canonical patient entity | `id`, `identity_state`, `source_mode`, `display_name`, `birth_date`, `sex_code`, `demographics_jsonb`, `created_at`, `updated_at` | PK on `id`; index on `identity_state`; index on `display_name`; GIN on `demographics_jsonb` |
| `patient_identifiers` | All patient identifiers across internal and external systems | `id`, `patient_id`, `identifier_system`, `identifier_value`, `identifier_type`, `assigning_authority`, `status`, `source_system`, `is_primary`, `created_at` | Unique on (`identifier_system`, `identifier_value`); index on `patient_id`; index on `status` |
| `encounters` | Canonical encounter / visit entity | `id`, `patient_id`, `identity_state`, `source_mode`, `encounter_class`, `status`, `start_at`, `end_at`, `organization_id`, `location_id`, `practitioner_id`, `details_jsonb`, `created_at`, `updated_at` | PK on `id`; index on `patient_id`; index on (`status`, `start_at`); GIN on `details_jsonb` |
| `encounter_identifiers` | Visit / episode / OPD / IPD / external encounter IDs | `id`, `encounter_id`, `identifier_system`, `identifier_value`, `identifier_type`, `assigning_authority`, `status`, `source_system`, `is_primary`, `created_at` | Unique on (`identifier_system`, `identifier_value`); index on `encounter_id` |
| `practitioners` | Clinical identity records separate from app login accounts | `id`, `display_name`, `npi_or_registration_no`, `role_code`, `practitioner_jsonb`, `created_at`, `updated_at` | Index on `display_name`; unique nullable index on `npi_or_registration_no` |
| `organizations` | Hospitals, departments, clinics, source institutions | `id`, `name`, `organization_type`, `identifiers_jsonb`, `organization_jsonb`, `created_at`, `updated_at` | Index on `name`; GIN on `identifiers_jsonb` |
| `locations` | Physical or logical care locations | `id`, `organization_id`, `name`, `location_type`, `identifiers_jsonb`, `location_jsonb`, `created_at`, `updated_at` | Index on `organization_id`; index on `name` |

### Application identity tables

| Table | Purpose | Required key columns | Required indexes / constraints |
|------|---------|----------------------|--------------------------------|
| `users` | App login accounts for admin and doctor roles | `id`, `username`, `password_hash`, `role`, `display_name`, `practitioner_id`, `status`, `created_at`, `updated_at` | Unique on `username`; index on `role`; FK `practitioner_id -> practitioners.id` |
| `auth_sessions` | Cookie-backed app sessions | `id`, `session_token`, `user_id`, `expires_at`, `last_seen_at`, `revoked_at`, `created_at` | Unique on `session_token`; index on `user_id`; index on `expires_at`; partial index on active sessions |

### Core clinical document tables

| Table | Purpose | Required key columns | Required indexes / constraints |
|------|---------|----------------------|--------------------------------|
| `documents` | Canonical final record for PDFs, uploaded dictation, and finalized live conversations | `id`, `patient_id`, `encounter_id`, `document_type`, `document_subtype`, `source_kind`, `status`, `department`, `name`, `original_filename`, `mime_type`, `size_bytes`, `sha256_hash`, `linked_patient_label`, `encounter_label`, `current_extraction_id`, `current_transcript_id`, `current_chart_note_id`, `last_audit_run_id`, `error_code`, `error_message`, `uploaded_at`, `processed_at`, `created_at`, `updated_at` | Indexes on `status`, `document_type`, `document_subtype`, `patient_id`, `encounter_id`; unique nullable index on `sha256_hash` for dedupe policy |
| `document_assets` | External-file metadata for source and derived assets | `id`, `document_id`, `live_session_id`, `asset_role`, `storage_backend`, `path_or_uri`, `mime_type`, `size_bytes`, `sha256_hash`, `metadata_jsonb`, `created_at` | Exactly one of `document_id` or `live_session_id` must be set; index on `document_id`; index on `live_session_id`; index on `asset_role` |
| `document_extractions` | Versioned extraction results and dashboard payloads | `id`, `document_id`, `version_no`, `status`, `agent_name`, `agent_version`, `audit_run_id`, `provider_tokens_jsonb`, `extracted_data_jsonb`, `dashboard_payload_jsonb`, `meta_jsonb`, `stage1_jsonb`, `stage3_jsonb`, `presentation_jsonb`, `created_at` | Unique on (`document_id`, `version_no`); index on `document_id`; GIN on `extracted_data_jsonb`; GIN on `meta_jsonb` |
| `transcripts` | Transcript-level payload for voice dictation and live sessions | `id`, `document_id`, `live_session_id`, `backend`, `language_code`, `raw_text`, `normalized_text`, `quality_jsonb`, `transcript_jsonb`, `created_at` | Exactly one of `document_id` or `live_session_id` must be set; index on `document_id`; index on `live_session_id` |
| `transcript_segments` | Time-based transcript segments | `id`, `transcript_id`, `segment_order`, `speaker_id`, `speaker_role`, `speaker_label`, `start_ms`, `end_ms`, `text`, `normalized_text`, `confidence_score`, `flags_jsonb`, `status`, `created_at` | Unique on (`transcript_id`, `segment_order`); index on (`transcript_id`, `start_ms`) |

### Review and workflow tables

| Table | Purpose | Required key columns | Required indexes / constraints |
|------|---------|----------------------|--------------------------------|
| `review_items` | Pending and resolved review tasks across voice and live workflows | `id`, `document_id`, `live_session_id`, `transcript_id`, `category`, `severity`, `reason_code`, `title`, `field_path`, `required_flag`, `provenance_text`, `provenance_range_jsonb`, `extracted_value_jsonb`, `suggested_value_jsonb`, `current_resolution`, `created_at`, `updated_at` | Exactly one of `document_id` or `live_session_id` must be set; index on `current_resolution`; index on `severity`; index on `document_id`; index on `live_session_id` |
| `review_item_resolutions` | Append-only resolution history | `id`, `review_item_id`, `resolved_by_user_id`, `resolution`, `edited_value_jsonb`, `notes`, `created_at` | Index on `review_item_id`; index on `resolved_by_user_id` |
| `live_conversation_sessions` | In-progress live capture state before final publication | `id`, `created_by_user_id`, `patient_id`, `encounter_id`, `status`, `linked_patient_label`, `encounter_label`, `document_id`, `duration_ms`, `transport_state_jsonb`, `draft_extraction_jsonb`, `current_transcript_id`, `started_at`, `ended_at`, `created_at`, `updated_at` | Index on `created_by_user_id`; index on `status`; index on `document_id`; index on `patient_id`; index on `encounter_id` |

### Chat, generation, alert, and audit tables

| Table | Purpose | Required key columns | Required indexes / constraints |
|------|---------|----------------------|--------------------------------|
| `chat_sessions` | Assistant thread per document context | `id`, `document_id`, `user_id`, `status`, `pending_external_consent_jsonb`, `pending_clarification_jsonb`, `pending_provider_prompt_jsonb`, `created_at`, `updated_at` | Index on `document_id`; index on `user_id` |
| `chat_messages` | User, assistant, and system messages | `id`, `chat_session_id`, `role`, `content`, `citations_jsonb`, `confidence_score`, `confidence_label`, `source_class`, `proposed_actions_jsonb`, `decision_prompt_jsonb`, `trace_jsonb`, `provider`, `created_at` | Index on (`chat_session_id`, `created_at`) |
| `chat_confirmed_actions` | Confirmed assistant proposals | `id`, `chat_session_id`, `document_id`, `action_type`, `title`, `rationale`, `payload_jsonb`, `confirmed_by_user_id`, `confirmed_at`, `created_at` | Index on `chat_session_id`; index on `document_id` |
| `chat_exports` | Exported chart-note appendix records | `id`, `chat_session_id`, `document_id`, `export_payload_jsonb`, `created_by_user_id`, `created_at` | Index on `document_id`; index on `chat_session_id` |
| `chart_notes` | Versioned chart note outputs | `id`, `document_id`, `version_no`, `content`, `validation_jsonb`, `citations_jsonb`, `reasoning_steps_jsonb`, `tokens_used`, `generation_time_ms`, `audit_run_id`, `created_by_user_id`, `created_at` | Unique on (`document_id`, `version_no`); index on `document_id` |
| `prescription_artifacts` | Generated prescription payloads and links to generated files | `id`, `document_id`, `version_no`, `prescription_payload_jsonb`, `html_asset_id`, `pdf_asset_id`, `created_by_user_id`, `created_at` | Unique on (`document_id`, `version_no`); index on `document_id` |
| `alert_deliveries` | Pharmacy and department notifications | `id`, `document_id`, `alert_family`, `target_name`, `channel`, `recipient`, `status`, `payload_jsonb`, `result_jsonb`, `error_message`, `sent_at`, `created_at` | Index on `document_id`; index on (`alert_family`, `target_name`); index on `status` |
| `audit_runs` | Workflow-level audit run records | `id`, `workflow`, `document_id`, `chat_session_id`, `request_id`, `actor_user_id`, `actor_label`, `status`, `title`, `metadata_jsonb`, `summary_jsonb`, `error_message`, `started_at`, `completed_at`, `duration_ms`, `created_at` | Index on `workflow`; index on `document_id`; index on `chat_session_id`; index on `request_id` |
| `audit_events` | Append-only audit event timeline | `id`, `audit_run_id`, `workflow`, `document_id`, `chat_session_id`, `event_type`, `status`, `title`, `details_jsonb`, `occurred_at`, `created_at` | Index on (`audit_run_id`, `occurred_at`); index on `document_id`; index on `workflow` |

### Interoperability infrastructure tables

| Table | Purpose | Required key columns | Required indexes / constraints |
|------|---------|----------------------|--------------------------------|
| `interop_endpoints` | External systems and transport configs | `id`, `name`, `direction`, `standard`, `transport`, `status`, `organization_id`, `config_jsonb`, `created_at`, `updated_at` | Unique on `name`; index on (`direction`, `standard`, `status`) |
| `interop_messages` | Raw and normalized inbound/outbound payload tracking | `id`, `endpoint_id`, `direction`, `standard`, `message_family`, `message_type`, `trigger_event`, `control_id`, `correlation_key`, `patient_id`, `encounter_id`, `document_id`, `processing_state`, `ack_state`, `raw_payload_text`, `normalized_payload_jsonb`, `error_message`, `received_at`, `sent_at`, `created_at` | Unique on (`endpoint_id`, `control_id`) when `control_id` present; index on `processing_state`; index on `patient_id`; index on `encounter_id`; index on `document_id` |
| `interop_message_events` | Message-level processing steps and retries | `id`, `interop_message_id`, `event_type`, `status`, `details_jsonb`, `occurred_at`, `created_at` | Index on (`interop_message_id`, `occurred_at`) |
| `interop_resource_links` | Mapping between internal entities and external resources | `id`, `internal_entity_type`, `internal_entity_id`, `external_system`, `external_resource_type`, `external_resource_id`, `external_version`, `sync_direction`, `link_status`, `last_synced_at`, `created_at`, `updated_at` | Unique on (`internal_entity_type`, `internal_entity_id`, `external_system`, `external_resource_type`, `external_resource_id`) |
| `identity_reconciliation_cases` | Human-review queue for identity conflicts | `id`, `entity_type`, `candidate_patient_id`, `candidate_encounter_id`, `source_system`, `case_status`, `reason_code`, `observed_identifiers_jsonb`, `candidate_matches_jsonb`, `resolution_jsonb`, `assigned_to_user_id`, `created_at`, `updated_at`, `resolved_at` | Index on `case_status`; index on `assigned_to_user_id`; index on `entity_type` |

### Deferred analytics table

The current analytics runtime uses `analytics.sqlite`. In Postgres, the derived projection should be migrated to a normal table named `analytics_document_metrics`, maintained by the application with the same incremental upsert pattern as the current SQLite store. Do not use a materialized view in phase 1.

## JSONB Versus Relational Rules

### Must remain relational

- entity identity and foreign keys
- login and session lifecycle
- document ownership and current pointers
- review workflow lifecycle
- audit run/event metadata
- interop endpoint and message lifecycle
- external identifier uniqueness

### Must remain JSONB

- `extracted_data`
- `dashboard_payload`
- `presentation`
- `stage1`
- `stage3`
- chart-note citations and reasoning traces
- assistant citations, trace, prompts, and proposed actions
- alert preview / delivery payloads
- normalized interop payloads
- reconciliation evidence and candidate-match payloads

### Must remain file/object backed

- uploaded PDFs
- uploaded dictation audio
- live conversation audio
- stored transcript artifact JSON files
- masked images and review images
- generated prescription HTML and PDF files
- generated chart-note PDFs

## FHIR-First + HL7 v2 Adapter Model

### Canonical resource alignment

Use these internal tables as the default FHIR-aligned persistence targets:

- `patients` -> `Patient`
- `encounters` -> `Encounter`
- `practitioners` -> `Practitioner`
- `organizations` -> `Organization`
- `locations` -> `Location`
- `documents` + `document_assets` + `document_extractions` -> `DocumentReference`
- `document_extractions.extracted_data_jsonb` for results -> `Observation`, `DiagnosticReport`, `MedicationRequest` projections

The app is not planning a full generic FHIR resource database in phase 1. It is planning a FHIR-aligned canonical schema that can publish and ingest those resource shapes.

### HL7 v2 adapter boundaries

HL7 v2 is an adapter and transport layer. The canonical path is:

1. receive or construct HL7 v2 payload
2. persist raw payload to `interop_messages`
3. normalize into `normalized_payload_jsonb`
4. map into canonical tables
5. record all processing steps in `interop_message_events`

For the immediate foundation, the message families are:

- `ADT` for patient and encounter lifecycle
- `ORM` for orders
- `ORU` for observations and results
- `MDM` for clinical document exchange

### Inbound and outbound support

Inbound flows must support:

- patient and encounter creation or update
- admission, discharge, and visit lifecycle synchronization
- order/result ingestion
- clinical document ingestion
- medication request ingestion

Outbound flows must support:

- publishing finalized documents as document references
- publishing medication-related outputs
- publishing observation or diagnostic result summaries when configured
- publishing patient and encounter references needed by downstream systems

### Hybrid identity model

The identity model is explicitly hybrid.

- `patients.identity_state` and `encounters.identity_state` use `provisional`, `reconciled`, `conflicted`, and `inactive`.
- `source_mode` uses `internal`, `external`, or `merged`.
- `patient_identifiers.status` and `encounter_identifiers.status` use `observed`, `verified`, `deprecated`.
- Internal and external identifiers can coexist on the same entity.
- The system must not overwrite canonical identity on ambiguous matches.

### Identity resolution rules

On inbound interoperability or backfill:

1. Exact identifier match:
   - attach to the existing entity
   - upsert missing identifiers
   - set `identity_state = reconciled` if no conflict remains
2. No identifier match but one unambiguous demographic match against a merged entity:
   - attach only if the identifier system is trusted for that endpoint
   - record the new identifier as `verified`
3. Multiple plausible matches or conflicting demographics:
   - do not merge
   - create `identity_reconciliation_cases`
   - keep inbound data as observed
4. No match:
   - create a new entity with `source_mode = external` or `internal` as applicable
   - mark identity as `provisional`

Backfilled document-extracted identity is always treated as observed unless later reconciled to verified external identifiers.

## Hospital Workflow Scope And Phasing

### Immediate foundation

The immediate implementation baseline includes:

- patient synchronization
- encounter synchronization
- admission, discharge, and update lifecycle
- order and result exchange
- clinical document exchange
- medication-related exchange
- app persistence migration for documents, voice, live conversation, chat, audit, alerts, and analytics

Default standards in this layer:

- FHIR: `Patient`, `Encounter`, `Observation`, `DiagnosticReport`, `MedicationRequest`, `DocumentReference`
- HL7 v2: `ADT`, `ORM`, `ORU`, `MDM`

### Phase 1 rule

The first production migration to Postgres must implement the persistence foundation plus empty-but-ready interoperability tables. It must not require live hospital interfaces to be online before current app persistence can cut over.

### Expansion phases

These workflows are in architecture scope now, but not part of the immediate migration baseline:

- scheduling and appointments
- care plans and tasks
- coverage and claims references
- wider hospital routing and billing-related exchanges

Default standards in this layer:

- FHIR: `Appointment`, `Schedule`, `CarePlan`, `Task`, `Coverage`, `Claim`
- HL7 v2: `SIU` plus later financial message families

### Deferred expansion table families

Do not create these tables in the immediate foundation unless an implementation phase explicitly starts for them:

- `appointments`
- `appointment_identifiers`
- `schedules`
- `care_plans`
- `tasks`
- `coverages`
- `claims`
- `claim_events`

## Migration And Cutover

### Source-to-target mapping

| Current store | Target table(s) | Migration notes |
|--------------|------------------|-----------------|
| `users.json` | `users` | Direct migration; optionally backfill `practitioner_id` later |
| `auth_sessions.json` | `auth_sessions` | Direct migration of active sessions |
| `documents.json` | `documents`, `document_extractions`, `document_assets`, `chart_notes`, `prescription_artifacts`, `alert_deliveries` | Main canonical migration source |
| `voice_sessions.json` | `documents`, `transcripts`, `transcript_segments`, `review_items`, `document_extractions`, `document_assets` | Remove duplicate ownership after cutover |
| `voice_reviews.json` | `review_item_resolutions`, `audit_events` | Preserve approval/edit history |
| `live_conversation_sessions.json` | `live_conversation_sessions`, `transcripts`, `transcript_segments`, `review_items`, `document_assets` | Keep draft workflow separate from final documents |
| `live_conversation_events.jsonl` | `audit_events` | Store as workflow audit events, not interop events |
| `chat_sessions.json` | `chat_sessions`, `chat_messages` | Preserve pending consent/clarification state |
| `chat_actions.json` | `chat_confirmed_actions` | Direct migration |
| `chat_exports.json` | `chat_exports` | Direct migration |
| `audit_runs.json` | `audit_runs` | Direct migration |
| `audit_events.jsonl` | `audit_events` | Preserve append-only ordering |
| `pharmacy_alerts.jsonl` | `alert_deliveries` | Map family, target, channel, payload, and result |
| `department_alerts.jsonl` | `alert_deliveries` | One delivery row per department target and channel |
| `analytics.sqlite` | `analytics_document_metrics` | Recompute or copy as derived data |
| `auth.db` | none | Ignore; currently empty and not used by runtime |

### Observed identity backfill

Current documents and sessions contain patient and encounter-like values such as:

- patient name
- MRN
- `hospital_no`
- `ipd_number`
- `opd_number`
- `episode_number`
- `linkedPatient`
- `encounterLabel`

Backfill rules:

- patient names populate `patients.display_name` only for provisional records when no stronger patient entity exists
- `mrn` and `hospital_no` map to `patient_identifiers`
- `ipd_number`, `opd_number`, `episode_number`, and encounter-style visit codes map to `encounter_identifiers`
- `linkedPatient` and `encounterLabel` from voice and live workflows are treated as observed labels, not verified master identifiers
- document-extracted patient and encounter content remains preserved inside `document_extractions.extracted_data_jsonb` even after canonical links are established

### Migration phases

#### Phase 0: schema foundation

- create all immediate-foundation tables
- create enums, check constraints, and required indexes
- create empty interoperability tables and leave them inactive

#### Phase 1: repository and data-access layer

- introduce one persistence boundary per domain: auth, documents, transcripts, live sessions, chat, audit, alerts, analytics, interop
- keep filesystem assets in place
- do not change public routes yet

#### Phase 2: dual-write

- write new app mutations to both JSON/filesystem metadata stores and Postgres
- do this first for auth and documents, then voice, live conversation, chat, audit, alerts, and analytics
- interop tables remain empty unless adapters are enabled

#### Phase 3: backfill

- backfill app identity tables
- backfill documents and document assets
- backfill extraction versions
- backfill transcripts and segments
- backfill review items and resolutions
- backfill live-session workflow state
- backfill chat sessions, messages, actions, and exports
- backfill audit runs and events
- backfill alert deliveries
- backfill derived analytics
- create provisional patient and encounter records plus observed identifiers

#### Phase 4: read cutover

- cut over auth reads first
- cut over documents and extractions next
- cut over voice transcript and review reads next
- cut over live conversation workflow reads next
- cut over chat, audit, alerts, and analytics last
- do not enable interop adapters until the persistence foundation is stable

#### Phase 5: identity reconciliation

- run exact-identifier match against provisional patient and encounter records
- create reconciliation cases for ambiguous conflicts
- do not force merge observed extracted identities

#### Phase 6: cleanup

- stop writing JSON metadata stores once Postgres is authoritative
- remove startup repair dependency on session-store hydration into documents
- keep file assets until object-storage migration, if any, is separately planned

## Validation And Parity Checks

### Required parity checks before read cutover

- document row counts match `documents.json`
- document hashes and dedupe behavior match current runtime
- transcript counts match voice/live session counts
- transcript segment counts match source JSON payloads
- review item counts and current resolutions match source stores
- audit run and audit event counts match file-backed stores
- alert delivery counts match line-oriented logs after row expansion
- chart-note, chat-export, and prescription-artifact counts match document-derived source data
- `analytics_document_metrics` matches `analytics.sqlite`

### Required identity checks

- every backfilled patient or encounter identifier has a source label
- all provisional identities created from document extraction are marked `observed`, not `verified`
- conflicting extracted identities create reconciliation cases instead of destructive merge
- interop link tables remain empty until adapters are turned on, unless seeded deliberately for pilot integrations

### Required interop checks once adapters start

- control IDs are unique per endpoint
- message normalization payloads can be replayed without loss of raw payload
- patient and encounter references created from HL7/FHIR messages resolve through canonical tables
- outbound publication records create `interop_messages` and `interop_resource_links` consistently

## Non-Goals

- storing binary blobs inside Postgres
- implementing a generic full FHIR server in phase 1
- implementing a full HL7 interface engine in phase 1
- normalizing every extracted medication, diagnosis, lab, or radiology item into separate relational tables
- making external systems authoritative for all identity on day one
- changing public API contracts during the documentation phase

## Assumptions And Defaults

- PostgreSQL becomes the authoritative metadata store after phased cutover.
- The persistence model is FHIR-first with HL7 v2 adapters.
- Both inbound and outbound interoperability are in architecture scope.
- Identity uses a hybrid merge model.
- Full hospital workflows are documented now but split into immediate foundation and later expansion phases.
- Files remain on filesystem or object storage; only metadata moves into Postgres.
- Public API docs stay unchanged until implementation lands.
