/**
 * Department Integrations Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles department integrations for inpatient journeys (lab, radiology, pharmacy, billing).
 * Manages external system communication and result processing.
 *
 * Related Tables:
 * - department_integrations (main table)
 * - inpatient_journeys (parent journeys)
 * - daily_progress_notes (linked notes)
 *
 * Features:
 * - Multiple department types (lab, radiology, pharmacy, billing)
 * - Order and result tracking
 * - External system communication
 * - Batch import/export operations
 * - Integration status monitoring
 * - Error handling and retry logic
 */

const { BaseRepository } = require('./base_repository.cjs');

class DepartmentIntegrationsRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.integrationsTableName = 'department_integrations';
    this.journeysTableName = 'inpatient_journeys';
    this.dailyNotesTableName = 'daily_progress_notes';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    const integrationsTableExists = await this.tableExists(this.integrationsTableName);
    if (!integrationsTableExists) {
      throw new Error('Department integrations tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // CRUD Operations
  // ========================================

  /**
   * Create a new department integration
   * @param {Object} integrationData - Integration creation data
   * @returns {Object} Created integration record
   */
  async createIntegration(integrationData) {
    const {
      id = this.generateId(),
      journey_id,
      daily_note_id = null,
      encounter_id,
      patient_id,
      integration_type,
      direction,
      external_order_id = null,
      external_result_id = null,
      order_payload_jsonb = {},
      result_payload_jsonb = {},
      normalized_payload_jsonb = {},
      status = 'pending',
      ordered_at = new Date().toISOString(),
      completed_at = null,
      error_message = null
    } = integrationData;

    const query = `
      INSERT INTO ${this.integrationsTableName} (
        id, journey_id, daily_note_id, encounter_id, patient_id,
        integration_type, direction, external_order_id, external_result_id,
        order_payload_jsonb, result_payload_jsonb, normalized_payload_jsonb,
        status, ordered_at, completed_at, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const result = await this.queryOne(query, [
      id, journey_id, daily_note_id, encounter_id, patient_id,
      integration_type, direction, external_order_id, external_result_id,
      this.toJSONB(order_payload_jsonb), this.toJSONB(result_payload_jsonb),
      this.toJSONB(normalized_payload_jsonb), status, ordered_at, completed_at, error_message
    ]);

    return result;
  }

  /**
   * Find integration by ID
   * @param {string} integrationId - Integration ID
   * @returns {Object|null} Integration record or null
   */
  async findIntegrationById(integrationId) {
    return await this.findById(this.integrationsTableName, integrationId);
  }

  /**
   * Find all integrations for a journey
   * @param {string} journeyId - Journey ID
   * @returns {Array} Array of integration records
   */
  async findIntegrationsByJourney(journeyId) {
    const query = `
      SELECT * FROM ${this.integrationsTableName}
      WHERE journey_id = $1
      ORDER BY ordered_at DESC, created_at DESC
    `;

    return await this.query(query, [journeyId]);
  }

  /**
   * Find integrations by patient and type
   * @param {string} patientId - Patient ID
   * @param {string} integrationType - Integration type filter
   * @returns {Array} Array of integration records
   */
  async findIntegrationsByType(patientId, integrationType = null) {
    let query = `
      SELECT * FROM ${this.integrationsTableName}
      WHERE patient_id = $1
    `;

    if (integrationType) {
      query += ` AND integration_type = $2`;
      query += ` ORDER BY ordered_at DESC`;
      return await this.query(query, [patientId, integrationType]);
    } else {
      query += ` ORDER BY ordered_at DESC`;
      return await this.query(query, [patientId]);
    }
  }

  /**
   * Update integration record
   * @param {string} integrationId - Integration ID
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated integration record
   */
  async updateIntegration(integrationId, updateData) {
    const allowedFields = [
      'external_order_id', 'external_result_id', 'order_payload_jsonb',
      'result_payload_jsonb', 'normalized_payload_jsonb', 'status',
      'completed_at', 'error_message'
    ];

    const updates = [];
    const values = [];
    let paramIndex = 1;

    Object.entries(updateData).forEach(([key, value]) => {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = $${paramIndex++}`);
        values.push(key.includes('jsonb') ? this.toJSONB(value) : value);
      }
    });

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(integrationId);

    const query = `
      UPDATE ${this.integrationsTableName}
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.queryOne(query, values);
    return result;
  }

  /**
   * Update integration status (for workflow automation)
   * @param {string} integrationId - Integration ID
   * @param {string} newStatus - New status value
   * @param {Object} resultData - Result-specific data
   * @returns {Object} Updated integration record
   */
  async updateIntegrationStatus(integrationId, newStatus, resultData = {}) {
    const updates = ['status = $2', 'updated_at = NOW()'];
    const values = [integrationId, newStatus];
    let paramIndex = 3;

    // Handle status-specific data
    if (newStatus === 'completed' || newStatus === 'received') {
      if (resultData.completed_at) {
        updates.push(`completed_at = $${paramIndex++}`);
        values.push(resultData.completed_at);
      } else {
        updates.push(`completed_at = NOW()`);
      }
      if (resultData.result_payload_jsonb) {
        updates.push(`result_payload_jsonb = $${paramIndex++}`);
        values.push(this.toJSONB(resultData.result_payload_jsonb));
      }
      if (resultData.normalized_payload_jsonb) {
        updates.push(`normalized_payload_jsonb = $${paramIndex++}`);
        values.push(this.toJSONB(resultData.normalized_payload_jsonb));
      }
      if (resultData.external_result_id) {
        updates.push(`external_result_id = $${paramIndex++}`);
        values.push(resultData.external_result_id);
      }
    }

    if (newStatus === 'failed' && resultData.error_message) {
      updates.push(`error_message = $${paramIndex++}`);
      values.push(resultData.error_message);
    }

    const query = `
      UPDATE ${this.integrationsTableName}
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.queryOne(query, values);
    return result;
  }

  /**
   * Soft delete integration (with audit trail)
   * @param {string} integrationId - Integration ID
   * @returns {boolean} Success status
   */
  async deleteIntegration(integrationId) {
    // Mark as failed with deletion reason instead of hard delete
    const result = await this.updateIntegrationStatus(integrationId, 'failed', {
      error_message: 'Integration deleted by user',
      completed_at: new Date().toISOString()
    });

    return !!result;
  }

  // ========================================
  // Department-Specific Queries
  // ========================================

  /**
   * Find pending integrations
   * @param {Object} filters - Filter criteria
   * @returns {Array} Array of pending integration records
   */
  async findPendingIntegrations(filters = {}) {
    const {
      integration_type = null,
      direction = null,
      limit = 100
    } = filters;

    let query = `
      SELECT i.*, j.current_ward, p.name as patient_name
      FROM ${this.integrationsTableName} i
      JOIN ${this.journeysTableName} j ON i.journey_id = j.id
      JOIN patients p ON i.patient_id = p.id
      WHERE i.status = 'pending'
    `;

    const params = [];
    let paramIndex = 1;

    if (integration_type) {
      query += ` AND i.integration_type = $${paramIndex++}`;
      params.push(integration_type);
    }

    if (direction) {
      query += ` AND i.direction = $${paramIndex++}`;
      params.push(direction);
    }

    query += ` ORDER BY i.ordered_at ASC LIMIT $${paramIndex++}`;
    params.push(limit);

    return await this.query(query, params);
  }

  /**
   * Find pending integrations by department type
   * @param {string} departmentType - Department type (lab, radiology, pharmacy, billing)
   * @param {string} direction - Direction filter (inbound/outbound)
   * @returns {Array} Array of pending integration records
   */
  async findPendingIntegrationsByType(departmentType, direction = null) {
    let query = `
      SELECT i.*, j.current_ward
      FROM ${this.integrationsTableName} i
      JOIN ${this.journeysTableName} j ON i.journey_id = j.id
      WHERE i.status = 'pending'
      AND i.integration_type = $1
    `;

    const params = [departmentType];
    let paramIndex = 2;

    if (direction) {
      query += ` AND i.direction = $${paramIndex++}`;
      params.push(direction);
    }

    query += ` ORDER BY i.ordered_at ASC`;

    return await this.query(query, params);
  }

  /**
   * Find failed integrations for retry
   * @param {Object} filters - Filter criteria
   * @returns {Array} Array of failed integration records
   */
  async findFailedIntegrations(filters = {}) {
    const {
      integration_type = null,
      retry_after = null, // ISO date string
      limit = 50
    } = filters;

    let query = `
      SELECT i.*, j.current_ward
      FROM ${this.integrationsTableName} i
      JOIN ${this.journeysTableName} j ON i.journey_id = j.id
      WHERE i.status = 'failed'
    `;

    const params = [];
    let paramIndex = 1;

    if (integration_type) {
      query += ` AND i.integration_type = $${paramIndex++}`;
      params.push(integration_type);
    }

    if (retry_after) {
      query += ` AND i.updated_at >= $${paramIndex++}`;
      params.push(retry_after);
    }

    query += ` ORDER BY i.updated_at DESC LIMIT $${paramIndex++}`;
    params.push(limit);

    return await this.query(query, params);
  }

  /**
   * Find completed integrations by date range
   * @param {string} startDate - Start date ISO string
   * @param {string} endDate - End date ISO string
   * @param {Object} filters - Additional filters
   * @returns {Array} Array of completed integration records
   */
  async findCompletedIntegrationsByDateRange(startDate, endDate, filters = {}) {
    const {
      integration_type = null,
      patient_id = null
    } = filters;

    let query = `
      SELECT i.*, j.current_ward
      FROM ${this.integrationsTableName} i
      JOIN ${this.journeysTableName} j ON i.journey_id = j.id
      WHERE i.status IN ('completed', 'received')
      AND i.completed_at >= $1 AND i.completed_at <= $2
    `;

    const params = [startDate, endDate];
    let paramIndex = 3;

    if (integration_type) {
      query += ` AND i.integration_type = $${paramIndex++}`;
      params.push(integration_type);
    }

    if (patient_id) {
      query += ` AND i.patient_id = $${paramIndex++}`;
      params.push(patient_id);
    }

    query += ` ORDER BY i.completed_at DESC`;

    return await this.query(query, params);
  }

  // ========================================
  // Batch Operations
  // ========================================

  /**
   * Batch create integrations
   * @param {Array} integrationsArray - Array of integration data objects
   * @returns {Array} Array of created integration records
   */
  async batchCreateIntegrations(integrationsArray) {
    if (!integrationsArray || integrationsArray.length === 0) {
      return [];
    }

    return await this.transaction(async (transactionClient) => {
      const createdIntegrations = [];

      for (const integrationData of integrationsArray) {
        const {
          id = this.generateId(),
          journey_id,
          daily_note_id = null,
          encounter_id,
          patient_id,
          integration_type,
          direction,
          external_order_id = null,
          external_result_id = null,
          order_payload_jsonb = {},
          result_payload_jsonb = {},
          normalized_payload_jsonb = {},
          status = 'pending',
          ordered_at = new Date().toISOString(),
          completed_at = null,
          error_message = null
        } = integrationData;

        const result = await transactionClient.queryOne(`
          INSERT INTO ${this.integrationsTableName} (
            id, journey_id, daily_note_id, encounter_id, patient_id,
            integration_type, direction, external_order_id, external_result_id,
            order_payload_jsonb, result_payload_jsonb, normalized_payload_jsonb,
            status, ordered_at, completed_at, error_message
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING *
        `, [
          id, journey_id, daily_note_id, encounter_id, patient_id,
          integration_type, direction, external_order_id, external_result_id,
          this.toJSONB(order_payload_jsonb), this.toJSONB(result_payload_jsonb),
          this.toJSONB(normalized_payload_jsonb), status, ordered_at, completed_at, error_message
        ]);

        createdIntegrations.push(result);
      }

      return createdIntegrations;
    });
  }

  /**
   * Batch update integration statuses
   * @param {Array} integrationIds - Array of integration IDs
   * @param {string} newStatus - New status value
   * @param {Object} resultData - Result-specific data
   * @returns {number} Number of integrations updated
   */
  async batchUpdateStatus(integrationIds, newStatus, resultData = {}) {
    if (!integrationIds || integrationIds.length === 0) {
      return 0;
    }

    let query = `
      UPDATE ${this.integrationsTableName}
      SET status = $2, updated_at = NOW()
    `;

    const params = [newStatus];
    let paramIndex = 3;

    if (newStatus === 'completed' || newStatus === 'received') {
      if (resultData.completed_at) {
        query += `, completed_at = $${paramIndex++}`;
        params.push(resultData.completed_at);
      } else {
        query += `, completed_at = NOW()`;
      }

      if (resultData.result_payload_jsonb) {
        query += `, result_payload_jsonb = $${paramIndex++}`;
        params.push(this.toJSONB(resultData.result_payload_jsonb));
      }

      if (resultData.normalized_payload_jsonb) {
        query += `, normalized_payload_jsonb = $${paramIndex++}`;
        params.push(this.toJSONB(resultData.normalized_payload_jsonb));
      }
    }

    if (newStatus === 'failed' && resultData.error_message) {
      query += `, error_message = $${paramIndex++}`;
      params.push(resultData.error_message);
    }

    query += ` WHERE id = ANY($1)`;

    params.push(integrationIds);

    const result = await this.execute(query, params);
    return result;
  }

  /**
   * Batch retry failed integrations
   * @param {Array} integrationIds - Array of integration IDs to retry
   * @returns {Array} Array of updated integration records
   */
  async batchRetryIntegrations(integrationIds) {
    if (!integrationIds || integrationIds.length === 0) {
      return [];
    }

    const query = `
      UPDATE ${this.integrationsTableName}
      SET status = 'pending',
          error_message = NULL,
          updated_at = NOW()
      WHERE id = ANY($1) AND status = 'failed'
      RETURNING *
    `;

    return await this.query(query, [integrationIds]);
  }

  // ========================================
  // Integration Monitoring
  // ========================================

  /**
   * Get integration statistics
   * @param {Object} filters - Statistic filters
   * @returns {Object} Integration statistics
   */
  async getIntegrationStats(filters = {}) {
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (filters.integration_type) {
      whereClause += ` AND integration_type = $${paramIndex++}`;
      params.push(filters.integration_type);
    }

    if (filters.patient_id) {
      whereClause += ` AND patient_id = $${paramIndex++}`;
      params.push(filters.patient_id);
    }

    if (filters.journey_id) {
      whereClause += ` AND journey_id = $${paramIndex++}`;
      params.push(filters.journey_id);
    }

    if (filters.date_from) {
      whereClause += ` AND created_at >= $${paramIndex++}`;
      params.push(filters.date_from);
    }

    if (filters.date_to) {
      whereClause += ` AND created_at <= $${paramIndex++}`;
      params.push(filters.date_to);
    }

    const query = `
      SELECT
        COUNT(*) as total_integrations,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
        COUNT(*) FILTER (WHERE status = 'received') as received_count,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
        COUNT(*) FILTER (WHERE integration_type = 'lab') as lab_count,
        COUNT(*) FILTER (WHERE integration_type = 'radiology') as radiology_count,
        COUNT(*) FILTER (WHERE integration_type = 'pharmacy') as pharmacy_count,
        COUNT(*) FILTER (WHERE integration_type = 'billing') as billing_count,
        COUNT(*) FILTER (WHERE direction = 'outbound') as outbound_count,
        COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_count
      FROM ${this.integrationsTableName}
      ${whereClause}
    `;

    const result = await this.queryOne(query, params);
    return result;
  }

  /**
   * Get integration errors for monitoring
   * @param {Object} filters - Error filter criteria
   * @returns {Array} Array of failed integration records
   */
  async getIntegrationErrors(filters = {}) {
    const {
      integration_type = null,
      limit = 50,
      offset = 0
    } = filters;

    let query = `
      SELECT i.*, j.current_ward
      FROM ${this.integrationsTableName} i
      JOIN ${this.journeysTableName} j ON i.journey_id = j.id
      WHERE i.status = 'failed'
      AND i.error_message IS NOT NULL
    `;

    const params = [];
    let paramIndex = 1;

    if (integration_type) {
      query += ` AND i.integration_type = $${paramIndex++}`;
      params.push(integration_type);
    }

    query += ` ORDER BY i.updated_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    return await this.query(query, params);
  }

  /**
   * Get integrations by daily note
   * @param {string} dailyNoteId - Daily note ID
   * @returns {Array} Array of integration records
   */
  async findIntegrationsByDailyNote(dailyNoteId) {
    const query = `
      SELECT * FROM ${this.integrationsTableName}
      WHERE daily_note_id = $1
      ORDER BY integration_type, ordered_at DESC
    `;

    return await this.query(query, [dailyNoteId]);
  }

  /**
   * Get integration status overview for a journey
   * @param {string} journeyId - Journey ID
   * @returns {Object} Integration status summary
   */
  async getJourneyIntegrationStatus(journeyId) {
    const query = `
      SELECT
        integration_type,
        status,
        COUNT(*) as count,
        MAX(ordered_at) as last_ordered,
        MAX(completed_at) as last_completed
      FROM ${this.integrationsTableName}
      WHERE journey_id = $1
      GROUP BY integration_type, status
      ORDER BY integration_type, status
    `;

    const results = await this.query(query, [journeyId]);

    // Organize by department type
    const summary = {
      lab: { pending: 0, sent: 0, received: 0, completed: 0, failed: 0, total: 0 },
      radiology: { pending: 0, sent: 0, received: 0, completed: 0, failed: 0, total: 0 },
      pharmacy: { pending: 0, sent: 0, received: 0, completed: 0, failed: 0, total: 0 },
      billing: { pending: 0, sent: 0, received: 0, completed: 0, failed: 0, total: 0 }
    };

    results.forEach(result => {
      const dept = summary[result.integration_type];
      if (dept) {
        dept[result.status] = result.count;
        dept.total += result.count;
        dept.last_ordered = result.last_ordered;
        dept.last_completed = result.last_completed;
      }
    });

    return summary;
  }

  // ========================================
  // Search and Filter Operations
  // ========================================

  /**
   * Search integrations by multiple criteria
   * @param {Object} searchCriteria - Search parameters
   * @returns {Array} Array of matching integration records
   */
  async searchIntegrations(searchCriteria) {
    const {
      patient_id,
      journey_id,
      integration_type,
      status,
      direction,
      external_order_id,
      date_from,
      date_to,
      limit = 50,
      offset = 0
    } = searchCriteria;

    let conditions = [];
    let params = [];
    let paramIndex = 1;

    if (patient_id) {
      conditions.push(`patient_id = $${paramIndex++}`);
      params.push(patient_id);
    }

    if (journey_id) {
      conditions.push(`journey_id = $${paramIndex++}`);
      params.push(journey_id);
    }

    if (integration_type) {
      conditions.push(`integration_type = $${paramIndex++}`);
      params.push(integration_type);
    }

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (direction) {
      conditions.push(`direction = $${paramIndex++}`);
      params.push(direction);
    }

    if (external_order_id) {
      conditions.push(`external_order_id = $${paramIndex++}`);
      params.push(external_order_id);
    }

    if (date_from) {
      conditions.push(`ordered_at >= $${paramIndex++}`);
      params.push(date_from);
    }

    if (date_to) {
      conditions.push(`ordered_at <= $${paramIndex++}`);
      params.push(date_to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT * FROM ${this.integrationsTableName}
      ${whereClause}
      ORDER BY ordered_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(limit, offset);

    return await this.query(query, params);
  }

  /**
   * Get integrations requiring attention (pending long time, failed, etc.)
   * @param {Object} criteria - Attention criteria
   * @returns {Array} Array of integrations needing attention
   */
  async getIntegrationsRequiringAttention(criteria = {}) {
    const {
      pending_hours = 4, // Pending longer than this
      failed_recently_hours = 24, // Failed in this timeframe
      limit = 100
    } = criteria;

    let queries = [];

    // Long pending integrations
    if (pending_hours > 0) {
      queries.push(`
        SELECT *, 'long_pending' as attention_reason
        FROM ${this.integrationsTableName}
        WHERE status = 'pending'
        AND ordered_at < NOW() - INTERVAL '${pending_hours} hours'
        ORDER BY ordered_at ASC
      `);
    }

    // Recently failed integrations
    if (failed_recently_hours > 0) {
      queries.push(`
        SELECT *, 'recently_failed' as attention_reason
        FROM ${this.integrationsTableName}
        WHERE status = 'failed'
        AND updated_at >= NOW() - INTERVAL '${failed_recently_hours} hours'
        ORDER BY updated_at DESC
      `);
    }

    // Execute all queries and combine results
    const results = [];
    for (const query of queries) {
      const integrationResults = await this.query(query);
      results.push(...integrationResults);
    }

    // Remove duplicates and limit
    const uniqueIntegrations = Array.from(
      new Map(results.map(integration => [integration.id, integration])).values()
    );

    return uniqueIntegrations.slice(0, limit);
  }

  /**
   * Health check with integration-specific metrics
   * @returns {Object} Health status and metrics
   */
  async healthCheck() {
    try {
      const baseHealth = await super.healthCheck();

      if (baseHealth.status !== 'healthy') {
        return baseHealth;
      }

      // Add integration-specific metrics
      const stats = await this.getIntegrationStats();

      return {
        ...baseHealth,
        metrics: {
          total_integrations: parseInt(stats.total_integrations),
          pending_count: parseInt(stats.pending_count),
          failed_count: parseInt(stats.failed_count),
          completed_count: parseInt(stats.completed_count),
          database_connected: baseHealth.connected
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        connected: false,
        error: error.message
      };
    }
  }
}

module.exports = { DepartmentIntegrationsRepository };