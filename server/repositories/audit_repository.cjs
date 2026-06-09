/**
 * Audit Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles audit run and audit event data access.
 * Provides PostgreSQL-based persistence for audit trail functionality.
 *
 * Related Tables:
 * - audit_runs (audit execution records)
 * - audit_events (individual events within an audit run)
 *
 * Phase 1: Create repository layer, do not change public routes
 * Phase 2: Add dual-write capability (JSON files + PostgreSQL)
 * Phase 3: Backfill existing data
 * Phase 4: Read cutover to PostgreSQL
 */

const { BaseRepository } = require('./base_repository.cjs');

class AuditRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.auditRunsTableName = 'audit_runs';
    this.auditEventsTableName = 'audit_events';
    this.documentsTableName = 'documents';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    // Verify tables exist
    const auditRunsExist = await this.tableExists(this.auditRunsTableName);
    if (!auditRunsExist) {
      throw new Error('Audit tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // Audit Run Operations
  // ========================================

  /**
   * Create audit run
   */
  async createAuditRun(auditRunData) {
    const id = auditRunData.id || this.generateId();
    const now = new Date().toISOString();
    const createdAt = auditRunData.created_at || now;

    const query = `
      INSERT INTO ${this.auditRunsTableName} (
        id, workflow, document_id, chat_session_id, request_id,
        actor_user_id, actor_label, status, title, metadata_jsonb,
        summary_jsonb, error_message, started_at, completed_at, duration_ms, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      auditRunData.workflow || 'document_processing',
      auditRunData.document_id || null,
      auditRunData.chat_session_id || null,
      auditRunData.request_id || null,
      auditRunData.actor_user_id || null,
      auditRunData.actor_label || null,
      auditRunData.status || 'in_progress',
      auditRunData.title || 'Document Audit',
      this.toJSONB(auditRunData.metadata || {}),
      this.toJSONB(auditRunData.summary || {}),
      auditRunData.error_message || null,
      auditRunData.started_at || now,
      auditRunData.completed_at || null,
      auditRunData.duration_ms || null,
      createdAt
    ]);
  }

  /**
   * Find audit run by ID
   */
  async findAuditRunById(auditRunId) {
    return await this.findById(this.auditRunsTableName, auditRunId);
  }

  /**
   * Find audit runs by document ID
   */
  async findAuditRunsByDocumentId(documentId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy = 'started_at DESC'
    } = options;

    return await this.query(
      `SELECT * FROM ${this.auditRunsTableName}
       WHERE document_id = $1
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [documentId, limit, offset]
    );
  }

  /**
   * Find latest audit run for document
   */
  async findLatestAuditRun(documentId) {
    return await this.queryOne(
      `SELECT * FROM ${this.auditRunsTableName}
       WHERE document_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [documentId]
    );
  }

  /**
   * Find audit runs by user ID
   */
  async findAuditRunsByUserId(userId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy = 'started_at DESC'
    } = options;

    return await this.query(
      `SELECT * FROM ${this.auditRunsTableName}
       WHERE actor_user_id = $1
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
  }

  /**
   * Find audit runs by status
   */
  async findAuditRunsByStatus(status) {
    return await this.query(
      `SELECT * FROM ${this.auditRunsTableName} WHERE status = $1 ORDER BY started_at DESC`,
      [status]
    );
  }

  /**
   * Update audit run
   */
  async updateAuditRun(auditRunId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = [
      'status', 'completed_at', 'duration_ms', 'summary_jsonb', 'error_message'
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
      return await this.findAuditRunById(auditRunId);
    }

    values.push(auditRunId);

    const query = `
      UPDATE ${this.auditRunsTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * Complete audit run
   */
  async completeAuditRun(auditRunId, summary, durationMs) {
    const now = new Date().toISOString();
    return await this.updateAuditRun(auditRunId, {
      status: 'completed',
      completed_at: now,
      duration_ms: durationMs,
      summary_jsonb: summary
    });
  }

  /**
   * Fail audit run
   */
  async failAuditRun(auditRunId, errorMessage) {
    const now = new Date().toISOString();
    return await this.updateAuditRun(auditRunId, {
      status: 'failed',
      completed_at: now,
      error_message: errorMessage
    });
  }

  /**
   * Delete audit run
   */
  async deleteAuditRun(auditRunId) {
    // This will cascade to audit_events due to FK constraints
    const result = await this.execute(
      `DELETE FROM ${this.auditRunsTableName} WHERE id = $1`,
      [auditRunId]
    );
    return result > 0;
  }

  /**
   * Get all audit runs
   */
  async getAllAuditRuns(options = {}) {
    const {
      limit = null,
      offset = 0,
      orderBy = 'started_at DESC'
    } = options;

    let limitClause = '';
    if (limit) {
      limitClause = `LIMIT ${limit}`;
    }

    return await this.query(
      `SELECT * FROM ${this.auditRunsTableName}
       ORDER BY ${orderBy}
       ${limitClause} OFFSET $1`,
      [offset]
    );
  }

  /**
   * Get all audit events for a specific audit run
   */
  async getAllAuditEventsByAuditRunId(auditRunId) {
    return await this.query(
      `SELECT * FROM ${this.auditEventsTableName} WHERE audit_run_id = $1 ORDER BY occurred_at ASC`,
      [auditRunId]
    );
  }

  // ========================================
  // Audit Event Operations
  // ========================================

  /**
   * Create audit event
   */
  async createAuditEvent(eventData) {
    const id = eventData.id || this.generateId();
    const now = new Date().toISOString();
    const createdAt = eventData.created_at || now;

    const query = `
      INSERT INTO ${this.auditEventsTableName} (
        id, audit_run_id, workflow, document_id, chat_session_id,
        event_type, status, title, details_jsonb, occurred_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      eventData.audit_run_id || null,
      eventData.workflow || null,
      eventData.document_id || null,
      eventData.chat_session_id || null,
      eventData.event_type || 'info',
      eventData.status || 'started',
      eventData.title || 'Audit Event',
      this.toJSONB(eventData.details || {}),
      eventData.occurred_at || now,
      createdAt
    ]);
  }

  /**
   * Find audit events by audit run ID
   */
  async findAuditEventsByAuditRunId(auditRunId) {
    return await this.query(
      `SELECT * FROM ${this.auditEventsTableName} WHERE audit_run_id = $1 ORDER BY occurred_at ASC`,
      [auditRunId]
    );
  }

  /**
   * Find audit events by document ID (through audit runs)
   */
  async findAuditEventsByDocumentId(documentId) {
    return await this.query(
      `SELECT ae.* FROM ${this.auditEventsTableName} ae
       INNER JOIN ${this.auditRunsTableName} ar ON ae.audit_run_id = ar.id
       WHERE ar.document_id = $1
       ORDER BY ae.occurred_at ASC`,
      [documentId]
    );
  }

  /**
   * Delete audit event
   */
  async deleteAuditEvent(eventId) {
    const result = await this.execute(
      `DELETE FROM ${this.auditEventsTableName} WHERE id = $1`,
      [eventId]
    );
    return result > 0;
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Get repository statistics
   */
  async getStats() {
    const totalRuns = await this.count(this.auditRunsTableName);
    const totalEvents = await this.count(this.auditEventsTableName);

    const runsByStatus = await this.query(`
      SELECT status, COUNT(*) as count
      FROM ${this.auditRunsTableName}
      GROUP BY status
      ORDER BY count DESC
    `);

    const eventsByType = await this.query(`
      SELECT event_type, COUNT(*) as count
      FROM ${this.auditEventsTableName}
      GROUP BY event_type
      ORDER BY count DESC
    `);

    return {
      totalRuns,
      totalEvents,
      runsByStatus,
      eventsByType
    };
  }

  /**
   * Get audit run with event count
   */
  async getAuditRunWithEventCount(auditRunId) {
    const query = `
      SELECT
        ar.*,
        COUNT(ae.id) as total_events
      FROM ${this.auditRunsTableName} ar
      LEFT JOIN ${this.auditEventsTableName} ae ON ar.id = ae.audit_run_id
      WHERE ar.id = $1
      GROUP BY ar.id
    `;

    return await this.queryOne(query, [auditRunId]);
  }

  /**
   * Search audit events
   */
  async searchAuditEvents(searchTerm, options = {}) {
    const {
      limit = 50
    } = options;

    const searchPattern = `%${searchTerm}%`;

    const query = `
      SELECT ae.*, ar.document_id
      FROM ${this.auditEventsTableName} ae
      INNER JOIN ${this.auditRunsTableName} ar ON ae.audit_run_id = ar.id
      WHERE (ae.title ILIKE $1 OR ae.event_type ILIKE $1)
      ORDER BY ae.occurred_at DESC
      LIMIT $2
    `;

    return await this.query(query, [searchPattern, limit]);
  }

  /**
   * Get audit insights by time period
   */
  async getAuditInsights(options = {}) {
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
      whereClause += ` AND ar.started_at >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND ar.started_at <= $${params.length + 1}`;
      params.push(endDate);
    }

    const query = `
      SELECT
        date_trunc('${dateFormat}', ar.started_at) as period,
        COUNT(DISTINCT ar.id) as audit_runs,
        COUNT(ae.id) as total_events,
        AVG(ar.duration_ms) as avg_duration_ms
      FROM ${this.auditRunsTableName} ar
      LEFT JOIN ${this.auditEventsTableName} ae ON ar.id = ae.audit_run_id
      ${whereClause}
      GROUP BY period
      ORDER BY period ASC
    `;

    return await this.query(query, params);
  }
}

module.exports = { AuditRepository };
