# Prescription Handwritten Notes Extraction Plan

## Purpose
This document defines the correction plan for **Stage 3 handwritten note extraction** in the prescription pipeline.

The immediate goal is to fix two recurring failure modes:
- **missing important handwritten note content**
- **hallucinated or over-summarized note content**

This plan is intentionally limited to the **prescription Stage 3 notes path**. It does not redesign the full prescription pipeline.

## Problem Statement
Today, prescription handwritten notes are not treated as a first-class extraction target.

Instead, they are extracted indirectly as part of the **diagnosis extractor** and then passed through later stages as generic `clinical_notes`.

That creates four problems:
1. important handwritten narrative is dropped because it looks like orders, follow-up, or mixed context
2. diagnosis extraction is overloaded and can invent concise summaries instead of preserving literal handwritten content
3. extracted notes have no meaningful grounding/provenance at the note level
4. valid extracted notes are later filtered or overshadowed by synthetic notes in the dashboard

## Current Logic

### Current extraction path
1. `HandwritingDiagnosisExtractorSkill`
   - file: [skills/extraction/stage3/handwriting_diagnosis_extractor.skill.cjs](/Users/yavar/Documents/CoE/Manipal/skills/extraction/stage3/handwriting_diagnosis_extractor.skill.cjs:1)
   - extracts:
     - `principal_diagnosis`
     - `secondary_diagnoses`
     - `symptoms`
     - `clinical_notes`

2. `HandwritingOrdersExtractorSkill`
   - file: [skills/extraction/stage3/handwriting_orders_extractor.skill.cjs](/Users/yavar/Documents/CoE/Manipal/skills/extraction/stage3/handwriting_orders_extractor.skill.cjs:1)
   - aggressively extracts labs, radiology, nuclear medicine, and procedures
   - ambiguous handwritten content may get routed away from notes

3. `HandwritingExtractionAgent`
   - file: [agents/extraction/handwriting_extraction_agent.cjs](/Users/yavar/Documents/CoE/Manipal/agents/extraction/handwriting_extraction_agent.cjs:1)
   - runs diagnosis extraction on **all pages together**
   - compiles notes directly into `stage3Data.diagnosis.clinical_notes`

4. `DataIntegrationAgent`
   - file: [agents/extraction/data_integration_agent.cjs](/Users/yavar/Documents/CoE/Manipal/agents/extraction/data_integration_agent.cjs:1)
   - converts those strings into dashboard `clinical_notes`
   - also injects synthetic notes such as doctor and diagnosis summary notes

5. presentation layers
   - `PrescriptionSummaryGeneratorSkill`
   - `NotesRailBuilderSkill`
   - `NoteSelectorTool`
   - these further compress, filter, and rank the note set

## Root Cause Analysis

### Root cause 1: notes are not their own extraction task
The diagnosis extractor is doing two jobs:
- diagnosis interpretation
- handwritten note extraction

These are not the same task.

Diagnosis extraction naturally pushes the model toward **clinical summarization**, while note extraction should favor **literal, faithful capture** of handwritten content.

### Root cause 2: all-page note extraction causes context contamination
Diagnosis/notes extraction currently runs over all pages together.

That increases the chance that the model will:
- merge separate lines into a synthetic summary
- infer diagnoses not explicitly written
- mix orders, vitals, and narrative together

### Root cause 3: no grounding at note level
Extracted note strings do not retain:
- source line
- source page
- source snippet
- whether the note is literal vs inferred

Without that, downstream stages cannot distinguish:
- correct note extraction
- paraphrase
- hallucination

### Root cause 4: synthetic notes can overshadow real notes
The integration layer adds synthetic notes:
- prescribing doctor
- diagnosis summary

Those are useful, but they can crowd or outrank the handwritten narrative in the notes rail and summaries.

## Target Behavior
The corrected notes path should behave like this:

1. handwritten prescription notes are extracted by a **dedicated notes extractor**
2. extraction is **page-aware**, preferably page-by-page
3. notes preserve the handwritten wording as closely as possible
4. each extracted note carries provenance and confidence metadata
5. diagnosis, orders, and notes are separate responsibilities
6. downstream UI can distinguish:
   - literal extracted note
   - inferred/normalized note
   - synthetic system-generated note

## Proposed Architecture Change

### New Stage 3 skill
Add a dedicated skill:
- `skills/extraction/stage3/handwriting_notes_extractor.skill.cjs`

Responsibilities:
- extract handwritten clinical narrative from prescription pages
- preserve note-level phrasing
- exclude medication lines, vitals, and header PHI
- exclude clearly structured lab/radiology/procedure orders
- return note-level metadata

Suggested output contract:

```json
{
  "notes": [
    {
      "text": "literal handwritten content",
      "category": "clinical_note|follow_up|advice|finding|unclear_note",
      "page_number": 1,
      "confidence": "high|medium|low",
      "is_inferred": false,
      "confidence_reason": "",
      "source_excerpt": "raw or near-raw source text"
    }
  ],
  "has_notes": true,
  "confidence": "high|medium|low"
}
```

### Narrow the diagnosis extractor
Update:
- [skills/extraction/stage3/handwriting_diagnosis_extractor.skill.cjs](/Users/yavar/Documents/CoE/Manipal/skills/extraction/stage3/handwriting_diagnosis_extractor.skill.cjs:1)

New responsibility:
- diagnosis only
- symptoms only
- no generic `clinical_notes` capture

This removes the current overlap and reduces summarization pressure.

### Keep orders separate
Keep:
- [skills/extraction/stage3/handwriting_orders_extractor.skill.cjs](/Users/yavar/Documents/CoE/Manipal/skills/extraction/stage3/handwriting_orders_extractor.skill.cjs:1)

But tighten boundaries so borderline note lines are not over-captured as orders.

This is not a full orders rewrite in this phase, but the new notes extractor must have a clean contract boundary with it.

## Detailed Change Plan

### Phase 1: Extraction split
Files:
- `skills/extraction/stage3/handwriting_notes_extractor.skill.cjs`
- [skills/extraction/stage3/handwriting_diagnosis_extractor.skill.cjs](/Users/yavar/Documents/CoE/Manipal/skills/extraction/stage3/handwriting_diagnosis_extractor.skill.cjs:1)
- [agents/extraction/handwriting_extraction_agent.cjs](/Users/yavar/Documents/CoE/Manipal/agents/extraction/handwriting_extraction_agent.cjs:1)

Changes:
- create dedicated notes extractor
- remove `clinical_notes` ownership from diagnosis extractor
- add notes extraction as a distinct Stage 3 step
- compile Stage 3 output into:
  - `diagnosis`
  - `notes`
  - `orders`

### Phase 2: Page-aware note extraction
File:
- [agents/extraction/handwriting_extraction_agent.cjs](/Users/yavar/Documents/CoE/Manipal/agents/extraction/handwriting_extraction_agent.cjs:1)

Changes:
- run notes extraction page-by-page, similar to the medication per-page logic
- merge notes after extraction
- dedupe near-identical note lines conservatively

Important:
- do not invent a new generic page-classifier subsystem
- just run per-page and merge

### Phase 3: Provenance and confidence
Files:
- `skills/extraction/stage3/handwriting_notes_extractor.skill.cjs`
- [agents/extraction/handwriting_extraction_agent.cjs](/Users/yavar/Documents/CoE/Manipal/agents/extraction/handwriting_extraction_agent.cjs:1)
- [agents/extraction/data_integration_agent.cjs](/Users/yavar/Documents/CoE/Manipal/agents/extraction/data_integration_agent.cjs:1)

Changes:
- retain per-note:
  - `page_number`
  - `confidence`
  - `is_inferred`
  - `confidence_reason`
  - `source_excerpt`
- propagate these into dashboard-format `clinical_notes`

### Phase 4: Synthetic note separation
File:
- [agents/extraction/data_integration_agent.cjs](/Users/yavar/Documents/CoE/Manipal/agents/extraction/data_integration_agent.cjs:1)

Changes:
- preserve handwritten notes as a distinct source category
- keep doctor/diagnosis synthetic notes if needed, but mark them clearly:
  - `is_synthetic: true`
  - `source_type: "synthetic"`
- do not mix synthetic notes with handwritten notes invisibly

### Phase 5: Presentation alignment
Files:
- [skills/presentation/prescription_summary_generator.skill.cjs](/Users/yavar/Documents/CoE/Manipal/skills/presentation/prescription_summary_generator.skill.cjs:1)
- [skills/presentation/notes_rail_builder.skill.cjs](/Users/yavar/Documents/CoE/Manipal/skills/presentation/notes_rail_builder.skill.cjs:1)
- [tools/presentation/note_selector.tool.cjs](/Users/yavar/Documents/CoE/Manipal/tools/presentation/note_selector.tool.cjs:1)

Changes:
- prefer real handwritten notes over synthetic summary notes in the rail
- allow more transparent note selection
- avoid filtering out short but important note items
- distinguish “literal extracted note” from “summary note”

## Prompt Design Requirements For New Notes Extractor
The notes extractor prompt should:
- prioritize literal note capture over summarization
- preserve abbreviations where readable
- mark uncertain lines rather than rewriting them confidently
- exclude:
  - medications
  - vitals
  - PHI header text
  - clearly structured orders
- allow categories such as:
  - `clinical_note`
  - `follow_up`
  - `advice`
  - `finding`
  - `unclear_note`

The prompt should explicitly tell the model:
- do not infer a diagnosis if not written
- do not convert fragmented handwriting into polished prose
- if a line is only partly readable, keep the readable part and mark low confidence

## Testing Plan

### Unit / regression tests
Add tests for:
- dedicated notes extraction contract
- page-by-page note merge
- note provenance propagation
- no note loss when order extraction also runs
- synthetic notes remain distinguishable from handwritten notes

Suggested test files:
- `src/test/prescription-stage3-notes.test.ts`
- extend [src/test/processed-documents.test.ts](/Users/yavar/Documents/CoE/Manipal/src/test/processed-documents.test.ts:1)

### Behavioral validation set
Use a prescription set that includes:
- handwritten findings
- follow-up instructions
- short doctor advice lines
- mixed note + orders pages
- multi-page prescriptions
- noisy handwriting

### Validation questions
QA should check:
- are important handwritten notes preserved?
- are order lines missing from notes for the right reason?
- are note summaries hallucinated or literal?
- are low-confidence notes marked clearly?
- do handwritten notes survive through to dashboard notes and notes rail?

## Acceptance Criteria
The change is acceptable when:
- handwritten prescription notes are extracted by a dedicated notes path
- diagnosis extraction no longer owns generic `clinical_notes`
- note extraction is page-aware
- each note has provenance/confidence metadata
- note hallucinations are reduced by using literal extraction rules
- important note content no longer disappears just because it resembles orders or follow-up
- dashboard notes can distinguish real handwritten notes from synthetic notes

## Explicit Non-Goals
This phase does **not**:
- redesign the entire prescription pipeline
- redesign medication extraction
- redesign orders extraction end-to-end
- add a generic document-layout intelligence framework
- solve every dashboard presentation issue unrelated to notes

## Recommended Implementation Order
1. add dedicated handwritten notes extractor
2. narrow diagnosis extractor
3. wire page-by-page notes extraction into Stage 3
4. propagate note provenance into Stage 4
5. separate synthetic notes from handwritten notes
6. adjust notes rail selection rules
7. benchmark and QA validate on broader prescription samples

## Review Decision Needed
Before implementation, confirm:
- `clinical_notes` should move out of diagnosis extractor completely
- note output should prefer literal extraction over polished summaries
- note provenance fields are acceptable additions to the prescription dashboard contract
