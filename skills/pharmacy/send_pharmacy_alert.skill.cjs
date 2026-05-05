/**
 * Send Pharmacy Alert Skill
 *
 * Manual trigger skill to send pharmacy alerts from the dashboard
 * Can be called via API endpoint or dashboard button
 *
 * Usage:
 *   const skill = new SendPharmacyAlertSkill();
 *   const result = await skill.execute({ documentId, dashboardData });
 */

const PharmacyAlertAgent = require("../../agents/pharmacy/pharmacy_alert_agent.cjs");

class SendPharmacyAlertSkill {
  constructor(config = {}) {
    this.name = "Send Pharmacy Alert";
    this.version = "1.0.0";
    this.config = config;

    // Initialize agent (singleton)
    this.agent = new PharmacyAlertAgent(config);
  }

  /**
   * Execute the skill - send pharmacy alert
   * @param {object} input - { documentId, dashboardData }
   * @returns {Promise<object>}
   */
  async execute(input) {
    const { documentId, dashboardData } = input;

    if (!dashboardData) {
      return {
        success: false,
        error: "No dashboard data provided"
      };
    }

    // Send alert with manual trigger flag
    const result = await this.agent.sendAlert(dashboardData, {
      manualTrigger: true,
      documentId
    });

    return {
      success: result.success,
      sent: result.sent,
      emailSent: result.emailSent,
      whatsappSent: result.whatsappSent,
      results: result.results,
      error: result.error,
      processingTime: result.processingTime
    };
  }

  /**
   * Get alert history
   */
  async getHistory(limit = 50) {
    return await this.agent.getAlertHistory(limit);
  }

  /**
   * Get agent status
   */
  getStatus() {
    return this.agent.getStatus();
  }

  /**
   * Skill metadata for API discovery
   */
  getMetadata() {
    return {
      name: this.name,
      version: this.version,
      description: "Manually send pharmacy alerts for prescription medications",
      parameters: {
        documentId: {
          type: "string",
          required: false,
          description: "Document ID for tracking"
        },
        dashboardData: {
          type: "object",
          required: true,
          description: "Processed prescription data in dashboard format"
        }
      },
      returns: {
        success: "boolean",
        sent: "boolean",
        emailSent: "boolean",
        whatsappSent: "boolean",
        results: "object",
        error: "string | null"
      }
    };
  }
}

module.exports = SendPharmacyAlertSkill;
