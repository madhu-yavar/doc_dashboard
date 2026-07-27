/**
 * Daily Progress Notes Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles daily progress notes for inpatient journeys.
 * Supports multiple input methods: manual entry, voice dictation, and paper digitization.
 *
 * Related Tables:
 * - daily_progress_notes (main table)
 * - inpatient_journeys (parent journeys)
 * - transcripts (voice session references)
 * - live_conversation_sessions (real-time voice references)
 *
 * Features:
 * - Multiple note sources (manual, voice_upload, live_voice, dictation_batch)
 * - Paper digitization support with verification workflow
 * - Voice session integration
 * - Review and approval workflows
 * - Timeline and chronological queries
 * - SOAP format structured data
 */

const { BaseRepository } = require('./base_repository.cjs');

class DailyNotesRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.notesTableName = 'daily_progress_notes';
    this.journeysTableName = 'inpatient_journeys';
    this.transcriptsTableName = 'transcripts';
    this.voiceSessionsTableName = 'live_conversation_sessions';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    const notesTableExists = await this.tableExists(this.notesTableName);
    if (!notesTableExists) {
      throw new Error('Daily progress notes tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // CRUD Operations
  // ========================================

  /**
   * Create a new daily progress note
   * @param {Object} noteData - Note creation data
   * @returns {Object} Created note record
   */
  async createDailyNote(noteData) {
    const {
      id = this.generateId(),
      journey_id,
      encounter_id,
      patient_id,
      note_type,
      note_day_sequence,
      source = 'manual',
      status = 'draft',
      note_date,
      note_time,
      chief_complaint,
      history_of_present_illness,
      subjective_notes,
      objective_notes_jsonb = {},
      assessment,
      plan,
      medications_jsonb = {},
      orders_jsonb = {},
      vitals_jsonb = {},
      lab_results_jsonb = {},
      radiology_results_jsonb = {},
      procedures_jsonb = {},
      nursing_notes_jsonb = {},
      transcript_id,
      voice_session_id,
      created_by_user_id,
      review_required_by_user_id
    } = noteData;

    const query = `
      INSERT INTO ${this.notesTableName} (
        id, journey_id, encounter_id, patient_id, note_type, note_day_sequence,
        source, status, note_date, note_time, chief_complaint, history_of_present_illness,
        subjective_notes, objective_notes_jsonb, assessment, plan,
        medications_jsonb, orders_jsonb, vitals_jsonb, lab_results_jsonb,
        radiology_results_jsonb, procedures_jsonb, nursing_notes_jsonb,
        transcript_id, voice_session_id, created_by_user_id, review_required_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
      RETURNING *
    `;

    const result = await this.queryOne(query, [
      id, journey_id, encounter_id, patient_id, note_type, note_day_sequence,
      source, status, note_date, note_time, chief_complaint, history_of_present_illness,
      subjective_notes, this.toJSONB(objective_notes_jsonb), assessment, plan,
      this.toJSONB(medications_jsonb), this.toJSONB(orders_jsonb), this.toJSONB(vitals_jsonb),
      this.toJSONB(lab_results_jsonb), this.toJSONB(radiology_results_jsonb),
      this.toJSONB(procedures_jsonb), this.toJSONB(nursing_notes_jsonb),
      transcript_id, voice_session_id, created_by_user_id, review_required_by_user_id
    ]);

    // Update journey's daily notes count
    await this.updateJourneyNotesCount(journey_id);

    return result;
  }

  /**
   * Find note by ID
   * @param {string} noteId - Note ID
   * @returns {Object|null} Note record or null
   */
  async findNoteById(noteId) {
    return await this.findById(this.notesTableName, noteId);
  }

  /**
   * Find all notes for a journey
   * @param {string} journeyId - Journey ID
   * @returns {Array} Array of note records
   */
  async findNotesByJourney(journeyId) {
    const query = `
      SELECT * FROM ${this.notesTableName}
      WHERE journey_id = $1
      ORDER BY note_date DESC, note_time DESC
    `;

    return await this.query(query, [journeyId]);
  }

  /**
   * Find notes by patient and date range
   * @param {string} patientId - Patient ID
   * @param {string} startDate - Start date (ISO format)
   * @param {string} endDate - End date (ISO format)
   * @returns {Array} Array of note records
   */
  async findNotesByDateRange(patientId, startDate, endDate) {
    const query = `
      SELECT * FROM ${this.notesTableName}
      WHERE patient_id = $1
      AND note_date >= $2 AND note_date <= $3
      ORDER BY note_date DESC, note_time DESC
    `;

    return await this.query(query, [patientId, startDate, endDate]);
  }

  /**
   * Find latest note by type for a journey
   * @param {string} journeyId - Journey ID
   * @param {string} noteType - Note type filter (optional)
   * @returns {Object|null} Latest note record or null
   */
  async findLatestNoteByType(journeyId, noteType = null) {
    let query = `
      SELECT * FROM ${this.notesTableName}
      WHERE journey_id = $1
    `;

    if (noteType) {
      query += ` AND note_type = $2`;
      query += ` ORDER BY note_date DESC, note_time DESC LIMIT 1`;
      return await this.queryOne(query, [journeyId, noteType]);
    } else {
      query += ` ORDER BY note_date DESC, note_time DESC LIMIT 1`;
      return await this.queryOne(query, [journeyId]);
    }
  }

  /**
   * Update daily note
   * @param {string} noteId - Note ID
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated note record
   */
  async updateNote(noteId, updateData) {
    const allowedFields = [
      'note_type', 'source', 'status', 'note_date', 'note_time',
      'chief_complaint', 'history_of_present_illness', 'subjective_notes',
      'objective_notes_jsonb', 'assessment', 'plan',
      'medications_jsonb', 'orders_jsonb', 'vitals_jsonb',
      'lab_results_jsonb', 'radiology_results_jsonb',
      'procedures_jsonb', 'nursing_notes_jsonb'
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

    values.push(noteId);

    const query = `
      UPDATE ${this.notesTableName}
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.queryOne(query, values);
    return result;
  }

  /**
   * Update note status (for review workflow)
   * @param {string} noteId - Note ID
   * @param {string} newStatus - New status value
   * @param {Object} reviewData - Review-specific data
   * @returns {Object} Updated note record
   */
  async updateNoteStatus(noteId, newStatus, reviewData = {}) {
    const updates = ['status = $2', 'updated_at = NOW()'];
    const values = [noteId, newStatus];
    let paramIndex = 3;

    // Handle review-specific data
    if (newStatus === 'pending_review' || newStatus === 'approved') {
      if (reviewData.reviewed_by_user_id) {
        updates.push(`reviewed_by_user_id = $${paramIndex++}`);
        values.push(reviewData.reviewed_by_user_id);
      }
      if (reviewData.reviewed_at) {
        updates.push(`reviewed_at = $${paramIndex++}`);
        values.push(reviewData.reviewed_at);
      } else {
        updates.push(`reviewed_at = NOW()`);
      }
      if (reviewData.review_notes_jsonb) {
        updates.push(`review_notes_jsonb = $${paramIndex++}`);
        values.push(this.toJSONB(reviewData.review_notes_jsonb));
      }
    }

    if (reviewData.review_required_by_user_id) {
      updates.push(`review_required_by_user_id = $${paramIndex++}`);
      values.push(reviewData.review_required_by_user_id);
    }

    const query = `
      UPDATE ${this.notesTableName}
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.queryOne(query, values);
    return result;
  }

  /**
   * Soft delete note (with audit trail)
   * @param {string} noteId - Note ID
   * @param {string} deletedBy - User ID performing deletion
   * @returns {boolean} Success status
   */
  async deleteNote(noteId, deletedBy) {
    // Store deletion info and update journey count
    const note = await this.findNoteById(noteId);
    if (!note) {
      throw new Error('Note not found');
    }

    // Instead of hard delete, mark as superseded
    const result = await this.updateNoteStatus(noteId, 'superseded', {
      reviewed_by_user_id: deletedBy,
      reviewed_at: new Date().toISOString(),
      review_notes_jsonb: [{ action: 'deleted', deleted_by: deletedBy, deleted_at: new Date().toISOString() }]
    });

    // Update journey count
    await this.updateJourneyNotesCount(note.journey_id);

    return !!result;
  }

  // ========================================
  // Daily Notes Specific Queries
  // ========================================

  /**
   * Get daily notes timeline for a journey
   * @param {string} journeyId - Journey ID
   * @returns {Object} Timeline data with statistics
   */
  async getDailyNotesTimeline(journeyId) {
    const notes = await this.findNotesByJourney(journeyId);

    // Calculate statistics
    const stats = {
      total_notes: notes.length,
      by_source: {
        manual: 0,
        voice_upload: 0,
        live_voice: 0,
        dictation_batch: 0
      },
      by_status: {
        draft: 0,
        pending_review: 0,
        approved: 0,
        superseded: 0
      },
      by_type: {},
      unverified_paper_notes: 0
    };

    notes.forEach(note => {
      // Count by source
      if (note.source) {
        stats.by_source[note.source] = (stats.by_source[note.source] || 0) + 1;
      }

      // Count by status
      if (note.status) {
        stats.by_status[note.status] = (stats.by_status[note.status] || 0) + 1;
      }

      // Count by type
      if (note.note_type) {
        stats.by_type[note.note_type] = (stats.by_type[note.note_type] || 0) + 1;
      }

      // Count unverified paper notes (assuming paper notes need verification)
      if (note.source === 'manual' && note.status === 'draft') {
        stats.unverified_paper_notes++;
      }
    });

    return {
      notes,
      statistics: stats
    };
  }

  /**
   * Find notes by status
   * @param {string} status - Note status
   * @param {Object} filters - Additional filters
   * @returns {Array} Array of note records
   */
  async findNotesByStatus(status, filters = {}) {
    let query = `
      SELECT n.*, j.patient_id, j.current_ward
      FROM ${this.notesTableName} n
      JOIN ${this.journeysTableName} j ON n.journey_id = j.id
      WHERE n.status = $1
    `;

    const params = [status];
    let paramIndex = 2;

    if (filters.patient_id) {
      query += ` AND n.patient_id = $${paramIndex++}`;
      params.push(filters.patient_id);
    }

    if (filters.source) {
      query += ` AND n.source = $${paramIndex++}`;
      params.push(filters.source);
    }

    if (filters.ward) {
      query += ` AND j.current_ward = $${paramIndex++}`;
      params.push(filters.ward);
    }

    query += ` ORDER BY n.note_date DESC, n.note_time DESC`;

    return await this.query(query, params);
  }

  /**
   * Find notes needing attention/review
   * @param {Object} criteria - Search criteria
   * @returns {Array} Array of notes needing attention
   */
  async findNotesNeedingAttention(criteria = {}) {
    const {
      status = ['draft', 'pending_review'],
      source = null,
      patient_id = null,
      limit = 100
    } = criteria;

    let query = `
      SELECT n.*, j.current_ward, j.admitted_at
      FROM ${this.notesTableName} n
      JOIN ${this.journeysTableName} j ON n.journey_id = j.id
      WHERE n.status = ANY($1)
    `;

    const params = [status];
    let paramIndex = 2;

    if (source) {
      query += ` AND n.source = $${paramIndex++}`;
      params.push(source);
    }

    if (patient_id) {
      query += ` AND n.patient_id = $${paramIndex++}`;
      params.push(patient_id);
    }

    query += ` ORDER BY n.note_date ASC, n.note_time ASC LIMIT $${paramIndex++}`;
    params.push(limit);

    return await this.query(query, params);
  }

  /**
   * Find unverified notes (for paper digitization workflow)
   * @param {Object} filters - Search filters
   * @returns {Array} Array of unverified notes
   */
  async findUnverifiedNotes(filters = {}) {
    const {
      patient_id = null,
      journey_id = null,
      source = 'manual', // Assuming manual indicates paper-extracted notes
      limit = 50
    } = filters;

    let query = `
      SELECT n.*, j.current_ward, j.admission_type
      FROM ${this.notesTableName} n
      JOIN ${this.journeysTableName} j ON n.journey_id = j.id
      WHERE n.source = $1
      AND n.status = 'draft'
      AND n.reviewed_by_user_id IS NULL
    `;

    const params = [source];
    let paramIndex = 2;

    if (patient_id) {
      query += ` AND n.patient_id = $${paramIndex++}`;
      params.push(patient_id);
    }

    if (journey_id) {
      query += ` AND n.journey_id = $${paramIndex++}`;
      params.push(journey_id);
    }

    query += ` ORDER BY n.note_date DESC, n.created_at ASC LIMIT $${paramIndex++}`;
    params.push(limit);

    return await this.query(query, params);
  }

  // ========================================
  // Voice Integration Methods
  // ========================================

  /**
   * Link voice session to daily note
   * @param {string} noteId - Note ID
   * @param {string} sessionId - Voice session ID
   * @param {string} transcriptId - Transcript ID (optional)
   * @returns {Object} Updated note record
   */
  async linkVoiceSession(noteId, sessionId, transcriptId = null) {
    const updates = ['voice_session_id = $2', 'source = \'voice_upload\'', 'updated_at = NOW()'];
    const values = [noteId, sessionId];
    let paramIndex = 3;

    if (transcriptId) {
      updates.push(`transcript_id = $${paramIndex++}`);
      values.push(transcriptId);
    }

    const query = `
      UPDATE ${this.notesTableName}
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.queryOne(query, values);
    return result;
  }

  /**
   * Find notes by voice session
   * @param {string} sessionId - Voice session ID
   * @returns {Array} Array of note records
   */
  async findNotesByVoiceSession(sessionId) {
    const query = `
      SELECT * FROM ${this.notesTableName}
      WHERE voice_session_id = $1
      ORDER BY created_at DESC
    `;

    return await this.query(query, [sessionId]);
  }

  /**
   * Find notes by transcript
   * @param {string} transcriptId - Transcript ID
   * @returns {Array} Array of note records
   */
  async findNotesByTranscript(transcriptId) {
    return await this.findByColumn(this.notesTableName, 'transcript_id', transcriptId);
  }

  // ========================================
  // Paper Digitization Support
  // ========================================

  /**
   * Find notes by source type
   * @param {string} sourceType - Source type (manual, voice_upload, etc.)
   * @param {Object} filters - Additional filters
   * @returns {Array} Array of note records
   */
  async findNotesBySource(sourceType, filters = {}) {
    let query = `
      SELECT n.*, j.current_ward, j.admission_type
      FROM ${this.notesTableName} n
      JOIN ${this.journeysTableName} j ON n.journey_id = j.id
      WHERE n.source = $1
    `;

    const params = [sourceType];
    let paramIndex = 2;

    if (filters.patient_id) {
      query += ` AND n.patient_id = $${paramIndex++}`;
      params.push(filters.patient_id);
    }

    if (filters.status) {
      query += ` AND n.status = $${paramIndex++}`;
      params.push(filters.status);
    }

    query += ` ORDER BY n.note_date DESC, n.note_time DESC`;

    return await this.query(query, params);
  }

  /**
   * Update verification status (for paper digitization workflow)
   * @param {string} noteId - Note ID
   * @param {Object} verificationData - Verification information
   * @returns {Object} Updated note record
   */
  async updateVerificationStatus(noteId, verificationData) {
    const {
      verified_by_user_id,
      verification_status, // 'verified', 'rejected', 'needs_revision'
      verification_notes,
      verified_data_jsonb = {}
    } = verificationData;

    // Get current note to preserve existing review notes
    const currentNote = await this.findNoteById(noteId);
    if (!currentNote) {
      throw new Error('Note not found');
    }

    // Build review notes array
    const existingReviewNotes = this.fromJSONB(currentNote.review_notes_jsonb) || [];
    const newReviewNote = {
      verification_status,
      verified_by: verified_by_user_id,
      verified_at: new Date().toISOString(),
      notes: verification_notes,
      verified_data: verified_data_jsonb
    };

    const updatedReviewNotes = [...existingReviewNotes, newReviewNote];

    // Update note status based on verification
    let newStatus = 'draft';
    if (verification_status === 'verified') {
      newStatus = 'approved';
    } else if (verification_status === 'rejected') {
      newStatus = 'superseded';
    }

    return await this.updateNoteStatus(noteId, newStatus, {
      reviewed_by_user_id: verified_by_user_id,
      reviewed_at: new Date().toISOString(),
      review_notes_jsonb: updatedReviewNotes
    });
  }

  // ========================================
  // Helper Methods
  // ========================================

  /**
   * Update journey's daily notes count
   * @param {string} journeyId - Journey ID
   * @returns {boolean} Success status
   */
  async updateJourneyNotesCount(journeyId) {
    const query = `
      UPDATE ${this.journeysTableName}
      SET total_daily_notes = (
        SELECT COUNT(*) FROM ${this.notesTableName}
        WHERE journey_id = $1 AND status != 'superseded'
      ),
      updated_at = NOW()
      WHERE id = $1
    `;

    const result = await this.execute(query, [journeyId]);
    return result > 0;
  }

  /**
   * Get daily notes statistics
   * @param {Object} filters - Statistic filters
   * @returns {Object} Daily notes statistics
   */
  async getDailyNotesStats(filters = {}) {
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (filters.patient_id) {
      whereClause += ` AND patient_id = $${paramIndex++}`;
      params.push(filters.patient_id);
    }

    if (filters.journey_id) {
      whereClause += ` AND journey_id = $${paramIndex++}`;
      params.push(filters.journey_id);
    }

    if (filters.date_from) {
      whereClause += ` AND note_date >= $${paramIndex++}`;
      params.push(filters.date_from);
    }

    if (filters.date_to) {
      whereClause += ` AND note_date <= $${paramIndex++}`;
      params.push(filters.date_to);
    }

    const query = `
      SELECT
        COUNT(*) as total_notes,
        COUNT(*) FILTER (WHERE status = 'draft') as draft_notes,
        COUNT(*) FILTER (WHERE status = 'pending_review') as pending_review,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_notes,
        COUNT(*) FILTER (WHERE source = 'manual') as manual_notes,
        COUNT(*) FILTER (WHERE source = 'voice_upload') as voice_notes,
        COUNT(*) FILTER (WHERE source = 'live_voice') as live_voice_notes,
        COUNT(*) FILTER (WHERE source = 'dictation_batch') as dictation_notes,
        COUNT(*) FILTER (WHERE reviewed_by_user_id IS NULL) as unreviewed_notes,
        COUNT(*) FILTER (WHERE reviewed_by_user_id IS NOT NULL) as reviewed_notes
      FROM ${this.notesTableName}
      ${whereClause}
    `;

    const result = await this.queryOne(query, params);
    return result;
  }

  /**
   * Batch update note statuses
   * @param {Array} noteIds - Array of note IDs
   * @param {string} newStatus - New status value
   * @param {Object} updateData - Additional update data
   * @returns {number} Number of notes updated
   */
  async batchUpdateStatus(noteIds, newStatus, updateData = {}) {
    if (!noteIds || noteIds.length === 0) {
      return 0;
    }

    let query = `
      UPDATE ${this.notesTableName}
      SET status = $2, updated_at = NOW()
    `;

    const params = [newStatus];
    let paramIndex = 3;

    if (updateData.reviewed_by_user_id) {
      query += `, reviewed_by_user_id = $${paramIndex++}`;
      params.push(updateData.reviewed_by_user_id);
    }

    if (updateData.review_required_by_user_id) {
      query += `, review_required_by_user_id = $${paramIndex++}`;
      params.push(updateData.review_required_by_user_id);
    }

    query += ` WHERE id = ANY($1)`;

    params.push(noteIds);

    const result = await this.execute(query, params);
    return result;
  }

  /**
   * Health check with notes-specific metrics
   * @returns {Object} Health status and metrics
   */
  async healthCheck() {
    try {
      const baseHealth = await super.healthCheck();

      if (baseHealth.status !== 'healthy') {
        return baseHealth;
      }

      // Add notes-specific metrics
      const stats = await this.getDailyNotesStats();

      return {
        ...baseHealth,
        metrics: {
          total_notes: parseInt(stats.total_notes),
          draft_notes: parseInt(stats.draft_notes),
          pending_review: parseInt(stats.pending_review),
          approved_notes: parseInt(stats.approved_notes),
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

module.exports = { DailyNotesRepository };