# Manipal CoE - Doctor Dashboard Documentation

**Project:** Doctor Dashboard - Clinical Intelligence System
**Version:** 3.1.0
**Last Updated:** 2026-06-04
**Status:** Production

---

> Note
> This docs set mixes current-state operational guides with some older architecture and planning documents. When a document is marked as `historical`, `concept`, or `planning-oriented`, treat it as design context rather than a description of the exact code currently running in this repository.

## Quick Navigation

- [Getting Started](#getting-started)
- [Project Overview](#project-overview)
- [Documentation Index](#documentation-index)
- [Architecture](#architecture)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)

---

## Getting Started

### Prerequisites

- Node.js 18+
- Access to approved proprietary AI services

### Quick Start

```bash
# Install dependencies
npm install

# Start development servers
npm run dev   # Frontend on :5173
npm run server # Backend on :8001
```

For detailed setup instructions, see [Getting Started Guide](./guides/getting-started.md).

---

## Project Overview

### What is Doctor Dashboard?

The Doctor Dashboard is an **AI-powered clinical intelligence system** that transforms unstructured clinical PDFs, uploaded physician dictation audio, and live doctor-patient conversations into interactive clinical workflows. It uses a document router for PDFs, a validated voice extraction path for uploaded dictation, a live session runtime for streaming capture, and shared dashboard presentation logic in the UI.

### Key Capabilities

| Capability | Description |
|------------|-------------|
| **PDF Understanding** | Extract structured data from unstructured clinical PDFs |
| **Voice Dictation Intake** | Upload audio dictation, transcribe it, extract structured clinical content, and open the same dashboard route |
| **Live Conversation Streaming** | Capture microphone audio, persist rolling transcript and draft note state, and review/finalize a live visit session |
| **Agentic Document Classification** | ReAct-based classification with 95%+ confidence |
| **Dynamic Skill Selection** | Agents decide which extraction skills to run based on content |
| **Scalable Architecture** | Add new document types via configuration, not code |
| **Document Type Detection** | Auto-detects prescriptions, discharge summaries, outpatient records, lab reports, chart notes |
| **Unified Queue** | PDFs and voice dictations share the same processed-documents queue and dashboard entry point |
| **Processing Insights** | Analytics overview backed by `analytics.sqlite` |
| **Data Validation** | Cross-validate extracted data against source with citations |
| **Chart Note Generation** | Generate clinical SOAP notes with ReAct reasoning |
| **Doctor Chat Assistant** | Interactive Q&A with internal + external knowledge |
| **Dashboard Presentation** | Transform extracted data into UI components |
| **Voice Dashboard Readiness Guard** | Voice items are only exposed as `processed` when the stored dashboard payload is renderable |
| **Safety Guardrails** | Prevent hallucinations and unsafe medical advice |
| **Pending Items Extraction** | LLM-only extraction of pending labs, radiology, follow-ups |
| **Audit Trail** | Complete audit logging for all operations |

### Technology Stack

- **Frontend:** React + TypeScript + Tailwind CSS + Vite
- **Backend:** Express.js + Node.js
- **AI/LLM:** Proprietary on-prem inference plus approved external/provider-backed AI services
- **PDF Processing:** Custom PDF extraction tools
- **Architecture:** Multi-agent ReAct pattern with parallel execution

---

## Documentation Index

### 1. Architecture & Design

| Document | Description | Link |
|----------|-------------|------|
| AI Architecture | Complete AI/LLM system architecture | [View](./architecture/ai-architecture.md) |
| Agent System | Multi-agent orchestration details (v3.0 ReAct) | [View](./architecture/agent-system.md) |
| **ReAct Architecture Diagrams** | **Current visual diagrams for PDF + voice runtime architecture** | [View](./architecture/diagrams/react-architecture.md) |
| Full Architecture HTML v5 | Presentation-ready HTML architecture overview with live conversation updates | [View](./architecture/manipal_coe_full_architecture_v5.html) |
| Client Review Deployment Architecture | Production deployment diagram for client review and approval | [View](./architecture/manipal_coe_deployment_architecture_client_review_v2.html) |
| Skills Framework | Reusable AI skills documentation | [View](./architecture/skills-framework.md) |
| Chatbot Architecture | Doctor Assistant chat system | [View](./architecture/chatbot-architecture.md) |
| Chart Note React Agent | Chart note generation architecture | [View](./architecture/CHART_NOTE_REACT_AGENT.md) |
| Postgres Persistence + Interoperability Plan | Planning-oriented canonical spec for Postgres migration, FHIR-first persistence, HL7 v2 adapter boundaries, and hybrid identity handling | [View](./architecture/postgres-persistence-interoperability-plan.md) |
| Postgres Persistence + Interoperability Checklist | Planning-oriented execution tracker for the Postgres, HL7, and FHIR migration program | [View](./architecture/postgres-persistence-interoperability-checklist.md) |
| Phase 3A Master Data + Identity Backfill Contract | Planning-oriented implementation contract for backfilling users, sessions, provisional patients/encounters, identifiers, and practitioner links from the real runtime stores | [View](./architecture/phase-3a-master-data-identity-backfill-contract.md) |
| Phase 3B Documents + Extractions Backfill Contract | Planning-oriented implementation contract for backfilling canonical documents, assets, extractions, cached chart notes, and deterministic prescription artifacts | [View](./architecture/phase-3b-documents-extractions-backfill-contract.md) |
| Phase 3C Transcripts + Reviews + Live Workflow Backfill Contract | Planning-oriented implementation contract for backfilling voice/live transcripts, segments, review items, review history, live-session rows, workflow assets, and lifecycle audit events | [View](./architecture/phase-3c-transcripts-reviews-live-workflow-backfill-contract.md) |
| Phase 3D Chat + Audit + Alerts + Analytics Backfill Contract | Planning-oriented implementation contract for backfilling chat history, confirmed actions, chat exports, audit history, alert deliveries, and analytics metrics from the real runtime stores | [View](./architecture/phase-3d-chat-audit-alerts-analytics-backfill-contract.md) |
| Phase 6 Legacy Store Cleanup Contract | Planning-oriented implementation contract for retiring JSON/JSONL/SQLite metadata stores after Postgres becomes authoritative | [View](./architecture/phase-6-legacy-store-cleanup-contract.md) |
| Phase 6 Cleanup Mapping Note | Runtime-seam inventory for each remaining legacy metadata store, its Postgres owner, and cleanup action | [View](./architecture/phase-6-legacy-store-cleanup-mapping-note.md) |
| Phase 6 Cleanup Validation + Archive Runbook | Staged execution, validation, archive, and rollback guidance for the cleanup cutover | [View](./architecture/phase-6-cleanup-validation-and-archive-runbook.md) |
| Voice Intake Current Implementation Summary | Current-state uploaded dictation + live conversation runtime architecture | [View](./architecture/voice-intake-phase2-implementation-summary.md) |
| Live Conversation UI + Backend Fit Plan | Current live workspace fit, implementation status, and remaining gaps | [View](./architecture/live-conversation-ui-backend-plan.md) |
| Live Conversation STT Testing Plan | Hardening plan for chunked live transcription, VAD, reconciliation, and diarization | [View](./architecture/live-conversation-stt-testing-plan.md) |
| Voice Intake LangGraph Plan | Architecture plan for dictation/conversation-to-dashboard flow | [View](./architecture/voice-intake-langgraph-plan.md) |
| Voice Intake Phase 0 Baseline | Historical baseline document for initial voice decisions | [View](./architecture/voice-intake-phase0-baseline.md) |
| Voice Intake Implementation Checklist | Historical execution tracker; use the Phase 2 summary for current runtime behavior | [View](./architecture/voice-intake-implementation-checklist.md) |
| **Prescription Generation Plan** | **Implementation plan for generating prescriptions from live conversations** | [View](./architecture/prescription-generation-plan.md) |
| **Prescription Generation Architecture** | **Architecture diagrams and data flow for prescription generation** | [View](./architecture/prescription-generation-architecture.md) |

### 2. Project Planning & Research

| Document | Description | Link |
|----------|-------------|------|
| Concept Proposal | Original interactive dashboard proposal | [View](./research/concept-proposal.md) |
| Data Analysis | EDA on discharge summary reports | [View](./research/data-analysis.md) |
| Feature Requirements | AI architecture feature requirements | [View](./research/feature-requirements.md) |
| Sample Chart Note | Example SOAP note output | [View](./research/SAMPLE_CHART_NOTE.md) |

### 3. Development Guides

| Document | Description | Link |
|----------|-------------|------|
| Getting Started | Setup and installation guide | [View](./guides/getting-started.md) |
| API Reference | Complete API endpoint documentation | [View](./guides/api-reference.md) |

### 4. Testing & Evaluation

| Document | Description | Link |
|----------|-------------|------|
| LLM Evaluation | Complete LLM capability assessment | [View](./testing/llm-evaluation.md) |
| Performance Benchmarks | System performance metrics | [View](./testing/performance.md) |

### 5. Deployment & Operations

| Document | Description | Link |
|----------|-------------|------|
| Deployment Guide | Production deployment instructions | [View](./operations/deployment.md) |
| Security & Compliance | HIPAA and security documentation | [View](./operations/security.md) |
| External Provider API Key Deployment | External provider API key deployment guide | [View](./operations/deployment-external-provider-api-key.md) |

---

## Project Structure

**Root Stack (Current):**
```
manipal-coe/
├── server/                    # Root backend server
│   ├── index.cjs              # Main Express server with audit
│   ├── audit_logger.cjs       # Audit logging system
│   └── voice_result_validation.cjs # Voice dashboard readiness validator
├── agents/                    # AI Agents
│   ├── core/                        # Core agent framework
│   │   ├── base_agent.cjs           # Base ReAct agent class
│   │   ├── agent_state.cjs          # Agent state management
│   │   ├── skill_registry.cjs       # Central skill registry
│   │   └── tool_registry.cjs        # Tool registry
│   ├── extraction/
│   │   ├── document_classifier_agent.cjs  # Agentic classifier
│   │   └── react_extraction_agent.cjs     # Optional ReAct extraction path
│   ├── document_type_router.cjs           # Auto-detects doc type (updated v3.0)
│   ├── voice_extractor_agent.cjs          # Voice dictation extraction path
│   ├── discharge_extractor_agent.cjs      # Discharge summary extraction
│   ├── outpatient_extractor_agent.cjs     # OPD record extraction
│   ├── lab_report_extractor_agent.cjs      # Lab report extraction
│   ├── chart_note_extractor_agent.cjs      # Chart note extraction
│   ├── doctor_assistant_agent.cjs          # Doctor chat assistant
│   ├── chart_note_agent.cjs                # Chart note generation
│   ├── action_router_agent.cjs             # Chat action routing
│   ├── answer_composer_agent.cjs           # Chat response composition
│   ├── external_knowledge_agent.cjs        # External knowledge queries
│   ├── query_intent_agent.cjs              # Chat intent detection
│   ├── record_context_agent.cjs            # Record context retrieval
│   ├── safety_guard_agent.cjs              # Safety validation
│   └── session_memory_agent.cjs            # Chat session management
├── skills/                   # Reusable Skills
│   ├── extraction/
│   │   ├── pending_items_extractor.skill.cjs  # LLM-only pending items
│   │   ├── risk_scores_extractor.skill.cjs     # Risk assessment scores
│   │   ├── vitals_extractor.skill.cjs           # Vital signs extraction
│   │   ├── demographics_extractor.skill.cjs     # Patient demographics
│   │   ├── functional_status_extractor.skill.cjs # ADL assessment
│   │   ├── clinical_data_extractor.skill.cjs     # Clinical data extraction
│   │   └── document_analyzer.skill.cjs            # Document analysis
│   ├── validation/
│   │   ├── cross_validator.skill.cjs             # Cross-validation
│   │   └── cross_validation_agent.skill.cjs       # Agent-based validation
│   ├── generation/
│   │   └── chart_note_composer.skill.cjs          # Chart note generation
│   ├── presentation/
│   │   ├── dashboard_mapper.skill.cjs             # Dashboard card mapping
│   │   ├── summary_card_builder.skill.cjs          # Summary card creation
│   │   └── notes_rail_builder.skill.cjs            # Notes rail creation
│   └── chat/
│       ├── chat_export_builder.skill.cjs          # Chat export
│       ├── abnormal_flag_action.skill.cjs         # Abnormal flag actions
│       └── note_update_suggester.skill.cjs        # Note update suggestions
├── tools/                    # Utility tools
│   ├── pdf/
│   │   └── pdf_reader.tool.cjs                    # PDF text extraction
│   ├── llm/                              # Proprietary inference and prompt tooling
│   ├── clinical/
│   │   └── provenance_builder.tool.cjs            # Provenance data
│   └── presentation/
│       ├── timeline_formatter.tool.cjs           # Timeline formatting
│       └── note_selector.tool.cjs                 # Note selection
├── src/                      # Frontend React code
│   ├── components/
│   │   └── dashboard/
│   ├── pages/
│   ├── lib/
│   └── main.tsx
├── server/storage/           # Data storage
│   ├── uploads/              # PDF files
│   ├── documents.json        # Unified processed queue for PDFs and voice dictation
│   ├── analytics.sqlite      # Processing insights store
│   ├── audit_runs.json       # Audit run metadata
│   ├── audit_events.jsonl    # Audit event log
│   ├── chat_sessions.json    # Chat history
│   ├── voice_sessions.json   # Voice intake session store
│   ├── voice_reviews.json    # Voice review/audit events
│   ├── voice_audio/          # Stored uploaded audio
│   ├── voice_transcripts/    # Normalized transcript payloads
│   └── voice_graph_checkpoints/ # Reserved for voice checkpoint state
└── docs/                     # Documentation (this folder)
```

---

## Key Concepts

### Document Type Routing

The system automatically detects document types and routes to specialized extractors. In the current production flow, `DocumentTypeRouter` is the default entry point; `ReActExtractionAgent` exists in the repository but is optional rather than the default extraction path.

| Document Type | Indicators | Extractor Used |
|---------------|------------|----------------|
| Discharge Summary | "discharge", risk scores, EWS | DischargeExtractorAgent |
| Outpatient Record | "OPD", "clinic", "consultation" | OutpatientExtractorAgent |
| Lab Report | "lab results", "CBC", "reference range" | LabReportExtractorAgent |
| Chart Note | "progress note", "SOAP", "resident note" | ChartNoteExtractorAgent |

### Voice Intake Lifecycle

Voice dictation is a parallel runtime path rather than a `DocumentTypeRouter` document type.

Current behavior:

1. Upload audio through `POST /api/voice/upload`.
2. Create a voice session record and a matching queue document row immediately.
3. Auto-start `POST /api/voice/process` from the frontend upload flow.
4. Transcribe audio with the deployed proprietary transcription service and normalize transcript segments.
5. Extract structured data with `VoiceExtractorAgent`.
6. Validate the mapped dashboard payload before exposing the item as `processed`.
7. Open the result through the same `/dashboard?documentId=<id>` route used by PDFs.

Voice status semantics:

- `queued`: uploaded, not yet transcribed
- `transcribing`: STT in progress
- `review_required`: extraction completed but one or more review items remain unresolved
- `processed`: dashboard-ready and renderable
- `failed`: transcription or extraction finished without a usable dashboard payload

### Parallel Extraction Architecture

The root stack implements concurrent extraction for improved performance:

- **Execution Plan:** Dynamically builds metadata → extraction → validation phases
- **Worker Pool:** Configurable concurrency (default: 3 parallel steps)
- **Rich Timing:** Tracks `startedAt`, `endedAt`, `latencyMs` per step
- **Progress Callbacks:** SSE-based real-time progress updates

### Audit Trail System

Complete audit logging for compliance and debugging:

- **Run Tracking:** Each extraction/chart/chat operation creates an audit run
- **Event Timeline:** Step-by-step event logging with details
- **Query API:** Filter runs by workflow, document, status
- **Storage:** JSON runs + JSONL events for efficient append-only writes

### LLM-Only Pending Items Extraction

The system features a pure LLM-based extraction approach for pending items:

- **No Regex Patterns** - Semantic understanding via proprietary reasoning models
- **7-Step Process** - Structured thinking for clinical items
- **Provenance Tracking** - Source sections and excerpts included
- **Priority Classification** - Clinical judgment (high/medium/low)
- **Failure Visibility** - Failed steps are tracked explicitly in `data.failed_steps`

---

## Development Status

### Completed ✅

- **ReAct-based agent architecture with dynamic skill selection (NEW v3.0)**
- **Agentic document classification with vision + handwriting detection (NEW v3.0)**
- **Scalable skill registry for adding new document types (NEW v3.0)**
- Multi-agent architecture with ReAct reasoning
- Document type detection and routing
- Parallel extraction orchestration
- PDF extraction with cross-validation
- Pending items extraction (LLM-only)
- Interactive chat assistant
- Chart note generation
- Dashboard UI components
- Audit trail system
- Rich step timing metadata

### In Progress 🚧

- Multi-document comparison
- Real-time EMR integration

### Planned 📋

- Population analytics
- Voice input for chat
- Clinical decision support
- Predictive analytics

---

## Contributing

For contribution guidelines, contact the development team.

---

## License

Proprietary - Manipal CoE

---

## Contact

For questions or support, contact the development team.

---

*Documentation maintained by the AI Architecture Team*
*Last updated: May 21, 2026*
