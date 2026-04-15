# Getting Started Guide

## Doctor Dashboard - Clinical Intelligence System

**Version:** 2.0.0
**Last Updated:** 2026-04-15

---

> Note
> This guide reflects the current root application in this repository: a React frontend plus an Express backend in `server/index.cjs`. Optional extractor tuning flags are included below, but the backend boot path itself reads a smaller set of environment variables than some older docs describe.

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | 18+ | Frontend/Backend runtime |
| Git | Latest | Version control |

### Required Services

| Service | Purpose | How to Get |
|---------|---------|------------|
| Gemma LLM API | AI inference (primary) | Contact infrastructure team |
| Gemini API | External knowledge (optional) | Google Cloud Console |

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file in the root directory:

```env
# Gemma LLM Configuration (Primary - for extraction)
GEMMA_URL=http://206.1.62.28:8000/v1/chat/completions
GEMMA_MODEL=google/gemma-4-26B-A4B-it

# Gemini API Configuration (Optional - for external knowledge)
GEMINI_API_KEY=your-gemini-api-key
USE_GEMINI_FOR_EXTERNAL=true

# Server Configuration
PORT=8001
NODE_ENV=development

# Extraction Configuration
EXTRACTION_PER_DOCUMENT_CONCURRENCY=3
ENABLE_PENDING_ITEMS_EXTRACTION=true
```

### 3. Start the Development Server

```bash
# Terminal 1: Start backend
npm run server

# Terminal 2: Start frontend (for development)
npm run dev
```

### 4. Access the Application

- **Frontend (dev):** http://localhost:5173
- **Backend API:** http://localhost:8001
- **API Health Check:** http://localhost:8001/api/health
- **Agent Status:** http://localhost:8001/api/agent/status

---

## Project Structure

```
manipal-coe/
├── server/                      # Root backend server
│   ├── index.cjs                # Main Express server with audit
│   └── audit_logger.cjs         # Audit logging system
├── agents/                      # AI Agents
│   ├── document_type_router.cjs # Auto-detects doc type
│   ├── discharge_extractor_agent.cjs
│   ├── outpatient_extractor_agent.cjs
│   ├── lab_report_extractor_agent.cjs
│   ├── chart_note_extractor_agent.cjs
│   └── [other agents...]
├── skills/                      # Reusable Skills
│   ├── extraction/              # Extraction skills
│   │   ├── pending_items_extractor.skill.cjs
│   │   ├── risk_scores_extractor.skill.cjs
│   │   ├── vitals_extractor.skill.cjs
│   │   └── [other extraction skills...]
│   ├── validation/              # Validation skills
│   ├── generation/              # Generation skills
│   ├── presentation/            # Presentation skills
│   └── chat/                    # Chat skills
├── tools/                       # Utility tools
│   ├── pdf/                     # PDF processing
│   ├── llm/                     # LLM clients
│   ├── clinical/                # Clinical tools
│   └── presentation/            # Presentation tools
├── src/                         # Frontend React code
│   ├── components/
│   │   └── dashboard/
│   ├── pages/
│   ├── lib/
│   └── main.tsx
├── server/storage/              # Data storage
│   ├── uploads/                 # PDF files
│   ├── documents.json           # Processed documents
│   ├── audit_runs.json          # Audit run metadata
│   ├── audit_events.jsonl       # Audit event log
│   └── chat_sessions.json       # Chat history
└── docs/                        # Documentation
```

---

## Development Workflow

### 1. Upload a PDF

```bash
curl -X POST http://localhost:8001/api/documents/upload \
  -F "files=@/path/to/discharge_summary.pdf"
```

### 2. Process the Document

```bash
curl -X POST http://localhost:8001/api/documents/process \
  -H "Content-Type: application/json" \
  -d '{"ids": ["document-id-from-upload"]}'
```

### 3. View Audit Trail

```bash
# List all audit runs
curl http://localhost:8001/api/audit/runs

# Get specific run details
curl http://localhost:8001/api/audit/runs/{runId}

# Get run events
curl http://localhost:8001/api/audit/runs/{runId}/events
```

### 4. View the Dashboard

Navigate to the dashboard page using the document ID:
```
http://localhost:5173/dashboard?documentId=<document-id>
```

---

## API Endpoints

### Health & Status

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server health with identity |
| `GET /api/agent/status` | Agent system status |

### Document Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/documents` | GET | List all documents |
| `/api/documents/:id` | GET | Get single document |
| `/api/documents/upload` | POST | Upload PDF(s) |
| `/api/documents/process` | POST | Process documents |
| `/api/documents/process/progress` | GET | SSE progress stream |
| `/api/documents/:id` | DELETE | Delete document |

### Audit Trail

| Endpoint | Description |
|----------|-------------|
| `GET /api/audit/runs` | List audit runs |
| `GET /api/audit/runs/:runId` | Get specific run |
| `GET /api/audit/runs/:runId/events` | Get run events |

### Chat

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat/query` | POST | Submit chat query |
| `/api/chat/history/:documentId` | GET | Get chat history |
| `/api/chat/source-health` | GET | Check external sources |

### Chart Notes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/documents/:id/chart-note` | GET | Get chart note |
| `/api/documents/:id/chart-note` | POST | Generate chart note |
| `/api/documents/:id/chart-note/pdf` | POST | Export chart note PDF |

---

## Configuration

### Gemma LLM Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMMA_URL` | LLM API endpoint | Required |
| `GEMMA_MODEL` | Model identifier | `google/gemma-4-26B-A4B-it` |
| `USE_GEMINI_FOR_EXTERNAL` | Enable Gemini-backed external knowledge lookups | `true` |
| `GEMINI_MODEL` | Gemini model for external knowledge mode | `gemini-2.5-flash` |
| `GEMINI_API_KEY` | Gemini API key for external lookups | Optional |

### Extraction Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `EXTRACTION_PER_DOCUMENT_CONCURRENCY` | Parallel extraction steps | `3` |
| `ENABLE_PENDING_ITEMS_EXTRACTION` | Enable pending items extraction | `true` |
| `ENABLE_DOCUMENT_ANALYZER` | Enable document analysis step | `false` |

---

## Troubleshooting

### Common Issues

**Issue:** "Template not found: pending_items_extractor"
- **Solution:** Ensure `tools/llm/prompt_builder.tool.cjs` includes the template

**Issue:** "Audit run not found"
- **Solution:** Check `server/storage/audit_runs.json` exists and has data

**Issue:** "Parallel extraction not working"
- **Solution:** Check `EXTRACTION_PER_DOCUMENT_CONCURRENCY` is set to > 1

---

## Next Steps

1. **Review Architecture:** Read the [AI Architecture](../architecture/ai-architecture.md) document
2. **Explore Components:** Browse the component library
3. **Customize:** Modify components and prompts for your use case

---

**Document Version:** 2.0
**Last Updated:** 2026-04-15
