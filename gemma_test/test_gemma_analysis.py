#!/usr/bin/env python3
"""
Test Gemma LLM for analyzing discharge summary data
"""

import requests
import json

# Gemma API endpoint
GEMMA_URL = "http://206.1.62.28:8000/v1/chat/completions"
MODEL = "google/gemma-4-26B-A4B-it"

# Sample discharge summary data (based on the EDA analysis)
SAMPLE_DISCHARGE_SUMMARY = """
PATIENT DEMOGRAPHICS:
- Name: John Smith
- MRN: 12345678
- Age: 54 years
- Gender: Male
- DOB: 15-Mar-1972
- Blood Group: A+
- Contact: (555) 234-5678
- Address: 123 Main St, Bangalore

ADMISSION DETAILS:
- Admission Date: 15-Mar-2026 08:30
- Discharge Date: 20-Mar-2026 14:00
- Length of Stay: 5 days
- Department: Cardiology
- Ward: 3C, Bed: 15
- Admission Type: Emergency
- Attending Physician: Dr. Robert Smith
- Primary Diagnosis on Admission: Acute Chest Pain

VITAL SIGNS (Last 5 Days):
Day 1 (Mar 15): BP 158/95, Pulse 92, Temp 98.6°F, Resp 18, SpO2 96%
Day 2 (Mar 16): BP 145/88, Pulse 84, Temp 98.4°F, Resp 16, SpO2 97%
Day 3 (Mar 17): BP 135/85, Pulse 78, Temp 98.4°F, Resp 16, SpO2 98%
Day 4 (Mar 18): BP 132/82, Pulse 75, Temp 98.4°F, Resp 16, SpO2 98%
Day 5 (Mar 19): BP 130/82, Pulse 72, Temp 98.4°F, Resp 16, SpO2 98%

DIAGNOSIS:
Principal Diagnosis:
- Acute ST-Elevation Myocardial Infarction (STEMI)
- ICD-10 Code: I21.0
- Confirmed by: ECG (ST elevation V1-V4), Troponin I peak 2.5 ng/mL

Secondary Diagnoses:
1. Essential (Primary) Hypertension - ICD-10: I10
2. Type 2 Diabetes Mellitus without complications - ICD-10: E11.9
3. Dyslipidemia - ICD-10: E78.5

LAB RESULTS:
Hematology:
- Hemoglobin: 14.2 g/dL (Normal: 13.5-17.5)
- WBC Count: 7.8 ×10⁹/L (Normal: 4.5-11.0)
- Platelets: 245 ×10⁹/L (Normal: 150-400)

Cardiac Enzymes:
- Troponin I: 2.5 ng/mL (Normal: <0.5) - IMPROVING TREND
  Mar 15 09:30: 2.5 ng/mL
  Mar 15 18:00: 1.8 ng/mL
  Mar 16 06:00: 1.2 ng/mL
  Mar 16 18:00: 0.8 ng/mL
  Mar 17 06:00: 0.5 ng/mL
  Mar 18 06:00: 0.3 ng/mL

Metabolic Panel:
- Sodium: 140 mmol/L (Normal: 135-145)
- Potassium: 4.2 mmol/L (Normal: 3.5-5.1)
- Creatinine: 1.0 mg/dL (Normal: 0.7-1.3)
- HbA1c: 7.2% (Normal: <6.5) - ELEVATED
- LDL Cholesterol: 135 mg/dL (Normal: <100) - ELEVATED
- Triglycerides: 220 mg/dL (Normal: <150) - ELEVATED

RADIOLOGY:
2D Echocardiogram (Mar 16):
- LVEF: 45% (Mildly reduced)
- Regional wall motion abnormality: Anterior and septal hypokinesis
- Mitral regurgitation: Mild
- Impression: Consistent with acute anterior MI

Coronary Angiography (Mar 16):
- LAD: 60% stenosis in mid-segment
- LCx: 30% stenosis (non-significant)
- RCA: Normal
- Recommendation: Consider PCI to LAD

MEDICATIONS ON DISCHARGE:
1. Aspirin 100mg - Once daily
2. Metoprolol Tartrate 50mg - Twice daily
3. Atorvastatin 20mg - At bedtime
4. Ramipril 5mg - Once daily
5. Metformin 500mg - Twice daily

ALLERGIES:
- Penicillin (Severe - Anaphylaxis, 2020)
- Sulfonamides (Mild - Rash, 2018)

PROCEDURES PERFORMED:
1. Coronary Angiography - Mar 16
2. Temporary Pacemaker Insertion - Mar 15 (Removed Mar 16)
3. Echocardiogram - Mar 16

DISCHARGE CONDITION:
- Afebrile for 48 hours
- Hemodynamically stable
- No chest pain at rest
- Cardiac rhythm: Normal sinus rhythm
- Status: STABLE

DISCHARGE INSTRUCTIONS:
- Low sodium, low fat diet (<2g sodium/day)
- No heavy lifting for 2 weeks
- No driving for 2 weeks
- Cardiac rehabilitation recommended
- Compliance with medications

RED FLAGS - Seek immediate care for:
- Chest pain or discomfort
- Shortness of breath
- Dizziness or fainting
- Rapid or irregular heartbeat

FOLLOW-UP:
- Cardiology: Dr. Smith on Apr 15, 2026 at 10:00 AM
- Cardiac Rehab Orientation: Apr 5, 2026 at 2:00 PM
- Primary Care: Within 2 weeks
"""

def call_gemma(prompt, temperature=0.3):
    """Call Gemma API with the given prompt"""
    headers = {
        'Content-Type': 'application/json'
    }

    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": temperature,
        "max_tokens": 2000
    }

    try:
        response = requests.post(GEMMA_URL, headers=headers, json=payload, timeout=60)
        response.raise_for_status()
        result = response.json()
        return result['choices'][0]['message']['content']
    except Exception as e:
        return f"Error: {str(e)}"


def test_summary_generation():
    """Test 1: Generate a concise summary from the discharge data"""
    print("=" * 80)
    print("TEST 1: Summary Generation")
    print("=" * 80)

    prompt = f"""You are a medical AI assistant. Analyze the following discharge summary and provide a CONCISE summary for a doctor who needs to quickly understand the patient's status.

{SAMPLE_DISCHARGE_SUMMARY}

Provide the summary in the following JSON format:
{{
    "patient_summary": {{
        "name": "Patient Name",
        "age": 0,
        "mrn": "MRN",
        "los_days": 0,
        "discharge_status": "Status"
    }},
    "key_clinical_points": [
        "Point 1",
        "Point 2",
        "Point 3"
    ],
    "principal_diagnosis": {{
        "condition": "Diagnosis name",
        "icd_code": "Code"
    }},
    "critical_findings": [
        {{
            "category": "Category (Labs/Vitals/Radiology)",
            "finding": "Finding description",
            "severity": "Critical/Warning/Normal"
        }}
    ],
    "discharge_medications": [
        {{"medication": "Name", "dose": "Dose", "frequency": "Freq"}}
    ],
    "follow_up_needed": [
        "Follow-up item 1",
        "Follow-up item 2"
    ]
}}"""

    result = call_gemma(prompt)
    print(result)
    print("\n")


def test_section_extraction():
    """Test 2: Extract specific sections for the dashboard"""
    print("=" * 80)
    print("TEST 2: Section Extraction (Dashboard Cards)")
    print("=" * 80)

    prompt = f"""You are building an interactive medical dashboard. Extract data for dashboard summary cards from this discharge summary:

{SAMPLE_DISCHARGE_SUMMARY}

Return ONLY valid JSON in this exact format for 6 dashboard cards:
{{
    "vitals_card": {{
        "status": "stable/warning/critical",
        "latest_readings": {{
            "bp_systolic": 0,
            "bp_diastolic": 0,
            "pulse": 0,
            "temp": 0,
            "spo2": 0
        }},
        "trend": "improving/stable/deteriorating",
        "alert_count": 0
    }},
    "diagnosis_card": {{
        "principal": "Diagnosis name",
        "icd_code": "Code",
        "secondary_count": 0,
        "secondary_diagnoses": ["Diagnosis 1", "Diagnosis 2"]
    }},
    "medications_card": {{
        "active_count": 0,
        "allergy_count": 0,
        "allergies": ["Allergy 1 - Severity", "Allergy 2 - Severity"]
    }},
    "labs_card": {{
        "total_tests": 0,
        "abnormal_count": 0,
        "critical_count": 0,
        "top_abnormal": "Most significant abnormal value with result"
    }},
    "radiology_card": {{
        "completed_studies": 0,
        "critical_findings": 0,
        "key_finding": "Most important radiology finding"
    }},
    "discharge_card": {{
        "condition": "Condition at discharge",
        "instruction_categories": 0,
        "follow_up_count": 0
    }}
}}"""

    result = call_gemma(prompt)
    print(result)
    print("\n")


def test_vitals_analysis():
    """Test 3: Analyze vitals trend and generate insights"""
    print("=" * 80)
    print("TEST 3: Vitals Trend Analysis")
    print("=" * 80)

    prompt = f"""Analyze the vital signs data from this discharge summary and provide clinical insights:

{SAMPLE_DISCHARGE_SUMMARY}

Focus on:
1. Which vitals showed abnormal values on admission?
2. What is the trend over the 5 days?
3. Are there any vitals that need monitoring post-discharge?

Return as JSON:
{{
    "admission_abnormalities": [
        {{"vital": "Name", "value": "Value", "normal_range": "Range"}}
    ],
    "trend_analysis": {{
        "bp_trend": "improving/stable/worsening - description",
        "pulse_trend": "improving/stable/worsening - description",
        "overall_assessment": "Overall trend description"
    }},
    "discharge_status": {{
        "all_vitals_normal": true/false,
        "requires_monitoring": ["Vital 1", "Vital 2"]
    }},
    "clinical_insight": "Brief clinical interpretation of the vitals data"
}}"""

    result = call_gemma(prompt)
    print(result)
    print("\n")


def test_medication_reconciliation():
    """Test 4: Medication analysis and recommendations"""
    print("=" * 80)
    print("TEST 4: Medication Reconciliation Analysis")
    print("=" * 80)

    prompt = f"""You are a clinical pharmacist AI. Analyze the medications in this discharge summary:

{SAMPLE_DISCHARGE_SUMMARY}

Provide:
1. Are there any drug-drug interactions to flag?
2. Do the medications align with the diagnoses?
3. Are there any allergy concerns?
4. What patient education points are important?

Return as JSON:
{{
    "interaction_check": {{
        "has_interactions": true/false,
        "interactions": [
            {{
                "medication_1": "Drug 1",
                "medication_2": "Drug 2",
                "severity": "Major/Moderate/Minor",
                "recommendation": "Action needed"
            }}
        ]
    }},
    "diagnosis_alignment": {{
        "aligned": true/false,
        "gaps": ["Any missing treatments"]
    }},
    "allergy_review": {{
        "has_concerns": true/false,
        "concerns": ["Specific allergy concerns"]
    }},
    "patient_education": [
        "Key education point 1",
        "Key education point 2"
    ]
}}"""

    result = call_gemma(prompt)
    print(result)
    print("\n")


def test_discharge_instructions_summary():
    """Test 5: Generate patient-friendly discharge instructions"""
    print("=" * 80)
    print("TEST 5: Patient-Facing Discharge Instructions")
    print("=" * 80)

    prompt = f"""Create patient-friendly discharge instructions from this medical summary:

{SAMPLE_DISCHARGE_SUMMARY}

The output should be:
- Written in simple language (8th grade reading level)
- Organized with clear headings
- Include what to do and what NOT to do
- List warning signs clearly
- Format as if printing for the patient

Return as JSON:
{{
    "patient_name": "Name",
    "discharge_date": "Date",
    "sections": [
        {{
            "title": "Section Title",
            "icon": "emoji",
            "items": [
                "Instruction 1",
                "Instruction 2"
            ]
        }}
    ],
    "warning_signs": [
        "Warning sign 1 - what to do",
        "Warning sign 2 - what to do"
    ],
    "next_appointments": [
        {{"doctor": "Dr Name", "date": "Date", "time": "Time", "location": "Location"}}
    ],
    "contact_info": {{
        "doctor_name": "Name",
        "phone": "Phone",
        "emergency": "When to call emergency"
    }}
}}"""

    result = call_gemma(prompt)
    print(result)
    print("\n")


def test_radiology_summary():
    """Test 6: Radiology findings summary"""
    print("=" * 80)
    print("TEST 6: Radiology Findings Summary")
    print("=" * 80)

    prompt = f"""Extract and summarize radiology findings from this discharge summary:

{SAMPLE_DISCHARGE_SUMMARY}

Focus on:
1. What studies were performed?
2. What are the key findings?
3. What requires follow-up?

Return as JSON:
{{
    "studies": [
        {{
            "type": "Study type",
            "date": "Date",
            "key_findings": ["Finding 1", "Finding 2"],
            "impression": "Overall impression"
        }}
    ],
    "critical_findings": [
        {{
            "study": "Study name",
            "finding": "Critical finding",
            "severity": "Critical/Warning"
        }}
    ],
    "recommendations": [
        "Recommendation 1",
        "Recommendation 2"
    ],
    "follow_up_required": [
        {{"test": "Test name", "reason": "Why"}}
    ]
}}"""

    result = call_gemma(prompt)
    print("\n")


if __name__ == "__main__":
    print("\n")
    print("╔" + "=" * 78 + "╗")
    print("║" + " " * 15 + "GEMMA LLM MEDICAL ANALYSIS TEST" + " " * 29 + "║")
    print("╚" + "=" * 78 + "╝")
    print("\n")

    # Run all tests
    test_summary_generation()
    test_section_extraction()
    test_vitals_analysis()
    test_medication_reconciliation()
    test_discharge_instructions_summary()
    test_radiology_summary()

    print("=" * 80)
    print("ALL TESTS COMPLETED")
    print("=" * 80)
