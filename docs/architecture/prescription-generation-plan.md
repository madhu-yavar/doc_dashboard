# Prescription Generation Agent - Implementation Plan

**Status:** Planning Phase
**Version:** 1.0
**Date:** 2026-05-27
**Author:** Claude (based on requirements from Yavar)

---

## Executive Summary

Build a prescription generation agent that runs alongside the live audio agent, extracts relevant clinical information from ASR transcripts, and generates a formatted prescription based on the provided template. The generated prescription is displayed in a popup window when live audio is manually stopped, with edit, save, and print options.

---

## Template Reference

The prescription template is located at [`prescription_template_dev/`](../../prescription_template_dev/):

- `prescription-template.html` - 2-page A4 prescription template
- `prescription-template.css` - Print styling
- `prescription-template.js` - Data binding helper
- `README.md` - Integration documentation

### Data Binding Pattern

The template uses three binding attributes:
- `data-field="path.to.value"` - Text fields
- `data-check="path.to.boolean"` - Checkboxes
- `data-repeat="path.to.array"` - Repeatable rows (medicines)

### Sample Data Structure

```javascript
{
  hospital: { name, tagline, department, branch, address },
  patient: { name, ageSex, hospitalNo, mobile, email },
  visit: { episodeNo, dateTime },
  consultant: { name, regNo, department },
  vitals: { height, bp, weight },
  clinical: { allergies, diet, vulnerable, knownHealthConditions },
  doctorNotes: { freeText },
  procedures: { ecg, eeg, holter, ... },
  labs: { cbc, glucoseRandom, denguePanel, ... },
  radiology: { xrayChestPa, usgAbdPelvis, ... },
  admission: { admissionDate, dayCareProcedure, procedureDate, details, procedureNotes },
  prescription: { medicines: [{ srNo, name, dose, morning, noon, night, days, remarks }] },
  crossReference: "",
  nextVisitDate: "",
  doctor: { signatureText }
}
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PRESCRIPTION GENERATION PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Live Audio (microphone)                                                    │
│       │                                                                     │
│       ▼                                                                     │
│  STT Agent (Whisper) → ASR Transcript                                       │
│       │                                                                     │
│       ▼                                                                     │
│  Draft Extraction (Gemma, every 15s)                                       │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  [USER CLICKS "END"]                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │              Prescription Orchestrator Agent                         │   │
│  │  (Aggregates existing skills + new services)                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ├──────────────────┬──────────────────┬─────────────────────┐         │
│       ▼                  ▼                  ▼                     │         │
│  ┌─────────┐      ┌──────────┐      ┌──────────────┐             │         │
│  │ Existing│      │ ICD-10   │      │ Medication   │             │         │
│  │ Skills  │      │ Lookup   │      │ Validation   │             │         │
│  └─────────┘      └──────────┘      └──────────────┘             │         │
│       │                  │                  │                     │         │
│       └──────────────────┴──────────────────┘                     │         │
│                           │                                        │         │
│                           ▼                                        │         │
│              ┌─────────────────────────┐                          │         │
│              │  Structured Rx Data     │                          │         │
│              └─────────────────────────┘                          │         │
│                           │                                        │         │
│                           ▼                                        │         │
│              ┌─────────────────────────┐                          │         │
│              │  Template Renderer      │                          │         │
│              │  (HTML + Data Binding)  │                          │         │
│              └─────────────────────────┘                          │         │
│                           │                                        │         │
│                           ▼                                        │         │
│              ┌─────────────────────────┐                          │         │
│              │  PDF Generator          │                          │         │
│              │  (Puppeteer)            │                          │         │
│              └─────────────────────────┘                          │         │
│                           │                                        │         │
│                           ▼                                        │         │
│              ┌─────────────────────────┐                          │         │
│              │  Popup Modal            │                          │         │
│              │  (Edit, Save, Print)    │                          │         │
│              └─────────────────────────┘                          │         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Prescription Orchestrator Agent

**Location:** `agents/prescription_orchestrator.cjs` (NEW)

**Purpose:** Aggregate existing extraction skills and map output to prescription template format

**Reuses Existing Skills:**
- `skills/extraction/prescription_patient_extractor.skill.cjs` - Patient info
- `skills/extraction/prescription_medications_extractor.skill.cjs` - Medications
- `skills/extraction/prescription_diagnosis_extractor.skill.cjs` - Diagnosis
- `skills/extraction/prescription_doctor_extractor.skill.cjs` - Doctor info

**New Services Integrated:**
- ICD-10 code lookup
- Medication validation

**Input:** Full session transcript + draft extraction data

**Output:** Structured data matching template format

---

### 2. ICD-10 Lookup Service

**Location:** `services/icd10_lookup.cjs` (NEW)

**Purpose:** Map diagnosis descriptions to ICD-10 codes

**Implementation Strategy:**
1. **Phase 1:** Download ICD-10 data from web search (one-time activity)
2. **Phase 2:** Store in local database (JSON/SQLite)
3. **Phase 3:** Build daily update mechanism (future)

**API:**
```javascript
class ICD10LookupService {
  // Lookup code for a diagnosis description
  async lookupCode(diagnosisText) → { code, description, confidence }

  // Search codes by query
  async searchCodes(query) → [{ code, description }]

  // Suggest codes for diagnosis
  async suggestCodes(diagnosisText) → [{ code, description, matchScore }]
}
```

**Data Source:** WHO ICD-10 Browser (downloadable XML/JSON)

---

### 3. Medication Validation Service

**Location:** `services/medication_validator.cjs` (NEW)

**Purpose:** Validate medication names, dosages, and frequencies

**Implementation:** Gemma + web search (Gemini) for grounding

**Validations:**
- Medication name spelling/correctness
- Standard dosage ranges
- Frequency abbreviations (OD, BD, TID, QID, SOS, PRN)
- Duration reasonableness

**API:**
```javascript
class MedicationValidationService {
  // Validate single medication
  async validateMedication(medication) → {
    isValid,
    warnings,
    suggestions,
    standardizedForm
  }

  // Check drug interactions (future)
  async checkInteractions(medications) → {
    hasInteractions,
    warnings
  }

  // Standardize dosage text
  async standardizeDosage(dosageText) → {
    standardForm,
    quantity
  }
}
```

---

### 4. Doctor Profile Management

**Location:** Extend existing auth/user system

**Current:** Backend only
**Enhancement:** Store doctor profile at login

**Schema Extension:**
```javascript
// Extend user object
{
  id: "doctor_001",
  username: "dr_smith",
  role: "doctor",
  profile: {
    name: "Dr. John Smith",
    registrationNumber: "KMC-12345",
    specialization: "General Medicine",
    signature: "",  // base64 or path
    qualifications: ["MBBS", "MD"]
  }
}
```

**Management:** Admin-managed only (no self-service UI initially)

---

### 5. Template Customization System

**Storage:** `server/storage/prescription_templates.json`

**Admin UI:** `src/components/admin/PrescriptionTemplateEditor.tsx`

**Template Schema:**
```javascript
{
  id: "default",
  name: "Dr. Manipal Hospital",
  hospital: {
    name: "Dr. Manipal Hospital",
    tagline: "Care • Safety • Trust",
    department: "INTERNAL MEDICINE",
    branch: "Main Branch",
    address: "Manipal, Karnataka"
  },
  branding: {
    logoUrl: "",
    primaryColor: "#184dce"
  },
  sections: {
    page1: {
      patientInfo: { visible: true, order: 1 },
      vitals: { visible: true, order: 2 },
      clinicalNotes: { visible: true, order: 3 },
      procedures: { visible: true, order: 4 }
    },
    page2: {
      labs: { visible: true },
      radiology: { visible: true },
      prescription: { visible: true },
      signature: { visible: true }
    }
  }
}
```

---

### 6. PDF Generator

**Location:** `tools/pdf/prescription_pdf_generator.tool.cjs` (NEW)

**Approach:** Puppeteer + existing HTML template

**Process:**
1. Load template configuration
2. Render HTML with data (using existing binding script)
3. Puppeteer to print to PDF
4. Return base64 for preview

**API:**
```javascript
class PrescriptionPDFGenerator {
  async generateHTML(data, template) → string
  async generatePDF(html) → Buffer
  async generateBase64(data, template) → string
}
```

---

### 7. Backend Integration

#### WebSocket Enhancement

**Location:** `server/live_conversation_websocket.cjs` (MODIFY)

**Change:** Add prescription generation trigger in `handleEnd()`

```javascript
async handleEnd(sessionId) {
  // ... existing code ...

  // NEW: Generate prescription
  const prescription = await this.generatePrescription(sessionId);

  this.sendJson(ws, {
    type: "prescription.ready",
    sessionId,
    prescription,
    timestamp: new Date().toISOString()
  });
}
```

#### New Routes

**Location:** `server/prescription_routes.cjs` (NEW)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/prescriptions/from-session/:sessionId` | POST | Generate from session |
| `/api/prescriptions/templates` | GET | Get available templates |
| `/api/prescriptions/templates/:id` | PUT | Update template (admin) |
| `/api/prescriptions/:id/validate` | POST | Validate medication |
| `/api/prescriptions/:id` | PUT | Update edited prescription |
| `/api/prescriptions/:id/pdf` | GET | Download PDF |
| `/api/prescriptions/:id/save` | POST | Save to documents |

#### Storage

**Decision:** Store prescriptions as **separate documents** linked to the session

**Schema Extension in `LiveConversationStore`:**
```javascript
// Add to session object
{
  // ... existing fields ...
  prescription: {
    id: "rx-{timestamp}",
    data: { /* template format */ },
    pdfData: "base64...",
    status: "draft" | "edited" | "saved",
    generatedAt: "2026-05-27T10:30:00Z"
  }
}
```

---

### 8. Frontend Components

#### 8a. Prescription Modal

**Location:** `src/components/prescription/PrescriptionModal.tsx` (NEW)

**States:**
- `loading` - Generating prescription
- `preview` - Showing generated prescription
- `editing` - User editing fields
- `saving` - Saving to dashboard

**Actions:**
- Edit (switches to edit mode)
- Save to Dashboard
- Print (browser print)
- Discard

#### 8b. Prescription Editor

**Location:** `src/components/prescription/PrescriptionEditor.tsx` (NEW)

**Editable Sections:**
- Patient info (name, age/gender, hospital no, mobile)
- Vitals (height, BP, weight)
- Clinical notes (allergies, diet, known conditions)
- Doctor notes (free text)
- Procedures (checkboxes)
- Labs (checkboxes + other)
- Radiology (checkboxes + other)
- Medications (CRUD + validation)
- Follow-up date

**Features:**
- Real-time ICD-10 suggestions
- Medication validation warnings
- Add/remove medication rows
- Dosage helper (common frequencies)

#### 8c. ICD-10 Autocomplete

**Location:** `src/components/prescription/ICD10Autocomplete.tsx` (NEW)

**Features:**
- Search diagnosis descriptions
- Show ICD-10 codes
- Select to populate

#### 8d. Admin Template Editor

**Location:** `src/components/admin/PrescriptionTemplateEditor.tsx` (NEW)

**For Admin Users:**
- Edit hospital info
- Upload logo
- Customize colors
- Toggle sections

---

## File Structure

```
manipal/
├── agents/
│   └── prescription_orchestrator.cjs              # NEW - orchestrates skills
│
├── services/
│   ├── icd10_lookup.cjs                           # NEW - ICD-10 lookup
│   └── medication_validator.cjs                   # NEW - medication validation
│
├── tools/pdf/
│   └── prescription_pdf_generator.tool.cjs        # NEW - PDF generation
│
├── prescription_template_dev/                     # EXISTING - template files
│   ├── prescription-template.html
│   ├── prescription-template.css
│   ├── prescription-template.js
│   └── README.md
│
├── server/
│   ├── prescription_routes.cjs                    # NEW
│   ├── storage/
│   │   ├── prescription_templates.json            # NEW
│   │   ├── icd10_codes.json                       # NEW (downloaded)
│   │   └── medications_cache.json                 # NEW
│   ├── live_conversation_websocket.cjs            # MODIFY
│   └── live_conversation_store.cjs                # MODIFY (add prescription)
│
└── src/
    ├── hooks/
    │   └── usePrescriptionGeneration.ts           # NEW
    │
    └── components/
        ├── prescription/
        │   ├── PrescriptionModal.tsx              # NEW
        │   ├── PrescriptionEditor.tsx             # NEW
        │   ├── ICD10Autocomplete.tsx              # NEW
        │   └── MedicationRow.tsx                  # NEW
        │
        └── admin/
            └── PrescriptionTemplateEditor.tsx      # NEW
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

**Backend:**
- [ ] Create ICD-10 lookup service with downloaded data
- [ ] Create medication validation service (Gemma + web search)
- [ ] Extend user profile schema for doctor info
- [ ] Create template configuration structure

**Frontend:**
- [ ] Create prescription generation hook
- [ ] Create basic prescription modal (loading + preview states)

---

### Phase 2: Orchestrator (Week 1-2)

**Backend:**
- [ ] Create prescription orchestrator agent
- [ ] Wire up existing extraction skills
- [ ] Map draft extraction to prescription template format
- [ ] Integrate ICD-10 lookup for diagnosis
- [ ] Integrate medication validation

**Testing:**
- [ ] Unit tests for orchestrator
- [ ] Test with sample transcripts

---

### Phase 3: Template System (Week 2)

**Backend:**
- [ ] Create PDF generator using Puppeteer
- [ ] Implement template save/load
- [ ] Add template customization endpoints

**Frontend:**
- [ ] Admin template editor UI
- [ ] Template preview

---

### Phase 4: Backend Integration (Week 2-3)

**WebSocket:**
- [ ] Extend `handleEnd()` to trigger prescription generation
- [ ] Add `prescription.ready` event
- [ ] Stream prescription data to client

**Routes:**
- [ ] Implement all prescription routes
- [ ] Store prescription in session
- [ ] ICD-10 search endpoint
- [ ] Medication validation endpoint

---

### Phase 5: Frontend UI (Week 3-4)

**Editor:**
- [ ] Prescription editor component
- [ ] ICD-10 autocomplete
- [ ] Medication CRUD with validation
- [ ] Real-time validation warnings

**Actions:**
- [ ] Save to dashboard integration
- [ ] Print functionality (browser print API)
- [ ] Discard/cancel flow

---

### Phase 6: Testing & Polish (Week 4)

- [ ] End-to-end testing
- [ ] UI/UX refinement
- [ ] Performance optimization
- [ ] Documentation

---

## Key Decisions Summary

| Decision | Choice |
|----------|--------|
| Core Extraction | Reuse existing Gemma skills |
| Doctor Info | Stored in user profile at login (admin-managed) |
| ICD-10 Codes | Download from web (one-time), daily update later |
| Template Customization | Admin UI + stored config |
| Auto-population | Existing skills |
| Medication Validation | Gemma + web search (individual meds first) |
| Print | Browser print API (system default) |
| PDF Generation | Puppeteer + existing HTML template |
| Storage | Separate documents linked to session |

---

## Data Flow Example

```
1. Doctor starts live session
   → Microphone captures audio
   → STT Agent transcribes to text
   → Draft Extraction runs every 15s

2. Doctor clicks "End"
   → WebSocket handleEnd() triggered
   → Final transcript processed
   → Prescription Orchestrator called

3. Prescription Orchestrator
   → Calls patient extractor skill
   → Calls medications extractor skill
   → Calls diagnosis extractor skill
   → Looks up ICD-10 codes for diagnosis
   → Validates medications via Gemma + web search
   → Maps output to template format

4. PDF Generator
   → Loads template configuration
   → Binds data to HTML template
   → Renders via Puppeteer
   → Returns base64 PDF

5. Frontend
   → Receives prescription.ready event
   → Shows modal with preview
   → User can edit, save, or print
   → On save, stores as document
```

---

## Open Questions for Signoff

1. **ICD-10 Initial Download:** Should we include a specific subset (common codes) or full ICD-10?

2. **Medication Validation Scope:** Validate against a specific formulary (e.g., Indian drugs) or general validation?

3. **Template Fallback:** What if template customization is not done? Use hardcoded default?

4. **Doctor Signature:** How to capture? Upload image or typed name only?

5. **Print Integration:** Any specific printer requirements or browser print is sufficient?

---

## References

- Template: [`prescription_template_dev/`](../../prescription_template_dev/)
- Existing Skills: [`skills/extraction/`](../../skills/extraction/)
- Live Conversation: [`server/live_conversation_websocket.cjs`](../../server/live_conversation_websocket.cjs)
- Store: [`server/live_conversation_store.cjs`](../../server/live_conversation_store.cjs)
