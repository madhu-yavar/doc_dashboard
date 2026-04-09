# API Reference

## Doctor Dashboard - Clinical Intelligence System

**Version:** 2.0.0
**Base URL:** `http://localhost:8001/api`
**Last Updated:** 2026-04-07

---

## Overview

The Doctor Dashboard provides a REST API for document processing, chat interactions, and chart note generation. All endpoints return JSON responses unless otherwise specified.

---

## Authentication

Currently, the API does not require authentication for development. For production deployment, implement appropriate authentication mechanisms.

---

## Response Format

### Success Response

```json
{
  "success": true,
  "data": { /* response data */ }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE"
  }
}
```

---

## Endpoints

### Health & Status

#### GET /health

Check API and service health.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-04-07T10:00:00Z",
  "services": {
    "api": "ok",
    "gemma": "ok",
    "storage": "ok"
  }
}
```

#### GET /agent/status

Get AI agent system status.

**Response:**
```json
{
  "status": "ready",
  "version": "2.0.0",
  "agents": {
    "DischargeExtractorAgent": "ready",
    "DoctorAssistantAgent": "ready",
    "ChartNoteAgent": "ready"
  },
  "gemma": {
    "connected": true,
    "model": "google/gemma-4-26B-A4B-it"
  }
}
```

---

### Document Management

#### GET /documents

List all processed documents.

**Query Parameters:**
- `limit` (optional): Number of documents to return (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "id": "uuid",
        "filename": "discharge_summary.pdf",
        "uploaded_at": "2026-04-07T10:00:00Z",
        "processed": true,
        "patient_name": "John Doe"
      }
    ],
    "total": 100,
    "limit": 50,
    "offset": 0
  }
}
```

#### GET /documents/:id

Get a single processed document.

**Path Parameters:**
- `id`: Document UUID

**Response:**
```json
{
  "success": true,
  "data": {
    "meta": {
      "id": "uuid",
      "pdf_file": "discharge_summary.pdf",
      "processed_at": "2026-04-07T10:00:00Z",
      "agent_version": "2.0.0"
    },
    "dashboard_cards": { /* card data */ },
    "sample_patient_data": { /* patient data */ },
    "presentation": { /* presentation data */ },
    "extracted_data": { /* full extracted data */ },
    "pending_items": {
      "pending_labs": [...],
      "pending_radiology": [...],
      "pending_followups": [...],
      "medication_reconciliation": {...},
      "pending_discharge_items": [...],
      "summary": {...}
    },
    "provenance": { /* citation data */ }
  }
}
```

#### POST /documents/upload

Upload one or more PDF files.

**Request:** `multipart/form-data`
- `file`: PDF file(s) - can be multiple

**Response:**
```json
{
  "success": true,
  "data": {
    "uploaded": [
      {
        "id": "uuid",
        "filename": "discharge_summary.pdf",
        "size": 250000,
        "path": "/storage/uploads/discharge_summary.pdf"
      }
    ]
  }
}
```

#### POST /documents/process

Process uploaded documents.

**Request Body:**
```json
{
  "ids": ["uuid1", "uuid2"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "processing": ["uuid1", "uuid2"]
  }
}
```

#### GET /documents/process/progress

Subscribe to processing progress via Server-Sent Events.

**Query Parameters:**
- `documentId`: Document UUID to track

**Response:** SSE stream with events:
```json
// Event: start
{
  "type": "start",
  "pdfName": "discharge_summary.pdf",
  "totalSteps": 7
}

// Event: step
{
  "type": "step",
  "step": "VitalsExtractor",
  "stepNumber": 4,
  "status": "in_progress",
  "data": { /* partial results */ }
}

// Event: complete
{
  "type": "complete",
  "latency": 35000,
  "tokensUsed": 6000,
  "confidence": 0.92
}

// Event: error
{
  "type": "error",
  "error": "Processing failed"
}
```

#### DELETE /documents/:id

Delete a document.

**Response:**
```json
{
  "success": true,
  "data": {
    "deleted": "uuid"
  }
}
```

---

### Chat

#### POST /chat/query

Submit a chat query.

**Request Body:**
```json
{
  "documentId": "uuid",
  "message": "What is the patient's blood pressure?",
  "sectionContext": ["vitals"],
  "chatId": "optional-chat-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "answer": "The patient's blood pressure is 130/85 mmHg, which is within normal range.",
    "citations": [
      {
        "value": "130/85 mmHg",
        "source": "internal",
        "page": 3,
        "line": 15,
        "confidence": 0.95
      }
    ],
    "confidence": 85,
    "confidence_label": "high",
    "source_class": "internal",
    "refused": false,
    "proposed_actions": [
      {
        "id": "action-1",
        "type": "monitoring",
        "title": "Continue Monitoring",
        "description": "Blood pressure is stable, continue routine monitoring."
      }
    ],
    "chatId": "uuid",
    "messageId": "uuid"
  }
}
```

#### GET /chat/history/:documentId

Get chat history for a document.

**Response:**
```json
{
  "success": true,
  "data": {
    "chatId": "uuid",
    "messages": [
      {
        "id": "uuid",
        "role": "user",
        "content": "What is the patient's blood pressure?",
        "createdAt": "2026-04-07T10:00:00Z"
      },
      {
        "id": "uuid",
        "role": "assistant",
        "content": "The patient's blood pressure is...",
        "citations": [ /* ... */ ],
        "confidence": 85,
        "createdAt": "2026-04-07T10:00:01Z"
      }
    ]
  }
}
```

#### DELETE /chat/history/:documentId

Clear chat history for a document.

**Response:**
```json
{
  "success": true,
  "data": {
    "cleared": true
  }
}
```

#### POST /chat/action/confirm

Confirm a proposed action.

**Request Body:**
```json
{
  "documentId": "uuid",
  "actionId": "action-1",
  "chatId": "optional-chat-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "confirmed": true,
    "actionId": "action-1",
    "confirmedAt": "2026-04-07T10:00:00Z"
  }
}
```

#### POST /chat/export/:documentId

Export chat history.

**Request Body:**
```json
{
  "format": "pdf" // or "text"
}
```

**Response:** Returns file of requested format.

---

### Chart Notes

#### GET /documents/:id/chart-note

Get existing chart note.

**Response:**
```json
{
  "success": true,
  "data": {
    "chart_note": {
      "subjective": { /* ... */ },
      "objective": { /* ... */ },
      "assessment": { /* ... */ },
      "plan": { /* ... */ }
    },
    "citations": [ /* ... */ ],
    "metadata": {
      "generated_at": "2026-04-07T10:00:00Z",
      "confidence": 0.92
    }
  }
}
```

#### POST /documents/:id/chart-note

Generate new chart note.

**Request Body:**
```json
{
  "include_reasoning": true,
  "format": "soap" // or "narrative"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "chart_note": { /* generated chart note */ },
    "reasoning": [ /* step-by-step reasoning */ ],
    "citations": [ /* ... */ ],
    "metadata": { /* ... */ }
  }
}
```

#### POST /documents/:id/chart-note/pdf

Export chart note as PDF.

**Response:** Returns PDF file.

---

## Error Codes

| Code | Description |
|------|-------------|
| `INVALID_REQUEST` | Malformed request body |
| `NOT_FOUND` | Resource not found |
| `PROCESSING_ERROR` | Document processing failed |
| `GEMMA_ERROR` | LLM API error |
| `VALIDATION_ERROR` | Input validation failed |
| `STORAGE_ERROR` | File storage error |
| `TIMEOUT` | Request timeout |

---

## Rate Limiting

Currently, no rate limiting is enforced in development. For production, implement appropriate rate limits:

- Document upload: 10 per minute
- Chat queries: 30 per minute
- Chart note generation: 5 per minute

---

## Webhooks

Webhooks can be configured for:

- Document processing complete
- Chat action confirmed
- Error notifications

Configure webhooks via environment variables or configuration file.

---

**Document Version:** 2.0
**Last Updated:** 2026-04-07
