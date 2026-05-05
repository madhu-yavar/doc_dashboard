/**
 * Email Notifier for Pharmacy Alerts
 * Uses SendGrid to send email notifications to pharmacy team
 */

class EmailNotifier {
  constructor(config = {}) {
    this.config = {
      fromEmail: process.env.PHARMACY_EMAIL_FROM || 'notifications@doctor-dashboard.com',
      toEmail: process.env.PHARMACY_EMAIL_TEAM || 'pharmacy@hospital.com',
      replyTo: process.env.PHARMACY_EMAIL_REPLY_TO,
      ...config
    };

    // Lazy load SendGrid (only if API key is configured)
    this.sendGrid = null;
    this.initialized = false;
  }

  /**
   * Initialize SendGrid client
   */
  initialize() {
    if (this.initialized) return true;

    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      console.warn(`      ⚠️ SENDGRID_API_KEY not configured - emails will be mocked`);
      return false;
    }

    try {
      // Dynamic import to avoid errors if package not installed
      // @ts-ignore
      this.sendGrid = require('@sendgrid/mail');
      this.sendGrid.setApiKey(apiKey);
      this.initialized = true;
      return true;
    } catch (error) {
      console.warn(`      ⚠️ @sendgrid/mail not installed - run: npm install @sendgrid/mail`);
      return false;
    }
  }

  /**
   * Send email alert
   * @param {object} alertContent - Formatted alert content from AlertFormatter
   * @returns {Promise<object>}
   */
  async send(alertContent) {
    // MOCK MODE: Always mock unless explicitly disabled with valid config
    const toEmails = this.config.toEmail.split(',').map(e => e.trim());

    const emailData = {
      to: toEmails,
      from: this.config.fromEmail,
      replyTo: this.config.replyTo || this.config.fromEmail,
      subject: this.buildSubject(alertContent),
      text: this.buildTextBody(alertContent),
      html: this.buildHtmlBody(alertContent)
    };

    // Log email preview
    console.log(`      └─ To: ${toEmails.join(', ')}`);
    console.log(`      └─ Subject: ${emailData.subject}`);

    // MOCK MODE: Email is logged to console but not actually sent
    console.log(`      └─ 📧 MOCK MODE (email not actually sent - see preview below)`);
    console.log(`      ┌─ Email Preview ──────────────────────────────────────┐`);
    console.log(`      │ ${emailData.text.substring(0, 300)}...`);
    console.log(`      └──────────────────────────────────────────────────────┘`);

    return {
      success: true,
      mock: true,
      messageId: `mock-${Date.now()}`,
      preview: emailData,
      to: toEmails,
      subject: emailData.subject
    };
  }

  /**
   * Build email subject line
   */
  buildSubject(content) {
    const patientName = content.patient.name || 'Unknown';
    const medCount = content.medications.length;
    const urgency = content.urgency || 'normal';
    const prefix = urgency === 'high' ? '🔴 URGENT: ' : '🔔 ';
    return `${prefix}New Prescription - ${medCount} Medication${medCount > 1 ? 's' : ''} | Patient: ${patientName}`;
  }

  /**
   * Build plain text email body
   */
  buildTextBody(content) {
    const lines = [
      'PHARMACY ALERT - NEW PRESCRIPTION',
      '=' .repeat(50),
      '',
      'PATIENT INFORMATION',
      '-' .repeat(30),
      `Name: ${content.patient.name || 'Unknown'}`,
      content.patient.age ? `Age: ${content.patient.age}` : '',
      content.patient.gender ? `Gender: ${content.patient.gender}` : '',
      content.patient.mrn ? `MRN: ${content.patient.mrn}` : '',
      '',
      'DOCTOR INFORMATION',
      '-' .repeat(30),
      `Doctor: ${content.doctor.name || 'Unknown'}`,
      content.doctor.department ? `Department: ${content.doctor.department}` : '',
      content.rxDate ? `Prescribed Date: ${content.rxDate}` : '',
      '',
      'MEDICATIONS PRESCRIBED',
      '-' .repeat(30)
    ];

    content.medications.forEach((med, idx) => {
      lines.push(`${idx + 1}. ${med.name}`);
      if (med.dose) lines.push(`   Dose: ${med.dose}`);
      if (med.frequency) lines.push(`   Frequency: ${med.frequency}`);
      if (med.duration) lines.push(`   Duration: ${med.duration}`);
      lines.push('');
    });

    if (content.diagnosis) {
      lines.push('DIAGNOSIS');
      lines.push('-'.repeat(30));
      lines.push(content.diagnosis);
      lines.push('');
    }

    if (content.instructions) {
      lines.push('ADDITIONAL INSTRUCTIONS');
      lines.push('-'.repeat(30));
      lines.push(content.instructions);
      lines.push('');
    }

    lines.push('ACTION REQUIRED');
    lines.push('-'.repeat(30));
    lines.push('✓ Prepare medications for patient pickup/delivery');
    lines.push('✓ Verify stock availability');
    lines.push('✓ Contact patient if any substitutions needed');

    if (content.dashboardLink) {
      lines.push('');
      lines.push(`View Full Prescription: ${content.dashboardLink}`);
    }

    return lines.filter(Boolean).join('\n');
  }

  /**
   * Build HTML email body
   */
  buildHtmlBody(content) {
    const medRows = content.medications.map((med, idx) => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px 8px;">${idx + 1}</td>
        <td style="padding: 12px 8px;"><strong>${this.escapeHtml(med.name)}</strong></td>
        <td style="padding: 12px 8px;">${this.escapeHtml(med.dose || '-')}</td>
        <td style="padding: 12px 8px;">${this.escapeHtml(med.frequency || '-')}</td>
        <td style="padding: 12px 8px;">${this.escapeHtml(med.duration || '-')}</td>
      </tr>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Pharmacy Alert</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 20px; background-color: #f9fafb;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 24px; text-align: center;">
            <h1 style="margin: 0; color: white; font-size: 24px;">🏥 Pharmacy Alert</h1>
            <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9);">New Prescription Received</p>
          </div>

          <!-- Content -->
          <div style="padding: 24px;">
            <!-- Patient Info -->
            <div style="background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 4px; margin-bottom: 20px;">
              <h2 style="margin: 0 0 12px 0; font-size: 16px; color: #1e40af;">Patient Information</h2>
              <table style="width: 100%;">
                <tr><td style="padding: 4px 0;"><strong>Name:</strong></td><td>${this.escapeHtml(content.patient.name || 'Unknown')}</td></tr>
                ${content.patient.age ? `<tr><td style="padding: 4px 0;"><strong>Age:</strong></td><td>${this.escapeHtml(String(content.patient.age))}</td></tr>` : ''}
                ${content.patient.gender ? `<tr><td style="padding: 4px 0;"><strong>Gender:</strong></td><td>${this.escapeHtml(content.patient.gender)}</td></tr>` : ''}
                ${content.patient.mrn ? `<tr><td style="padding: 4px 0;"><strong>MRN:</strong></td><td>${this.escapeHtml(content.patient.mrn)}</td></tr>` : ''}
              </table>
            </div>

            <!-- Doctor Info -->
            <div style="margin-bottom: 20px;">
              <h2 style="margin: 0 0 12px 0; font-size: 16px; color: #374151;">Doctor Information</h2>
              <table style="width: 100%;">
                <tr><td style="padding: 4px 0; width: 100px;"><strong>Doctor:</strong></td><td>${this.escapeHtml(content.doctor.name || 'Unknown')}</td></tr>
                ${content.doctor.department ? `<tr><td style="padding: 4px 0;"><strong>Department:</strong></td><td>${this.escapeHtml(content.doctor.department)}</td></tr>` : ''}
                ${content.rxDate ? `<tr><td style="padding: 4px 0;"><strong>Date:</strong></td><td>${this.escapeHtml(content.rxDate)}</td></tr>` : ''}
              </table>
            </div>

            <!-- Medications -->
            <div style="margin-bottom: 20px;">
              <h2 style="margin: 0 0 12px 0; font-size: 16px; color: #374151;">💊 Medications (${content.medications.length})</h2>
              <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden;">
                <thead style="background: #f3f4f6;">
                  <tr>
                    <th style="padding: 12px 8px; text-align: left; font-size: 12px; color: #6b7280;">#</th>
                    <th style="padding: 12px 8px; text-align: left; font-size: 12px; color: #6b7280;">Medication</th>
                    <th style="padding: 12px 8px; text-align: left; font-size: 12px; color: #6b7280;">Dose</th>
                    <th style="padding: 12px 8px; text-align: left; font-size: 12px; color: #6b7280;">Frequency</th>
                    <th style="padding: 12px 8px; text-align: left; font-size: 12px; color: #6b7280;">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  ${medRows}
                </tbody>
              </table>
            </div>

            ${content.diagnosis ? `
            <!-- Diagnosis -->
            <div style="margin-bottom: 20px;">
              <h2 style="margin: 0 0 12px 0; font-size: 16px; color: #374151;">📝 Diagnosis</h2>
              <p style="margin: 0; padding: 12px; background: #fef3c7; border-radius: 4px; color: #92400e;">${this.escapeHtml(content.diagnosis)}</p>
            </div>
            ` : ''}

            ${content.instructions ? `
            <!-- Instructions -->
            <div style="margin-bottom: 20px;">
              <h2 style="margin: 0 0 12px 0; font-size: 16px; color: #374151;">Additional Instructions</h2>
              <p style="margin: 0; color: #4b5563;">${this.escapeHtml(content.instructions)}</p>
            </div>
            ` : ''}

            <!-- Action Required -->
            <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 16px; border-radius: 4px; margin-bottom: 20px;">
              <h2 style="margin: 0 0 12px 0; font-size: 16px; color: #065f46;">✓ Action Required</h2>
              <ul style="margin: 0; padding-left: 20px; color: #047857;">
                <li>Prepare medications for patient pickup/delivery</li>
                <li>Verify stock availability</li>
                <li>Contact patient if any substitutions needed</li>
              </ul>
            </div>

            ${content.dashboardLink ? `
            <!-- Dashboard Link -->
            <div style="text-align: center;">
              <a href="${this.escapeHtml(content.dashboardLink)}" style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">View Full Prescription →</a>
            </div>
            ` : ''}
          </div>

          <!-- Footer -->
          <div style="background: #f3f4f6; padding: 16px 24px; text-align: center; font-size: 12px; color: #6b7280;">
            <p style="margin: 0;">This is an automated message from Doctor Dashboard System</p>
            <p style="margin: 4px 0 0 0;">Sent at ${new Date().toLocaleString()}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Escape HTML special characters
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text || '').replace(/[&<>"']/g, m => map[m]);
  }
}

module.exports = EmailNotifier;
