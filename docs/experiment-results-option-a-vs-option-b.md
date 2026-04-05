# Extraction Experiment: Option A vs Option B

**Date:** 2026-04-04
**Experiment:** Single-Shot vs Thinking/ReAct PDF Extraction
**Objective:** Compare extraction quality, speed, and cost for discharge summary data

---

## Executive Summary

| Metric | Option A (Single-Shot) | Option B (Thinking/ReAct) | Winner |
|--------|------------------------|---------------------------|--------|
| **Avg Score** | 56/100 | **84/100** | ✅ **Option B** |
| **Avg Latency** | 40.3s | 153.4s | ⚡ Option A |
| **Avg Tokens** | 3,567 | 17,362 | 💰 Option A |
| **Success Rate** | 5/5 (100%) | 5/5 (100%) | Tie |

**Verdict:** **Option B (Thinking/ReAct)** wins all 5 tests with **+50% accuracy** despite 3.8x slower speed and 4.9x higher token cost.

---

## Test Setup

### Samples Tested (5 PDFs)

| # | Sample | Patient | Diagnosis | Complexity |
|---|--------|---------|-----------|------------|
| 1 | Summary1 | Hema VAISHANAV (44F) | B/L Ear Pain | Simple |
| 2 | Summary2 | DR SHIVARAJ K S (74M) | Breathing Difficulty | Complex |
| 3 | Summary3 | Priyadarshini PUNJA (64F) | Chest Pain | Medium |
| 4 | Summary4 | Zohra Rumani (13F) | Adenotonsillitis | Medium |
| 5 | Summary5 | Neonate | Newborn | Complex |

### Scoring Rubric (100 points)

| Category | Points | Description |
|----------|--------|-------------|
| Patient Name | 10 | Correct extraction |
| MRN | 5 | Medical Record Number |
| Vitals Complete | 15 | BP (structured), Pulse, Temp, SpO2 |
| Risk Scores Complete | 20 | Fall, DVT, Pressure, Aspiration, EWS |
| Risk Scores Accurate | 15 | Match ground truth (Sample 2) |
| Functional Status | 10 | All 5 ADL fields |
| Diagnosis | 10 | Principal + ICD + secondary |
| Allergies | 5 | Correct extraction |
| Medications | 5 | Structured {name, dose, frequency} |
| Clinical Reasoning | 5 | Validation notes, confidence, inconsistencies |

---

## Detailed Results

### Sample-by-Sample Comparison

| # | Sample | Score A | Score B | Improvement | Winner |
|---|--------|---------|---------|-------------|--------|
| 1 | Simple (Ear Pain) | 61/100 | **89/100** | +46% | **B** |
| 2 | Complex (Breathing Difficulty) | 53/100 | **100/100** | +89% | **B** |
| 3 | Cardiology (Chest Pain) | 61/100 | **89/100** | +46% | **B** |
| 4 | Pediatrics (Adenotonsillitis) | 57/100 | **81/100** | +42% | **B** |
| 5 | Complex (Neonatal) | 47/100 | **63/100** | +34% | **B** |

---

## Key Differences

### 1. Data Structure Quality

**Option A Output:**
```json
{
  "vitals": {
    "bp": "140/90",
    "pulse": 105
  }
}
```

**Option B Output:**
```json
{
  "vitals": {
    "bp": {"systolic": 140, "diastolic": 90, "status": "high"},
    "pulse": {"value": 105, "status": "tachycardia"}
  }
}
```

---

### 2. Risk Score Validation (Sample 2 - Ground Truth: Fall=10, DVT=5, Pressure=13)

**Option A:** Got scores but no verification
```json
{
  "fall_risk_score": 10,
  "dvt_score": 5,
  "pressure_ulcer_score": 13
}
```

**Option B:** Cross-verified and validated
```json
{
  "fall_risk": {"score": 10, "level": "Moderate Fall Risk", "verified": true},
  "dvt_risk": {"score": 5, "level": "HIGHEST", "verified": true},
  "pressure_ulcer_risk": {"score": 13, "level": "Moderate Risk", "verified": true}
}
```

**Validation Notes from Option B:**
> "Fall Risk score discrepancy: Initial Assessment (10) vs Shift Assessment (9). Using Initial Assessment (10) as primary."

---

### 3. Clinical Interpretation

**Option A:** Raw values only
```json
{
  "pulse": 105
}
```

**Option B:** Clinical reasoning applied
```json
{
  "pulse": {"value": 105, "status": "tachycardia"},
  "abnormal_flags": [
    "High Blood Pressure (140/90)",
    "Tachycardia (Pulse 105)",
    "Tachypnea (Respiration 23)",
    "Prediabetic GRBS (117)"
  ]
}
```

---

### 4. Inconsistency Detection

**Option B found:**
- "Age range (41-60) mentioned in risk assessment vs specific age (44) in demographics"
- "Fall Risk score discrepancy: Initial (10) vs Shift (9)"
- "Braden Q sub-score calculation (21) differs from explicitly stated Total Score (25)"

---

### 5. Confidence & Validation Summary

**Option A:** No validation metadata

**Option B:** Complete validation summary
```json
{
  "validation_summary": {
    "confidence_level": "high",
    "inconsistencies_found": [...],
    "missing_critical_fields": [...],
    "data_quality_notes": "All risk scores were cross-verified and found consistent..."
  }
}
```

---

## Performance Metrics

### Latency (Time per PDF)

| Sample | Option A | Option B | Ratio |
|--------|----------|----------|-------|
| 1 | 35.7s | 150.2s | 4.2x |
| 2 | 44.0s | 158.8s | 3.6x |
| 3 | 41.2s | 167.7s | 4.1x |
| 4 | 36.3s | 138.5s | 3.8x |
| 5 | 44.3s | 152.0s | 3.4x |
| **Average** | **40.3s** | **153.4s** | **3.8x** |

### Token Usage

| Sample | Option A | Option B | Ratio |
|--------|----------|----------|-------|
| 1 | 3,647 | 17,719 | 4.9x |
| 2 | 3,605 | 17,545 | 4.9x |
| 3 | 3,553 | 17,917 | 5.0x |
| 4 | 3,353 | 16,414 | 4.9x |
| 5 | 3,676 | 17,216 | 4.7x |
| **Average** | **3,567** | **17,362** | **4.9x** |

---

## 7-Step Thinking/ReAct Process (Option B)

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Document Analysis                                   │
│ → Identify document type and sections                       │
│ → Plan extraction strategy                                  │
│ Tokens: ~2,000 | Time: ~20s                                 │
├─────────────────────────────────────────────────────────────┤
│ Step 2: Demographics Extraction                              │
│ → Extract name, MRN, age, gender with sources                │
│ Tokens: ~2,200 | Time: ~20s                                 │
├─────────────────────────────────────────────────────────────┤
│ Step 3: Risk Scores Extraction (with validation)             │
│ → Extract and cross-verify Fall, DVT, Pressure, Aspiration   │
│ → Note discrepancies between assessments                      │
│ Tokens: ~3,100 | Time: ~30s                                 │
├─────────────────────────────────────────────────────────────┤
│ Step 4: Vitals Extraction (with clinical interpretation)       │
│ → Extract BP, Pulse, Temp, SpO2 with normal/abnormal flags  │
│ Tokens: ~2,400 | Time: ~24s                                 │
├─────────────────────────────────────────────────────────────┤
│ Step 5: Functional Status Extraction                         │
│ → Extract ADLs (bathing, dressing, eating, walking, toilet)   │
│ Tokens: ~2,100 | Time: ~21s                                 │
├─────────────────────────────────────────────────────────────┤
│ Step 6: Clinical Data Extraction                             │
│ → Diagnosis, allergies, medications, investigations           │
│ Tokens: ~2,900 | Time: ~29s                                 │
├─────────────────────────────────────────────────────────────┤
│ Step 7: Final Assembly & Validation                         │
│ → Cross-check all extracted data                             │
│ → Generate validation summary                               │
│ → Flag inconsistencies and missing fields                    │
│ Tokens: ~2,600 | Time: ~26s                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Recommendations

### ✅ Use Option B (Thinking/ReAct) for:

1. **Risk Stratification Card** - Critical values must be validated
2. **Clinical Decision Support** - Doctors need confidence in data
3. **Complex Cases** - Multi-morbidity patients with multiple risk scores
4. **Production System** - Quality over speed for patient safety

### ⚡ Use Option A (Single-Shot) for:

1. **Bulk Pre-processing** - Initial document triage
2. **Simple Cases** - Low complexity discharges
3. **Real-time Preview** - Quick draft generation

### 🔄 Hybrid Approach (Recommended):

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Option A (40s) - Quick Pass                         │
│ ↓ If simple/low-risk → Done                                 │
│ ↓ If complex/high-risk → Step 2                              │
│ Step 2: Option B (153s) - Deep Dive                          │
│ ↓ Cross-verify risk scores, validate inconsistencies          │
└─────────────────────────────────────────────────────────────┘
```

---

## Cost Analysis

| Metric | Option A | Option B | Ratio |
|--------|----------|----------|-------|
| Time per PDF | 40s | 153s | 3.8x |
| Tokens per PDF | 3,567 | 17,362 | 4.9x |
| **Est. Cost per PDF** | **~$0.01-0.02** | **~$0.05-0.10** | **~5x** |

**ROI Consideration:** For a medical dashboard, a 50% accuracy improvement (56→84) justifies 5x cost. A single missed critical value could impact patient care.

---

## Conclusion

**Option B (Thinking/ReAct) is recommended for production implementation.**

The experiment demonstrates that multi-step reasoning with validation:
- Extracts more complete and accurate data
- Provides clinical interpretation (normal/abnormal flags)
- Detects inconsistencies in source documents
- Generates confidence scores for quality assurance
- Structures data properly for dashboard rendering

The **3.8x speed trade-off** is acceptable for:
- Batch processing (non-real-time)
- High-stakes medical data
- Systems where data quality > speed

---

*Experiment conducted on 5 discharge summary PDFs using google/gemma-4-26B-A4B-it model*
*Full results available in: `/Users/yavar/Documents/CoE/Manipal/doctor_dashboard/scripts/experiment_results/`*
