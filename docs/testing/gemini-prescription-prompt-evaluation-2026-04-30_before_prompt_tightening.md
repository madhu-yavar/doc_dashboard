# Gemini Prescription Prompt Evaluation

Generated: 2026-04-30T03:11:30.836Z

## Scope

Evaluated the four live Gemini stage-3 prompt implementations against `Prescription_01.pdf` through `Prescription_06.pdf`. Each run used the current pipeline-style image preparation: page 1 PHI masked, pages 2-N original.

## Static Findings

- `Diagnosis` prompt/schema mismatch: the prompt requires `radiology` as an array of studies, but the downstream diagnosis skill later expects an object shape in its own post-processing. That is a contract mismatch even if Gemini follows the prompt.
- `Vitals` prompt has an internal ambiguity: it says to return null values when vitals are absent, but the example still shows `has_vitals: true`. That makes consistency harder to enforce.
- `Visual Element Detector` mixes lab-selection detection with radiology/imaging detection in the same prompt. That broadens scope and may dilute precision for checkbox-style lab extraction.
- `Medications` prompt is the cleanest structurally. It has the most explicit field-level guidance and the least downstream schema ambiguity.

## Summary By Prompt

| Prompt | Success Rate | Schema OK | Avg Latency | Failures |
|---|---:|---:|---:|---|
| Medications | 6/6 | 6/6 | 6818 ms | - |
| Vitals | 6/6 | 6/6 | 5038 ms | - |
| Diagnosis | 3/6 | 3/6 | 9945 ms | Prescription_03.pdf: Unable to parse model JSON response ; Prescription_04.pdf: Unable to parse model JSON response ; Prescription_05.pdf: Unable to parse mode… |
| Visual Elements | 6/6 | 6/6 | 8759 ms | - |

## Detailed Results

| Prescription | Pages | Prompt | Success | Schema | Key Output | Confidence | Latency | Notes |
|---|---:|---|---|---|---|---|---:|---|
| Prescription_01.pdf | 2 | Medications | yes | yes | 1 meds | - | 7059 ms | Dolo |
| Prescription_01.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 3951 ms | - |
| Prescription_01.pdf | 2 | Diagnosis | yes | yes | dx • 1 labs • 0 rad | high | 9726 ms | labs: PURE TONE AUDIOGRAM |
| Prescription_01.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 6228 ms | - |
| Prescription_02.pdf | 2 | Medications | yes | yes | 1 meds | - | 6014 ms | AF |
| Prescription_02.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 5091 ms | has_vitals=true but all values are null |
| Prescription_02.pdf | 2 | Diagnosis | yes | yes | no dx • 0 labs • 0 rad | high | 6923 ms | - |
| Prescription_02.pdf | 2 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 4265 ms | - |
| Prescription_03.pdf | 2 | Medications | yes | yes | 1 meds | - | 5144 ms | MIRBEG |
| Prescription_03.pdf | 2 | Vitals | yes | yes | 0 vitals | high | 3949 ms | - |
| Prescription_03.pdf | 2 | Diagnosis | no | - | - | - | 12326 ms | Unable to parse model JSON response |
| Prescription_03.pdf | 2 | Visual Elements | yes | yes | 3 labs • 1 rad | high | 15684 ms | labs: Glycated Hemoglobin (HbA1c), Urine Routine and Microscopy, Urine Culture ; rad: Ultrasound Abdomen & Pelvis |
| Prescription_04.pdf | 1 | Medications | yes | yes | 0 meds | - | 4564 ms | - |
| Prescription_04.pdf | 1 | Vitals | yes | yes | 1 vitals | high | 5246 ms | BP 100/70 |
| Prescription_04.pdf | 1 | Diagnosis | no | - | - | - | 12011 ms | Unable to parse model JSON response |
| Prescription_04.pdf | 1 | Visual Elements | yes | yes | 2 labs • 0 rad | high | 16898 ms | labs: NCS both ULs. - ulnar below & above elbow too., DPR |
| Prescription_05.pdf | 1 | Medications | yes | yes | 1 meds | - | 13962 ms | XAmil |
| Prescription_05.pdf | 1 | Vitals | yes | yes | 5 vitals | high | 6170 ms | BP 130/80 ; P 90 |
| Prescription_05.pdf | 1 | Diagnosis | no | - | - | - | 12212 ms | Unable to parse model JSON response |
| Prescription_05.pdf | 1 | Visual Elements | yes | yes | 0 labs • 0 rad | high | 4023 ms | - |
| Prescription_06.pdf | 1 | Medications | yes | yes | 0 meds | - | 4166 ms | - |
| Prescription_06.pdf | 1 | Vitals | yes | yes | 4 vitals | high | 5821 ms | BP 120/80 ; P 70 |
| Prescription_06.pdf | 1 | Diagnosis | yes | yes | no dx • 1 labs • 0 rad | high | 6470 ms | labs: PSA |
| Prescription_06.pdf | 1 | Visual Elements | yes | yes | 1 labs • 0 rad | high | 5455 ms | labs: PSA |

## Preparation Failures

- None