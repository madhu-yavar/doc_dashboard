# Skills Framework Documentation

## Doctor Dashboard - Clinical Intelligence System

**Version:** 2.0.0
**Last Updated:** 2026-04-07

---

## Overview

Skills are **reusable AI capabilities** that can be composed into agents. They follow a standard interface and can be mixed and matched to create specialized agents for different clinical workflows.

---

## Skill Interface

All skills implement the following interface:

```javascript
class Skill {
  constructor(config = {}) {
    this.name = "Skill Name";
    this.version = "1.0.0";
    this.description = "What this skill does";
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

---

## Skill Categories

### 1. Extraction Skills

Extract structured clinical data from unstructured text.

| Skill | Purpose | Output |
|-------|---------|--------|
| `DocumentAnalyzerSkill` | Detect document structure | `{ document_type, sections_identified }` |
| `DemographicsExtractorSkill` | Extract patient info | `{ name, mrn, age, gender, admission_date }` |
| `RiskScoresExtractorSkill` | Extract risk assessments | `{ fall_risk, dvt_risk, ews_score, gcs }` |
| `VitalsExtractorSkill` | Extract vital signs | `{ bp, pulse, temp, spo2, resp_rate }` |
| `FunctionalStatusExtractorSkill` | Extract ADL assessment | `{ functional_status, assistance_needs }` |
| `ClinicalDataExtractorSkill` | Extract diagnoses/meds/labs | `{ diagnosis, medications, lab_results }` |
| `PendingItemsExtractorSkill` | LLM-only pending items extraction | `{ pending_labs, pending_radiology, pending_followups, medication_reconciliation, pending_discharge_items }` |

#### DocumentAnalyzerSkill

**Purpose:** Detect document structure and identify sections

**Prompt Pattern:**
```
Analyze this medical document and identify:
1. Document type (discharge summary, progress note, etc.)
2. Main sections present
3. Section boundaries
4. Data completeness
```

**Output Schema:**
```json
{
  "document_type": "discharge_summary",
  "sections": ["patient_info", "vitals", "diagnosis", ...],
  "completeness": 0.85,
  "confidence": 0.92
}
```

#### DemographicsExtractorSkill

**Purpose:** Extract patient demographic information

**Prompt Pattern:**
```
Extract patient demographics:
- Name, MRN, age, gender
- Date of birth, contact info
- Insurance information
- Emergency contacts
```

**Output Schema:**
```json
{
  "name": "John Doe",
  "mrn": "123456",
  "age": 54,
  "gender": "Male",
  "date_of_birth": "1972-03-15",
  "phone": "(555) 234-5678",
  "insurance": "Blue Cross"
}
```

#### VitalsExtractorSkill

**Purpose:** Extract vital signs with values and units

**Prompt Pattern:**
```
Extract all vital signs:
- Blood pressure (systolic/diastolic)
- Pulse/heart rate
- Temperature
- Respiratory rate
- SpO2
- Pain score
Include units and timestamps if available
```

**Output Schema:**
```json
{
  "blood_pressure": {
    "systolic": 130,
    "diastolic": 85,
    "unit": "mmHg",
    "timestamp": "2026-03-20T10:00:00Z"
  },
  "pulse": {
    "value": 72,
    "unit": "bpm"
  }
}
```

#### PendingItemsExtractorSkill

**Purpose:** LLM-only extraction of pending items from discharge summaries

**Architecture:** Pure LLM-based (no regex patterns)

**File:** `doctor_dashboard/skills/extraction/pending_items_extractor.skill.cjs`

**Prompt Pattern:**
```
Extract PENDING ITEMS using a 7-step process:

STEP 1: Identify sections with pending items
STEP 2: Extract PENDING LABS (tests, expected dates, reasons)
STEP 3: Extract PENDING RADIOLOGY (CT, MRI, X-ray, USG scheduled)
STEP 4: Extract PENDING FOLLOW-UPS (appointments, reviews)
STEP 5: Extract MEDICATION RECONCILIATION STATUS
STEP 6: Extract DISCHARGE PENDING ITEMS
STEP 7: Assess PRIORITY (high/medium/low) for each item

CRITICAL: Use ONLY explicitly stated information. Extract source_section and source_excerpt for provenance.
```

**Output Schema:**
```json
{
  "pending_labs": [
    {
      "test_name": "Lipid Panel",
      "expected_date": "March 21, 2026",
      "reason": "Cardiac risk assessment",
      "priority": "high",
      "source_section": "Residents Notes",
      "source_excerpt": "SEND BLOOD FOR Lipid Panel"
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
      "source_excerpt": "CT Chest scheduled for March 21"
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
      "source_excerpt": "Follow-up with Cardiology, Dr. Smith"
    }
  ],
  "medication_reconciliation": {
    "status": "complete",
    "medication_count": 5,
    "allergy_count": 1,
    "concerns": "",
    "source_section": "Medication List",
    "source_excerpt": "Medications reconciled"
  },
  "pending_discharge_items": [
    {
      "item": "Final lab results review",
      "reason": "Awaiting cardiac enzyme panel",
      "priority": "high",
      "source_section": "Nursing Endorsement",
      "source_excerpt": "Pending: cardiac enzyme panel"
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

**Key Features:**
- **Zero Regex**: Pure semantic understanding via LLM
- **Provenance Tracking**: Each item includes source_section and source_excerpt
- **Priority Classification**: Clinical judgment for high/medium/low priority
- **Graceful Fallback**: Returns empty result on JSON parse failure

**LLM Configuration:**
```javascript
{
  temperature: 0.1,    // Low for consistent extraction
  maxTokens: 3000      // Enough for structured output
}
```

---

### 2. Validation Skills

Validate extracted data against sources and clinical standards.

| Skill | Purpose | Output |
|-------|---------|--------|
| `CrossValidatorSkill` | Source verification with citations | `{ validatedData, citations, validation }` |
| `CrossValidationAgentSkill` | Field-level citation tracking | `{ fieldsNeedingReview, confidence }` |

#### CrossValidatorSkill

**Purpose:** Verify extracted data against source PDF

**Prompt Pattern:**
```
For each extracted field:
1. Verify against original text
2. Locate exact source (page/line)
3. Check for contradictions
4. Assign confidence score
```

**Output Schema:**
```json
{
  "validated_data": { /* verified fields */ },
  "citations": [
    { "field": "blood_pressure", "page": 3, "line": 15, "text": "..." }
  ],
  "validation": {
    "fields_needing_review": ["diagnosis_secondary"],
    "overall_confidence": 0.92
  }
}
```

---

### 3. Generation Skills

Generate clinical content from extracted data.

| Skill | Purpose | Output |
|-------|---------|--------|
| `ChartNoteComposerSkill` | Generate SOAP note content | `{ chart_note, metadata }` |

#### ChartNoteComposerSkill

**Purpose:** Generate clinical SOAP notes with reasoning

**Prompt Pattern:**
```
Generate a SOAP note from this clinical data:

THINK about:
1. Clinical picture - What happened?
2. Key findings - What's important?
3. Assessment - What does it mean?
4. Plan - What should we do?

WRITE in SOAP format:
- Subjective: Patient perspective
- Objective: Data/findings
- Assessment: Clinical judgment
- Plan: Actions/follow-up
```

**Output Schema:**
```json
{
  "chart_note": {
    "subjective": "...",
    "objective": "...",
    "assessment": "...",
    "plan": "..."
  },
  "citations": [...],
  "metadata": {
    "generated_at": "2026-04-07T10:00:00Z",
    "confidence": 0.92
  }
}
```

---

### 4. Presentation Skills

Transform extracted data for UI presentation.

| Skill | Purpose | Output |
|-------|---------|--------|
| `DashboardMapperSkill` | Transform data for UI | `{ dashboard_cards, sample_patient_data }` |
| `SummaryCardBuilderSkill` | Build summary cards | `{ summaryCards: { vitals, diagnosis, ... } }` |
| `NotesRailBuilderSkill` | Build notes timeline | `{ notesRail: [...] }` |

#### DashboardMapperSkill

**Purpose:** Transform extracted data into dashboard format

**Prompt Pattern:**
```
Transform clinical data into dashboard format:
1. Create summary cards with key metrics
2. Determine status (normal/abnormal/critical)
3. Select display metrics
4. Format for UI components
```

**Output Schema:**
```json
{
  "dashboard_cards": {
    "vitals_card": { /* ... */ },
    "diagnosis_card": { /* ... */ },
    "medications_card": { /* ... */ }
  },
  "sample_patient_data": { /* patient header data */ }
}
```

#### SummaryCardBuilderSkill

**Purpose:** Build summary cards for each section

**Output Schema:**
```json
{
  "summaryCards": {
    "vitals": {
      "title": "Vital Signs",
      "icon": "heart",
      "status": "stable",
      "metrics": [
        { "label": "BP", "value": "130/85", "unit": "mmHg", "status": "normal" }
      ]
    }
  }
}
```

---

### 5. Chat Skills

Handle chat interactions and responses.

| Skill | Purpose | Output |
|-------|---------|--------|
| `NoteUpdateSuggesterSkill` | Suggest chart note updates | `{ proposed_updates: [...] }` |
| `AbnormalFlagActionSkill` | Action for abnormal values | `{ proposed_actions: [...] }` |
| `ChatExportBuilderSkill` | Export chat to appendix | `{ chart_note_appendix: string }` |

#### AbnormalFlagActionSkill

**Purpose:** Suggest actions for abnormal values

**Prompt Pattern:**
```
For this abnormal lab value:
1. Assess clinical significance
2. Suggest immediate actions if needed
3. Recommend follow-up
4. Generate alert message
```

**Output Schema:**
```json
{
  "proposed_actions": [
    {
      "type": "alert",
      "priority": "high",
      "title": "Elevated Troponin",
      "description": "Repeat in 2 hours",
      "actions": ["notify_physician", "repeat_lab"]
    }
  ]
}
```

---

## Skill Composition

Skills can be combined into agents for specialized workflows:

### Example: Discharge Extraction Pipeline

```javascript
const skills = [
  new DocumentAnalyzerSkill(),
  new DemographicsExtractorSkill(),
  new RiskScoresExtractorSkill(),
  new VitalsExtractorSkill(),
  new FunctionalStatusExtractorSkill(),
  new ClinicalDataExtractorSkill(),
  new PendingItemsExtractorSkill(),  // LLM-only pending items extraction
  new CrossValidatorSkill()
];

// Execute sequentially
let context = { pdfText, gemmaClient };
const results = {};

for (const skill of skills) {
  const result = await skill.execute(context);
  results[skill.name] = result;
  context = { ...context, ...result.data };
}
```

---

## Skill Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SKILL_TIMEOUT` | Max execution time per skill | `60000` (60s) |
| `SKILL_MAX_RETRIES` | Retry attempts on failure | `2` |
| `SKILL_CACHE_ENABLED` | Enable result caching | `true` |

### Skill Registry

Skills are registered in `doctor_dashboard/skills/skill_registry.cjs`:

```javascript
const SKILL_REGISTRY = {
  // Extraction Skills
  DocumentAnalyzer: { class: DocumentAnalyzerSkill, version: '1.0.0' },
  DemographicsExtractor: { class: DemographicsExtractorSkill, version: '1.0.0' },
  VitalsExtractor: { class: VitalsExtractorSkill, version: '1.0.0' },
  ClinicalDataExtractor: { class: ClinicalDataExtractorSkill, version: '1.0.0' },
  PendingItemsExtractor: { class: PendingItemsExtractorSkill, version: '2.0.0' },  // LLM-only

  // Validation Skills
  CrossValidator: { class: CrossValidatorSkill, version: '1.0.0' },

  // Generation Skills
  ChartNoteComposer: { class: ChartNoteComposerSkill, version: '1.0.0' },

  // Presentation Skills
  DashboardMapper: { class: DashboardMapperSkill, version: '1.0.0' },
  SummaryCardBuilder: { class: SummaryCardBuilderSkill, version: '1.0.0' }
};
```

---

## Skill Development

### Creating a New Skill

1. **Extend the base Skill class:**
```javascript
class MyCustomSkill extends Skill {
  constructor(config = {}) {
    super(config);
    this.name = "MyCustomSkill";
    this.version = "1.0.0";
  }

  async execute(context) {
    // Implementation
    return {
      success: true,
      data: { /* result */ },
      validation: { /* validation info */ },
      usage: { totalTokens: 100, latency: 1000 }
    };
  }
}
```

2. **Register in skill_registry.cjs**

3. **Add to agent configuration if needed**

4. **Write unit tests**

5. **Document prompt patterns**

---

## Skill Best Practices

1. **Single Responsibility:** Each skill should do one thing well
2. **Idempotent:** Same input should produce same output
3. **Error Handling:** Always return success boolean
4. **Citation Tracking:** Include source references
5. **Confidence Scoring:** Always score output confidence
6. **Token Awareness:** Track token usage for optimization

---

**Document Version:** 2.0
**Last Updated:** 2026-04-07
