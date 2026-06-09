/**
 * Analytics Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles analytics and document metrics data access.
 * Provides PostgreSQL-based persistence to replace the SQLite analytics store.
 * Maintains interface compatibility with existing AnalyticsStore patterns.
 *
 * Phase 1: Create repository layer, do not change public routes
 * Phase 2: Add dual-write capability (SQLite + PostgreSQL)
 * Phase 3: Backfill existing data from analytics.sqlite
 * Phase 4: Read cutover to PostgreSQL
 *
 * Migration from: analytics_store.cjs with SQLite
 * Migration to: analytics_document_metrics table
 */

const { BaseRepository } = require('./base_repository.cjs');

class AnalyticsRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.analyticsTableName = 'analytics_document_metrics';
    this.documentsTableName = 'documents';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    // Verify tables exist
    const tablesExist = await this.tableExists(this.analyticsTableName);
    if (!tablesExist) {
      throw new Error('Analytics tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // Document Metrics Operations
  // ========================================

  /**
   * Create or update document metrics (compatible with AnalyticsStore.upsertMetrics)
   */
  async upsertMetrics(documentData) {
    const documentId = documentData.document_id;
    const now = new Date().toISOString();

    // First, let's check if metrics already exist
    const existing = await this.findMetricsByDocumentId(documentId);

    if (existing) {
      // Update existing metrics
      return await this.updateMetrics(documentId, documentData);
    } else {
      // Create new metrics
      return await this.createMetrics(documentData);
    }
  }

  /**
   * Create new document metrics
   */
  async createMetrics(documentData) {
    const documentId = documentData.document_id;
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.analyticsTableName} (
        document_id, document_name, document_type, processed_at, uploaded_at,
        gemma_tokens, gemma_cache_hit, transcript_takes, transcript_confidence,
        voice_review_items, voice_review_items_resolved, live_review_items, live_review_items_resolved,
        medications_count, diagnoses_count, lab_results_count, radiology_results_count,
        procedures_count, ordered_lab_count, ordered_radiology_count, ordered_medications_count,
        nuclear_medicine_count, has_occupational_therapy, has_dietary_recommendations,
        has_patient_education, metadata_jsonb, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      documentId,
      documentData.document_name,
      documentData.document_type || 'unknown',
      documentData.processed_at || null,
      documentData.uploaded_at || null,
      documentData.gemma_tokens || 0,
      documentData.gemma_cache_hit || false,
      documentData.transcript_takes || 0,
      documentData.transcript_confidence || null,
      documentData.voice_review_items || 0,
      documentData.voice_review_items_resolved || 0,
      documentData.live_review_items || 0,
      documentData.live_review_items_resolved || 0,
      documentData.medications_count || 0,
      documentData.diagnoses_count || 0,
      documentData.lab_results_count || 0,
      documentData.radiology_results_count || 0,
      documentData.procedures_count || 0,
      documentData.ordered_lab_count || 0,
      documentData.ordered_radiology_count || 0,
      documentData.ordered_medications_count || 0,
      documentData.nuclear_medicine_count || 0,
      documentData.has_occupational_therapy || false,
      documentData.has_dietary_recommendations || false,
      documentData.has_patient_education || false,
      this.toJSONB(documentData.metadata || {}),
      now
    ]);
  }

  /**
   * Update existing document metrics
   */
  async updateMetrics(documentId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    // Build dynamic UPDATE query
    const allowedFields = [
      'document_name', 'document_type', 'processed_at', 'uploaded_at',
      'gemma_tokens', 'gemma_cache_hit', 'transcript_takes', 'transcript_confidence',
      'voice_review_items', 'voice_review_items_resolved', 'live_review_items', 'live_review_items_resolved',
      'medications_count', 'diagnoses_count', 'lab_results_count', 'radiology_results_count',
      'procedures_count', 'ordered_lab_count', 'ordered_radiology_count', 'ordered_medications_count',
      'nuclear_medicine_count', 'has_occupational_therapy', 'has_dietary_recommendations',
      'has_patient_education', 'metadata_jsonb'
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field === 'metadata_jsonb') {
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
      return await this.findMetricsByDocumentId(documentId);
    }

    // Always update updated_at
    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date().toISOString());
    paramCount++;

    values.push(documentId); // WHERE clause

    const query = `
      UPDATE ${this.analyticsTableName}
      SET ${fields.join(', ')}
      WHERE document_id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * Find metrics by document ID
   */
  async findMetricsByDocumentId(documentId) {
    return await this.queryOne(
      `SELECT * FROM ${this.analyticsTableName} WHERE document_id = $1`,
      [documentId]
    );
  }

  /**
   * Get all metrics
   */
  async getAllMetrics(options = {}) {
    const {
      limit = null,
      offset = null,
      orderBy = 'updated_at DESC'
    } = options;

    let limitClause = '';
    let offsetClause = '';

    if (limit !== null) {
      limitClause = `LIMIT ${limit}`;
    }
    if (offset !== null) {
      offsetClause = `OFFSET ${offset}`;
    }

    const query = `
      SELECT * FROM ${this.analyticsTableName}
      ORDER BY ${orderBy}
      ${limitClause}
      ${offsetClause}
    `;

    return await this.query(query);
  }

  /**
   * Delete metrics by document ID
   */
  async deleteMetricsByDocumentId(documentId) {
    const result = await this.execute(
      `DELETE FROM ${this.analyticsTableName} WHERE document_id = $1`,
      [documentId]
    );
    return result > 0;
  }

  // ========================================
  // Analytics Query Operations
  // ========================================

  /**
   * Get metrics by document type
   */
  async getMetricsByDocumentType(documentType) {
    return await this.query(
      `SELECT * FROM ${this.analyticsTableName} WHERE document_type = $1 ORDER BY updated_at DESC`,
      [documentType]
    );
  }

  /**
   * Get metrics by date range
   */
  async getMetricsByDateRange(startDate, endDate) {
    return await this.query(
      `SELECT * FROM ${this.analyticsTableName}
       WHERE processed_at >= $1 AND processed_at <= $2
       ORDER BY processed_at DESC`,
      [startDate, endDate]
    );
  }

  /**
   * Get aggregated statistics
   */
  async getAggregatedStats(options = {}) {
    const {
      documentType = null,
      startDate = null,
      endDate = null
    } = options;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (documentType) {
      whereClause += ` AND document_type = $${params.length + 1}`;
      params.push(documentType);
    }

    if (startDate && endDate) {
      whereClause += ` AND processed_at >= $${params.length + 1} AND processed_at <= $${params.length + 2}`;
      params.push(startDate, endDate);
    }

    const query = `
      SELECT
        COUNT(*) as total_documents,
        COUNT(*) FILTER (WHERE document_type = 'prescription') as prescriptions,
        COUNT(*) FILTER (WHERE document_type = 'voice_dictation') as voice_dictations,
        COUNT(*) FILTER (WHERE document_type = 'live_conversation') as live_conversations,
        SUM(gemma_tokens) as total_gemma_tokens,
        SUM(transcript_takes) as total_transcript_takes,
        AVG(transcript_confidence) as avg_transcript_confidence,
        SUM(medications_count) as total_medications,
        SUM(diagnoses_count) as total_diagnoses,
        SUM(voice_review_items_resolved) as total_voice_resolved,
        SUM(live_review_items_resolved) as total_live_resolved
      FROM ${this.analyticsTableName}
      ${whereClause}
    `;

    const result = await this.queryOne(query, params);

    // Convert string/NULL results to proper types
    return {
      total_documents: parseInt(result.total_documents) || 0,
      prescriptions: parseInt(result.prescriptions) || 0,
      voice_dictations: parseInt(result.voice_dictations) || 0,
      live_conversations: parseInt(result.live_conversations) || 0,
      total_gemma_tokens: parseInt(result.total_gemma_tokens) || 0,
      total_transcript_takes: parseInt(result.total_transcript_takes) || 0,
      avg_transcript_confidence: result.avg_transcript_confidence || 0,
      total_medications: parseInt(result.total_medications) || 0,
      total_diagnoses: parseInt(result.total_diagnoses) || 0,
      total_voice_resolved: parseInt(result.total_voice_resolved) || 0,
      total_live_resolved: parseInt(result.total_live_resolved) || 0
    };
  }

  /**
   * Get processing insights by time period
   */
  async getProcessingInsights(options = {}) {
    const {
      groupBy = 'day', // 'day', 'week', 'month'
      startDate = null,
      endDate = null,
      documentType = null
    } = options;

    let dateFormat = '';
    if (groupBy === 'day') dateFormat = 'YYYY-MM-DD';
    else if (groupBy === 'week') dateFormat = 'YYYY-"W"';
    else if (groupBy === 'month') dateFormat = 'YYYY-MM';

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (startDate) {
      whereClause += ` AND processed_at >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND processed_at <= $${params.length + 1}`;
      params.push(endDate);
    }

    if (documentType) {
      whereClause += ` AND document_type = $${params.length + 1}`;
      params.push(documentType);
    }

    const query = `
      SELECT
        date_trunc('${dateFormat}', processed_at) as period,
        COUNT(*) as document_count,
        AVG(gemma_tokens) as avg_tokens,
        COUNT(*) FILTER (WHERE document_type = 'prescription') as prescription_count
      FROM ${this.analyticsTableName}
      ${whereClause}
      GROUP BY period
      ORDER BY period ASC
    `;

    return await this.query(query, params);
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Get repository statistics
   */
  async getStats() {
    const totalMetrics = await this.count(this.analyticsTableName);
    const byType = await this.query(`
      SELECT document_type, COUNT(*) as count
      FROM ${this.analyticsTableName}
      GROUP BY document_type
      ORDER BY count DESC
    `);

    return {
      totalMetrics,
      byType
    };
  }

  /**
   * Find stale metrics (metrics without corresponding documents)
   */
  async findStaleMetrics() {
    return await this.query(`
      SELECT am.* FROM ${this.analyticsTableName} am
      LEFT JOIN ${this.documentsTableName} d ON am.document_id = d.id
      WHERE d.id IS NULL
      ORDER BY am.updated_at DESC
    `);
  }

  /**
   * Clean up stale metrics
   */
  async cleanupStaleMetrics() {
    return await this.execute(`
      DELETE FROM ${this.analyticsTableName} am
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.documentsTableName} d WHERE d.id = am.document_id
      )
    `);
  }
}

module.exports = { AnalyticsRepository };