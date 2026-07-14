# ABDM ABHA + EHR API Integration Checklist

## Date
2026-06-13

## Status
Implementation checklist

## Scope
Execution tracker for the real ABDM / ABHA / EHR API integration described in `docs/architecture/abdm-ehr-api-integration-plan.md`.

## 0. Sandbox Access

- [ ] Register Doctor Dashboard in ABDM Sandbox.
- [ ] Receive sandbox client ID and client secret from NHA.
- [ ] Confirm enabled scopes/roles for ABHA, HIP, HIU, HPR, and HFR.
- [ ] Configure a public HTTPS callback URL.
- [ ] Verify `POST /v0.5/sessions` through the official ABDM Postman collection.
- [ ] Store credentials in env/secret manager, not in repo files.

## 1. Backend Foundation

- [x] Add `server/abdm/abdm_config.cjs`.
- [x] Add `server/abdm/abdm_http_client.cjs`.
- [x] Add `server/abdm/abdm_session_service.cjs`.
- [ ] Add `server/abdm/abdm_repository.cjs`.
- [x] Add `/api/abdm/status`.
- [x] Add `/api/abdm/session/verify`.
- [x] Add `/api/abdm/callbacks/health`.
- [x] Add redacted terminal logging for Phase 0 ABDM calls.
- [x] Add tests proving tokens, client secrets, Aadhaar, and OTP values are redacted.
- [x] Add Phase 0 readiness status with explicit blockers.
- [x] Keep ABDM readiness routes backend-owned and admin-only, except callback health.

## 2. ABHA Identity

- [ ] Add ABHA search/verification backend routes.
- [ ] Add OTP request route.
- [ ] Add OTP verification route.
- [ ] Persist ABHA identifier as a patient identifier.
- [ ] Do not persist Aadhaar number or OTP.
- [ ] Add frontend ABHA identity widget.
- [ ] Add UI states for requested, OTP pending, verified, failed, and expired.

## 3. FHIR Mapping

- [ ] Add ABDM FHIR mapper for finalized live conversations.
- [ ] Map live OPD notes to `OPConsultRecord`.
- [ ] Map prescriptions to `PrescriptionRecord`.
- [ ] Map lab reports to `DiagnosticReportRecord` and `Observation`.
- [ ] Map generic documents to `HealthDocumentRecord` and `DocumentReference`.
- [ ] Add local validation against NRCeS ABDM FHIR profile expectations.
- [ ] Add `/api/abdm/documents/:documentId/fhir/preview`.

## 4. HIP / HRP Publishing

- [ ] Add care context persistence.
- [ ] Add care context link route.
- [ ] Add callback receiver routes.
- [ ] Correlate callbacks by request ID / transaction reference.
- [ ] Make callback processing idempotent.
- [ ] Add frontend publication status on document dashboards.
- [ ] Add retry/reconciliation for missing callbacks.

## 5. HIU Consent And Record Pull

- [ ] Add consent request route.
- [ ] Persist consent request lifecycle.
- [ ] Handle consent granted, denied, expired, and revoked callbacks.
- [ ] Add health information request route.
- [ ] Add encrypted data receipt callback.
- [ ] Integrate Fidelius-compatible decryption.
- [ ] Validate received FHIR bundles.
- [ ] Import received records as external ABDM documents with provenance.
- [ ] Add frontend external-records inbox.

## 6. HPR / HFR

- [ ] Add HFR facility search/validation.
- [ ] Add HPR practitioner search/validation.
- [ ] Bind facility IDs to HIP/HIU configuration.
- [ ] Bind practitioner HPR IDs to local practitioner records where available.
- [ ] Block production ABDM publication if required HFR/HPR identifiers are missing.

## 7. Security And Compliance

- [ ] Enforce app auth/RBAC before enabling ABDM routes.
- [ ] Ensure all ABDM routes are TLS-only in deployment.
- [ ] Store secrets in deployment secret manager.
- [ ] Ensure logs and audit events are PHI-minimized.
- [ ] Add retention policy for consent artefacts and imported records.
- [ ] Add incident-response runbook for ABDM callback or data-transfer failures.

## 8. Certification And Production

- [ ] Run ABDM Milestone 1 test cases.
- [ ] Run ABDM Milestone 2 HIP/HRP test cases.
- [ ] Run ABDM Milestone 3 HIU test cases if HIU is in scope.
- [ ] Run HPR/HFR milestone checks if registry integration is in scope.
- [ ] Submit required evidence to ABDM/NHA.
- [ ] Receive production credentials and production role approvals.
- [ ] Rotate environment variables to production values.
- [ ] Run production smoke test with approved non-sensitive flow.
