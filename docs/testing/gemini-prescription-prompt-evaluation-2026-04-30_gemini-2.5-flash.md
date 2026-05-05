# Gemini Prescription Prompt Evaluation

Generated: 2026-04-30T04:14:19.085Z

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
| Medications | 6/6 | 6/6 | 5631 ms | - |
| Vitals | 6/6 | 6/6 | 4891 ms | - |
| Diagnosis | 5/6 | 5/6 | 7347 ms | Prescription_03.pdf: Unable to parse model JSON response |
| Visual Elements | 6/6 | 6/6 | 7824 ms | - |

## Detailed Results

| Prescription | Pages | Prompt | Success | Schema | Key Output | Confidence | Latency | Notes |
|---|---:|---|---|---|---|---|---:|---|
| Prescription_01.pdf | 2 | Medications | yes | yes | 1 meds | - | 5562 ms | Dolo |
| Prescription_01.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 4982 ms | - |
| Prescription_01.pdf | 2 | Diagnosis | yes | yes | dx • 0 labs • 1 rad | high | 7606 ms | rad: PURE TONE AUDIOGRAM |
| Prescription_01.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 10494 ms | - |
| Prescription_02.pdf | 2 | Medications | yes | yes | 1 meds | - | 7268 ms | AF |
| Prescription_02.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 4910 ms | - |
| Prescription_02.pdf | 2 | Diagnosis | yes | yes | no dx • 0 labs • 0 rad | high | 3531 ms | - |
| Prescription_02.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 4237 ms | - |
| Prescription_03.pdf | 2 | Medications | yes | yes | 1 meds | - | 5457 ms | T MIRBEG |
| Prescription_03.pdf | 2 | Vitals | yes | yes | 1 vitals | medium | 4905 ms | BP 150/90 |
| Prescription_03.pdf | 2 | Diagnosis | no | - | - | - | 11279 ms | Unable to parse model JSON response |
| Prescription_03.pdf | 2 | Visual Elements | yes | yes | 2 labs • 1 rad | high | 13430 ms | labs: Urine R/M and Microscopy, Urine Culture ; rad: Ultrasound Abdomen & Pelvis |
| Prescription_04.pdf | 1 | Medications | yes | yes | 0 meds | - | 4989 ms | - |
| Prescription_04.pdf | 1 | Vitals | yes | yes | 1 vitals | high | 4857 ms | BP 100/70 |
| Prescription_04.pdf | 1 | Diagnosis | yes | yes | no dx • 0 labs • 1 rad | high | 9254 ms | rad: NCS both ULS. - ulnar below & above elbow too. |
| Prescription_04.pdf | 1 | Visual Elements | yes | yes | 0 labs • 1 rad | high | 9281 ms | rad: NCS both ULs. - ulnar below & above elbow too. |
| Prescription_05.pdf | 1 | Medications | yes | yes | 1 meds | - | 5839 ms | Xamil |
| Prescription_05.pdf | 1 | Vitals | yes | yes | 5 vitals | high | 5172 ms | BP 130/80 ; P 90 |
| Prescription_05.pdf | 1 | Diagnosis | yes | yes | no dx • 0 labs • 0 rad | medium | 6914 ms | - |
| Prescription_05.pdf | 1 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 4042 ms | - |
| Prescription_06.pdf | 1 | Medications | yes | yes | 0 meds | - | 4670 ms | - |
| Prescription_06.pdf | 1 | Vitals | yes | yes | 4 vitals | high | 4518 ms | BP 120/80 ; P 70 |
| Prescription_06.pdf | 1 | Diagnosis | yes | yes | no dx • 1 labs • 0 rad | high | 5497 ms | labs: PSA |
| Prescription_06.pdf | 1 | Visual Elements | yes | yes | 1 labs • 0 rad | high | 5458 ms | labs: PSA |

## Preparation Failures

- None