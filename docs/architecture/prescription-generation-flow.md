# Prescription Generation Flow - From Button Click to PDF

## Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: Doctor Clicks "Generate Prescription" Button                       │
│                                                                             │
│ Location: Live Voice Workspace → SessionReviewPanel                         │
│ Button: [Generate Prescription] (purple)                                    │
│                                                                             │
│ Action:                                                                      │
│   window.location.href = `/prescription/${session.documentId}`             │
│                                                                             │
│ Example URL: /prescription/voice-live-live-poc-test-001                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: Prescription Page Loads                                             │
│                                                                             │
│ Route: /prescription/:documentId                                            │
│ Component: <Prescription />                                                │
│ File: src/pages/Prescription.tsx                                           │
│                                                                             │
│ Renders:                                                                    │
│   - Header with "Back" button and title                                      │
│   - <PrescriptionReview documentId={documentId} />                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: PrescriptionReview Component Mounts                                │
│                                                                             │
│ Component: <PrescriptionReview />                                          │
│ File: src/components/prescription/PrescriptionReview.tsx                   │
│                                                                             │
│ useEffect → fetchPrescriptionData()                                       │
│                                                                             │
│ API Call:                                                                   │
│   GET /api/prescriptions/data/voice-live-live-poc-test-001                │
│                                                                             │
│ Server → PrescriptionService.getPrescriptionData(docId)                   │
│   → Detects documentType === "voice"                                       │
│   → Calls mapVoiceToPrescription(document)                                 │
│   → Transforms voice data to prescription format                            │
│                                                                             │
│ Response:                                                                   │
│ {                                                                           │
│   success: true,                                                            │
│   data: {                                                                   │
│     hospital: { name, department, address },                               │
│     patient: { name, ageSex, hospitalNo },                                  │
│     consultant: { name, regNo, department },                                │
│     medications: [                                                          │
│       { name: "PARACETAMOL", dose: "500mg", morning: true, noon: false, night: true }, │
│       { name: "AZITHROMYCIN", dose: "500mg", morning: true, noon: false, night: false } │
│     ],                                                                      │
│     labs: { cbc: true, hba1c: true, other: "Chest X-ray" },                │
│     radiology: { xrayChestPa: true, usgAbdPelvis: false },                  │
│     doctorNotes: { freeText: "Diagnosis: Viral Fever..." },                │
│     _metadata: { sourceDocument, sourceDocumentId, generatedAt }           │
│   }                                                                         │
│ }                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: Review UI Renders (Initial State)                                  │
│                                                                             │
│ State:                                                                      │
│   - data: <PrescriptionData> (fetched from API)                            │
│   - loading: false                                                          │
│   - editing: false (read-only mode initially)                               │
│   - generating: false                                                       │
│                                                                             │
│ UI Displays:                                                                │
│   ┌───────────────────────────────────────────────────────────────────────┐ │
│   │ Prescription Review                                    [Edit] [Generate]│ │
│   │ ─────────────────────────────────────────────────────────────────────  │ │
│   │ Source: Voice Session • Patient: John Doe                             │ │
│   └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│   Tabs:                                                                      │
│   ┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐   │
│   │Medications  │Labs         │Radiology    │Notes        │Preview      │   │
│   └─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘   │
│                                                                             │
│   Default Tab: Medications                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Medications (3)                                                       │   │
│   │ ┌──────┬──────────────────────┬──────────┬────┬───────┬────────────┐ │   │
│   │ │ #    │ Medicine             │ Dose     │Time│ Days  │ Remarks     │ │   │
│   │ ├──────┼──────────────────────┼──────────┼────┼───────┼────────────┤ │   │
│   │ │ 1    │ PARACETAMOL          │ 500mg    │M N │       │ 2 times    │ │   │
│   │ │ 2    │ AZITHROMYCIN         │ 500mg    │M   │       │ once daily │ │   │
│   │ │ 3    │ CETRIZINE            │ 10mg     │  N │       │ night      │ │   │
│   │ └──────┴──────────────────────┴──────────┴────┴───────┴────────────┘ │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: Doctor Reviews Data (Read-Only Mode)                               │
│                                                                             │
│ Doctor can:                                                                 │
│   ✓ Switch between tabs to see all extracted data                           │
│   ✓ View Preview tab for summary                                           │
│   ✓ Verify medications are correct                                         │
│   ✓ Check lab/radiology selections                                          │
│                                                                             │
│ If everything looks correct:                                               │
│   → Click [Generate] button directly                                       │
│                                                                             │
│ If edits are needed:                                                        │
│   → Click [Edit] button to enter edit mode                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
                    ┌───────────────────────────────┐
                    │ Doctor clicks [Edit]         │
                    │ editing: true                │
                    │ Badge appears: "Edit Mode"    │
                    └───────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 6: Edit Mode - Doctor Makes Corrections                             │
│                                                                             │
│ State: editing = true                                                       │
│                                                                             │
│ UI Changes:                                                                 │
│   - [Edit Mode] badge appears                                                │
│   - [Edit] button becomes [Cancel]                                          │
│   - [Generate] becomes [Save & Generate]                                    │
│   - All input fields become editable                                        │
│                                                                             │
│ ┌───────────────────────────────────────────────────────────────────────────┐ │
│   │ [Edit Mode]                                          [Cancel] [Save & Generate] │ │
│   └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ EDITABLE FIELDS:                                                            │
│                                                                             │
│ **Medications Tab:**                                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 1. PARACETAMOL                                                         │   │
│   │    Name: [PARACETAMOL         ] ← Editable                             │   │
│   │    Dose: [500mg              ] ← Editable                             │   │
│   │    Timing: [✓ Morning] [✓ Noon] [✓ Night] ← Checkboxes                │   │
│   │    Days:  [                   ] ← Editable                             │   │
│   │    Remarks: [2 times daily   ] ← Editable                             │   │
│   │                                                                       │   │
│   │ 2. AZITHROMYCIN                                                        │   │
│   │    Name: [AZITHROMYCIN        ] ← Editable                             │   │
│   │    Dose: [500mg              ] ← Editable                             │   │
│   │    Timing: [✓ Morning] [✓ Noon] [✓ Night] ← Checkboxes                │   │
│   │    ...                                                                  │   │
│   │                                                                       │   │
│   │ 8. [Empty row - Doctor can add new medication]                        │   │
│   │    Name: [                   ]                                         │   │
│   │    Dose: [                   ]                                         │   │
│   │    ...                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│ **Labs Tab:**                                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Lab Investigations                                                     │   │
│   │                                                                       │   │
│   │ [✓] CBC           ← Toggle checkbox                                  │   │
│   │ [✓] HbA1c        ← Toggle checkbox                                  │   │
│   │ [✓] Sr. Creat    ← Toggle checkbox                                  │   │
│   │ [ ] Lipid Profile ← Toggle checkbox                                  │   │
│   │                                                                       │   │
│   │ Other Tests (no checkbox):                                             │   │
│   │ Chest X-ray                                                           │   │
│   │                                                                       │   │
│   │ Note: Doctor can uncheck erroneously extracted labs                   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│ **Radiology Tab:**                                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Radiology & Imaging                                                    │   │
│   │                                                                       │   │
│   │ [✓] X-Ray Chest PA         ← Toggle                                 │   │
│   │ [ ] USG Abdomen & Pelvis   ← Toggle                                 │   │
│   │ [ ] MRI Brain              ← Toggle                                 │   │
│   │ [✓] CT Thorax HRCT         ← Toggle                                 │   │
│   │                                                                       │   │
│   │ Other Studies:                                                       │   │
│   │ None                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│ **Notes & Vitals Tab:**                                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Doctor's Notes                                                        │   │
│   │ ┌─────────────────────────────────────────────────────────────────┐  │   │
│   │ │ Diagnosis: Viral Fever                                          │  │   │
│   │ │                                                                  │  │   │
│   │ │ Comorbidities: None                                             │  │   │
│   │ │                                                                  │  │   │
│   │ │ [Editable textarea - Doctor can modify]                          │  │   │
│   │ │                                                                  │  │   │
│   │ └─────────────────────────────────────────────────────────────────┘  │   │
│   │                                                                       │   │
│   │ Vitals & Clinical                                                      │   │
│   │ BP:     [130/85      ] ← Editable                                     │   │
│   │ Weight: [70          ] ← Editable                                     │   │
│   │ Height: [170         ] ← Editable                                     │   │
│   │                                                                       │   │
│   │ Allergies: No known drug allergy                                     │   │
│   │ Known Conditions: Viral Fever                                        │   │
│   │                                                                       │   │
│   │ Next Visit: [2026-05-30   ] ← Editable                               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 7: Doctor Completes Edits and Clicks [Save & Generate]               │
│                                                                             │
│ Action:                                                                      │
│   POST /api/prescriptions/generate                                          │
│                                                                             │
│ Request Body:                                                               │
│ {                                                                           │
│   documentId: "voice-live-live-poc-test-001",                              │
│   format: "pdf",    // or "html" or "both"                                 │
│   updateData: {          // Only sent if in edit mode                        │
│     medications: [                                                          │
│       { srNo: 1, name: "PARACETAMOL", dose: "500mg",                       │
│         morning: true, noon: false, night: true,                            │
│         days: "3", remarks: "2 times daily" }                              │
│     ],                                                                      │
│     labs: {                                                                 │
│       cbc: true,                                                            │
│       hba1c: false,        // Doctor unchecked this                        │
│       srCreat: true,                                                          │
│       other: ""                                                             │
│     },                                                                      │
│     radiology: {                                                             │
│       xrayChestPa: true,                                                     │
│       usgAbdPelvis: true,  // Doctor added this                             │
│       other: ""                                                             │
│     },                                                                      │
│     doctorNotes: {                                                          │
│       freeText: "Diagnosis: Viral Fever\n\nAdvice: Rest, hydration"        │
│     },                                                                      │
│     vitals: {                                                               │
│       bp: "130/85",                                                         │
│       weight: "70"                                                          │
│     }                                                                       │
│   }                                                                         │
│ }                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 8: Server Generates Prescription                                      │
│                                                                             │
│ API: POST /api/prescriptions/generate                                       │
│ Handler: server/index.cjs                                                  │
│                                                                             │
│ Process:                                                                    │
│                                                                             │
│   1. Initialize PrescriptionService                                         │
│   2. Load document from documents.json                                      │
│   3. Get base prescription data via mapDashboardToPrescription()           │
│      or mapVoiceToPrescription()                                           │
│   4. If updateData provided, apply updates:                                │
│      - Override medications                                                 │
│      - Override labs checkboxes                                             │
│      - Override radiology checkboxes                                        │
│      - Override doctor notes & vitals                                       │
│   5. Render HTML template with updated data                                │
│   6. Generate PDF using Playwright (if format includes pdf)               │
│   7. Save files to storage/prescriptions/                                   │
│   8. Return URLs                                                           │
│                                                                             │
│ Response:                                                                   │
│ {                                                                           │
│   success: true,                                                            │
│   documentId: "voice-live-live-poc-test-001",                              │
│   documentName: "Voice Session",                                           │
│   data: { /* final prescription data sent to template */ },                │
│   urls: {                                                                   │
│     pdf: "/prescriptions/voice-live-live-poc-test-001_1234567890.pdf",   │
│     html: "/prescriptions/voice-live-live-poc-test-001_1234567890.html"  │
│   },                                                                         │
│   paths: {                                                                  │
│     pdf: "/server/storage/prescriptions/...",                               │
│     html: "/server/storage/prescriptions/..."                               │
│   }                                                                         │
│ }                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 9: PDF Opens in Browser                                                │
│                                                                             │
│ Frontend receives response:                                                 │
│                                                                             │
│   if (result.urls.pdf) {                                                    │
│     window.open(result.urls.pdf, "_blank");     // Opens PDF in new tab    │
│   }                                                                          │
│                                                                             │
│ User sees:                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     PRESCRIPTION                                    │   │
│   │                  MANIPAL HOSPITALS                                  │   │
│   │                #98 HAL Airport Road                                 │   │
│   │                                                                      │   │
│   │  PATIENT: John Doe    Age/Sex: N/A    Hospital No: VOICE-live     │   │
│   │                                                                      │   │
│   │  CONSULTANT: DrTest                                                  │   │
│   │  Date: 2026-05-27                                                    │   │
│   │                                                                      │   │
│   │  DIAGNOSIS: Viral Fever                                             │   │
│   │                                                                      │   │
│   │  ┌───────────────────────────────────────────────────────────────┐ │   │
│   │  │ MEDICINES                                                     │ │   │
│   │  │                                                               │ │   │
│   │  │  1. PARACETAMOL            500mg    M   N   3 days            │ │   │
│   │  │                                                       2 times│ │   │
│   │  │                                                               │ │   │
│   │  │  2. AZITHROMYCIN          500mg    M                        │   │
│   │  │                                                       once   │ │   │
│   │  │                                                               │ │   │
│   │  │  3. CETRIZINE              10mg          N                 │   │
│   │  │                                                       night   │ │   │
│   │  └───────────────────────────────────────────────────────────────┘ │   │
│   │                                                                      │   │
│   │  LAB INVESTIGATIONS ADVISED:                                       │   │
│   │  ✓ CBC  ✓ Sr. Creat                                               │   │
│   │                                                                      │   │
│   │  RADIOLOGY ADVISED:                                                  │   │
│   │  ✓ X-Ray Chest PA  ✓ USG Abdomen & Pelvis                          │   │
│   │                                                                      │   │
│   │  DOCTOR'S NOTES:                                                     │   │
│   │  Diagnosis: Viral Fever                                             │   │
│   │  Advice: Rest, hydration                                            │   │
│   │                                                                      │   │
│   │  Generated: 5/27/2026, 2:30 PM                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│ User can now:                                                              │
│   - Print the PDF                                                           │
│   - Download/save the PDF                                                   │
│   - Close the tab and return to review page                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 10: Completion - Return to Review Page                                 │
│                                                                             │
│ UI shows success toast: "Prescription generated successfully!"               │
│                                                                             │
│ Optional: Auto-navigate back to dashboard or show download options          │
└─────────────────────────────────────────────────────────────────────────────┘

---

## Implementation Checklist

### Frontend (PrescriptionReview.tsx)

- [x] Fetch prescription data on mount
- [x] Display read-only mode initially
- [x] Edit mode toggle with badge
- [x] Medications tab with editable fields
  - [x] Name, dose inputs
  - [x] Morning/Afternoon/Night checkboxes
  - [x] Days input
  - [x] Remarks input
- [x] Labs tab with checkboxes
- [x] Radiology tab with checkboxes
- [x] Notes & Vitals tab with editable fields
- [x] Preview tab with summary
- [x] Format selector (PDF/HTML/Both)
- [x] Generate button with loading state
- [x] Open PDF in new tab after generation

### Backend (prescription_service.cjs)

- [x] getPrescriptionData() - Fetch and transform data
- [x] mapVoiceToPrescription() - Voice → Prescription format
- [x] parseMedicationInstruction() - Parse "500mg twice daily"
- [x] categorizeLab() / categorizeRadiology() - Categorization
- [x] generatePrescription() - Generate HTML/PDF
- [x] applyUpdates() - Apply user edits
- [x] renderPrescriptionHTML() - Render template
- [x] generatePDF() - Playwright PDF generation

### API Routes (server/index.cjs)

- [x] GET /api/prescriptions/data/:documentId
- [x] POST /api/prescriptions/generate
- [x] GET /api/prescriptions/download/:filename
- [x] Serve /prescriptions/* as static files

---

## Data Transformation Examples

### Voice Data → Prescription Format

**Medications:**
```javascript
// Voice format
{ name: "Paracetamol", instruction: "500mg twice daily for 3 days" }

// Transformed
{
  name: "PARACETAMOL",
  dose: "500mg",
  morning: true,
  noon: false,
  night: true,
  days: "3",
  remarks: "2 times daily"
}
```

**Labs:**
```javascript
// Voice format
["CBC", "HbA1c", "Chest X-ray"]

// Transformed
{
  cbc: true,           // Matched "CBC"
  hba1c: true,         // Matched "HbA1c"
  xrayChestPa: true,   // Matched "Chest X-ray"
  other: ""            // No unmatched items
}
```

---

## Error Handling

| Error | Scenario | Handling |
|-------|----------|----------|
| Document not found | Invalid documentId | Show error toast, redirect to dashboard |
| Invalid document type | Document doesn't have prescription data | Show error message |
| PDF generation fails | Playwright error | Show error toast, offer HTML download |
| Network error | API call fails | Retry button, show error details |

---

## User Experience Flow Summary

1. **Finalize voice session** → Button appears
2. **Click button** → Opens review page
3. **Review data** (read-only)
4. **Edit if needed** (toggle edit mode)
5. **Click Generate** → PDF opens immediately
6. **Print/Save** → Done!

Total time: ~10-20 seconds from click to PDF
