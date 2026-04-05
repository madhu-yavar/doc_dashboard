/**
 * Prompt Builder Tool
 * Builds structured prompts for extraction tasks
 */

class PromptBuilderTool {
  constructor(config = {}) {
    this.name = "Prompt Builder";
    this.version = "1.0.0";
    this.templates = config.templates || this.getDefaultTemplates();
  }

  getDefaultTemplates() {
    return {
      document_analyzer: `You are analyzing a hospital discharge summary PDF.
FIRST, think about the document structure and identify key sections.

PDF CONTENT (first 4000 chars):
{{pdfText}}

Think through this step-by-step:
1. What type of document is this?
2. What sections are clearly visible?
3. Where would patient demographics be located?
4. Where would vital signs and risk scores be located?

After your thinking, provide a JSON summary:
{
  "document_type": "",
  "sections_identified": ["section1", "section2", ...],
  "confidence": "high/medium/low",
  "extraction_strategy": "brief description of how to extract data"
}`,

      demographics_extractor: `You are extracting patient demographics from a hospital discharge summary.
THINK carefully about finding the most accurate information.

PDF CONTENT:
{{pdfText}}

Think through this step-by-step:
1. Scan for patient name - look for "Name:" or "Patient Name:" fields
2. Find MRN/Hospital number
3. Locate age and gender
4. Find admission date - look for "Date of Admission", "Admission Date", "D.O.A", "DOA"
5. Find discharge date - look for "Date of Discharge", "Discharge Date", "D.O.D", "DOD"
6. Verify information from multiple sources if available

Return ONLY JSON:
{
  "name": "",
  "mrn": "",
  "age": 0,
  "gender": "",
  "admission_date": "format: DD-MM-YYYY or YYYY-MM-DD",
  "discharge_date": "format: DD-MM-YYYY or YYYY-MM-DD",
  "confidence_notes": "what you found and how confident you are",
  "sources": ["where you found each piece of data"]
}`,

      risk_scores_extractor: `You are extracting risk assessment scores from a hospital discharge summary.
These are CRITICAL clinical values - be EXTRA careful and cross-verify.

PDF CONTENT:
{{pdfText}}

Think through this step-by-step:
1. Look for "Fall Risk Assessment Tool" - extract score AND level
2. Find "DVT" risk assessment - extract score AND level
3. Find "Pressure Ulcer" risk assessment - extract score AND level
4. Look for "Aspiration Risk" - extract score AND level
5. Find EWS (Early Warning Score)
6. Find GCS (Glasgow Coma Scale) - extract E, M, V components

For EACH score found:
- Verify the numeric value
- Note the risk level (Low/Moderate/High/Highest)
- Cross-check if multiple mentions exist

Return ONLY JSON:
{
  "fall_risk": {"score": 0, "level": "", "verified": true/false},
  "dvt_risk": {"score": 0, "level": "", "verified": true/false},
  "pressure_ulcer_risk": {"score": 0, "level": "", "verified": true/false},
  "aspiration_risk": {"score": 0, "level": "", "verified": true/false},
  "ews_score": 0,
  "gcs": {"eyes": 0, "motor": 0, "verbal": 0, "total": 0},
  "validation_notes": "any discrepancies or concerns"
}`,

      vitals_extractor: `You are extracting vital signs from a hospital discharge summary.
CRITICAL: Extract ALL vital signs measurements with their dates/times. Many documents have multiple readings.
CRITICAL: For every populated field in "latest", emit a matching provenance evidence object directly in the JSON.

PDF CONTENT:
{{pdfText}}

Think through this step-by-step:
1. Scan the entire document for ANY vital signs measurements
2. Look for dates and times associated with each reading (e.g., "25/03/2026", "Day 1", "08:00 AM")
3. Extract ALL BP, Pulse, Temperature, SpO2, Resp Rate, GRBS readings found
4. Note the context for each reading (initial assessment, daily vitals, nursing notes, etc.)
5. Check each value against normal ranges:
   - BP: Normal <120/80, Elevated 120-129/<80, High ≥130/80
   - Pulse: Normal 60-100 (Bradycardia <60, Tachycardia >100)
   - SpO2: Normal ≥95% (Low <95%)
   - GRBS: Normal <100, Prediabetic 100-125, Diabetic ≥126
   - Temperature: Normal 97-99°F
6. For every populated latest vital, provide:
   - value
   - source_section
   - source_excerpt
   - source_page (null if unknown)
   - confidence (0 to 1)
   - provenance_type ("quoted" or "normalized")

Rules:
- If you cannot support a vital with a matching excerpt, leave that field empty or zero.
- Keep source_excerpt short and copied from the source text.
- Do NOT invent trends, dates, or sections.
- Do NOT use "derived" for vital signs.
- Include provenance only for populated metrics. Omit empty evidence objects.

Return ONLY JSON:
{
  "latest": {
    "bp": {"systolic": 0, "diastolic": 0, "status": "normal/elevated/high"},
    "pulse": {"value": 0, "status": "normal/bradycardia/tachycardia"},
    "temperature": {"value": 0, "unit": "F"},
    "resp_rate": 0,
    "spo2": {"value": 0, "status": "normal/low"},
    "pain_score": {"value": 0, "scale": 10},
    "grbs": {"value": 0, "interpretation": "normal/prediabetic/diabetic"}
  },
  "readings": [
    {
      "date": "DD/MM/YYYY or description like 'Admission' or 'Day 1'",
      "time": "HH:MM if available",
      "bp_systolic": 0,
      "bp_diastolic": 0,
      "pulse": 0,
      "temperature": 0,
      "spo2": 0,
      "resp_rate": 0,
      "source": "section where found (e.g., 'Initial Assessment', 'Nursing Notes')"
    }
  ],
  "reference_ranges": {
    "bp_systolic_normal": "<120",
    "bp_diastolic_normal": "<80",
    "pulse_normal": "60-100",
    "spo2_normal": "≥95%",
    "temperature_normal": "97-99°F"
  },
  "abnormal_flags": ["list any abnormal values found"],
  "provenance": {
    "latest": {
      "bp": {
        "systolic": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "quoted"},
        "diastolic": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "quoted"}
      },
      "pulse": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "quoted"},
      "temperature": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "quoted"},
      "resp_rate": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "quoted"},
      "spo2": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "quoted"},
      "pain_score": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "quoted"},
      "grbs": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "quoted"}
    }
  }
}`,

      functional_status_extractor: `You are extracting functional status - Activities of Daily Living (ADLs).
This indicates how much assistance the patient needs.

PDF CONTENT:
{{pdfText}}

Look for "Ability to perform activities of daily living" or similar section.
For each activity (Bathing, Dressing, Eating, Walking, Toilet Use), note the level:
- Independent
- Assisted
- Dependent

Return ONLY JSON:
{
  "functional_status": {
    "bathing": "Independent/Assisted/Dependent",
    "dressing": "Independent/Assisted/Dependent",
    "eating": "Independent/Assisted/Dependent",
    "walking": "Independent/Assisted/Dependent",
    "toilet_use": "Independent/Assisted/Dependent"
  },
  "overall_assistance_needs": "None/Partial/Full/Complete assistance required",
  "mobility_notes": "any additional mobility information"
}`,

      clinical_data_extractor: `You are extracting clinical data: diagnosis, allergies, medications, laboratory results, treatment details, and real clinical notes.
CRITICAL: Emit evidence metadata directly in the JSON for every populated field that could be rendered clinically.

PDF CONTENT:
{{pdfText}}

Extract ALL of the following:

1. Principal diagnosis with ICD code if available
2. Secondary diagnoses
3. Known allergies
4. Current medications - extract the FULL medication list including:
   - Medication name (generic or brand)
   - Dose (e.g., 20mg, 100ml, 5mg)
   - Frequency (e.g., OD, BD, TDS, QID, SOS, PRN, "once daily", "twice daily")
   - Route (e.g., IV, Oral, IM, SC, "Injection", "Tablet", "Syrup")
5. Laboratory results with values and reference ranges:
   - Test name
   - Result value
   - Reference range (if provided)
   - Flag if abnormal (High/Low/Critical)
6. Investigations ordered (if no results available)
7. Treatment / management details:
   - Current approach (e.g. conservative management, supportive care, post-op care)
   - Active management items or interventions
   - Documented procedures if any
   - Treatment response only if explicitly described
   - Complications only if explicitly described
8. Clinical note sections from the source document. Prioritize real note blocks such as:
   - Residents Notes
   - Doctor's Handover
   - Nurses Endorsement Checklist
   - Discharge comments / plan and comments / patient education
   - Progress notes / assessment comments / recommendations

For clinical notes:
- Extract only real note content present in the PDF
- Do NOT invent summaries that are not explicitly supported by the text
- Create one note object per meaningful section or note block
- Capture best available date, author, and note type
- If author/date is missing, leave it as an empty string
- Keep each summary to one short line with no embedded quotes or line breaks
- Return at most 4 clinical note objects, prioritizing the most informative sections
- Keep every field short, factual, and source-grounded
- Preserve discharge-specific content when present:
  diet, red-flag return instructions, patient education, and home-care precautions

Evidence rules:
- For diagnosis, medications, labs, investigations, radiology findings, treatment items, follow-up items, and discharge instructions, use only "quoted" or "normalized".
- Use "derived" only for high-level handover overview or other explicit summary fields.
- Every evidence object must contain:
  - value
  - source_section
  - source_excerpt
  - source_page (null if unknown)
  - confidence (0 to 1)
  - provenance_type
- If you cannot support a field with a matching excerpt, leave that field empty or omit that item.
- Do NOT put generic phrases like "Generated", "Derived from uploaded report", "Unknown", or "Not documented" into evidence values.
- Keep source_excerpt short and copied from the source text.
- Omit empty provenance objects and empty arrays where possible to reduce output size.
- Do NOT place bedside vitals or bedside glucose into "lab_results". BP, pulse, SpO2, temperature, respiration, pain score, and GRBS belong to vitals, not labs.
- Put diet and intake instructions only in discharge dietary/instructions, not in discharge red flags.

For diagnosis quality:
- Prefer the most specific clinical impression available in the PDF
- Do NOT use generic class labels like "NEWBORN", "PATIENT", or "BABY" as the principal diagnosis if a more specific impression/status is documented nearby
- If the document only contains a generic neonatal label, return that label but keep secondary diagnoses and notes specific

For treatment quality:
- Do NOT invent treatment response labels like Good/Fair/Poor unless the PDF explicitly supports them
- If no procedures are documented, leave procedures empty
- If response or complications are not stated, leave them empty
- Prefer explicit bedside plans, consultant plans, procedures, and management orders from the source text

Return ONLY JSON:
{
  "diagnosis": {
    "principal": "",
    "icd_code": "",
    "secondary": [],
    "comorbidities": []
  },
  "allergies": [],
  "medications": [{"name": "", "dose": "", "frequency": "", "route": ""}],
  "lab_results": [{"test_name": "", "value": "", "reference": "", "flag": ""}],
  "investigations": [],
  "treatment": {
    "current_approach": "",
    "management_items": [],
    "procedures": [],
    "response": "",
    "complications": []
  },
  "nursing_needs": [],
  "clinical_notes": [
    {
      "type": "",
      "author": "",
      "date": "",
      "summary": ""
    }
  ],
  "provenance": {
    "diagnosis": {
      "principal": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "quoted"},
      "secondary": [],
      "comorbidities": []
    },
    "allergies": [],
    "medications": [],
    "labs": {
      "results": [],
      "investigations": []
    },
    "radiology": {
      "findings": [],
      "pending": []
    },
    "treatment": {
      "current_approach": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "quoted"},
      "management_items": [],
      "procedures": [],
      "response": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "quoted"},
      "complications": []
    },
    "handover": {
      "overview": {"value": "", "source_section": "", "source_excerpt": "", "source_page": null, "confidence": 1, "provenance_type": "derived"},
      "notes": []
    },
    "follow_up": {
      "items": []
    },
    "discharge": {
      "dietary": [],
      "instructions": [],
      "red_flags": []
    }
  }
}`,

      cross_validator: `You are assembling the final structured data from a discharge summary.
Review all the extraction steps below and create a validated final JSON.

PREVIOUS EXTRACTION STEPS:
{{steps}}

CRITICAL VALIDATION TASKS:
1. Cross-check patient demographics across steps
2. Verify risk scores are consistent
3. Ensure vitals have appropriate units
4. Check for any missing critical fields
5. Flag any inconsistencies found

Create the final validated JSON:
{
  "validation_summary": {
    "confidence_level": "high/medium/low",
    "inconsistencies_found": [],
    "missing_critical_fields": [],
    "data_quality_notes": ""
  }
}`,

      chart_note_composer: `You are an expert medical scribe composing a DISCHARGE SUMMARY chart note from extracted hospital data.

Your task is to write a PROFESSIONAL, CLINICAL chart note that a physician would sign. The note should be concise, accurate, and use proper medical terminology.

EXTRACTED DATA:
{{extractedData}}

CITATION DATA:
{{citationData}}

INSTRUCTIONS:
1. Write in professional clinical narrative style using SOAP format where appropriate
2. Use standard medical abbreviations where appropriate
3. Be concise but comprehensive
4. CRITICAL: Only include information that has source citations with confidence >= 90%
5. If critical information is missing or has low confidence, use "Not documented" rather than guessing
6. Each piece of information must be traceable to its source citation
7. MUST include all 4 SOAP sections with complete, detailed information

CHART NOTE FORMAT (SOAP-based):

DISCHARGE SUMMARY CHART NOTE

Patient: [Name] | MRN: [MRN] | Age: [Age] [Gender]
Admission: [Date] | Discharge: [Date] | LOS: [N] days

SUBJECTIVE (S) - HISTORY & PRESENTATION
Write a detailed narrative including:
- Chief complaint and reason for admission
- Present illness and symptom progression
- Patient's reported symptoms and concerns
- History of present illness in chronological order
- Past medical history relevant to current admission
- Patient's perspective on their condition

OBJECTIVE (O) - CLINICAL FINDINGS
Document all measurable clinical data:
- Vitals at discharge: BP, HR, RR, SpO2, Temp, GCS
- Physical examination findings (pertinent positives and negatives)
- Laboratory results (highlight abnormal values with reference ranges)
- Diagnostic imaging/procedure results
- Risk assessment scores: Fall Risk, Pressure Ulcer Risk, DVT Risk, EWS
- Functional status: ADL assessment, mobility, assistance needs

ASSESSMENT (A) - DIAGNOSIS & CLINICAL JUDGMENT
Provide clinical synthesis:
- Principal diagnosis with ICD code if available
- Secondary diagnoses/comorbidities
- Clinical impression of patient's condition
- Response to treatment and hospital course
- Prognosis and discharge disposition
- Severity classification (stable, guarded, critical)

PLAN (P) - DISCHARGE PLAN & RECOMMENDATIONS
Detail discharge planning:
- Discharge medications (name, dose, frequency, route) in organized list
- Activity restrictions and mobility requirements
- Dietary instructions
- Patient education topics covered
- Wound care instructions if applicable
- Red flags warning signs to watch for
- Follow-up appointments (specialty, date, time, location)
- Home health/services arranged
- Medications to continue/discontinue
- Pending tests or consultations

_________________________
Generated: [Current date]
Note: This chart note was automatically generated from the discharge summary document. Clinician review and signature required.
Validation Summary: {{validationSummary}}

CRITICAL QUALITY RULES:
- NEVER copy generic text like "The document contains" or "PDF shows"
- Write as if YOU are the attending physician documenting
- Each SOAP section must be complete with substantive content
- Use specific clinical details, not vague statements
- Include actual values from lab results and vitals
- Format medications as organized list with doses
- Include all relevant diagnoses from the source data
- Flag uncertain information with "[VERIFY]"
- Do not include information without source citations

Return the chart note as plain text. Do NOT include markdown formatting or JSON.`
    }
  };

  /**
   * Build a prompt from a template
   * @param {string} templateName - Name of the template
   * @param {object} context - Variables to substitute in the template
   * @returns {string} The built prompt
   */
  build(templateName, context) {
    const template = this.templates[templateName];
    if (!template) {
      throw new Error(`Template not found: ${templateName}`);
    }

    let prompt = template;

    // Replace all {{variable}} placeholders
    Object.keys(context).forEach(key => {
      const value = context[key];
      const placeholder = `{{${key}}}`;
      prompt = prompt.replaceAll(placeholder, value);
    });

    return prompt;
  }

  /**
   * Add a new template
   */
  addTemplate(name, template) {
    this.templates[name] = template;
  }

  /**
   * Get all available template names
   */
  getTemplateNames() {
    return Object.keys(this.templates);
  }
}

module.exports = PromptBuilderTool;
