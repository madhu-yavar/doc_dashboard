#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path("/Users/yavar/Documents/CoE/Manipal")
INPUT_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "ground_truth"
TEXT_DIR = OUTPUT_DIR / "text"
CANDIDATE_DIR = OUTPUT_DIR / "candidates"


@dataclass
class MatchResult:
    value: str
    source: str


def require_pdftotext() -> str:
    binary = shutil.which("pdftotext")
    if not binary:
      raise SystemExit("pdftotext is required but was not found in PATH.")
    return binary


def extract_text(pdftotext_bin: str, pdf_path: Path) -> str:
    result = subprocess.run(
        [pdftotext_bin, str(pdf_path), "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.replace("\x0c", "\n").replace("\r", "")


def first_non_empty(lines: Iterable[str]) -> str:
    for line in lines:
        if line.strip():
            return line.strip()
    return ""


def find_first(text: str, patterns: list[tuple[str, int]]) -> MatchResult:
    for pattern, flags in patterns:
        match = re.search(pattern, text, flags)
        if match:
            value = " ".join(group.strip() for group in match.groups() if group and group.strip()).strip()
            if value:
                return MatchResult(value=value, source=match.group(0).strip())
    return MatchResult(value="", source="")


def find_all(text: str, patterns: list[tuple[str, int]]) -> MatchResult:
    values: list[str] = []
    sources: list[str] = []
    for pattern, flags in patterns:
        for match in re.finditer(pattern, text, flags):
            value = " ".join(group.strip() for group in match.groups() if group and group.strip()).strip()
            if value and value not in values:
                values.append(value)
                sources.append(match.group(0).strip())
    return MatchResult(value=" | ".join(values), source=" || ".join(sources))


def normalize_name(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip(" .,:;-")
    return value


def sort_key(path: Path) -> tuple[int, str]:
    match = re.search(r"DischargeSummary(\d+)", path.name)
    return (int(match.group(1)) if match else 10_000, path.name)


def build_record(pdf_path: Path, text: str) -> dict:
    hospital_no = find_first(
        text,
        [
            (r"Hospital No:\s*(?:\n\s*)?([A-Z0-9]+)", re.IGNORECASE),
            (r"\bMRN\s*:\s*([A-Z0-9]+)", re.IGNORECASE),
        ],
    )

    patient_name = find_first(
        text,
        [
            (r"Patient Name\s*:\s*([^\n]+)", re.IGNORECASE),
            (r"PATIENT NAME\s+([A-Z][A-Z.\s]+?)(?:\s+\d+\s*YRS|\s*,|\.)", re.IGNORECASE),
            (r"Name of patient\s*:\s*([^\n]+)", re.IGNORECASE),
        ],
    )
    patient_name.value = normalize_name(patient_name.value)

    age = find_first(
        text,
        [
            (r"\bAge\s*:\s*(\d+)", re.IGNORECASE),
            (r"\baged\s+(\d+)\s+years", re.IGNORECASE),
        ],
    )

    gender = find_first(
        text,
        [
            (r"\bGender\s*:\s*([A-Za-z]+)", re.IGNORECASE),
            (r"\b(MALE|FEMALE)\b", re.IGNORECASE),
        ],
    )

    admission_date = find_first(
        text,
        [
            (r"Patient arrival Date\s*:\s*([0-9/.-]+)", re.IGNORECASE),
            (r"Patient Arrival Date\s*:\s*([0-9/.-]+)", re.IGNORECASE),
            (r"Date of birth\s*:\s*([0-9/.-]+)", re.IGNORECASE),
            (r"\bAdmission Date\s*:\s*([0-9/.-]+)", re.IGNORECASE),
        ],
    )

    discharge_date = find_first(
        text,
        [
            (r"\bDischarge Date\s*:\s*([0-9/.-]+)", re.IGNORECASE),
            (r"\bDate of discharge\s*:\s*([0-9/.-]+)", re.IGNORECASE),
        ],
    )

    chief_complaints = find_first(
        text,
        [
            (r"Chief Complaints\s*:\s*([^\n]+)", re.IGNORECASE),
            (r"Comment / Chief Complaints / Diagnosis\s*:\s*([^\n]+)", re.IGNORECASE),
        ],
    )

    principal_diagnosis = find_first(
        text,
        [
            (r"Provisional Diagnosis\s*:\s*([^\n]+)", re.IGNORECASE),
            (r"Impression\s*:\s*([^\n]+)", re.IGNORECASE),
            (r"Diagnosis\s*:\s*([^\n]+)", re.IGNORECASE),
        ],
    )

    secondary_context = find_all(
        text,
        [
            (r"Past History\s*:\s*([^\n]+)", re.IGNORECASE),
            (r"Past Medical History\s*:\s*([^\n]+)", re.IGNORECASE),
            (r"Past Surgical History\s*:\s*([^\n]+)", re.IGNORECASE),
        ],
    )

    allergies = find_first(
        text,
        [
            (r"Any Known Allergies\s*:\s*([^\n]+)", re.IGNORECASE),
            (r"\bAllergy\s*:\s*([^\n]+)", re.IGNORECASE),
            (r"\bAllergies\s*:\s*([^\n]+)", re.IGNORECASE),
        ],
    )

    current_medications = find_all(
        text,
        [
            (r"Current Medications\s*:\s*([^\n]+)", re.IGNORECASE),
            (r"Current medications\s*:\s*([^\n]+)", re.IGNORECASE),
            (r"(Inj\.?[^\n:]+:\s*[^\n]+)", re.IGNORECASE),
        ],
    )

    bp = find_first(
        text,
        [
            (r"Blood Pressure(?:\(mmHg\))?\s*:\s*(\d+\s*/\s*\d+)", re.IGNORECASE),
            (r"BP mm Hg\s*:\s*(\d+\s*/\s*\d+)", re.IGNORECASE),
            (r"BP = S/D:\s*(\d+\s*/\s*\d+)", re.IGNORECASE),
            (r"BP Systolic:\s*(\d+)\s*mmHg.*?BP Diastolic:\s*(\d+)\s*mmHg", re.IGNORECASE | re.DOTALL),
        ],
    )

    pulse = find_first(
        text,
        [
            (r"Pulse(?:/min| Rate)?\s*:\s*(\d+)", re.IGNORECASE),
            (r"Heart rate\s*:\s*(\d+)", re.IGNORECASE),
            (r"Heart Rate\s*:\s*(\d+)", re.IGNORECASE),
        ],
    )

    temperature = find_first(
        text,
        [
            (r"Temp(?:\(F\)| F)?\s*:\s*([0-9.]+)", re.IGNORECASE),
            (r"Temperature\s*:\s*([0-9.]+)", re.IGNORECASE),
        ],
    )

    respiration = find_first(
        text,
        [
            (r"Respiration(?:/min)?\s*:\s*(\d+)", re.IGNORECASE),
            (r"Resp Rate/min\s*:\s*(\d+)", re.IGNORECASE),
            (r"Respiratory rate\s*:\s*(\d+)", re.IGNORECASE),
        ],
    )

    spo2 = find_first(
        text,
        [
            (r"Spo2(?:\(%\))?\s*:\s*([0-9.]+)", re.IGNORECASE),
            (r"SPO2\s*:\s*([0-9.]+)", re.IGNORECASE),
            (r"Saturation\(Oxygen\)\s*:\s*([0-9.]+)", re.IGNORECASE),
        ],
    )

    pain_score = find_first(
        text,
        [
            (r"Pain Score\s*:\s*([0-9.]+)", re.IGNORECASE),
            (r"Numeric Pain Scale\s*:\s*([0-9.]+)", re.IGNORECASE),
            (r"Score\s*:\s*([0-9.]+)", re.IGNORECASE),
        ],
    )

    fall_score = find_first(
        text,
        [
            (r"Total Fall Risk Score.*?:\s*([0-9.]+)", re.IGNORECASE),
            (r"Fall Score\s*:\s*([0-9.]+)", re.IGNORECASE),
        ],
    )
    fall_risk = find_first(
        text,
        [
            (r"Total Fall Risk Score.*?\nRemarks\s*:\s*([^\n]+)", re.IGNORECASE),
            (r"Fall Score\s*:\s*[0-9.]+\s+([A-Z ]+RISK)", re.IGNORECASE),
        ],
    )

    pressure_score = find_first(
        text,
        [
            (r"Pressure score\s*:\s*([0-9.]+)", re.IGNORECASE),
            (r"Braden.*?Total Score\s*:\s*([0-9.]+)", re.IGNORECASE),
        ],
    )
    pressure_risk = find_first(
        text,
        [
            (r"Pressure score\s*:\s*[0-9.]+\s+([A-Z ]+RISK)", re.IGNORECASE),
            (r"Existence of Pressure Ulcer\s*:\s*([^\n]+)", re.IGNORECASE),
        ],
    )

    dvt_score = find_first(
        text,
        [
            (r"DVT Score\s*:\s*([0-9.]+)", re.IGNORECASE),
            (r"DVT risk score\s*:\s*([0-9.]+)", re.IGNORECASE),
        ],
    )
    dvt_risk = find_first(
        text,
        [
            (r"DVT Score\s*:\s*[0-9.]+\s+([A-Z ]+RISK)", re.IGNORECASE),
            (r"\bDVT\s*:\s*([A-Z]+)", re.IGNORECASE),
        ],
    )

    aspiration_score = find_first(
        text,
        [
            (r"Aspiration score\s*:\s*([0-9.]+)", re.IGNORECASE),
            (r"NEONATE - ASPIRATION RISK ASSESSMENT TOOL.*?Score\s*:\s*([0-9.]+)", re.IGNORECASE | re.DOTALL),
        ],
    )
    aspiration_risk = find_first(
        text,
        [
            (r"Aspiration score\s*:\s*[0-9.]+\s+([A-Z ]+RISK)", re.IGNORECASE),
            (r"COMMENTS\s*:\s*([A-Z ]+RISK)", re.IGNORECASE),
            (r"Risk for Aspiration\s*:\s*([^\n]+)", re.IGNORECASE),
        ],
    )

    ews_score = find_first(
        text,
        [
            (r"EWS Score\s*:\s*([0-9.]+)", re.IGNORECASE),
            (r"Total Score\s*:\s*([0-9.]+)", re.IGNORECASE),
        ],
    )

    record = {
        "file_name": pdf_path.name,
        "file_stem": pdf_path.stem,
        "source_pdf": str(pdf_path),
        "source_text_file": str(TEXT_DIR / f"{pdf_path.stem}.txt"),
        "candidate_patient_name": patient_name.value,
        "candidate_mrn_or_hospital_no": hospital_no.value,
        "candidate_age": age.value,
        "candidate_gender": gender.value.upper(),
        "candidate_admission_date": admission_date.value,
        "candidate_discharge_date": discharge_date.value,
        "candidate_chief_complaints": chief_complaints.value,
        "candidate_principal_diagnosis": principal_diagnosis.value,
        "candidate_secondary_context": secondary_context.value,
        "candidate_allergies": allergies.value,
        "candidate_current_medications": current_medications.value,
        "candidate_bp": bp.value,
        "candidate_pulse": pulse.value,
        "candidate_temperature_f": temperature.value,
        "candidate_respiration": respiration.value,
        "candidate_spo2": spo2.value,
        "candidate_pain_score": pain_score.value,
        "candidate_fall_score": fall_score.value,
        "candidate_fall_risk": fall_risk.value,
        "candidate_pressure_score": pressure_score.value,
        "candidate_pressure_risk": pressure_risk.value,
        "candidate_dvt_score": dvt_score.value,
        "candidate_dvt_risk": dvt_risk.value,
        "candidate_aspiration_score": aspiration_score.value,
        "candidate_aspiration_risk": aspiration_risk.value,
        "candidate_ews_score": ews_score.value,
        "gt_patient_name": "",
        "gt_mrn_or_hospital_no": "",
        "gt_age": "",
        "gt_gender": "",
        "gt_admission_date": "",
        "gt_discharge_date": "",
        "gt_chief_complaints": "",
        "gt_principal_diagnosis": "",
        "gt_secondary_context": "",
        "gt_allergies": "",
        "gt_current_medications": "",
        "gt_bp": "",
        "gt_pulse": "",
        "gt_temperature_f": "",
        "gt_respiration": "",
        "gt_spo2": "",
        "gt_pain_score": "",
        "gt_fall_score": "",
        "gt_fall_risk": "",
        "gt_pressure_score": "",
        "gt_pressure_risk": "",
        "gt_dvt_score": "",
        "gt_dvt_risk": "",
        "gt_aspiration_score": "",
        "gt_aspiration_risk": "",
        "gt_ews_score": "",
        "review_status": "pending_review",
        "review_notes": "",
    }

    candidate_payload = {
        "file_name": pdf_path.name,
        "source_pdf": str(pdf_path),
        "fields": {
            "patient_name": patient_name.__dict__,
            "mrn_or_hospital_no": hospital_no.__dict__,
            "age": age.__dict__,
            "gender": gender.__dict__,
            "admission_date": admission_date.__dict__,
            "discharge_date": discharge_date.__dict__,
            "chief_complaints": chief_complaints.__dict__,
            "principal_diagnosis": principal_diagnosis.__dict__,
            "secondary_context": secondary_context.__dict__,
            "allergies": allergies.__dict__,
            "current_medications": current_medications.__dict__,
            "bp": bp.__dict__,
            "pulse": pulse.__dict__,
            "temperature_f": temperature.__dict__,
            "respiration": respiration.__dict__,
            "spo2": spo2.__dict__,
            "pain_score": pain_score.__dict__,
            "fall_score": fall_score.__dict__,
            "fall_risk": fall_risk.__dict__,
            "pressure_score": pressure_score.__dict__,
            "pressure_risk": pressure_risk.__dict__,
            "dvt_score": dvt_score.__dict__,
            "dvt_risk": dvt_risk.__dict__,
            "aspiration_score": aspiration_score.__dict__,
            "aspiration_risk": aspiration_risk.__dict__,
            "ews_score": ews_score.__dict__,
        },
    }

    return record, candidate_payload


def write_readme() -> None:
    readme = """# Ground Truth Package

This folder was generated locally without Gemma or any external extraction agent.

Contents:
- `ground_truth_table.csv`: review worksheet with candidate values and blank `gt_*` columns.
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
"""
    (OUTPUT_DIR / "README.md").write_text(readme, encoding="utf-8")


def main() -> None:
    pdftotext_bin = require_pdftotext()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TEXT_DIR.mkdir(parents=True, exist_ok=True)
    CANDIDATE_DIR.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    pdf_files = sorted(INPUT_DIR.glob("*.pdf"), key=sort_key)

    for pdf_path in pdf_files:
        text = extract_text(pdftotext_bin, pdf_path)
        text_path = TEXT_DIR / f"{pdf_path.stem}.txt"
        text_path.write_text(text, encoding="utf-8")

        row, candidate_payload = build_record(pdf_path, text)
        rows.append(row)

        candidate_path = CANDIDATE_DIR / f"{pdf_path.stem}.json"
        candidate_path.write_text(json.dumps(candidate_payload, indent=2, ensure_ascii=False), encoding="utf-8")

    fieldnames = list(rows[0].keys()) if rows else []
    with (OUTPUT_DIR / "ground_truth_table.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    write_readme()
    print(f"Wrote {len(rows)} PDF records to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
