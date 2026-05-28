# Generate Prescription Button - Complete Flow

## Prerequisites for Button to Appear

```
session.status === "finalized"  AND  session.documentId exists
```

## Step-by-Step Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: CREATE SESSION                                                      │
│                                                                             │
│ POST /api/voice/live/sessions                                              │
│ Body: { linkedPatient: "John Doe", encounterLabel: "Fever Consult" }       │
│                                                                             │
│ Response:                                                                   │
│ {                                                                           │
│   id: "live-poc-test-001",                                                 │
│   status: "draft",                                                         │
│   documentId: null          ← Not set yet                                  │
│ }                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: START RECORDING                                                     │
│                                                                             │
│ WebSocket connects to: /api/voice/live/sessions/{id}/stream                │
│                                                                             │
│ status: "draft" → "live"                                                    │
│                                                                             │
│ - Audio chunks sent to server                                              │
│ - STT Agent transcribes in real-time                                        │
│ - Transcript segments streamed back to UI                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: DRAFT EXTRACTION (Every 15 seconds while recording)               │
│                                                                             │
│ Server: live_conversation_websocket.cjs                                    │
│ Method: startDraftExtraction(sessionId)                                    │
│                                                                             │
│ Process:                                                                    │
│   1. Collect new transcript segments                                       │
│   2. Combine into full transcript                                          │
│   3. Send to Gemma AI with prompt:                                         │
│      "Extract clinical information from this transcript..."                │
│   4. Parse JSON response:                                                  │
│      { medications, labs, radiology, diagnosis, symptoms... }            │
│   5. Store in session.draftExtraction                                      │
│   6. Send via WebSocket: { type: "draft.updated", draft }                │
│                                                                             │
│ UI Updates: Real-time medications/labs appear as "draft"                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: STOP RECORDING                                                       │
│                                                                             │
│ User clicks [End] button                                                   │
│                                                                             │
│ status: "live" → "review_required"                                         │
│                                                                             │
│ Server processing:                                                          │
│   - Final transcript analysis                                              │
│   - Generate review items for:                                             │
│     • Low confidence segments                                               │
│     • Medication dosage detected                                           │
│     • Critical values (labs, vitals)                                       │
│   - Return review items to UI                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: RESOLVE REVIEW ITEMS                                                │
│                                                                             │
│ UI shows review items:                                                      │
│                                                                             │
│   ⚠️ Confirm medication dosage: "Amoxicillin 500mg"                        │
│      [Approve] [Edit]                                                       │
│                                                                             │
│   ⚠️ Lab order ambiguous: "CBC test"                                       │
│      [Approve] [Edit]                                                       │
│                                                                             │
│ User action: For each item:                                                │
│   - Click [Approve] → resolution: "approved"                                │
│   - Or [Edit] → enter correct value → resolution: "edited"                 │
│                                                                             │
│ POST /api/voice/live/sessions/{id}/review-items/{itemId}                   │
│ Body: { resolution: "approved", editedValue: "..." }                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 6: FINALIZE SESSION                                                     │
│                                                                             │
│ Condition check:                                                            │
│   ✅ status === "review_required"                                           │
│   ✅ ALL review items resolved (none with resolution: "pending")           │
│                                                                             │
│ POST /api/voice/live/sessions/{id}/finalize                                │
│                                                                             │
│ Server actions:                                                             │
│   1. createDashboardDocument(session)                                      │
│      - Creates document ID: "voice-live-{sessionId}"                       │
│      - Transforms draft data to document format                            │
│      - Writes to documents.json                                            │
│      - Returns: documentId                                                 │
│                                                                             │
│   2. store.finalize(sessionId, documentId)                                 │
│      - Sets session.status = "finalized"                                  │
│      - Sets session.documentId = "voice-live-..."                          │
│      - Sets session.endedAt = timestamp                                    │
│                                                                             │
│ Response:                                                                   │
│ {                                                                           │
│   id: "live-poc-test-001",                                                 │
│   status: "finalized",        ← Changed!                                   │
│   documentId: "voice-live-live-poc-test-001"  ← Now set!                  │
│ }                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 7: GENERATE PRESCRIPTION BUTTON APPEARS                                │
│                                                                             │
│ UI checks:                                                                  │
│   if (session.status === "finalized" && session.documentId) {              │
│     SHOW [Generate Prescription] BUTTON                                    │
│   }                                                                          │
│                                                                             │
│ Button HTML:                                                                │
│   <Button                                                                   │
│     className="bg-purple-600"                                               │
│     onClick={() => window.location.href = `/prescription/${session.documentId}`}
│   >                                                                          │
│     Generate Prescription                                                    │
│   </Button>                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 8: PRESCRIPTION PAGE OPENS                                             │
│                                                                             │
│ URL: /prescription/voice-live-live-poc-test-001                            │
│                                                                             │
│ Component: <PrescriptionReview documentId={session.documentId} />          │
│                                                                             │
│ Actions:                                                                    │
│   1. GET /api/prescriptions/data/{documentId}                              │
│      → Returns transformed prescription data                               │
│                                                                             │
│   2. Display Review UI with tabs:                                          │
│      - Medications (edit timing, dose)                                     │
│      - Labs (check/uncheck)                                                │
│      - Radiology (check/uncheck)                                           │
│      - Notes & Vitals                                                       │
│      - Preview                                                              │
│                                                                             │
│   3. User clicks [Generate]                                                │
│      → POST /api/prescriptions/generate                                    │
│      → Returns PDF URL                                                     │
│      → Opens PDF in new tab                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Code Flow Summary

**Backend Files:**
| File | Method | Purpose |
|------|--------|---------|
| `live_conversation_routes.cjs` | `POST /sessions` | Create session (draft) |
| `live_conversation_websocket.cjs` | `startDraftExtraction()` | AI extraction every 15s |
| `live_conversation_routes.cjs` | `POST /sessions/:id/finalize` | Create document + finalize |
| `prescription_service.cjs` | `mapVoiceToPrescription()` | Transform voice → prescription |

**Frontend Files:**
| File | Component | Purpose |
|------|-----------|---------|
| `LiveConversationWorkspace.tsx` | `SessionReviewPanel` | Shows Generate Prescription button |
| `Prescription.tsx` | Page | Route handler |
| `PrescriptionReview.tsx` | Component | Review & Edit UI |

## Key State Transitions

```
draft → live → review_required → finalized
  ↓        ↓           ↓                ↓
 start  recording  resolve review   document created
```

## Button Appearance Logic

```typescript
// In SessionReviewPanel component
if (session.status === "finalized") {
  return (
    <>
      <Badge>Published</Badge>
      <Badge>Document {session.documentId}</Badge>
      
      {session.documentId && (
        <Button onClick={() => window.location.href = `/prescription/${session.documentId}`}>
          Generate Prescription
        </Button>
      )}
    </>
  );
}
```

## Common Issues & Debugging

**Button not showing?**
1. Check session status is "finalized" (not "review_required")
2. Check session.documentId exists (not null/undefined)
3. Check all review items are resolved

**Prescription data not loading?**
1. Check document exists in documents.json
2. Check documentType === "voice"
3. Check extracted_data structure matches expected format
