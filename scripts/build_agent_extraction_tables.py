#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
from pathlib import Path


ROOT = Path("/Users/yavar/Documents/CoE/Manipal")
OUTPUT_DIR = ROOT / "agent_extraction_review"
RAW_DIR = OUTPUT_DIR / "raw_results"


def join_array(value, separator=" | "):
    if not isinstance(value, list):
        return ""
    parts = []
    for item in value:
        if item is None:
            continue
        if isinstance(item, str):
            text = item.strip()
        else:
            text = json.dumps(item, ensure_ascii=True)
        if text:
            parts.append(text)
    return separator.join(parts)


def format_medications(value):
    if not isinstance(value, list):
        return ""
    rows = []
    for item in value:
        if isinstance(item, dict):
            parts = [item.get("name", ""), item.get("dose", ""), item.get("frequency", "")]
            text = " ".join(part for part in parts if part)
        else:
            text = str(item)
        text = text.strip()
        if text:
            rows.append(text)
    return " | ".join(rows)


def format_functional_status(value):
    if not isinstance(value, dict):
        return ""
    return " | ".join(f"{key}:{val}" for key, val in value.items())


def sort_key(path: Path):
    name = path.name
    if "DischargeSummary" in name:
        suffix = name.split("DischargeSummary", 1)[1].split(".", 1)[0]
        if suffix.isdigit():
            return (int(suffix), name)
    return (10_000, name)


def flatten_extraction(payload: dict) -> dict:
    summary = payload.get("summary", {})
    extracted = payload.get("extractedData", {})
    patient = extracted.get("patient", {})
    vitals = extracted.get("vitals", {})
    risk_scores = extracted.get("risk_scores", {})
    diagnosis = extracted.get("diagnosis", {})
    functional_status = extracted.get("functional_status", {})
    validation = payload.get("validation", {})
    steps = payload.get("steps", [])

    step_errors = []
    for step in steps:
        if step.get("success") is False:
            step_errors.append(f"{step.get('step', 'unknown')}: {step.get('error', 'Unknown error')}")

    return {
        "file_name": summary.get("pdfName", ""),
        "success": str(payload.get("success") is True).lower(),
        "total_latency_ms": summary.get("totalLatency", ""),
        "tokens_used": summary.get("tokensUsed", ""),
        "steps_count": summary.get("stepsCount", ""),
        "successful_steps": len([step for step in steps if step.get("success")]),
        "failed_steps": len([step for step in steps if step.get("success") is False]),
        "confidence_level": validation.get("confidence_level", ""),
        "missing_critical_fields": join_array(validation.get("missing_critical_fields")),
        "inconsistencies_found": join_array(validation.get("inconsistencies_found")),
        "parser_note": extracted.get("parser_note", ""),
        "patient_name": patient.get("name", ""),
        "mrn": patient.get("mrn", ""),
        "age": patient.get("age", ""),
        "gender": patient.get("gender", ""),
        "admission_date": patient.get("admission_date", ""),
        "discharge_date": patient.get("discharge_date", ""),
        "principal_diagnosis": diagnosis.get("principal", ""),
        "secondary_diagnoses": join_array(diagnosis.get("secondary")),
        "allergies": join_array(extracted.get("allergies")),
        "medications": format_medications(extracted.get("medications")),
        "investigations": join_array(extracted.get("investigations")),
        "nursing_needs": join_array(extracted.get("nursing_needs")),
        "bp_systolic": vitals.get("bp", {}).get("systolic", ""),
        "bp_diastolic": vitals.get("bp", {}).get("diastolic", ""),
        "bp_status": vitals.get("bp", {}).get("status", ""),
        "pulse": vitals.get("pulse", {}).get("value", ""),
        "pulse_status": vitals.get("pulse", {}).get("status", ""),
        "temperature_f": vitals.get("temperature", {}).get("value", ""),
        "temperature_unit": vitals.get("temperature", {}).get("unit", ""),
        "resp_rate": vitals.get("resp_rate", ""),
        "spo2": vitals.get("spo2", {}).get("value", ""),
        "spo2_status": vitals.get("spo2", {}).get("status", ""),
        "pain_score": vitals.get("pain_score", {}).get("value", ""),
        "grbs": vitals.get("grbs", {}).get("value", ""),
        "ews_score": risk_scores.get("ews_score", ""),
        "gcs_total": risk_scores.get("gcs", {}).get("total", ""),
        "fall_score": risk_scores.get("fall_risk", {}).get("score", ""),
        "fall_level": risk_scores.get("fall_risk", {}).get("level", ""),
        "pressure_score": risk_scores.get("pressure_ulcer_risk", {}).get("score", ""),
        "pressure_level": risk_scores.get("pressure_ulcer_risk", {}).get("level", ""),
        "dvt_score": risk_scores.get("dvt_risk", {}).get("score", ""),
        "dvt_level": risk_scores.get("dvt_risk", {}).get("level", ""),
        "aspiration_score": risk_scores.get("aspiration_risk", {}).get("score", ""),
        "aspiration_level": risk_scores.get("aspiration_risk", {}).get("level", ""),
        "overall_assistance_needs": functional_status.get("overall_assistance_needs", ""),
        "functional_status": format_functional_status(functional_status.get("functional_status")),
        "mobility_notes": functional_status.get("mobility_notes", ""),
        "abnormal_flags": join_array(vitals.get("abnormal_flags")),
        "step_errors": " | ".join(step_errors),
    }


def flatten_steps(payload: dict) -> list[dict]:
    file_name = payload.get("summary", {}).get("pdfName", "")
    rows = []
    for step in payload.get("steps", []):
        rows.append(
            {
                "file_name": file_name,
                "step_name": step.get("step", ""),
                "success": str(step.get("success") is True).lower(),
                "tokens": step.get("tokens", ""),
                "latency_ms": step.get("latency", ""),
                "data_keys": join_array(step.get("dataKeys")),
                "validation_issues": step.get("validationIssues", 0),
                "error": step.get("error", ""),
            }
        )
    return rows


def write_csv(path: Path, rows: list[dict]):
    if not rows:
      path.write_text("", encoding="utf-8")
      return

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    raw_files = sorted(RAW_DIR.glob("*.json"), key=sort_key)
    extraction_rows = []
    step_rows = []
    total_tokens = 0
    total_latency = 0

    for raw_file in raw_files:
        payload = json.loads(raw_file.read_text(encoding="utf-8"))
        extraction_rows.append(flatten_extraction(payload))
        step_rows.extend(flatten_steps(payload))
        total_tokens += int(payload.get("summary", {}).get("tokensUsed", 0) or 0)
        total_latency += int(payload.get("summary", {}).get("totalLatency", 0) or 0)

    write_csv(OUTPUT_DIR / "agent_extraction_table.csv", extraction_rows)
    write_csv(OUTPUT_DIR / "agent_step_metrics.csv", step_rows)

    summary_lines = [
        "# Agent Extraction Review",
        "",
        f"Files processed: {len(extraction_rows)}",
        f"Successful files: {sum(1 for row in extraction_rows if row['success'] == 'true')}",
        f"Failed files: {sum(1 for row in extraction_rows if row['success'] != 'true')}",
        f"Total tokens used: {total_tokens}",
        f"Average latency (ms): {round(total_latency / len(extraction_rows)) if extraction_rows else 0}",
        "",
        "Contents:",
        "- `agent_extraction_table.csv`: flattened extraction output per PDF",
        "- `agent_step_metrics.csv`: step-level success, latency, and token usage per PDF",
        "- `raw_results/`: full JSON response per PDF",
    ]
    (OUTPUT_DIR / "README.md").write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

    print(f"Wrote {len(extraction_rows)} extraction rows to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
