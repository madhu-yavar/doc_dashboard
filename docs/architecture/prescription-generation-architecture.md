# Prescription Generation - Architecture Diagram

## System Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           DOCTOR WORKSTATION                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                         LIVE CONVERSATION UI                              │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │ │
│  │  │   Patient   │  │  Encounter  │  │ Transcript  │  │  Draft Notes    │  │ │
│  │  │    Info     │  │    Label    │  │  (Live)     │  │  (Auto-filled)  │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘  │ │
│  │                                                                               │ │
│  │  ┌─────────────────────────────────────────────────────────────────────┐   │ │
│  │  │  [◉] Recording  [⏸] Pause  [⏹] End                                 │   │ │
│  │  └─────────────────────────────────────────────────────────────────────┘   │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                          │
│                                      │ WebSocket                                │
│                                      ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                         PRESCRIPTION MODAL                                │ │
│  │  (Shown when "End" is clicked)                                            │ │
│  │                                                                           │ │
│  │  ┌─────────────────────────────────────────────────────────────────────┐ │ │
│  │  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │ │ │
│  │  │  │   PREVIEW      │  │     EDIT       │  │    ACTIONS     │        │ │ │
│  │  │  │                │  │                │  │                │        │ │ │
│  │  │  │  [Prescription │  │  [Patient Info │  │  [Save to      │        │ │ │
│  │  │  │   Preview]     │  │   Editor]      │  │   Dashboard]   │        │ │ │
│  │  │  │                │  │                │  │                │        │ │ │
│  │  │  │  Page 1 | Page 2│  │  [ICD-10       │  │  [Print]       │        │ │ │
│  │  │  │                │  │   Lookup]      │  │                │        │ │ │
│  │  │  │                │  │                │  │  [Discard]     │        │ │ │
│  │  │  │                │  │  [Medication   │  │                │        │ │ │
│  │  │  │                │  │   Validator]   │  │                │        │ │ │
│  │  │  └────────────────┘  └────────────────┘  └────────────────┘        │ │ │
│  │  └─────────────────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ HTTPS/WebSocket
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND SERVER                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                       LIVE CONVERSATION WEBSOCKET                          │ │
│  │  (server/live_conversation_websocket.cjs)                                  │ │
│  │                                                                           │ │
│  │  handleAudioChunk()  → STT Agent → Transcript                            │ │
│  │  startDraftExtraction() → Draft data every 15s                           │ │
│  │  handleEnd()  ──────────────────────────────────────────┐                 │ │
│  │                                                           │                 │ │
│  └───────────────────────────────────────────────────────────┼─────────────────┘ │
│                                                              │                  │
│  ┌───────────────────────────────────────────────────────────┼─────────────────┐ │
│  │                  PRESCRIPTION ORCHESTRATOR                 │                 │ │
│  │                  (agents/prescription_orchestrator.cjs)    │                 │ │
│  │                                                           │                 │ │
│  │  ┌─────────────────────────────────────────────────┐     │                 │ │
│  │  │  INPUT: Transcript + Draft Extraction           │     │                 │ │
│  │  └─────────────────────────────────────────────────┘     │                 │ │
│  │                                                           │                 │ │
│  │  ┌──────────────────┐  ┌──────────────────┐              │                 │ │
│  │  │  Reuse Existing  │  │  New Services    │              │                 │ │
│  │  │  Skills          │  │                  │              │                 │ │
│  │  │  ───────────────│  │  ─────────────── │              │                 │ │
│  │  │  • Patient       │  │  • ICD-10 Lookup │              │                 │ │
│  │  │    Extractor     │  │  • Medication    │              │                 │ │
│  │  │  • Medication    │  │    Validation    │              │                 │ │
│  │  │    Extractor     │  │                  │              │                 │ │
│  │  │  • Diagnosis     │  └──────────────────┘              │                 │ │
│  │  │    Extractor     │                                   │                 │ │
│  │  │  • Doctor        │                                   │                 │ │
│  │  │    Extractor     │                                   │                 │ │
│  │  └──────────────────┘                                   │                 │ │
│  │           │                                               │                 │ │
│  │           ▼                                               │                 │ │
│  │  ┌─────────────────────────────────────────────────┐     │                 │ │
│  │  │  OUTPUT: Structured Prescription Data            │     │                 │ │
│  │  │  (matches template format)                       │     │                 │ │
│  │  └─────────────────────────────────────────────────┘     │                 │ │
│  └────────────────────────────────────────────────────────────┼─────────────────┘ │
│                                                               │                  │
│  ┌────────────────────────────────────────────────────────────┼─────────────────┐ │
│  │                    PDF GENERATOR                           │                 │ │
│  │                    (tools/pdf/...)                         │                 │ │
│  │                                                           │                 │ │
│  │  1. Load HTML template                                    │                 │ │
│  │  2. Bind data (prescription-template.js)                  │                 │ │
│  │  3. Render with Puppeteer                                 │                 │ │
│  │  4. Return base64 PDF                                     │                 │ │
│  └────────────────────────────────────────────────────────────┼─────────────────┘ │
│                                                               │                  │
│  ┌────────────────────────────────────────────────────────────┼─────────────────┐ │
│  │                    STORAGE                                 │                 │ │
│  │                    (live_conversation_store.cjs)           │                 │ │
│  │                                                           │                 │ │
│  │  session.prescription = {                                 │                 │ │
│  │    id, data, pdfData, status, generatedAt                 │                 │ │
│  │  }                                                        │                 │ │
│  └────────────────────────────────────────────────────────────┼─────────────────┘ │
│                                                               │                  │
│  ┌────────────────────────────────────────────────────────────┼─────────────────┐ │
│  │                    ROUTES                                  │                 │ │
│  │                    (prescription_routes.cjs)               │                 │ │
│  │                                                           │                 │ │
│  │  POST /api/prescriptions/from-session/:sessionId          │                 │ │
│  │  PUT  /api/prescriptions/:id                              │                 │ │
│  │  GET  /api/prescriptions/:id/pdf                          │                 │ │
│  │  POST /api/prescriptions/:id/save                         │                 │ │
│  │  POST /api/prescriptions/:id/validate                     │                 │ │
│  └────────────────────────────────────────────────────────────┼─────────────────┘ │
└───────────────────────────────────────────────────────────────┼──────────────────┘
                                                               │
                                                               │ External APIs
                                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SERVICES                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐    │
│  │      GEMMA          │  │      GEMINI        │  │   ICD-10 DATA       │    │
│  │   (Extraction)      │  │   (Web Search)     │  │   (Downloaded)      │    │
│  │                     │  │                     │  │                     │    │
│  │  • Patient info     │  │  • Medication      │  │  • Code lookup      │    │
│  │  • Medications      │  │    validation      │  │  • Description      │    │
│  │  • Diagnosis        │  │  • Dosage check    │  │                     │    │
│  │  • Doctor info      │  │                     │  │  WHO ICD-10        │    │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Data Structure Mapping

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        TRANSCRIPT → PRESCRIPTION MAPPING                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  DRAFT EXTRACTION                      TEMPLATE FIELD                           │
│  ────────────────────                   ────────────────                         │
│  ┌─────────────────────┐               ┌─────────────────────┐                 │
│  │ linkedPatient       │ ─────────────▶│ patient.name        │                 │
│  │                     │               │ patient.ageSex      │                 │
│  └─────────────────────┘               └─────────────────────┘                 │
│                                                                                 │
│  ┌─────────────────────┐               ┌─────────────────────┐                 │
│  │ diagnosis           │ ─────────────▶│ doctorNotes.freeText│                 │
│  │ symptoms            │               │                     │                 │
│  └─────────────────────┘               └─────────────────────┘                 │
│                                                                                 │
│  ┌─────────────────────┐               ┌─────────────────────┐                 │
│  │ medications[]       │ ─────────────▶│ prescription        │                 │
│  │   • name            │               │   .medicines[]      │                 │
│  │   • instruction     │               │   • name            │                 │
│  │                     │               │   • dose            │                 │
│  │                     │               │   • morning/noon/   │                 │
│  │                     │               │     night           │                 │
│  │                     │               │   • days            │                 │
│  │                     │               │   • remarks         │                 │
│  └─────────────────────┘               └─────────────────────┘                 │
│                                                                                 │
│  ┌─────────────────────┐               ┌─────────────────────┐                 │
│  │ labs[]              │ ─────────────▶│ labs.*              │                 │
│  │ radiology[]         │ ─────────────▶│ radiology.*         │                 │
│  │ procedures[]        │ ─────────────▶│ procedures.*        │                 │
│  └─────────────────────┘               └─────────────────────┘                 │
│                                                                                 │
│  ┌─────────────────────┐               ┌─────────────────────┐                 │
│  │ followUp[]          │ ─────────────▶│ nextVisitDate       │                 │
│  │ plan[]              │ ─────────────▶│ admission.*         │                 │
│  └─────────────────────┘               └─────────────────────┘                 │
│                                                                                 │
│  DOCTOR PROFILE                        TEMPLATE FIELD                           │
│  ──────────────                        ────────────────                         │
│  ┌─────────────────────┐               ┌─────────────────────┐                 │
│  │ profile.name        │ ─────────────▶│ consultant.name     │                 │
│  │ profile.regNo       │ ─────────────▶│ consultant.regNo    │                 │
│  │ profile.specialty   │ ─────────────▶│ consultant.department│                 │
│  │ profile.signature   │ ─────────────▶│ doctor.signatureText│                 │
│  └─────────────────────┘               └─────────────────────┘                 │
│                                                                                 │
│  HOSPITAL CONFIG (admin)               TEMPLATE FIELD                           │
│  ────────────────────────               ────────────────                         │
│  ┌─────────────────────┐               ┌─────────────────────┐                 │
│  │ hospital.name       │ ─────────────▶│ hospital.*          │                 │
│  │ hospital.tagline    │               │                     │                 │
│  │ hospital.address    │               │                     │                 │
│  └─────────────────────┘               └─────────────────────┘                 │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Component Interaction Sequence

```
Doctor           Frontend          WebSocket         Orchestrator       Services
  │                 │                  │                  │                │
  │ [Click End]      │                  │                  │                │
  │─────────────────▶│                  │                  │                │
  │                 │ session.end       │                  │                │
  │                 │──────────────────▶│                  │                │
  │                 │                  │ flushBuffer()    │                │
  │                 │                  │ transcribeChunk()│                │
  │                 │                  │──────────────────│                │
  │                 │                  │                  │                │
  │                 │                  │ generatePrescription()            │
  │                 │                  │─────────────────▶│                │
  │                 │                  │                  │                │
  │                 │                  │                  │──┐              │
  │                 │                  │                  │  │ Use skills  │
  │                 │                  │                  │◀─┘              │
  │                 │                  │                  │                │
  │                 │                  │                  │──┐              │
  │                 │                  │                  │  │ ICD-10      │
  │                 │                  │                  │◀─┘ Lookup      │
  │                 │                  │                  │                │
  │                 │                  │                  │──┐              │
  │                 │                  │                  │  │ Medication  │
  │                 │                  │                  │◀─┘ Validation  │
  │                 │                  │                  │                │
  │                 │                  │                  │──┐              │
  │                 │                  │                  │  │ PDF         │
  │                 │                  │                  │◀─┘ Generator   │
  │                 │                  │                  │                │
  │                 │ prescription.ready│                  │                │
  │                 │◀─────────────────│                  │                │
  │                 │                  │                  │                │
  │ [Show Modal]     │                  │                  │                │
  │◀────────────────│                  │                  │                │
  │                 │                  │                  │                │
  │ [Edit/Save]     │                  │                  │                │
  │─────────────────▶│ PUT /prescriptions/:id           │                │
  │                 │──────────────────▶│─────────────────│                │
  │                 │                  │                  │                │
  │ [Print]         │                  │                  │                │
  │─────────────────▶│ window.print()   │                  │                │
  │                 │                  │                  │                │
```

## File Dependencies

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            FILE DEPENDENCY GRAPH                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  NEW FILES (to create)                                                          │
│  ────────────────────────                                                      │
│                                                                                 │
│  prescription_orchestrator.cjs                                                 │
│    ├── uses → skills/extraction/prescription_*.skill.cjs                       │
│    ├── uses → services/icd10_lookup.cjs                                       │
│    ├── uses → services/medication_validator.cjs                               │
│    └── outputs → template format                                               │
│                                                                                 │
│  services/icd10_lookup.cjs                                                     │
│    ├── reads → server/storage/icd10_codes.json                                 │
│    └── caches → lookup results                                                 │
│                                                                                 │
│  services/medication_validator.cjs                                             │
│    ├── calls → GEMMA_URL (web search)                                          │
│    └── validates → medication data                                             │
│                                                                                 │
│  tools/pdf/prescription_pdf_generator.tool.cjs                                 │
│    ├── reads → prescription_template_dev/*.html                                │
│    ├── uses → puppeteer                                                        │
│    └── outputs → base64 PDF                                                   │
│                                                                                 │
│  server/prescription_routes.cjs                                                │
│    ├── uses → PrescriptionOrchestrator                                         │
│    ├── uses → PrescriptionPDFGenerator                                         │
│    └── modifies → LiveConversationStore                                        │
│                                                                                 │
│  EXISTING FILES (to modify)                                                     │
│  ────────────────────────────────                                              │
│                                                                                 │
│  server/live_conversation_websocket.cjs                                        │
│    └── adds → prescription generation on handleEnd()                           │
│                                                                                 │
│  server/live_conversation_store.cjs                                            │
│    └── extends → session object with prescription field                        │
│                                                                                 │
│  src/components/voice/LiveConversationWorkspace.tsx                            │
│    └── adds → prescription modal trigger                                       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```
