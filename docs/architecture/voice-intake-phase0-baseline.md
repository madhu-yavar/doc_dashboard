# Voice Intake Phase 0 Baseline

> Historical baseline
> This document captures the original Phase 0 decisions made before implementation. The live code now includes automatic upload-to-process behavior, unified queue integration, and dashboard-readiness validation for voice records. For current runtime behavior, use [voice-intake-phase2-implementation-summary.md](./voice-intake-phase2-implementation-summary.md).

## Purpose
This document finalizes the **Phase 0 baseline** for the voice intake module.

It turns the broader architecture in [voice-intake-langgraph-plan.md](./voice-intake-langgraph-plan.md) into a concrete starting point for implementation by locking:
- v1 scope
- UI placement and screen flow
- transcript contract
- provenance contract
- review-item contract
- storage model
- acceptance metrics
- implementation order

This is the decision document the team should build from before writing tools, skills, and orchestration code.

## Phase 0 Decisions

### Scope decisions
- v1 supports **uploaded physician dictation audio only**
- live streaming is explicitly deferred beyond v1
- Gemini is the first STT backend for the experiment path
- self-hosted Whisper remains the intended pluggable replacement backend

### Product-shape decisions
- voice does **not** launch as a separate standalone product area
- voice enters the existing app through **Upload Center**
- v1 focuses on a doctor-driven workflow, not a patient conversation workflow
- v1 requires structured human review for low-confidence extractions before finalizing dashboard data

### Architecture decisions
- orchestration will be done in **LangGraph.js**
- STT is a tool boundary, not embedded into extraction skills
- extraction skills operate on transcript segments plus metadata, not just one free-text transcript blob
- final output must map to the existing dashboard schema rather than introducing a parallel schema

## V1 UX Strategy
The voice module should feel like a new intake mode inside the current product, not like a bolt-on utility.

The UI should follow the same broad rhythm as document processing:
1. upload
2. queue/progress
3. review
4. dashboard

## UI Placement

### Entry point
Place voice inside [src/pages/UploadCenter.tsx](/Users/yavar/Documents/CoE/Manipal/src/pages/UploadCenter.tsx:1) as a **new intake mode**.

Recommended top-level switch:
- `Documents`
- `Voice Dictation`

This avoids fragmenting the product while still making voice distinct from PDF workflows.

### Why not a separate route first
- the current app already uses Upload Center as the operational intake area
- doctors will think of dictation as another intake source, not a separate product
- queue handling, statuses, and progress patterns are already present there

## V1 Screen Model

### Screen 1: Voice Intake Panel
This is the upload-and-configure entry point.

Contents:
- audio drag-and-drop area
- supported file types note: `.wav`, `.mp3`, `.m4a`
- optional patient/encounter link field
- processing engine display:
  - `Gemini Experiment`
- short privacy note
- `Upload and Process` action

Primary questions this screen answers:
- what file is being uploaded
- where the result will go
- what engine is being used

### Screen 2: Voice Processing Queue
This is the queue/status view for uploaded audio.

Statuses:
- `queued`
- `transcribing`
- `extracting`
- `review required`
- `processed`
- `failed`

Each row should show:
- file name
- linked patient or encounter if available
- upload time
- current stage
- review badge when human action is required

### Screen 3: Transcript Review
This is the first inspection screen after STT completes.

Contents:
- transcript text grouped by segment
- timestamps per segment
- speaker tag per segment
- low-confidence highlights
- transcript quality summary
- action buttons:
  - `Continue to Extraction Review`
  - `Mark Transcript Needs Attention`

This screen exists because the team must separate:
- STT quality problems
- extraction quality problems

### Screen 4: Extraction Review
This is the structured review screen before dashboard finalization.

Sections:
- demographics
- vitals
- diagnosis
- medications
- labs
- radiology
- procedures
- follow-up
- clinical notes

For each reviewable item show:
- extracted value
- source transcript snippet
- timestamp
- confidence
- action:
  - approve
  - edit
  - reject

### Screen 5: Final Dashboard
Once review is complete, the record should open in the existing dashboard route and presentation model.

That means no separate voice-specific dashboard should be invented in v1.

## UI Component Plan

### Upload Center additions
Recommended new components:
- `VoiceIntakeSwitcher`
- `VoiceUploadPanel`
- `VoiceQueueTable`
- `VoiceQueueStatusBadge`

### Review components
Recommended new components:
- `TranscriptTimeline`
- `TranscriptQualitySummary`
- `VoiceExtractionReviewPanel`
- `VoiceReviewItemCard`
- `VoiceReviewDecisionBar`

### Reuse candidates
Likely reuse from current app:
- `AppShellHeader`
- shared `Button`, `Card`, `Badge`, `Table`, `Dialog`
- existing progress and toast patterns

## Transcript Contract
The STT layer must normalize output into one internal transcript shape regardless of backend.

```ts
type VoiceTranscript = {
  transcriptId: string;
  sourceType: "dictation_upload";
  language: string | null;
  rawText: string;
  normalizedText: string;
  speakers: Array<{
    id: string;
    label: string;
    role: "doctor" | "patient" | "unknown";
  }>;
  segments: Array<{
    segmentId: string;
    speakerId: string | null;
    speakerRole: "doctor" | "patient" | "unknown";
    startMs: number | null;
    endMs: number | null;
    text: string;
    normalizedText: string;
    confidence: number | null;
    flags: string[];
  }>;
  quality: {
    overallConfidence: number | null;
    lowConfidenceSegmentCount: number;
    missingAudioSuspected: boolean;
    overlappingSpeechSuspected: boolean;
    medicationRisk: "low" | "medium" | "high";
  };
};
```

### Transcript rules
- `rawText` preserves the original STT text
- `normalizedText` is the cleaned clinical text used downstream
- segment-level confidence must be retained whenever available
- missing confidence values are allowed and should remain `null`
- v1 assumes one dominant speaker but still stores speaker fields for forward compatibility

## Provenance Contract
Every structured field should carry transcript-based provenance.

```ts
type VoiceProvenanceItem = {
  sourceType: "audio_transcript";
  speakerId: string | null;
  speakerRole: "doctor" | "patient" | "unknown";
  segmentIds: string[];
  timeRangeMs: {
    start: number | null;
    end: number | null;
  };
  quotedText: string;
  confidence: number | null;
  extractionMethod: "quoted" | "normalized" | "derived";
  isInferred: boolean;
};
```

### Provenance rules
- medications, orders, and follow-up items must have timestamp provenance
- `quotedText` should be the closest faithful transcript span, not a rewritten summary
- inferred fields must be marked with `isInferred: true`
- `derived` should be used sparingly and never for ambiguous medications

## Review-Item Contract
The review system should work from a standard queue of items requiring clinician confirmation.

```ts
type VoiceReviewItem = {
  reviewItemId: string;
  category:
    | "transcript"
    | "medication"
    | "diagnosis"
    | "vitals"
    | "lab_order"
    | "radiology_order"
    | "procedure"
    | "follow_up";
  severity: "low" | "medium" | "high";
  reasonCode:
    | "low_confidence"
    | "speaker_ambiguity"
    | "dosage_ambiguity"
    | "multiple_candidates"
    | "possible_missing_context"
    | "conflict_detected";
  title: string;
  extractedValue: unknown;
  suggestedValue: unknown;
  provenance: VoiceProvenanceItem[];
  resolution: "pending" | "approved" | "edited" | "rejected";
  editedValue?: unknown;
};
```

### Review rules
- ambiguous medication names must generate review items
- dosage or frequency uncertainty must generate review items
- any likely order extracted from casual spoken discussion should generate review items
- transcript-level issues can block downstream finalization when severe

## Voice Session Persistence Model
Voice processing should be session-based rather than pretending to be a PDF document from the start.

Suggested session shape:

```ts
type VoiceSessionRecord = {
  id: string;
  sourceType: "dictation_upload";
  fileName: string;
  mimeType: string;
  uploadedAt: string;
  linkedPatientId: string | null;
  linkedEncounterId: string | null;
  sttBackend: "gemini" | "whisper";
  status: "queued" | "transcribing" | "extracting" | "review_required" | "processed" | "failed";
  transcriptPath: string | null;
  reviewState: "not_required" | "pending" | "completed";
  dashboardDocumentId: string | null;
  auditRunId: string | null;
};
```

## Storage Decision
Voice records should live in a dedicated storage area under `server/storage`, not be mixed directly into `documents.json`.

Recommended structure:
- `server/storage/voice_sessions.json`
- `server/storage/voice_reviews.json`
- `server/storage/voice_audio/`
- `server/storage/voice_transcripts/`
- `server/storage/voice_graph_checkpoints/`

### Rationale
- voice has a different lifecycle than PDF documents
- transcripts and audio need dedicated retention handling
- review state and graph checkpoints are voice-specific concerns

## Final Structured Output Contract
The output of the voice pipeline should match the current downstream dashboard model closely enough to pass through the existing mapper.

Required top-level sections:
- `patient`
- `vitals`
- `diagnosis`
- `medications`
- `investigations`
- `radiology`
- `procedures`
- `follow_up`
- `clinical_notes`
- `meta`
- `provenance`

### Important rule
If a section is absent, store an empty or null-safe structure rather than inventing content.

## Acceptance Metrics
Phase 0 also needs a concrete definition of success for the Gemini experiment.

### Transcript metrics
- overall transcript usability
- medication term fidelity
- timestamp usefulness for review
- low-confidence segment recall

### Extraction metrics
- medication precision
- medication dose/frequency accuracy
- diagnosis precision
- lab/radiology/procedure order precision
- follow-up extraction accuracy

### Workflow metrics
- percent of cases requiring human review
- mean review items per audio file
- time from upload to usable dashboard
- percent of files finalized without reprocessing

### Practical v1 success criteria
- transcript is usable without major manual rewrite in most dictation files
- medication extraction is reviewable and not dangerously overconfident
- the final dashboard is clinically usable after review

## Build Order
This is the required implementation sequence for v1.

### Step 1: UI and contracts
- finalize intake and review screens
- finalize transcript/provenance/review contracts
- finalize storage model

### Step 2: tools
- build `GeminiAudioTranscriptionTool`
- build transcript normalizer
- build transcript quality gate
- build speaker role resolver

### Step 3: skill scaffolding
- create empty voice extraction skills with fixed contracts
- validate that each skill reads transcript segments rather than raw monolithic text only

### Step 4: orchestration
- add LangGraph.js
- build the voice state and core nodes
- integrate review interrupts

### Step 5: API and persistence
- expose upload/process/review routes
- persist sessions, transcripts, and review state

### Step 6: UI wiring
- connect queue, transcript review, extraction review, and dashboard launch

### Step 7: evaluation
- run benchmark set
- compare Gemini and Whisper later using the same contracts

## What Should Be Created Before Skills
Before implementing the actual extraction skills, the following must exist:
- transcript schema
- provenance schema
- review-item schema
- voice session schema
- UI review flow

Without those, the skills will likely be rewritten.

## Immediate Next Deliverables After Phase 0
- scaffold voice tools
- scaffold voice skill files
- add voice storage bootstrap
- add `Upload Center` voice intake shell

## References
- [voice-intake-langgraph-plan.md](./voice-intake-langgraph-plan.md)
- [voice-intake-implementation-checklist.md](./voice-intake-implementation-checklist.md)
