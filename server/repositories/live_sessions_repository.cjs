/**
 * Live Sessions Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles live conversation session data access.
 * Provides PostgreSQL-based persistence for real-time conversation sessions.
 *
 * Related Tables:
 * - live_conversation_sessions (session-level data)
 *
 * Phase 1: Create repository layer, do not change public routes
 * Phase 2: Add dual-write capability (JSON files + PostgreSQL)
 * Phase 3: Backfill existing data from live_conversation_sessions.json
 * Phase 4: Read cutover to PostgreSQL
 */

const { BaseRepository } = require('./base_repository.cjs');

class LiveSessionsRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.sessionsTableName = 'live_conversation_sessions';
    this.documentsTableName = 'documents';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    // Verify tables exist
    const sessionsExist = await this.tableExists(this.sessionsTableName);
    if (!sessionsExist) {
      throw new Error('Live sessions tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // Session Operations
  // ========================================

  /**
   * Create live conversation session
   */
  async createSession(sessionData) {
    const id = sessionData.id || this.generateId();
    const now = new Date().toISOString();
    const createdAt = sessionData.created_at || now;
    const updatedAt = sessionData.updated_at || now;
    const transportState = sessionData.transport_state_jsonb ?? sessionData.transport_state ?? {};
    const draftExtraction = sessionData.draft_extraction_jsonb ?? sessionData.draft_extraction ?? {};
    const startedAt = sessionData.started_at ?? null;

    const query = `
      INSERT INTO ${this.sessionsTableName} (
        id, created_by_user_id, patient_id, encounter_id, status,
        linked_patient_label, encounter_label, document_id, duration_ms,
        transport_state_jsonb, draft_extraction_jsonb, current_transcript_id,
        started_at, ended_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      sessionData.created_by_user_id,
      sessionData.patient_id || null,
      sessionData.encounter_id || null,
      sessionData.status || 'active',
      sessionData.linked_patient_label || null,
      sessionData.encounter_label || null,
      sessionData.document_id || null,
      sessionData.duration_ms || null,
      this.toJSONB(transportState),
      this.toJSONB(draftExtraction),
      sessionData.current_transcript_id || null,
      startedAt,
      sessionData.ended_at || null,
      createdAt,
      updatedAt
    ]);
  }

  /**
   * Find session by ID
   */
  async findSessionById(sessionId) {
    return await this.findById(this.sessionsTableName, sessionId);
  }

  /**
   * Find active sessions
   */
  async findActiveSessions() {
    return await this.query(
      `SELECT * FROM ${this.sessionsTableName} WHERE status = 'active' ORDER BY started_at DESC`
    );
  }

  /**
   * Find sessions by user ID
   */
  async findSessionsByUserId(userId) {
    return await this.query(
      `SELECT * FROM ${this.sessionsTableName} WHERE created_by_user_id = $1 ORDER BY started_at DESC`,
      [userId]
    );
  }

  /**
   * Find sessions by patient ID
   */
  async findSessionsByPatientId(patientId) {
    return await this.query(
      `SELECT * FROM ${this.sessionsTableName} WHERE patient_id = $1 ORDER BY started_at DESC`,
      [patientId]
    );
  }

  /**
   * Find sessions by encounter ID
   */
  async findSessionsByEncounterId(encounterId) {
    return await this.query(
      `SELECT * FROM ${this.sessionsTableName} WHERE encounter_id = $1 ORDER BY started_at DESC`,
      [encounterId]
    );
  }

  /**
   * Update session
   */
  async updateSession(sessionId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = [
      'status', 'patient_id', 'encounter_id', 'linked_patient_label', 'encounter_label',
      'document_id', 'duration_ms', 'transport_state_jsonb', 'draft_extraction_jsonb',
      'current_transcript_id', 'started_at', 'ended_at'
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
      return await this.findSessionById(sessionId);
    }

    // Always update updated_at
    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date().toISOString());
    paramCount++;

    values.push(sessionId);

    const query = `
      UPDATE ${this.sessionsTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * End session
   */
  async endSession(sessionId, durationMs = null) {
    const now = new Date().toISOString();
    return await this.updateSession(sessionId, {
      status: 'ended',
      ended_at: now,
      duration_ms: durationMs
    });
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId) {
    const result = await this.execute(
      `DELETE FROM ${this.sessionsTableName} WHERE id = $1`,
      [sessionId]
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
    const totalSessions = await this.count(this.sessionsTableName);
    const activeSessions = await this.count(this.sessionsTableName, { status: 'active' });

    return {
      totalSessions,
      activeSessions
    };
  }

  /**
   * Get session duration statistics
   */
  async getSessionDurationStats(options = {}) {
    const {
      startDate = null,
      endDate = null
    } = options;

    let whereClause = 'WHERE ended_at IS NOT NULL AND duration_ms IS NOT NULL';
    const params = [];
    let paramCount = 1;

    if (startDate) {
      whereClause += ` AND started_at >= $${paramCount}`;
      params.push(startDate);
      paramCount++;
    }

    if (endDate) {
      whereClause += ` AND ended_at <= $${paramCount}`;
      params.push(endDate);
      paramCount++;
    }

    const query = `
      SELECT
        COUNT(*) as total_sessions,
        AVG(duration_ms) as avg_duration_ms,
        MIN(duration_ms) as min_duration_ms,
        MAX(duration_ms) as max_duration_ms
      FROM ${this.sessionsTableName}
      ${whereClause}
    `;

    const result = await this.queryOne(query, params);

    return {
      totalSessions: parseInt(result.total_sessions) || 0,
      avgDurationMs: parseFloat(result.avg_duration_ms) || 0,
      minDurationMs: result.min_duration_ms || null,
      maxDurationMs: result.max_duration_ms || null
    };
  }

  /**
   * Find long-running sessions
   */
  async findLongRunningSessions(thresholdMinutes = 60) {
    const threshold = `${thresholdMinutes} minutes`;

    return await this.query(
      `SELECT * FROM ${this.sessionsTableName}
       WHERE status = 'active'
       AND started_at < NOW() - INTERVAL '${threshold}'
       ORDER BY started_at ASC`
    );
  }

  /**
   * Clean up old ended sessions
   */
  async cleanupOldSessions(daysToKeep = 90) {
    const threshold = `${daysToKeep} days`;

    return await this.execute(
      `DELETE FROM ${this.sessionsTableName}
       WHERE status = 'ended'
       AND ended_at < NOW() - INTERVAL '${threshold}'`
    );
  }
}

module.exports = { LiveSessionsRepository };
