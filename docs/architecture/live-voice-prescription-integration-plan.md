# Live Voice → Prescription Pipeline Analysis & Plan

## Current Live Voice Pipeline (Backend Processing)

### Phase 1: Recording & Real-time Transcription
```
Doctor speaks → WebSocket Audio Chunks
                ↓
            STT Agent (Gemma)
                ↓
         Transcript Segments (streamed to UI every 3s)
```

**Files:**
- `server/live_conversation_websocket.cjs` - WebSocket handler
- `agents/live_conversation_stt_agent.cjs` - STT processing

### Phase 2: Draft Extraction (Every 15 seconds during recording)
```
Transcript Buffer → AI Extraction (Gemma)
                      ↓
                Draft Medications, Labs, Diagnosis
                      ↓
                   Sent to UI for review
```

**Key Code** (`live_conversation_websocket.cjs` lines 423-482):
```javascript
async startDraftExtraction(sessionId) {
  // Runs every 15 seconds while recording
  const segments = currentSession.transcript?.segments || [];
  const transcript = newSegments.map((s) => s.text).join(" ");

  const draft = await this.generateDraftExtraction(transcript, currentSession);
  await this.store.updateDraftExtraction(sessionId, draft);

  // WebSocket sends: { type: "draft.updated", draft }
}
```

**Extraction Prompt (line 486):**
```
Extract clinical information from this transcript:
- medications (name, instruction, status)
- lab_tests
- radiology_studies
- procedures
- diagnosis
- symptoms
- follow_up_instructions
```

### Phase 3: Review Required (After recording stops)
```
Recording Stops → Full Transcript Analysis
                     ↓
              Review Items Generated
                     ↓
         Status: "review_required"
```

**Review Items trigger when:**
- Low confidence in transcript
- Medication dosage detected
- Critical values (labs, vitals)
- Ambiguous terms

### Phase 4: Finalization
```
Doctor resolves review items → Click "Finalize"
                              ↓
                       Document Created in documents.json
                              ↓
                        Status: "finalized"
                              ↓
                    Returns documentId
```

**Key Code** (`live_conversation_routes.cjs` lines 291-348):
```javascript
async createDashboardDocument(session) {
  const documentId = `voice-live-${session.id}`;

  const newDocument = {
    id: documentId,
    type: "voice",
    documentType: "voice",
    status: "processed",
    result: {
      extracted_data: {
        medications: draft.medications || [],
        labs: draft.labs || [],
        radiology: draft.radiology || [],
        // ... other fields
      }
    }
  };

  // Write to documents.json
  documentsList.unshift(newDocument);
  return documentId;
}
```

---

## Current Data Structure (Voice Document)

```javascript
{
  id: "voice-live-abc-123",
  documentType: "voice",
  result: {
    extracted_data: {
      medications: [
        { name: "Amoxicillin", instruction: "500mg twice daily", status: "draft" }
      ],
      labs: ["CBC", "HbA1c"],
      radiology: ["Chest X-ray"],
      diagnosis: "UTI",
      symptoms: ["Fever", "Dysuria"],
      follow_up: ["Review in 3 days"]
    }
  }
}
```

---

## The Problem

**Current state:** Voice data structure is **incompatible** with Prescription Service.

**Prescription Service expects** (from PDFs):
```javascript
{
  extracted_data: {
    patient: { name, age, gender, mrn },
    doctor: { name, regNo },
    medications: [
      { name, dose, frequency, duration, route, instructions }
    ],
    lab_investigations: {
      selected_tests: [{ test_name, category }]
    },
    radiology_selections: {
      selected_studies: [{ study_name, category }]
    }
  }
}
```

**Voice produces:**
```javascript
{
  medications: [{ name, instruction, status }],  // Missing: dose, frequency, duration
  labs: ["CBC"],                                  // Array of strings, not objects
  radiology: ["Chest X-ray"]                      // Array of strings, not objects
}
```

---

## The Plan: Bridge Voice → Prescription

### Option A: Transform During Document Creation (Recommended)

**Modify** `live_conversation_routes.cjs` → `createDashboardDocument()`

```javascript
async createDashboardDocument(session) {
  const draft = session.draftExtraction?.extractedData || {};

  // TRANSFORM VOICE DATA TO PRESCRIPTION FORMAT
  const transformedData = this.transformVoiceToPrescriptionFormat(draft, session);

  const newDocument = {
    id: documentId,
    documentType: "voice",
    status: "processed",
    result: {
      extracted_data: transformedData,  // ✅ Compatible with Prescription Service
      // ... transcript data
    }
  };
}

transformVoiceToPrescriptionFormat(draft, session) {
  // Parse medications: "500mg twice daily for 5 days" → structured fields
  const medications = (draft.medications || []).map(med => ({
    name: med.name,
    dose: this.extractDose(med.instruction),      // "500mg"
    frequency: this.extractFrequency(med.instruction), // "twice daily"
    duration: this.extractDuration(med.instruction),   // "5 days"
    route: "Oral",
    instructions: med.instruction
  }));

  // Transform labs: ["CBC", "HbA1c"] → objects
  const labTests = (draft.labs || []).map(lab => ({
    test_name: lab,
    category: this.categorizeLab(lab)
  }));

  // Transform radiology: ["Chest X-ray"] → objects
  const radiology = (draft.radiology || []).map(rad => ({
    study_name: rad,
    category: this.categorizeRadiology(rad)
  }));

  return {
    patient: {
      name: session.linkedPatient || "Voice Patient",
      age: null,
      gender: null,
      mrn: `VOICE-${session.id}`
    },
    doctor: {
      name: session.createdBy?.username || "Doctor",
      regNo: ""
    },
    medications,
    lab_investigations: { selected_tests: labTests },
    radiology_selections: { selected_studies: radiology },
    diagnosis: {
      principal: draft.diagnosis || "",
      secondary: [],
      symptoms: draft.symptoms || []
    },
    // ... other fields
  };
}
```

### Option B: Add Transform Layer in Prescription Service

**Modify** `prescription_service.cjs` → `mapDashboardToPrescription()`

```javascript
mapDashboardToPrescription(document) {
  const extracted = document.result.extracted_data || {};

  // Detect voice document and transform
  if (document.documentType === "voice") {
    return this.mapVoiceToPrescription(extracted);
  }

  // Existing PDF/document logic
  return this.mapDocumentToPrescription(extracted);
}

mapVoiceToPrescription(extracted) {
  // Handle voice-specific data structure
  const medications = extracted.medications?.map(med => {
    const parsed = this.parseMedicationInstruction(med.instruction);
    return {
      name: med.name,
      dose: parsed.dose || "As prescribed",
      dosage: parsed.dose || "As prescribed",
      frequency: parsed.frequency || med.frequency || "As prescribed",
      duration: parsed.duration || "",
      route: "Oral",
      instructions: med.instruction
    };
  }) || [];

  // Transform labs from array of strings to objects
  const labTests = (extracted.labs || []).map(lab =>
    typeof lab === "string"
      ? { test_name: lab, category: "general", is_checked: true }
      : lab
  );

  // ... similar for radiology
}
```

---

## Recommended Approach: Option B

**Why:**
1. ✅ Separation of concerns - Prescription Service handles all transformations
2. ✅ Voice routes remain simple - just stores what AI extracts
3. ✅ Easier to test - unit tests for transformation logic
4. ✅ Future-proof - can add more document types easily

**Implementation Steps:**

1. **Update Prescription Service**
   - Add `mapVoiceToPrescription()` method
   - Add medication instruction parser (regex-based)
   - Handle voice-specific data structures

2. **Add Lab/Radiology Categorization**
   - Map "CBC" → category: "hematology"
   - Map "Chest X-ray" → category: "imaging"

3. **Enhance Medication Parsing**
   - Parse: "500mg twice daily for 5 days"
   - Extract: dose="500mg", frequency="twice daily", duration="5 days"

4. **Testing**
   - Test with existing voice documents
   - Verify PDF generation works

---

## End-to-End Flow (After Implementation)

```
┌──────────────────────────────────────────────────────────────────┐
│ LIVE VOICE WORKSPACE                                             │
├──────────────────────────────────────────────────────────────────┤
│  1. Doctor: "Prescribe Amoxicillin 500mg twice daily..."      │
│     ↓                                                           │
│  2. Real-time transcription appears                             │
│     ↓                                                           │
│  3. Draft extraction (every 15s):                               │
│     - Medications: [Amoxicillin 500mg...]                       │
│     - Labs: [CBC, HbA1c]                                       │
│     ↓                                                           │
│  4. Doctor stops recording → Review required                   │
│     ↓                                                           │
│  5. Doctor resolves issues → Finalizes                         │
│     ↓                                                           │
│  6. Document created in documents.json                          │
│     ID: voice-live-abc-123                                      │
└──────────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────────┐
│ PRESCRIPTION PAGE (opens automatically)                         │
├──────────────────────────────────────────────────────────────────┤
│  URL: /prescription/voice-live-abc-123                          │
│                                                                  │
│  [GENERATE PRESCRIPTION] button (purple)                        │
│     ↓                                                           │
│  Opens Review UI:                                               │
│    - Medications tab: Amoxicillin 500mg, bd                    │
│    - Labs tab: CBC ✓, HbA1c ✓                                  │
│    - Timing: Morning ✓, Night ✓ (parsed from "twice daily")    │
│     ↓                                                           │
│  Doctor edits (if needed):                                      │
│    - Changes dose to 250mg                                     │
│    - Adds "Vitals: BP 130/85"                                  │
│     ↓                                                           │
│  Click [Generate] → PDF opens                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Next Steps

1. ✅ Prescription Service created
2. ✅ API endpoints created
3. ✅ Review UI created
4. ✅ Live Voice integration (button added)
5. **TODO:** Add voice data transformation in Prescription Service
6. **TODO:** Test end-to-end with actual voice session
