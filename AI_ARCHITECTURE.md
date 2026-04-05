# AI Architecture Document
## Doctor Dashboard - Clinical Intelligence System

**Project:** Manipal CoE Healthcare Reporting System
**Version:** 2.0.0
**Date:** 2026-04-05
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
│  │  Gemma LLM API   │  │  Storage Layer   │  │  External Search │         │
│  │  (Google 4-26B)  │  │  (File System)   │  │  (Medical Web)   │         │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core AI Components

### 1. Language Model Foundation

**Primary LLM: Google Gemma 4-26B-A4B-it**

| Configuration | Value | Purpose |
|---------------|-------|---------|
| Model | `google/gemma-4-26B-A4B-it` | Main inference engine |
| Context Window | ~24K tokens | Large document processing |
| Temperature | 0.1-0.4 (task-dependent) | Balancing creativity vs accuracy |
| Timeout | 60-180s per step | Preventing hanging requests |
| API Endpoint | Configurable `GEMMA_URL` | Deployment flexibility |

**Why Gemma 4-26B?**
- Clinical understanding without GPT-4 costs
- Self-hosted for data privacy
- Good balance of capability vs latency
- Instruction-tuned for reasoning tasks

---

## Agent Architecture

The system uses a **multi-agent architecture** with specialized agents for different clinical workflows:

### Agent Hierarchy

```
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                         AI AGENT SYSTEM v2.0                                           ║
║                     Multi-Agent Clinical Intelligence Architecture                    ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────────────────────┐
║                                                                                     ║
║  ┌─────────────────────────────────────────────────────────────────────────────┐   ║
║  │                           PRIMARY AGENTS                                    │   ║
║  │                    (Direct User-Facing Workflows)                           │   ║
║  └─────────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                     ║
║  ┌─────────────────────────────┐  ┌─────────────────────────────┐                 ║
║  │   ┌─────────────────────┐   │  │   ┌─────────────────────┐   │                 ║
║  │   │ DischargeExtractor  │   │  │   │ DoctorAssistant     │   │                 ║
║  │   │      Agent          │   │  │   │      Agent          │   │                 ║
║  │   │                     │   │  │   │                     │   │                 ║
║  │   │  PDF → Structured   │   │  │   │  Interactive Q&A    │   │                 ║
║  │   │  Clinical Data      │   │  │   │  with RAG + Safety  │   │                 ║
║  │   │                     │   │  │   │                     │   │                 ║
║  │   │  ┌───┐ ┌───┐ ┌───┐  │   │  │   │  ┌───┐ ┌───┐ ┌───┐  │   │                 ║
║  │   │  │PDF│→│LLM│→│JSON│ │   │  │   │  │QRY│→│RAG│→│ANS│  │   │                 ║
║  │   │  └───┘ └───┘ └───┘  │   │  │   │  └───┘ └───┘ └───┘  │   │                 ║
║  │   └─────────────────────┘   │  │   └─────────────────────┘   │                 ║
║  └─────────────────────────────┘  └─────────────────────────────┘                 ║
║                                                                                     ║
║  ┌─────────────────────────────┐                                                       ║
║  │   ┌─────────────────────┐   │                                                       ║
║  │   │   ChartNoteAgent    │   │                                                       ║
║  │   │                     │   │                                                       ║
║  │   │  SOAP Note Gen      │   │                                                       ║
║  │   │  (ReAct Reasoning)  │   │                                                       ║
║  │   │                     │   │                                                       ║
║  │   │  ┌───┐┌───┐┌───┐┌───┐│   │                                                       ║
║  │   │  │S  ││O  ││A  ││P  ││   │                                                       ║
║  │   │  │UBJ││BJ ││SS ││LAN││   │                                                       ║
║  │   │  └───┘└───┘└───┘└───┘│   │                                                       ║
║  │   └─────────────────────┘   │                                                       ║
║  └─────────────────────────────┘                                                       ║
║                                    ↓                                                ║
║  ┌─────────────────────────────────────────────────────────────────────────────┐   ║
║  │                           DOCTOR ASSISTANT                                  │   ║
║  │                              SUB-AGENTS                                     │   ║
║  │                                                                              │   ║
║  │   User Query ──────────────────────────────────────────────────────────┐   │   ║
║  │                                                                         │   │   ║
║  │   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │   │   ║
║  │   │ QueryIntent      │───→│ RecordContext    │───→│ ExternalKnowledge│  │   │   ║
║  │   │ Agent            │    │ Agent            │    │ Agent            │  │   │   ║
║  │   │                  │    │                  │    │                  │  │   │   ║
║  │   │ • Classify       │    │ • Search PDF     │    │ • Medical Web   │  │   │   ║
║  │   │ • Detect intent  │    │ • Section hints  │    │ • Rank sources   │  │   │   ║
║  │   │ • Clarify        │    │ • Relevance      │    │ • Normalize      │  │   │   ║
║  │   └──────────────────┘    └──────────────────┘    └──────────────────┘  │   │   ║
║  │           │                        │                        │          │   │   ║
║  │           └────────────────────────┼────────────────────────┘          │   │   ║
║  │                                    ↓                                    │   │   ║
║  │   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │   │   ║
║  │   │ SafetyGuard      │←───│ AnswerComposer   │←───│ ActionRouter     │  │   │   ║
║  │   │ Agent            │    │ Agent            │    │ Agent            │  │   │   ║
║  │   │                  │    │                  │    │                  │  │   │   ║
║  │   │ • Hallucination  │    │ • Synthesize     │    │ • Suggest        │  │   │   ║
║  │   │ • Refusal policy │    │ • Format         │    │ • Proposals      │  │   │   ║
║  │   │ • Confidence     │    │ • Citations      │    │                  │  │   │   ║
║  │   └──────────────────┘    └──────────────────┘    └──────────────────┘  │   │   ║
║  │                                    ↓                                    │   │   ║
║  │                        ┌─────────────────────┐                         │   │   ║
║  │                        │ SessionMemory Agent│                         │   │   ║
║  │                        │ (Conversation State)│                         │   │   ║
║  │                        └─────────────────────┘                         │   │   ║
║  └─────────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                     ║
║  ┌─────────────────────────────────────────────────────────────────────────────┐   ║
║  │                              SKILLS LAYER                                   │   ║
║  │                                                                              │   ║
║  │   ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐               ║
║  │   │   Extraction    │ │    Validation   │ │    Generation   │               ║
║  │   │     (6)         │ │      (2)        │ │      (1)        │               ║
║  │   │                 │ │                 │ │                 │               ║
║  │   │ • Document      │ │ • Cross         │ │ • Chart Note    │               ║
║  │   │ • Demographics  │ │   Validation    │ │   Composer      │               ║
║  │   │ • Vitals        │ │ • Citation       │ │                 │               ║
║  │   │ • Risks         │ │   Tracker       │ │                 │               ║
║  │   │ • Clinical      │ │                 │ │                 │               ║
║  │   │ • Functional    │ │                 │ │                 │               ║
║  │   └─────────────────┘ └─────────────────┘ └─────────────────┘               ║
║  │                                                                              │   ║
║  │   ┌─────────────────┐ ┌─────────────────┐                                   ║
║  │   │   Presentation  │ │      Chat       │                                   ║
║  │   │      (3)        │ │      (3)        │                                   ║
║  │   │                 │ │                 │                                   ║
║  │   │ • Dashboard     │ │ • Note Update    │                                   ║
║  │   │   Mapper        │ │ • Abnormal Flag  │                                   ║
║  │   │ • Summary Cards │ │ • Export Builder │                                   ║
║  │   │ • Notes Rail    │ │                 │                                   ║
║  │   └─────────────────┘ └─────────────────┘                                   ║
║  └─────────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                     ║
║  ┌─────────────────────────────────────────────────────────────────────────────┐   ║
║  │                              TOOLS LAYER                                    │   ║
║  │                                                                              │   ║
║  │   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               ║
║  │   │  PDF    │ │   LLM   │ │Clinical │ │Present'n│ │  Chat   │               ║
║  │   │ (1)     │ │  (3)    │ │  (2)    │ │  (4)    │ │  (13)   │               ║
║  │   │         │ │         │ │         │ │         │ │         │               ║
║  │   │ Reader  │ │ Gemma   │ │Vitals   │ │Cards    │ │Query    │               ║
║  │   │         │ │ Prompt  │ │Proven-  │ │Status   │ │Citation │               ║
║  │   │         │ │ Builder │ │ ance    │ │Notes    │ │Web      │               ║
║  │   │         │ │Tracker  │ │         │ │Timeline │ │Search   │               ║
║  │   └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘               ║
║  └─────────────────────────────────────────────────────────────────────────────┘   ║
║                                    ↓                                                ║
║  ┌─────────────────────────────────────────────────────────────────────────────┐   ║
║  │                          EXTERNAL SERVICES                                  │   ║
║  │                                                                              │   ║
║  │   ┌────────────────────┐      ┌────────────────────┐                        ║
║  │   │  Gemma 4-26B-A4B   │      │   File System      │                        ║
║  │   │  (Self-Hosted)     │      │   (PDF Storage)     │                        ║
║  │   └────────────────────┘      └────────────────────┘                        ║
║  │                                                                              │   ║
║  │   ┌────────────────────┐      ┌────────────────────┐                        ║
║  │   │ Medical Web Search │      │   Storage Layer    │                        ║
║  │   │ (UpToDate, etc.)   │      │ (Sessions, Cache)  │                        ║
║  │   └────────────────────┘      └────────────────────┘                        ║
║  └─────────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                     ║
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
║                              DATA FLOW SUMMARY                                    ║
└─────────────────────────────────────────────────────────────────────────────────────┘

  User Uploads PDF
          ↓
  ┌─────────────────┐
  │ Discharge       │
  │ Extractor Agent │ ◄───────┐
  └────────┬────────┘         │
           │                  │
           ↓                  │
  ┌─────────────────┐         │
  │ Structured      │         │
  │ Clinical Data   │─────────┤
  └────────┬────────┘         │
           │                  │
           ↓                  │
  ┌─────────────────┐         │
  │ Dashboard       │         │
  │ Display         │         │
  └────────┬────────┘         │
           │                  │
           ↓                  │
  ┌─────────────────┐         │
  │ User Queries    │         │
  │ Dashboard       │         │
  └────────┬────────┘         │
           │                  │
           ↓                  │
  ┌─────────────────┐         │
  │ Doctor          │         │
  │ Assistant Agent │         │
  └────────┬────────┘         │
           │                  │
           ↓                  │
  ┌─────────────────┐         │
  │ Response +      │         │
  │ Actions         │─────────┘
  └─────────────────┘
```

---

### Agent 1: DischargeExtractorAgent

**Purpose:** Transform unstructured PDF discharge summaries into structured clinical data

**Pattern:** ReAct (Reasoning + Acting) with Sequential Skill Execution

**Workflow:**

```
PDF Input
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: PDF Reader Tool                                         │
│   - Extract text content                                        │
│   - Page segmentation                                           │
│   - Character count validation                                  │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2-N: Sequential Skill Execution                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ Skill Chain:                                            │   │
│   │ 1. DocumentAnalyzer     → Document structure detection │   │
│   │ 2. DemographicsExtractor → Patient demographics         │   │
│   │ 3. RiskScoresExtractor  → Fall/DVT/Pressure ulcer risks │   │
│   │ 4. VitalsExtractor       → Vital signs extraction       │   │
│   │ 5. FunctionalStatusExtractor → ADL assessment           │   │
│   │ 6. ClinicalDataExtractor → Diagnoses, meds, labs        │   │
│   │ 7. CrossValidator        → Source verification          │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Final: Data Assembly & Validation                              │
│   - Merge all skill outputs                                    │
│   - Conflict resolution                                        │
│   - Confidence scoring                                         │
│   - Provenance tracking                                        │
└─────────────────────────────────────────────────────────────────┘
    ↓
Structured JSON Output
```

**Key Features:**
- **Progressive Enhancement:** Each skill builds on previous outputs
- **Error Resilience:** Failed skills don't stop processing
- **Validation Layer:** Cross-validation against source PDF
- **Token Optimization:** Configurable chunking for large documents

---

### Agent 2: DoctorAssistantAgent

**Purpose:** Interactive clinical chat with context-aware responses

**Pattern:** Multi-Agent Orchestration with Safety Layers

**Workflow:**

```
User Query
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ QueryIntentAgent                                                │
│   - Classify query type (vitals/diagnosis/meds/etc.)            │
│   - Detect clarification needs                                 │
│   - Identify external search requirements                      │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Consent Check (if external search needed)                      │
│   - Prompt user for consent                                    │
│   - Awaiting user affirmation                                   │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ RecordContextAgent (Internal Evidence)                         │
│   - Search extracted clinical data                             │
│   - Section-specific retrieval                                 │
│   - Relevance scoring                                          │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ ExternalKnowledgeAgent (if consented)                          │
│   - Medical web search (approved sources)                      │
│   - Result normalization                                       │
│   - Citation formatting                                        │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ SafetyGuardAgent                                                │
│   - Hallucination detection                                    │
│   - Medical advice safety checks                               │
│   - Confidence scoring                                         │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ AnswerComposerAgent                                             │
│   - Synthesize internal + external evidence                    │
│   - Generate natural language response                         │
│   - Attach citations                                           │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ ActionRouterAgent                                               │
│   - Suggest clinical actions                                   │
│   - Generate action proposals                                  │
│   - Format for UI display                                       │
└─────────────────────────────────────────────────────────────────┘
    ↓
Response with Citations + Action Proposals
```

**Safety Features:**
- **Refusal Policy:** Declines inappropriate medical advice requests
- **Hallucination Detection:** Cross-checks LLM outputs against source
- **Confidence Scoring:** Always provides confidence levels
- **Source Attribution:** All claims cite their source (internal/external)

---

### Agent 3: ChartNoteAgent

**Purpose:** Generate clinical SOAP notes from extracted data

**Pattern:** ReAct with Explicit Reasoning Steps

**Workflow:**

```
Extracted Data + PDF Source
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Clinical Picture Analysis (THINK)                      │
│   - Primary reason for admission                               │
│   - Key clinical events                                        │
│   - Current condition at discharge                             │
│   - Data complexity assessment                                 │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: SOAP Structure Planning (THINK)                        │
│   - Determine required SUBJ elements                           │
│   - Determine required OBJ elements                            │
│   - Determine required ASSESSMENT elements                     │
│   - Determine required PLAN elements                           │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Subjective Generation (THINK + WRITE)                  │
│   - Chief complaint                                            │
│   - Present illness narrative                                  │
│   - Patient's perspective                                      │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Objective Generation (THINK + WRITE)                   │
│   - Vital signs with values                                    │
│   - Physical exam findings                                     │
│   - Abnormal labs with ranges                                  │
│   - Risk assessment scores                                     │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Assessment Generation (THINK + WRITE)                  │
│   - Principal diagnosis with reasoning                         │
│   - Secondary diagnoses                                        │
│   - Clinical judgment                                          │
│   - Response to treatment                                      │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Plan Generation (THINK + WRITE)                        │
│   - Discharge medications                                      │
│   - Activity restrictions                                      │
│   - Patient education                                          │
│   - Follow-up arrangements                                     │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 7: Review & Refine (THINK)                                │
│   - Quality assessment                                         │
│   - Missing element detection                                  │
│   - Clinical accuracy review                                   │
└─────────────────────────────────────────────────────────────────┘
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

Skills are **reusable AI capabilities** that can be composed into agents. They follow a standard interface:

### Skill Interface

```javascript
class Skill {
  constructor(config = {}) {
    this.name = "Skill Name";
    this.version = "1.0.0";
  }

  async execute(context) {
    // context: { pdfText, gemmaClient, promptBuilder, ... }
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

## Tools & Utilities

Tools are **lower-level utilities** used by skills and agents:

### Tool Categories

#### 1. Data Access Tools

| Tool | Purpose |
|------|---------|
| `PDFReaderTool` | Extract text from PDF files |
| `GemmaClientTool` | Interface to Gemma LLM API |
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
│                         REAL-TIME PROGRESS (SSE)                            │
│  GET /api/documents/process/progress?documentId={id}                        │
│                                                                              │
│  Server-Sent Events:                                                        │
│    - { type: 'start', pdfName, totalSteps }                                 │
│    - { type: 'step', step, stepNumber, status, data }                       │
│    - { type: 'complete', latency, tokensUsed, confidence }                  │
│    - { type: 'error', error }                                               │
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
│                                                                              │
│  Response format: {                                                         │
│    answer: string,                                                          │
│    citations: [{ value, source, page, confidence }],                        │
│    confidence: 85,                                                          │
│    confidence_label: "high",                                                │
│    source_class: "internal",                                                │
│    refused: false,                                                          │
│    proposed_actions: [{ id, type, title, description }]                     │
│  }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SESSION STORAGE                                     │
│  ChatSession stored in storage/chat_sessions.json:                         │
│    {                                                                         │
│      chatId: UUID,                                                          │
│      documentId: UUID,                                                      │
│      messages: [{ id, role, content, citations, createdAt }],                │
│      confirmedActions: [{ id, title, confirmedAt }],                        │
│      pendingExternalConsent: { message, classification, createdAt },         │
│      createdAt: ISO timestamp,                                              │
│      updatedAt: ISO timestamp                                               │
│    }                                                                        │
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

### Data Transformation

```typescript
// Backend → Frontend data mapping
transformProcessedDocument(processedDocument): DashboardPatientData {
  return {
    patient: {
      name: extractedData.patient.name,
      age: extractedData.patient.age,
      mrn: extractedData.patient.mrn,
      // ...
    },
    vitals: {
      latest: {
        bloodPressure: { systolic, diastolic },
        heartRate: { value, unit },
        // ...
      },
      trend: "stable",
      // ...
    },
    // ... other sections
    provenance: {
      sections: {
        vitals: { status: "verified", sources: [...] },
        diagnosis: { status: "needs_review", sources: [...] },
        // ...
      }
    }
  };
}
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
│                                  │ Gemma LLM API │                          │
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
│  │                         Load Balancer                               │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                      Frontend (Static Files)                         │    │
│  │              Nginx/CloudFront/S3 + CloudFront                       │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                   Backend API Servers (Node.js)                      │    │
│  │                        PM2 / K8s Cluster                            │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │ Instance 1   │  │ Instance 2   │  │ Instance 3   │              │    │
│  │  │ Port: 8001   │  │ Port: 8001   │  │ Port: 8001   │              │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                       Storage Layer                                  │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                        │    │
│  │  │ File Storage     │  │ JSON Collections  │                        │    │
│  │  │ (PDF uploads)    │  │ (documents,       │                        │    │
│  │  │ /storage/uploads │  │  sessions, etc.)  │                        │    │
│  │  └──────────────────┘  └──────────────────┘                        │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                      Gemma LLM Service                               │    │
│  │                   (Self-hosted / vLLM)                               │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Performance & Scalability

### Optimization Strategies

| Layer | Strategy | Impact |
|-------|----------|--------|
| **LLM Calls** | - Prompt caching<br>- Batch processing<br>- Token limit management | Reduce latency by 30-50% |
| **PDF Processing** | - Lazy loading<br>- Chunked extraction<br>- Page limit per request | Handle 50+ page PDFs |
| **Data Storage** | - JSON file storage<br>- In-memory caching<br>- Document indexing | Sub-100ms retrieval |
| **Frontend** | - React Query caching<br>- Lazy component loading<br>- Virtualization for long lists | Smooth UI even with large data |

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

## Appendix

### File Structure

```
doctor_dashboard/
├── server/
│   └── index.cjs                 # Main API server
├── agents/                       # AI Agents
│   ├── discharge_extractor_agent.cjs
│   ├── doctor_assistant_agent.cjs
│   ├── chart_note_agent.cjs
│   └── [sub-agents...]
├── skills/                       # Reusable Skills
│   ├── extraction/
│   ├── validation/
│   ├── generation/
│   ├── presentation/
│   └── chat/
├── tools/                        # Utility Tools
│   ├── pdf/
│   ├── llm/
│   ├── clinical/
│   ├── presentation/
│   └── chat/
├── storage/                      # Data Storage
│   ├── uploads/                  # PDF files
│   ├── documents.json            # Processed documents
│   ├── chat_sessions.json        # Chat history
│   └── [...]
└── src/                          # Frontend (React)
    ├── components/
    │   └── dashboard/
    ├── pages/
    └── lib/
```

### API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/agent/status` | GET | Agent system status |
| `/api/documents` | GET | List all documents |
| `/api/documents/:id` | GET | Get single document |
| `/api/documents/upload` | POST | Upload PDF(s) |
| `/api/documents/process` | POST | Process documents |
| `/api/documents/process/progress` | GET | SSE progress stream |
| `/api/documents/:id` | DELETE | Delete document |
| `/api/chat/query` | POST | Chat query |
| `/api/chat/history/:documentId` | GET | Chat history |
| `/api/chat/history/:documentId` | DELETE | Clear chat |
| `/api/chat/action/confirm` | POST | Confirm action |
| `/api/chat/export/:documentId` | POST | Export chat |
| `/api/documents/:id/chart-note` | GET | Get chart note |
| `/api/documents/:id/chart-note` | POST | Generate chart note |
| `/api/documents/:id/chart-note/pdf` | POST | Export chart note PDF |

---

**Document Version:** 1.0
**Last Updated:** 2026-04-05
**Maintained By:** AI Architecture Team
