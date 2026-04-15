# Security & Compliance

## Doctor Dashboard - Clinical Intelligence System

**Version:** 2.0.0
**Last Updated:** 2026-04-15

---

## Overview

This document outlines the security measures and compliance requirements for the Doctor Dashboard system, which handles Protected Health Information (PHI) and must comply with healthcare regulations.

> Important
> This document describes the target deployment posture for handling PHI. The current application code in this repository does include audit logging and local data segregation under `server/storage`, but it does not by itself provide production-grade authentication, RBAC, TLS termination, or encrypted-at-rest storage. Those controls must be supplied by deployment infrastructure and additional application hardening.

## Current Repository Status

- Backend runtime is an Express server in `server/index.cjs`.
- Data is persisted to local JSON/files under `server/storage/`.
- `cors()` is enabled broadly and no authentication middleware is enforced on the documented API routes.
- Audit run/event logging is present, but user identity and role enforcement are not implemented in the current server.

---

## Compliance Standards

### HIPAA (Health Insurance Portability and Accountability Act)

| Requirement | Implementation | Status |
|-------------|----------------|--------|
| **Privacy Rule** | PHI access controls, minimum necessary standard | ⚠️ Deployment-dependent |
| **Security Rule** | Administrative, physical, and technical safeguards | ⚠️ Deployment-dependent |
| **Breach Notification** | Incident response procedures | 📋 In Progress |
| **Business Associate Agreements** | BAA templates and processes | 📋 In Progress |

### Other Standards

| Standard | Applicability | Status |
|----------|---------------|--------|
| **GDPR** | EU data subjects | 📋 Planned |
| **ISO 27001** | Information security | 📋 Planned |
| **SOC 2** | Third-party assurance | 📋 Planned |

---

## Data Protection

### Data at Rest

| Measure | Implementation |
|---------|----------------|
| **Encryption** | Deployment-dependent disk or volume encryption |
| **Access Controls** | Planned application-level RBAC plus infrastructure controls |
| **Audit Logging** | Audit events are stored by the application; user identity coverage is deployment-dependent |
| **Data Retention** | Policy to be defined by deployment/operations |

**Example infrastructure configuration:**
```bash
# Encrypt storage directory
sudo cryptsetup -y -v luksFormat /dev/sdX
sudo cryptsetup luksOpen /dev/sdX encrypted_storage
```

### Data in Transit

| Measure | Implementation |
|---------|----------------|
| **TLS** | Expected to be terminated by reverse proxy / ingress |
| **Certificate Management** | Deployment concern |
| **API Security** | Not implemented in the current root Express server |

**Example Nginx TLS configuration:**
```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
```

---

## Access Control

### Authentication

| Method | Status | Notes |
|--------|--------|-------|
| **API Keys** | ⚠️ Not implemented in current server | Can be added at proxy or app layer |
| **JWT Tokens** | 📋 Planned | Production |
| **OAuth 2.0** | 📋 Planned | SSO integration |
| **MFA** | 📋 Planned | Enhanced security |

### Authorization Targets

| Role | Permissions |
|------|-------------|
| **Admin** | Full system access |
| **Physician** | View/edit patient data |
| **Nurse** | View patient data |
| **Researcher** | De-identified data only |
| **Auditor** | Read-only audit logs |

### Example RBAC Model

```javascript
// Role-based access control
const roles = {
  admin: ['*'],
  physician: [
    'documents:read',
    'documents:write',
    'chat:query',
    'chart_notes:generate'
  ],
  nurse: [
    'documents:read',
    'chat:query'
  ]
};
```

---

## Audit Logging

### Logged Events

| Event Category | Examples |
|----------------|----------|
| **Authentication** | Login, logout, failed attempts when an auth layer exists |
| **Data Access** | View patient data, export data |
| **Data Modification** | Update notes, confirm actions |
| **System Events** | Processing, errors, configuration changes |

### Example Log Format

```json
{
  "timestamp": "2026-04-07T10:00:00Z",
  "event_type": "data_access",
  "user_id": "user-123",
  "role": "physician",
  "action": "view_document",
  "resource": "document-456",
  "ip_address": "192.168.1.100",
  "result": "success"
}
```

### Example Log Retention Policy

| Log Type | Retention Period |
|----------|------------------|
| Access Logs | 6 years |
| Audit Logs | 6 years |
| Error Logs | 2 years |
| Debug Logs | 30 days |

---

## Privacy Controls

### Minimum Necessary Standard

The system implements the minimum necessary standard:

1. **Data Minimization**: Only collect necessary data
2. **Access Limitation**: Restrict access to needed information
3. **Role-Based Views**: Different views for different roles

### De-identification

For research/analytics, PHI can be de-identified per HIPAA Safe Harbor:

| Identifier | Removal Method |
|------------|----------------|
| Names | Replace with pseudonyms |
| Dates | Shift dates, keep age |
| MRN | Replace with study IDs |
| Free-text | Redact or generalize |

---

## Incident Response

### Breach Categories

| Category | Definition | Response Time |
|----------|------------|---------------|
| **Critical** | Large-scale PHI exposure | Immediate (<1 hour) |
| **High** | Significant PHI exposure | <4 hours |
| **Medium** | Limited PHI exposure | <24 hours |
| **Low** | Policy violation, no exposure | <48 hours |

### Response Procedure

1. **Identification**: Detect and confirm incident
2. **Containment**: Limit further exposure
3. **Eradication**: Remove cause of incident
4. **Recovery**: Restore normal operations
5. **Lessons Learned**: Post-incident review

### Incident Response Team

| Role | Responsibility |
|------|----------------|
| **Incident Commander** | Overall coordination |
| **Security Lead** | Technical investigation |
| **Privacy Officer** | Compliance assessment |
| **Legal Counsel** | Legal guidance |
| **Communications** | External messaging |

---

## Clinical Safety

### Safety Measures

| Measure | Purpose | Status |
|---------|---------|--------|
| **Citation Tracking** | Source all claims | ✅ Implemented |
| **Confidence Scoring** | Indicate certainty | ✅ Implemented |
| **Refusal Policy** | Decline inappropriate requests | ✅ Implemented |
| **Hallucination Detection** | Cross-validate outputs where available | ⚠️ Partial / workflow-dependent |
| **Human-in-the-Loop** | Clinician review required | ⚠️ Process requirement, not an enforced UI gate everywhere |

### Confidence Thresholds

| Confidence Level | Threshold | Action |
|------------------|-----------|--------|
| **High** | ≥80% | Accept automatically |
| **Medium** | 60-79% | Flag for review |
| **Low** | <60% | Require confirmation |

---

## Vulnerability Management

### Regular Assessments

| Assessment | Frequency | Status |
|------------|-----------|--------|
| **Penetration Testing** | Annual | 📋 Scheduled |
| **Vulnerability Scanning** | Quarterly | ✅ Automated |
| **Code Review** | Continuous | ✅ Implemented |
| **Dependency Updates** | Monthly | ✅ Automated |

### Patch Management

1. **Monitoring**: Subscribe to security advisories
2. **Prioritization**: Classify by severity
3. **Testing**: Test in staging first
4. **Deployment**: Schedule during low-usage periods
5. **Verification**: Confirm patch effectiveness

---

## Data Residency

### Geographic Considerations

| Region | Requirement | Implementation |
|--------|-------------|----------------|
| **US** | No cross-border transfer | US-hosted servers |
| **EU** | GDPR compliance | EU-hosted servers (planned) |
| **India** | Data localization | India-hosted servers |

---

## Security Testing

### Test Types

| Test Type | Frequency | Tools |
|-----------|-----------|-------|
| **Unit Tests** | Every commit | Jest, Vitest |
| **Integration Tests** | Every commit | Supertest |
| **Security Tests** | Every commit | Snyk, npm audit |
| **Penetration Tests** | Annual | Third-party |
| **Compliance Audits** | Annual | Third-party |

---

## Configuration Security

### Environment Variables

```env
# Security Configuration
NODE_ENV=production
API_KEY_REQUIRED=true
SESSION_SECRET=changeme
ENCRYPTION_KEY=changeme

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX_REQUESTS=100

# CORS
CORS_ORIGIN=https://your-domain.com
```

### Secrets Management

Use a secrets manager for production:

- HashiCorp Vault
- AWS Secrets Manager
- Azure Key Vault
- Google Secret Manager

---

**Document Version:** 1.0
**Last Updated:** 2026-04-15
**Next Review:** 2026-07-07
