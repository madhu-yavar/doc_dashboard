/**
 * Pharmacy Alert Agent
 *
 * Triggers notifications to pharmacy team when medications are prescribed.
 * Sends alerts via Email (SendGrid) and WhatsApp (Business API).
 *
 * Usage:
 *   const agent = new PharmacyAlertAgent();
 *   const result = await agent.sendAlert(dashboardData);
 *
 * Dashboard Data Format:
 *   {
 *     patient: { name, age, gender, mrn, contact },
 *     doctor: { name },
 *     meta: { rx_date },
 *     medications: [{ name, dose, frequency, duration }],
 *     diagnosis: { principal }
 *   }
 */

const EmailNotifier = require("./email_notifier.cjs");
const WhatsAppNotifier = require("./whatsapp_notifier.cjs");
const AlertFormatter = require("../../tools/pharmacy/alert_formatter.tool.cjs");

class PharmacyAlertAgent {
  constructor(config = {}) {
    this.name = "Pharmacy Alert Agent";
    this.version = "1.0.0";

    this.config = {
      enabled: process.env.PHARMACY_ALERTS_ENABLED !== "false",
      sendEmail: process.env.SEND_PHARMACY_EMAIL !== "false",
      sendWhatsApp: process.env.SEND_PHARMACY_WHATSAPP === "true",
      logOnly: process.env.PHARMACY_ALERT_LOG_ONLY === "true",
      ...config
    };

    // Initialize notifiers
    this.emailNotifier = new EmailNotifier();
    this.whatsAppNotifier = new WhatsAppNotifier();
    this.alertFormatter = new AlertFormatter();

    // Alert log for audit trail
    this.alertLogPath = process.env.PHARMACY_ALERT_LOG_PATH ||
      "./server/storage/pharmacy_alerts.jsonl";
  }

  /**
   * Main entry point - sends pharmacy alerts if medications are present
   * @param {object} dashboardData - The processed prescription data
   * @param {object} options - Additional options (manualTrigger, documentId, etc.)
   * @returns {Promise<object>}
   */
  async sendAlert(dashboardData, options = {}) {
    const startTime = Date.now();
    const { manualTrigger = false, documentId = null } = options;

    console.log(`\n📋 ${this.name} v${this.version}`);
    console.log(`   Config: ${this.config.enabled ? 'Enabled' : 'Disabled (check PHARMACY_ALERTS_ENABLED)'}`);

    try {
      // Check if agent is enabled
      if (!this.config.enabled && !manualTrigger) {
        return this.skippedResult("Agent disabled via configuration");
      }

      // Check if medications exist
      const medications = dashboardData?.medications || [];
      if (!medications || medications.length === 0) {
        return this.skippedResult("No medications found in prescription");
      }

      console.log(`   ✓ ${medications.length} medication(s) detected`);

      // Format alert content
      const alertContent = this.alertFormatter.formatAlert(dashboardData);

      // Initialize results
      const results = {
        email: null,
        whatsapp: null,
        errors: []
      };

      // Send Email
      if (this.config.sendEmail) {
        console.log(`   📧 Sending Email alert...`);
        try {
          results.email = await this.emailNotifier.send(alertContent);
          if (results.email.mock) {
            console.log(`   ⚠️ Email preview generated only`);
          } else {
            console.log(`   ✅ Email sent: ${results.email.messageId || 'queued'}`);
          }
        } catch (error) {
          console.error(`   ❌ Email failed: ${error.message}`);
          results.errors.push({ type: 'email', message: error.message });
        }
      } else {
        console.log(`   ⊘ Email disabled (SEND_PHARMACY_EMAIL=false)`);
      }

      // Send WhatsApp
      if (this.config.sendWhatsApp) {
        console.log(`   📱 Sending WhatsApp alert...`);
        try {
          results.whatsapp = await this.whatsAppNotifier.send(alertContent);
          console.log(`   ✅ WhatsApp sent: ${results.whatsapp.messageId || 'queued'}`);
        } catch (error) {
          console.error(`   ❌ WhatsApp failed: ${error.message}`);
          results.errors.push({ type: 'whatsapp', message: error.message });
        }
      } else {
        console.log(`   ⊘ WhatsApp disabled (SEND_PHARMACY_WHATSAPP=true required)`);
      }

      // Log the alert
      await this.logAlert({
        timestamp: new Date().toISOString(),
        documentId,
        patientName: alertContent.patient.name,
        patientMrn: alertContent.patient.mrn,
        doctorName: alertContent.doctor.name,
        medicationCount: medications.length,
        medications: medications.map(m => m.name).join(', '),
        trigger: manualTrigger ? 'manual' : 'automatic',
        results
      });

      const processingTime = Date.now() - startTime;
      console.log(`   ✓ Alert processing complete (${processingTime}ms)\n`);

      return {
        success: results.errors.length === 0,
        sent: true,
        emailSent: Boolean(results.email && (results.email.delivered ?? results.email.success) && !results.email.mock),
        whatsappSent: Boolean(results.whatsapp && (results.whatsapp.delivered ?? results.whatsapp.success) && !results.whatsapp.mock),
        results,
        processingTime
      };

    } catch (error) {
      console.error(`   ❌ Pharmacy Alert Agent failed: ${error.message}`);
      return {
        success: false,
        sent: false,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Return a skipped result (no medications, disabled, etc.)
   */
  skippedResult(reason) {
    console.log(`   ⊘ Skipped: ${reason}\n`);
    return {
      success: true,
      sent: false,
      skipped: true,
      reason
    };
  }

  /**
   * Log alert to file for audit trail
   */
  async logAlert(alertData) {
    try {
      const fs = require('fs/promises');
      const path = require('path');

      // Ensure directory exists
      const dir = path.dirname(this.alertLogPath);
      await fs.mkdir(dir, { recursive: true });

      // Append to log file (JSONL format)
      const logLine = JSON.stringify(alertData) + '\n';
      await fs.appendFile(this.alertLogPath, logLine, 'utf8');
    } catch (error) {
      console.error(`   ⚠️ Failed to log alert: ${error.message}`);
    }
  }

  /**
   * Get alert history
   */
  async getAlertHistory(limit = 50) {
    try {
      const fs = require('fs/promises');
      const content = await fs.readFile(this.alertLogPath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const alerts = lines
        .slice(-limit)
        .map(line => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
      return alerts.reverse();
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      name: this.name,
      version: this.version,
      enabled: this.config.enabled,
      channels: {
        email: {
          enabled: this.config.sendEmail,
          configured: this.emailNotifier.isConfigured()
        },
        whatsapp: {
          enabled: this.config.sendWhatsApp,
          configured: !!process.env.WHATSAPP_ACCESS_TOKEN
        }
      }
    };
  }
}

module.exports = PharmacyAlertAgent;
