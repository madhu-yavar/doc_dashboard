# Gemini Prescription Prompt Evaluation

Generated: 2026-04-30T05:08:57.126Z

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
| Medications | 6/6 | 6/6 | 6495 ms | - |
| Vitals | 6/6 | 6/6 | 5958 ms | - |
| Diagnosis | 5/6 | 5/6 | 8824 ms | Prescription_03.pdf: Unable to parse model JSON response |
| Visual Elements | 6/6 | 6/6 | 10037 ms | - |

## Detailed Results

| Prescription | Pages | Prompt | Success | Schema | Key Output | Confidence | Latency | Notes |
|---|---:|---|---|---|---|---|---:|---|
| Prescription_01.pdf | 2 | Medications | yes | yes | 1 meds | - | 6196 ms | Dolo |
| Prescription_01.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 5092 ms | - |
| Prescription_01.pdf | 2 | Diagnosis | yes | yes | dx • 0 labs • 1 rad | high | 10310 ms | rad: PURE TONE AUDIOGRAM |
| Prescription_01.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 13892 ms | - |
| Prescription_02.pdf | 2 | Medications | yes | yes | 1 meds | - | 9215 ms | AF 150 |
| Prescription_02.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 5171 ms | - |
| Prescription_02.pdf | 2 | Diagnosis | yes | yes | no dx • 0 labs • 0 rad | high | 3999 ms | - |
| Prescription_02.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 5966 ms | - |
| Prescription_03.pdf | 2 | Medications | yes | yes | 1 meds | - | 5549 ms | MIRABE |
| Prescription_03.pdf | 2 | Vitals | yes | yes | 1 vitals | high | 7180 ms | BP 154/90 |
| Prescription_03.pdf | 2 | Diagnosis | no | - | - | - | 10922 ms | Unable to parse model JSON response |
| Prescription_03.pdf | 2 | Visual Elements | yes | yes | 1 labs • 1 rad | high | 14488 ms | labs: Urine R/M and Microscopy ; rad: Ultrasound Abdomen & Pelvis |
| Prescription_04.pdf | 1 | Medications | yes | yes | 0 meds | - | 6430 ms | - |
| Prescription_04.pdf | 1 | Vitals | yes | yes | 0 vitals | high | 5244 ms | - |
| Prescription_04.pdf | 1 | Diagnosis | yes | yes | no dx • 11 labs • 1 rad | high | 13846 ms | labs: Complete Blood Counts, TSH, Urine Routine and Microscopy ; rad: NCS both ULs - ulnar below & above elbow too |
| Prescription_04.pdf | 1 | Visual Elements | yes | yes | 0 labs • 1 rad | high | 8744 ms | rad: NCS both ULs. - ulnar below & above elbow too. |
| Prescription_05.pdf | 1 | Medications | yes | yes | 1 meds | - | 6797 ms | X Amil |
| Prescription_05.pdf | 1 | Vitals | yes | yes | 5 vitals | high | 8139 ms | BP 130/80 ; P 90 |
| Prescription_05.pdf | 1 | Diagnosis | yes | yes | no dx • 0 labs • 0 rad | medium | 8808 ms | - |
| Prescription_05.pdf | 1 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 8211 ms | - |
| Prescription_06.pdf | 1 | Medications | yes | yes | 0 meds | - | 4781 ms | - |
| Prescription_06.pdf | 1 | Vitals | yes | yes | 4 vitals | high | 4920 ms | BP 120/80 ; P 70 |
| Prescription_06.pdf | 1 | Diagnosis | yes | yes | no dx • 1 labs • 0 rad | high | 5058 ms | labs: PSA |
| Prescription_06.pdf | 1 | Visual Elements | yes | yes | 1 labs • 0 rad | high | 8920 ms | labs: PSA |

## Preparation Failures

- None