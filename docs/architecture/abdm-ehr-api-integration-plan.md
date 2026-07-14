# ABDM ABHA + EHR API Integration Plan

## Date
2026-06-13

## Status
Planning document

## Evaluation Sign-Off
Signed off for architecture planning on 2026-06-15.

Decision: approved to proceed into implementation discovery and sandbox proof-of-connectivity.

Conditions before production implementation:

- confirm ABDM sandbox client credentials and enabled roles with NHA
- expose a public HTTPS callback URL for ABDM asynchronous callbacks
- enforce app authentication and RBAC before enabling ABDM routes
- pin the exact ABDM OpenAPI/Postman assets used for implementation from the sandbox portal
- use secret-manager backed credentials and key material, not repo files
- use encrypted persistence for consent artefacts, health information payloads, and imported FHIR records

## Purpose
Define how Doctor Dashboard can integrate with Indian Government ABDM APIs for ABHA identity, EHR exchange, HIP/HIU workflows, HPR/HFR registries, and FHIR-compliant clinical records across frontend and backend.

This is a real API integration plan. It assumes the application will register with the ABDM Sandbox, use NHA-issued client credentials, implement asynchronous callbacks, exchange FHIR R4 payloads, and move to production only after the required ABDM milestone testing and approval.

## Official API Sources Reviewed

The source check was done on 2026-06-13 against current government/public ABDM surfaces:

| Area | Official source |
|------|-----------------|
| ABDM mission and public entry point | https://abdm.gov.in/ |
| ABDM Sandbox portal and documentation | https://sandbox.abdm.gov.in/sandbox/v3/new-documentation |
| ABDM Sandbox signup/login | https://sandbox.abdm.gov.in/sandbox/v3/sandbox-registration |
| ABDM Sandbox guidelines | https://abdm.gov.in/strapicms/uploads/sandbox_guidelines_b39bcce23e.pdf |
| ABDM technical support | https://sandboxsupport.abdm.gov.in/ |
| ABHA public portal | https://abha.abdm.gov.in/ |
| ABHA sandbox portal | https://abhasbx.abdm.gov.in/ |
| ABDM FHIR Implementation Guide | https://nrces.in/ndhm/fhir/r4/index.html |
| ABDM FHIR profiles | https://www.nrces.in/ndhm/fhir/r4/profiles.html |
| HPR/HFR sandbox Swagger | https://apihspsbx.abdm.gov.in/v4/int/swagger-ui-ext/index.html |
| Health Facility Registry | https://facility.abdm.gov.in/ |
| ABDM Health Data Management Policy | https://abdm.gov.in/strapicms/uploads/health_management_policy_bac9429a79.pdf |

The ABDM Sandbox documentation currently exposes Swagger groups for HIE-CM v3 APIs, ABHA v3 APIs, PHR v3 APIs, and NHPR/HPR/HFR APIs. The public docs also show current HIE-CM sandbox and production base domains as `https://dev.abdm.gov.in` and `https://apis.abdm.gov.in`, and ABHA sandbox base as `https://abhasbx.abdm.gov.in/abha/api`.

## Target Integration Posture

Doctor Dashboard should integrate with ABDM in this order:

1. **ABHA identity capture and verification**: attach a verified ABHA address/number to a patient or live encounter without storing Aadhaar numbers or OTPs.
2. **HIP / HRP publishing**: after a PDF, voice dictation, or live conversation is finalized, convert the resulting clinical record into ABDM FHIR format and link it as a care context for the patient's ABHA address.
3. **HIU retrieval**: let an authorized clinician request external records through ABDM consent, receive encrypted data packages, decrypt them server-side, and add them to the dashboard as provenance-marked external records.
4. **HPR/HFR identity support**: validate or synchronize facility and practitioner IDs so outbound FHIR resources include the correct facility and clinician identifiers.
5. **Production certification**: run ABDM milestone test cases in sandbox and only then move to NHA production credentials.

Do not build a full PHR application unless the product requirement changes. For this repository, the pragmatic first role is HRP/HIP for records created by the dashboard, with HIU as a second phase for consent-based record pull.

## Current Repository Fit

The current backend is a CommonJS Express app in `server/`. It owns uploads, voice sessions, document processing, prescriptions, SOAP notes, audit logs, and analytics. The frontend is React/TypeScript under `src/` and already uses `apiFetch` with cookies through `src/lib/apiClient.ts`.

Current runtime limitations that matter for ABDM:

- No live ABDM integration exists.
- No production-grade app auth/RBAC gate is enforced on most API routes.
- Runtime storage is still mostly file-backed under `server/storage/`, with an existing Postgres interoperability plan in `docs/architecture/postgres-persistence-interoperability-plan.md`.
- No generic FHIR mapper or ABDM callback receiver exists.
- No public HTTPS callback route is configured.

ABDM should therefore be implemented as a backend-owned integration layer. The frontend must never call ABDM directly and must never receive ABDM client secrets, refresh tokens, Fidelius/private keys, Aadhaar numbers, or raw OTP payloads.

## ABDM API Surface To Use

### Session and Credentials

Sandbox access starts with an ABDM-approved application and client credentials. The official docs describe using a gateway session token through `POST /v0.5/sessions` on the gateway, with the sandbox gateway under `https://dev.abdm.gov.in/gateway`.

Backend responsibilities:

- Store `ABDM_CLIENT_ID` and `ABDM_CLIENT_SECRET` in environment or secret manager only.
- Fetch gateway/session tokens server-side.
- Cache tokens with expiry and refresh defensively.
- Add standard ABDM headers: `Authorization`, `REQUEST-ID`, `TIMESTAMP`, and where applicable `X-CM-ID`, `X-HIP-ID`, and `X-HIU-ID`.

### ABHA v3 APIs

Use ABHA v3 APIs from the official sandbox docs for:

- ABHA address / ABHA number search and verification
- OTP request and verification
- ABHA profile retrieval where legally permitted
- ABHA card download only when required and consented

Relevant official surfaces:

- Sandbox base shown in docs: `https://abhasbx.abdm.gov.in/abha/api`
- Public ABHA portal: `https://abha.abdm.gov.in/`
- Sandbox Swagger entry: `https://sandbox.abdm.gov.in/sandbox/v3/new-documentation?doc=abha%20v3%20apis`

Non-negotiable constraints:

- Do not store Aadhaar number.
- Do not store OTP.
- Do not log Aadhaar, OTP, access tokens, or ABHA profile payloads.
- Store only the ABHA address/number, verification state, masked display metadata, consent timestamp, and source.

### HIE-CM / HIP / HIU APIs

Use HIE-CM v3 APIs for record linkage, discovery, consent, and data transfer. ABDM workflows are asynchronous: a successful request often only means the request was accepted; ABDM then calls the registered callback URL.

Relevant official surfaces:

- HIE-CM v3 docs: `https://sandbox.abdm.gov.in/sandbox/v3/new-documentation?doc=hiecm-v3`
- HIE-CM Swagger group: `https://sandbox.abdm.gov.in/sandbox/v3/new-documentation?doc=Swagger`
- Sandbox base domains shown in docs: `https://dev.abdm.gov.in`, including gateway and CM paths.
- Production base domain shown in docs: `https://apis.abdm.gov.in`.

Required backend behavior:

- Register one public HTTPS callback URL per ABDM client ID.
- Persist every outbound request with `requestId`, timestamp, ABDM operation, patient/document context, and state.
- Persist every inbound callback idempotently.
- Correlate callbacks to outbound requests by ABDM request IDs and transaction references.
- Maintain a retry and reconciliation queue for missing callbacks.

### FHIR EHR Payloads

ABDM EHR exchange uses FHIR R4 profiles from NRCeS. Doctor Dashboard should map its extracted clinical payloads to ABDM profiles instead of inventing custom JSON for exchange.

Initial mappings:

| Doctor Dashboard output | ABDM FHIR profile target |
|-------------------------|--------------------------|
| Final live consultation / OPD note | `OPConsultRecord` |
| Generated prescription | `PrescriptionRecord` plus `MedicationRequest` where applicable |
| Uploaded lab report / extracted labs | `DiagnosticReportRecord`, `DiagnosticReportLab`, `Observation` |
| Discharge summary | `DischargeSummaryRecord` |
| Generic uploaded PDF or historical record | `HealthDocumentRecord` and `DocumentReference` |
| Patient identity | `Patient` |
| Visit identity | `Encounter` |
| Facility identity | `Organization` with HFR identifier |
| Doctor identity | `Practitioner` / `PractitionerRole` with HPR identifier |

Validation targets:

- NRCeS ABDM FHIR IG current published version: `https://nrces.in/ndhm/fhir/r4/index.html`
- Profiles index: `https://www.nrces.in/ndhm/fhir/r4/profiles.html`

### HPR and HFR APIs

Use HPR/HFR APIs for verified practitioners and facilities, especially before production HIP/HIU use. The official sandbox docs currently point to:

- HPR/HFR Swagger: `https://apihspsbx.abdm.gov.in/v4/int/swagger-ui-ext/index.html`
- Health Facility Registry portal: `https://facility.abdm.gov.in/`

Target uses:

- Map app facility/department records to HFR IDs.
- Map doctor app users to HPR IDs where available.
- Prevent outbound ABDM publication when the facility is missing a valid HFR/HIP identifier.

## Backend Architecture

Add a new CommonJS integration namespace under `server/abdm/`.

| Module | Responsibility |
|--------|----------------|
| `abdm_config.cjs` | Read and validate env vars, environment mode, base URLs, HIP/HIU/HFR IDs, callback URL. |
| `abdm_http_client.cjs` | ABDM HTTP client with headers, retries, request IDs, token injection, redacted logging. |
| `abdm_session_service.cjs` | Gateway/session token lifecycle. |
| `abdm_identity_service.cjs` | ABHA search, OTP request/verify, profile normalization. |
| `abdm_hfr_hpr_service.cjs` | HFR/HPR lookup and sync. |
| `abdm_fhir_mapper.cjs` | Convert dashboard documents and extracted data to ABDM FHIR bundles. |
| `abdm_hip_service.cjs` | Link care contexts and publish dashboard-owned records as HIP/HRP. |
| `abdm_hiu_service.cjs` | Initiate consent requests, fetch consent artefacts, request health information. |
| `abdm_crypto_service.cjs` | Fidelius-compatible encryption/decryption and key material handling. |
| `abdm_callback_routes.cjs` | Public callback endpoints for ABDM async events. |
| `abdm_repository.cjs` | Persistence for requests, callbacks, identifiers, care contexts, consents, data transfers. |
| `abdm_audit.cjs` | Redacted audit event helper integrated with existing audit logs. |

Register routes from `server/index.cjs` after authentication and JSON middleware are configured. Keep all files CommonJS to match `server/` conventions.

### Backend API Routes For The Frontend

Expose app-owned routes under `/api/abdm/*`.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/abdm/status` | `GET` | Show configured environment, credential health, callback health, and role readiness without exposing secrets. |
| `/api/abdm/patients/:patientId/abha/search` | `POST` | Search or verify ABHA address/number through backend. |
| `/api/abdm/patients/:patientId/abha/request-otp` | `POST` | Request OTP for an ABDM-supported identity flow. |
| `/api/abdm/patients/:patientId/abha/verify-otp` | `POST` | Verify OTP and attach ABHA identity to patient. |
| `/api/abdm/documents/:documentId/fhir/preview` | `GET` | Return local ABDM FHIR mapping preview and validation status. |
| `/api/abdm/documents/:documentId/care-contexts/link` | `POST` | Link a finalized document as an ABDM care context. |
| `/api/abdm/patients/:patientId/care-contexts` | `GET` | List locally known ABDM care contexts for a patient. |
| `/api/abdm/consent-requests` | `POST` | Create HIU consent request for external records. |
| `/api/abdm/consent-requests/:id` | `GET` | Show consent request/callback state. |
| `/api/abdm/health-information-requests` | `POST` | Request health information after consent artefact is available. |
| `/api/abdm/health-information-requests/:id` | `GET` | Show health data transfer/decryption/import state. |
| `/api/abdm/hfr/facilities/search` | `GET` | Search or validate HFR facility identity. |
| `/api/abdm/hpr/practitioners/search` | `GET` | Search or validate HPR practitioner identity. |

### Public ABDM Callback Routes

Expose callback routes under `/api/abdm/callbacks/*` and register the base callback URL with ABDM.

The callback layer must:

- authenticate/validate callback source as required by current ABDM docs
- parse request IDs and transaction IDs
- write the raw callback payload to an append-only store with PHI-safe redaction policy
- update correlated outbound request state
- respond fast, then run heavy work in a background queue
- be idempotent because retries are expected

Example route groups:

- `/api/abdm/callbacks/gateway/*`
- `/api/abdm/callbacks/hip/*`
- `/api/abdm/callbacks/hiu/*`
- `/api/abdm/callbacks/consents/*`
- `/api/abdm/callbacks/health-information/*`

## Persistence Plan

For production, use Postgres tables aligned with the existing Postgres interoperability plan. For sandbox-only spikes, a temporary JSON store under `server/storage/` is acceptable, but it must not become the production store.

Add or extend these tables in the Postgres plan:

| Table | Purpose |
|-------|---------|
| `patient_identifiers` | Add `ABHA_ADDRESS`, `ABHA_NUMBER`, and verification metadata. |
| `practitioners` | Add HPR identifier metadata. |
| `organizations` | Add HFR/HIP/HIU identifier metadata. |
| `interop_endpoints` | Store ABDM sandbox/production endpoint config without secrets. |
| `interop_messages` | Store outbound ABDM request state and inbound callback state. |
| `interop_message_events` | Store state changes, retries, callback processing events. |
| `interop_resource_links` | Link internal documents/patients/encounters to ABDM care contexts and FHIR resource IDs. |
| `abdm_consent_requests` | Track HIU consent lifecycle, status, purpose, HI types, expiry. |
| `abdm_consent_artefacts` | Store signed consent artefact metadata and encrypted artefact payload references. |
| `abdm_health_information_requests` | Track health information request, transfer, decryption, import, and errors. |
| `abdm_care_contexts` | Store care context reference/display, linked ABHA, owning document/encounter, HIP ID. |
| `abdm_token_cache` | Optional encrypted token cache if not handled by external cache/KMS. |

Do not store:

- Aadhaar number
- raw OTP
- ABDM client secret in database
- unredacted token values in logs or audit events
- private encryption keys in application files

## Frontend Architecture

Add frontend features only against `/api/abdm/*`; never call ABDM domains from React.

### New UI Surfaces

| Surface | Location | Behavior |
|---------|----------|----------|
| ABDM readiness panel | Admin/settings area | Shows sandbox/production mode, callback health, HFR/HPR readiness, missing config. |
| ABHA identity widget | Patient/encounter header and upload/live workflow | Search/verify ABHA, request OTP, attach verified ABHA to patient. |
| FHIR/ABDM publish panel | Document dashboard and finalized live conversation | Preview FHIR mapping, show validation status, link care context, show callback state. |
| Consent request panel | Patient record / doctor dashboard | Create HIU consent request for external records, show requested/granted/denied/expired/revoked state. |
| External records inbox | Dashboard | Show received ABDM health information packages, import status, provenance, and source facility. |
| HFR/HPR identity controls | Admin/settings | Bind facility and practitioner IDs to local configuration. |

### Frontend State Rules

- OTP screens must mask inputs and clear local state after submit.
- ABHA profile details shown to the user must be minimal and purpose-bound.
- ABDM operations must show asynchronous states: `requested`, `accepted`, `callback_pending`, `completed`, `failed`, `expired`.
- Every imported external record must be visibly labeled as external ABDM data.
- The clinician must be able to inspect provenance before merging external record details into generated notes or prescriptions.

## Core Workflows

### Workflow 1: Attach ABHA To Patient

1. User opens patient/encounter identity panel.
2. Frontend calls backend to search or start verification.
3. Backend calls ABHA v3 API.
4. User submits OTP or other approved verification input.
5. Backend verifies with ABDM.
6. Backend stores only ABHA identifier, verification status, masked metadata, and consent/audit record.
7. Frontend updates patient identity state.

### Workflow 2: Publish Dashboard Record As HIP/HRP

1. A document or live conversation is finalized.
2. Backend creates an ABDM FHIR bundle using NRCeS profiles.
3. Backend validates the FHIR bundle locally.
4. User previews and confirms ABDM publication.
5. Backend creates a care context for the ABHA address through HIE-CM/HIP flow.
6. ABDM callback confirms link state.
7. Backend records `abdm_care_contexts` and `interop_resource_links`.
8. Frontend shows ABDM link status on the document.

### Workflow 3: Pull External Records As HIU

1. Clinician selects ABHA patient and requested record types.
2. Backend creates a consent request with purpose, HI types, date range, and expiry.
3. Patient grants or denies in a PHR app.
4. ABDM sends consent callback.
5. Backend requests health information with the consent artefact.
6. HIP/HRP pushes encrypted FHIR data.
7. Backend decrypts and validates the FHIR bundle.
8. Backend imports as external record documents with provenance.
9. Frontend displays external records and lets the clinician reference them.

### Workflow 4: HFR/HPR Readiness

1. Admin searches/validates facility in HFR.
2. Admin binds the facility to app config as `ABDM_HIP_ID` and/or `ABDM_HIU_ID`.
3. Doctors optionally bind HPR IDs to local practitioner records.
4. Backend blocks production ABDM publication if required facility/practitioner identifiers are missing.

## Environment Variables

Required baseline:

```bash
ABDM_ENV=sandbox
ABDM_CLIENT_ID=
ABDM_CLIENT_SECRET=
ABDM_CALLBACK_BASE_URL=https://example.com/api/abdm/callbacks
ABDM_GATEWAY_BASE_URL=https://dev.abdm.gov.in/gateway
ABDM_CM_BASE_URL=https://dev.abdm.gov.in/cm
ABDM_ABHA_BASE_URL=https://abhasbx.abdm.gov.in/abha/api
ABDM_HPR_HFR_BASE_URL=https://apihspsbx.abdm.gov.in
ABDM_CM_ID=sbx
ABDM_HIP_ID=
ABDM_HIU_ID=
ABDM_HFR_ID=
ABDM_DEFAULT_PURPOSE_OF_USE=CAREMGT
ABDM_FIDELIUS_MODE=cli
ABDM_FIDELIUS_PATH=
ABDM_TOKEN_CACHE_TTL_SECONDS=900
```

Production values must come from the NHA production approval process. Do not hard-code production domains or credentials.

## Security And Compliance Requirements

Minimum requirements before real patient data:

- TLS for all frontend, backend, and callback traffic.
- Public callback URL reachable by ABDM and protected according to current ABDM callback requirements.
- Secrets stored in deployment secret manager.
- Redacted request/response logging.
- Audit logging for every identity, consent, publication, and retrieval action.
- RBAC around ABDM actions.
- No Aadhaar storage.
- No OTP storage.
- FHIR payloads encrypted at rest if persisted.
- Key material for health information transfer managed outside repo files.
- Retention policy for imported external records and expired/revoked consent artefacts.
- Explicit user consent UX aligned with ABDM Health Data Management Policy.

## Implementation Phases

### Phase 0: Sandbox Enrollment

- Register the application in ABDM Sandbox.
- Receive client ID/secret.
- Confirm assigned roles for ABHA, HIP, HIU, HPR/HFR as needed.
- Configure a public HTTPS callback URL.
- Verify gateway session token generation with official Postman collection.

### Phase 1: Backend ABDM Foundation

- Add `server/abdm/` modules.
- Add env validation and `/api/abdm/status`.
- Implement session token generation.
- Implement redacted HTTP client and audit wrapper.
- Add tests with mocked ABDM responses.

### Phase 2: ABHA Identity

- Implement ABHA search/request OTP/verify OTP flows.
- Add patient identifier persistence.
- Add frontend identity widget.
- Add no-Aadhaar/no-OTP logging tests.

### Phase 3: FHIR Mapping And HIP Linkage

- Implement dashboard-to-FHIR mapper.
- Validate against NRCeS profile expectations.
- Implement care context creation/linking.
- Add callback handling and status UI.

### Phase 4: HIU Consent And Retrieval

- Implement consent request lifecycle.
- Implement consent callback storage.
- Implement health information request and encrypted data receipt.
- Decrypt, validate, and import external records.

### Phase 5: HFR/HPR Integration

- Add HFR/HPR lookup and binding UI.
- Block ABDM publication if identifiers are incomplete.
- Add facility/practitioner identifier mapping into FHIR bundles.

### Phase 6: Certification And Production Cutover

- Run official milestone test cases.
- Export audit evidence and API traces.
- Complete NHA review/certification.
- Rotate from sandbox credentials to production credentials.
- Re-run smoke tests against production allowlisted environment.

## Detailed Execution Plan

| Phase | Timeline | Key Milestones | Deliverables | Success Criteria |
|-------|----------|----------------|--------------|------------------|
| **Phase 0: Sandbox Enrollment** | Week 1 | - Application registration in ABDM Sandbox<br>- Receive client credentials<br>- Configure public HTTPS callback URL<br>- Validate gateway session token generation | - ABDM Sandbox approval confirmation<br>- Client ID/Secret secured<br>- Callback URL registered and reachable<br>- Postman collection validated | Ability to generate valid gateway session tokens using sandbox credentials |
| **Phase 1: Backend Foundation** | Weeks 2-3 | - Create `server/abdm/` module structure<br>- Implement `abdm_config.cjs` with env validation<br>- Build `abdm_http_client.cjs` with retry/redaction<br>- Implement `abdm_session_service.cjs`<br>- Add `/api/abdm/status` endpoint<br>- Write unit tests with mocked responses | - CommonJS backend modules<br>- Environment validation<br>- Secure HTTP client<br>- Token management service<br>- Health check endpoint<br>- 80%+ unit test coverage | All backend services initialize correctly and status endpoint returns configured state without secrets |
| **Phase 2: ABHA Identity** | Weeks 4-5 | - Implement ABHA search/verify flows<br>- Add OTP request/verify functionality<br>- Create patient identifier persistence layer<br>- Build frontend ABHA identity widget<br>- Implement audit logging with redaction | - ABHA verification API endpoints<br>- Patient identifier storage schema<br>- React ABHA widget<br>- Audit trail for identity operations<br>- Test suite covering ABHA flows | Users can search/verify ABHA addresses without exposing Aadhaar or OTP in logs/UI |
| **Phase 3: FHIR Mapping & HIP Linkage** | Weeks 6-7 | - Develop `abdm_fhir_mapper.cjs` for core clinical artifacts<br>- Validate mappings against NRCeS ABDM FHIR v6.5.0 profiles<br>- Implement care context creation/linking via HIP<br>- Add callback handling with idempotency<br>- Build FHIR preview and publish UI components | - FHIR mapper for OPConsultRecord, PrescriptionRecord, etc.<br>- Validation against NRCeS profiles<br>- Care context linking service<br>- Idempotent callback processor<br>- Document publish UI with FHIR preview | Generated FHIR bundles validate successfully against NRCeS ABDM FHIR Implementation Guide v6.5.0 |
| **Phase 4: HIU Consent & Retrieval** | Weeks 8-9 | - Implement consent request lifecycle service<br>- Add consent callback storage and correlation<br>- Build health information request flow<br>- Implement Fidelius decryption service<br>- Create external records import pipeline<br>- Build consent request and external records UI | - Consent request/management APIs<br>- Consent artefact storage<br>- Health information request service<br>- Decryption and validation pipeline<br>- External records import with provenance<br>- Consent and external records UI panels | Encrypted health information packages can be decrypted, validated, and imported as provenance-marked external records |
| **Phase 5: HFR/HPR Integration** | Weeks 10-11 | - Implement HFR/HPR lookup services<br>- Add facility/practitioner binding UI<br>- Implement publication blocking logic<br>- Extend FHIR mapper to include IDs<br>- Add validation checks for identifier completeness | - HFR facility search/service<br>- HPR practitioner lookup/service<br>- Admin binding interface<br>- Publication gatekeeper service<br>- Enhanced FHIR bundles with identifiers | ABDM publication blocked when required facility/practitioner identifiers are missing or invalid |
| **Phase 6: Certification & Production** | Weeks 12-13+ external dependency | - Execute official ABDM milestone test cases<br>- Generate audit evidence and API traces<br>- Complete NHA review/certification process<br>- Rotate to production credentials<br>- Conduct production smoke tests | - Milestone test execution reports<br>- Audit logs and API traces<br>- NHA certification documentation<br>- Production credential configuration<br>- Production validation results | Successful completion of ABDM milestone tests and NHA certification, subject to NHA review timelines, for sandbox-to-production cutover |

## Testing Strategy

| Layer | Tests |
|-------|-------|
| Unit | Header builder, token cache, redaction, FHIR mapper, callback correlation. |
| Integration | Sandbox token generation, ABHA OTP flow in sandbox, care context link flow, consent callback flow. |
| Contract | OpenAPI/Postman collection checks from ABDM Sandbox docs. |
| FHIR | Validate generated bundles against NRCeS ABDM FHIR profiles. |
| Security | Ensure Aadhaar/OTP/token/client secret never appear in logs, audit events, frontend payloads, or test snapshots. |
| E2E | Frontend ABHA attach, publish to ABDM, callback state updates, consent request lifecycle. |

## Open Decisions

- Whether the first certified role should be only HIP/HRP or HIP plus HIU.
- Whether Doctor Dashboard will own long-term health record storage or delegate to an existing hospital EMR/HRP.
- Whether ABHA creation will be supported, or only ABHA verification/linking for existing ABHA users.
- Which deployment environment will expose the HTTPS callback URL.
- Whether production persistence will wait for Postgres cutover or start with an interim encrypted ABDM store.
- Which Fidelius integration approach will be approved for this deployment.

## Recommended First Build

Build a narrow sandbox proof first:

1. `/api/abdm/status`
2. gateway session token generation
3. ABHA address verification flow
4. FHIR preview for one finalized live conversation as `OPConsultRecord`
5. callback receiver with idempotent persistence
6. care context link status UI

This proves real ABDM connectivity without prematurely building the full HIU consent/data-transfer stack.
