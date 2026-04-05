# Doctor Assistant Chatbot - Architecture Document

**Project:** Manipal Hospital Doctor Dashboard
**Date:** 2026-04-05
**Version:** 1.0

---

## Table of Contents

1. [Overview](#overview)
2. [Core Principles](#core-principles)
3. [Architecture](#architecture)
4. [Data Sources & Citations](#data-sources--citations)
5. [Tool Calling Strategy](#tool-calling-strategy)
6. [WWW External Knowledge](#www-external-knowledge)
7. [Anti-Hallucination Guardrails](#anti-hallucination-guardrails)
8. [UI/UX Design](#uiux-design)
9. [Technical Stack](#technical-stack)
10. [Implementation Phases](#implementation-phases)

---

## Overview

An AI-powered chatbot assistant embedded in the doctor dashboard that provides:
- Patient context-aware responses
- Drug interaction checking
- Medical guideline retrieval
- External knowledge access (ICD codes, research, etc.)
- Suggested documentation updates
- All with **mandatory citations** to prevent hallucination

---

## Core Principles

| Principle | Implementation |
|-----------|----------------|
| **RAG over LLM** | Answers must come from retrieved documents first |
| **Citation Mandatory** | Every claim must cite source |
| **Refusal Protocol** | "I don't have sufficient information" rather than hallucinating |
| **Confidence Threshold** | Low confidence answers flagged or refused |
| **Medical Scope Only** | Casual chat refused, medical queries only |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DOCTOR DASHBOARD                             │
│  ┌──────────────┐                                            │
│  │  Patient     │         ┌──────────────────────┐           │
│  │  Data View   │         │   🤖 AI Assistant     │           │
│  │              │         │   (collapsible)       │           │
│  │  Vitals      │         │                       │           │
│  │  Labs        │         │  [Ask anything...]    │           │
│  │  Meds        │         │                       │           │
│  │              │         │  📚 Patient Context   │           │
│  │  Chart Note  │         │  🌐 Medical Knowledge │           │
│  │              │         │  ✅ Suggest Actions   │           │
│  └──────────────┘         │  📎 Citations         │           │
│                           └───────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Backend API       │
                    └─────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
    ┌───────────┐        ┌───────────┐       ┌─────────────┐
    │  Patient  │        │   Drug    │       │     WWW     │
    │    RAG    │        │   APIs    │       │  Knowledge  │
    │ (Vector   │        │ (FDA,     │       │  (WHO,      │
    │    DB)    │        │  Drugs)   │       │   PubMed)   │
    └───────────┘        └───────────┘       └─────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                               ▼
                    ┌───────────────────────┐
                    │   Citation Builder    │
                    │   + Confidence Score  │
                    └───────────────────────┘
```

---

## Data Sources & Citations

### Internal Sources

| Source | Data | Citation Format |
|--------|------|-----------------|
| **Patient Records** | EHR, vitals, labs, medications | `[Patient: MH018146883, p.2]` |
| **Chart Notes** | Discharge summaries, progress notes | `[Chart Note: 2025-03-25]` |
| **Lab References** | Normal ranges, reference values | `[Lab Reference: Adult Male]` |
| **Hospital Protocols** | Internal guidelines, formulary | `[Hospital Protocol: Stroke]` |

### External Sources

| Source | API/Method | Use Case | Citation Format |
|--------|------------|----------|-----------------|
| **WHO ICD-11** | `https://id.who.int` | Diagnosis codes | `[WHO ICD-11: Code]` |
| **FDA OpenFDA** | REST API | Drug labels, warnings, recalls | `[FDA: Drug Label]` |
| **Drugs.com** | API | Drug interactions | `[Drugs.com: Interaction]` |
| **PubMed/Medline** | NCBI E-utilities | Medical research | `[PubMed: PMID]` |
| **NICE Guidelines** | Public API | Clinical protocols (UK) | `[NICE: Guideline]` |
| **AHA/ACC** | Public API | Cardiology guidelines | `[AHA: Guideline]` |
| **ClinicalTrials.gov** | REST API | Ongoing trials | `[ClinicalTrials: NCT]` |

---

## Tool Calling Strategy

### Patient Data Tools

```python
tools = [
    {
        "name": "search_patient_records",
        "description": "Search patient EHR for specific data",
        "params": ["patient_id", "query"],
        "citation_required": true,
        "scope": "read_only"
    },
    {
        "name": "get_patient_vitals",
        "description": "Retrieve patient vital signs with trend",
        "params": ["patient_id", "timeframe"],
        "citation_required": true,
        "scope": "read_only"
    },
    {
        "name": "get_patient_medications",
        "description": "Get current medications with dosing",
        "params": ["patient_id"],
        "citation_required": true,
        "scope": "read_only"
    },
    {
        "name": "analyze_trends",
        "description": "Analyze patient vitals/labs trends",
        "params": ["patient_id", "data_type", "timeframe"],
        "citation_required": true,
        "scope": "read_only"
    }
]
```

### Clinical Decision Support Tools

```python
clinical_tools = [
    {
        "name": "check_drug_interactions",
        "description": "Check interactions between medications",
        "params": ["medications"],
        "api": "drugs_com_api",
        "citation_required": true,
        "scope": "read_only"
    },
    {
        "name": "get_medical_guideline",
        "description": "Retrieve clinical practice guidelines",
        "params": ["condition", "topic"],
        "api": "nice_who_api",
        "citation_required": true,
        "scope": "read_only"
    },
    {
        "name": "verify_icd_code",
        "description": "Search and verify ICD-11 diagnosis codes",
        "params": ["query"],
        "api": "who_icd_api",
        "citation_required": true,
        "scope": "read_only"
    },
    {
        "name": "search_medical_literature",
        "description": "Search PubMed for evidence",
        "params": ["query", "max_results"],
        "api": "ncbi_pubmed",
        "citation_required": true,
        "scope": "read_only"
    }
]
```

### Action Tools (With Confirmation)

```python
action_tools = [
    {
        "name": "suggest_note_update",
        "description": "Suggest documentation updates",
        "params": ["patient_id", "suggested_text", "section"],
        "requires_confirmation": true,
        "scope": "suggest_only"
    },
    {
        "name": "flag_abnormal_value",
        "description": "Flag abnormal lab/vital for review",
        "params": ["patient_id", "value_id", "reason"],
        "requires_confirmation": false,
        "scope": "flag_only"
    }
]
```

---

## WWW External Knowledge

### WHO ICD-11 Integration

```
Endpoint: https://id.who.int/icd/release/11/2025-01/mms
Method: GET
Parameters: q (search query)
Response: ICD code, title, description
Citation: [WHO ICD-11: {code}]
```

**Example Request:**
```
GET https://id.who.int/icd/release/11/2025-01/mms?q=thalamo%20capsular%20bleed
```

**Example Response:**
```json
{
  "code": "8B1Z.1",
  "title": "Intracerebral hemorrhage in nontraumatic brain injury",
  "citation": "[WHO ICD-11: 8B1Z.1]"
}
```

### PubMed/Medline Integration

```
Endpoint: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
Methods: esearch, esummary, efetch
Parameters: db (pubmed), term (query), retmax (max results)
Citation: [PubMed: {pmid}]
```

### FDA OpenFDA Integration

```
Endpoint: https://api.fda.gov/drug/label.json
Method: GET
Parameters: search (drug name)
Citation: [FDA: Drug Label {date}]
```

### ClinicalTrials.gov Integration

```
Endpoint: https://clinicaltrials.gov/api/query/full_studies
Method: GET
Parameters: expr (query), min_rnk, max_rnk
Citation: [ClinicalTrials: {nct_id}]
```

---

## Anti-Hallucination Guardrails

### 1. Source-First Response

```
IF relevant documents found:
    response = synthesize_from_sources()
    response.citation = source_reference
    response.confidence = calculate_confidence()
ELSE:
    response = "I don't have sufficient information to answer this."
    response.suggestions = "Try: specific patient data query, or external medical search"
```

### 2. Confidence Scoring

| Confidence | Action |
|------------|--------|
| > 90% | Direct answer with citation |
| 70-90% | Answer with "Based on available information..." |
| < 70% | "I'm not confident. Please verify or provide more context." |
| < 50% | Refuse to answer, suggest alternatives |

### 3. Fact-Check Layer

```python
def verify_claims(response, sources):
    critical_claims = extract_critical_claims(response)
    verified_claims = []

    for claim in critical_claims:
        if claim.type == "drug_dose":
            verify_against_drug_database(claim)
        if claim.type == "diagnosis_code":
            verify_against_icd_database(claim)
        if claim.type == "guideline":
            verify_against_guideline_api(claim)

    return flag_unverified_claims(verified_claims)
```

### 4. Refusal Triggers

| Trigger | Action |
|---------|--------|
| No relevant documents | "I cannot find relevant information in the patient records." |
| Conflicting sources | "There are conflicting sources. Please clarify..." |
| Outside medical scope | "I can only assist with medical questions and patient care." |
| High-risk clinical decision | "This requires clinical judgment. Please consult..." |
| Casual chat | "I'm designed to assist with medical queries only." |

---

## UI/UX Design

### Chat Widget Layout

```
┌─────────────────────────────────────────────────┐
│  Dashboard Content                    ┌─────────┐│
│                                         │   AI    ││
│  ┌──────────────┐                       │  [▼]   ││
│  │  Patient     │                       └─────────┘│
│  │  Data View   │                                  │
│  │              │        ┌──────────────────────────┤
│  │  Vitals      │        │ 🤖 Doctor Assistant     │
│  │  Labs        │        ├──────────────────────────┤
│  │  Meds        │        │ [Ask a question...]      │
│  │              │        ├──────────────────────────┤
│  │  Chart Note  │        │ □ Patient context on     │
│  │              │        │ □ WWW search enabled     │
│  └──────────────┘        ├──────────────────────────┤
│                          │ 💬 Recent questions:     │
│                          │ • Creatinine trend?       │
│                          │ • Drug interactions?      │
│                          ├──────────────────────────┤
│                          │ ⚙️ Settings              │
│                          └──────────────────────────┘
└────────────────────────────────────────────────────┘
```

### Chat Interface States

| State | Description |
|-------|-------------|
| **Collapsed** | Small button in bottom-right corner |
| **Expanded** | Full chat panel with history |
| **Patient Context On** | Shows patient ID, current context |
| **Searching** | Loading indicator with source being queried |
| **Response** | Answer with citations, confidence indicator |

### Citation Display Format

```
Based on the patient's records, the creatinine has increased from 1.1 to 1.4
over the past 3 days [Patient: Labs, p.3]. This may indicate acute kidney
injury and should be monitored.

📚 Sources:
• [Patient: MH018146883, Lab Results: 25-28 Mar 2026]
• [NICE Guidelines: Acute Kidney Injury, 2023]

⚠️ Confidence: 85% | Clinical judgment required
```

---

## Technical Stack

### Frontend
```
React 18+ (already in use)
├─ Vercel AI SDK (for streaming responses)
├─ Tailwind CSS (styling)
├─ Lucide React (icons)
└─ React Query (data fetching)
```

### Backend
```
Python 3.11+ / FastAPI
├─ LangChain (LLM orchestration)
├─ Anthropic Claude API (reasoning)
├─ Pinecone / Weaviate (vector DB)
├─ Redis (message queue, caching)
└─ PostgreSQL (conversation history)
```

### External APIs
```
• WHO ICD-11 API (diagnosis codes)
• FDA OpenFDA (drug information)
• NCBI E-utilities (PubMed)
• NICE Guidelines API
• ClinicalTrials.gov API
• Drugs.com API (interactions)
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Frontend:**
- [ ] Chat widget component (collapsible, right-aligned)
- [ ] Message input and display
- [ ] Patient context indicator
- [ ] Citation display format

**Backend:**
- [ ] FastAPI server setup
- [ ] Claude API integration
- [ ] Patient data RAG pipeline
- [ ] Message history storage

**MVP Features:**
- Patient context questions
- Basic Q&A about patient data
- Citation display

---

### Phase 2: Clinical Tools (Week 2-3)

**Integrations:**
- [ ] WHO ICD-11 API
- [ ] Drug interaction checking
- [ ] Basic guideline retrieval

**Features:**
- [ ] ICD code search and verification
- [ ] Drug interaction alerts
- [ ] Medication safety checks
- [ ] Enhanced citation format

---

### Phase 3: WWW Knowledge (Week 3-4)

**Integrations:**
- [ ] PubMed/Medline search
- [ ] FDA drug label API
- [ ] ClinicalTrials.gov
- [ ] Guideline APIs (NICE, AHA)

**Features:**
- [ ] Medical literature search
- [ ] Latest evidence retrieval
- [ ] Clinical trial matching
- [ ] Recency indicators

---

### Phase 4: Advanced Features (Week 4-5)

**Features:**
- [ ] Trend analysis (vitals, labs)
- [ ] Suggest documentation updates
- [ ] Abnormal value flagging
- [ ] Confirmation workflow for actions

**UI/UX:**
- [ ] Quick actions panel
- [ ] Saved queries
- [ ] Export chat to notes

---

### Phase 5: Safety & Quality (Week 5-6)

**Guardrails:**
- [ ] Confidence scoring
- [ ] Refusal protocol
- [ ] Fact-check layer
- [ ] Rate limiting

**Testing:**
- [ ] Unit tests for all tools
- [ ] Integration tests for APIs
- [ ] Safety validation tests
- [ ] User acceptance testing

---

## Example Interactions

### Example 1: Patient Data Query

```
Doctor: "What's this patient's creatinine trend?"

Bot: Based on the patient's lab results [Patient: MH018146883, Labs]:
• Creatinine: 1.1 mg/dL (25 Mar) → 1.3 mg/dL (27 Mar) → 1.4 mg/dL (28 Mar)
• eGFR: 75 → 68 → 61 mL/min/1.73m²

This shows an upward trend over 3 days. Consider evaluating for:
• Acute kidney injury (per KDIGO criteria)
• Medication nephrotoxicity review
• Volume status assessment

📚 Sources: [Patient Labs: 25-28 Mar 2026], [KDIGO Guidelines: AKI 2024]
⚠️ Confidence: 92% | Clinical correlation required
```

### Example 2: Drug Interaction Check

```
Doctor: "Check if amlodipine interacts with anything the patient is on"

Bot: Found 2 clinically significant interactions:

1. AMLODIPINE + SIMVASTATIN
   • Risk: Increased simvastatin levels → myopathy
   • Recommendation: Limit simvastatin to 20mg/day
   • Source: [Drugs.com: Major Interaction]

2. AMLODIPINE + TELMISARTAN
   • Risk: Additive hypotension
   • Recommendation: Monitor BP, consider dose adjustment
   • Source: [Drugs.com: Moderate Interaction]

📚 Sources: [Drugs.com Interaction Checker], [Current Patient Meds]
✅ Confidence: 98%
```

### Example 3: ICD Code Verification

```
Doctor: "What's the ICD code for thalamo-capsular bleed?"

Bot: ICD-11 Code: **8B1Z.1**

Description: Intracerebral hemorrhage in nontraumatic brain injury

Additional codes to consider:
• 8B1Z.0 - Intracerebral hemorrhage in traumatic brain injury
• 8B1Y - Other specified intracerebral hemorrhage

📚 Source: [WHO ICD-11, accessed 2025-04-05]
✅ Confidence: 100%
```

### Example 4: Literature Search

```
Doctor: "Any recent studies on thalamic bleed recovery?"

Bot: Found 3 relevant studies from 2023-2024:

1. "Functional Outcomes After Thalamic Hemorrhage" (2024)
   PMID: 38214567
   Finding: 67% achieved functional independence at 6 months
   Early rehab associated with better outcomes

2. "Surgical vs Medical Management of Thalamic Bleeds" (2023)
   PMID: 37892345
   Finding: Surgical intervention selected cases only
   Size < 3cm favored medical management

3. "Quality of Life Post-Thalamic Stroke" (2024)
   PMID: 38456789
   Finding: Cognitive deficits common but often improve
   Speech therapy shows benefit

📚 Sources: [PubMed: 38214567], [PubMed: 37892345], [PubMed: 38456789]
⚠️ External literature - Always verify with full text
```

### Example 5: Refusal (Outside Scope)

```
Doctor: "What's the weather like today?"

Bot: I'm designed to assist with medical questions and patient care only.
I can help you with:
• Patient data queries
• Drug interactions and safety
• Medical guidelines and codes
• Literature searches

Is there a medical question I can help with?
```

---

## Security & Compliance

| Aspect | Implementation |
|--------|----------------|
| **Data Privacy** | Patient data never logged externally |
| **HIPAA Compliance** | All data processing in compliant infrastructure |
| **Audit Logging** | All queries and responses logged |
| **Rate Limiting** | Prevent abuse, manage API quotas |
| **Source Validation** | Only authoritative medical domains allowed |
| **Input Sanitization** | All inputs validated and sanitized |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Response time | < 3 seconds for patient data, < 5 for WWW |
| Citation accuracy | > 95% of responses include correct citations |
| User satisfaction | > 80% positive feedback |
| Hallucination rate | < 1% (measured by clinician review) |
| API success rate | > 98% uptime for external tools |

---

## Future Enhancements

- Voice input/output
- Multi-language support
- Integration with hospital EHR systems
- Custom guideline hospital protocols
- ML-based trend prediction
- Mobile app version

---

## Document Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2025-04-05 | Initial architecture document | Claude/Yavar.ai |
