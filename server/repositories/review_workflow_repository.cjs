/**
 * Review Workflow Repository - Phase 3C Repository Addition
 *
 * Handles review items and review item resolutions data access.
 * Provides PostgreSQL-based persistence for review workflow functionality.
 *
 * Related Tables:
 * - review_items (current review state for documents and live sessions)
 * - review_item_resolutions (append-only resolution history)
 *
 * Created for: Phase 3C backfill contract requirement
 * "There is currently no dedicated repository for review_items or review_item_resolutions"
 *
 * Phase 3C: Create repository layer for review backfill
 */

const { BaseRepository } = require('./base_repository.cjs');

class ReviewWorkflowRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.reviewItemsTableName = 'review_items';
    this.reviewItemResolutionsTableName = 'review_item_resolutions';
    this.documentsTableName = 'documents';
    this.liveSessionsTableName = 'live_conversation_sessions';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    // Verify tables exist
    const reviewItemsExist = await this.tableExists(this.reviewItemsTableName);
    if (!reviewItemsExist) {
      throw new Error('Review workflow tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // Review Item Operations
  // ========================================

  /**
   * Create review item
   */
  async createReviewItem(reviewItemData) {
    const id = reviewItemData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.reviewItemsTableName} (
        id, document_id, live_session_id, transcript_id, category, severity,
        reason_code, title, field_path, required_flag, provenance_text,
        provenance_range_jsonb, extracted_value_jsonb, suggested_value_jsonb,
        current_resolution, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      reviewItemData.document_id || null,
      reviewItemData.live_session_id || null,
      reviewItemData.transcript_id || null,
      reviewItemData.category,
      reviewItemData.severity,
      reviewItemData.reason_code || null,
      reviewItemData.title,
      reviewItemData.field_path || null,
      reviewItemData.required_flag !== undefined ? reviewItemData.required_flag : false,
      reviewItemData.provenance_text || null,
      this.toJSONB(reviewItemData.provenance_range || {}),
      this.toJSONB(reviewItemData.extracted_value || {}),
      this.toJSONB(reviewItemData.suggested_value || {}),
      reviewItemData.current_resolution || 'pending',
      now,
      now
    ]);
  }

  /**
   * Create multiple review items in batch
   */
  async createReviewItemsBatch(reviewItemsArray) {
    const results = {
      created: 0,
      failed: 0,
      errors: []
    };

    for (const reviewItem of reviewItemsArray) {
      try {
        await this.createReviewItem(reviewItem);
        results.created++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          id: reviewItem.id || 'unknown',
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Find review item by ID
   */
  async findReviewItemById(itemId) {
    return await this.findById(this.reviewItemsTableName, itemId);
  }

  /**
   * Find review items by document ID
   */
  async findReviewItemsByDocumentId(documentId) {
    return await this.query(
      `SELECT * FROM ${this.reviewItemsTableName} WHERE document_id = $1 ORDER BY created_at ASC`,
      [documentId]
    );
  }

  /**
   * Find review items by live session ID
   */
  async findReviewItemsByLiveSessionId(sessionId) {
    return await this.query(
      `SELECT * FROM ${this.reviewItemsTableName} WHERE live_session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    );
  }

  /**
   * Find review items by transcript ID
   */
  async findReviewItemsByTranscriptId(transcriptId) {
    return await this.query(
      `SELECT * FROM ${this.reviewItemsTableName} WHERE transcript_id = $1 ORDER BY created_at ASC`,
      [transcriptId]
    );
  }

  /**
   * Find review items by resolution status
   */
  async findReviewItemsByResolution(resolution) {
    return await this.query(
      `SELECT * FROM ${this.reviewItemsTableName} WHERE current_resolution = $1 ORDER BY created_at ASC`,
      [resolution]
    );
  }

  /**
   * Update review item current resolution
   */
  async updateReviewItemResolution(itemId, resolution, editedValue = null) {
    const now = new Date().toISOString();

    const query = `
      UPDATE ${this.reviewItemsTableName}
      SET current_resolution = $1,
          updated_at = $2
      WHERE id = $3
      RETURNING *
    `;

    return await this.queryOne(query, [resolution, now, itemId]);
  }

  // ========================================
  // Review Item Resolution Operations
  // ========================================

  /**
   * Create review item resolution (append-only history)
   */
  async createReviewItemResolution(resolutionData) {
    const id = resolutionData.id || this.generateId();
    const now = new Date().toISOString();
    const createdAt = resolutionData.created_at || now;

    const query = `
      INSERT INTO ${this.reviewItemResolutionsTableName} (
        id, review_item_id, resolved_by_user_id, resolution,
        edited_value_jsonb, notes, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      resolutionData.review_item_id,
      resolutionData.resolved_by_user_id || null,
      resolutionData.resolution,
      this.toJSONB(resolutionData.edited_value || {}),
      resolutionData.notes || null,
      createdAt
    ]);
  }

  /**
   * Create multiple review item resolutions in batch
   */
  async createReviewItemResolutionsBatch(resolutionsArray) {
    const results = {
      created: 0,
      failed: 0,
      errors: []
    };

    for (const resolution of resolutionsArray) {
      try {
        await this.createReviewItemResolution(resolution);
        results.created++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          id: resolution.id || 'unknown',
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Find review item resolution by ID
   */
  async findReviewItemResolutionById(resolutionId) {
    return await this.findById(this.reviewItemResolutionsTableName, resolutionId);
  }

  /**
   * Find review item resolutions by review item ID
   */
  async findReviewItemResolutionsByReviewItemId(reviewItemId) {
    return await this.query(
      `SELECT * FROM ${this.reviewItemResolutionsTableName}
       WHERE review_item_id = $1
       ORDER BY created_at ASC`,
      [reviewItemId]
    );
  }

  /**
   * Find review item resolutions by resolved user ID
   */
  async findReviewItemResolutionsByResolvedByUserId(userId) {
    return await this.query(
      `SELECT * FROM ${this.reviewItemResolutionsTableName}
       WHERE resolved_by_user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
  }

  /**
   * Count review items by resolution status
   */
  async countReviewItemsByResolution(filters = {}) {
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (filters.document_id) {
      whereClause += ` AND document_id = $${paramIndex++}`;
      params.push(filters.document_id);
    }

    if (filters.live_session_id) {
      whereClause += ` AND live_session_id = $${paramIndex++}`;
      params.push(filters.live_session_id);
    }

    const query = `
      SELECT
        current_resolution,
        COUNT(*) as count
      FROM ${this.reviewItemsTableName}
      ${whereClause}
      GROUP BY current_resolution
    `;

    return await this.query(query, params);
  }

  /**
   * Get review workflow statistics
   */
  async getReviewWorkflowStats() {
    const query = `
      SELECT
        (SELECT COUNT(*) FROM ${this.reviewItemsTableName}) as total_review_items,
        (SELECT COUNT(*) FROM ${this.reviewItemsTableName} WHERE current_resolution = 'pending') as pending_items,
        (SELECT COUNT(*) FROM ${this.reviewItemsTableName} WHERE current_resolution != 'pending') as resolved_items,
        (SELECT COUNT(*) FROM ${this.reviewItemResolutionsTableName}) as total_resolutions
    `;

    return await this.queryOne(query);
  }
}

module.exports = { ReviewWorkflowRepository };
