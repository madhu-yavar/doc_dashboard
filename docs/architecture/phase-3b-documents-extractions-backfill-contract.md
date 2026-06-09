# Phase 3B: Documents + Extractions Backfill Contract

## Date
2026-06-02

## Status
Planning-oriented implementation contract

## Purpose
Define the exact implementation contract for `Phase 3B` so the backfill of canonical documents, document assets, extraction versions, and document-derived artifacts is done against the real runtime stores in this repository.

This document exists to prevent the same class of drift that affected `Phase 2A`: guessing shapes, guessing status mappings, and inventing file-to-table behavior that is not true in the live app.

## Phase Boundary

### In scope

- `documents.json -> documents`
- document-linked source files -> `document_assets`
- current extracted payloads -> `document_extractions`
- cached chart notes in document rows -> `chart_notes`
- generated prescription files that can be deterministically linked -> `document_assets` + `prescription_artifacts`

### Explicitly out of scope

- transcript/segment/review-item backfill from `voice_sessions.json`
- live workflow draft state
- alert delivery history from `*.jsonl`
- audit history
- analytics migration

Voice/live workflow tables remain `Phase 3C`. Alert delivery logs remain `Phase 3D`.

## Preconditions

- `Phase 3A` has already created provisional `patient_id` and `encounter_id` records where deterministically possible.
- `Phase 3B` must reuse `DocumentsRepository`.
- `Phase 3B` must not create a parallel “backfill repository” with raw SQL unless the existing repository lacks a required operation.

## Current Runtime Truth

### Authoritative document source

`server/storage/documents.json` is the canonical published queue for:

- uploaded PDFs
- finalized uploaded dictation records
- finalized live-conversation records

Its real shape is:

- wrapper: `{ "documents": [...] }`
- newest-first ordering

### Current document row families

There are at least two materially different row shapes:

1. Standard PDF rows
2. Voice/live-derived final document rows

Current fields seen in live data include:

| Field | Present on |
|---|---|
| `id` | all rows |
| `status` | all rows |
| `name` | all rows |
| `size` | most rows |
| `uploadedAt` | most rows |
| `processedAt` | processed rows |
| `department` | many rows |
| `filePath` | PDF uploads and some finalized media rows |
| `hash` | many rows |
| `error` | failed rows |
| `documentType` | voice/live rows and some classified flows |
| `documentSubtype` | live conversation rows |
| `fileName` | voice/live rows |
| `mimeType` / `fileType` | voice/live rows and some PDFs |
| `linkedPatient` | voice/live and some extracted flows |
| `encounterLabel` | voice/live and some extracted flows |
| `result` | processed rows |
| `chartNote` | only if chart note was generated and cached |

### Important current-generation behavior

- `documents.json` stores the full rendered extraction payload for processed records under `result`.
- cached chart notes, when present, live under `document.chartNote`.
- prescription files are written to `server/storage/prescriptions/`.
- the prescription service does not currently persist prescription artifact metadata back into `documents.json`.
- some prescription HTML files embed `window.prescriptionData._metadata.sourceDocumentId`, which can be used as a deterministic link.

## Core Rules

### 1. Backfill every row in `documents.json`

`Phase 3B` backfills every canonical row in `documents.json`, regardless of whether the row originated from:

- PDF upload
- uploaded dictation
- live conversation finalization

`Phase 3C` will later backfill transcript/review/workflow state from session stores. `Phase 3B` must not skip canonical final document rows just because they came from voice/live workflows.

### 2. Do not backfill transcript convenience fields here

Some voice/live final document rows contain convenience transcript-like fields. `Phase 3B` must not create:

- `transcripts`
- `transcript_segments`
- `review_items`
- `review_item_resolutions`

from those fields. That ownership belongs to `Phase 3C`.

### 3. Status normalization is explicit

The filesystem and Postgres status vocabularies are not identical.

Use only this mapping:

| Filesystem status | Postgres `documents.status` |
|---|---|
| `queued` | `pending` |
| `transcribing` | `processing` |
| `processing` | `processing` |
| `processed` | `completed` |
| `partial` | `completed` |
| `failed` | `failed` |

Any unrecognized status is a blocker. Do not guess.

### 4. `documents` is metadata, not file storage

`filePath` and similar filesystem paths do not belong in `documents`. They belong in `document_assets`.

### 5. Only create extractions when structured output exists

Create a baseline `document_extractions` row only when the source row actually has structured extraction output.

If a document is queued, processing, or failed without a usable payload:

- backfill the `documents` row
- do not invent an extraction row

## Required Field Mapping

### `documents.json -> documents`

| Filesystem | Postgres | Rule |
|---|---|---|
| `id` | `id` | preserve |
| `documentType` if present, else inferred type | `document_type` | see inference rules below |
| `documentSubtype` if present | `document_subtype` | else `unknown` |
| inferred | `source_kind` | `pdf_upload`, `voice_upload`, or `live_conversation` |
| normalized `status` | `status` | use explicit status table above |
| `department` | `department` | preserve |
| `name` | `name` | preserve |
| `fileName` or `name` | `original_filename` | preserve best available original name |
| `mimeType` or `fileType` | `mime_type` | preserve best available value |
| `size` | `size_bytes` | preserve |
| `hash` | `sha256_hash` | preserve |
| `linkedPatient` | `linked_patient_label` | preserve as label only |
| `encounterLabel` | `encounter_label` | preserve as label only |
| `error` | `error_message` | preserve when present |
| none | `error_code` | `NULL` unless deterministic code exists |
| `uploadedAt` | `uploaded_at` | preserve |
| `processedAt` | `processed_at` | preserve |
| `uploadedAt` or fallback | `created_at` | use upload time when present |
| `processedAt` or `uploadedAt` or fallback | `updated_at` | deterministic best-effort |
| `Phase 3A patient_id` | `patient_id` | only if deterministic link exists |
| `Phase 3A encounter_id` | `encounter_id` | only if deterministic link exists |

### Document type inference

Use this precedence:

1. `document.documentType`
2. `document.result.meta.document_type`
3. `document.result.stage1.detected_type`
4. `unknown`

Use this `source_kind` mapping:

| Source row shape | `source_kind` |
|---|---|
| standard uploaded PDF | `pdf_upload` |
| uploaded dictation final document | `voice_upload` |
| live conversation final document | `live_conversation` |

### Pointer fields in `documents`

`Phase 3B` may set:

- `current_extraction_id`
- `current_chart_note_id`

`Phase 3B` must leave these `NULL`:

- `current_transcript_id`
- `last_audit_run_id`

unless a deterministic value already exists in the source row, which is not generally true today.

## `document_assets` Rules

### Create assets only from deterministic paths

Create `document_assets` rows only when:

- the source row contains a concrete file path or URI
- the file exists at migration time
- the asset can be linked to exactly one document

### Asset role enum constraints

The `asset_role` field must use only the values defined in the Phase 0 schema `asset_role_enum`:

```
'source_pdf', 'source_audio', 'transcript_json', 'masked_image',
'chart_note_pdf', 'prescription_html', 'prescription_pdf', 'other'
```

Do not invent or use values outside this enum (e.g., `source_upload`, `masked_image_page` are invalid).

### Required asset roles

Use these roles (matching the Phase 0 schema `asset_role_enum`):

| Asset source | `asset_role` |
|---|---|
| `document.filePath` for original uploaded PDF file | `source_pdf` |
| `document.filePath` for original uploaded audio file | `source_audio` |
| `result.masked_image_path` | `masked_image` |
| each file from `result.masked_image_pages[]` if present and linkable | `masked_image` |
| linked generated prescription HTML | `prescription_html` |
| linked generated prescription PDF | `prescription_pdf` |
| transcript JSON files | `transcript_json` |
| chart note PDF files | `chart_note_pdf` |
| any other asset type | `other` |

### Do not create guessed assets

Do not create asset rows from:

- filename-only guesses
- missing files
- unresolved live-session references that belong to `Phase 3C`

## `document_extractions` Rules

### One baseline extraction per current document payload

Create exactly one baseline extraction row per document when structured output exists.

Use:

- `version_no = 1`
- `status = completed` for successful payloads
- `status = failed` only if a structured failed extraction payload actually exists

### Extraction payload mapping

| Source payload | Target column |
|---|---|
| `result.extracted_data` | `extracted_data_jsonb` |
| `result.dashboard_cards` | `dashboard_payload_jsonb` |
| `result.meta` plus source annotations | `meta_jsonb` |
| `result.stage1` | `stage1_jsonb` |
| `result.stage3` | `stage3_jsonb` |
| `result.presentation` | `presentation_jsonb` |

If a document row uses alternative convenience fields instead of `result`, use them only when they are clearly equivalent and deterministic. Do not merge convenience transcript state into extraction payloads here.

### Extraction metadata

Use these best-effort sources:

- `agent_name` from `document.agentInfo.name` or `result.meta.agent_name`
- `agent_version` from `document.agentInfo.version` or `result.meta.agent_version`
- `provider_tokens_jsonb` from `document.agentInfo.tokens` or equivalent token metadata when present

After creating the extraction row, update `documents.current_extraction_id`.

## `chart_notes` Rules

Create a `chart_notes` row only when `document.chartNote` exists.

Map:

| Document field | Chart note column |
|---|---|
| `chartNote.content` | `content` |
| `chartNote.validation` | `validation_jsonb` |
| `chartNote.citations` | `citations_jsonb` |
| `chartNote.reasoningSteps` | `reasoning_steps_jsonb` |
| `chartNote.tokensUsed` | `tokens_used` |
| `chartNote.generationTime` | `generation_time_ms` |
| `chartNote.auditRunId` | `audit_run_id` |

Use `version_no = 1` unless multiple cached versions are actually present in the source, which is not the current runtime pattern.

Then update `documents.current_chart_note_id`.

## `prescription_artifacts` Rules

### Deterministic-link requirement

Prescription files may be backfilled only when they can be linked to a document deterministically.

Current allowed strategy:

1. parse generated prescription HTML
2. read `window.prescriptionData._metadata.sourceDocumentId`
3. group matching HTML/PDF files by source document and generation timestamp stem

### What to create

For each deterministic group:

1. create `document_assets` for HTML/PDF files
2. create one `prescription_artifacts` row
3. store parsed `window.prescriptionData` in `prescription_payload_jsonb`
4. assign `version_no` by ascending generation time per document

### What to skip

Skip and report:

- PDF-only files with no deterministic document link
- filename-only guesses based on patient/document names
- orphaned prescription files whose HTML cannot be parsed

## Embedded Alert Payloads

Some processed documents contain alert preview payloads such as:

- `result.pharmacy_alert`
- `result.department_alerts`

`Phase 3B` must not create delivery-history rows from those previews unless the source row contains deterministic delivery fields such as channel, recipient, and status. In the current runtime, actual delivery history is tracked separately in line-oriented logs and belongs to `Phase 3D`.

If alert preview payloads are useful, preserve them in extraction metadata rather than inventing `alert_deliveries` rows.

## Execution Order

Run `Phase 3B` in this order:

1. snapshot current source counts
2. load `documents.json`
3. insert/update `documents`
4. create deterministic source-file `document_assets`
5. create baseline `document_extractions`
6. update `documents.current_extraction_id`
7. create `chart_notes` when cached chart notes exist
8. update `documents.current_chart_note_id`
9. scan deterministic prescription HTML/PDF artifacts
10. create prescription-linked `document_assets`
11. create `prescription_artifacts`
12. emit backfill report

## Required Backfill Report

`Phase 3B` must emit a machine-readable report with:

- total source document count
- inserted/updated `documents` count
- inserted `document_assets` count by `asset_role`
- inserted `document_extractions` count
- inserted `chart_notes` count
- inserted `prescription_artifacts` count
- skipped documents by unsupported status
- skipped assets because file was missing
- skipped prescription files because document link was not deterministic

## Exit Gate

`Phase 3B` is complete only when all of the following are true:

- `documents` row count matches `documents.json.documents.length`
- every source document row has the expected normalized Postgres status
- every document with `filePath` and an existing file has an appropriate `asset_role` row (`source_pdf`, `source_audio`, etc.)
- every document with structured output has exactly one baseline extraction row
- `documents.current_extraction_id` is populated whenever an extraction exists
- cached chart notes, when present, have matching `chart_notes` rows
- prescription artifacts are backfilled only from deterministic document links
- no transcript/review/session rows were created by `Phase 3B`
- no delivery-history rows were guessed from alert preview payloads

## Non-Goals

- backfilling transcript or review workflow state
- inferring patient/encounter links by names alone
- guessing prescription ownership from human-readable filenames
- forcing file assets into the `documents` table
- inventing extraction rows for queued or failed documents without structured payloads

