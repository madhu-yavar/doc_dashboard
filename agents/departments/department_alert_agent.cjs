/**
 * Department Alert Agent
 *
 * Sends notifications to respective departments when orders are placed:
 * - Lab (Laboratory) Tests
 * - Radiology / Imaging Studies
 * - Nuclear Medicine Studies
 * - Procedures / Interventions
 *
 * Usage:
 *   const agent = new DepartmentAlertAgent();
 *   const result = await agent.sendAlerts(dashboardData);
 */

const DepartmentAlertFormatter = require("../../tools/pharmacy/department_alert_formatter.tool.cjs");
const DepartmentNotifier = require("./department_notifier.cjs");
const fs = require('fs/promises');
const path = require('path');

class DepartmentAlertAgent {
  constructor(config = {}) {
    this.name = "Department Alert Agent";
    this.version = "1.0.0";

    this.config = {
      enabled: process.env.DEPARTMENT_ALERTS_ENABLED !== "false",
      logOnly: process.env.DEPARTMENT_ALERT_LOG_ONLY !== "false",
      ...config
    };

    // Department email configuration
    this.departmentEmails = {
      lab: process.env.LAB_EMAIL || 'lab@hospital.com',
      radiology: process.env.RADIOLOGY_EMAIL || 'radiology@hospital.com',
      nuclear_medicine: process.env.NUCLEAR_MEDICINE_EMAIL || 'nuclear@hospital.com',
      procedures: process.env.PROCEDURES_EMAIL || 'procedures@hospital.com'
    };

    // Initialize components
    this.formatter = new DepartmentAlertFormatter();
    this.notifier = new DepartmentNotifier();

    // Alert log path
    this.alertLogPath = process.env.DEPARTMENT_ALERT_LOG_PATH ||
      "./server/storage/department_alerts.jsonl";
  }

  /**
   * Main entry point - check for orders and send alerts to respective departments
   * @param {object} dashboardData - The processed prescription data
   * @param {object} options - Additional options (documentId, etc.)
   * @returns {Promise<object>}
   */
  async sendAlerts(dashboardData, options = {}) {
    const startTime = Date.now();
    const { documentId = null, departments: selectedDepartments = null } = options;

    console.log(`\n📋 ${this.name} v${this.version}`);
    console.log(`   Config: ${this.config.enabled ? 'Enabled' : 'Disabled'}`);

    try {
      if (!this.config.enabled) {
        return this.skippedResult("Agent disabled via configuration");
      }

      // Detect which departments have orders
      const departments = this.detectDepartmentsWithOrders(dashboardData)
        .filter((entry) => !Array.isArray(selectedDepartments) || selectedDepartments.includes(entry.department));

      if (departments.length === 0) {
        return this.skippedResult("No department orders found");
      }

      console.log(`   ✓ ${departments.length} department(s) with orders: ${departments.map(d => d.department).join(', ')}`);

      // Send alerts to each department
      const results = {};
      const allErrors = [];

      for (const dept of departments) {
        const { department, count } = dept;
        console.log(`\n   📢 Processing ${department.toUpperCase()} (${count} orders)...`);

        try {
          // Format alert content
          const alertContent = this.formatter.formatAlert(department, dashboardData);

          // Get recipient email
          const recipientEmail = this.departmentEmails[department];
          if (!recipientEmail) {
            console.log(`      ⚠️ No email configured for ${department} - skipping`);
            continue;
          }

          // Send alert
          const result = await this.notifier.send(department, alertContent, recipientEmail);

          results[department] = {
            sent: true,
            emailSent: !!result.email?.success,
            whatsappSent: !!result.whatsapp?.success,
            itemCount: count,
            recipient: recipientEmail
          };

          console.log(`      ✅ ${department} alert sent`);

        } catch (error) {
          console.error(`      ❌ ${department} alert failed: ${error.message}`);
          results[department] = {
            sent: false,
            error: error.message,
            itemCount: count
          };
          allErrors.push({ department, error: error.message });
        }
      }

      // Log all alerts
      await this.logAlerts({
        timestamp: new Date().toISOString(),
        documentId,
        patientName: dashboardData.patient?.name,
        patientMrn: dashboardData.patient?.mrn,
        doctorName: dashboardData.doctor?.name,
        departments: departments.map(d => ({ department: d.department, count: d.count })),
        results
      });

      const processingTime = Date.now() - startTime;
      console.log(`\n   ✓ Department alert processing complete (${processingTime}ms)\n`);

      return {
        success: allErrors.length === 0,
        sent: true,
        departments: results,
        errors: allErrors,
        processingTime
      };

    } catch (error) {
      console.error(`   ❌ Department Alert Agent failed: ${error.message}`);
      return {
        success: false,
        sent: false,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Detect which departments have orders
   */
  detectDepartmentsWithOrders(dashboardData) {
    const departments = [];

    // Check Lab orders
    const labTests = (dashboardData.investigations || []).filter(i => i.status === 'ordered');
    if (labTests.length > 0) {
      departments.push({ department: 'lab', count: labTests.length });
    }

    // Check Radiology orders
    const radiologyStudies = (dashboardData.radiology || []).filter(i => i.status === 'ordered');
    if (radiologyStudies.length > 0) {
      departments.push({ department: 'radiology', count: radiologyStudies.length });
    }

    // Check Nuclear Medicine orders
    const nuclearStudies = (dashboardData.nuclear_medicine || []).filter(i => i.status === 'ordered');
    if (nuclearStudies.length > 0) {
      departments.push({ department: 'nuclear_medicine', count: nuclearStudies.length });
    }

    // Check Procedures
    const procedures = (dashboardData.procedures || []).filter(p =>
      p.status === 'ordered' || p.status === 'mentioned'
    );
    if (procedures.length > 0) {
      departments.push({ department: 'procedures', count: procedures.length });
    }

    return departments;
  }

  /**
   * Return a skipped result
   */
  skippedResult(reason) {
    console.log(`   ⊘ Skipped: ${reason}\n`);
    return {
      success: true,
      sent: false,
      skipped: true,
      reason,
      departments: {}
    };
  }

  /**
   * Log alerts to file for audit trail
   */
  async logAlerts(alertData) {
    try {
      const dir = path.dirname(this.alertLogPath);
      await fs.mkdir(dir, { recursive: true });

      const logLine = JSON.stringify(alertData) + '\n';
      await fs.appendFile(this.alertLogPath, logLine, 'utf8');
    } catch (error) {
      console.error(`   ⚠️ Failed to log department alerts: ${error.message}`);
    }
  }

  /**
   * Get alert history
   */
  async getAlertHistory(limit = 50) {
    try {
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
      configuredEmails: Object.keys(this.departmentEmails).filter(key => this.departmentEmails[key]),
      departments: {
        lab: { email: this.departmentEmails.lab },
        radiology: { email: this.departmentEmails.radiology },
        nuclear_medicine: { email: this.departmentEmails.nuclear_medicine },
        procedures: { email: this.departmentEmails.procedures }
      }
    };
  }
}

module.exports = DepartmentAlertAgent;
