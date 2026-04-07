# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Doctor Dashboard is a medical document processing application. Users upload discharge-summary PDFs, which are processed by a Gemma-backed extraction pipeline, and then review the structured output in a browser UI with AI chat assistance.

## Common Commands

### Development
```bash
npm ci                     # Install dependencies
npm run server             # Start Express backend (port 8001)
npm run dev                # Start Vite dev server (second terminal)
npm run build              # Build frontend for production
```

### Testing
```bash
npm test                   # Run Vitest tests once
npm run test:watch         # Run Vitest in watch mode
```

### Docker
```bash
docker build -t doctor-dashboard:latest .
docker compose -f docker-compose.gpu.yml up -d --build
```

### Linting
```bash
npm run lint               # Run ESLint
```

## Architecture: Agent-Skill-Tool Pattern

The codebase uses a three-tier architecture that requires understanding multiple directories:

### 1. Agents (`agents/*.cjs`)
High-level orchestrators that coordinate complete workflows. Key agents:

- **DischargeExtractorAgent**: Multi-step PDF extraction with validation. Runs sequential skills (document_analyzer → demographics_extractor → risk_scores_extractor → vitals_extractor → functional_status_extractor → clinical_data_extractor → cross_validator)
- **DoctorAssistantAgent**: Chat assistant orchestrating 7 sub-agents (QueryIntentAgent, RecordContextAgent, ExternalKnowledgeAgent, AnswerComposerAgent, SafetyGuardAgent, ActionRouterAgent, SessionMemoryAgent)
- **ChartNoteAgent**: Generates SOAP notes with ReAct-style reasoning

### 2. Skills (`skills/*/*.skill.cjs`)
Reusable processing modules that perform specific tasks:
- `skills/extraction/`: Data extraction skills (demographics, vitals, risk scores, clinical data)
- `skills/clinical/`: DashboardMapperSkill (transforms agent data to dashboard card format)
- `skills/chat/`: Chat-related skills (chat export builder, action suggestions)
- `skills/validation/`: CrossValidatorSkill

### 3. Tools (`tools/*/*.tool.cjs`)
Low-level utilities and integrations:
- `tools/llm/`: GemmaClientTool, GeminiClientTool, PromptBuilderTool, CitationTrackerTool
- `tools/pdf/`: PDFReaderTool
- `tools/clinical/`: ProvenanceBuilderTool, VitalsInterpreterTool
- `tools/chat/`: VitalNormalityTool, MedicationComparisonTool

## LLM Integration

The application uses a Gemma-compatible OpenAI-style chat-completions endpoint:
- Environment: `GEMMA_URL` (default: port 8000)
- Model: `GEMMA_MODEL` (default: `google/gemma-4-26B-A4B-it`)
- Optional: `USE_GEMINI_FOR_EXTERNAL` enables external web search via Gemini

Prompts are defined in `tools/llm/prompt_builder.tool.cjs` using a template system with `{{variable}}` placeholders.

## Storage & State

All data is stored in `server/storage/` as JSON collections:
- `documents.json`: Extracted document data
- `chat_sessions.json`: Chat history, pending consents, clarifications
- `chat_actions.json`: Actions pending user confirmation
- `chat_exports.json`: Chat export history
- `search_cache.json`: Cached external knowledge queries

Document mutations use a queue system (`queueDocumentMutation` in `server/index.cjs`) to prevent race conditions.

## API Endpoints (Express)

Key routes in `server/index.cjs`:
- `GET /api/health` - Health check
- `GET /api/agent/status` - Agent system status
- `GET /api/documents` - List all documents
- `POST /api/documents/upload` - Upload PDF
- `POST /api/documents/process` - Process document (runs DischargeExtractorAgent)
- `GET /api/documents/process/progress` - Processing progress
- `GET /api/chat/history/:documentId` - Chat history for a document
- `POST /api/chat/query` - Send chat message (runs DoctorAssistantAgent)
- `POST /api/chat/action/confirm` - Confirm a pending action
- `POST /api/chat/export/:documentId` - Export chat session
- `GET /api/documents/:id/chart-note` - Get chart note
- `POST /api/documents/:id/chart-note/pdf` - Export chart note as PDF

## Frontend Structure

- `src/pages/`: Index (main dashboard), UploadCenter (upload page)
- `src/components/dashboard/`: Detail components for each clinical section (VitalsDetail, LabsDetail, MedicationsDetail, etc.)
- `src/lib/processedDocuments.ts`: TypeScript type definitions for processed documents
- UI uses shadcn/ui components built on Radix UI primitives

## Chat System Flow

The DoctorAssistantAgent implements a multi-step flow:
1. **QueryIntentAgent**: Classifies user query (clinical fact, comparison, clarification needed, external search)
2. **RecordContextAgent**: Searches extracted document data for relevant information
3. **ExternalKnowledgeAgent**: Optionally searches external web (via Gemini) if consent given
4. **AnswerComposerAgent**: Synthesizes answer with citations
5. **SafetyGuardAgent**: Validates response and redacts sensitive information
6. **ActionRouterAgent**: Detects actions (medication changes, note updates) and prompts for confirmation

Session state includes: `pendingExternalConsent`, `pendingClarification`, `pendingGeminiKeyPrompt`, `confirmedActions`.

## Document Processing Pipeline

1. Upload PDF → stored in `server/storage/uploads/`
2. `POST /api/documents/process` → DischargeExtractorAgent.process()
3. PDFReaderTool extracts text
4. Sequential skill execution with progress callbacks
5. DashboardMapperSkill transforms results to dashboard card format
6. Results stored in `documents.json` with provenance metadata

## Testing

Tests use Vitest with jsdom environment. Test files:
- Location: `src/test/*.test.ts` or `src/test/*.test.tsx`
- Setup: `src/test/setup.ts`
- Config: `vitest.config.ts`

## Deployment Notes

- Single-container deployment: Express serves both API and built frontend from `dist/`
- Default port: 8001
- Health check: `curl http://127.0.0.1:8001/api/health`
- For GPU host deployment, use `docker-compose.gpu.yml` (handles `host.docker.internal` networking for Gemma access)
