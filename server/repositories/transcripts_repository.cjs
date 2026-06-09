/**
 * Transcripts Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles transcript and transcript segment data access.
 * Provides PostgreSQL-based persistence for voice dictation and live conversation transcripts.
 *
 * Related Tables:
 * - transcripts (transcript-level data)
 * - transcript_segments (time-based segments)
 *
 * Phase 1: Create repository layer, do not change public routes
 * Phase 2: Add dual-write capability (JSON files + PostgreSQL)
 * Phase 3: Backfill existing data from voice_sessions.json and live_conversation_sessions.json
 * Phase 4: Read cutover to PostgreSQL
 */

const { BaseRepository } = require('./base_repository.cjs');

class TranscriptsRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.transcriptsTableName = 'transcripts';
    this.transcriptSegmentsTableName = 'transcript_segments';
    this.documentsTableName = 'documents';
    this.liveSessionsTableName = 'live_conversation_sessions';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    // Verify tables exist
    const transcriptsExist = await this.tableExists(this.transcriptsTableName);
    if (!transcriptsExist) {
      throw new Error('Transcript tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // Transcript Operations
  // ========================================

  /**
   * Create transcript
   */
  async createTranscript(transcriptData) {
    const id = transcriptData.id || this.generateId();
    const now = new Date().toISOString();
    const createdAt = transcriptData.created_at || now;

    const query = `
      INSERT INTO ${this.transcriptsTableName} (
        id, document_id, live_session_id, backend, language_code,
        raw_text, normalized_text, quality_jsonb, transcript_jsonb, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      transcriptData.document_id || null,
      transcriptData.live_session_id || null,
      transcriptData.backend || null,
      transcriptData.language_code || null,
      transcriptData.raw_text || null,
      transcriptData.normalized_text || null,
      this.toJSONB(transcriptData.quality || {}),
      this.toJSONB(transcriptData.transcript || {}),
      createdAt
    ]);
  }

  /**
   * Find transcript by ID
   */
  async findTranscriptById(transcriptId) {
    return await this.findById(this.transcriptsTableName, transcriptId);
  }

  /**
   * Find transcripts by document ID
   */
  async findTranscriptsByDocumentId(documentId) {
    return await this.query(
      `SELECT * FROM ${this.transcriptsTableName} WHERE document_id = $1 ORDER BY created_at DESC`,
      [documentId]
    );
  }

  /**
   * Find transcripts by live session ID
   */
  async findTranscriptsByLiveSessionId(sessionId) {
    return await this.query(
      `SELECT * FROM ${this.transcriptsTableName} WHERE live_session_id = $1 ORDER BY created_at DESC`,
      [sessionId]
    );
  }

  /**
   * Find current transcript for document
   */
  async findCurrentTranscript(documentId) {
    const document = await this.findById(this.documentsTableName, documentId);
    if (!document || !document.current_transcript_id) {
      return null;
    }

    return await this.findById(this.transcriptsTableName, document.current_transcript_id);
  }

  /**
   * Update transcript
   */
  async updateTranscript(transcriptId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = ['backend', 'language_code', 'raw_text', 'normalized_text', 'quality_jsonb', 'transcript_jsonb'];
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
      return await this.findTranscriptById(transcriptId);
    }

    values.push(transcriptId);

    const query = `
      UPDATE ${this.transcriptsTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * Delete transcript
   */
  async deleteTranscript(transcriptId) {
    // This will cascade to transcript_segments due to FK constraints
    const result = await this.execute(
      `DELETE FROM ${this.transcriptsTableName} WHERE id = $1`,
      [transcriptId]
    );
    return result > 0;
  }

  // ========================================
  // Transcript Segment Operations
  // ========================================

  /**
   * Create transcript segment
   */
  async createSegment(segmentData) {
    const id = segmentData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.transcriptSegmentsTableName} (
        id, transcript_id, segment_order, speaker_id, speaker_role, speaker_label,
        start_ms, end_ms, text, normalized_text, confidence_score, flags_jsonb, status, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      segmentData.transcript_id,
      segmentData.segment_order,
      segmentData.speaker_id || null,
      segmentData.speaker_role || 'unknown',
      segmentData.speaker_label || null,
      segmentData.start_ms || null,
      segmentData.end_ms || null,
      segmentData.text,
      segmentData.normalized_text || null,
      segmentData.confidence_score || null,
      this.toJSONB(segmentData.flags || {}),
      segmentData.status || 'active',
      now
    ]);
  }

  /**
   * Find segments by transcript ID
   */
  async findSegmentsByTranscriptId(transcriptId) {
    return await this.query(
      `SELECT * FROM ${this.transcriptSegmentsTableName} WHERE transcript_id = $1 ORDER BY segment_order ASC`,
      [transcriptId]
    );
  }

  /**
   * Find segment by ID
   */
  async findSegmentById(segmentId) {
    return await this.findById(this.transcriptSegmentsTableName, segmentId);
  }

  /**
   * Update segment
   */
  async updateSegment(segmentId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = ['speaker_id', 'speaker_role', 'speaker_label', 'text', 'normalized_text', 'confidence_score', 'flags_jsonb', 'status'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field === 'flags_jsonb') {
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
      return await this.findSegmentById(segmentId);
    }

    values.push(segmentId);

    const query = `
      UPDATE ${this.transcriptSegmentsTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * Delete segment
   */
  async deleteSegment(segmentId) {
    const result = await this.execute(
      `DELETE FROM ${this.transcriptSegmentsTableName} WHERE id = $1`,
      [segmentId]
    );
    return result > 0;
  }

  /**
   * Delete all segments for a transcript
   */
  async deleteSegmentsByTranscriptId(transcriptId) {
    return await this.execute(
      `DELETE FROM ${this.transcriptSegmentsTableName} WHERE transcript_id = $1`,
      [transcriptId]
    );
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Get repository statistics
   */
  async getStats() {
    return await this.getTranscriptStats();
  }

  /**
   * Get transcript statistics
   */
  async getTranscriptStats() {
    const totalTranscripts = await this.count(this.transcriptsTableName);
    const totalSegments = await this.count(this.transcriptSegmentsTableName);

    const transcriptsByType = await this.query(`
      SELECT
        COUNT(CASE WHEN document_id IS NOT NULL THEN 1 END) as document_transcripts,
        COUNT(CASE WHEN live_session_id IS NOT NULL THEN 1 END) as live_transcripts
      FROM ${this.transcriptsTableName}
    `);

    const stats = transcriptsByType[0] || {};

    return {
      totalTranscripts,
      totalSegments,
      documentTranscripts: stats.document_transcripts || 0,
      liveTranscripts: stats.live_transcripts || 0
    };
  }

  /**
   * Find transcripts by language
   */
  async findTranscriptsByLanguage(languageCode) {
    return await this.query(
      `SELECT * FROM ${this.transcriptsTableName} WHERE language_code = $1 ORDER BY created_at DESC`,
      [languageCode]
    );
  }

  /**
   * Search transcripts by content
   */
  async searchTranscripts(searchTerm, limit = 50) {
    const searchPattern = `%${searchTerm}%`;
    return await this.query(
      `SELECT * FROM ${this.transcriptsTableName}
       WHERE normalized_text ILIKE $1 OR raw_text ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [searchPattern, limit]
    );
  }
}

module.exports = { TranscriptsRepository };