# Gemini Prescription Prompt Evaluation

Generated: 2026-04-30T03:36:05.509Z

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
| Medications | 6/6 | 6/6 | 6840 ms | - |
| Vitals | 6/6 | 6/6 | 4403 ms | - |
| Diagnosis | 4/6 | 4/6 | 8321 ms | Prescription_01.pdf: Unable to parse model JSON response ; Prescription_03.pdf: Unable to parse model JSON response |
| Visual Elements | 5/6 | 5/6 | 9438 ms | Prescription_03.pdf: Unable to parse model JSON response |

## Detailed Results

| Prescription | Pages | Prompt | Success | Schema | Key Output | Confidence | Latency | Notes |
|---|---:|---|---|---|---|---|---:|---|
| Prescription_01.pdf | 2 | Medications | yes | yes | 1 meds | - | 7053 ms | Dolo |
| Prescription_01.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 3667 ms | - |
| Prescription_01.pdf | 2 | Diagnosis | no | - | - | - | 12402 ms | Unable to parse model JSON response |
| Prescription_01.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 13026 ms | - |
| Prescription_02.pdf | 2 | Medications | yes | yes | 1 meds | - | 8821 ms | AF 150 |
| Prescription_02.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 4226 ms | - |
| Prescription_02.pdf | 2 | Diagnosis | yes | yes | no dx • 0 labs • 0 rad | high | 3567 ms | - |
| Prescription_02.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 7741 ms | - |
| Prescription_03.pdf | 2 | Medications | yes | yes | 1 meds | - | 6619 ms | T MIRBEG |
| Prescription_03.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 4306 ms | - |
| Prescription_03.pdf | 2 | Diagnosis | no | - | - | - | 11607 ms | Unable to parse model JSON response |
| Prescription_03.pdf | 2 | Visual Elements | no | - | - | - | 15075 ms | Unable to parse model JSON response |
| Prescription_04.pdf | 1 | Medications | yes | yes | 0 meds | - | 5327 ms | - |
| Prescription_04.pdf | 1 | Vitals | yes | yes | 0 vitals | high | 4911 ms | - |
| Prescription_04.pdf | 1 | Diagnosis | yes | yes | no dx • 0 labs • 1 rad | high | 6999 ms | rad: NCS both ULs - ulnar below & above elbow too. |
| Prescription_04.pdf | 1 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 12093 ms | - |
| Prescription_05.pdf | 1 | Medications | yes | yes | 1 meds | - | 9937 ms | X Amil |
| Prescription_05.pdf | 1 | Vitals | yes | yes | 5 vitals | high | 4842 ms | BP 130/80 ; P 90 |
| Prescription_05.pdf | 1 | Diagnosis | yes | yes | no dx • 0 labs • 0 rad | high | 9448 ms | - |
| Prescription_05.pdf | 1 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 4386 ms | - |
| Prescription_06.pdf | 1 | Medications | yes | yes | 0 meds | - | 3284 ms | - |
| Prescription_06.pdf | 1 | Vitals | yes | yes | 4 vitals | high | 4463 ms | BP 120/80 ; P 70 |
| Prescription_06.pdf | 1 | Diagnosis | yes | yes | no dx • 1 labs • 0 rad | high | 5901 ms | labs: PSA |
| Prescription_06.pdf | 1 | Visual Elements | yes | yes | 1 labs • 0 rad | high | 4307 ms | labs: PSA |

## Preparation Failures

- None