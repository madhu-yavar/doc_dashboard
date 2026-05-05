# OCR Accuracy Report

**Date:** 4/17/2026, 1:22:27 PM
**Test File:** Doxper.pdf

## Ground Truth

### Patient Information
- Name: Mr Jerald PILLAI
- Age: 21 Yrs
- Gender: Male
- ID: MH005618878
- Phone: 8754912568
- Email: jeraldsatya2000@gmail.com
- OPD: O00008190425
- Date: 2022-01-08 09:09

### Doctor Information
- Name: Dr. NEHA MISHRA
- Qualifications: MBBS, MD (GEN MED), POST DOCTORAL FELLOWSHIP IN INFECTIOUS DISEASES (CMC VELLORE)
- Registration: TMN 2017 0001362 KTK
- Department: Infectious Disease MHB

### Handwritten Content (Page 2)
- Medications:
  1. Tab. Azithromycin 500mg - OD - 5 days
  2. Tab. Montek LC - HS - 5 days
- Problem List: Fever with myalgia
- Provisional Diagnosis: Viral fever
- Advice: To review after 3 days if fever persists

## Results

### OpenDataLoader-PDF (Standard Mode)

**Accuracy:** 100.0% (9/9 fields)

| Field | Status |
|-------|--------|
| Patient name | ✅ |
| Patient age | ✅ |
| Patient gender | ✅ |
| Patient id | ✅ |
| Patient phone | ✅ |
| Patient email | ✅ |
| Doctor name | ✅ |
| Doctor registration | ✅ |
| Doctor department | ✅ |

**Medications:** Standard mode cannot read handwritten text

### Qwen Vision 8B

**Accuracy:** 100.0% (6/6 fields)

| Field | Expected | Extracted | Status |
|-------|----------|-----------|--------|
| Patient name | Mr Jerald PILLAI | Mr Jerald PILLAI | ✅ |
| Patient age | 21 Yrs | 21 Yrs | ✅ |
| Patient gender | Male | Male | ✅ |
| Patient id | MH005618878 | MH005618878 | ✅ |
| Doctor name | Dr. NEHA MISHRA | Dr. NEHA MISHRA (MBBS, MD (GEN MED), POST DOCTORAL FELLOWSHIP IN INFECTIOUS DISEASES (CMC VELLORE)) | ✅ |
| Doctor registration | TMN 2017 0001362 KTK | TMN 2017 0001362 KTK | ✅ |

**Medications:** 0/2 extracted

## Conclusions

1. **Digital Text Extraction:** Both methods accurately extract digital text
2. **Handwriting Challenge:** Neither method successfully extracted the handwritten medications
3. **Recommendation:** Try Qwen 30B model for better handwriting recognition
