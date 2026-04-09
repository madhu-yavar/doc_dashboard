#!/usr/bin/env python3
"""
Gemma-Powered Discharge Dashboard Prototype
FastAPI backend + React frontend
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
import requests
import uvicorn
import json
import os

# Configuration
GEMMA_URL = "http://206.1.62.28:8000/v1/chat/completions"
MODEL = "google/gemma-4-26B-A4B-it"

app = FastAPI(title="Discharge Dashboard", version="1.0.0")

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Data Models
# ============================================================================

class DashboardCard(BaseModel):
    title: str
    icon: str
    status: str
    data: dict


class VitalsCard(DashboardCard):
    pass


class DiagnosisCard(DashboardCard):
    pass


class MedicationsCard(DashboardCard):
    pass


class LabsCard(DashboardCard):
    pass


class DischargeSummary(BaseModel):
    patient_name: str
    age: int
    mrn: str
    admission_date: str
    discharge_date: str
    los_days: int
    department: str
    diagnosis: str
    vitals: dict
    medications: List[str]
    labs: dict
    discharge_status: str


# ============================================================================
# Gemma Integration
# ============================================================================

def call_gemma(prompt: str, max_tokens: int = 2000) -> dict:
    """Call Gemma LLM API"""
    try:
        response = requests.post(
            GEMMA_URL,
            json={
                "model": MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "max_tokens": max_tokens,
            },
            timeout=90
        )
        response.raise_for_status()
        result = response.json()

        # Extract JSON from response if wrapped in markdown
        content = result['choices'][0]['message']['content']
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()

        return json.loads(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemma API error: {str(e)}")


def extract_pdf_data(pdf_path: str) -> str:
    """Extract text from PDF (using fitz)"""
    try:
        import fitz
        doc = fitz.open(pdf_path)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        return text[:10000]  # First 10K chars
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF extraction error: {str(e)}")


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/")
async def root():
    return {"message": "Gemma-Powered Discharge Dashboard API", "version": "1.0.0"}


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Test Gemma connection
        response = requests.post(
            GEMMA_URL,
            json={"model": MODEL, "messages": [{"role": "user", "content": "Hi"}], "max_tokens": 10},
            timeout=10
        )
        is_healthy = response.status_code == 200
        return {"status": "healthy" if is_healthy else "degraded", "gemma": "connected" if is_healthy else "disconnected"}
    except:
        return {"status": "unhealthy", "gemma": "disconnected"}


@app.post("/api/analyze-pdf")
async def analyze_pdf(pdf_path: str):
    """Analyze a PDF file and return dashboard data"""
    # Extract PDF text
    pdf_text = extract_pdf_data(pdf_path)

    # Get dashboard cards from Gemma
    prompt = f"""Analyze this discharge summary code and generate dashboard card data:

{pdf_text}

Return ONLY JSON:
{{
    "vitals_card": {{"icon": "📊", "title": "Vitals", "status": "stable/warning/critical", "summary": {{}}}},
    "diagnosis_card": {{"icon": "🩺", "title": "Diagnosis", "principal": "", "icd": ""}},
    "medications_card": {{"icon": "💊", "title": "Medications", "active_count": 0, "allergies": []}},
    "labs_card": {{"icon": "🔬", "title": "Labs", "total": 0, "abnormal": 0}},
    "discharge_plan_card": {{"icon": "📋", "title": "Discharge Plan", "condition": "", "instructions": 0}},
    "sample_patient": {{"name": "", "age": 0, "mrn": ""}}
}}"""

    result = call_gemma(prompt)
    return result


@app.post("/api/dashboard-cards")
async def get_dashboard_cards(patient_data: dict):
    """Generate dashboard cards from patient data"""
    prompt = f"""Generate dashboard card data for this patient:

{json.dumps(patient_data)}

Return ONLY JSON with 9 dashboard cards (vitals, diagnosis, medications, labs, radiology, treatment, notes, discharge, follow_up)."""

    result = call_gemma(prompt, max_tokens=1500)
    return result


@app.post("/api/clinical-insights")
async def get_clinical_insights(patient_data: dict):
    """Generate clinical insights and recommendations"""
    prompt = f"""Provide clinical insights for this patient:

{json.dumps(patient_data)}

Include:
1. Key clinical findings
2. Potential risks
3. Recommendations
4. Red flags to monitor

Return as JSON."""

    result = call_gemma(prompt, max_tokens=1500)
    return result


@app.post("/api/patient-instructions")
async def generate_patient_instructions(patient_data: dict):
    """Generate patient-friendly discharge instructions"""
    prompt = f"""Generate patient-friendly discharge instructions:

{json.dumps(patient_data)}

Use simple language (8th grade level). Include:
- What to do
- What NOT to do
- Warning signs
- Medication tips

Return as JSON."""

    result = call_gemma(prompt, max_tokens=1500)
    return result


@app.post("/api/medication-check")
async def check_medications(medications: List[str], allergies: List[str]):
    """Check for drug interactions and allergies"""
    prompt = f"""Check these medications for interactions and allergies:

Medications: {', '.join(medications)}
Allergies: {', '.join(allergies)}

Return JSON with:
- interactions (list)
- allergy_concerns (list)
- recommendations (list)
- adherence_tips (list)"""

    result = call_gemma(prompt, max_tokens=1000)
    return result


# ============================================================================
# Run Server
# ============================================================================

if __name__ == "__main__":
    print("""
╔══════════════════════════════════════════════════════════════════╗
║                                                                ║
║          GEMMA-POWERED DISCHARGE DASHBOARD PROTOTYPE            ║
║                                                                ║
║          Starting API Server on http://localhost:8000          ║
║                                                                ║
║          API Endpoints:                                          ║
║          - POST /api/analyze-pdf                                ║
║          - POST /api/dashboard-cards                            ║
║          - POST /api/clinical-insights                          ║
║          - POST /api/patient-instructions                      ║
║          - POST /api/medication-check                           ║
║                                                                ║
║          Press Ctrl+C to stop                                   ║
║                                                                ║
╚══════════════════════════════════════════════════════════════════╝
    """)

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
