# Voice Intake LangGraph Plan

> Historical planning document
> This file captures the original rollout strategy before live streaming was implemented in the repository. The current codebase now supports uploaded dictation plus a separate live conversation session runtime. For current behavior, use [voice-intake-phase2-implementation-summary.md](./voice-intake-phase2-implementation-summary.md) and [live-conversation-ui-backend-plan.md](./live-conversation-ui-backend-plan.md).

## Purpose
This document defines the architecture plan for a new **voice intake module** that converts physician dictation or clinical conversation audio into the same structured dashboard data model already used by the Doctor Dashboard.

The target outcome is:
- doctors can upload dictated audio and process it into the dashboard
- the extracted output can reuse the current chart note, chat, alerting, and presentation flows
- the system remains modular enough to switch between a **provider-backed transcription path** and the existing **self-hosted STT service**

This plan is intentionally focused on architecture, workflow, and rollout sequencing. It does not assume the module should be implemented in one release.

## Summary
The recommended approach is to treat voice as a **new intake pipeline**, not as a separate product.

The module should:
1. ingest audio
2. transcribe it
3. normalize and quality-check the transcript
4. run agentic clinical extraction
5. reconcile structured output
6. map the result into the existing dashboard schema
7. pause for human review when confidence is low

The first implementation should support **uploaded dictation audio only**.

It should **not** start with live streaming.

## Why This Approach

### Reason 1: reuse the current data model
The existing system already has:
- document persistence in `server/storage`
- dashboard mapping in `skills/clinical/dashboard_mapper.skill.cjs`
- chart note generation
- doctor chat
- audit logging
- alerting and operational workflows

The voice module should feed that system, not duplicate it.

### Reason 2: keep STT replaceable
You already have a self-hosted STT service. That means the correct architecture is:
- **STT as a tool**
- **clinical extraction as a graph**

If transcription and extraction are fused into one opaque model call, migration between provider-backed and self-hosted transcription later becomes expensive and hard to evaluate.

### Reason 3: separate transcription quality from extraction quality
Audio workflows fail in two different ways:
- the transcript is wrong
- the transcript is right but the extractor structures it incorrectly

The design must make those failure modes measurable separately.

### Reason 4: live streaming is a different product shape
Uploaded dictation is a batch workflow.

Live streaming introduces:
- low-latency transport
- partial transcript revision
- speaker turn handling
- session lifecycle control
- streaming UI state

That is a second phase, not a good starting point.

## Current System Fit
This plan aligns with the existing repository structure:
- routing and orchestration in `server/index.cjs`
- multi-agent document flow in `agents/document_type_router.cjs`
- skill-based extraction in `agents/core/skill_registry.cjs`
- proven multi-stage orchestration in `agents/prescription_two_stage_agent.cjs`
- dashboard schema adaptation in `skills/clinical/dashboard_mapper.skill.cjs`

The lowest-friction implementation path is therefore **LangGraph.js inside the existing Node/Express backend**, not a separate Python sidecar.

## Scope

### In scope for v1
- uploaded physician dictation audio
- provider-backed transcription experiment
- transcript normalization
- transcript-to-structured extraction
- dashboard population using the existing schema
- confidence-based human review
- audit logging and progress streaming

### Explicitly out of scope for v1
- real-time live streaming
- production switch to the self-hosted STT path
- bi-directional voice assistant
- voice playback UI
- automatic note signing
- EMR/FHIR integration

## Product Modes
The module should eventually support two source modes:

1. `dictation_upload`
2. `live_stream`

For implementation sequencing, only `dictation_upload` should be built first.

## High-Level Architecture

```text
Audio Upload
→ Audio Intake
→ STT Tool
→ Transcript Quality Gate
→ Speaker / Segment Normalization
→ LangGraph Clinical Extraction
→ Structured Reconciliation
→ Validation + Confidence Gate
→ Human Review Interrupt
→ Dashboard Mapper
→ Persistence + Audit + Downstream Reuse
```

## LangGraph Recommendation
Use **LangGraph.js** as the orchestration layer for this module.

Reasons:
- the running application is Node/Express
- the backend already uses JavaScript/CommonJS
- the module will need streaming progress and human-in-the-loop interruptions
- LangGraph supports checkpointing, interrupts, and long-running workflows cleanly

## Proposed Graph State
The voice graph should maintain a dedicated state object.

```ts
type VoiceIntakeState = {
  sessionId: string;
  sourceType: "dictation_upload" | "live_stream";
  documentId: string | null;
  audioAsset: {
    fileName: string;
    mimeType: string;
    durationMs: number | null;
    storagePath: string;
  } | null;
  transcript: {
    rawText: string;
    normalizedText: string;
    language: string | null;
    speakers: Array<{ id: string; label: string; role: "doctor" | "patient" | "unknown" }>;
    segments: Array<{
      segmentId: string;
      speakerId: string | null;
      startMs: number | null;
      endMs: number | null;
      text: string;
      confidence: number | null;
    }>;
    quality: {
      overallConfidence: number | null;
      missingAudioSuspected: boolean;
      overlappingSpeechSuspected: boolean;
      medicationRisk: "low" | "medium" | "high";
    };
  } | null;
  extractedData: object | null;
  provenance: object | null;
  reviewItems: Array<object>;
  dashboardPayload: object | null;
  chartNote: object | null;
  alerts: Array<object>;
  status: "queued" | "transcribing" | "extracting" | "review_required" | "processed" | "failed";
  audit: {
    runId: string | null;
    requestId: string | null;
  };
};
```

## Graph Nodes
The initial graph should be designed as explicit nodes, even if the first implementation simplifies some steps.

### Intake nodes
- `ingest_audio`
- `store_audio_asset`
- `load_voice_session_context`

### STT nodes
- `transcribe_audio`
- `quality_gate_transcript`
- `normalize_transcript`
- `resolve_speaker_roles`

### Extraction nodes
- `classify_voice_mode`
- `extract_demographics`
- `extract_vitals`
- `extract_diagnosis`
- `extract_medications`
- `extract_labs`
- `extract_radiology`
- `extract_procedures`
- `extract_followup`
- `extract_clinical_notes`

### Reconciliation and safety nodes
- `reconcile_structured_output`
- `validate_conflicts`
- `score_confidence`
- `decide_review_required`
- `human_review_interrupt`

### Output nodes
- `map_dashboard`
- `persist_voice_result`
- `emit_progress_and_audit`

## Modes Of Audio

### 1. Physician dictation
This is the cleanest first use case.

Typical characteristics:
- one dominant speaker
- structured clinical monologue
- fewer interruptions
- easier medication and follow-up extraction

### 2. Doctor-patient conversation
This is more complex and should be treated as a separate extraction mode.

Typical characteristics:
- multiple speakers
- interruptions and overlap
- partial, informal, and repeated statements
- symptoms may come from the patient while plan/orders come from the doctor

The graph should preserve this distinction from the start.

## Experimental STT Strategy

### Phase 1 transcription engine
Use the **provider-backed transcription path** as the initial experiment engine.

The purpose is to learn:
- transcript quality
- timestamp usefulness
- diarization quality
- how well transcript output supports downstream extraction

### Production-ready abstraction
Wrap STT behind a tool interface so it can later route to:
- `PrimaryAudioTranscriptionTool`
- `SelfHostedAudioTranscriptionTool`

The extraction graph should not care which STT engine produced the transcript.

## Tools

### New tools
- `PrimaryAudioTranscriptionTool`
- `SelfHostedAudioTranscriptionTool`
- `TranscriptNormalizerTool`
- `TranscriptQualityGateTool`
- `SpeakerRoleResolverTool`
- `TranscriptSnippetLocatorTool`

### Likely tool responsibilities

#### `PrimaryAudioTranscriptionTool`
- upload audio to the approved provider or pass inline audio when small
- request transcript with timestamps
- request speaker labeling when supported
- return structured transcript JSON

#### `SelfHostedAudioTranscriptionTool`
- call the self-hosted STT service
- normalize response shape into the same transcript contract

#### `TranscriptNormalizerTool`
- clean filler artifacts
- preserve clinical meaning
- normalize spacing, punctuation, and units
- avoid aggressive summarization

#### `TranscriptQualityGateTool`
- detect likely transcript failure patterns
- identify low-confidence medication spans
- identify likely missing terms and unclear segments

#### `SpeakerRoleResolverTool`
- infer doctor vs patient vs unknown from transcript context
- default safely to `unknown` when uncertain

## Skills

### New extraction skills for voice
- `VoiceDemographicsExtractorSkill`
- `VoiceVitalsExtractorSkill`
- `VoiceDiagnosisExtractorSkill`
- `VoiceMedicationsExtractorSkill`
- `VoiceLabsExtractorSkill`
- `VoiceRadiologyExtractorSkill`
- `VoiceProceduresExtractorSkill`
- `VoiceFollowUpExtractorSkill`
- `VoiceClinicalNotesExtractorSkill`
- `VoiceStructuredReconcilerSkill`
- `VoiceCrossValidatorSkill`

### Important design rule
Voice extraction skills should operate on **transcript segments plus metadata**, not just one plain block of transcript text.

That is necessary for:
- grounding
- timestamps
- speaker-sensitive interpretation
- low-confidence review

## Provenance Model
The current dashboard pipeline uses page/line-oriented provenance for PDFs.

Voice requires a different provenance model.

### Proposed provenance shape
```json
{
  "source_type": "audio_transcript",
  "speaker_role": "doctor",
  "speaker_id": "spk_1",
  "segment_ids": ["seg_12", "seg_13"],
  "time_range_ms": {
    "start": 184000,
    "end": 201500
  },
  "quoted_text": "Start amlodipine 5 mg once daily",
  "confidence": 0.86,
  "is_inferred": false
}
```

### Provenance rules
- extraction should preserve raw quoted text where possible
- medication, diagnosis, and order extraction must keep timestamp spans
- inferred content should be marked explicitly
- speaker identity must be attached when clinically relevant

## Clinical Safety Rules
Voice extraction is riskier than PDF extraction for medication and order capture.

The system should therefore:
- require human review for low-confidence meds, dosages, and frequencies
- require review when medication names are phonetically plausible but ambiguous
- require review when lab or radiology orders are mentioned casually or indirectly
- separate `explicitly stated` from `inferred from context`
- never auto-promote ambiguous spoken discussion into confirmed orders

## Human-In-The-Loop
Human review is not optional for this module.

Use LangGraph interrupts for review points such as:
- unclear medication name
- unclear dose or unit
- conflicting diagnosis statements
- unclear speaker attribution
- multiple possible order interpretations

The review UI should allow:
- approve
- edit extracted field
- mark as not present
- request transcript correction

## Dashboard Integration
The voice module should not invent a parallel UI schema.

It should populate the existing dashboard target used by:
- `skills/clinical/dashboard_mapper.skill.cjs`
- chart note generation
- doctor chat context
- alerts and review workflows

### Integration rule
The final structured voice output should be transformed into the same high-level shape already expected by the dashboard:
- patient
- vitals
- diagnosis
- medications
- labs / investigations
- radiology
- treatment / procedures
- clinical_notes
- follow_up
- meta
- provenance

## API Plan

### New endpoints for phase 1
- `POST /api/voice/upload`
- `POST /api/voice/process`
- `GET /api/voice/process/progress`
- `GET /api/voice/:id`
- `POST /api/voice/:id/review`

### Suggested request/response direction

#### `POST /api/voice/upload`
- accept audio files such as `.wav`, `.mp3`, `.m4a`
- persist file and create voice record

#### `POST /api/voice/process`
- trigger LangGraph voice pipeline
- optionally choose STT backend: `provider` or `self_hosted`

#### `GET /api/voice/process/progress`
- SSE progress stream mirroring document processing style

#### `POST /api/voice/:id/review`
- submit human review decisions to resume interrupted graph execution

## Data Storage
Create a dedicated storage area parallel to current document storage.

Suggested additions under `server/storage/`:
- `voice_sessions.json`
- `voice_reviews.json`
- `voice_audio/`
- `voice_transcripts/`
- `voice_graph_checkpoints/`

The graph checkpoint store should be explicit from the start so long-running reviewable workflows remain resumable.

## Security And PHI
Audio contains PHI and should be treated more strictly than masked prescription images.

### Key policy decisions
- the provider-backed path should be used only as an **experiment path** initially
- the architecture must assume future migration to the self-hosted STT service
- raw audio should stay local
- transcript sharing with external services should be governed by explicit configuration
- patient identity should preferably come from session or encounter context, not only from transcript inference

### Practical rule
For the pilot, the system may send uploaded audio to the provider-backed path only when that path is explicitly selected.

Production posture should favor the self-hosted STT tool once the experiment phase is complete.

## Evaluation Plan
This module should not be judged by anecdotal demos alone.

### Build a benchmark set
Create a curated set of:
- short physician dictations
- longer dictations
- noisy dictations
- mixed doctor-patient conversations
- medication-heavy audio
- follow-up-heavy audio

### Measure separately
1. transcript quality
2. extraction quality
3. dashboard completeness
4. review burden

### Suggested evaluation dimensions
- word error rate or clinically weighted transcription error rate
- medication name correctness
- dosage correctness
- diagnosis correctness
- lab/radiology order precision
- provenance coverage
- percentage of cases requiring review
- time to final usable dashboard

## Rollout Plan

### Phase 0: architecture and benchmark definition
- define transcript schema
- define provenance schema
- define review contract
- define benchmark dataset

### Phase 1: uploaded dictation with provider-backed transcription
- audio upload flow
- provider-backed transcription
- transcript viewer
- extraction graph
- dashboard mapping
- no live streaming

### Phase 2: review workflow hardening
- human review interruptions
- edit/approve UI
- resumable execution
- audit enrichment

### Phase 3: self-hosted STT backend integration
- implement self-hosted STT tool
- normalize transcript contract
- compare provider-backed vs self-hosted transcription on benchmark set

### Phase 4: live streaming
- websocket audio ingest
- rolling transcript windows
- partial extraction updates
- final session reconciliation

## Recommended First Slice
The first build should be:
- upload audio
- transcribe with the provider-backed path
- show transcript with timestamps
- extract into the current dashboard schema
- review low-confidence medication/order fields
- persist the final dashboard-ready record

That is the smallest slice that proves the module’s value without prematurely committing to live streaming complexity.

## Open Questions
- Will uploaded dictation always be linked to an existing patient or encounter?
- Is speaker diarization required in v1 for dictation, or only for conversation mode?
- Should transcript editing happen before extraction, after extraction, or both?
- Should audio results live alongside `documents.json` or in a separate voice-first collection?
- What is the acceptable human review rate for medication-bearing dictations?

## References
- LangGraph.js docs: https://langchain-ai.github.io/langgraphjs/reference/modules/langgraph.html
