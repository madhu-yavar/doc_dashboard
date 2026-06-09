# Postgres Persistence + HL7/FHIR Interoperability Checklist

> Planning tracker
> This checklist tracks delivery against the canonical plan in [postgres-persistence-interoperability-plan.md](./postgres-persistence-interoperability-plan.md). It is an execution tracker, not a substitute for the architecture document.

## Status Key

- `[ ]` not started
- `[-]` in progress
- `[x]` completed
- `[!]` blocked / decision or dependency needed

## Schema Foundation

- [ ] Create PostgreSQL schema for the immediate foundation tables
- [ ] Add enums and check constraints for document, review, audit, and interop states
- [ ] Add required indexes and uniqueness constraints
- [ ] Add empty-but-ready interop tables without enabling adapters
- [ ] Define migration naming/versioning convention

## Master Data + Identity

- [ ] Add `patients`
- [ ] Add `patient_identifiers`
- [ ] Add `encounters`
- [ ] Add `encounter_identifiers`
- [ ] Add `practitioners`
- [ ] Add `organizations`
- [ ] Add `locations`
- [ ] Link `users.practitioner_id`
- [ ] Define `provisional`, `reconciled`, `conflicted`, and `inactive` identity states
- [ ] Define `observed`, `verified`, and `deprecated` identifier states

## Core App Persistence Migration

- [ ] Add `users`
- [ ] Add `auth_sessions`
- [ ] Add `documents`
- [ ] Add `document_assets`
- [ ] Add `document_extractions`
- [ ] Add `transcripts`
- [ ] Add `transcript_segments`
- [ ] Add `review_items`
- [ ] Add `review_item_resolutions`
- [ ] Add `live_conversation_sessions`
- [ ] Add `chat_sessions`
- [ ] Add `chat_messages`
- [ ] Add `chat_confirmed_actions`
- [ ] Add `chat_exports`
- [ ] Add `chart_notes`
- [ ] Add `prescription_artifacts`
- [ ] Add `alert_deliveries`
- [ ] Add `audit_runs`
- [ ] Add `audit_events`
- [ ] Add `analytics_document_metrics`

## Interop Infrastructure

- [ ] Add `interop_endpoints`
- [ ] Add `interop_messages`
- [ ] Add `interop_message_events`
- [ ] Add `interop_resource_links`
- [ ] Add `identity_reconciliation_cases`
- [ ] Define FHIR-first canonical mapping rules
- [ ] Define HL7 v2 adapter boundaries for `ADT`, `ORM`, `ORU`, and `MDM`
- [ ] Define later-phase expansion targets for `SIU`, `Coverage`, `Claim`, `Appointment`, `Schedule`, `CarePlan`, and `Task`

## Dual-Write

- [ ] Dual-write auth mutations to Postgres
- [ ] Dual-write document upload and processing metadata to Postgres
- [ ] Dual-write voice dictation session state to Postgres
- [ ] Dual-write live conversation session state to Postgres
- [ ] Dual-write chat sessions and messages to Postgres
- [ ] Dual-write audit runs and events to Postgres
- [ ] Dual-write alert delivery records to Postgres
- [ ] Dual-write analytics projection updates to Postgres

## Backfill

- [ ] Backfill `users.json` into `users`
- [ ] Backfill `auth_sessions.json` into `auth_sessions`
- [ ] Backfill `documents.json` into `documents`
- [ ] Backfill document-related files into `document_assets`
- [ ] Backfill extraction payloads into `document_extractions`
- [ ] Backfill `voice_sessions.json` into transcripts, segments, review items, and document-linked records
- [ ] Backfill `voice_reviews.json` into `review_item_resolutions`
- [ ] Backfill `live_conversation_sessions.json` into `live_conversation_sessions`, transcripts, segments, and review items
- [ ] Backfill `chat_sessions.json` into `chat_sessions` and `chat_messages`
- [ ] Backfill `chat_actions.json` into `chat_confirmed_actions`
- [ ] Backfill `chat_exports.json` into `chat_exports`
- [ ] Backfill `audit_runs.json` into `audit_runs`
- [ ] Backfill `audit_events.jsonl` into `audit_events`
- [ ] Backfill `pharmacy_alerts.jsonl` and `department_alerts.jsonl` into `alert_deliveries`
- [ ] Backfill `analytics.sqlite` into `analytics_document_metrics`
- [ ] Seed provisional patient and encounter records plus observed identifiers from current extracted fields
- [ ] Ignore `auth.db` during backfill

## Read Cutover

- [ ] Cut over auth reads
- [ ] Cut over document reads
- [ ] Cut over extraction reads
- [ ] Cut over transcript and segment reads
- [ ] Cut over review workflow reads
- [ ] Cut over live conversation workflow reads
- [ ] Cut over chat reads
- [ ] Cut over audit reads
- [ ] Cut over alert reads
- [ ] Cut over analytics reads
- [ ] Keep interop adapters disabled until core read cutover is stable

## Identity Reconciliation

- [ ] Implement exact identifier matching
- [ ] Implement trusted external-identifier attach flow
- [ ] Implement ambiguous match detection
- [ ] Create `identity_reconciliation_cases` for conflicts
- [ ] Prevent silent overwrite of canonical patient and encounter identity
- [ ] Preserve observed extracted identity in extraction payloads after reconciliation

## Validation

- [ ] Validate document counts and hashes
- [ ] Validate transcript counts and segment counts
- [ ] Validate review-item counts and current resolutions
- [ ] Validate audit run and audit event parity
- [ ] Validate alert delivery parity after row expansion
- [ ] Validate analytics parity with `analytics.sqlite`
- [ ] Validate patient and encounter identifier coverage
- [ ] Validate that backfilled provisional identities are marked `observed`
- [ ] Validate that unresolved conflicts create reconciliation cases
- [ ] Validate interop tables remain empty until adapters are intentionally enabled

## Subsystem Gates

### Auth
- [ ] Login, session refresh, and logout work from Postgres-backed reads and writes

### Documents
- [ ] PDF upload and processing work with Postgres-backed metadata

### Voice Dictation
- [ ] Uploaded dictation persists transcript, review, and extraction state in Postgres

### Live Conversation
- [ ] Live sessions persist draft transcript and review state in Postgres without relying on document hydration repair

### Chat
- [ ] Assistant sessions, pending consent, and message history persist in Postgres

### Chart Notes
- [ ] Chart note versions and citations persist in Postgres

### Prescriptions
- [ ] Generated prescription payloads and file references persist in Postgres

### Alerts
- [ ] Pharmacy and department alert deliveries persist in Postgres

### Audit
- [ ] Workflow audit runs and events persist in Postgres

### Analytics
- [ ] Processing insights reads from `analytics_document_metrics`

### HL7/FHIR Inbound Adapters
- [ ] Inbound payloads persist to `interop_messages` and `interop_message_events`

### HL7/FHIR Outbound Publishers
- [ ] Outbound publications persist to `interop_messages` and `interop_resource_links`

## Cleanup

- [ ] Stop JSON metadata writes after cutover
- [ ] Remove file-backed metadata reads after cutover
- [ ] Remove voice/live startup repair dependency for canonical document hydration
- [ ] Keep file assets in place until any separate object-storage migration is complete
- [ ] Archive or remove obsolete file-backed metadata stores after validation sign-off

## Doc/Runtime Truth Updates

- [ ] Update current-state docs only after runtime implementation lands
- [ ] Update API docs if any endpoint contracts change
- [ ] Update deployment docs once Postgres becomes required runtime infrastructure
- [ ] Update getting-started docs once Postgres bootstrapping is part of local setup
- [ ] Reclassify this plan from planning to implemented-reference when cutover is complete
