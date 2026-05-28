# AI Architecture Document

## Doctor Dashboard - Clinical Intelligence System

**Project:** Manipal CoE Healthcare Reporting System
**Version:** 2.0.0
**Date:** 2026-04-07
**Status:** Production Architecture

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Overview](#system-overview)
3. [Core AI Components](#core-ai-components)
4. [Agent Architecture](#agent-architecture)
5. [Skills Framework](#skills-framework)
6. [Tools & Utilities](#tools--utilities)
7. [Data Flow Architecture](#data-flow-architecture)
8. [Frontend Integration](#frontend-integration)
9. [Deployment Architecture](#deployment-architecture)
10. [Performance & Scalability](#performance--scalability)
11. [Security & Compliance](#security--compliance)
12. [Future Roadmap](#future-roadmap)

---

## Executive Summary

The Doctor Dashboard is an AI-powered clinical intelligence system that transforms unstructured discharge summary PDFs into interactive, clinically-actionable dashboards. The architecture follows a **multi-agent ReAct (Reasoning + Acting) pattern** with specialized skills, enabling accurate extraction, validation, and presentation of clinical data.

### Key Capabilities

| Capability | Description | AI Component |
|------------|-------------|--------------|
| **PDF Understanding** | Extract structured data from unstructured clinical PDFs | DischargeExtractorAgent + Skills |
| **Data Validation** | Cross-validate extracted data against source with citations | CrossValidationAgentSkill |
| **Chart Note Generation** | Generate clinical SOAP notes with ReAct reasoning | ChartNoteAgent |
| **Doctor Chat Assistant** | Interactive Q&A with internal + external knowledge | DoctorAssistantAgent |
| **Dashboard Presentation** | Transform extracted data into UI components | DashboardMapperSkill |
| **Safety Guardrails** | Prevent hallucinations and unsafe medical advice | SafetyGuardAgent |

---

## System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER                                  │
│                        (React + TypeScript + Tailwind)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Upload Center│  │   Dashboard  │  │ Detail Views │  │Chat Assistant │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        ↕ REST API
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API GATEWAY                                     │
│                    (Express.js + CORS + File Upload)                         │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ /api/documents    /api/chat    /api/agent    /api/documents/:id/*   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        ↕
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AI AGENT SYSTEM LAYER                              │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        AGENT ORCHESTRATOR                            │    │
│  │  ┌───────────────┐ ┌───────────────┐ ┌─────────────────────────┐   │    │
│  │  │  Extraction   │ │   Chat & Q&A  │ │    Chart Note Gen      │   │    │
│  │  │    Agent      │ │    Agent      │ │       Agent            │   │    │
│  │  └───────────────┘ └───────────────┘ └─────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↕                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        SKILLS LAYER                                  │    │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐      │    │
│  │  │ Extraction │ │ Validation │ │Generation  │ │Presentation│      │    │
│  │  │  Skills    │ │  Skills    │ │  Skills    │ │  Skills    │      │    │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↕                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        TOOLS LAYER                                   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │ PDF      │ │ LLM      │ │ Clinical │ │Present'n │ │  Chat    │  │    │
│  │  │ Reader   │ │ Client   │ │ Tools   │ │  Tools   │ │  Tools   │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                        ↕
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SERVICES                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │ Proprietary AI   │  │  Storage Layer   │  │  External Search │         │
│  │ Inference API    │  │  (File System)   │  │  (Medical Web)   │         │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core AI Components

### 1. Language Model Foundation

**Primary Inference: Proprietary On-Prem Model Service**

| Configuration | Value | Purpose |
|---------------|-------|---------|
| Model Profile | deployment-specific | Main inference engine |
| Context Window | ~24K tokens | Large document processing |
| Temperature | 0.1-0.4 (task-dependent) | Balancing creativity vs accuracy |
| Timeout | 60-180s per step | Preventing hanging requests |
| API Endpoint | Configurable internal endpoint | Deployment flexibility |

**Why this deployment profile?**
- Clinical understanding with controlled infrastructure cost
- Self-hosted for data privacy
- Good balance of capability vs latency
- Instruction-tuned for reasoning tasks

---

## Agent Architecture

The system uses a **multi-agent architecture** with specialized agents for different clinical workflows.

### Primary Agents

#### 1. DischargeExtractorAgent

**Purpose:** Transform unstructured PDF discharge summaries into structured clinical data

**Pattern:** ReAct (Reasoning + Acting) with Sequential Skill Execution

**Workflow:**

```
PDF Input
    ↓
PDF Reader Tool (Extract text, page segmentation, validation)
    ↓
Sequential Skill Execution:
  1. DocumentAnalyzer → Document structure detection
  2. DemographicsExtractor → Patient demographics
  3. RiskScoresExtractor → Fall/DVT/Pressure ulcer risks
  4. VitalsExtractor → Vital signs extraction
  5. FunctionalStatusExtractor → ADL assessment
  6. ClinicalDataExtractor → Diagnoses, meds, labs
  7. CrossValidator → Source verification
    ↓
Data Assembly & Validation (Merge outputs, conflict resolution)
    ↓
Structured JSON Output
```

**Key Features:**
- Progressive enhancement: Each skill builds on previous outputs
- Error resilience: Failed skills don't stop processing
- Validation layer: Cross-validation against source PDF
- Token optimization: Configurable chunking for large documents

#### 2. DoctorAssistantAgent

**Purpose:** Interactive clinical chat with context-aware responses

**Pattern:** Multi-Agent Orchestration with Safety Layers

**Workflow:**

```
User Query
    ↓
QueryIntentAgent (Classify query type, detect external search needs)
    ↓
Consent Check (if external search needed)
    ↓
RecordContextAgent (Search extracted clinical data)
    ↓
ExternalKnowledgeAgent (Medical web search, if consented)
    ↓
SafetyGuardAgent (Hallucination detection, safety checks)
    ↓
AnswerComposerAgent (Synthesize internal + external evidence)
    ↓
ActionRouterAgent (Suggest clinical actions)
    ↓
Response with Citations + Action Proposals
```

**Safety Features:**
- Refusal Policy: Declines inappropriate medical advice requests
- Hallucination Detection: Cross-checks LLM outputs against source
- Confidence Scoring: Always provides confidence levels
- Source Attribution: All claims cite their source (internal/external)

#### 3. ChartNoteAgent

**Purpose:** Generate clinical SOAP notes from extracted data

**Pattern:** ReAct with Explicit Reasoning Steps

**Workflow:**

```
Extracted Data + PDF Source
    ↓
Clinical Picture Analysis (THINK)
    ↓
SOAP Structure Planning (THINK)
    ↓
Subjective Generation (THINK + WRITE)
    ↓
Objective Generation (THINK + WRITE)
    ↓
Assessment Generation (THINK + WRITE)
    ↓
Plan Generation (THINK + WRITE)
    ↓
Review & Refine (THINK)
    ↓
Compiled SOAP Note with Citations
```

**Quality Assurance:**
- Each section has explicit reasoning
- Self-refinement loop
- Citation attachment for all claims
- Clinician-style formatting

---

## Skills Framework

Skills are **reusable AI capabilities** that can be composed into agents.

### Skill Interface

```javascript
class Skill {
  constructor(config = {}) {
    this.name = "Skill Name";
    this.version = "1.0.0";
  }

  async execute(context) {
    // context: { pdfText, inferenceClient, promptBuilder, ... }
    return {
      success: boolean,
      data: object,
      validation: object,
      usage: { totalTokens, latency }
    };
  }
}
```

### Skill Categories

#### 1. Extraction Skills

| Skill | Purpose | Output |
|-------|---------|--------|
| `DocumentAnalyzerSkill` | Detect document structure | `{ document_type, sections_identified }` |
| `DemographicsExtractorSkill` | Extract patient info | `{ name, mrn, age, gender, admission_date }` |
| `RiskScoresExtractorSkill` | Extract risk assessments | `{ fall_risk, dvt_risk, ews_score, gcs }` |
| `VitalsExtractorSkill` | Extract vital signs | `{ bp, pulse, temp, spo2, resp_rate }` |
| `FunctionalStatusExtractorSkill` | Extract ADL assessment | `{ functional_status, assistance_needs }` |
| `ClinicalDataExtractorSkill` | Extract diagnoses/meds/labs | `{ diagnosis, medications, lab_results }` |
| `PendingItemsExtractorSkill` | LLM-only pending items extraction | `{ pending_labs, pending_radiology, pending_followups, medication_reconciliation, pending_discharge_items }` |

#### 2. Validation Skills

| Skill | Purpose | Output |
|-------|---------|--------|
| `CrossValidatorSkill` | Source verification with citations | `{ validatedData, citations, validation }` |
| `CrossValidationAgentSkill` | Field-level citation tracking | `{ fieldsNeedingReview, confidence }` |

#### 3. Generation Skills

| Skill | Purpose | Output |
|-------|---------|--------|
| `ChartNoteComposerSkill` | Generate SOAP note content | `{ chart_note, metadata }` |

#### 4. Presentation Skills

| Skill | Purpose | Output |
|-------|---------|--------|
| `DashboardMapperSkill` | Transform data for UI | `{ dashboard_cards, sample_patient_data }` |
| `SummaryCardBuilderSkill` | Build summary cards | `{ summaryCards: { vitals, diagnosis, ... } }` |
| `NotesRailBuilderSkill` | Build notes timeline | `{ notesRail: [...] }` |

#### 5. Chat Skills

| Skill | Purpose | Output |
|-------|---------|--------|
| `NoteUpdateSuggesterSkill` | Suggest chart note updates | `{ proposed_updates: [...] }` |
| `AbnormalFlagActionSkill` | Action for abnormal values | `{ proposed_actions: [...] }` |
| `ChatExportBuilderSkill` | Export chat to appendix | `{ chart_note_appendix: string }` |

---

## LLM-Only Extraction Architecture

### Pending Items Extractor (Pure LLM Approach)

The `PendingItemsExtractorSkill` represents a **pure LLM-based extraction approach** that eliminates brittle regex patterns in favor of semantic understanding.

#### Architecture Comparison

**Before (Regex-Based):**
```javascript
// Regex patterns in clinical_data_extractor.skill.cjs
isRadiologyItem()      // /\b(?:xray|x-ray|ct|mri|usg...)\b/i
isFollowUpItem()       // /(follow-?up|review|appointment...)\b/i
isVitalLikeLabResult() // /^(?:bp|blood pressure|pulse...)\b/i
extractSection()       // Regex-based section extraction
collectList()          // Split by newlines, strip prefixes
```

**After (LLM-Only):**
```javascript
// Pure proprietary inference extraction
promptBuilder.build("pending_items_extractor", { pdfText })
inferenceClient.execute(prompt, { temperature: 0.1, maxTokens: 3000 })
```

#### 7-Step LLM Process

```
STEP 1: Identify Sections
├─ Look for: "Residents Notes", "Doctor's Handover", "Nursing Endorsement"
└─ Note headers and subsections

STEP 2: Extract PENDING LABS
├─ Keywords: "SEND BLOOD FOR", "Lab pending", "Awaiting reports"
└─ Output: test_name, expected_date, reason, priority

STEP 3: Extract PENDING RADIOLOGY/IMAGING
├─ Keywords: CT scans, MRI, X-rays, Ultrasounds, Echocardiograms
└─ Output: type, body_part, scheduled_date, reason, priority

STEP 4: Extract PENDING FOLLOW-UPS
├─ Keywords: "Follow-up", "Review", "Appointment", "Outpatient visit"
└─ Output: department, provider, date, time, purpose, priority

STEP 5: Extract MEDICATION RECONCILIATION STATUS
├─ Look for: medication lists, allergy documentation, interaction notes
└─ Categorize: "complete" or "attention_needed"

STEP 6: Extract DISCHARGE PENDING ITEMS
├─ Look for: pending procedures, consultations, incomplete documentation
└─ Output: items requiring completion before discharge

STEP 7: Assess PRIORITY
├─ HIGH: Critical labs, imaging for acute conditions
├─ MEDIUM: Routine follow-ups, non-urgent tests
└─ LOW: Optional monitoring, wellness items
```

#### Output Schema

```json
{
  "pending_labs": [
    {
      "test_name": "Lipid Panel",
      "expected_date": "March 21, 2026",
      "reason": "Cardiac risk assessment",
      "priority": "high",
      "source_section": "Residents Notes",
      "source_excerpt": "SEND BLOOD FOR Lipid Panel - cardiac risk assessment"
    }
  ],
  "pending_radiology": [
    {
      "type": "CT Chest",
      "body_part": "Chest",
      "scheduled_date": "March 21, 2026",
      "reason": "Pulmonary nodule surveillance",
      "priority": "high",
      "source_section": "Doctor's Handover",
      "source_excerpt": "CT Chest scheduled for March 21 - pulmonary nodule surveillance"
    }
  ],
  "pending_followups": [
    {
      "department": "Cardiology",
      "provider": "Dr. Smith",
      "date": "April 15, 2026",
      "time": "10:00 AM",
      "purpose": "Post-MI follow-up",
      "priority": "medium",
      "source_section": "Discharge Plan",
      "source_excerpt": "Follow-up with Cardiology, Dr. Smith on April 15 at 10:00 AM"
    }
  ],
  "medication_reconciliation": {
    "status": "complete",
    "medication_count": 5,
    "allergy_count": 1,
    "concerns": "",
    "source_section": "Medication List",
    "source_excerpt": "Medications reconciled - no interactions detected"
  },
  "pending_discharge_items": [
    {
      "item": "Final lab results review",
      "reason": "Awaiting cardiac enzyme panel",
      "priority": "high",
      "source_section": "Nursing Endorsement",
      "source_excerpt": "Pending: cardiac enzyme panel results before discharge"
    }
  ],
  "summary": {
    "total_pending": 5,
    "needs_attention": 2,
    "scheduled": 2,
    "complete": 1
  }
}
```

#### Benefits of LLM-Only Approach

| Benefit | Description |
|---------|-------------|
| **No Brittle Regex** | Works with any document format, no pattern matching |
| **Clinical Understanding** | Interprets context, not just text patterns |
| **Provenance Built-in** | LLM extracts source references automatically |
| **Priority Judgment** | Clinical reasoning for categorization |
| **Extensible** | Add new categories by updating prompt only |
| **Graceful Fallback** | Returns empty result on parse failure |

#### Configuration

```javascript
const PendingItemsExtractor = require('./skills/extraction/pending_items_extractor.skill.cjs');

const pendingExtractor = new PendingItemsExtractorSkill(config);
const result = await pendingExtractor.execute({
  pdfText,
  inferenceClient,
  promptBuilder
});

// LLM Configuration
{
  temperature: 0.1,    // Low for consistent extraction
  maxTokens: 3000      // Enough for structured output
}
```

---

---

## Tools & Utilities

Tools are **lower-level utilities** used by skills and agents.

### Tool Categories

#### 1. Data Access Tools

| Tool | Purpose |
|------|---------|
| `PDFReaderTool` | Extract text from PDF files |
| `InferenceClientTool` | Interface to the proprietary inference API |
| `PromptBuilderTool` | Build structured prompts |

#### 2. Clinical Tools

| Tool | Purpose |
|------|---------|
| `VitalsInterpreterTool` | Interpret vital sign values |
| `ProvenanceBuilderTool` | Track data source provenance |

#### 3. Presentation Tools

| Tool | Purpose |
|------|---------|
| `SectionStatusResolverTool` | Determine section status (normal/abnormal) |
| `CardMetricSelectorTool` | Select metrics for dashboard cards |
| `NoteSelectorTool` | Select relevant clinical notes |
| `TimelineFormatterTool` | Format timeline data |

#### 4. LLM Tools

| Tool | Purpose |
|------|---------|
| `CitationTrackerTool` | Track and validate citations |
| `ConfidenceScorerTool` | Score response confidence |

#### 5. Chat Tools

| Tool | Purpose |
|------|---------|
| `QueryClassifierTool` | Classify user queries |
| `SectionHintResolverTool` | Resolve section context from queries |
| `SectionContextFetchTool` | Fetch section-specific data |
| `CitationAssemblerTool` | Assemble citations for responses |
| `ChatPromptBuilderTool` | Build chat prompts |
| `RecordContextSearchTool` | Search extracted clinical data |
| `MedicalWebSearchTool` | Search approved medical sources |
| `ProvenanceGateTool` | Gate based on data provenance |
| `RefusalPolicyTool` | Determine if query should be refused |
| `SourcePolicyTool` | Determine appropriate source (internal/external) |
| `ExternalSourceRankerTool` | Rank external medical sources |
| `ExternalCitationNormalizerTool` | Normalize external citations |

---

## Data Flow Architecture

### 1. Document Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DOCUMENT UPLOAD                                    │
│  User uploads PDF → /api/documents/upload → File stored in /storage/uploads  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DOCUMENT PROCESSING                                   │
│  POST /api/documents/process → { ids: [...] }                               │
│                                                                              │
│  For each document:                                                         │
│    1. Update status: queued → processing                                    │
│    2. Execute DischargeExtractorAgent.process(pdfPath)                      │
│    3. Transform result → Dashboard format                                   │
│    4. Update status: processing → processed                                 │
│    5. Store result in document.json                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DASHBOARD DISPLAY                                   │
│  GET /api/documents/:id → Returns processed document with:                  │
│    - meta: { pdf_file, processed_at, agent_version }                        │
│    - dashboard_cards: { vitals_card, diagnosis_card, ... }                  │
│    - sample_patient_data: { name, age, mrn, ... }                           │
│    - presentation: { summary_cards, notes_rail }                            │
│    - extracted_data: { patient, vitals, diagnosis, medications, ... }       │
│    - provenance: { sections: { vitals: { status, sources }, ... } }          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. Chat Interaction Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         USER QUERY SUBMIT                                   │
│  POST /api/chat/query → { documentId, message, sectionContext, chatId }     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                      QUERY INTENT CLASSIFICATION                             │
│  QueryIntentAgent → {                                                     │
│    queryType: 'vitals' | 'diagnosis' | 'medications' | 'general',          │
│    sectionHints: ['vitals'],                                               │
│    needsClarification: false,                                              │
│    needsExternal: false,                                                   │
│    requiresExternalConsent: false                                          │
│  }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INTERNAL EVIDENCE RETRIEVAL                              │
│  RecordContextAgent → [                                                   │
│    { value: "130/85 mmHg", section: "vitals", relevance: 0.95 },            │
│    { value: "72 bpm", section: "vitals", relevance: 0.92 }                  │
│  ]                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                   EXTERNAL SEARCH (IF CONSENTED)                            │
│  ExternalKnowledgeAgent → [                                               │
│    { source: "UpToDate", title: "...", snippet: "...", url: "..." }         │
│  ]                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SAFETY VALIDATION                                   │
│  SafetyGuardAgent → {                                                      │
│    confidence: { score: 85, label: "high" },                                │
│    refusal: { refused: false, reason: null }                                │
│  }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ANSWER COMPOSITION                                    │
│  AnswerComposerAgent → "The patient's blood pressure is 130/85 mmHg..."     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Frontend Integration

### Component Architecture

```
App.tsx
├── QueryClientProvider (React Query)
├── BrowserRouter
│   ├── / → UploadCenter
│   └── /dashboard → Index
│
└── Index.tsx (Dashboard)
    ├── DashboardToolbar
    │   ├── Navigation (back, queue)
    │   ├── Record Search
    │   ├── Export Actions (print, email, chart note PDF)
    │   └── Agent Info (version, tokens, confidence, steps)
    │
    ├── PatientHeader
    │   ├── Patient photo
    │   ├── Patient info (name, MRN, age, gender)
    │   ├── Admission info (dates, LOS, department)
    │   └── Risk badges
    │
    ├── Summary Cards Grid
    │   ├── Vitals Card → VitalsDetail
    │   ├── Diagnosis Card → DiagnosisDetail
    │   ├── Medications Card → MedicationsDetail
    │   ├── Labs Card → LabsDetail
    │   ├── Radiology Card → RadiologyDetail
    │   └── Treatment Card → TreatmentDetail
    │
    ├── Notes Rail
    │   └── Timeline of clinical notes
    │
    ├── Additional Cards
    │   ├── Clinical Handover → ClinicalNotesDetail
    │   ├── Discharge Plan → DischargeDetail
    │   └── Follow-Up → FollowUpDetail
    │
    └── ChatAssistantPanel
        ├── Chat message list
        ├── Input area
        └── Action proposals
```

---

## Deployment Architecture

### Development Environment

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LOCAL DEVELOPMENT                                  │
│                                                                              │
│  Frontend (React)                Backend (Express)                           │
│  ┌──────────────────┐           ┌──────────────────┐                        │
│  │ Vite Dev Server  │ ←─────────│ API Server       │                        │
│  │ Port: 5173       │   HTTP/WS  │ Port: 8001       │                        │
│  └──────────────────┘           └────────┬─────────┘                        │
│                                          │                                   │
│                                          ↓                                   │
│                                  ┌───────────────┐                          │
│                              │ Proprietary AI API │                          │
│                                  │ Port: 8000    │                          │
│                                  └───────────────┘                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Production Deployment

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRODUCTION DEPLOYMENT                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                      Frontend (Static Files)                         │    │
│  │              Nginx/CloudFront/S3 + CloudFront                       │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                   Backend API Servers (Node.js)                      │    │
│  │                        PM2 / K8s Cluster                            │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │               Proprietary On-Prem Inference Service                  │    │
│  │                   (Self-hosted / vLLM)                               │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Performance & Scalability

### Optimization Strategies

| Layer | Strategy | Impact |
|-------|----------|--------|
| **LLM Calls** | Prompt caching, Batch processing, Token limit management | Reduce latency by 30-50% |
| **PDF Processing** | Lazy loading, Chunked extraction, Page limit per request | Handle 50+ page PDFs |
| **Data Storage** | JSON file storage, In-memory caching, Document indexing | Sub-100ms retrieval |
| **Frontend** | React Query caching, Lazy component loading, Virtualization | Smooth UI with large data |

### Performance Benchmarks

| Operation | Target | Actual |
|-----------|--------|--------|
| PDF Upload | <2s | ~1s |
| Document Processing | <60s | 30-45s (7-step extraction) |
| Chat Response | <10s | 3-8s |
| Dashboard Load | <1s | ~500ms |
| Chart Note Generation | <30s | 15-25s |

---

## Security & Compliance

### Data Privacy

| Aspect | Implementation |
|--------|----------------|
| **Data at Rest** | File system storage, optional encryption |
| **Data in Transit** | HTTPS/TLS for all API calls |
| **PHI Handling** | No data sent to external APIs (except approved medical sources) |
| **Retention** | Configurable data retention policies |
| **Audit Trail** | All AI operations logged with timestamps |

### Clinical Safety

| Mechanism | Purpose |
|-----------|---------|
| **Citation Tracking** | Every claim sourced to PDF or external reference |
| **Confidence Scoring** | All outputs include confidence levels |
| **Refusal Policy** | System refuses inappropriate medical advice |
| **Hallucination Detection** | Cross-validation against source PDF |
| **Human-in-the-Loop** | Chart notes require clinician review/signature |

---

## Future Roadmap

### Phase 1: Foundation (Complete ✅)
- [x] Multi-agent architecture
- [x] PDF extraction with validation
- [x] Interactive chat assistant
- [x] Chart note generation
- [x] Dashboard UI

### Phase 2: Enhancement (Planned)
- [ ] Multi-document comparison
- [ ] Population analytics
- [ ] Real-time EMR integration
- [ ] Voice input for chat
- [ ] Mobile app

### Phase 3: Advanced AI (Exploratory)
- [ ] Fine-tuned clinical LLM
- [ ] Drug-drug interaction checking
- [ ] Clinical decision support
- [ ] Automated coding suggestions
- [ ] Predictive analytics

---

**Document Version:** 2.0
**Last Updated:** 2026-04-07
**Maintained By:** AI Architecture Team
