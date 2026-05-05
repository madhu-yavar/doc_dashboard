# Gemini Prescription Prompt Evaluation

Generated: 2026-04-30T04:36:52.205Z

## Scope

Evaluated the four live Gemini stage-3 prompt implementations against `Prescription_01.pdf` through `Prescription_06.pdf`. Each run used the current pipeline-style image preparation: page 1 PHI masked, pages 2-N original.

## Static Findings

- This report evaluates the live prompt text, not clinical correctness against a gold standard. A prompt can be schema-compliant and still clinically weak.
- Medication quality should be judged by recall and legibility, not just JSON validity. Short one-token outputs may still be poor extraction outcomes.
- Visual selection detection is a narrower task than free-text clinical extraction, so it is expected to be more stable if the form contains checklist-style elements.
- Diagnosis extraction remains the highest-risk prompt because it asks the model to separate multiple semantic buckets from the same handwritten content.

## Summary By Prompt

| Prompt | Success Rate | Schema OK | Avg Latency | Failures |
|---|---:|---:|---:|---|
| Medications | 6/6 | 6/6 | 5204 ms | - |
| Vitals | 6/6 | 6/6 | 4795 ms | - |
| Diagnosis | 5/6 | 5/6 | 8113 ms | Prescription_03.pdf: Unable to parse model JSON response |
| Visual Elements | 6/6 | 6/6 | 7796 ms | - |

## Detailed Results

| Prescription | Pages | Prompt | Success | Schema | Key Output | Confidence | Latency | Notes |
|---|---:|---|---|---|---|---|---:|---|
| Prescription_01.pdf | 2 | Medications | yes | yes | 1 meds | - | 5543 ms | Dolo |
| Prescription_01.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 5017 ms | - |
| Prescription_01.pdf | 2 | Diagnosis | yes | yes | dx • 0 labs • 0 rad | high | 10080 ms | - |
| Prescription_01.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 12077 ms | - |
| Prescription_02.pdf | 2 | Medications | yes | yes | 1 meds | - | 5146 ms | AF |
| Prescription_02.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 4608 ms | - |
| Prescription_02.pdf | 2 | Diagnosis | yes | yes | no dx • 0 labs • 0 rad | high | 3934 ms | - |
| Prescription_02.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 5975 ms | - |
| Prescription_03.pdf | 2 | Medications | yes | yes | 1 meds | - | 7227 ms | MIRABE G |
| Prescription_03.pdf | 2 | Vitals | yes | yes | 1 vitals | high | 4820 ms | BP 150/90 |
| Prescription_03.pdf | 2 | Diagnosis | no | - | - | - | 12076 ms | Unable to parse model JSON response |
| Prescription_03.pdf | 2 | Visual Elements | yes | yes | 2 labs • 1 rad | high | 8414 ms | labs: Urine Routine and Microscopy, Urine Culture ; rad: Ultrasound Abdomen & Pelvis |
| Prescription_04.pdf | 1 | Medications | yes | yes | 0 meds | - | 4364 ms | - |
| Prescription_04.pdf | 1 | Vitals | yes | yes | 0 vitals | high | 4839 ms | - |
| Prescription_04.pdf | 1 | Diagnosis | yes | yes | no dx • 0 labs • 1 rad | high | 9255 ms | rad: NCS both ULs. - ulnar below & above elbow too. |
| Prescription_04.pdf | 1 | Visual Elements | yes | yes | 0 labs • 1 rad | high | 9476 ms | rad: NCS both ULs. - ulnar below & above elbow too. |
| Prescription_05.pdf | 1 | Medications | yes | yes | 1 meds | - | 5638 ms | X Amil |
| Prescription_05.pdf | 1 | Vitals | yes | yes | 5 vitals | high | 4558 ms | BP 130/80 ; P 90 |
| Prescription_05.pdf | 1 | Diagnosis | yes | yes | no dx • 0 labs • 0 rad | medium | 8700 ms | - |
| Prescription_05.pdf | 1 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 5150 ms | - |
| Prescription_06.pdf | 1 | Medications | yes | yes | 0 meds | - | 3305 ms | - |
| Prescription_06.pdf | 1 | Vitals | yes | yes | 4 vitals | high | 4928 ms | BP 120/80 ; P 70 |
| Prescription_06.pdf | 1 | Diagnosis | yes | yes | no dx • 1 labs • 0 rad | high | 4632 ms | labs: PSA |
| Prescription_06.pdf | 1 | Visual Elements | yes | yes | 1 labs • 0 rad | high | 5686 ms | labs: PSA |

## Preparation Failures

- None