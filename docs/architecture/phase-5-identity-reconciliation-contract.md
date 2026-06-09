# Phase 5: Identity Reconciliation Contract

## Date
2026-06-03

## Status
Planning-oriented implementation contract

## Purpose
Define the exact implementation contract for `Phase 5` so provisional patient and encounter identities created in earlier phases are reconciled into stable canonical entities without silent merges, filesystem rewrites, or loss of extracted source evidence.

This document is intentionally narrower than the canonical architecture plan. It translates the `Phase 5` intent into the concrete repository seams, table mutations, case-management rules, and verification steps required by this codebase.

## Phase Boundary

### In scope

- exact identifier-based reconciliation for `patients` and `encounters`
- promotion of entity `identity_state` from `provisional` to `reconciled` when deterministic rules are satisfied
- creation of `identity_reconciliation_cases` for ambiguous or conflicting matches
- trusted external-identifier attach flow for explicitly trusted endpoint sources
- safe merge of duplicate provisional entities when one exact canonical winner exists
- update of relational foreign keys that reference merged patient or encounter rows
- conservative identifier status transitions between `observed`, `verified`, and `deprecated`
- machine-readable reconciliation reporting
- optional admin/API or CLI review surface for open reconciliation cases

### Explicitly out of scope

- fuzzy name-only or label-only auto-merge
- demographic-only auto-merge
- rewriting `users.json`, `documents.json`, `voice_sessions.json`, or `live_conversation_sessions.json`
- re-running Phase 3 backfill logic as part of reconciliation
- deleting inactive patient or encounter rows
- changing document extraction payloads that preserve observed source identity
- enabling live HL7/FHIR adapters by default
- building a full patient-master UI in this phase

`linkedPatient` and `encounterLabel` remain labels in Phase 5. They are useful evidence, not canonical identifiers.

## Preconditions

- `Phase 3A`, `Phase 3B`, and `Phase 3C` completed successfully:
  - provisional `patients` and `encounters` exist
  - `patient_identifiers` and `encounter_identifiers` are populated conservatively
  - canonical `documents` and `live_conversation_sessions` already carry nullable `patient_id` / `encounter_id`
- `Phase 4` read cutover is complete for the subsystems whose records will be repointed by reconciliation
- PostgreSQL is the active metadata authority for all rows touched by Phase 5
- `identity_reconciliation_cases` exists from `Phase 0`
- no Phase 5 implementation may bypass repository/service boundaries with ad hoc SQL inside route handlers
- if trusted external-identifier attach is enabled, endpoint trust configuration must be explicit and code-reviewed

## Current Runtime Truth

### Current codebase facts

- `server/repositories/master_data_repository.cjs` exists, but today it only exposes basic create/find/update operations for:
  - `patients`
  - `patient_identifiers`
  - `encounters`
  - `encounter_identifiers`
  - `practitioners`
- `server/repositories/interop_repository.cjs` exists for:
  - `interop_endpoints`
  - `interop_messages`
  - `interop_message_events`
  - `interop_resource_links`
- `server/repositories/index.cjs` currently does not export `MasterDataRepository`
- no repository or service currently writes to `identity_reconciliation_cases`
- no route currently exposes an identity reconciliation queue

### Current relational references that Phase 5 may have to rewrite

Patient references exist in:

- `encounters.patient_id`
- `documents.patient_id`
- `live_conversation_sessions.patient_id`
- `interop_messages.patient_id`

Encounter references exist in:

- `documents.encounter_id`
- `live_conversation_sessions.encounter_id`
- `interop_messages.encounter_id`

### Current label behavior that must be preserved

The runtime still exposes label fields through document and live-session flows:

- `documents.linked_patient_label`
- `documents.encounter_label`
- `live_conversation_sessions.linked_patient_label`
- `live_conversation_sessions.encounter_label`

Those remain preserved after reconciliation. Phase 5 changes canonical foreign keys and identity state, not the historical evidence captured in labels or extraction payloads.

## Required Code Boundaries

### 1. Master-data boundary

Phase 5 must extend `server/repositories/master_data_repository.cjs` for:

- candidate discovery
- identifier lookup by normalized value
- state transition helpers
- safe merge helpers
- identifier status updates
- reference-repoint operations

This repository remains the only allowed write boundary for `patients`, `patient_identifiers`, `encounters`, and `encounter_identifiers`.

### 2. Reconciliation-case boundary

Phase 5 must add one of these two options:

1. extend `MasterDataRepository` with `identity_reconciliation_cases` methods, or
2. add a dedicated `IdentityReconciliationRepository`

If option 2 is used, that repository must own only case queue CRUD and reporting. It must not duplicate patient or encounter lookup logic already owned by `MasterDataRepository`.

### 3. Interop boundary

Trusted external-identifier attach logic must use `server/repositories/interop_repository.cjs` for:

- endpoint lookup
- endpoint trust configuration
- message lookup
- resource-link lookup

### 4. Service boundary

Phase 5 must add one shared reconciliation service, for example:

- `server/identity_reconciliation_service.cjs`

That service owns:

- normalization
- candidate matching
- ambiguity detection
- merge execution
- case creation
- report assembly

Route handlers and CLI scripts must call the service. They must not re-implement reconciliation rules independently.

### 5. Export boundary

Before wiring Phase 5, `server/repositories/index.cjs` must export whichever repository classes Phase 5 requires:

- `MasterDataRepository`
- optional `IdentityReconciliationRepository`

## Implementation Rules

### 1. Exact identifier beats labels and names

Allowed automatic match inputs are deterministic identifiers only.

Patient identifier systems allowed for automatic reconciliation:

- `mrn`
- `hospital_no`
- `hospital_number`
- explicitly trusted external patient identifier systems

Encounter identifier systems allowed for automatic reconciliation:

- `episode_number`
- `ipd_number`
- `opd_number`
- explicitly trusted external encounter identifier systems

Phase 5 must not auto-merge on:

- `linkedPatient`
- `encounterLabel`
- display name alone
- approximate demographic similarity

### 2. Normalize before comparing

Identifier comparison must normalize values before lookup:

- trim whitespace
- lowercase string values
- collapse obvious repeated interior spaces

The raw observed value should still be preserved in evidence payloads when a case is created.

### 3. Preserve source evidence

Phase 5 must never remove or rewrite:

- `documents.linked_patient_label`
- `documents.encounter_label`
- `live_conversation_sessions.linked_patient_label`
- `live_conversation_sessions.encounter_label`
- `document_extractions.extracted_data_jsonb`
- draft extraction payloads stored on live sessions

Canonical links may change; evidence payloads do not.

### 4. No silent overwrite of canonical identity

If more than one plausible target exists, or if a merge would change a patient/encounter linkage in a non-deterministic way:

- do not merge
- create `identity_reconciliation_cases`
- mark affected entities `conflicted`

### 5. Do not merge entities already under review

If a patient or encounter is referenced by an `identity_reconciliation_cases` row whose `case_status` is:

- `open`
- `in_review`

then Phase 5 must not auto-merge that entity in a batch job. It may only:

- skip it, or
- append a new blocking case if the conflict is newly discovered

### 6. Mutations must be transactional per decision unit

Every automatic merge or trusted attach must run in a single database transaction covering:

- entity state updates
- identifier updates
- reference repoints
- case creation or resolution updates
- report bookkeeping rows or payloads

One failed merge must not partially repoint foreign keys.

### 7. Reconciliation must be idempotent

Re-running Phase 5 must not:

- create duplicate cases for the same already-resolved action
- repeatedly demote/promote the same identifier
- flip reconciled entities back to provisional
- re-merge inactive losers

### 8. `source_mode` must be validated in service logic

`source_mode` is plain `TEXT` in the schema. Phase 5 must restrict it in code to:

- `internal`
- `external`
- `merged`

No other value may be written.

## Identity State Semantics For Phase 5

### `patients.identity_state`

- `provisional`: not yet canonically resolved
- `reconciled`: deterministically linked and not blocked by open conflict
- `conflicted`: blocked by an active reconciliation case
- `inactive`: losing row after a completed merge

### `encounters.identity_state`

- `provisional`: not yet canonically resolved
- `reconciled`: deterministically linked and not blocked by open conflict
- `conflicted`: blocked by an active reconciliation case
- `inactive`: losing row after a completed merge

### Identifier status semantics

- `observed`: backfilled or runtime-observed, not externally trusted
- `verified`: attached through an explicitly trusted flow or manual resolution
- `deprecated`: superseded on a losing entity or intentionally retired after merge

`reconciled` does not imply every identifier is `verified`. It only means the entity itself is no longer unresolved.

## Candidate Discovery

### Patient candidates

Phase 5 must scan these patient-side sources:

- `patients` with `identity_state IN ('provisional', 'conflicted')`
- `patient_identifiers`
- `documents.patient_id`
- `live_conversation_sessions.patient_id`
- trusted interop payloads or resource links when enabled

### Encounter candidates

Phase 5 must scan these encounter-side sources:

- `encounters` with `identity_state IN ('provisional', 'conflicted')`
- `encounter_identifiers`
- `documents.encounter_id`
- `live_conversation_sessions.encounter_id`
- trusted interop payloads or resource links when enabled

### Minimum evidence threshold

Automatic reconciliation is allowed only when at least one deterministic identifier is present.

If an entity has labels only and no deterministic identifier:

- keep it `provisional`
- do not auto-create a conflict case unless a human-triggered workflow explicitly asks for review

## Exact Identifier Reconciliation Algorithm

### Patient flow

Run patient reconciliation in this order:

1. collect normalized deterministic patient identifiers for one candidate patient
2. find all patient rows reachable by those identifiers
3. if zero other rows match:
   - keep the current row
   - if it has at least one deterministic identifier and no open blocking case, mark it `reconciled`
   - set `source_mode = internal` unless trusted external evidence is also attached
4. if exactly one other patient row matches and one row is already a stronger canonical winner:
   - merge the weaker row into the stronger row
5. if more than one target row is plausible:
   - create a patient reconciliation case
   - mark all involved patient rows `conflicted`

Winner selection priority for automatic patient merge:

1. existing `identity_state = reconciled`
2. row with any `verified` identifier
3. row with active inbound/outbound `interop_resource_links`
4. row referenced by more canonical records:
   - more `documents`
   - then more `live_conversation_sessions`
   - then more `interop_messages`
5. older `created_at`

If the priority stack still ties, the merge is ambiguous and must become a case.

### Encounter flow

Run encounter reconciliation after patient reconciliation.

1. collect normalized deterministic encounter identifiers
2. find all encounter rows reachable by those identifiers
3. if zero other rows match:
   - keep the current row
   - if it has at least one deterministic identifier and no blocking case, mark it `reconciled`
4. if exactly one other encounter row matches:
   - verify patient linkage compatibility first
   - only then merge weaker into stronger
5. if multiple targets or incompatible patient ownership is found:
   - create an encounter reconciliation case
   - mark affected encounter rows `conflicted`

Encounter auto-merge is blocked if:

- the candidate encounter points to patient A
- the winning encounter points to patient B
- and patient A and patient B are not already the same reconciled patient after the patient pass

That situation requires a case with reason code `patient_encounter_mismatch`.

## Trusted External-Identifier Attach Flow

### Allowed sources

Trusted external attach is allowed only from:

- `interop_messages.normalized_payload_jsonb`
- manual admin resolution payloads
- pre-existing `interop_resource_links`

Filesystem document/session data is never a trusted external source by itself.

### Required endpoint configuration

Phase 5 must not infer trust from endpoint name or transport alone.

An endpoint must explicitly declare trusted identifier systems inside `interop_endpoints.config_jsonb`, for example:

```json
{
  "identity_reconciliation": {
    "trusted_patient_identifier_systems": ["mrn", "hospital_no", "fhir_patient_id"],
    "trusted_encounter_identifier_systems": ["episode_number", "visit_number", "fhir_encounter_id"]
  }
}
```

Equivalent naming is acceptable, but the code must satisfy all of these rules:

- trust is explicit
- trust is system-specific
- trust is endpoint-specific
- absence of config means "not trusted"

### Attach decision rules

Automatic attach of a trusted external identifier is allowed only when one of the following is already true:

1. the message also contains an exact internal identifier already bound to one canonical entity, or
2. an active `interop_resource_links` row already maps that external resource to one canonical entity

If neither anchor exists:

- do not attach automatically
- create a reconciliation case

### Identifier status rules for trusted attach

- the newly attached trusted external identifier becomes `verified`
- existing internal extracted identifiers remain `observed`
- if both internal and trusted external identifiers now coexist on the same entity, set `source_mode = merged`

## Merge Semantics

### Patient merge

When patient row `loser_patient_id` is merged into `winner_patient_id`, Phase 5 must:

1. repoint `encounters.patient_id`
2. repoint `documents.patient_id`
3. repoint `live_conversation_sessions.patient_id`
4. repoint `interop_messages.patient_id`
5. move or update `patient_identifiers.patient_id` to the winner
6. mark conflicting or superseded losing identifiers `deprecated` if they should remain as historical evidence
7. set `patients.identity_state = reconciled` on the winner if no open conflict remains
8. set `patients.source_mode` on the winner to:
   - `merged` when both internal and external evidence exist
   - otherwise preserve the strongest existing value
9. set `loser_patient_id.identity_state = inactive`
10. write merge trace metadata into the losing row's `demographics_jsonb`

### Encounter merge

When encounter row `loser_encounter_id` is merged into `winner_encounter_id`, Phase 5 must:

1. repoint `documents.encounter_id`
2. repoint `live_conversation_sessions.encounter_id`
3. repoint `interop_messages.encounter_id`
4. move or update `encounter_identifiers.encounter_id` to the winner
5. mark superseded losing identifiers `deprecated` when needed
6. set `encounters.identity_state = reconciled` on the winner if no open conflict remains
7. set `loser_encounter_id.identity_state = inactive`
8. write merge trace metadata into the losing row's `details_jsonb`

### Rows that must never be deleted in Phase 5

- `patients`
- `encounters`
- `patient_identifiers`
- `encounter_identifiers`
- `identity_reconciliation_cases`

Phase 5 uses state transitions and reference repoints, not hard deletes.

## Reconciliation Case Contract

### Case creation triggers

Create `identity_reconciliation_cases` when any of these happens:

- more than one patient candidate is plausible
- more than one encounter candidate is plausible
- patient and encounter ownership disagree
- a trusted external identifier conflicts with an already-attached canonical entity
- an auto-merge would touch an entity already under review
- attach was requested from an untrusted endpoint

### Required `reason_code` values

At minimum, Phase 5 must support:

- `multiple_patient_candidates`
- `multiple_encounter_candidates`
- `patient_encounter_mismatch`
- `trusted_identifier_conflict`
- `untrusted_external_identifier`
- `entity_already_in_review`
- `manual_review_required`

### Required JSON payload structure

`observed_identifiers_jsonb` must contain:

- `identifiers`
- `labels`
- `demographics`
- `source_records`

`candidate_matches_jsonb` must contain:

- `candidates`
- `match_basis`
- `blocked_by`

`resolution_jsonb` must contain, once resolved:

- `action`
- `winner_patient_id` or `winner_encounter_id`
- `loser_patient_id` or `loser_encounter_id` when merged
- `identifier_updates`
- `reference_updates`
- `resolved_by_user_id`
- `notes`

### Case lifecycle

- new cases start at `case_status = open`
- assignment moves a case to `in_review`
- successful human resolution moves it to `resolved`
- explicitly postponed work moves it to `deferred`

When a case remains `open` or `in_review`, the affected entity must remain `conflicted`.

## Recommended File-Level Implementation Plan

### Repository changes

Add or extend methods in:

- `server/repositories/master_data_repository.cjs`
- `server/repositories/interop_repository.cjs`
- `server/repositories/index.cjs`

Expected new master-data methods:

- `findPatientIdentifiersByNormalizedValue(...)`
- `findEncounterIdentifiersByNormalizedValue(...)`
- `listPatientsByIdentityState(...)`
- `listEncountersByIdentityState(...)`
- `countReferencesForPatient(...)`
- `countReferencesForEncounter(...)`
- `mergePatients(...)`
- `mergeEncounters(...)`
- `updatePatientIdentifierStatus(...)`
- `updateEncounterIdentifierStatus(...)`

Expected interop helper methods:

- `findEndpointTrustConfig(...)`
- `findMessagesByExternalResource(...)`
- `findActiveResourceLink(...)`

### Service and route changes

Recommended additions:

- `server/identity_reconciliation_service.cjs`
- optional `server/identity_reconciliation_routes.cjs`

If routes are added, keep them admin-only and JSON-first. Phase 5 does not require a full frontend before the queue can be used.

### CLI / batch runner

Recommended script:

- `server/db/reconcile_phase_5.cjs`

Expected CLI modes:

- `--dry-run`
- `--report-only`
- `--entity-type=patient`
- `--entity-type=encounter`
- `--case-id=<id>` for targeted resolution replay or diagnostics

## Execution Order

Run `Phase 5` in this exact order:

1. export `MasterDataRepository` from `server/repositories/index.cjs`
2. add repository methods for candidate discovery, merge, and identifier updates
3. add case-queue repository methods
4. add trusted endpoint config readers to `InteropRepository`
5. implement the shared reconciliation service
6. implement the Phase 5 CLI runner
7. add optional admin/API endpoints for case inspection and manual resolution
8. write unit tests for normalization, matching, ambiguity, merge, and idempotency
9. run Phase 5 in `--dry-run` mode and inspect the report
10. fix blockers discovered in dry run
11. execute targeted live reconciliation in small batches
12. verify post-run invariants
13. resolve remaining open cases manually
14. emit the final Phase 5 reconciliation report

## Required Report

Phase 5 must emit a machine-readable report with:

- total provisional patients scanned
- total provisional encounters scanned
- exact patient reconciliations completed
- exact encounter reconciliations completed
- trusted external patient identifiers attached
- trusted external encounter identifiers attached
- patient merges completed
- encounter merges completed
- cases created by `reason_code`
- cases resolved
- cases deferred
- entities skipped because they were already under review
- identifiers promoted to `verified`
- identifiers marked `deprecated`
- reference rows repointed by table
- errors and transaction rollbacks

## Verification Queries

### 1. No active references may point at inactive entities

```sql
SELECT COUNT(*) AS inactive_patient_refs
FROM documents d
JOIN patients p ON p.id = d.patient_id
WHERE p.identity_state = 'inactive';
```

```sql
SELECT COUNT(*) AS inactive_encounter_refs
FROM documents d
JOIN encounters e ON e.id = d.encounter_id
WHERE e.identity_state = 'inactive';
```

Equivalent checks must also be run for:

- `live_conversation_sessions`
- `interop_messages`
- `encounters.patient_id` for inactive patient winners/losers

### 2. Every conflicted entity must have an open or in-review case

```sql
SELECT COUNT(*) AS conflicted_patients_without_case
FROM patients p
WHERE p.identity_state = 'conflicted'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_reconciliation_cases c
    WHERE c.entity_type = 'patient'
      AND c.candidate_patient_id = p.id
      AND c.case_status IN ('open', 'in_review')
  );
```

### 3. Every reconciled entity must have deterministic evidence

```sql
SELECT COUNT(*) AS reconciled_patients_without_identifier
FROM patients p
WHERE p.identity_state = 'reconciled'
  AND NOT EXISTS (
    SELECT 1
    FROM patient_identifiers pi
    WHERE pi.patient_id = p.id
  );
```

Run the equivalent query for `encounters`.

### 4. No automatic verification of extracted-only identifiers

Phase 5 verification must confirm:

- identifiers sourced only from Phase 3 backfill stay `observed`
- only trusted external attach or explicit manual resolution produces `verified`

## Exit Gate

Phase 5 is complete only when all of the following are true:

- every automatic reconciliation decision is exact-identifier based
- no name-only or label-only merge occurred
- every blocked ambiguity created an `identity_reconciliation_cases` row
- no canonical reference still points to an `inactive` patient or encounter
- every `conflicted` entity has a matching open or in-review case
- trusted external identifiers were attached only from explicitly trusted endpoint config
- extracted identity evidence remained preserved in labels and JSON payloads
- the Phase 5 report was generated and reviewed
- rerunning the reconciliation job is idempotent

## Rollback Rules

Phase 5 is not a flag-only rollback phase.

Unlike `Phase 4`, once a merge is committed, rollback requires data repair. Therefore:

- every merge must emit a reversible change record in the Phase 5 report
- each merge must be one transaction
- live execution should run only after a fresh database backup or snapshot
- if a batch fails mid-run, already committed earlier transactions remain valid and later units must stop
- do not attempt to "rollback" by editing filesystem source stores

## Non-Goals

- fuzzy matching by name, age, or sex
- retroactively changing source JSON documents
- deleting losing entities
- promoting all observed identifiers to verified
- enabling interop adapters broadly just to test reconciliation
- making unresolved identity invisible by forcing best-effort links
