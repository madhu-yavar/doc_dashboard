# PHI Masking & Handwriting Extraction Flow

## Overview
For prescription documents, the system uses a 4-stage pipeline:
1. **Stage 1**: Header Extraction (Gemma - Local)
2. **Stage 2**: PHI Masking (before external API)
3. **Stage 3**: Handwriting Extraction (Gemini - External, requires API key)
4. **Stage 4**: Data Integration

## Stage 1: Header Extraction (Gemma - Local)

**What is extracted:**

### PHI Data (stored locally, never sent to external APIs)
```js
phi: {
  patient_name,
  hospital_no,      // MRN/IP No.
  mob_no,           // Phone/Mobile
  email,            // E-mail ID
  kmc_reg_no,       // Registration No.
  episode_no,       // Episode No.
  registration_no,  // Alternative registration
  ip_no,            // IP number
  visit_date,       // Date of visit
  hospital_name,    // Hospital/Clinic name
  consultant_name   // Doctor/Consultant name
}
```

### Clinical Data (not PHI, used for database display)
```js
clinical: {
  age_sex,          // Age/Gender for context
  age,
  gender,
  consultant_name,  // For medical context (stored, not masked)
  department,       // For medical context
  diagnosis,        // Printed diagnosis
  vitals,          // Printed vitals
  medications,      // Printed medications
  lab_tests_selected,  // Lab test selections
  clinical_notes
}
```

## Stage 2: PHI Masking (Before Gemini)

**All 11 fields are masked** before sending to external Gemini API:

| # | Field | Example | Masked? |
|---|-------|---------|--------|
| 1 | Patient Name | "John Doe" | ✅ Yes |
| 2 | Hospital No. / MRN | "123456" | ✅ Yes |
| 3 | Patient Mob. No. | "+91 98765..." | ✅ Yes |
| 4 | E-mail ID | "john@email.com" | ✅ Yes |
| 5 | KMC Reg No. | "KMC2024..." | ✅ Yes |
| 6 | Episode No. | "EP-1234" | ✅ Yes |
| 7 | Age/Sex | "45/Male" | ✅ Yes |
| 8 | Date | "15-Apr-2024" | ✅ Yes |
| 9 | Dept | "Cardiology" | ✅ Yes |
| 10 | Consultant Name | "Dr. Smith" | ✅ Yes |
| 11 | Hospital Name | "Manipal Hospital" | ✅ Yes |

**Also masked:**
- Barcode/QR codes
- Address information
- Any other identifying numbers

## Stage 3: Handwriting Extraction (Gemini)

**Input:** Masked image (all PHI blacked out)

**Extracted from masked image:**
- Handwritten medication names
- Dosages and frequencies
- Duration instructions
- Handwritten vitals
- Doctor's handwritten notes

**What Gemini does NOT see:** Any patient-identifying information

## Stage 4: Data Integration

**Merges:**
- Stage 1 PHI (stored locally)
- Stage 1 Clinical data
- Stage 3 Handwriting data

**Result:** Complete prescription record with:
- All PHI intact (from Stage 1)
- All clinical data (from Stage 1 + Stage 3)

## API Endpoints

### POST /api/documents/process
- Processes document through Stages 1-4
- If Stage 3 needed but no API key provided → status = "partial"

### POST /api/documents/:id/complete-handwriting
- Completes Stage 3 with user-provided Gemini API key
- Uses masked image for privacy
- Returns fully integrated data

## UI Flow

1. User uploads prescription
2. Document processes → Status: "partial" (if handwriting detected)
3. User sees "Needs API Key" badge with key icon
4. User clicks key icon → Dialog opens showing:
   - Steps explanation
   - Privacy protection info
   - Masked image preview
5. User enters Gemini API key
6. System completes Stage 3 with masked image
7. Status: "processed" with full data

## Files Modified

- `tools/image/phi_masker.tool.cjs` - PHI detection and masking
- `agents/extraction/prescription_header_agent.cjs` - Stage 1 with separated PHI/Clinical data
- `src/components/dashboard/HandwritingCompletionDialog.tsx` - New UI component
- `src/pages/UploadCenter.tsx` - Added partial status handling
- `src/pages/Index.tsx` - Added partial document warning
- `src/lib/processedDocuments.ts` - Added "partial" status type
