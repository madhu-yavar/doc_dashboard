# Gemini Prescription Prompt Evaluation

Generated: 2026-04-30T06:02:00.260Z

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
| Medications | 6/6 | 6/6 | 6492 ms | - |
| Vitals | 5/6 | 5/6 | 6086 ms | Prescription_04.pdf: Unable to parse model JSON response |
| Diagnosis | 6/6 | 6/6 | 8837 ms | - |
| Orders | 5/6 | 5/6 | 6796 ms | Prescription_01.pdf: Unable to parse model JSON response |
| Visual Elements | 5/6 | 5/6 | 8833 ms | Prescription_03.pdf: Unable to parse model JSON response |

## Detailed Results

| Prescription | Pages | Prompt | Success | Schema | Key Output | Confidence | Latency | Notes |
|---|---:|---|---|---|---|---|---:|---|
| Prescription_01.pdf | 2 | Medications | yes | yes | 1 meds | - | 6868 ms | Dolo |
| Prescription_01.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 6403 ms | - |
| Prescription_01.pdf | 2 | Diagnosis | yes | yes | dx • 3 sx • 8 notes | high | 9725 ms | notes: No c/o nasal stuffiness / discharge / No c/o sore throat / cough. / No associated c/o hearing loss / giddiness |
| Prescription_01.pdf | 2 | Orders | no | - | - | - | 11366 ms | Unable to parse model JSON response |
| Prescription_01.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 11763 ms | - |
| Prescription_02.pdf | 2 | Medications | yes | yes | 1 meds | - | 5352 ms | AF |
| Prescription_02.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 4674 ms | - |
| Prescription_02.pdf | 2 | Diagnosis | yes | yes | no dx • 0 sx • 1 notes | high | 5285 ms | notes: All other treatment to be followed as advised earlier today |
| Prescription_02.pdf | 2 | Orders | yes | yes | 0 labs • 0 rad | high | 6015 ms | - |
| Prescription_02.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 4418 ms | - |
| Prescription_03.pdf | 2 | Medications | yes | yes | 1 meds | - | 5829 ms | MIRABEG |
| Prescription_03.pdf | 2 | Vitals | yes | yes | 1 vitals | high | 6346 ms | BP 150/90 |
| Prescription_03.pdf | 2 | Diagnosis | yes | yes | dx • 3 sx • 7 notes | high | 11889 ms | notes: ANGIOPLASTY + 2017 / Hb A1c 7 / S. Uric 1.78 |
| Prescription_03.pdf | 2 | Orders | yes | yes | 4 labs • 3 rad | high | 11290 ms | labs: Complete Blood Counts, Glycated Hemoglobin (HbA1c), Urine R/M and Microscopy ; rad: Ultrasound Abdomen & Pelvis, Uroflowmetry, TPM (I… |
| Prescription_03.pdf | 2 | Visual Elements | no | - | - | - | 17063 ms | Unable to parse model JSON response |
| Prescription_04.pdf | 1 | Medications | yes | yes | 0 meds | - | 7118 ms | - |
| Prescription_04.pdf | 1 | Vitals | no | - | - | - | 10179 ms | Unable to parse model JSON response |
| Prescription_04.pdf | 1 | Diagnosis | yes | yes | no dx • 2 sx • 5 notes | high | 10580 ms | notes: no weakness, pain anywhere etc. / no HTN, DM . . . / O/E. - no wasting, weakness. |
| Prescription_04.pdf | 1 | Orders | yes | yes | 0 labs • 1 rad | high | 4835 ms | rad: NCS both Uls. - ulnar below & above elbow |
| Prescription_04.pdf | 1 | Visual Elements | yes | yes | 0 labs • 1 rad | high | 9915 ms | rad: NCS both ULs |
| Prescription_05.pdf | 1 | Medications | yes | yes | 1 meds | - | 4631 ms | Xamil |
| Prescription_05.pdf | 1 | Vitals | yes | yes | 5 vitals | high | 4686 ms | BP 130/80 ; P 90 |
| Prescription_05.pdf | 1 | Diagnosis | yes | yes | no dx • 1 sx • 2 notes | high | 9777 ms | notes: K/C/o C++. / 'R' on 27/2/26 d Em hx |
| Prescription_05.pdf | 1 | Orders | yes | yes | 0 labs • 0 rad | high | 3587 ms | - |
| Prescription_05.pdf | 1 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 5161 ms | - |
| Prescription_06.pdf | 1 | Medications | yes | yes | 0 meds | - | 9152 ms | - |
| Prescription_06.pdf | 1 | Vitals | yes | yes | 5 vitals | high | 4230 ms | BP 120/80 ; P 70 |
| Prescription_06.pdf | 1 | Diagnosis | yes | yes | no dx • 0 sx • 1 notes | medium | 5764 ms | notes: P+ normal |
| Prescription_06.pdf | 1 | Orders | yes | yes | 1 labs • 0 rad | high | 3680 ms | labs: PSA |
| Prescription_06.pdf | 1 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 4676 ms | - |

## Preparation Failures

- None