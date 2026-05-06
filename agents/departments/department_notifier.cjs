/**
 * Multi-Channel Department Notifier
 * Sends department alerts via Email (SMTP) and WhatsApp (mock)
 * Supports all departments: Lab, Radiology, Nuclear Medicine, Procedures
 */

const SmtpMailer = require("../shared/smtp_mailer.cjs");

class DepartmentNotifier {
  constructor(config = {}) {
    this.config = {
      fromEmail:
        process.env.DEPARTMENT_EMAIL_FROM ||
        process.env.SMTP_FROM_EMAIL ||
        'notifications@doctor-dashboard.com',
      replyTo:
        process.env.DEPARTMENT_EMAIL_REPLY_TO ||
        process.env.SMTP_REPLY_TO ||
        '',
      logOnly: process.env.DEPARTMENT_ALERT_LOG_ONLY === "true",
      ...config
    };

    this.mailer = new SmtpMailer({
      fromEmail: this.config.fromEmail,
      replyTo: this.config.replyTo
    });
  }

  /**
   * Send department alert via configured channels
   * @param {string} department - Department type
   * @param {object} alertContent - Formatted alert content
   * @param {string} recipientEmail - Department email
   * @returns {Promise<object>}
   */
  async send(department, alertContent, recipientEmail) {
    const emailResult = await this.sendEmail(department, alertContent, recipientEmail);
    const whatsappResult = await this.sendWhatsApp(department, alertContent);

    return {
      email: emailResult,
      whatsapp: whatsappResult,
      success: emailResult.success || whatsappResult.success
    };
  }

  isConfigured() {
    return this.mailer.isConfigured();
  }

  /**
   * Send email alert
   */
  async sendEmail(department, alertContent, recipientEmail) {
    const subject = this.buildSubject(department, alertContent);
    const body = this.buildEmailBody(department, alertContent);
    const html = `<pre style="font-family: 'Segoe UI', Arial, sans-serif; white-space: pre-wrap;">${this.escapeHtml(body)}</pre>`;

    console.log(`      └─ To: ${recipientEmail}`);
    console.log(`      └─ Subject: ${subject}`);

    if (this.config.logOnly || !recipientEmail || !this.isConfigured()) {
      const reason = this.config.logOnly
        ? "DEPARTMENT_ALERT_LOG_ONLY=true"
        : !recipientEmail
          ? `missing recipient for ${department}`
          : `missing config: ${this.mailer.getMissingConfig().join(", ")}`;

      console.log(`      └─ 📧 Preview only (${reason})`);
      console.log(`      ┌─ Email Preview ──────────────────────────────────────┐`);
      console.log(`      │ ${body.substring(0, 300)}...`);
      console.log(`      └──────────────────────────────────────────────────────┘`);

      return {
        success: true,
        delivered: false,
        mock: true,
        messageId: `mock-${department}-${Date.now()}`,
        to: recipientEmail,
        subject
      };
    }

    const result = await this.mailer.sendMail({
      to: recipientEmail,
      from: this.config.fromEmail,
      replyTo: this.config.replyTo || this.config.fromEmail,
      subject,
      text: body,
      html
    });

    console.log(`      └─ ✅ SMTP accepted: ${(result.accepted || []).join(', ') || 'queued'}`);
    console.log(`      ┌─ Email Preview ──────────────────────────────────────┐`);
    console.log(`      │ ${body.substring(0, 300)}...`);
    console.log(`      └──────────────────────────────────────────────────────┘`);

    return {
      success: true,
      delivered: true,
      mock: false,
      messageId: result.messageId,
      accepted: result.accepted || [],
      rejected: result.rejected || [],
      to: recipientEmail,
      subject
    };
  }

  /**
   * Send WhatsApp alert (MOCK MODE)
   */
  async sendWhatsApp(department, alertContent) {
    const message = this.buildWhatsAppMessage(department, alertContent);

    console.log(`      └─ 📱 MOCK MODE (WhatsApp not actually sent)`);
    console.log(`      ┌─ WhatsApp Preview ───────────────────────────────────┐`);
    console.log(`      │ ${message.split('\n').slice(0, 5).join('\n      │ ')}...`);
    console.log(`      └──────────────────────────────────────────────────────┘`);

    return {
      success: true,
      mock: true,
      messageId: `mock-wa-${department}-${Date.now()}`
    };
  }

  /**
   * Build email subject
   */
  buildSubject(department, content) {
    const dept = content.department || department.toUpperCase();
    const patientName = content.patient?.name || 'Unknown';
    const itemCount = content.itemCount || 0;
    const itemLabel = this.getItemLabel(department);
    const urgency = content.urgency === 'high' ? '🔴 URGENT: ' : '🔔 ';

    return `${urgency}${dept} Order - ${itemCount} ${itemLabel}${itemCount > 1 ? 's' : ''} | Patient: ${patientName}`;
  }

  /**
   * Build email body
   */
  buildEmailBody(department, content) {
    const lines = [
      `${content.department.toUpperCase()} ORDER - NEW REQUEST`,
      '='.repeat(50),
      '',
      'PATIENT INFORMATION',
      '-'.repeat(30),
      `Name: ${content.patient?.name || 'Unknown'}`,
      content.patient?.age ? `Age: ${content.patient.age}` : '',
      content.patient?.gender ? `Gender: ${content.patient.gender}` : '',
      content.patient?.mrn ? `MRN: ${content.patient.mrn}` : '',
      '',
      'ORDERING PHYSICIAN',
      '-'.repeat(30),
      `Doctor: ${content.doctor?.name || 'Unknown'}`,
      content.doctor?.department ? `Department: ${content.doctor.department}` : '',
      content.rxDate ? `Order Date: ${content.rxDate}` : '',
      '',
      `${content.department.toUpperCase()} ORDERS`,
      '-'.repeat(30)
    ];

    content.items.forEach((item, idx) => {
      lines.push(`${idx + 1}. ${item.name}`);
      if (item.priority) lines.push(`   Priority: ${item.priority}`);
      if (item.isUncertain) lines.push(`   ⚠️ Uncertain extraction - please verify`);
    });

    if (content.diagnosis) {
      lines.push('');
      lines.push('DIAGNOSIS / CLINICAL INDICATION');
      lines.push('-'.repeat(30));
      lines.push(content.diagnosis);
    }

    lines.push('');
    lines.push('ACTION REQUIRED');
    lines.push('-'.repeat(30));
    lines.push(`✓ Process and schedule ${this.getItemLabel(department)}`);
    lines.push('✓ Verify order details with physician if unclear');
    lines.push('✓ Contact patient for scheduling if needed');

    if (content.dashboardLink) {
      lines.push('');
      lines.push(`View Full Order: ${content.dashboardLink}`);
    }

    return lines.filter(Boolean).join('\n');
  }

  /**
   * Build WhatsApp message
   */
  buildWhatsAppMessage(department, content) {
    const itemLabel = this.getItemLabel(department);
    const lines = [
      '🔔 *NEW DEPARTMENT ORDER*',
      '',
      `🏥 *${content.department.toUpperCase()}*`,
      '───────────────',
      '',
      '👤 *PATIENT*',
      '───────────────',
      `Name: ${content.patient?.name || 'Unknown'}`,
      content.patient?.age ? `Age: ${content.patient.age}` : '',
      content.patient?.mrn ? `ID: ${content.patient.mrn}` : '',
      '',
      '👨‍⚕️ *DOCTOR*',
      '───────────────',
      `Dr. ${content.doctor?.name || 'Unknown'}`,
      '',
      `📋 *${itemLabel.toUpperCase()}*`,
      '───────────────'
    ];

    const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    content.items.forEach((item, idx) => {
      const num = numEmojis[idx] || '•';
      lines.push(`${num} *${item.name}*`);
      if (item.priority && item.priority !== 'routine') {
        lines.push(`   ⚠️ Priority: ${item.priority}`);
      }
      if (item.isUncertain) {
        lines.push(`   ⚠️ Please verify`);
      }
    });

    if (content.diagnosis) {
      lines.push('');
      lines.push('📝 *Indication*');
      lines.push('───────────────');
      lines.push(content.diagnosis);
    }

    lines.push('');
    lines.push(`📅 Date: ${content.rxDate || new Date().toLocaleDateString()}`);
    lines.push('');
    lines.push('⚠️ Please process this order.');

    return lines.join('\n');
  }

  /**
   * Get item label for department
   */
  getItemLabel(department) {
    const labels = {
      lab: 'Test',
      laboratory: 'Test',
      radiology: 'Study',
      nuclear_medicine: 'Study',
      procedures: 'Procedure'
    };
    return labels[department.toLowerCase()] || 'Item';
  }

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

module.exports = DepartmentNotifier;
