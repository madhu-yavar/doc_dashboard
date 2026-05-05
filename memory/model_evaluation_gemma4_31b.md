---
name: Model Evaluation - Gemma 4-31B
description: Evaluation of Gemma 4-31B model for medical document extraction tasks
type: project
---

# Gemma 4-31B Model Evaluation

**Date:** 2026-04-27
**Model:** `google/gemma-4-31B-it`
**Endpoint:** `http://206.1.62.28:8000/v1/chat/completions`

## Test Results Summary

### Prescription Extraction Test

| Document | Score | Time | Tokens | Key Findings |
|----------|-------|------|--------|--------------|
| Doxper.pdf | 35/100 | 16.3s | 926 | Patient, doctor, diagnosis extracted well - **medications missed** |
| Chart Note | 36/100 | 13.7s | 888 | Patient info, diagnosis, vitals extracted - **no medications** |

## Strengths

- ✅ Extracts patient name, age, gender accurately
- ✅ Extracts doctor information when present
- ✅ Captures diagnosis and symptoms well
- ✅ Good at reading structured text
- ✅ Extracts vitals (BP, pulse, temp)
- ✅ Fast response time (~13-16 seconds)
- ✅ Token efficient (~900 tokens per request)
- ✅ Handles handwriting with reasonable accuracy (marks uncertain fields with "(handwriting)" suffix)

## Weaknesses

- ❌ **Critical: Consistently fails to extract medications** - medications array is empty in tests
- ❌ May miss department information
- ❌ Doctor signature extraction inconsistent

## Recommendation

**NOT recommended for prescription extraction** in its current form. The medication extraction failure is a critical gap for prescription processing workflows.

## Alternative Models to Evaluate

- Qwen 3-VL-30B (currently configured but endpoint unavailable - needs investigation)
- Consider model chaining: Gemma for structured text + specialized model for handwritten medications

## Next Steps

1. Fix Qwen 3-VL-30B endpoint connectivity (port 8001 returning Redis Insight instead of vLLM)
2. Compare medication extraction between models once Qwen is accessible
3. Consider fine-tuning or prompt engineering for medication extraction with Gemma
