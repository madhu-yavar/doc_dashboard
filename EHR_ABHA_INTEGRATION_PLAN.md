# EHR/ABHA API Integration Plan

## Overview
This plan outlines the integration of EHR/ABHA API with the Doctor Dashboard application, covering both backend (Express) and frontend (React/Vite) components.

## Backend Integration

### 1. Service Layer
- Create a new service file: `server/services/ehr_abha_service.cjs`
- This service will encapsulate all API calls to the EHR/ABHA system.
- Use environment variables for configuration:
  - `EHR_ABHA_BASE_URL`: Base URL of the EHR/ABHA API
  - `EHR_ABHA_API_KEY`: Authentication token or API key
  - `EHR_ABHA_TIMEOUT`: Request timeout (optional)
- Implement functions for:
  - Pushing patient/document data to EHR/ABHA
  - Pulling patient/document data from EHR/ABHA
  - Handling authentication (if required)
  - Error handling and retry logic
- Follow existing patterns from `prescription_service.cjs` and `soap_service.cjs`.

### 2. Route Handlers
- Create a new route file: `server/routes/ehr_abha_routes.cjs`
- Define RESTful endpoints for EHR/ABHA operations:
  - `POST /api/ehr/abha/push`: Push data to EHR/ABHA
  - `GET /api/ehr/abha/pull/:id`: Pull data from EHR/ABHA by ID
  - `GET /api/ehr/abha/status/:id`: Check sync status
- Use async handlers with proper error catching and HTTP status codes.
- Mount the routes in `server/index.cjs`:
  ```javascript
  const ehrAbhaRoutes = require('./routes/ehr_abha_routes');
  app.use('/api/ehr/abha', ehrAbhaRoutes);
  ```

### 3. Middleware and Security
- Add any required authentication middleware (if EHR/ABHA requires specific headers or tokens).
- Consider rate limiting or request validation if needed.
- Log requests and responses for audit purposes (using existing `audit_logger.cjs`).

### 4. Data Persistence (if needed)
- If sync metadata needs to be stored, create a new repository or extend existing ones.
- Follow the pattern of `documentsRepository.cjs` for Postgres interactions.
- Store sync timestamps, status, and error messages.

### 5. Environment Configuration
- Add to `.env.example`:
  ```
  EHR_ABHA_BASE_URL=
  EHR_ABHA_API_KEY=
  EHR_ABHA_TIMEOUT=5000
  ```
- Ensure `.env` is loaded via `dotenv` in `server/index.cjs`.

## Frontend Integration

### 1. Service/Hook Layer
- Create a new API service: `src/lib/ehrAbhaApi.ts` or `src/services/ehrAbhaService.ts`
- Use `fetch` or `axios` to communicate with backend endpoints.
- Define TypeScript interfaces for request/response payloads.
- Implement functions for:
  - pushToEhrAbha(data)
  - pullFromEhrAbha(id)
  - getEhrAbhaStatus(id)
- Handle loading, error, and success states.

### 2. Components
- Determine the UI location for EHR/ABHA integration:
  - Option A: New page under `src/pages/EhrAbha.tsx`
  - Option B: Component within existing pages (e.g., Dashboard, DocumentView)
- Create reusable components:
  - `EhrAbhaSyncButton`: Triggers push/pull operations
  - `EhrAbhaStatusBadge`: Shows sync status (synced, pending, error)
  - `EhrAbhaModal`: For configuring sync settings or viewing logs
- Use Shadcn UI components (from `src/components/ui/`) and Tailwind CSS.
- Follow existing patterns from `src/components/prescription/` or `src/components/soap/`.

### 3. State Management
- Use React Query (`@tanstack/react-query`) for data fetching and caching, following existing patterns.
- Alternatively, use React's `useState` and `useEffect` for simpler cases.
- Implement optimistic updates if appropriate.

### 4. Integration Points
- Trigger EHR/ABHA sync after successful document processing (via backend or frontend).
- Add sync controls to document review or dashboard views.
- Consider webhook or polling mechanisms for real-time updates (if required by EHR/ABHA).

### 5. Environment Variables (Frontend)
- If frontend needs direct API access (not via backend), use Vite environment variables:
  - `VITE_EHR_ABHA_API_BASE_URL` (proxy to backend to avoid CORS)
- Prefer proxying through backend to keep API keys secure.

## Security Considerations
- Do not expose API keys in frontend code or bundles.
- Use HTTPS for all API communications.
- Validate and sanitize data exchanged with EHR/ABHA.
- Follow existing authentication and authorization patterns in the application.

## Testing
- Backend:
  - Unit tests for `ehr_abha_service.cjs`
  - Integration tests for route handlers (using existing test setup)
- Frontend:
  - Unit tests for service hooks and components
  - E2E tests for user flows (using Playwright)

## Deployment
- Update Dockerfiles if new dependencies are added.
- Ensure environment variables are set in deployment environments (Azure, GCP, etc.).
- Monitor logs for EHR/ABHA integration errors.

## Timeline
1. Backend service and routes (2-3 days)
2. Frontend service and components (2-3 days)
3. Integration testing and bug fixing (2 days)
4. Documentation and knowledge transfer (1 day)

## Open Questions
- What specific EHR/ABHA endpoints need to be integrated?
- What data formats are expected (FHIR, HL7, custom JSON)?
- Are there any specific authentication mechanisms (OAuth, API keys, certificates)?
- Should the sync be bidirectional or unidirectional?
- What are the error handling and retry requirements?

## Conclusion
This plan follows the existing architectural patterns of the Doctor Dashboard application. By creating dedicated service layers, route handlers, and frontend components, we ensure maintainability and consistency with the codebase.