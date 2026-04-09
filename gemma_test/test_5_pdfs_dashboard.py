#!/usr/bin/env python3
"""
Test Gemma LLM with 5 actual PDF files (DischargeSummary1-5)
Generate dashboard card data for each based on the ideology dashboard view
"""

import fitz  # PyMuPDF
import requests
import json
from pathlib import Path

GEMMA_URL = "http://206.1.62.28:8000/v1/chat/completions"
MODEL = "google/gemma-4-26B-A4B-it"


def extract_text_from_pdf(pdf_path: str, max_pages: int = 15) -> str:
    """Extract text from PDF"""
    doc = fitz.open(pdf_path)
    text = ""

    pages_to_read = min(max_pages, len(doc))
    for i in range(pages_to_read):
        page = doc[i]
        text += f"\n=== PAGE {i+1} ===\n{page.get_text()}"

    doc.close()
    return text


def call_gemma_for_dashboard(pdf_text: str, pdf_name: str) -> dict:
    """
    Call Gemma to generate dashboard card data from PDF content
    Based on the ideology dashboard view
    """

    prompt = f"""You are analyzing an ObjectScript/MUMPS discharge summary report class definition.
Extract the data structure and generate sample dashboard card data for an interactive discharge dashboard.

PDF CONTENT (first part of the file):
{pdf_text[:6000]}

Based on this code structure, generate sample dashboard card data. Return ONLY valid JSON:

{{
    "meta": {{
        "pdf_file": "{pdf_name}",
        "report_complexity": "Simple/Standard/Full-Featured",
        "estimated_pages": 0,
        "department_type": "Department"
    }},
    "dashboard_cards": {{
        "vitals_card": {{
            "icon": "📊",
            "title": "Vital Signs",
            "status": "stable/warning/critical",
            "summary": {{"latest_bp": "", "pulse": "", "temp": "", "spo2": ""}},
            "trend": "improving/stable/deteriorating",
            "data_points": 0,
            "has_alerts": true/false
        }},
        "diagnosis_card": {{
            "icon": "🩺",
            "title": "Diagnosis",
            "principal_diagnosis": "",
            "icd_code": "",
            "secondary_count": 0,
            "secondary_diagnoses": [],
            "procedures_count": 0
        }},
        "medications_card": {{
            "icon": "💊",
            "title": "Medications",
            "active_count": 0,
            "allergy_count": 0,
            "allergies": [],
            "categories": []
        }},
        "labs_card": {{
            "icon": "🔬",
            "title": "Laboratory Results",
            "total_tests": 0,
            "abnormal_count": 0,
            "critical_count": 0,
            "pending_count": 0,
            "top_abnormal": ""
        }},
        "radiology_card": {{
            "icon": "🫀",
            "title": "Radiology & Imaging",
            "studies_completed": 0,
            "critical_findings": 0,
            "key_finding": ""
        }},
        "treatment_card": {{
            "icon": "🏥",
            "title": "Treatment & Procedures",
            "procedures_performed": 0,
            "surgeries": 0,
            "response": "Good/Fair/Poor"
        }},
        "clinical_notes_card": {{
            "icon": "📝",
            "title": "Clinical Notes",
            "total_notes": 0,
            "last_update": ""
        }},
        "discharge_plan_card": {{
            "icon": "📋",
            "title": "Discharge Plan",
            "condition": "Stable/Unstable",
            "instruction_count": 0,
            "red_flags": 0
        }},
        "follow_up_card": {{
            "icon": "📅",
            "title": "Follow-Up",
            "next_appointment": "",
            "appointment_count": 0
        }}
    }},
    "sample_patient_data": {{
        "name": "Sample Patient Name",
        "age": 0,
        "mrn": "",
        "admission_date": "",
        "discharge_date": "",
        "los_days": 0,
        "summary": "Brief clinical summary based on the report structure"
    }}
}}"""

    headers = {'Content-Type': 'application/json'}
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 3000
    }

    try:
        response = requests.post(GEMMA_URL, headers=headers, json=payload, timeout=90)
        response.raise_for_status()
        result = response.json()
        content = result['choices'][0]['message']['content']

        # Extract JSON from markdown code blocks if present
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()

        return json.loads(content)
    except Exception as e:
        return {
            "error": str(e),
            "raw_response": content if 'content' in locals() else None
        }


def test_all_5_pdfs():
    """Test all 5 PDF files and generate dashboard data"""

    base_path = "/Users/yavar/Documents/CoE/Manipal/data"
    pdf_files = [
        "Custom.MEXX.Report.ZEN.DischargeSummary1.cls.pdf",
        "Custom.MEXX.Report.ZEN.DischargeSummary2.cls.pdf",
        "Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf",
        "Custom.MEXX.Report.ZEN.DischargeSummary4.cls.pdf",
        "Custom.MEXX.Report.ZEN.DischargeSummary5.cls.pdf"
    ]

    results = []
    all_dashboard_data = []

    print("\n" + "╔" + "="*78 + "╗")
    print("║" + " "*20 + "GEMMA DASHBOARD TEST - 5 PDF FILES" + " "*24 + "║")
    print("╚" + "="*78 + "╝")

    for i, pdf_file in enumerate(pdf_files, 1):
        print(f"\n{'='*80}")
        print(f"TESTING [{i}/5]: {pdf_file}")
        print(f"{'='*80}")

        pdf_path = f"{base_path}/{pdf_file}"

        # Extract text from PDF
        print(f"[1/2] Extracting text from PDF...")
        pdf_text = extract_text_from_pdf(pdf_path, max_pages=15)
        print(f"      Extracted {len(pdf_text)} characters")

        # Get dashboard data from Gemma
        print(f"[2/2] Generating dashboard cards via Gemma...")
        dashboard_data = call_gemma_for_dashboard(pdf_text, pdf_file)

        all_dashboard_data.append({
            "pdf_file": pdf_file,
            "dashboard_data": dashboard_data
        })

        # Display results
        print(f"\n{'─'*80}")
        print(f"DASHBOARD CARD RESULTS:")
        print(f"{'─'*80}")

        if "error" in dashboard_data:
            print(f"❌ ERROR: {dashboard_data['error']}")
        else:
            meta = dashboard_data.get('meta', {})
            cards = dashboard_data.get('dashboard_cards', {})
            sample = dashboard_data.get('sample_patient_data', {})

            print(f"\n📋 METADATA:")
            print(f"   • Complexity: {meta.get('report_complexity', 'N/A')}")
            print(f"   • Department: {meta.get('department_type', 'N/A')}")
            print(f"   • Sample Patient: {sample.get('name', 'N/A')} ({sample.get('age', 'N/A')} {sample.get('mrn', 'N/A')})")

            print(f"\n📊 DASHBOARD CARDS:")
            for card_name, card_data in cards.items():
                if isinstance(card_data, dict):
                    icon = card_data.get('icon', '📄')
                    title = card_data.get('title', card_name.replace('_card', '').title())
                    status = card_data.get('status', card_data.get('summary', card_data.get('principal_diagnosis', 'N/A')))

                    # Get key info based on card type
                    if 'count' in card_data:
                        info = f"Count: {card_data.get('count', 'N/A')}"
                    elif 'active_count' in card_data:
                        info = f"Active: {card_data.get('active_count', 'N/A')}"
                    elif 'total_tests' in card_data:
                        info = f"Tests: {card_data.get('total_tests', 'N/A')} | Abnormal: {card_data.get('abnormal_count', 'N/A')}"
                    elif 'principal_diagnosis' in card_data:
                        info = f"{card_data.get('principal_diagnosis', 'N/A')} ({card_data.get('icd_code', 'N/A')})"
                    elif 'latest_bp' in card_data:
                        summary = card_data.get('summary', {})
                        info = f"BP: {summary.get('latest_bp', 'N/A')} | Pulse: {summary.get('pulse', 'N/A')} | Status: {card_data.get('status', 'N/A')}"
                    elif 'condition' in card_data:
                        info = f"Condition: {card_data.get('condition', 'N/A')} | Instructions: {card_data.get('instruction_count', 'N/A')}"
                    elif 'next_appointment' in card_data:
                        info = f"Next: {card_data.get('next_appointment', 'N/A')} | Total: {card_data.get('appointment_count', 'N/A')}"
                    elif 'procedures_performed' in card_data:
                        info = f"Procedures: {card_data.get('procedures_performed', 'N/A')} | Response: {card_data.get('response', 'N/A')}"
                    else:
                        info = str(status)[:50] if status else "N/A"

                    print(f"   {icon} {title}: {info}")

        results.append(dashboard_data)

    # Save comprehensive results
    save_comprehensive_results(all_dashboard_data)

    return results, all_dashboard_data


def save_comprehensive_results(all_data):
    """Save all results to markdown file"""

    output = f"""# Gemma Dashboard Test Results - 5 PDF Files

**Date:** 2026-04-03
**Test:** Dashboard card generation for Interactive Discharge Dashboard
**PDFs Tested:** DischargeSummary1 through DischargeSummary5

---

## Dashboard View Reference

Based on the ideology dashboard proposal, each discharge summary is analyzed for:

| Card | Icon | Purpose |
|------|------|---------|
| Vitals | 📊 | BP, Pulse, Temp, SpO2 with trends |
| Diagnosis | 🩺 | Principal + Secondary diagnoses, ICD codes |
| Medications | 💊 | Active meds, allergies, categories |
| Labs | 🔬 | Total tests, abnormal/critical/pending counts |
| Radiology | 🫀 | Imaging studies, critical findings |
| Treatment | 🏥 | Procedures, surgeries, response |
| Clinical Notes | 📝 | Nursing notes, timeline |
| Discharge Plan | 📋 | Condition, instructions, red flags |
| Follow-Up | 📅 | Next appointments, count |

---

"""

    for idx, item in enumerate(all_data, 1):
        pdf_file = item['pdf_file']
        data = item['dashboard_data']

        output += f"""## Test {idx}: {pdf_file}

---

"""

        if "error" in data:
            output += f"**ERROR:** {data['error']}\n\n"
            if data.get('raw_response'):
                output += f"**Raw Response:**\n```\n{data['raw_response'][:500]}\n```\n\n"
            continue

        meta = data.get('meta', {})
        cards = data.get('dashboard_cards', {})
        sample = data.get('sample_patient_data', {})

        # Metadata
        output += f"""### 📋 Report Metadata
| Property | Value |
|----------|-------|
| Report Complexity | {meta.get('report_complexity', 'N/A')} |
| Department Type | {meta.get('department_type', 'N/A')} |
| Estimated Pages | {meta.get('estimated_pages', 'N/A')} |

### 👤 Sample Patient Data (Generated)
| Field | Value |
|-------|-------|
| Name | {sample.get('name', 'N/A')} |
| Age | {sample.get('age', 'N/A')} |
| MRN | {sample.get('mrn', 'N/A')} |
| Admission | {sample.get('admission_date', 'N/A')} |
| Discharge | {sample.get('discharge_date', 'N/A')} |
| LOS | {sample.get('los_days', 'N/A')} days |

**Summary:** {sample.get('summary', 'N/A')}

---

### 🎯 Dashboard Card Analysis

#### 📊 Vitals Card
{format_card_data(cards.get('vitals_card', {}))}

#### 🩺 Diagnosis Card
{format_card_data(cards.get('diagnosis_card', {}))}

#### 💊 Medications Card
{format_card_data(cards.get('medications_card', {}))}

#### 🔬 Labs Card
{format_card_data(cards.get('labs_card', {}))}

#### 🫀 Radiology Card
{format_card_data(cards.get('radiology_card', {}))}

#### 🏥 Treatment Card
{format_card_data(cards.get('treatment_card', {}))}

#### 📝 Clinical Notes Card
{format_card_data(cards.get('clinical_notes_card', {}))}

#### 📋 Discharge Plan Card
{format_card_data(cards.get('discharge_plan_card', {}))}

#### 📅 Follow-Up Card
{format_card_data(cards.get('follow_up_card', {}))}

---

"""


def format_card_data(card):
    """Format card data for markdown display"""
    if not card or not isinstance(card, dict):
        return "No data available"

    icon = card.get('icon', '📄')
    title = card.get('title', 'Card')

    lines = [f"**{icon} {title}**\n"]

    for key, value in card.items():
        if key not in ['icon', 'title']:
            if isinstance(value, list):
                if value:
                    lines.append(f"- **{key.replace('_', ' ').title()}:** {', '.join(str(v) for v in value[:3])}")
                    if len(value) > 3:
                        lines.append(f"  - ... and {len(value)-3} more")
            elif isinstance(value, dict):
                items = [f"{k}: {v}" for k, v in value.items() if v and v != 'N/A' and v != '']
                if items:
                    lines.append(f"- **{key.replace('_', ' ').title()}:** {', '.join(items[:3])}")
            elif value and value != 'N/A':
                lines.append(f"- **{key.replace('_', ' ').title()}:** {value}")

    if len(lines) == 1:
        lines.append("- No specific data")

    return '\n'.join(lines)


    # Save the file
    output_path = "/Users/yavar/Documents/CoE/Manipal/gemma_test/dashboard_test_5_pdfs.md"
    with open(output_path, 'w') as f:
        f.write(output)

    print(f"\n{'='*80}")
    print(f"✅ RESULTS SAVED TO: {output_path}")
    print(f"{'='*80}")


if __name__ == "__main__":
    try:
        results, all_data = test_all_5_pdfs()

        print(f"\n{'='*80}")
        print("📊 SUMMARY OF ALL TESTS")
        print(f"{'='*80}")

        success_count = sum(1 for r in results if "error" not in r)
        print(f"✅ Successful: {success_count}/5")
        print(f"❌ Errors: {5-success_count}/5")

        print(f"\nDashboard card generation complete!")
        print(f"Full results saved to: gemma_test/dashboard_test_5_pdfs.md")

    except ImportError:
        print("\n❌ Error: PyMuPDF (fitz) not installed. Installing...")
        import subprocess
        subprocess.run(["pip3", "install", "pymupdf"], check=True)
        print("✅ PyMuPDF installed. Please run the script again.")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
