# ReAct-Based Architecture Diagrams

**Version:** 3.0.0
**Last Updated:** 2026-04-27

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           DOCTOR DASHBOARD v3.0                                     │
│                     ReAct-Based Clinical Intelligence System                        │
└─────────────────────────────────────────────────────────────────────────────────────┘

                                    ┌─────────────────┐
                                    │   PDF Upload    │
                                    │   (User Input)  │
                                    └────────┬────────┘
                                             │
                                             ▼
                    ┌──────────────────────────────────────────────────────┐
                    │              DocumentTypeRouter                       │
                    │  ┌────────────────────────────────────────────────┐  │
                    │  │ Route: Rule-based OR Agentic (configurable)    │  │
                    │  └────────────────────────────────────────────────┘  │
                    └───────────────┬──────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌───────────────────────┐   ┌───────────────────────────────────────┐
        │  Rule-Based (Legacy)  │   │  Agentic Classification (NEW v3.0)    │
        │  • Keyword matching   │   │  • DocumentClassifierAgent (ReAct)    │
        │  • Header detection   │   │  • Vision + Text + Handwriting        │
        └───────────┬───────────┘   │  • Think-Act-Observe Loop             │
                    │               │  • 95%+ Confidence                     │
                    │               └───────────────┬───────────────────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    │ documentType
                                    ▼
        ┌───────────────────────────────────────────────────────────────────────┐
        │                       ReActExtractionAgent (NEW v3.0)                  │
        │  ┌─────────────────────────────────────────────────────────────────┐  │
        │  │ THINK: What extraction is needed based on document content?     │  │
        │  │                                                                 │  │
        │  │   if (hasDemographics) → Extract Demographics                  │  │
        │  │   if (hasVitals)       → Extract Vitals                         │  │
        │  │   if (hasMedications)   → Extract Medications                   │  │
        │  │   if (hasRiskScores)    → Extract Risk Scores                   │  │
        │  │                                                                 │  │
        │  └─────────────────────────────────────────────────────────────────┘  │
        │  ┌─────────────────────────────────────────────────────────────────┐  │
        │  │ ACT: Dynamically select and execute skills                      │  │
        │  │                                                                 │  │
        │  │   ┌─────────────────────────────────────────────────────────┐   │  │
        │  │   │              Skill Registry                             │   │  │
        │  │   │  ┌───────────────────────────────────────────────────┐ │   │  │
        │  │   │  │ Required Skills (Always Run)                      │ │   │  │
        │  │   │  │  • DemographicsExtractorSkill                     │ │   │  │
        │  │   │  │  • ClinicalDataExtractorSkill                     │ │   │  │
        │  │   │  └───────────────────────────────────────────────────┘ │   │  │
        │  │   │  ┌───────────────────────────────────────────────────┐ │   │  │
        │  │   │  │ Optional Skills (Conditional)                    │ │   │  │
        │  │   │  │  • VitalsExtractorSkill (if has_vitals)          │ │   │  │
        │  │   │  │  • MedicationsExtractorSkill (if has_medications)│ │   │  │
        │  │   │  │  • RiskScoresExtractorSkill (if has_risk_scores) │ │   │  │
        │  │   │  └───────────────────────────────────────────────────┘ │   │  │
        │  │   │  ┌───────────────────────────────────────────────────┐ │   │  │
        │  │   │  │ Validation Skills (Always Run)                   │ │   │  │
        │  │   │  │  • CrossValidatorSkill                           │ │   │  │
        │  │   │  └───────────────────────────────────────────────────┘ │   │  │
        │  │   └─────────────────────────────────────────────────────────┘   │  │
        │  └─────────────────────────────────────────────────────────────────┘  │
        │  ┌─────────────────────────────────────────────────────────────────┐  │
        │  │ OBSERVE: Skill results, validate, merge                          │  │
        │  │  • Track completed skills                                        │  │
        │  │  • Track skipped skills (with reason)                           │  │
        │  │  • Merge results into structured output                         │  │
        │  └─────────────────────────────────────────────────────────────────┘  │
        └───────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
                            ┌───────────────────────┐
                            │  Structured Clinical  │
                            │  Data (JSON)          │
                            │  • Patient            │
                            │  • Diagnosis          │
                            │  • Medications        │
                            │  • Vitals             │
                            │  • Risk Scores        │
                            └───────────────────────┘
```

## ReAct Loop Detail

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           REACT EXECUTION LOOP                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
  │   INITIALIZE│───▶│     THINK   │───▶│     ACT     │───▶│   OBSERVE   │
  │             │    │             │    │             │    │             │
  │ • Load PDF  │    │ • Analyze   │    │ • Select    │    │ • Execute   │
  │ • Detect    │    │   document  │    │   skills    │    │   skills    │
  │   content   │    │ • Plan      │    │ • Execute   │    │ • Collect   │
  │ • Load      │    │   sequence  │    │   tools     │    │   results   │
  │   skills    │    │             │    │             │    │             │
  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                            │
                                                            ▼
                                                    ┌─────────────┐
                                                    │   COMPLETE  │
                                                    │             │
                                                    │ • Validate  │
                                                    │ • Format    │
                                                    │ • Return    │
                                                    └─────────────┘

─────────────────────────────────────────────────────────────────────────────────────

                        ITERATION 1 (Required Skills)
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ THINK: "Running required skill: patient"                                    │
  │ ACT:   Execute PrescriptionPatientExtractorSkill                           │
  │ OBSERVE: { success: true, data: { name: "...", age: ... } }                │
  └─────────────────────────────────────────────────────────────────────────────┘

                        ITERATION 2 (Required Skills)
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ THINK: "Running required skill: medications"                                │
  │ ACT:   Execute PrescriptionMedicationsExtractorSkill                       │
  │ OBSERVE: { success: true, data: { medications: [...] } }                   │
  └─────────────────────────────────────────────────────────────────────────────┘

                        ITERATION 3 (Optional Skills - Skip)
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ THINK: "Skipping optional skill diagnosis (condition not met: has_diagnosis)"│
  │ ACT:   null                                                                  │
  │ OBSERVE: Skipped                                                            │
  └─────────────────────────────────────────────────────────────────────────────┘

                        ITERATION 4 (Optional Skills - Skip)
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ THINK: "Skipping optional skill doctor (condition not met: has_doctor_info)"│
  │ ACT:   null                                                                  │
  │ OBSERVE: Skipped                                                            │
  └─────────────────────────────────────────────────────────────────────────────┘

                        ITERATION 5 (Validation)
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ THINK: "Running validation: prescription_validation"                         │
  │ ACT:   Execute PrescriptionCrossValidatorSkill                              │
  │ OBSERVE: { success: true, validated: true }                                 │
  └─────────────────────────────────────────────────────────────────────────────┘

                        ITERATION 6 (Complete)
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ THINK: "Extraction complete. Ran 3 skills, skipped 2."                       │
  │ ACT:   null                                                                  │
  │ OBSERVE: Final result assembled                                             │
  └─────────────────────────────────────────────────────────────────────────────┘
```

## Document Classification Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    DOCUMENT CLASSIFIER AGENT (ReAct)                               │
└─────────────────────────────────────────────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────────────────────────────────┐
  │ INPUT: PDF Document                                                            │
  └───────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
  ┌───────────────────────────────────────────────────────────────────────────────┐
  │ STEP 1: Visual Analysis                                                        │
  │   • Convert first page to image                                                │
  │   • Detect layout, forms, headers                                             │
  │   • Identify handwriting regions                                              │
  └───────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
  ┌───────────────────────────────────────────────────────────────────────────────┐
  │ STEP 2: Text Extraction                                                        │
  │   • Extract all text content                                                   │
  │   • Detect keywords (prescription, discharge, lab, etc.)                       │
  │   • Analyze document structure                                                 │
  └───────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
  ┌───────────────────────────────────────────────────────────────────────────────┐
  │ STEP 3: Handwriting Detection                                                   │
  │   • Detect handwritten content                                                 │
  │   • Distinguish printed vs handwritten text                                    │
  │   • Identify doctor's notes section                                           │
  └───────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
  ┌───────────────────────────────────────────────────────────────────────────────┐
  │ STEP 4: LLM Classification (Enhanced Prompt)                                   │
  │   • Combine visual, text, and handwriting analysis                            │
  │   • Apply classification rules                                                │
  │   • Generate confidence score                                                 │
  └───────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
  ┌───────────────────────────────────────────────────────────────────────────────┐
  │ OUTPUT: Classification Result                                                   │
  │   • documentType: "prescription" | "discharge_summary" | "lab_report" | ...   │
  │   • confidence: 0.95 (95%)                                                     │
  │   • reasoning: "OPD form with handwritten doctor inputs"                      │
  │   • toolsUsed: ["convert_first_page", "extract_text", "detect_handwriting"]  │
  └───────────────────────────────────────────────────────────────────────────────┘
```

## Skill Registry Mapping

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           SKILL REGISTRY                                           │
│                    (Central Configuration for Document Types)                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│ DOCUMENT TYPE: prescription                                                         │
│ Description: Prescription with medications and doctor notes                        │
└─────────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ REQUIRED SKILLS (Always Execute)                                              │
  │  ┌───────────────────────────────────────────────────────────────────────┐  │
  │  │ PrescriptionPatientExtractorSkill    → Patient demographics           │  │
  │  │ PrescriptionMedicationsExtractorSkill  → Medications list             │  │
  │  └───────────────────────────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ OPTIONAL SKILLS (Conditional Execution)                                      │
  │  ┌───────────────────────────────────────────────────────────────────────┐  │
  │  │ PrescriptionDiagnosisExtractorSkill  → IF has_diagnosis               │  │
  │  │ PrescriptionDoctorExtractorSkill      → IF has_doctor_info            │  │
  │  └───────────────────────────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ VALIDATION SKILLS (Always Execute)                                           │
  │  ┌───────────────────────────────────────────────────────────────────────┐  │
  │  │ PrescriptionCrossValidatorSkill       → Cross-validate results        │  │
  │  └───────────────────────────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ CONFIGURATION                                                                  │
  │  • useVisionModel: true     (Use Qwen/Gemma Vision)                           │
  │  • extractHandwriting: true  (Enable handwriting extraction)                  │
  └─────────────────────────────────────────────────────────────────────────────┘

─────────────────────────────────────────────────────────────────────────────────────

┌─────────────────────────────────────────────────────────────────────────────────────┐
│ DOCUMENT TYPE: discharge_summary                                                    │
│ Description: Inpatient discharge summary with risk assessments                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

  [Similar structure with different skills: demographics, clinical_data, risk_scores, 
   vitals, functional_status, pending_items, cross_validation]
```

## Adding New Document Types

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    HOW TO ADD A NEW DOCUMENT TYPE                                   │
└─────────────────────────────────────────────────────────────────────────────────────┘

STEP 1: Create Skills (if needed)
──────────────────────────────────────────────────────────────────────────────────────
  // skills/extraction/new_doc_type_extractor.skill.cjs
  class NewDocTypeExtractorSkill {
    async execute(context) {
      // Extraction logic
      return { success: true, data: { /* extracted data */ } };
    }
  }
  module.exports = NewDocTypeExtractorSkill;

STEP 2: Import Skill
──────────────────────────────────────────────────────────────────────────────────────
  // agents/core/skill_registry.cjs
  const NewDocTypeExtractorSkill = require("../../skills/extraction/new_doc_type_extractor.skill.cjs");

STEP 3: Register Document Type
──────────────────────────────────────────────────────────────────────────────────────
  // In DOCUMENT_TYPE_SKILLS object
  new_doc_type: {
    category: "clinical",
    description: "Description of new document type",
    required: [
      { skill: DemographicsExtractorSkill, name: "demographics" },
      { skill: NewDocTypeExtractorSkill, name: "specific_field" },
    ],
    optional: [
      { skill: OptionalSkill, name: "optional_field", condition: "has_condition" },
    ],
    validation: [
      { skill: CrossValidatorSkill, name: "cross_validation" },
    ],
    config: {
      // Document-specific configuration
    }
  }

STEP 4: That's It!
──────────────────────────────────────────────────────────────────────────────────────
  The ReActExtractionAgent will automatically:
  • Recognize the new document type from the classifier
  • Load the appropriate skills from the registry
  • Execute required skills
  • Conditionally execute optional skills
  • Run validation
  • Return structured results
```
