# Document Type Router Implementation

## Summary

Implemented a document-type-aware extraction system that:
1. **Auto-detects** document type (discharge summary, outpatient, lab report, chart note)
2. **Routes** to specialized agent optimized for that document type
3. **Adjusts** quality expectations based on what data is typically available
4. **Only triggers "Review Required"** when expected sections for that document type are missing

## Files Created/Modified

### New Agents Created

| File | Purpose | Core Sections | Skipped Sections |
|------|---------|---------------|------------------|
| `agents/outpatient_extractor_agent.cjs` | OPD records | Patient, Vitals, Diagnosis, Medications, Notes | Risk Assessment, Treatment |
| `agents/lab_report_extractor_agent.cjs` | Lab reports | Labs | Vitals*, Diagnosis, Medications, Risk, Treatment, Notes, etc. |
| `agents/chart_note_extractor_agent.cjs` | Clinical notes | Clinical Notes, Diagnosis | Vitals, Risk, Labs, Radiology, Follow-up, Discharge |
| `agents/document_type_router.cjs` | Auto-detects & routes | - | - |

### Modified Files

| File | Changes |
|------|---------|
| `doctor_dashboard/server/index.cjs` | Added `DOCUMENT_TYPE_REQUIREMENTS`, `detectDocumentType()`, updated `buildExtractionEscalation()` with type-aware logic |

## Document Type Requirements

### Discharge Summary (default)
- **Core (7)**: Patient, Vitals, Diagnosis, Medications, Risk, Treatment, Clinical Notes
- **Optional**: Labs, Radiology, Discharge, Follow-up, Pending Items

### Outpatient Record
- **Core (5)**: Patient, Vitals, Diagnosis, Medications, Clinical Notes
- **Optional**: Labs, Radiology, Follow-up, Pending Items
- **Skipped**: Risk Assessment, Treatment (not typically in OPD notes)

### Lab Report
- **Core (1)**: Labs
- **Optional**: Vitals, Patient, Radiology
- **Skipped**: Diagnosis, Medications, Risk, Treatment, Clinical Notes, Follow-up, Discharge, Pending Items

### Chart Note
- **Core (2)**: Clinical Notes, Diagnosis
- **Optional**: Patient, Medications, Pending Items, Treatment
- **Skipped**: Vitals, Risk, Labs, Radiology, Follow-up, Discharge

### Nursing Assessment
- **Core (4)**: Patient, Vitals, Risk, Clinical Notes
- **Optional**: Diagnosis, Medications, Labs
- **Skipped**: Treatment, Radiology, Discharge, Follow-up

## How It Works

1. **Upload** → Document is received
2. **Detect** → `documentTypeRouter.detectDocumentType()` analyzes filename + content
3. **Route** → Appropriate agent processes the document
4. **Evaluate** → `buildExtractionEscalation()` checks only CORE sections for that document type
5. **Result** → Full dashboard if reliable sections ≥ 50%, otherwise "Review Required" with specific weak sections listed

## Example Behavior

### Before (Fixed Logic - Always Expected 7 Sections)
```
Document: Lab Report
Expected: Patient, Vitals, Diagnosis, Medications, Risk, Treatment, Clinical Notes
Actual: Labs only
Result: 71% deviation → "Review Required" ❌ WRONG
```

### After (Type-Aware Logic)
```
Document: Lab Report (auto-detected)
Expected: Labs only
Actual: Labs found
Result: 0% deviation → Full dashboard ✅ CORRECT
```

## Testing

Test with your sample documents:
- `Custom.MEXX.Report.ZEN.DischargeSummary*.cls.pdf` → Should detect as discharge summary
- Lab reports → Should detect as lab_report
- OPD notes → Should detect as outpatient_record
- Progress notes → Should detect as chart_note

## Next Steps

1. Test router with actual documents
2. Verify escalation messages are appropriate
3. Monitor for edge cases that need new document types
