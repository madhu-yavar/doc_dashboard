/**
 * Alerts Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles alert delivery data access using the unified alert_deliveries table.
 * Provides PostgreSQL-based persistence for alert functionality.
 *
 * Related Tables:
 * - alert_deliveries (unified alert delivery tracking for all alert types)
 *
 * Schema fields:
 * - alert_family: 'pharmacy', 'lab', 'radiology', 'nuclear_medicine', 'procedures'
 * - target_name: medication name, test name, or procedure name
 * - channel: 'email', 'whatsapp'
 * - recipient: email address or phone number
 * - status: 'pending', 'sent', 'failed', 'cancelled'
 *
 * Phase 1: Create repository layer, do not change public routes
 * Phase 2: Add dual-write capability (JSON files + PostgreSQL)
 * Phase 3: Backfill existing data
 * Phase 4: Read cutover to PostgreSQL
 */

const { BaseRepository } = require('./base_repository.cjs');

class AlertsRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.alertDeliveriesTableName = 'alert_deliveries';
    this.documentsTableName = 'documents';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    // Verify tables exist
    const alertDeliveriesExist = await this.tableExists(this.alertDeliveriesTableName);
    if (!alertDeliveriesExist) {
      throw new Error('Alerts tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // Alert Delivery Operations
  // ========================================

  /**
   * Create alert delivery
   */
  async createAlertDelivery(alertData) {
    const id = alertData.id || this.generateId();
    const now = new Date().toISOString();
    const createdAt = alertData.created_at || now;

    const query = `
      INSERT INTO ${this.alertDeliveriesTableName} (
        id, document_id, alert_family, target_name, channel, recipient,
        status, payload_jsonb, result_jsonb, error_message, sent_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      alertData.document_id || null,
      alertData.alert_family || 'pharmacy',
      alertData.target_name,
      alertData.channel || 'email',
      alertData.recipient,
      alertData.status || 'pending',
      this.toJSONB(alertData.payload || {}),
      this.toJSONB(alertData.result || {}),
      alertData.error_message || null,
      alertData.sent_at || null,
      createdAt
    ]);
  }

  /**
   * Find alert delivery by ID
   */
  async findAlertDeliveryById(alertId) {
    return await this.findById(this.alertDeliveriesTableName, alertId);
  }

  /**
   * Find alert deliveries by document ID
   */
  async findAlertDeliveriesByDocumentId(documentId) {
    return await this.query(
      `SELECT * FROM ${this.alertDeliveriesTableName} WHERE document_id = $1 ORDER BY created_at DESC`,
      [documentId]
    );
  }

  /**
   * Find alert deliveries by family (pharmacy, lab, radiology, etc.)
   */
  async findAlertDeliveriesByFamily(alertFamily, options = {}) {
    const {
      limit = 50,
      offset = 0,
      status = null
    } = options;

    let whereClause = 'WHERE alert_family = $1';
    const params = [alertFamily];
    let paramCount = 2;

    if (status) {
      whereClause += ` AND status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    const query = `
      SELECT * FROM ${this.alertDeliveriesTableName}
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    params.push(limit, offset);
    return await this.query(query, params);
  }

  /**
   * Find alert deliveries by status
   */
  async findAlertDeliveriesByStatus(status) {
    return await this.query(
      `SELECT * FROM ${this.alertDeliveriesTableName} WHERE status = $1 ORDER BY created_at DESC`,
      [status]
    );
  }

  /**
   * Find pending alert deliveries
   */
  async findPendingAlertDeliveries(options = {}) {
    const {
      limit = 100,
      alertFamily = null
    } = options;

    let whereClause = 'WHERE status = $1';
    const params = ['pending'];
    let paramCount = 2;

    if (alertFamily) {
      whereClause += ` AND alert_family = $${paramCount}`;
      params.push(alertFamily);
      paramCount++;
    }

    const query = `
      SELECT * FROM ${this.alertDeliveriesTableName}
      ${whereClause}
      ORDER BY created_at ASC
      LIMIT $${paramCount}
    `;

    params.push(limit);
    return await this.query(query, params);
  }

  /**
   * Update alert delivery
   */
  async updateAlertDelivery(alertId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = [
      'status', 'sent_at', 'error_message', 'result_jsonb', 'payload_jsonb'
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field.includes('_jsonb')) {
          fields.push(`${field} = $${paramCount}`);
          values.push(this.toJSONB(updates[field]));
        } else {
          fields.push(`${field} = $${paramCount}`);
          values.push(updates[field]);
        }
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return await this.findAlertDeliveryById(alertId);
    }

    values.push(alertId);

    const query = `
      UPDATE ${this.alertDeliveriesTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * Mark alert as sent
   */
  async markAlertAsSent(alertId, result = {}) {
    const now = new Date().toISOString();
    return await this.updateAlertDelivery(alertId, {
      status: 'sent',
      sent_at: now,
      result_jsonb: result
    });
  }

  /**
   * Mark alert as failed
   */
  async markAlertAsFailed(alertId, errorMessage) {
    const now = new Date().toISOString();
    return await this.updateAlertDelivery(alertId, {
      status: 'failed',
      sent_at: now,
      error_message: errorMessage
    });
  }

  /**
   * Delete alert delivery
   */
  async deleteAlertDelivery(alertId) {
    const result = await this.execute(
      `DELETE FROM ${this.alertDeliveriesTableName} WHERE id = $1`,
      [alertId]
    );
    return result > 0;
  }

  // ========================================
  // Convenience Methods for Pharmacy/Department Alerts
  // ========================================

  /**
   * Create pharmacy alert (convenience method)
   */
  async createPharmacyAlert(alertData) {
    return await this.createAlertDelivery({
      ...alertData,
      alert_family: 'pharmacy',
      target_name: alertData.medication_name || 'Unknown Medication'
    });
  }

  /**
   * Create department alert (convenience method)
   */
  async createDepartmentAlert(alertData) {
    return await this.createAlertDelivery({
      ...alertData,
      alert_family: alertData.department || 'lab',
      target_name: alertData.test_name || alertData.procedure_name || 'Unknown Test/Procedure'
    });
  }

  /**
   * Find pharmacy alerts (convenience method)
   */
  async findPharmacyAlerts(options = {}) {
    return await this.findAlertDeliveriesByFamily('pharmacy', options);
  }

  /**
   * Find lab alerts (convenience method)
   */
  async findLabAlerts(options = {}) {
    return await this.findAlertDeliveriesByFamily('lab', options);
  }

  /**
   * Find radiology alerts (convenience method)
   */
  async findRadiologyAlerts(options = {}) {
    return await this.findAlertDeliveriesByFamily('radiology', options);
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Get repository statistics
   */
  async getStats() {
    const totalAlerts = await this.count(this.alertDeliveriesTableName);
    const pendingAlerts = await this.count(this.alertDeliveriesTableName, { status: 'pending' });
    const sentAlerts = await this.count(this.alertDeliveriesTableName, { status: 'sent' });
    const failedAlerts = await this.count(this.alertDeliveriesTableName, { status: 'failed' });

    const alertsByFamily = await this.query(`
      SELECT alert_family, COUNT(*) as count
      FROM ${this.alertDeliveriesTableName}
      GROUP BY alert_family
      ORDER BY count DESC
    `);

    const alertsByStatus = await this.query(`
      SELECT status, COUNT(*) as count
      FROM ${this.alertDeliveriesTableName}
      GROUP BY status
      ORDER BY count DESC
    `);

    return {
      totalAlerts,
      pendingAlerts,
      sentAlerts,
      failedAlerts,
      alertsByFamily,
      alertsByStatus
    };
  }

  /**
   * Get alert insights by time period
   */
  async getAlertInsights(options = {}) {
    const {
      groupBy = 'day', // 'day', 'week', 'month'
      startDate = null,
      endDate = null
    } = options;

    let dateFormat = '';
    if (groupBy === 'day') dateFormat = 'YYYY-MM-DD';
    else if (groupBy === 'week') dateFormat = 'YYYY-"W"';
    else if (groupBy === 'month') dateFormat = 'YYYY-MM';

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (startDate) {
      whereClause += ` AND created_at >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND created_at <= $${params.length + 1}`;
      params.push(endDate);
    }

    const query = `
      SELECT
        date_trunc('${dateFormat}', created_at) as period,
        alert_family,
        COUNT(*) as alert_count,
        COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count
      FROM ${this.alertDeliveriesTableName}
      ${whereClause}
      GROUP BY period, alert_family
      ORDER BY period ASC, alert_family
    `;

    return await this.query(query, params);
  }

  /**
   * Search alerts
   */
  async searchAlerts(searchTerm, options = {}) {
    const {
      limit = 50,
      alertFamily = null
    } = options;

    const searchPattern = `%${searchTerm}%`;
    let whereClause = 'WHERE (target_name ILIKE $1 OR recipient ILIKE $1)';
    const params = [searchPattern];
    let paramCount = 2;

    if (alertFamily) {
      whereClause += ` AND alert_family = $${paramCount}`;
      params.push(alertFamily);
      paramCount++;
    }

    const query = `
      SELECT * FROM ${this.alertDeliveriesTableName}
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount}
    `;

    params.push(limit);
    return await this.query(query, params);
  }

  /**
   * Clean up old sent/failed alerts
   */
  async cleanupOldAlerts(daysToKeep = 90) {
    const threshold = `${daysToKeep} days`;

    return await this.execute(
      `DELETE FROM ${this.alertDeliveriesTableName}
       WHERE status IN ('sent', 'failed')
       AND created_at < NOW() - INTERVAL '${threshold}'`
    );
  }
}

module.exports = { AlertsRepository };
