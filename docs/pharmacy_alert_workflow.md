# Pharmacy Alert Workflow

## Overview
The Pharmacy Alert System automatically notifies the pharmacy team when medications are prescribed in a prescription document. This helps patients quickly and easily purchase their prescribed medications.

## Architecture

```
Prescription Document → Extraction Pipeline → Medications Detected
                                                           │
                                                           ▼
                                                ┌──────────────────────┐
                                                │ Pharmacy Alert Agent │
                                                └──────────────────────┘
                                                           │
                                              ┌────────────┴────────────┐
                                              ▼                         ▼
                                       ┌─────────────┐          ┌─────────────┐
                                       │ Email Alert │          │ WhatsApp    │
                                       │ (SendGrid)  │          │ (Mock/API)  │
                                       └─────────────┘          └─────────────┘
```

## Components

| Component | File | Purpose |
|-----------|------|---------|
| **Pharmacy Alert Agent** | `agents/pharmacy/pharmacy_alert_agent.cjs` | Main orchestrator for sending alerts |
| **Email Notifier** | `agents/pharmacy/email_notifier.cjs` | Sends email via SendGrid |
| **WhatsApp Notifier** | `agents/pharmacy/whatsapp_notifier.cjs` | Sends WhatsApp (mock for now) |
| **Alert Formatter** | `tools/pharmacy/alert_formatter.tool.cjs` | Formats alert content |
| **Manual Trigger Skill** | `skills/pharmacy/send_pharmacy_alert.skill.cjs` | Manual API endpoint for resending |

## Configuration (.env)

```bash
# Enable/disable pharmacy alerts
PHARMACY_ALERTS_ENABLED=true

# Email (SendGrid)
SEND_PHARMACY_EMAIL=true
SENDGRID_API_KEY=your_sendgrid_api_key_here
PHARMACY_EMAIL_FROM=notifications@doctor-dashboard.com
PHARMACY_EMAIL_TEAM=pharmacy@hospital.com

# WhatsApp (Business API) - Optional
SEND_PHARMACY_WHATSAPP=false
WHATSAPP_ACCESS_TOKEN=
PHARMACY_WHATSAPP_PHONE_NUMBER=

# Testing mode (log only, don't send)
PHARMACY_ALERT_LOG_ONLY=true
```

## Triggers

### Automatic Trigger
After prescription extraction completes, if medications are detected:
- Automatically called in `prescription_two_stage_agent.cjs`
- Runs after Stage 4 (Data Integration)
- Logs to `server/storage/pharmacy_alerts.jsonl`

### Manual Trigger
Via dashboard or API:
```javascript
const skill = new SendPharmacyAlertSkill();
await skill.execute({ documentId, dashboardData });
```

## Email Template

**Subject:** `🔔 New Prescription - 3 Medications | Patient: John Doe`

```
PHARMACY ALERT - NEW PRESCRIPTION
==================================================

PATIENT INFORMATION
------------------------------
Name: John Doe
Age: 45
Gender: Male
MRN: MRN-123456

DOCTOR INFORMATION
------------------------------
Doctor: Dr. Sarah Smith
Department: Cardiology
Prescribed Date: 2025-05-03

MEDICATIONS PRESCRIBED
------------------------------
1. Amlodipine 5mg
   Dose: 5mg
   Frequency: Twice daily
   Duration: 30 days

2. Metformin 500mg
   Dose: 500mg
   Frequency: Three times daily
   Duration: 30 days

3. Atorvastatin 10mg
   Dose: 10mg
   Frequency: Once daily at bedtime
   Duration: 30 days

DIAGNOSIS
------------------------------
Hypertension with Type 2 Diabetes Mellitus

ACTION REQUIRED
------------------------------
✓ Prepare medications for patient pickup/delivery
✓ Verify stock availability
✓ Contact patient if any substitutions needed
```

## WhatsApp Template

```
🔔 *NEW PRESCRIPTION ALERT*

👤 *PATIENT*
───────────────
Name: John Doe
Age: 45
ID: MRN-123456

👨‍⚕️ *DOCTOR*
───────────────
Dr. Sarah Smith

💊 *MEDICATIONS*
───────────────
1️⃣ *Amlodipine 5mg*
   📏 5mg
   ⏰ Twice daily
   📅 30 days

2️⃣ *Metformin 500mg*
   📏 500mg
   ⏰ Three times daily
   📅 30 days

3️⃣ *Atorvastatin 10mg*
   📏 10mg
   ⏰ Once daily at bedtime
   📅 30 days

📝 *Diagnosis*
───────────────
Hypertension with Type 2 Diabetes Mellitus

📅 Date: 2025-05-03

⚠️ Please prepare medications for pickup.
```

## Testing

Run the test script:
```bash
node test-pharmacy-alert.cjs
```

## Production Setup

1. **SendGrid Setup:**
   - Create account at https://sendgrid.com/
   - Generate API key
   - Verify sender email
   - Set `SENDGRID_API_KEY` in `.env`
   - Set `PHARMACY_ALERT_LOG_ONLY=false`

2. **WhatsApp Setup (Optional):**
   - Apply for WhatsApp Business API
   - Get access token and phone number
   - Set `WHATSAPP_ACCESS_TOKEN` and `PHARMACY_WHATSAPP_PHONE_NUMBER`
   - Set `SEND_PHARMACY_WHATSAPP=true`

## Alert History

View recent alerts:
```bash
cat server/storage/pharmacy_alerts.jsonl
```

Or via API (coming soon):
```
GET /api/pharmacy/alerts/history
```
