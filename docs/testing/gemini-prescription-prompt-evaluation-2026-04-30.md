# Gemini Prescription Prompt Evaluation

Generated: 2026-04-30T06:41:22.408Z

## Scope

Evaluated the live Gemini stage-3 prompt implementations against `Prescription_01.pdf` through `Prescription_06.pdf`. Each run used the current pipeline-style image preparation: page 1 PHI masked, pages 2-N original.

## Static Findings

- This report evaluates the live prompt text, not clinical correctness against a gold standard. A prompt can be schema-compliant and still clinically weak.
- Medication quality should be judged by recall and legibility, not just JSON validity. Short one-token outputs may still be poor extraction outcomes.
- Visual selection detection is a narrower task than free-text clinical extraction, so it is expected to be more stable if the form contains checklist-style elements.
- Diagnosis extraction is now narrower and should be judged separately from order capture.
- Orders extraction should be judged primarily on recall for labs and radiology, with visual selection detection acting as a complementary source rather than the only source.

## Summary By Prompt

| Prompt | Success Rate | Schema OK | Avg Latency | Failures |
|---|---:|---:|---:|---|
| Medications | 6/6 | 6/6 | 5868 ms | - |
| Vitals | 6/6 | 6/6 | 4668 ms | - |
| Diagnosis | 6/6 | 6/6 | 8310 ms | - |
| Orders | 6/6 | 6/6 | 6519 ms | - |
| Visual Elements | 4/6 | 4/6 | 10143 ms | Prescription_01.pdf: Unable to parse model JSON response ; Prescription_03.pdf: Unable to parse model JSON response |

## Detailed Results

| Prescription | Pages | Prompt | Success | Schema | Key Output | Confidence | Latency | Notes |
|---|---:|---|---|---|---|---|---:|---|
| Prescription_01.pdf | 2 | Medications | yes | yes | 1 meds | - | 5041 ms | Dolo |
| Prescription_01.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 4920 ms | - |
| Prescription_01.pdf | 2 | Diagnosis | yes | yes | dx • 5 sx • 6 notes | high | 9346 ms | notes: No c/o nasal stuffiness / discharge / No c/o sore throat / cough. / No associated c/o hearing loss / giddiness |
| Prescription_01.pdf | 2 | Orders | yes | yes | 0 labs • 1 rad | high | 9065 ms | rad: PURE TONE AUDIOGRAM |
| Prescription_01.pdf | 2 | Visual Elements | no | - | - | - | 15872 ms | Unable to parse model JSON response |
| Prescription_02.pdf | 2 | Medications | yes | yes | 1 meds | - | 8740 ms | AF 150 |
| Prescription_02.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 4606 ms | - |
| Prescription_02.pdf | 2 | Diagnosis | yes | yes | no dx • 0 sx • 2 notes | high | 6152 ms | notes: Pl. add. / All other treatment to be followed as advised earlier today |
| Prescription_02.pdf | 2 | Orders | yes | yes | 0 labs • 0 rad | high | 3801 ms | - |
| Prescription_02.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 5787 ms | - |
| Prescription_03.pdf | 2 | Medications | yes | yes | 1 meds | - | 6060 ms | MIRABEG |
| Prescription_03.pdf | 2 | Vitals | yes | yes | 1 vitals | high | 5266 ms | BP 150/90 |
| Prescription_03.pdf | 2 | Diagnosis | yes | yes | dx • 3 sx • 1 notes | high | 9859 ms | notes: ANGIOPLASTY + 2017 |
| Prescription_03.pdf | 2 | Orders | yes | yes | 1 labs • 3 rad | high | 10229 ms | labs: Urine R/M and Microscopy ; rad: Ultrasound Abdomen & Pelvis, Uroflowmetry, T/P/N (1P) ; uncertain items: 1 |
| Prescription_03.pdf | 2 | Visual Elements | no | - | - | - | 16283 ms | Unable to parse model JSON response |
| Prescription_04.pdf | 1 | Medications | yes | yes | 0 meds | - | 5143 ms | - |
| Prescription_04.pdf | 1 | Vitals | yes | yes | 0 vitals | high | 4018 ms | - |
| Prescription_04.pdf | 1 | Diagnosis | yes | yes | no dx • 3 sx • 3 notes | high | 8189 ms | notes: no HTN, DM... / O/E - no wasting, weakness. / DTR (N). |
| Prescription_04.pdf | 1 | Orders | yes | yes | 0 labs • 1 rad | high | 6548 ms | rad: NCS both ULs - ulnar below & above elbow |
| Prescription_04.pdf | 1 | Visual Elements | yes | yes | 0 labs • 1 rad | high | 11589 ms | rad: NCS both ULs. |
| Prescription_05.pdf | 1 | Medications | yes | yes | 1 meds | - | 6030 ms | XAmil |
| Prescription_05.pdf | 1 | Vitals | yes | yes | 5 vitals | high | 4867 ms | BP 130/80 ; P 90 |
| Prescription_05.pdf | 1 | Diagnosis | yes | yes | no dx • 1 sx • 4 notes | medium | 9834 ms | notes: K/C/o C++ / Plan: IV x Amil / 'R' on 27/2/2024 |
| Prescription_05.pdf | 1 | Orders | yes | yes | 0 labs • 0 rad | high | 4736 ms | - |
| Prescription_05.pdf | 1 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 6689 ms | - |
| Prescription_06.pdf | 1 | Medications | yes | yes | 0 meds | - | 4195 ms | - |
| Prescription_06.pdf | 1 | Vitals | yes | yes | 4 vitals | high | 4329 ms | BP 120/80 ; P 70 |
| Prescription_06.pdf | 1 | Diagnosis | yes | yes | no dx • 0 sx • 1 notes | medium | 6481 ms | notes: P+ normal |
| Prescription_06.pdf | 1 | Orders | yes | yes | 1 labs • 0 rad | high | 4733 ms | labs: PSA |
| Prescription_06.pdf | 1 | Visual Elements | yes | yes | 1 labs • 0 rad | high | 4635 ms | labs: PSA |

## Semantic Flags

- Prescription_06.pdf
  - [info] text_visual_overlap: PSA [text+visual]

## Preparation Failures

- None