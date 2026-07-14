# Doctor Dashboard - AI Agent Instructions

This document provides guidelines and conventions for AI coding agents working in the Doctor Dashboard repository to remain productive and maintain codebase consistency.

## Project Overview

Doctor Dashboard is a hybrid web application (React + Express) for processing clinical source material (PDFs and live/recorded voice dictations) into a unified dashboard view. It leverages local and remote LLMs (Gemma, Gemini) via a specialized agentic pipeline.

- **Frontend**: React, Vite, Radix UI (Shadcn), Tailwind CSS
- **Backend**: Express (Node.js)
- **AI/Extraction Pipeline**: Custom agents (using LangChain / LangGraph concepts) found in `agents/`, `skills/`, and `tools/`
- **Testing**: Vitest (Unit/Integration), Playwright (E2E)

## Architecture Boundaries & Conventions

### 1. Backend (`server/`)
- **Module System**: The backend uses **CommonJS** (`.cjs` or `.js` with `require`). **DO NOT** use ES Modules (`import`/`export`) in `server/`, `agents/`, `skills/`, or `tools/`.
- **Runtime Port**: The server binds to port `8001` (by default). It serves both the API (`/api/*`) and the static frontend built assets (`dist/`) in production.
- **Storage**: Temporary and persistent local storage lives in `server/storage/` (e.g., JSON files, `analytics.sqlite`, uploaded audio/PDFs).

### 2. Frontend (`src/`)
- **Module System**: The frontend uses modern **TypeScript and ES Modules** (`.ts`, `.tsx`).
- **Styling**: Tailwind CSS and Shadcn UI (Radix) components are the standard.
- **Routing**: `react-router-dom` is used for SPA navigation.

### 3. Agent Pipeline (`agents/`, `skills/`, `tools/`)
- **Document Processing**: `agents/document_type_router.cjs` routes PDF uploads to specialized extractor agents.
- **Voice Flow**: Voice/Live interactions use `agents/stt_router_agent.cjs`, `agents/live_conversation_stt_agent.cjs`, and `agents/voice_extractor_agent.cjs`.
- **Timeouts**: Due to LLM generation times (especially for local Gemma), agent processing steps often require generous timeouts (180s - 240s).

## Commands for Agents

When implementing features, fixing bugs, or writing tests, run the following commands to verify:

- **Install dependencies**: `npm ci`
- **Start development (frontend only)**: `npm run dev`
- **Run backend local server**: `npm run server`
- **Build frontend**: `npm run build`
- **Run linter**: `npm run lint`
- **Run unit/integration tests**: `npm run test`
- **Run E2E tests**: `npx playwright test`

## Troubleshooting / Common Gotchas
- **Prescription Generation**: When dealing with prescription HTML/CSS/JS templates, look inside `prescription_template_dev/`.
- **Voice Pipeline States**: For voice documents, a `processed` state strictly means the stored result contains a renderable dashboard payload. If a pipeline run completes without usable content, it is marked `failed`.
- **Environment**: Key environment variables like `GEMMA_URL`, `GEMMA_MODEL`, `GEMINI_API_KEY`, and `PORT` dictate which processing path is active.
