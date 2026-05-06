# API Reference

## Doctor Dashboard - Clinical Intelligence System

**Version:** 2.0.0
**Base URL:** `http://localhost:8001/api`
**Last Updated:** 2026-04-15

---

## Overview

The Doctor Dashboard provides a REST API for document processing, audit logging, chat interactions, and chart note generation. All endpoints return JSON responses unless otherwise specified.

> Note
> This reference documents the current Express server in `server/index.cjs`. Some older architecture docs in this repository describe historical or planned systems and may not match these endpoint shapes.

---

## Health & Status

### GET /health

Check API health and server identity.

**Response:**
```json
{
  "status": "ok",
  "server": "root",
  "version": "2.0.0",
  "model": "google/gemma-4-31B-it",
  "audit": {
    "enabled": true
  },
  "timestamp": "2026-04-15T10:00:00Z"
}
```

### GET /agent/status

Get AI agent system status.

**Response:**
```json
{
  "agent": {
    "name": "Document Type Router",
    "version": "1.0.0",
    "type": "router",
    "skillsCount": 7,
    "toolsCount": 4
  },
  "gemma": {
    "url": "http://gemma-api:8000",
    "model": "google/gemma-4-31B-it"
  },
  "dashboardMapper": {
    "name": "Dashboard Mapper",
    "version": "1.0.0"
  }
}
```

---

## Document Management

### GET /documents

List all processed documents.

**Response:**
```json
{
  "documents": [
    {
      "id": "uuid",
      "name": "discharge_summary.pdf",
      "size": 250000,
      "uploadedAt": "2026-04-15T10:00:00Z",
      "status": "processed",
      "department": "Cardiology / Cath Lab",
      "result": { /* dashboard data */ },
      "auditRunId": "run-uuid"
    }
  ]
}
```

### GET /documents/:id

Get a single processed document.

**Path Parameters:**
- `id`: Document UUID

**Response:**
```json
{
  "document": {
    "id": "uuid",
    "name": "discharge_summary.pdf",
    "result": {
      "meta": { /* metadata */ },
      "dashboard_cards": { /* card data */ },
      "sample_patient_data": { /* patient data */ },
      "presentation": { /* presentation data */ },
      "extracted_data": { /* full data including pending_items */ }
    },
    "auditRunId": "run-uuid"
  }
}
```

### POST /documents/upload

Upload one or more PDF files.

**Request:** `multipart/form-data`
- `files`: PDF file(s) - up to 50 files, 25MB each

**Response:**
```json
{
  "documents": [
    {
      "id": "uuid",
      "name": "discharge_summary.pdf",
      "size": 250000,
      "uploadedAt": "2026-04-15T10:00:00Z"
    }
  ],
  "duplicates": [
    {
      "name": "duplicate.pdf",
      "existingDocument": { /* ... */ }
    }
  ]
}
```

### POST /documents/process

Process uploaded documents (batch mode).

**Request Body:**
```json
{
  "ids": ["uuid1", "uuid2"]
}
```

**Response:**
```json
{
  "documents": [
    {
      "id": "uuid",
      "status": "processed",
      "auditRunId": "run-uuid"
    }
  ]
}
```

### GET /documents/process/progress

Subscribe to processing progress via Server-Sent Events (SSE).

**Query Parameters:**
- `documentId`: Document UUID to track

**Response:** SSE stream with events:
```json
// Event: connected
{"type": "connected", "documentId": "uuid"}

// Event: step
{
  "type": "step",
  "step": "Risk Scores Extractor",
  "stepNumber": 2,
  "totalSteps": 7,
  "status": "complete",
  "data": {
    "tokens": 1200,
    "latency": 3500
  }
}

// Event: done
{
  "type": "done",
  "documentId": "uuid",
  "document": { /* processed document */ }
}

// Event: error
{
  "type": "error",
  "documentId": "uuid",
  "error": "Processing failed"
}
```

### GET /analytics/overview

Load aggregated Processing Insights metrics.

**Response:**
```json
{
  "documentsByType": [
    { "documentType": "prescription", "count": 4 },
    { "documentType": "discharge_summary", "count": 2 }
  ],
  "tokensByProvider": {
    "gemma": 120000,
    "gemini": 4000,
    "total": 124000
  },
  "medicationsByDocumentType": [
    { "documentType": "prescription", "count": 18 }
  ],
  "testsByDocumentType": [
    {
      "documentType": "discharge_summary",
      "lab": 12,
      "radiology": 4,
      "nuclearMedicine": 1,
      "procedures": 2
    }
  ],
  "summary": {
    "includedDocuments": 10,
    "refreshedAt": "2026-05-06T10:00:00Z"
  }
}
```

### DELETE /documents/:id

Delete a document and its file.

**Response:** `204 No Content`

### GET /documents/:id/handwriting-progress

Run prescription Stage 3 handwriting extraction as an SSE stream.

**Query Parameters:**
- `apiKey`: Gemini API key

**Notes:**
- only valid for prescription documents
- returns SSE events such as `connected`, `key_verified`, `start`, `step`, `done`, and `error`

### POST /documents/:id/complete-handwriting

Complete prescription handwriting extraction with a JSON request.

**Request Body:**
```json
{
  "geminiApiKey": "AIza..."
}
```

**Response:**
```json
{
  "document": { "id": "uuid", "status": "processed" },
  "message": "Handwriting extraction completed successfully",
  "data": {
    "medications_count": 6,
    "lab_selections_count": 3
  }
}
```

---

## Audit Trail

### GET /audit/runs

List audit runs with optional filtering.

**Query Parameters:**
- `workflow` (optional): Filter by workflow type (`extraction`, `chart_note`, `chat`)
- `documentId` (optional): Filter by document ID
- `status` (optional): Filter by status (`running`, `completed`, `failed`)
- `limit` (optional): Max results (default: 50)

**Response:**
```json
{
  "runs": [
    {
      "runId": "uuid",
      "workflow": "extraction",
      "documentId": "doc-uuid",
      "title": "discharge_summary.pdf",
      "status": "completed",
      "startedAt": "2026-04-15T10:00:00Z",
      "completedAt": "2026-04-15T10:03:00Z",
      "durationMs": 180000,
      "summary": {
        "agentName": "Discharge Summary Extractor",
        "tokensUsed": 15000,
        "stepsCount": 7
      }
    }
  ]
}
```

### GET /audit/runs/:runId

Get a specific audit run.

**Path Parameters:**
- `runId`: Audit run UUID

**Response:**
```json
{
  "run": {
    "runId": "uuid",
    "workflow": "extraction",
    "documentId": "doc-uuid",
    "title": "discharge_summary.pdf",
    "status": "completed",
    "startedAt": "2026-04-15T10:00:00Z",
    "completedAt": "2026-04-15T10:03:00Z",
    "durationMs": 180000,
    "summary": { /* ... */ }
  }
}
```

### GET /audit/runs/:runId/events

Get events for a specific audit run.

**Path Parameters:**
- `runId`: Audit run UUID

**Query Parameters:**
- `limit` (optional): Max events (default: 500)

**Response:**
```json
{
  "events": [
    {
      "id": "event-uuid",
      "timestamp": "2026-04-15T10:00:00Z",
      "type": "run_started",
      "status": "info",
      "title": "discharge_summary.pdf"
    },
    {
      "id": "event-uuid",
      "timestamp": "2026-04-15T10:00:05Z",
      "type": "agent_progress",
      "status": "info",
      "title": "Vitals Extractor"
    },
    {
      "id": "event-uuid",
      "timestamp": "2026-04-15T10:03:00Z",
      "type": "run_completed",
      "status": "success"
    }
  ]
}
```

---

## Chat

### POST /chat/query

Submit a chat query.

**Request Body:**
```json
{
  "documentId": "uuid",
  "message": "What is the patient's blood pressure?",
  "sectionContext": ["vitals"],
  "chatId": "optional-chat-uuid",
  "geminiApiKey": "optional-gemini-key"
}
```

**Response:**
```json
{
  "response": {
    "answer": "The patient's blood pressure is 130/85 mmHg...",
    "citations": [ /* citation data */ ],
    "confidence": 85,
    "proposed_actions": [ /* ... */ ]
  },
  "session": {
    "chatId": "uuid",
    "messages": [ /* ... */ ]
  }
}
```

### GET /chat/history/:documentId

Get chat history for a document.

**Response:**
```json
{
  "session": {
    "chatId": "uuid",
    "documentId": "doc-uuid",
    "messages": [ /* message history */ ]
  }
}
```

### DELETE /chat/history/:documentId

Clear chat history for a document.

**Query Parameters:**
- `chatId` (optional): Specific chat ID to clear

**Response:**
```json
{
  "cleared": true,
  "chatId": "uuid"
}
```

### GET /chat/source-health

Check external knowledge source health.

**Response:**
```json
{
  "sources": [
    {
      "name": "gemini",
      "status": "available",
      "latency": 150
    }
  ]
}
```

### POST /chat/action/confirm

Confirm a proposed action.

**Request Body:**
```json
{
  "documentId": "uuid",
  "chatId": "uuid",
  "actionId": "action-1"
}
```

**Response:**
```json
{
  "action": {
    "id": "action-1",
    "confirmedAt": "2026-04-15T10:00:00Z"
  },
  "session": { /* ... */ }
}
```

### POST /chat/export/:documentId

Export chat history for chart note appendix.

**Request Body:**
```json
{
  "chatId": "optional-chat-uuid"
}
```

**Response:**
```json
{
  "export": {
    "id": "uuid",
    "documentId": "doc-uuid",
    "chart_note_appendix": { /* ... */ }
  }
}
```

---

## Chart Notes

### GET /documents/:id/chart-note

Get existing chart note (with optional regeneration).

**Query Parameters:**
- `regenerate` (optional): Force regeneration (`true`/`false`)
- `force` (optional): Alias for regenerate

**Response:**

Cached response:
```json
{
  "chartNote": {
    "content": "DISCHARGE SUMMARY CHART NOTE\n\nPatient: ...",
    "generatedAt": "2026-04-15T10:00:00Z",
    "tokensUsed": 2500,
    "generationTime": 45000,
    "agentType": "react",
    "reasoningSteps": [ /* ... */ ],
    "validation": { /* ... */ },
    "citations": { /* ... */ },
    "auditRunId": "run-uuid"
  },
  "cached": true
}
```

Regenerated response:
```json
{
  "chartNote": {
    "content": "DISCHARGE SUMMARY CHART NOTE\n\nPatient: ...",
    "generatedAt": "2026-04-15T10:00:00Z",
    "tokensUsed": 2500,
    "generationTime": 45000,
    "agentType": "react",
    "reasoningSteps": [ /* ... */ ],
    "validation": { /* ... */ },
    "citations": { /* ... */ }
  },
  "cached": false,
  "regenerated": true
}
```

### POST /documents/:id/chart-note

Generate new chart note.

**Response:**
```json
{
  "chartNote": {
    "content": "DISCHARGE SUMMARY CHART NOTE\n\nPatient: ...",
    "generatedAt": "2026-04-15T10:00:00Z",
    "tokensUsed": 2500,
    "generationTime": 45000,
    "agentType": "react",
    "reasoningSteps": [ /* ... */ ],
    "validation": { /* ... */ },
    "citations": { /* ... */ },
    "auditRunId": "run-uuid"
  },
  "needsReview": true
}
```

### POST /documents/:id/chart-note/pdf

Export chart note as PDF.

**Response:** Returns PDF file with headers:
```
Content-Type: application/pdf
Content-Disposition: attachment; filename=discharge-summary-{id}.pdf
```

---

## Alerts

### POST /documents/:id/alert-preview

Preview alert payloads without sending.

**Request Body:**
```json
{
  "target": "all"
}
```

**Supported values:** `all`, `medications`, `labs`, `radiology`, `treatment`, `pharmacy`, `lab`, `nuclear_medicine`, `procedures`

### POST /documents/:id/send-alerts

Send manual pharmacy or department alerts for a processed document.

**Request Body:**
```json
{
  "alertType": "all",
  "target": null
}
```

---

## Notes

- Processing Insights are backed by `server/storage/analytics.sqlite` and are backfilled from `documents.json` on read.
- The main production extraction path is `DocumentTypeRouter -> specialized extractor agent`, not `ReActExtractionAgent` by default.

---

## Testing

### POST /agent/test-pdf

Test agent with verbose output (development only).

**Request:** `multipart/form-data`
- `file`: PDF file to test

**Response:**
```json
{
  "success": true,
  "summary": {
    "pdfName": "test.pdf",
    "agentName": "Discharge Summary Extractor",
    "agentVersion": "2.0.0",
    "totalLatency": 180000,
    "tokensUsed": 15000,
    "stepsCount": 7
  },
  "steps": [ /* step summaries */ ],
  "validation": { /* validation summary */ },
  "extractedData": { /* extracted data */ },
  "rawResult": { /* full agent payload */ }
}
```

---

## Error Responses

All endpoints may return error responses:

```json
{
  "error": "Error description"
}
```

**Common Error Codes:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Bad Request | Malformed request body or parameters |
| 404 | Not Found | Resource not found |
| 500 | Server Error | Processing error or exception |

---

**Document Version:** 2.0
**Last Updated:** 2026-04-15
