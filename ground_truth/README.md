# Ground Truth Package

This folder was generated locally without Gemma or any external extraction agent.

Contents:
- `ground_truth_table.csv`: review worksheet with candidate values and blank `gt_*` columns.
- `manual_review/reviewed_ground_truth.csv`: reviewed local-only ground-truth table prepared manually from the extracted text.
- `text/`: raw text extracted from each PDF using `pdftotext`.
- `candidates/`: per-file JSON showing candidate values and the exact source snippet matched for each field.

How to use:
1. Open the PDF and corresponding text file.
2. Compare the `candidate_*` columns against the source.
3. Fill the `gt_*` columns with the verified ground-truth values.
4. Update `review_status` and `review_notes`.

Notes:
- `image001.jpg` from the `data/` folder is intentionally excluded because this package is PDF-only.
- Candidate values are best-effort deterministic parses and should be treated as a starting point, not final ground truth.
