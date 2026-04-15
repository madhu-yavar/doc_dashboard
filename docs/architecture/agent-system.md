# Agent System Architecture

## Multi-Agent Clinical Intelligence System

**Project:** Doctor Dashboard
**Version:** 2.0.0
**Last Updated:** 2026-04-15

---

> Note
> This document reflects the current agent design, but some path references below used an older `doctor_dashboard/` folder prefix. The current repository paths are rooted directly at `agents/`, `skills/`, `tools/`, and `server/`.

## Overview

The Doctor Dashboard uses a **multi-agent architecture** where each agent specializes in a specific clinical workflow. Agents are built using the **ReAct (Reasoning + Acting) pattern**, which combines explicit reasoning with action execution.

---

## Agent Hierarchy

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                         AI AGENT SYSTEM v2.0                                  ║
║                     Multi-Agent Clinical Intelligence                         ║
╚══════════════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────────────┐
║                           PRIMARY AGENTS                                    ║
║                    (Direct User-Facing Workflows)                           ║
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────┐  ┌─────────────────────────────┐
│   ┌─────────────────────┐   │  │   ┌─────────────────────┐   │
│   │ DischargeExtractor  │   │  │   │ DoctorAssistant     │   │
│   │      Agent          │   │  │   │      Agent          │   │
│   │                     │   │  │   │                     │   │
│   │  PDF → Structured   │   │  │   │  Interactive Q&A    │   │
│   │  Clinical Data      │   │  │   │  with RAG + Safety  │   │
│   └─────────────────────┘   │  │   └─────────────────────┘   │
└─────────────────────────────┘  └─────────────────────────────┘

┌─────────────────────────────┐
│   ┌─────────────────────┐   │
│   │   ChartNoteAgent    │   │
│   │                     │   │
│   │  SOAP Note Gen      │   │
│   │  (ReAct Reasoning)  │   │
│   └─────────────────────┘   │
└─────────────────────────────┘
```

---

## Agent Specifications

### 1. DischargeExtractorAgent

**Purpose:** Transform unstructured PDF discharge summaries into structured clinical data

**File:** `agents/discharge_extractor_agent.cjs`

#### Architecture

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
│   │ 7. PendingItemsExtractor → Pending items (LLM-only)     │   │
│   │ 8. CrossValidator        → Source verification          │   │
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

#### Key Features

| Feature | Description |
|---------|-------------|
| **Progressive Enhancement** | Each skill builds on previous outputs |
| **Error Resilience** | Failed skills don't stop processing |
| **Validation Layer** | Cross-validation against source PDF |
| **Token Optimization** | Configurable chunking for large documents |
| **Provenance Tracking** | All data sourced to specific pages/sections |

#### Output Schema

```json
{
  "success": true,
  "data": {
    "patient": {
      "name": "John Doe",
      "mrn": "123456",
      "age": 54,
      "gender": "Male"
    },
    "vitals": {
      "blood_pressure": { "systolic": 130, "diastolic": 85, "unit": "mmHg" },
      "pulse": { "value": 72, "unit": "bpm" },
      "temperature": { "value": 98.4, "unit": "°F" }
    },
    "diagnosis": {
      "principal": "Acute STEMI",
      "secondary": ["Hypertension", "Type 2 Diabetes"]
    },
    "medications": [
      { "name": "Aspirin", "dose": "100mg", "frequency": "Daily" }
    ],
    "provenance": {
      "sections": {
        "vitals": {
          "status": "verified",
          "sources": [{ "page": 3, "line": 15 }]
        }
      }
    }
  },
  "validation": {
    "fields_needing_review": [],
    "confidence": 0.92
  }
}
```

---

### 2. DoctorAssistantAgent

**Purpose:** Interactive clinical chat with context-aware responses

**File:** `agents/doctor_assistant_agent.cjs`

#### Architecture

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
│   - Await user affirmation                                     │
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

#### Sub-Agents

| Sub-Agent | Purpose |
|-----------|---------|
| `QueryIntentAgent` | Classify user query and determine response strategy |
| `RecordContextAgent` | Search and retrieve relevant internal clinical data |
| `ExternalKnowledgeAgent` | Perform external medical web searches |
| `SafetyGuardAgent` | Validate responses for safety and accuracy |
| `AnswerComposerAgent` | Synthesize final natural language response |
| `ActionRouterAgent` | Generate actionable clinical recommendations |

#### Safety Features

| Feature | Implementation |
|---------|----------------|
| **Refusal Policy** | Declines inappropriate medical advice requests |
| **Hallucination Detection** | Cross-checks LLM outputs against source |
| **Confidence Scoring** | Always provides confidence levels |
| **Source Attribution** | All claims cite their source (internal/external) |

---

### 3. ChartNoteAgent

**Purpose:** Generate clinical SOAP notes from extracted data

**File:** `agents/chart_note_agent.cjs`

#### Architecture

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

#### Output Format

```json
{
  "chart_note": {
    "subjective": {
      "chief_complaint": "Chest pain lasting 4 hours",
      "present_illness": "54M presented with...",
      "patient_perspective": "Patient reports..."
    },
    "objective": {
      "vitals": {
        "blood_pressure": "130/85 mmHg",
        "pulse": "72 bpm",
        "temperature": "98.4°F"
      },
      "physical_exam": "...",
      "labs": "...",
      "risk_scores": "..."
    },
    "assessment": {
      "principal_diagnosis": "Acute STEMI",
      "secondary_diagnoses": ["Hypertension", "Type 2 Diabetes"],
      "clinical_judgment": "..."
    },
    "plan": {
      "medications": [...],
      "activity_restrictions": "...",
      "patient_education": "...",
      "follow_up": "..."
    }
  },
  "citations": [...],
  "metadata": {
    "generated_at": "2026-04-07T10:00:00Z",
    "confidence": 0.92
  }
}
```

---

## Agent Orchestration

### Agent Communication

Agents communicate through a standardized message format:

```javascript
{
  "from": "AgentName",
  "to": "AgentName",
  "action": "execute_skill",
  "payload": { /* skill-specific data */ },
  "context": {
    "documentId": "uuid",
    "sessionId": "uuid",
    "timestamp": "ISO-8601"
  }
}
```

### Agent Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  INITIALIZE │───▶│   EXECUTE   │───▶│   VALIDATE  │───▶│  TERMINATE  │
│             │    │             │    │             │    │             │
│ - Load      │    │ - Run ReAct │    │ - Check     │    │ - Cleanup  │
│   config    │    │   loop      │    │   output    │    │ - Log      │
│ - Setup     │    │ - Call      │    │ - Score     │    │   metrics  │
│   tools     │    │   skills    │    │   conf.     │    │ - Release  │
│ - Connect   │    │ - Track     │    │ - Verify    │    │   resources│
│   LLM       │    │   tokens    │    │   safety    │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

---

## ReAct Pattern Implementation

All agents follow the ReAct (Reasoning + Acting) pattern:

### Thought-Action-Observation Loop

```javascript
// ReAct Implementation Pattern
class Agent {
  async execute(input) {
    let thoughts = [];
    let observations = [];

    // THINK: Reason about the problem
    const thought = await this.think(input);
    thoughts.push(thought);

    // ACT: Decide what action to take
    const action = await this.decideAction(thought);
    const actionName = action.tool;
    const actionInput = action.input;

    // OBSERVE: Execute action and observe result
    const observation = await this.executeTool(actionName, actionInput);
    observations.push(observation);

    // Repeat until done
    while (!this.isDone(thoughts, observations)) {
      // Continue reasoning and acting
    }

    return this.finalAnswer(thoughts, observations);
  }
}
```

---

## Agent Configuration

### Runtime Configuration

The current root server directly reads:

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMMA_URL` | Gemma LLM API endpoint | Required |
| `GEMMA_MODEL` | Model identifier | `google/gemma-4-26B-A4B-it` |
| `USE_GEMINI_FOR_EXTERNAL` | Enable Gemini-backed external lookup | `true` |
| `GEMINI_MODEL` | Gemini model for external lookup | `gemini-2.5-flash` |

Some individual agents and workflows also read optional extractor-specific settings such as `EXTRACTION_PER_DOCUMENT_CONCURRENCY`, `ENABLE_PENDING_ITEMS_EXTRACTION`, and `ENABLE_DOCUMENT_ANALYZER`.

### Agent Wiring

The current repository does not use a standalone `agent_registry.cjs` file. Agents are imported and instantiated directly by the Express server and by other agents as needed. In practice:

- `server/index.cjs` wires the document router, doctor assistant, chart-note generation, and audit flow.
- The document router composes extractor agents based on document type.
- Chat orchestration delegates to sub-agents such as query intent, record context, external knowledge, safety guard, answer composer, and action router.

---

## Monitoring & Observability

### Agent Metrics

Each agent emits the following metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `agent_execution_duration` | Histogram | Total execution time |
| `agent_step_count` | Gauge | Number of ReAct steps |
| `agent_token_usage` | Counter | Total tokens consumed |
| `agent_success_rate` | Gauge | Success/failure ratio |
| `agent_skill_latency` | Histogram | Per-skill execution time |

### Logging Format

```json
{
  "timestamp": "2026-04-07T10:00:00Z",
  "agent": "DischargeExtractorAgent",
  "documentId": "uuid",
  "step": 3,
  "skill": "VitalsExtractorSkill",
  "status": "success",
  "duration_ms": 1500,
  "tokens_used": 450,
  "confidence": 0.92
}
```

---

**Document Version:** 2.0
**Last Updated:** 2026-04-15
