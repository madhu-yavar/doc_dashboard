# Voice Intake Implementation Checklist

> Historical tracker
> This checklist was the execution tracker for the original voice rollout plan. The current repository has moved beyond several items here, and some unchecked boxes no longer describe the primary runtime path exactly. For current behavior, use [voice-intake-phase2-implementation-summary.md](./voice-intake-phase2-implementation-summary.md).

## Purpose
This checklist is the execution tracker for the voice intake module defined in [voice-intake-langgraph-plan.md](./voice-intake-langgraph-plan.md).

Use this file to track delivery status separately from the architectural plan.

## Status Key
- `[ ]` not started
- `[-]` in progress
- `[x]` completed
- `[!]` blocked / decision needed

## Phase 0: Design Baseline
- [x] Confirm the v1 scope is **uploaded dictation only**
- [x] Confirm live streaming is deferred beyond v1
- [x] Confirm the initial provider-backed STT path
- [x] Confirm the self-hosted STT path remains the target pluggable backend
- [x] Finalize transcript JSON schema
- [x] Finalize audio provenance JSON schema
- [x] Finalize confidence and review-item schema
- [x] Define voice session persistence model
- [x] Decide where voice records live under `server/storage`
- [x] Define acceptance metrics for the experiment

## Phase 0: Benchmark Dataset
- [ ] Collect sample physician dictation files
- [ ] Collect medication-heavy dictations
- [ ] Collect noisy / low-quality dictations
- [ ] Collect doctor-patient conversation samples for later phases
- [ ] Create a gold transcript subset
- [ ] Create structured ground truth for extraction evaluation
- [ ] Define evaluation spreadsheet or report format

## Backend: Foundation
- [ ] Add a `voice` module area under `server/` and/or `agents/`
- [x] Add storage bootstrap for voice collections
- [x] Add storage directories for raw audio and transcripts
- [ ] Add audit event categories for voice workflows
- [ ] Add analytics counters for voice runs
- [x] Add role checks for voice APIs

## Backend: STT Tools
- [x] Implement `PrimaryAudioTranscriptionTool`
- [x] Support file upload or file reference flow for the primary provider path
- [x] Normalize primary-provider transcript output into internal schema
- [ ] Implement `SelfHostedAudioTranscriptionTool`
- [ ] Normalize self-hosted transcript output into the same internal schema
- [ ] Add STT backend selection by config or request option
- [x] Add retry / timeout handling for STT calls
- [ ] Add transcript quality-gate tool

## Backend: LangGraph Orchestration
- [ ] Add LangGraph.js dependency
- [ ] Define `VoiceIntakeState`
- [ ] Implement graph checkpointer / resumability
- [ ] Implement `ingest_audio` node
- [ ] Implement `transcribe_audio` node
- [ ] Implement `quality_gate_transcript` node
- [ ] Implement `normalize_transcript` node
- [ ] Implement `resolve_speaker_roles` node
- [ ] Implement `classify_voice_mode` node
- [ ] Implement extraction nodes for each dashboard section
- [ ] Implement reconciliation node
- [ ] Implement confidence scoring node
- [ ] Implement review decision node
- [ ] Implement human-review interrupt node
- [ ] Implement dashboard mapping node
- [ ] Implement persistence node

## Backend: Voice Extraction Skills
- [ ] Implement `VoiceDemographicsExtractorSkill`
- [ ] Implement `VoiceVitalsExtractorSkill`
- [ ] Implement `VoiceDiagnosisExtractorSkill`
- [ ] Implement `VoiceMedicationsExtractorSkill`
- [ ] Implement `VoiceLabsExtractorSkill`
- [ ] Implement `VoiceRadiologyExtractorSkill`
- [ ] Implement `VoiceProceduresExtractorSkill`
- [ ] Implement `VoiceFollowUpExtractorSkill`
- [ ] Implement `VoiceClinicalNotesExtractorSkill`
- [ ] Implement `VoiceStructuredReconcilerSkill`
- [ ] Implement `VoiceCrossValidatorSkill`

## Backend: API Layer
- [x] Add `POST /api/voice/upload`
- [x] Add `POST /api/voice/process`
- [ ] Add `GET /api/voice/process/progress`
- [x] Add `GET /api/voice/:id`
- [x] Add `POST /api/voice/:id/review`
- [ ] Add request validation for file type and size
- [x] Add auth enforcement for all voice routes
- [x] Add admin/doctor access rules as needed

## Frontend: Upload And Review
- [x] Add a voice upload entry point in the UI
- [x] Add audio file selection UI
- [ ] Add processing state and progress UI
- [x] Add transcript viewer with timestamps
- [x] Add extracted data preview next to transcript
- [x] Add low-confidence review UI
- [x] Add approve/edit/reject actions
- [ ] Add final dashboard launch from processed voice record

## Frontend: Product Flow
- [x] Decide whether voice appears in `Upload Center` or as a separate intake tab
- [x] Add voice record list/status handling
- [x] Add empty/error states for voice processing
- [ ] Add session resumption handling for interrupted reviews
- [ ] Add minimal audit visibility for review actions

## Provenance And Safety
- [ ] Store timestamp-based provenance for each extracted field
- [ ] Store speaker role where relevant
- [ ] Mark inferred vs explicit values
- [ ] Gate ambiguous medication names for review
- [ ] Gate ambiguous dosages and frequencies for review
- [ ] Gate ambiguous lab/radiology orders for review
- [ ] Prevent casual discussion from being promoted into confirmed orders

## Reuse Of Existing Platform Capabilities
- [ ] Map voice output into existing dashboard schema
- [ ] Reuse chart note generation on voice-derived records
- [ ] Reuse doctor chat against voice-derived records
- [ ] Reuse alerting flows where clinically appropriate
- [ ] Reuse audit logging and analytics patterns

## Testing
- [ ] Add unit tests for transcript normalization
- [ ] Add unit tests for STT response normalization
- [ ] Add unit tests for provenance construction
- [ ] Add graph-node tests for key branches
- [ ] Add review interrupt/resume tests
- [ ] Add API tests for voice routes
- [ ] Add frontend tests for upload and review flow
- [ ] Add end-to-end test for dictation upload to dashboard

## Evaluation
- [ ] Run the provider-backed path on the benchmark dataset
- [ ] Run the self-hosted path on the same benchmark dataset
- [ ] Compare transcript quality
- [ ] Compare extraction quality
- [ ] Compare review burden
- [ ] Document failure patterns
- [ ] Recommend production STT choice based on results

## Phase-Gate Decisions
- [ ] Decide whether the provider-backed experiment is good enough to continue
- [ ] Decide whether the self-hosted path becomes the default STT backend
- [ ] Decide whether conversation mode enters scope
- [ ] Decide whether live streaming enters scope

## Launch Readiness
- [ ] Finalize storage retention policy for audio and transcripts
- [ ] Finalize operational runbooks
- [ ] Finalize security review for PHI handling
- [ ] Finalize environment/config documentation
- [ ] Finalize rollback strategy

## Notes
- v1 should be judged by transcript quality, extraction quality, and review burden, not just demo success.
- Live streaming should remain blocked until uploaded dictation is stable.
