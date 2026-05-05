# Prescription Extraction Comparison Report

**Date:** 4/17/2026, 1:18:00 PM
**Test File:** ./data/Doxper.pdf

---

## opendataloader-pdf

- **Status:** ✅ Success
- **Duration:** 4.28s
- **Summary:**
  - Total Elements: 7
  - Text Blocks: 5
  - Tables: 0
  - Images: 2
  - Element Types: {"image":2,"paragraph":5}

---

## qwen-vision-8b

- **Status:** ✅ Success
- **Duration:** 18.19s
- **Summary:**
  - Patient: Mr Jerald PILLAI
  - Doctor: Dr. NEHA MISHRA (MBBS, MD (GEN MED), POST DOCTORAL FELLOWSHIP IN INFECTIOUS DISEASES (CMC VELLORE))
  - Medications: 0
  - Diagnosis: Not found
  - Confidence: high

---

## Comparison

| Metric | OpenDataLoader | Qwen Vision |
|--------|----------------|-------------|
| Duration | 4.28s | 18.19s |
| Status | ✅ | ✅ |

### Qwen Vision Extracted Data:
- **Medications Found:** 0
- **Patient:** Mr Jerald PILLAI
- **Doctor:** Dr. NEHA MISHRA (MBBS, MD (GEN MED), POST DOCTORAL FELLOWSHIP IN INFECTIOUS DISEASES (CMC VELLORE))
