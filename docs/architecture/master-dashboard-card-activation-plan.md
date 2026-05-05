# Master Dashboard Card Activation Plan

**Project:** Doctor Dashboard  
**Status:** Review Draft  
**Purpose:** Define the execution plan to implement a single master dashboard card model where the correct cards are activated by document classification and irrelevant cards are inactive or hidden.

---

## 1. Objective

The dashboard should behave as a **master clinical dashboard shell** with a **single reusable card model**.

The intended behavior is:

- every processed document uses one shared dashboard contract
- document classification determines which cards are:
  - `active`
  - `inactive`
  - `hidden`
- active cards are populated with extracted data
- inactive cards remain present only if needed for visual consistency
- hidden cards are not rendered for that document type

This applies across:

- `discharge_summary`
- `outpatient_record`
- `prescription`
- `lab_report`
- `chart_note`
- `inpatient_record`

---

## 2. Current State

The current implementation does **not** fully implement classification-driven card activation.

### What Exists Today

1. A shared superset of dashboard cards is created in [dashboard_mapper.skill.cjs](../../skills/clinical/dashboard_mapper.skill.cjs).
2. The mapper always returns the same card set:
   - `vitals_card`
   - `diagnosis_card`
   - `medications_card`
   - `labs_card`
   - `risk_card`
   - `radiology_card`
   - `treatment_card`
   - `clinical_notes_card`
   - `discharge_plan_card`
   - `follow_up_card`
3. The dashboard page renders a mostly fixed grid in [Index.tsx](../../src/pages/Index.tsx).
4. The processed-document transform already contains partial fallback handling for prescription output shape in [processedDocuments.ts](../../src/lib/processedDocuments.ts).

### Evidence in Code

- All cards are always returned in [dashboard_mapper.skill.cjs](../../skills/clinical/dashboard_mapper.skill.cjs:386)
- The summary grid is rendered from a fixed configuration in [Index.tsx](../../src/pages/Index.tsx:613)
- `Discharge Plan`, `Risk Watch`, and `Next Appointment` are also rendered as fixed sections in [Index.tsx](../../src/pages/Index.tsx:650)

---

## 3. Gap Analysis

### Gap 1: No Card Activation Model

There is no explicit concept of:

- card activation by document type
- card visibility by classification
- inactive state for unsupported clinical sections

Current behavior:

- all documents are forced through the same dashboard shape
- unsupported cards are left with empty, zero, or fallback values

Impact:

- prescriptions look like weak discharge dashboards
- lab reports still carry treatment/discharge semantics
- outpatient records inherit irrelevant clinical sections

---

### Gap 2: No Single Source of Truth for Card Relevance

There are currently multiple overlapping layers:

1. extraction output
2. `dashboard_cards`
3. `presentation.summaryCards`
4. `transformProcessedDocument(...)`
5. fixed rendering logic in `Index.tsx`

Current problem:

- the system has a shared card payload, but not a shared activation policy
- card relevance is implied by missing data instead of defined by contract

Impact:

- duplicated assumptions across mapper and UI
- brittle behavior when new document types are added
- easy to create another parallel dashboard model by mistake

---

### Gap 3: Prescription Pipeline Produces More Than the Dashboard Expresses

The 4-stage prescription pipeline produces:

- Stage 1 header/PHI extraction
- Stage 2 masking metadata
- Stage 3 handwriting extraction
- Stage 4 merged clinical output

But the dashboard currently only partially expresses that model.

Missing or weakly represented today:

- stage completion state
- masked-image / handwriting workflow state
- extraction quality / unreadable medication signals
- document-type-specific card relevance

Impact:

- technically richer extraction appears visually incomplete
- users see a populated result but not the right dashboard semantics

---

### Gap 4: Fixed Page Rendering Overrides Document Context

The page renderer uses a fixed layout, especially for:

- discharge plan
- risk watch
- next appointment

Current problem:

- these sections are not conditionally tied to document classification
- a prescription can still surface discharge-oriented sections even when irrelevant

Impact:

- UI does not match business expectation of “master dashboard with correct active cards”

---

## 4. Root Cause

The current system implements a **shared card payload**, but not a **master activation framework**.

In short:

- shared schema exists
- classification exists
- extraction specialization exists
- activation/visibility policy does not exist

That is why the result feels structurally inconsistent even when extraction succeeds.

---

## 5. Target Design

### Target Principle

Keep **one dashboard contract**, not multiple dashboards.

Add **activation metadata** to that existing contract instead of inventing a second schema.

### Proposed Master Model

Each card should have:

- `id`
- `title`
- `status`
- `state`
- `documentTypes`
- `activationReason`
- `data`

### Card State Definitions

- `active`
  - relevant for the classified document type
  - should be populated and rendered normally
- `inactive`
  - part of the master schema
  - not relevant for this document type
  - may be shown as muted/disabled if product wants layout consistency
- `hidden`
  - not rendered for this document type

### Activation Source of Truth

The source of truth should be a single configuration table such as:

- `document type -> card activation policy`

Example:

| Document Type | Active Cards | Inactive/Hidden Cards |
|---|---|---|
| `prescription` | diagnosis, medications, vitals, clinical notes, follow_up | discharge_plan, risk, radiology, pending/discharge-specific cards |
| `lab_report` | labs, diagnosis, vitals | discharge_plan, follow_up, treatment |
| `outpatient_record` | diagnosis, treatment, vitals, clinical notes, follow_up | discharge_plan, risk unless explicitly present |
| `discharge_summary` | all major inpatient/discharge cards | few or none inactive |
| `chart_note` | diagnosis, vitals, treatment, clinical notes | discharge-specific cards conditional |

This table should be implemented once and consumed by both:

- mapper layer
- renderer layer

---

## 6. Execution Plan

### Phase 1: Contract Audit

Goal:

- identify the exact single source of truth for cards

Tasks:

1. inventory all card definitions in:
   - [dashboard_mapper.skill.cjs](../../skills/clinical/dashboard_mapper.skill.cjs)
   - [processedDocuments.ts](../../src/lib/processedDocuments.ts)
   - [Index.tsx](../../src/pages/Index.tsx)
2. map where classification is already available:
   - `result.meta.document_type`
   - `result.meta.router.detected_type`
3. document which cards are:
   - universal
   - document-type-specific
   - currently hard-coded

Deliverable:

- finalized card inventory and activation matrix

---

### Phase 2: Define Master Activation Policy

Goal:

- create one reusable activation configuration

Tasks:

1. define canonical card IDs
2. define allowed states: `active | inactive | hidden`
3. define per-document-type activation rules
4. define fallback rules for mixed/uncertain classification

Deliverable:

- activation config module used everywhere

---

### Phase 3: Update Mapper Layer

Goal:

- emit card state intentionally, not implicitly

Tasks:

1. keep existing `dashboard_cards`
2. extend them with activation metadata
3. prevent irrelevant cards from pretending to be meaningful by default
4. preserve the current prescription root-level fallback already introduced in [processedDocuments.ts](../../src/lib/processedDocuments.ts)

Deliverable:

- `dashboard_cards` with explicit activation state

---

### Phase 4: Update Frontend Transform Layer

Goal:

- normalize master card state into UI-ready data

Tasks:

1. teach `transformProcessedDocument(...)` to read activation state
2. avoid generating fake content for inactive cards
3. preserve correct fallbacks for prescription root-level data
4. keep a single transformed page model

Deliverable:

- transformed dashboard data with card-state awareness

---

### Phase 5: Update Renderer Layer

Goal:

- render based on card state instead of a fixed “always-on” assumption

Tasks:

1. make summary-card rendering conditional on activation state
2. decide product behavior:
   - hide irrelevant cards
   - or show them as muted/inactive
3. remove hard-coded discharge bias for prescriptions and labs
4. align detail sections with the same activation rules

Deliverable:

- UI that visibly matches classification

---

### Phase 6: Regression Tests

Goal:

- prevent card duplication and semantic regressions

Tasks:

1. add test fixtures for:
   - discharge summary
   - outpatient record
   - prescription
   - lab report
   - chart note
2. verify:
   - correct active cards
   - irrelevant cards inactive/hidden
   - no duplicate card creation
   - no fallback-only fake data for unsupported sections

Deliverable:

- document-type dashboard regression suite

---

## 7. Files Expected to Change

### Primary

- [skills/clinical/dashboard_mapper.skill.cjs](../../skills/clinical/dashboard_mapper.skill.cjs)
- [src/lib/processedDocuments.ts](../../src/lib/processedDocuments.ts)
- [src/pages/Index.tsx](../../src/pages/Index.tsx)

### Possible Supporting Files

- a new dashboard activation config file under `src/lib/` or `skills/clinical/`
- tests under [src/test](../../src/test)

### Files That Should Not Be Changed in This Task

Unless required for cleanup:

- document extraction agents
- routing logic
- chart note generation logic
- backend document storage format beyond activation metadata support

This is important to reduce duplication risk.

---

## 8. Non-Goals

This plan does **not** aim to:

- redesign the full visual style of the dashboard
- replace the extraction pipelines
- invent a separate dashboard per document type
- rewrite the entire data contract from scratch

The goal is controlled convergence, not expansion.

---

## 9. Acceptance Criteria

The work is complete when:

1. there is one master dashboard card schema
2. classification explicitly controls card activation
3. prescriptions do not pretend to be discharge summaries
4. lab reports do not render irrelevant discharge/treatment sections as if meaningful
5. inactive cards do not show misleading default content
6. frontend and mapper share one activation policy
7. tests prove no duplicate card models were introduced

---

## 10. Key Risks

### Risk 1: Creating Another Parallel Schema

Avoidance:

- extend the current `dashboard_cards` model
- do not invent `dashboard_cards_v2`
- do not create per-document custom payload formats

### Risk 2: Breaking Existing Detail Pages

Avoidance:

- add activation state without removing existing card IDs
- keep transformation backward-compatible during migration

### Risk 3: Prescription Special-Casing Everywhere

Avoidance:

- implement activation policy generically
- treat prescription as one document type in the shared policy table

---

## 11. Recommended Implementation Order

Recommended order for lowest risk:

1. finalize this plan
2. build card inventory and activation matrix
3. implement activation config only
4. wire mapper to emit activation state
5. wire transform layer to consume activation state
6. wire UI rendering to honor activation state
7. add regression tests

---

## 12. Review Decision Needed

Before implementation starts, confirm these product decisions:

1. Should irrelevant cards be:
   - hidden entirely
   - or shown as muted/inactive

2. For prescriptions, should the dashboard surface:
   - only clinically relevant cards
   - or a fuller shell with disabled sections for consistency

3. Should stage metadata for prescription processing:
   - remain in audit/secondary UI only
   - or appear in the primary dashboard state

---

## 13. Conclusion

The gap is real.

The current codebase has:

- a shared dashboard shape
- document classification
- specialized extraction

But it does **not yet** have:

- a master activation framework that turns classification into the right active/inactive dashboard cards

This plan is the controlled path to implement that without duplicating the existing system.
