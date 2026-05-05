#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path("/Users/yavar/Documents/CoE/Manipal")
RAW_DIR = ROOT / "agent_extraction_review" / "raw_results"
DOCUMENTS_PATH = ROOT / "doctor_dashboard" / "server" / "storage" / "documents.json"


def main():
    documents_payload = json.loads(DOCUMENTS_PATH.read_text(encoding="utf-8"))
    documents = documents_payload.get("documents", [])

    raw_results = {}
    for raw_file in RAW_DIR.glob("*.json"):
        payload = json.loads(raw_file.read_text(encoding="utf-8"))
        pdf_name = payload.get("summary", {}).get("pdfName") or payload.get("extractedData", {}).get("meta", {}).get("pdf_file")
        if pdf_name:
            raw_results[pdf_name] = payload

    updated = 0

    for document in documents:
        result = document.get("result")
        if not isinstance(result, dict):
            continue

        pdf_name = result.get("meta", {}).get("pdf_file") or document.get("name")
        raw_payload = raw_results.get(pdf_name)
        if not raw_payload:
            continue

        extracted = raw_payload.get("extractedData", {})
        dashboard_cards = result.setdefault("dashboard_cards", {})
        medications_card = dashboard_cards.setdefault("medications_card", {})
        labs_card = dashboard_cards.setdefault("labs_card", {})

        if "extracted_data" not in result:
            result["extracted_data"] = extracted

        if "medication_list" not in medications_card:
            medications_card["medication_list"] = [
                {
                    "name": medication.get("name"),
                    "dose": medication.get("dose"),
                    "frequency": medication.get("frequency"),
                }
                for medication in extracted.get("medications", [])
            ]

        if "investigations_list" not in labs_card:
            labs_card["investigations_list"] = extracted.get("investigations", [])

        if "lab_results" not in labs_card:
            labs_card["lab_results"] = [
                {
                    "test": result_item.get("test_name") or result_item.get("test") or "Unknown",
                    "value": result_item.get("value") or "",
                    "reference": result_item.get("reference") or result_item.get("ref") or "N/A",
                    "flag": result_item.get("flag") or result_item.get("status") or "",
                }
                for result_item in extracted.get("lab_results", [])
            ]

        if "has_results" not in labs_card:
            labs_card["has_results"] = len(labs_card.get("lab_results", [])) > 0

        if "note" not in labs_card:
            if labs_card.get("has_results"):
                labs_card["note"] = f"{len(labs_card.get('lab_results', []))} lab results documented"
            elif labs_card.get("investigations_list"):
                labs_card["note"] = "Investigations ordered (results not in document)"
            else:
                labs_card["note"] = "No laboratory data documented"

        updated += 1

    DOCUMENTS_PATH.write_text(json.dumps(documents_payload, indent=2), encoding="utf-8")
    print(f"Backfilled {updated} processed documents")


if __name__ == "__main__":
    main()
