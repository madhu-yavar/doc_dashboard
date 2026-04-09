# Getting Started Guide

## Doctor Dashboard - Clinical Intelligence System

**Version:** 2.0.0
**Last Updated:** 2026-04-07

---

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | 18+ | Frontend/Backend runtime |
| Python | 3.8+ | LLM API (optional) |
| Git | Latest | Version control |

### Required Services

| Service | Purpose | How to Get |
|---------|---------|------------|
| Gemma LLM API | AI inference | Contact infrastructure team |
| PDF Storage | File storage | Local filesystem or cloud |

---

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd doctor_dashboard
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Create a `.env` file in the `doctor_dashboard` directory:

```env
# Gemma LLM Configuration
GEMMA_URL=http://your-gemma-api:8000
GEMMA_MODEL=google/gemma-4-26B-A4B-it

# Server Configuration
PORT=8001
NODE_ENV=development

# Storage Configuration
STORAGE_PATH=./storage
```

### 4. Start the Development Server

```bash
# Terminal 1: Start backend
npm run server

# Terminal 2: Start frontend
npm run dev
```

### 5. Access the Application

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:8001
- **API Health Check:** http://localhost:8001/api/health

---

## Project Structure

```
doctor_dashboard/
├── src/                          # Frontend React code
│   ├── components/               # React components
│   │   └── dashboard/           # Dashboard-specific components
│   ├── pages/                   # Page components
│   ├── lib/                     # Utility functions
│   └── main.tsx                 # App entry point
├── server/                      # Backend Express server
│   └── index.cjs                # API server
├── agents/                      # AI Agents
│   ├── discharge_extractor_agent.cjs
│   ├── doctor_assistant_agent.cjs
│   └── chart_note_agent.cjs
├── skills/                      # Reusable Skills
│   ├── extraction/
│   ├── validation/
│   ├── generation/
│   ├── presentation/
│   └── chat/
├── tools/                       # Utility tools
│   ├── pdf/
│   ├── llm/
│   ├── clinical/
│   ├── presentation/
│   └── chat/
├── storage/                     # Data storage
│   ├── uploads/                 # PDF files
│   ├── documents.json           # Processed documents
│   └── chat_sessions.json       # Chat history
└── tests/                       # Test files
```

---

## Development Workflow

### 1. Upload a PDF

Use the Upload Center to upload discharge summary PDFs:

```bash
curl -X POST http://localhost:8001/api/documents/upload \
  -F "file=@/path/to/discharge_summary.pdf"
```

### 2. Process the Document

```bash
curl -X POST http://localhost:8001/api/documents/process \
  -H "Content-Type: application/json" \
  -d '{"ids": ["document-id-from-upload"]}'
```

### 3. View the Dashboard

Navigate to the dashboard page using the document ID:
```
http://localhost:5173/dashboard/<document-id>
```

### 4. Chat with the Assistant

Use the chat panel to ask questions about the patient data.

---

## API Endpoints

### Document Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/documents` | GET | List all documents |
| `/api/documents/:id` | GET | Get single document |
| `/api/documents/upload` | POST | Upload PDF(s) |
| `/api/documents/process` | POST | Process documents |
| `/api/documents/process/progress` | GET | SSE progress stream |
| `/api/documents/:id` | DELETE | Delete document |

### Chat

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat/query` | POST | Submit chat query |
| `/api/chat/history/:documentId` | GET | Get chat history |
| `/api/chat/history/:documentId` | DELETE | Clear chat |
| `/api/chat/action/confirm` | POST | Confirm action |
| `/api/chat/export/:documentId` | POST | Export chat |

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
| `GEMMA_TIMEOUT` | Request timeout | `180000` (3 min) |
| `GEMMA_MAX_TOKENS` | Max tokens per response | `4096` |

### Agent Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_MAX_RETRIES` | Retry attempts | `2` |
| `AGENT_TIMEOUT` | Step timeout | `180000` |
| `AGENT_TEMPERATURE` | LLM temperature | `0.1` |

---

## Troubleshooting

### Common Issues

**Issue:** "Gemma connection refused"
- **Solution:** Check `GEMMA_URL` is correct and service is running

**Issue:** "PDF processing fails"
- **Solution:** Ensure PDF is text-based (not scanned images)

**Issue:** "Chat responses are slow"
- **Solution:** Check Gemma API latency, consider caching

**Issue:** "Dashboard shows no data"
- **Solution:** Check browser console for errors, verify document processing completed

---

## Next Steps

1. **Review Architecture:** Read the [AI Architecture](../architecture/ai-architecture.md) document
2. **Explore Components:** Browse the component library
3. **Customize:** Modify components and prompts for your use case
4. **Deploy:** Follow the deployment guide for production setup

---

## Support

For issues or questions:
- Check the [documentation index](../README.md)
- Review existing issues in the project repository
- Contact the development team

---

**Document Version:** 2.0
**Last Updated:** 2026-04-07
