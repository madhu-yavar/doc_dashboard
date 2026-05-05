# Architecture Analysis: Current vs Target ReAct-Based System

## Current Architecture (Scripted, Not ReAct)

```
DocumentTypeRouter (rule-based)
    ↓
DischargeExtractorAgent (scripted)
    │
    ├─→ buildExecutionPlan() // FIXED skill sequence
    │   ├─ DocumentAnalyzerSkill
    │   ├─ DemographicsExtractorSkill
    │   ├─ RiskScoresExtractorSkill
    │   ├─ VitalsExtractorSkill
    │   ├─ FunctionalStatusExtractorSkill
    │   ├─ ClinicalDataExtractorSkill
    │   ├─ PendingItemsExtractorSkill
    │   └─ CrossValidatorSkill
    │
    └─→ executeSteps() // Run in fixed order, no decision making
```

**Problems:**
1. **NOT ReAct-based** - No Think-Act-Observe loop
2. **Fixed skill sequence** - Can't adapt based on document content
3. **Not scalable** - Adding new document type requires new agent class
4. **No tool selection** - Agent doesn't decide which skills to use

## Target ReAct-Based Architecture (Agentic)

```
DocumentClassifierAgent (ReAct-based)
    │
    ├─→ THINK: What type of document is this?
    ├─→ ACT: Use classification tools (vision + text + handwriting)
    └─→ OBSERVE: Classification result with confidence
    ↓
SpecialistExtractionAgent (ReAct-based)
    │
    ├─→ THINK: What extraction is needed?
    │   ├─ Has demographics? → Extract demographics
    │   ├─ Has medications? → Extract medications
    │   ├─ Has vitals? → Extract vitals
    │   └─ Has risk scores? → Extract risk scores
    │
    ├─→ ACT: Dynamically select and execute skills
    │   └─ Skill Registry (pluggable)
    │       ├─ DemographicsExtractorSkill
    │       ├─ MedicationsExtractorSkill
    │       ├─ VitalsExtractorSkill
    │       ├─ RiskScoresExtractorSkill
    │       └─ ... (add new skills without touching agent)
    │
    └─→ OBSERVE: Extraction results, validate, merge
```

## Key Differences

| Aspect | Current (Scripted) | Target (ReAct) |
|--------|-------------------|----------------|
| Decision Making | None (fixed sequence) | Agent decides which skills to run |
| Scalability | New doc type = new agent | New doc type = register skills |
| Adaptability | Runs all skills regardless | Runs only relevant skills |
| Error Recovery | Linear sequence | Can retry, skip, or use fallback |
| Tool Selection | Hard-coded | Dynamic based on document analysis |

## Skills Interface (Keep as-is)

Current skills already follow a good interface:
```javascript
class SomeSkill {
  async execute(context) {
    // { filePath, pdfText, onProgress }
    return { success, step, data, error };
  }
}
```

This doesn't need to change - skills are reusable!

## What Needs to Change

1. **BaseAgent** → Already created with ReAct loop ✓
2. **Specialist Agents** → Convert to extend BaseAgent
3. **Skill Registry** → Create for dynamic skill discovery
4. **Document Router** → Use agentic classifier + skill-based routing
