## Manual Ground Truth

This folder contains the reviewed ground-truth table for all PDFs in `/Users/yavar/Documents/CoE/Manipal/data`.

Rules used for this package:
- Built locally from the PDF text extracted with `pdftotext`
- No Gemma output, no agent output, and no model-generated extraction pipeline was used as the source of truth
- Values were normalized manually from the source text files in `/Users/yavar/Documents/CoE/Manipal/ground_truth/text`
- Blank cells mean the value was not clearly present in the extracted PDF text and was not guessed

Main file:
- `reviewed_ground_truth.csv`

Column notes:
- `gt_hospital_no` and `gt_mrn` are separated because both identifiers appear in many records
- `gt_pressure_flag`, `gt_dvt_flag`, and `gt_aspiration_flag` preserve the chart's explicit `YES` or `NO` flags
- `gt_*_score` and `gt_*_risk` are filled only when the PDF explicitly shows them
- `review_notes` captures corrections, ambiguities, and source-quality issues such as likely typos
