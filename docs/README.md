# Manipal CoE - Doctor Dashboard Documentation

**Project:** Doctor Dashboard - Clinical Intelligence System
**Version:** 2.0.0
**Last Updated:** 2026-04-07
**Status:** Production

---

## Quick Navigation

- [Getting Started](#getting-started)
- [Project Overview](#project-overview)
- [Documentation Index](#documentation-index)
- [Architecture](#architecture)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.8+ (for backend services)
- Access to Gemma LLM API

### Quick Start

```bash
# Navigate to the doctor dashboard
cd doctor_dashboard

# Install dependencies
npm install

# Start development server
npm run dev
```

For detailed setup instructions, see [Getting Started Guide](./guides/getting-started.md).

---

## Project Overview

### What is Doctor Dashboard?

The Doctor Dashboard is an **AI-powered clinical intelligence system** that transforms unstructured discharge summary PDFs into interactive, clinically-actionable dashboards. It uses a multi-agent ReAct (Reasoning + Acting) pattern with specialized skills to enable accurate extraction, validation, and presentation of clinical data.

### Key Capabilities

| Capability | Description |
|------------|-------------|
| **PDF Understanding** | Extract structured data from unstructured clinical PDFs |
| **Data Validation** | Cross-validate extracted data against source with citations |
| **Chart Note Generation** | Generate clinical SOAP notes with ReAct reasoning |
| **Doctor Chat Assistant** | Interactive Q&A with internal + external knowledge |
| **Dashboard Presentation** | Transform extracted data into UI components |
| **Safety Guardrails** | Prevent hallucinations and unsafe medical advice |
| **LLM-Only Pending Items Extraction** | Pure LLM-based extraction of pending labs, radiology, follow-ups, and discharge items |

### Technology Stack

- **Frontend:** React + TypeScript + Tailwind CSS
- **Backend:** Express.js + Node.js
- **AI/LLM:** Google Gemma 4-26B-A4B-it
- **PDF Processing:** Custom PDF extraction tools
- **Architecture:** Multi-agent ReAct pattern

---

## Documentation Index

### 1. Architecture & Design

| Document | Description | Link |
|----------|-------------|------|
| AI Architecture | Complete AI/LLM system architecture | [View](./architecture/ai-architecture.md) |
| Agent System | Multi-agent orchestration details | [View](./architecture/agent-system.md) |
| Skills Framework | Reusable AI skills documentation | [View](./architecture/skills-framework.md) |
| Chatbot Architecture | Doctor Assistant chat system | [View](./architecture/chatbot-architecture.md) |
| Chart Note React Agent | Chart note generation architecture | [View](./architecture/CHART_NOTE_REACT_AGENT.md) |
| Agent Architecture Flow | Interactive flow diagram | [View](./architecture/agent_architecture_flow.html) |
| Full Architecture v4 | Complete system architecture diagram | [View](./architecture/manipal_coe_full_architecture_v4.html) |

### 2. Project Planning & Research

| Document | Description | Link |
|----------|-------------|------|
| Concept Proposal | Original interactive dashboard proposal | [View](./research/concept-proposal.md) |
| Data Analysis | EDA on discharge summary reports | [View](./research/data-analysis.md) |
| Feature Requirements | AI architecture feature requirements | [View](./research/feature-requirements.md) |
| Sample Chart Note | Example SOAP note output | [View](./research/SAMPLE_CHART_NOTE.md) |

### 3. Development Guides

| Document | Description | Link |
|----------|-------------|------|
| Getting Started | Setup and installation guide | [View](./guides/getting-started.md) |
| Development Workflow | Development best practices | [View](./guides/development-workflow.md) |
| API Reference | Complete API endpoint documentation | [View](./guides/api-reference.md) |
| Component Library | React component documentation | [View](./guides/components.md) |

### 4. Testing & Evaluation

| Document | Description | Link |
|----------|-------------|------|
| Gemma LLM Evaluation | Complete LLM capability assessment | [View](./testing/llm-evaluation.md) |
| PDF Test Results | Real PDF processing test results | [View](./testing/pdf-test-results.md) |
| Performance Benchmarks | System performance metrics | [View](./testing/performance.md) |

### 5. Deployment & Operations

| Document | Description | Link |
|----------|-------------|------|
| Deployment Guide | Production deployment instructions | [View](./operations/deployment.md) |
| Security & Compliance | HIPAA and security documentation | [View](./operations/security.md) |
| Monitoring & Logging | System monitoring setup | [View](./operations/monitoring.md) |

---

## Project Structure

```
manipal-coe/
├── doctor_dashboard/          # Main application
│   ├── src/                   # Frontend React code
│   ├── server/                # Backend Express server
│   ├── agents/                # AI Agents
│   ├── skills/                # Reusable Skills
│   ├── tools/                 # Utility tools
│   ├── storage/               # Data storage
│   └── tests/                 # Test files
├── docs/                      # Documentation (this folder)
│   ├── architecture/          # Architecture documents
│   ├── research/              # Research and planning
│   ├── guides/                # Development guides
│   ├── testing/               # Test results
│   └── operations/            # Operations docs
├── data/                      # Sample data files
├── prototype/                 # Early prototype
└── gemma_test/                # LLM evaluation tests
```

---

## Key Concepts

### Multi-Agent Architecture

The system uses a **multi-agent architecture** with specialized agents:

1. **DischargeExtractorAgent** - Extracts structured data from PDFs
2. **DoctorAssistantAgent** - Interactive chat with clinical Q&A
3. **ChartNoteAgent** - Generates SOAP notes with reasoning
4. **SafetyGuardAgent** - Ensures safe, validated outputs

### Skills Framework

Skills are **reusable AI capabilities** that can be composed into agents:

- **Extraction Skills** - Document parsing, data extraction, LLM-only pending items extraction
- **Validation Skills** - Cross-validation, citation tracking
- **Generation Skills** - Chart note composition
- **Presentation Skills** - Dashboard data transformation
- **Chat Skills** - Query handling, response formatting

### LLM-Only Architecture

The system features a pure LLM-based extraction approach for pending items:

- **No Regex Patterns** - Semantic understanding via Gemma LLM
- **7-Step Process** - Structured thinking for clinical items
- **Provenance Tracking** - Source sections and excerpts included
- **Priority Classification** - Clinical judgment (high/medium/low)
- **Graceful Fallback** - Returns empty result on parse failure

### Tools Layer

Tools are **lower-level utilities** used by skills and agents:

- PDF reading, LLM client, prompt building
- Clinical interpretation, provenance tracking
- Data presentation, citation assembly

---

## Development Status

### Completed ✅

- Multi-agent architecture
- PDF extraction with validation
- Interactive chat assistant
- Chart note generation
- Dashboard UI components
- ReAct reasoning framework
- LLM-only pending items extraction (PendingItemsExtractorSkill)

### In Progress 🚧

- Multi-document comparison
- Real-time EMR integration
- Mobile application

### Planned 📋

- Population analytics
- Voice input for chat
- Clinical decision support
- Predictive analytics

---

## Contributing

For contribution guidelines, see [Development Workflow](./guides/development-workflow.md).

---

## License

Proprietary - Manipal CoE

---

## Contact

For questions or support, contact the development team.

---

*Documentation maintained by the AI Architecture Team*
*Last updated: April 7, 2026*
