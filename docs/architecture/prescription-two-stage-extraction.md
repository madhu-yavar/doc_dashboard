# Two-Stage Prescription Extraction Pipeline

## Planning Document

**Project:** Doctor Dashboard - Prescription Extraction Enhancement
**Version:** 1.1.0
**Status:** Planning - Requirements Clarified
**Created:** 2026-04-28
**Last Updated:** 2026-04-28

---

## Executive Summary

This document outlines the architecture for a **two-stage prescription extraction pipeline** that leverages the strengths of multiple AI models:

- **Stage 1 (Gemma 4-31B)**: Extract structured header data (printed text) including patient demographics, hospital/doctor info, and document structure
- **Stage 2 (PHI Masking)**: Mask all personally identifiable information after populating to database
- **Stage 3 (Gemini Vision)**: Extract handwritten content including medications, vitals, diagnosis, symptoms, clinical notes, lab selections (ticks, circles)
- **Stage 4 (Dashboard Integration)**: Populate extracted data into relevant dashboard areas

The pipeline will be implemented using **LangGraph** with independent agents for each stage.

---

## Confirmed Architecture

### Model Assignment by Document Type

| Document Type | Classification | Extraction | Validation | Notes |
|---------------|----------------|------------|------------|-------|
| **Prescription** | Gemma 4-31B | Gemma 4-31B (Stage 1) + Gemini 2.5 Flash (Stage 3) | Gemma-based | Two-stage pipeline; Gemini requires user API key |
| **Inpatient (Discharge Summary)** | Gemma 4-31B | Gemma 4-31B only | Gemma-based | Single-model pipeline |
| **OPD (Outpatient)** | Gemma 4-31B | Gemma 4-31B only | Gemma-based | Single-model pipeline |
| **Lab Report** | Gemma 4-31B | Gemma 4-31B only | Gemma-based | Single-model pipeline |
| **Chart Note** | Gemma 4-31B | Gemma 4-31B only | Gemma-based | Single-model pipeline |

### Key Architecture Decisions

1. **Prescription** is the **only** document type using the two-stage (Gemma + Gemini) approach
2. **Inpatient/OPD** use **Gemma only** for both classification and extraction
3. **Validation** remains Gemma-based (PDF text cross-validation)
4. **Gemini API key** is user-provided at runtime (not stored in environment)

---

## Current State Analysis

### Existing Components

| Component | Location | Purpose | Status |
|-----------|----------|---------|--------|
| `DocumentTypeRouter` | `agents/document_type_router.cjs` | Routes documents to appropriate extractors | ✅ Active |
| `PrescriptionReactExtractorAgent` | `agents/prescription_react_extractor_agent.cjs` | Gemma-based prescription extraction | ✅ Active |
| `PhiMaskerTool` | `tools/image/phi_masker.tool.cjs` | PHI masking with coordinate detection | ✅ Exists |
| `GemmaVisionClientTool` | `tools/llm/gemma_vision_client.tool.cjs` | Gemma multimodal client | ✅ Exists |
| `GeminiVisionClientTool` | `tools/llm/gemini_vision_client.tool.cjs` | Gemini multimodal client | ✅ Exists |
| Test: Two-stage masking | `test-two-stage-with-masking.cjs` | Proof of concept for masking pipeline | ✅ Working |

### Model Evaluation Results

Based on the model evaluation memory ([`model_evaluation_gemma4_31b.md`](../memory/model_evaluation_gemma4_31b.md)):

| Model | Strengths | Weaknesses |
|-------|-----------|------------|
| **Gemma 4-31B** | ✅ Patient demographics, ✅ Diagnosis, ✅ Doctor info | ❌ Medication extraction (critical gap) |
| **Gemini 2.5 Flash** | ✅ Handwriting recognition, ✅ Visual elements (ticks, circles) | Higher latency, external API |

### Key Decision: Two-Stage Approach

**Why split the extraction?**

1. **Gemma excels at printed text extraction** - Fast and accurate for headers, demographics, structured fields
2. **Gemini excels at handwriting and visual elements** - Better recognition of handwritten medications, ticks, circles in lab sections
3. **PHI privacy compliance** - Masking before sending to external API (Gemini)
4. **Cost optimization** - Use internal Gemma for bulk of work, external Gemini only for complex handwriting
5. **Reliability** - If Gemini fails, Gemma-extracted headers are already saved

---

## Architecture Overview

### LangGraph Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    TWO-STAGE PRESCRIPTION EXTRACTION PIPELINE                    │
│                              (LangGraph Implementation)                          │
└─────────────────────────────────────────────────────────────────────────────────┘

                                    ┌─────────────────┐
                                    │  PDF Document   │
                                    │  (Prescription) │
                                    └────────┬────────┘
                                             │
                                             ▼
                            ┌──────────────────────────────────────┐
                            │   Document Classifier Agent          │
                            │   (Existing: DocumentClassifierAgent)│
                            │   - Verify document type             │
                            │   - Detect handwriting presence      │
                            └─────────────────┬────────────────────┘
                                              │
                            ┌─────────────────▼────────────────────┐
                            │   Stage 1: Gemma Header Extraction   │
                            │   Agent: PrescriptionHeaderAgent     │
                            │                                       │
                            │   Input: Original PDF Image           │
                            │   Model: Gemma 4-31B Vision           │
                            │                                       │
                            │   Extract:                            │
                            │   • Patient demographics              │
                            │   • Hospital/doctor info              │
                            │   • Visit metadata                    │
                            │   • Document structure analysis       │
                            └─────────────────┬────────────────────┘
                                              │
                                              ▼
                            ┌──────────────────────────────────────┐
                            │   PHI Data extracted & validated     │
                            └─────────────────┬────────────────────┘
                                              │
                             ┌────────────────▼─────────────────────┐
                             │   Stage 2: PHI Masking Agent        │
                             │   Agent: PhiMaskingAgent            │
                             │                                     │
                             │   Input: Original PDF + PHI coords  │
                             │   Tool: PhiMaskerTool               │
                             │                                     │
                             │   Output:                           │
                             │   • Masked image base64              │
                             │   • PHI data saved to DB             │
                             └─────────────────┬───────────────────┘
                                               │
                                               ▼
                            ┌──────────────────────────────────────┐
                            │   Safe data for Stage 3              │
                            │   • Masked image (no PHI)            │
                            │   • Header metadata (from Stage 1)   │
                            └─────────────────┬────────────────────┘
                                              │
                             ┌────────────────▼─────────────────────┐
                             │   Stage 3: Gemini Handwriting Agent │
                             │   Agent: HandwritingExtractionAgent  │
                             │                                     │
                             │   Input: Masked PDF Image            │
                             │   Model: Gemini 2.5 Flash            │
                             │                                     │
                             │   Extract:                           │
                             │   • Medications (handwritten)        │
                             │   • Vitals                           │
                             │   • Diagnosis                        │
                             │   • Symptoms                         │
                             │   • Clinical notes                   │
                             │   • Lab selections (ticks/circles)    │
                             └─────────────────┬───────────────────┘
                                               │
                                               ▼
                            ┌──────────────────────────────────────┐
                            │   Stage 4: Data Integration Agent    │
                            │   Agent: DashboardIntegrationAgent   │
                            │                                     │
                            │   Merge Stage 1 + Stage 3 data       │
                            │   Validate & transform to schema     │
                            │   Populate to dashboard              │
                            └─────────────────┬────────────────────┘
                                              │
                                              ▼
                            ┌──────────────────────────────────────┐
                            │   Complete Prescription Data         │
                            │   Ready for Dashboard Display        │
                            └──────────────────────────────────────┘
```

---

## Stage Specifications

### Stage 1: Gemma Header Extraction Agent

**Agent Name:** `PrescriptionHeaderAgent`

**Purpose:** Extract all printed/structured text content from prescription documents

**Model:** Gemma 4-31B Vision (`google/gemma-4-31B-it`)

**Input:**
- Original PDF file path
- Page images (base64)

**Extraction Schema:**

```javascript
{
  // Patient Demographics
  patient: {
    name: string | null,
    mrn: string | null,
    age: string | null,
    gender: string | null,
    contact: string | null,
    address: string | null
  },

  // Hospital Information
  hospital: {
    name: string | null,
    department: string | null,
    address: string | null,
    logo_detected: boolean
  },

  // Doctor Information
  doctor: {
    name: string | null,
    registration_number: string | null,
    signature_present: boolean,
    specialization: string | null
  },

  // Visit Metadata
  visit: {
    date: string | null,           // Prescription date
    time: string | null,
    episode_number: string | null, // Visit/episode ID
    opd_ipd: string | null         // OPD number or IPD number
  },

  // Document Structure
  document_structure: {
    page_count: number,
    has_prescription_table: boolean,
    has_vitals_section: boolean,
    has_lab_investigations: boolean,
    has_radiology_section: boolean,
    prescription_table_location: { page: number, region: string },
    lab_selections_region: { page: number, bbox: object }
  },

  // Header regions (for masking)
  phi_regions: [
    {
      type: "patient_name" | "patient_id" | "doctor_name" | "date" | "hospital_name",
      bounding_box: { x: number, y: number, width: number, height: number },
      page: number
    }
  ]
}
```

**Skills Required:**
- `PatientDemographicsExtractorSkill` - Extract patient info
- `HospitalInfoExtractorSkill` - Extract hospital details
- `DoctorInfoExtractorSkill` - Extract doctor details
- `VisitMetadataExtractorSkill` - Extract visit date/episode
- `DocumentStructureAnalyzerSkill` - Analyze document layout

---

### Stage 2: PHI Masking Agent

**Agent Name:** `PhiMaskingAgent`

**Purpose:** Mask all PHI regions and save extracted data to database

**Tool:** `PhiMaskerTool` (already exists in `tools/image/phi_masker.tool.cjs`)

**Input:**
- Original PDF images
- PHI regions from Stage 1

**Process:**

```javascript
{
  // 1. Receive Stage 1 data
  stage1_data: {
    patient: {...},
    phi_regions: [...]
  },

  // 2. Mask PHI regions
  masking_process: {
    tool: "PhiMaskerTool",
    method: "sharp",           // Use sharp library for masking
    output: "masked_base64",   // Return base64 of masked image
    keep_hospital_name: true   // Optional: keep hospital for context
  },

  // 3. Save to database
  database_save: {
    collection: "prescriptions_stage1",
    data: {
      patient_demographics: stage1_data.patient,
      extracted_at: timestamp,
      document_id: uuid
    }
  },

  // 4. Output for Stage 3
  output: {
    masked_image: base64_string,
    safe_metadata: {
      hospital_name: string,    // Non-PHI metadata
      department: string,
      document_structure: object
    }
  }
}
```

**Masking Configuration:**

| PHI Type | Mask? | Reason |
|---------|-------|--------|
| Patient name | ✅ Yes | Direct identifier |
| Patient ID/MRN | ✅ Yes | Direct identifier |
| Patient age/gender | ✅ Yes | Quasi-identifier |
| Patient contact/address | ✅ Yes | Direct identifier |
| Doctor name | ✅ Yes | Potential identifier |
| Visit date | ✅ Yes | Combined with other data identifies patient |
| Episode/visit number | ✅ Yes | Direct identifier |
| Hospital name | ⚠️ Optional | May keep for clinical context |

---

### Stage 3: Gemini Handwriting Extraction Agent

**Agent Name:** `HandwritingExtractionAgent`

**Purpose:** Extract handwritten content and visual elements (ticks, circles) from masked prescription

**Model:** Gemini 2.5 Flash (`gemini-2.5-flash`)

**Input:**
- Masked PDF images (no PHI visible)
- Document structure from Stage 1

**Extraction Schema:**

```javascript
{
  // Medications (handwritten)
  medications: [
    {
      name: string,
      generic_name: string | null,
      dosage: string,              // e.g., "500mg"
      form: string,                // tablet, syrup, injection
      frequency: string,           // OD, BD, TDS, QID, or written
      duration: string,            // e.g., "5 days"
      route: string,               // oral, IV, IM
      instructions: string,
      is_handwritten: true
    }
  ],

  // Vitals (handwritten)
  vitals: {
    blood_pressure: { systolic: number, diastolic: number },
    pulse: { value: number, unit: "bpm" },
    temperature: { value: number, unit: "°F" },
    weight: { value: number, unit: "kg" },
    spo2: { value: number, unit: "%" },
    respiratory_rate: { value: number, unit: "/min" }
  },

  // Diagnosis
  diagnosis: {
    principal: string,
    secondary: string[],
    symptoms: string[],
    is_handwritten: boolean
  },

  // Clinical Notes
  clinical_notes: [
    {
      type: "complaint" | "observation" | "instruction",
      content: string,
      is_handwritten: true
    }
  ],

  // Lab Investigations (SELECTED items)
  lab_investigations: {
    selected_tests: [
      {
        test_name: string,
        is_checked: boolean,       // Tick detected
        is_circled: boolean,       // Circle detected
        priority: "routine" | "urgent" | "stat",
        notes: string
      }
    ],
    total_available: number,
    total_selected: number
  },

  // Radiology (SELECTED items)
  radiology: {
    selected_studies: [
      {
        study_name: string,
        is_checked: boolean,
        body_part: string,
        notes: string
      }
    ]
  },

  // Procedures (SELECTED items)
  procedures: {
    selected: [
      {
        procedure_name: string,
        is_checked: boolean,
        notes: string
      }
    ]
  },

  // Handwriting confidence
  extraction_quality: {
    overall_confidence: "high" | "medium" | "low",
    unclear_regions: [
      {
        region: string,
        reason: "poor_handwriting" | "smudged" | "cut_off"
      }
    ]
  }
}
```

**Skills Required:**
- `HandwritingMedicationsExtractorSkill` - Extract handwritten medications
- `HandwritingVitalsExtractorSkill` - Extract vitals values
- `HandwritingDiagnosisExtractorSkill` - Extract diagnosis/symptoms
- `HandwritingClinicalNotesExtractorSkill` - Extract notes
- `VisualElementDetectorSkill` - Detect ticks, circles, checkboxes

---

### Stage 4: Data Integration Agent

**Agent Name:** `DashboardIntegrationAgent`

**Purpose:** Merge Stage 1 and Stage 3 data, validate, transform to dashboard schema

**Input:**
- Stage 1: Header data (PHI)
- Stage 3: Handwriting data (clinical)

**Process:**

```javascript
{
  // 1. Merge data
  merged_data: {
    // From Stage 1 (PHI)
    patient: stage1.patient,
    hospital: stage1.hospital,
    doctor: stage1.doctor,
    visit: stage1.visit,

    // From Stage 3 (Clinical)
    medications: stage3.medications,
    vitals: stage3.vitals,
    diagnosis: stage3.diagnosis,
    clinical_notes: stage3.clinical_notes,
    lab_investigations: stage3.lab_investigations,
    radiology: stage3.radiology,
    procedures: stage3.procedures
  },

  // 2. Validation
  validation: {
    cross_validate: true,
    checks: [
      "medication_count_consistency",
      "patient_info_complete",
      "doctor_info_present",
      "vitals_in_range",
      "diagnosis_matches_medications"
    ],
    confidence_score: number
  },

  // 3. Transform to dashboard format
  dashboard_format: {
    patient_card: {...},
    medications_card: {...},
    diagnosis_card: {...},
    vitals_card: {...},
    labs_card: {...},
    doctor_card: {...}
  }
}
```

---

## LangGraph Implementation

### Graph Structure

```javascript
// File: agents/langgraph/prescription_extraction_graph.cjs

const { StateGraph } = require("@langchain/langgraph");

/**
 * Prescription Extraction LangGraph
 *
 * Nodes:
 * 1. classify - Verify prescription type
 * 2. extract_headers - Gemma header extraction
 * 3. mask_phi - PHI masking
 * 4. save_stage1 - Save to database
 * 5. extract_handwriting - Gemini handwriting extraction
 * 6. integrate - Merge and validate
 * 7. format_dashboard - Transform for dashboard
 *
 * Edges:
 * - Conditional edges based on success/failure
 * - Retry logic for each stage
 */

const prescriptionGraph = new StateGraph({
  channels: {
    // Input
    pdf_path: { reducer: (x, y) => y ?? x },
    document_id: { reducer: (x, y) => y ?? x },

    // Stage 1 output
    header_data: { reducer: (x, y) => y ?? x },
    phi_regions: { reducer: (x, y) => y ?? x },

    // Stage 2 output
    masked_image: { reducer: (x, y) => y ?? x },
    masking_result: { reducer: (x, y) => y ?? x },

    // Stage 3 output
    handwriting_data: { reducer: (x, y) => y ?? x },

    // Final output
    merged_data: { reducer: (x, y) => y ?? x },
    dashboard_format: { reducer: (x, y) => y ?? x },

    // Error tracking
    errors: { reducer: (x, y) => [...(x || []), ...(y || [])] },
    stage: { reducer: (x, y) => y ?? x }
  }
});

// Add nodes
prescriptionGraph.addNode("classify", classifyDocumentNode);
prescriptionGraph.addNode("extract_headers", extractHeadersNode);
prescriptionGraph.addNode("mask_phi", maskPhiNode);
prescriptionGraph.addNode("save_stage1", saveStage1Node);
prescriptionGraph.addNode("extract_handwriting", extractHandwritingNode);
prescriptionGraph.addNode("integrate", integrateDataNode);
prescriptionGraph.addNode("format_dashboard", formatDashboardNode);

// Define edges
prescriptionGraph.setEntryPoint("classify");

prescriptionGraph.addConditionalEdges(
  "classify",
  shouldExtractHeaders,
  {
    extract: "extract_headers",
    skip: "error"
  }
);

prescriptionGraph.addEdge("extract_headers", "mask_phi");
prescriptionGraph.addEdge("mask_phi", "save_stage1");

prescriptionGraph.addConditionalEdges(
  "save_stage1",
  shouldExtractHandwriting,
  {
    extract: "extract_handwriting",
    skip: "integrate"  // Continue if handwriting fails
  }
);

prescriptionGraph.addEdge("extract_handwriting", "integrate");
prescriptionGraph.addEdge("integrate", "format_dashboard");

prescriptionGraph.setEntryPoint("classify");
prescriptionGraph.setFinishPoint("format_dashboard");

module.exports = prescriptionGraph.compile();
```

### Node Implementations

Each node corresponds to an agent:

| Node | Agent | File | Purpose |
|------|-------|------|---------|
| `classify` | DocumentClassifierAgent | `agents/extraction/document_classifier_agent.cjs` | Verify prescription type |
| `extract_headers` | PrescriptionHeaderAgent | `agents/extraction/prescription_header_agent.cjs` | Stage 1: Gemma extraction |
| `mask_phi` | PhiMaskingAgent | `agents/extraction/phi_masking_agent.cjs` | Stage 2: PHI masking |
| `save_stage1` | DatabaseSaveAgent | `agents/persistence/database_save_agent.cjs` | Save header data |
| `extract_handwriting` | HandwritingExtractionAgent | `agents/extraction/handwriting_extraction_agent.cjs` | Stage 3: Gemini extraction |
| `integrate` | DataIntegrationAgent | `agents/extraction/data_integration_agent.cjs` | Merge Stage 1 + 3 |
| `format_dashboard` | DashboardFormatterAgent | `agents/presentation/dashboard_formatter_agent.cjs` | Stage 4: Dashboard format |

---

## Skills Specification

### New Skills to Create

#### Stage 1 Skills (Gemma-Based)

| Skill | File | Purpose |
|-------|------|---------|
| `PatientDemographicsExtractorSkill` | `skills/extraction/stage1/patient_demographics_extractor.skill.cjs` | Extract patient name, ID, age, gender |
| `HospitalInfoExtractorSkill` | `skills/extraction/stage1/hospital_info_extractor.skill.cjs` | Extract hospital name, department |
| `DoctorInfoExtractorSkill` | `skills/extraction/stage1/doctor_info_extractor.skill.cjs` | Extract doctor name, registration |
| `VisitMetadataExtractorSkill` | `skills/extraction/stage1/visit_metadata_extractor.skill.cjs` | Extract visit date, episode number |
| `DocumentStructureAnalyzerSkill` | `skills/extraction/stage1/document_structure_analyzer.skill.cjs` | Analyze layout, detect sections |

#### Stage 3 Skills (Gemini-Based)

| Skill | File | Purpose |
|-------|------|---------|
| `HandwritingMedicationsExtractorSkill` | `skills/extraction/stage3/handwriting_medications_extractor.skill.cjs` | Extract handwritten medications |
| `HandwritingVitalsExtractorSkill` | `skills/extraction/stage3/handwriting_vitals_extractor.skill.cjs` | Extract handwritten vitals |
| `HandwritingDiagnosisExtractorSkill` | `skills/extraction/stage3/handwriting_diagnosis_extractor.skill.cjs` | Extract diagnosis/symptoms |
| `HandwritingClinicalNotesExtractorSkill` | `skills/extraction/stage3/handwriting_clinical_notes_extractor.skill.cjs` | Extract clinical notes |
| `VisualElementDetectorSkill` | `skills/extraction/stage3/visual_element_detector.skill.cjs` | Detect ticks, circles, checkboxes |

---

## Dashboard Integration

### Gap Analysis Required

Before implementing Stage 4, perform gap analysis between:

1. **Current extraction output schema** (from `PrescriptionReactExtractorAgent`)
2. **Dashboard expected schema** (from frontend requirements)

**Analysis Points:**

| Data Point | Stage 1 Source | Stage 3 Source | Dashboard Target | Gap? |
|------------|----------------|----------------|------------------|------|
| Patient name | ✅ Header | ❌ | ✅ Required | - |
| Patient MRN | ✅ Header | ❌ | ✅ Required | - |
| Medications | ❌ | ✅ Handwriting | ✅ Required | - |
| Diagnosis | ✅ Header | ✅ Handwriting | ✅ Required | Merge needed |
| Vitals | ❌ | ✅ Handwriting | ✅ Required | - |
| Doctor info | ✅ Header | ❌ | ✅ Required | - |
| Hospital | ✅ Header | ❌ | Optional | - |
| Lab selections | ❌ | ✅ Visual (ticks) | ✅ Required | - |
| Symptoms | ❌ | ✅ Handwriting | ✅ Required | - |

### Dashboard Format Output

```javascript
{
  // Summary cards (for dashboard overview)
  summary_cards: {
    patient: {
      name: string,
      age: number,
      gender: string,
      mrn: string
    },
    medications_count: number,
    diagnosis: string,
    last_visit: string
  },

  // Detailed sections
  patient_info: {
    demographics: {...},
    contact: {...},
    insurance: {...}
  },

  medications: [
    {
      name: string,
      dosage: string,
      frequency: string,
      duration: string,
      route: string,
      instructions: string,
      source: "handwriting" | "printed",
      confidence: "high" | "medium" | "low"
    }
  ],

  clinical_data: {
    diagnosis: {
      principal: string,
      secondary: string[],
      symptoms: string[]
    },
    vitals: {...},
    notes: [...]
  },

  lab_radiology: {
    lab_tests_selected: [...],
    radiology_ordered: [...],
    procedures: [...]
  },

  doctor_info: {
    name: string,
    registration: string,
    signature_present: boolean
  },

  metadata: {
    document_id: string,
    extraction_method: "two_stage_pipeline",
    extracted_at: string,
    stage1_model: "gemma-4-31b",
    stage3_model: "gemini-2.5-flash",
    confidence_score: number
  }
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)

- [ ] Create LangGraph scaffold
- [ ] Set up project structure for new agents
- [ ] Define state schema for the pipeline
- [ ] Create base agent classes

### Phase 2: Stage 1 Implementation (Week 2)

- [ ] Implement `PrescriptionHeaderAgent`
- [ ] Create Stage 1 skills (patient, hospital, doctor, visit, structure)
- [ ] Test Gemma extraction on sample prescriptions
- [ ] Validate PHI region detection

### Phase 3: Stage 2 Implementation (Week 2)

- [ ] Implement `PhiMaskingAgent`
- [ ] Enhance `PhiMaskerTool` if needed
- [ ] Add database save functionality
- [ ] Test masking quality

### Phase 4: Stage 3 Implementation (Week 3)

- [ ] Implement `HandwritingExtractionAgent`
- [ ] Create Stage 3 skills (medications, vitals, diagnosis, notes, visual)
- [ ] Test Gemini extraction on masked images
- [ ] Validate handwriting recognition quality

### Phase 5: Stage 4 Implementation (Week 4)

- [ ] Perform dashboard gap analysis
- [ ] Implement `DataIntegrationAgent`
- [ ] Implement `DashboardFormatterAgent`
- [ ] Create dashboard transformation logic

### Phase 6: Integration & Testing (Week 4)

- [ ] Integrate all stages in LangGraph
- [ ] End-to-end pipeline testing
- [ ] Error handling and retry logic
- [ ] Performance optimization
- [ ] Documentation

---

## File Structure

```
agents/
├── langgraph/
│   ├── prescription_extraction_graph.cjs      # Main LangGraph definition
│   └── graph_state.cjs                        # State schema
├── extraction/
│   ├── prescription_header_agent.cjs          # Stage 1 agent
│   ├── phi_masking_agent.cjs                  # Stage 2 agent
│   ├── handwriting_extraction_agent.cjs       # Stage 3 agent
│   ├── data_integration_agent.cjs             # Stage 4 agent (merge)
│   └── dashboard_formatter_agent.cjs          # Stage 4 agent (format)
├── persistence/
│   └── database_save_agent.cjs                # Database operations
└── core/
    └── base_agent.cjs                          # Base agent class

skills/
├── extraction/
│   ├── stage1/
│   │   ├── patient_demographics_extractor.skill.cjs
│   │   ├── hospital_info_extractor.skill.cjs
│   │   ├── doctor_info_extractor.skill.cjs
│   │   ├── visit_metadata_extractor.skill.cjs
│   │   └── document_structure_analyzer.skill.cjs
│   └── stage3/
│       ├── handwriting_medications_extractor.skill.cjs
│       ├── handwriting_vitals_extractor.skill.cjs
│       ├── handwriting_diagnosis_extractor.skill.cjs
│       ├── handwriting_clinical_notes_extractor.skill.cjs
│       └── visual_element_detector.skill.cjs

tools/
├── llm/
│   ├── gemma_vision_client.tool.cjs           # Already exists
│   └── gemini_vision_client.tool.cjs          # Already exists
├── image/
│   └── phi_masker.tool.cjs                    # Already exists
└── langgraph/
    └── graph_executor.tool.cjs                # LangGraph execution wrapper

docs/
└── architecture/
    └── prescription-two-stage-extraction.md   # This document
```

---

## Dependencies

### New Dependencies

```json
{
  "@langchain/langgraph": "^0.2.0",
  "@langchain/core": "^0.3.0",
  "sharp": "^0.33.0"  // For image masking
}
```

### Environment Variables

```bash
# Gemma Configuration (Stage 1)
GEMMA_URL=http://206.1.62.28:8000/v1/chat/completions
GEMMA_MODEL=google/gemma-4-31B-it

# Gemini Configuration (Stage 3) - Optional (user-provided)
# GEMINI_API_KEY can also be provided via API at runtime
GEMINI_MODEL=gemini-2.5-flash
GEMINI_API_KEY_URL=https://generativelanguage.googleapis.com  # Or user-provided

# Storage (File-based JSON - existing system)
STORAGE_DIR=./server/storage
DOCUMENTS_PATH=./server/storage/documents.json

# Feature Flags
ENABLE_TWO_STAGE_EXTRACTION=true
ENABLE_PHI_MASKING=true
HANDWRITING_THRESHOLD=15  # Percentage threshold for Stage 3

# Processing
MAX_FILE_SIZE=25MB
TIMEOUT_STAGE1=120000  # 2 minutes
TIMEOUT_STAGE3=180000  # 3 minutes (Gemini may be slower)
```

---

## Gemini API Key Collection

### User-Provided API Key Flow

**Design Decision:** Gemini API key is collected from the user, not stored in environment variables.

**API Endpoints:**

```javascript
// POST /api/documents/process - Accepts optional geminiApiKey
{
  "ids": ["doc-uuid"],
  "geminiApiKey": "AIza..."  // Optional - user's Gemini API key
}

// GET /api/documents/process/progress - Accepts geminiApiKey as query param
// /api/documents/process/progress?documentId=doc-uuid&geminiApiKey=AIza...

// SSE Endpoint sends events:
{
  "type": "stage3_requirement",
  "message": "Gemini API key required for handwriting extraction",
  "show_api_key_input": true
}
```

**UI Flow:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: User uploads prescription PDF                          │
│  → Document queued, starts processing                           │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: Stage 1 (Gemma) extraction completes                  │
│  → Patient, doctor, hospital info extracted                     │
│  → Handwriting detection: 35% handwriting detected             │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 3: Server checks for Gemini API key                       │
│                                                                 │
│  IF geminiApiKey provided:                                      │
│    → Proceed to Stage 3 (Gemini)                                │
│    → Extract medications, vitals, diagnosis, lab selections     │
│                                                                 │
│  IF no geminiApiKey:                                            │
│    → Return partial results with Stage 1 data only              │
│    → Status: "partial"                                          │
│    → Include UI prompt for API key                              │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: User provides API key (if prompted)                    │
│                                                                 │
│  UI shows:                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔐 Gemini API Key Required                              │   │
│  │                                                          │   │
│  │ Header information has been extracted successfully.     │   │
│  │ To extract handwritten medications, vitals, and lab     │   │
│  │ selections, please provide your Gemini API key.         │   │
│  │                                                          │   │
│  │ [API Key Input: AIza...________________________]       │   │
│  │                                                          │   │
│  │ [Cancel]               [Complete Extraction]           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 5: API Call to complete extraction                        │
│                                                                 │
│  POST /api/documents/:id/complete-handwriting                   │
│  {                                                              │
│    "geminiApiKey": "AIza..."                                    │
│  }                                                              │
│                                                                 │
│  → Server processes Stage 3 with provided API key               │
│  → Returns updated document with full data                      │
└─────────────────────────────────────────────────────────────────┘
```

**Server Implementation:**

```javascript
// server/index.cjs - New endpoint

app.post("/api/documents/:id/complete-handwriting", async (req, res) => {
  const { id } = req.params;
  const { geminiApiKey } = req.body;
  
  if (!geminiApiKey) {
    return res.status(400).json({ error: "Gemini API key required" });
  }
  
  const documents = await readDocuments();
  const document = documents.find(item => item.id === id);
  
  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }
  
  // Check if Stage 3 is needed
  if (document.extraction_metadata?.stage3_status !== "pending") {
    return res.status(400).json({ 
      error: "Handwriting extraction already completed or not needed" 
    });
  }
  
  try {
    // Run Stage 3 with user-provided API key
    const stage3Result = await runStage3Extraction({
      document,
      geminiApiKey,
      onProgress: (progress) => {
        // Send SSE events if connected
      }
    });
    
    // Update document with Stage 3 data
    await updateDocument(id, async (doc) => {
      doc.result.stage3 = stage3Result.data;
      doc.result.merged = mergeStage1And3(doc.result.stage1, stage3Result.data);
      doc.result.dashboard_cards = formatForDashboard(doc.result.merged);
      doc.extraction_metadata.stage3_status = "complete";
      doc.status = "processed";
    });
    
    const updated = await readDocuments();
    const updatedDoc = updated.find(d => d.id === id);
    
    res.json({ document: publicDocument(updatedDoc) });
    
  } catch (error) {
    await updateDocument(id, async (doc) => {
      doc.extraction_metadata.stage3_status = "failed";
      doc.extraction_metadata.stage3_error = {
        message: error.message,
        code: "GEMINI_EXTRACTION_FAILED",
        user_action_required: true
      };
    });
    
    res.status(500).json({ 
      error: "Handwriting extraction failed. Please check your API key and try again." 
    });
  }
});
```

**API Key Security:**

```javascript
// API key handling rules:
// 1. Never store user-provided API keys in documents.json
// 2. Never log API keys
// 3. Only use API key for the current request
// 4. Validate API key format before use (starts with "AIza")
// 5. Return generic error if API key is invalid (don't reveal the key)
```

---

## Success Criteria

### Functional Requirements

| Requirement | Success Metric |
|-------------|----------------|
| Header extraction (Stage 1) | >95% accuracy on patient demographics |
| PHI masking (Stage 2) | 100% of detected PHI regions masked |
| Handwriting extraction (Stage 3) | >85% accuracy on medications |
| Lab selections (Stage 3) | >90% accuracy on tick/circle detection |
| End-to-end pipeline | <60 seconds per document |

### Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Error handling | No single point of failure |
| Observability | Full trace logging for each stage |
| Scalability | Process 10+ documents concurrently |
| Data privacy | No PHI sent to external APIs |

---

## Requirements Clarification (Updated 2026-04-28)

### 1. Database Schema for Stage 1 Data Storage

**Current Database Architecture:**
- **Type**: File-based JSON storage (no MongoDB)
- **Location**: `server/storage/documents.json`
- **Schema**: Existing document structure with `result` field containing extracted data

**Stage 1 Data Storage Approach:**

Since the current system uses file-based JSON storage, Stage 1 data will be stored in the existing document structure:

```javascript
// Document structure in server/storage/documents.json
{
  "id": "uuid",
  "name": "prescription.pdf",
  "status": "processing" | "processed" | "partial",
  "filePath": "/path/to/pdf",
  "result": {
    // Stage 1 data (PHI) - saved immediately after extraction
    "stage1": {
      "patient": {
        "name": string,
        "mrn": string,
        "age": string,
        "gender": string
      },
      "hospital": {
        "name": string,
        "department": string
      },
      "doctor": {
        "name": string,
        "registration_number": string
      },
      "visit": {
        "date": string,
        "episode_number": string
      },
      "extracted_at": "ISO-8601 timestamp",
      "phi_regions": [...]  // For masking
    },
    
    // Stage 3 data (handwriting) - added after successful Gemini extraction
    "stage3": {
      "medications": [...],
      "vitals": {...},
      "diagnosis": {...},
      "clinical_notes": [...],
      "lab_investigations": {...},
      "extracted_at": "ISO-8601 timestamp"
    },
    
    // Merged data for dashboard
    "merged": {
      // Combined stage1 + stage3 data
    },
    
    // Dashboard format
    "dashboard_cards": {...},
    "sample_patient_data": {...},
    "presentation": {...}
  },
  
  // Processing metadata
  "extraction_metadata": {
    "pipeline": "two_stage_prescription",
    "stage1_status": "complete" | "partial" | "failed",
    "stage3_status": "pending" | "complete" | "failed",
    "stage3_error": null | string,  // If Gemini failed
    "extracted_at": "ISO-8601 timestamp"
  }
}
```

**Storage Strategy:**
1. Stage 1 data is saved immediately after Gemma extraction (before masking)
2. PHI regions are preserved for masking but not sent to external APIs
3. Stage 3 data is appended after Gemini extraction completes
4. If Stage 3 fails, Stage 1 data remains available for display

---

### 2. Fallback Strategy if Stage 3 (Gemini) Fails

**User Decision:** Show on UI with reason for failure

**Fallback Behavior:**

```javascript
// When Stage 3 (Gemini) fails:
{
  "status": "partial",  // Changed from "processed"
  "result": {
    "stage1": { /* complete */ },
    "stage3": null,
    "merged": {
      // Include Stage 1 data only
      "patient": stage1.patient,
      "hospital": stage1.hospital,
      "doctor": stage1.doctor,
      "visit": stage1.visit,
      // Stage 3 fields are empty/null
      "medications": [],
      "vitals": null,
      "diagnosis": null,
      "clinical_notes": [],
      "lab_investigations": null
    }
  },
  "extraction_metadata": {
    "stage1_status": "complete",
    "stage3_status": "failed",
    "stage3_error": {
      "message": "Gemini API key not provided",
      "code": "GEMINI_API_KEY_MISSING",
      "user_action_required": true,
      "user_action": "Please provide your Gemini API key to extract handwritten content (medications, vitals, diagnosis, lab selections)",
      "ui_display": {
        "title": "Handwriting Extraction Unavailable",
        "description": "Basic header information was extracted successfully. To extract handwritten medications, vitals, and clinical notes, please provide your Gemini API key.",
        "show_api_key_input": true,
        "retry_button": true,
        "details_url": "/help/gemini-setup"
      }
    }
  }
}
```

**UI Display Options:**

1. **Status Badge**: "Partial Extraction" (yellow badge)
2. **Warning Message**: 
   - "Header data extracted. For handwritten content (medications, vitals), please provide Gemini API key."
3. **Retry Button**: "Complete with Gemini" (opens API key modal)
4. **Data Sections**:
   - ✅ Patient Info (available from Stage 1)
   - ✅ Doctor Info (available from Stage 1)
   - ✅ Hospital Info (available from Stage 1)
   - ❌ Medications (needs Gemini) - show "Not available" or "Provide API key"
   - ❌ Vitals (needs Gemini)
   - ❌ Diagnosis (needs Gemini)
   - ❌ Lab Selections (needs Gemini)

---

### 3. Handwriting Threshold Detection

**User Question:** Will Gemini give handwriting percentage?

**Answer:** No, Gemini does not provide handwriting percentage. We need to detect handwriting BEFORE calling Gemini to decide whether Stage 3 is needed.

**Handwriting Detection Approach:**

```javascript
// Use Gemma-based handwriting detection (during Stage 1)
// Create new skill: skills/detection/gemma_handwriting_detector.skill.cjs

// During Stage 1, after Gemma header extraction:
const handwritingDetection = await detectHandwritingWithGemma({
  pdfPath: document.filePath,
  images: pageImages
});

// Returns:
{
  "has_handwriting": boolean,
  "handwriting_percentage": number,  // 0-100
  "handwriting_regions": [
    { "page": 1, "region": "prescription_table", "confidence": 0.95 }
  ]
}

// Decision logic:
if (handwritingDetection.has_handwriting && 
    handwritingDetection.handwriting_percentage > 15) {
  // Proceed to Stage 3 (Gemini)
  // AND user has provided Gemini API key
} else if (handwritingDetection.handwriting_percentage <= 15) {
  // Skip Stage 3 - minimal handwriting
  // Use Gemma-extracted data as complete
  result.extraction_metadata.stage3_status = "skipped";
  result.extraction_metadata.stage3_skip_reason = "minimal_handwriting";
}
```

**Handwriting Detection Timing:**
1. **Stage 0** (Document Classifier): Filename-based handwriting check (for prescriptions)
2. **Stage 1** (After Gemma): Detailed handwriting percentage to decide if Stage 3 is needed
3. **Threshold**: 15% handwriting (configurable via `HANDWRITING_THRESHOLD` env var)

---

### 4. Dashboard API Contract

**User Confirmation:** Yes, exact dashboard API contract needed

**Current Dashboard Format (from `server/index.cjs`):**

```javascript
// Current format returned by /api/documents/process and /api/documents/:id
{
  "documents": [
    {
      "id": "uuid",
      "name": "prescription.pdf",
      "status": "processed",
      "department": "Cardiology",
      "uploadedAt": "ISO-8601",
      "processedAt": "ISO-8601",
      
      // Extraction result
      "result": {
        // Metadata
        "meta": {
          "document_type": "prescription",
          "router": {
            "detected_type": "prescription",
            "has_handwriting": true,
            "handwriting_percentage": 45
          }
        },
        
        // Dashboard cards (UI consumable)
        "dashboard_cards": {
          "vitals_card": {
            "status": "stable",
            "summary": { "latest_bp": "", "pulse": "", "temp": "", "spo2": "" },
            "trend": "stable",
            "data_points": 0,
            "has_alerts": false
          },
          "diagnosis_card": {
            "principal_diagnosis": "Hypertension",
            "icd_code": "",
            "secondary_count": 0,
            "secondary_diagnoses": [],
            "procedures_count": 0
          },
          "medications_card": {
            "active_count": 5,
            "allergy_count": 0,
            "allergies": [],
            "categories": [],
            "medication_list": [
              { "name": "Amlodipine", "dose": "5mg", "frequency": "OD", "route": "Oral" }
            ]
          },
          "labs_card": {
            "total_tests": 0,
            "abnormal_count": 0,
            "critical_count": 0,
            "pending_count": 0,
            "top_abnormal": ""
          },
          "radiology_card": {
            "studies_completed": 0,
            "critical_findings": 0,
            "key_finding": ""
          },
          "treatment_card": {
            "procedures_performed": 0,
            "surgeries": 0,
            "response": "Not applicable for prescriptions",
            "current_approach": "...",
            "management_items": [],
            "complications_count": 0
          },
          "clinical_notes_card": {
            "total_notes": 0,
            "last_update": "ISO-8601",
            "notes": []
          },
          "discharge_plan_card": {
            "condition": "Not applicable",
            "instruction_count": 0,
            "red_flags": 0
          },
          "follow_up_card": {
            "next_appointment": "",
            "appointment_count": 0
          }
        },
        
        // Sample patient data (for quick preview)
        "sample_patient_data": {
          "name": "Patient Name",
          "age": 54,
          "mrn": "123456",
          "admission_date": "2026-04-28",
          "discharge_date": null,
          "los_days": 0,
          "summary": "Prescription document processed..."
        },
        
        // Presentation layer (for UI)
        "presentation": {
          "summary_cards": {
            "medications": {
              "section": "medications",
              "title": "Medications Prescribed",
              "headline_metric": "5",
              "secondary_line": "medications",
              "supporting_points": ["Amlodipine", "Metformin"],
              "status": "normal",
              "provenance_status": "source_backed"
            },
            "diagnosis": { /* ... */ },
            "care_gaps": { /* ... */ }
          },
          "notes_rail": [
            {
              "title": "Prescribing Doctor",
              "author": "Dr. Smith",
              "timestamp": "2026-04-28T10:00:00Z",
              "body": "Prescription signed by Dr. Smith",
              "priority": "normal",
              "category": "doctor"
            }
          ]
        },
        
        // Raw extracted data (for detailed view)
        "extracted_data": {
          "patient": { /* ... */ },
          "doctor": { /* ... */ },
          "medications": [ /* ... */ ],
          "diagnosis": { /* ... */ },
          "vitals": { /* ... */ },
          "clinical_notes": [ /* ... */ ]
        }
      },
      
      // Agent info
      "agentInfo": {
        "name": "Prescription Extractor (Two-Stage)",
        "version": "1.0.0",
        "latency": 45000,
        "tokensUsed": 3500,
        "steps": [...]
      },
      
      // Error (if partial/failed)
      "error": null | string
    }
  ]
}
```

---

### 5. LangGraph vs Custom Orchestrator

**User Decision:** LangGraph only

**Implementation Confirmed:**
- Use `@langchain/langgraph` for pipeline orchestration
- StateGraph for managing extraction stages
- Conditional edges for error handling
- Built-in retry and checkpoint capabilities

**LangGraph Configuration:**

```javascript
// package.json dependencies
{
  "@langchain/langgraph": "^0.2.0",
  "@langchain/core": "^0.3.0"
}
```

**Graph Features to Implement:**
1. **State Management**: Track progress through stages
2. **Conditional Routing**: Skip Stage 3 if no handwriting or no API key
3. **Error Recovery**: Continue to Stage 4 even if Stage 3 fails
4. **Checkpointing**: Save intermediate state for recovery
5. **Observability**: Built-in tracing for each node execution

---

## Requirements Summary Matrix

| Question | Answer | Implementation |
|----------|--------|----------------|
| **1. Database Schema** | File-based JSON (existing system) | Store Stage 1 in `result.stage1`, Stage 3 in `result.stage3` |
| **2. Fallback Strategy** | Show on UI with failure reason | Return partial results with API key prompt UI |
| **3. Handwriting Threshold** | Gemma-based detector (before Gemini) | Create `GemmaHandwritingDetectorSkill`, threshold: 15% |
| **4. Dashboard API Contract** | Confirmed - existing format | Match current `dashboard_cards` + `sample_patient_data` + `presentation` |
| **5. Orchestrator** | LangGraph only | Use `@langchain/langgraph` for pipeline |

---

## Next Steps

1. ✅ Review and approve this planning document
2. ✅ Requirements clarified - database, fallback, threshold, API contract, LangGraph
3. ✅ Qwen references removed from codebase
4. ⏳ Implement LangGraph project structure
5. ⏳ Create GemmaHandwritingDetectorSkill
6. ⏳ Create Stage 1 agent (Gemma header extraction)
7. ⏳ Implement Gemini API key collection UI flow
8. ⏳ Create Stage 3 agent (Gemini handwriting extraction)
9. ⏳ Implement `/api/documents/:id/complete-handwriting` endpoint
10. ⏳ Build UI components for API key prompt
11. ⏳ End-to-end testing with sample prescriptions

---

**Document Status:** Requirements Clarified - Qwen Removed - Ready for Implementation
**Next Review Date:** 2026-05-05
