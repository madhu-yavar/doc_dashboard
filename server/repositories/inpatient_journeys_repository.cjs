/**
 * Inpatient Journeys Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles inpatient journey management from admission to discharge.
 * Provides comprehensive journey lifecycle operations with daily notes tracking.
 *
 * Related Tables:
 * - inpatient_journeys (main table)
 * - daily_progress_notes (journey documentation)
 * - department_integrations (lab/radiology/pharmacy)
 *
 * Features:
 * - Complete journey lifecycle management
 * - Daily notes tracking and timeline
 * - Department integration support
 * - Location and patient tracking
 * - Admission and discharge processing
 */

const { BaseRepository } = require('./base_repository.cjs');

class InpatientJourneysRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.journeysTableName = 'inpatient_journeys';
    this.dailyNotesTableName = 'daily_progress_notes';
    this.departmentIntegrationsTableName = 'department_integrations';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    const journeysTableExists = await this.tableExists(this.journeysTableName);
    if (!journeysTableExists) {
      throw new Error('Inpatient journeys tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // CRUD Operations
  // ========================================

  /**
   * Create a new inpatient journey
   * @param {Object} journeyData - Journey creation data
   * @returns {Object} Created journey record
   */
  async createJourney(journeyData) {
    const {
      id = this.generateId(),
      encounter_id,
      patient_id,
      status = 'admitted',
      admission_type,
      admission_reason,
      attending_physician_id,
      current_location_id,
      current_ward,
      current_bed,
      admitted_at = new Date().toISOString(),
      expected_discharge_at,
      journey_metadata_jsonb = {}
    } = journeyData;

    const query = `
      INSERT INTO ${this.journeysTableName} (
        id, encounter_id, patient_id, status, admission_type, admission_reason,
        attending_physician_id, current_location_id, current_ward, current_bed,
        admitted_at, expected_discharge_at, journey_metadata_jsonb
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;

    const result = await this.queryOne(query, [
      id, encounter_id, patient_id, status, admission_type, admission_reason,
      attending_physician_id, current_location_id, current_ward, current_bed,
      admitted_at, expected_discharge_at, this.toJSONB(journey_metadata_jsonb)
    ]);

    return result;
  }

  /**
   * Find journey by ID
   * @param {string} journeyId - Journey ID
   * @returns {Object|null} Journey record or null
   */
  async findJourneyById(journeyId) {
    return await this.findById(this.journeysTableName, journeyId);
  }

  /**
   * Find all journeys for a patient
   * @param {string} patientId - Patient ID
   * @returns {Array} Array of journey records
   */
  async findJourneysByPatient(patientId) {
    return await this.findByColumn(this.journeysTableName, 'patient_id', patientId);
  }

  /**
   * Find active journeys by location/ward
   * @param {string} locationId - Location ID (optional)
   * @param {string} ward - Ward name (optional)
   * @returns {Array} Array of active journey records
   */
  async findActiveJourneysByLocation(locationId = null, ward = null) {
    let query = `SELECT * FROM ${this.journeysTableName} WHERE status = 'admitted'`;
    let params = [];
    let paramIndex = 1;

    if (locationId) {
      query += ` AND current_location_id = $${paramIndex++}`;
      params.push(locationId);
    }

    if (ward) {
      query += ` AND current_ward = $${paramIndex++}`;
      params.push(ward);
    }

    query += ' ORDER BY admitted_at DESC';

    return await this.query(query, params);
  }

  /**
   * Update journey basic information
   * @param {string} journeyId - Journey ID
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated journey record
   */
  async updateJourney(journeyId, updateData) {
    const allowedFields = [
      'attending_physician_id', 'current_location_id', 'current_ward', 'current_bed',
      'expected_discharge_at', 'current_daily_note_id', 'journey_metadata_jsonb'
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

    values.push(journeyId);

    const query = `
      UPDATE ${this.journeysTableName}
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.queryOne(query, values);
    return result;
  }

  /**
   * Update journey status (for admission/discharge workflows)
   * @param {string} journeyId - Journey ID
   * @param {string} newStatus - New status value
   * @param {Object} statusData - Additional status-specific data (discharge info, etc.)
   * @returns {Object} Updated journey record
   */
  async updateJourneyStatus(journeyId, newStatus, statusData = {}) {
    const updates = ['status = $2', 'updated_at = NOW()'];
    const values = [journeyId, newStatus];
    let paramIndex = 3;

    // Handle discharge-specific data
    if (newStatus === 'discharged') {
      if (statusData.discharged_at) {
        updates.push(`discharged_at = $${paramIndex++}`);
        values.push(statusData.discharged_at);
      }
      if (statusData.discharge_type) {
        updates.push(`discharge_type = $${paramIndex++}`);
        values.push(statusData.discharge_type);
      }
      if (statusData.discharge_diagnosis) {
        updates.push(`discharge_diagnosis = $${paramIndex++}`);
        values.push(statusData.discharge_diagnosis);
      }
      if (statusData.discharge_summary_jsonb) {
        updates.push(`discharge_summary_jsonb = $${paramIndex++}`);
        values.push(this.toJSONB(statusData.discharge_summary_jsonb));
      }
      if (statusData.discharge_medications_jsonb) {
        updates.push(`discharge_medications_jsonb = $${paramIndex++}`);
        values.push(this.toJSONB(statusData.discharge_medications_jsonb));
      }
      // Calculate length of stay
      updates.push(`length_of_stay_days = EXTRACT(DAY FROM (NOW() - admitted_at))`);
    }

    const query = `
      UPDATE ${this.journeysTableName}
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.queryOne(query, values);
    return result;
  }

  /**
   * Soft delete journey (with audit trail)
   * @param {string} journeyId - Journey ID
   * @param {string} deletedBy - User ID performing deletion
   * @returns {boolean} Success status
   */
  async deleteJourney(journeyId, deletedBy) {
    // Store deletion in metadata instead of hard delete
    const query = `
      UPDATE ${this.journeysTableName}
      SET journey_metadata_jsonb = jsonb_set(
        COALESCE(journey_metadata_jsonb, '{}'),
        '{deleted}',
        '{"deleted_at": "NOW()", "deleted_by": "' || $2 || '"}'
      ),
      updated_at = NOW()
      WHERE id = $1
    `;

    const result = await this.execute(query, [journeyId, deletedBy]);
    return result > 0;
  }

  // ========================================
  // Domain-Specific Queries
  // ========================================

  /**
   * Get journey statistics and summary data
   * @returns {Object} Journey statistics
   */
  async getJourneyStats() {
    const query = `
      SELECT
        COUNT(*) as total_journeys,
        COUNT(*) FILTER (WHERE status = 'admitted') as active_admissions,
        COUNT(*) FILTER (WHERE status = 'discharged') as total_discharges,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        AVG(length_of_stay_days) FILTER (WHERE length_of_stay_days IS NOT NULL) as avg_length_of_stay,
        MAX(admitted_at) as last_admission_time
      FROM ${this.journeysTableName}
    `;

    const result = await this.queryOne(query);
    return result;
  }

  /**
   * Find journeys by date range (admission date)
   * @param {string} startDate - Start date ISO string
   * @param {string} endDate - End date ISO string
   * @returns {Array} Array of journey records
   */
  async findJourneysByDateRange(startDate, endDate) {
    const query = `
      SELECT * FROM ${this.journeysTableName}
      WHERE admitted_at >= $1 AND admitted_at <= $2
      ORDER BY admitted_at DESC
    `;

    return await this.query(query, [startDate, endDate]);
  }

  /**
   * Find journeys by status
   * @param {string} status - Journey status
   * @returns {Array} Array of journey records
   */
  async findJourneysByStatus(status) {
    return await this.findByColumn(this.journeysTableName, 'status', status);
  }

  /**
   * Get journey timeline with events
   * @param {string} journeyId - Journey ID
   * @returns {Object} Journey with timeline data
   */
  async getJourneyTimeline(journeyId) {
    const journeyQuery = `
      SELECT *,
        (SELECT COUNT(*) FROM ${this.dailyNotesTableName} WHERE journey_id = $1) as daily_notes_count,
        (SELECT COUNT(*) FROM ${this.departmentIntegrationsTableName} WHERE journey_id = $1) as integrations_count
      FROM ${this.journeysTableName}
      WHERE id = $1
    `;

    const journey = await this.queryOne(journeyQuery, [journeyId]);

    if (!journey) {
      return null;
    }

    // Get daily notes for timeline
    const notesQuery = `
      SELECT id, note_type, note_date, note_time, source, status, created_at
      FROM ${this.dailyNotesTableName}
      WHERE journey_id = $1
      ORDER BY note_date DESC, note_time DESC
    `;

    const notes = await this.query(notesQuery, [journeyId]);

    // Get department integrations
    const integrationsQuery = `
      SELECT id, integration_type, direction, status, ordered_at, completed_at
      FROM ${this.departmentIntegrationsTableName}
      WHERE journey_id = $1
      ORDER BY ordered_at DESC
    `;

    const integrations = await this.query(integrationsQuery, [journeyId]);

    return {
      journey,
      timeline: {
        daily_notes: notes,
        department_integrations: integrations,
        statistics: {
          total_daily_notes: parseInt(journey.daily_notes_count),
          total_integrations: parseInt(journey.integrations_count),
          length_of_stay_days: journey.length_of_stay_days
        }
      }
    };
  }

  /**
   * Find journeys requiring attention (long stay, no notes, etc.)
   * @param {Object} criteria - Search criteria
   * @returns {Array} Array of journey records needing attention
   */
  async findJourneysRequiringAttention(criteria = {}) {
    const {
      long_stay_days = 7,
      no_notes_hours = 24,
      pending_discharges = true
    } = criteria;

    let queries = [];

    // Long stay patients
    if (long_stay_days > 0) {
      queries.push(`
        SELECT *, 'long_stay' as attention_reason
        FROM ${this.journeysTableName}
        WHERE status = 'admitted'
        AND admitted_at < NOW() - INTERVAL '${long_stay_days} days'
        ORDER BY admitted_at ASC
      `);
    }

    // Patients without recent notes
    if (no_notes_hours > 0) {
      queries.push(`
        SELECT DISTINCT j.*, 'no_recent_notes' as attention_reason
        FROM ${this.journeysTableName} j
        LEFT JOIN ${this.dailyNotesTableName} n ON j.id = n.journey_id
        WHERE j.status = 'admitted'
        AND (
          n.id IS NULL
          OR n.created_at < NOW() - INTERVAL '${no_notes_hours} hours'
        )
        ORDER BY j.admitted_at ASC
      `);
    }

    // Patients pending discharge
    if (pending_discharges) {
      queries.push(`
        SELECT *, 'pending_discharge' as attention_reason
        FROM ${this.journeysTableName}
        WHERE status = 'admitted'
        AND expected_discharge_at IS NOT NULL
        AND expected_discharge_at < NOW()
        ORDER BY expected_discharge_at ASC
      `);
    }

    // Execute all queries and combine results
    const results = [];
    for (const query of queries) {
      const journeyResults = await this.query(query);
      results.push(...journeyResults);
    }

    // Remove duplicates and sort
    const uniqueJourneys = Array.from(
      new Map(results.map(journey => [journey.id, journey])).values()
    );

    return uniqueJourneys.sort((a, b) => {
      // Prioritize by attention reason severity
      const priorityOrder = ['pending_discharge', 'no_recent_notes', 'long_stay'];
      const aPriority = priorityOrder.indexOf(a.attention_reason);
      const bPriority = priorityOrder.indexOf(b.attention_reason);

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Then by admitted_at
      return new Date(a.admitted_at) - new Date(b.admitted_at);
    });
  }

  /**
   * Transfer patient to new location
   * @param {string} journeyId - Journey ID
   * @param {Object} transferData - New location information
   * @returns {Object} Updated journey record
   */
  async transferPatient(journeyId, transferData) {
    const {
      new_location_id,
      new_ward,
      new_bed,
      transfer_reason,
      transferred_by
    } = transferData;

    // Get current journey for metadata
    const currentJourney = await this.findJourneyById(journeyId);
    if (!currentJourney) {
      throw new Error('Journey not found');
    }

    // Build transfer history
    const metadata = this.fromJSONB(currentJourney.journey_metadata_jsonb);
    const transferHistory = metadata.transfer_history || [];

    transferHistory.push({
      from_location_id: currentJourney.current_location_id,
      from_ward: currentJourney.current_ward,
      from_bed: currentJourney.current_bed,
      to_location_id: new_location_id,
      to_ward: new_ward,
      to_bed: new_bed,
      transfer_reason,
      transferred_at: new Date().toISOString(),
      transferred_by
    });

    // Update journey with new location
    const updateData = {
      current_location_id: new_location_id,
      current_ward: new_ward,
      current_bed: new_bed,
      journey_metadata_jsonb: {
        ...metadata,
        transfer_history: transferHistory
      }
    };

    return await this.updateJourney(journeyId, updateData);
  }

  /**
   * Get admission statistics by ward
   * @param {string} ward - Ward name (optional, for specific ward)
   * @returns {Array} Array of ward statistics
   */
  async getAdmissionStatsByWard(ward = null) {
    let query = `
      SELECT
        current_ward,
        COUNT(*) FILTER (WHERE status = 'admitted') as current_admissions,
        COUNT(*) FILTER (WHERE status = 'discharged') as total_discharges,
        COUNT(*) as total_journeys,
        AVG(length_of_stay_days) FILTER (WHERE length_of_stay_days IS NOT NULL) as avg_length_of_stay
      FROM ${this.journeysTableName}
      WHERE current_ward IS NOT NULL
    `;

    if (ward) {
      query += ` AND current_ward = $1 GROUP BY current_ward`;
      return await this.query(query, [ward]);
    } else {
      query += ` GROUP BY current_ward ORDER BY current_admissions DESC`;
      return await this.query(query);
    }
  }

  /**
   * Search journeys by multiple criteria
   * @param {Object} searchCriteria - Search parameters
   * @returns {Array} Array of matching journey records
   */
  async searchJourneys(searchCriteria) {
    const {
      patient_id,
      status,
      ward,
      physician_id,
      location_id,
      admission_date_from,
      admission_date_to,
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

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (ward) {
      conditions.push(`current_ward = $${paramIndex++}`);
      params.push(ward);
    }

    if (physician_id) {
      conditions.push(`attending_physician_id = $${paramIndex++}`);
      params.push(physician_id);
    }

    if (location_id) {
      conditions.push(`current_location_id = $${paramIndex++}`);
      params.push(location_id);
    }

    if (admission_date_from) {
      conditions.push(`admitted_at >= $${paramIndex++}`);
      params.push(admission_date_from);
    }

    if (admission_date_to) {
      conditions.push(`admitted_at <= $${paramIndex++}`);
      params.push(admission_date_to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT * FROM ${this.journeysTableName}
      ${whereClause}
      ORDER BY admitted_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(limit, offset);

    return await this.query(query, params);
  }

  // ========================================
  // Transaction Support
  // ========================================

  /**
   * Create journey with initial daily note (atomic operation)
   * @param {Object} journeyData - Journey creation data
   * @param {Object} initialNoteData - Initial daily note data
   * @returns {Object} Created journey and note
   */
  async createJourneyWithInitialNote(journeyData, initialNoteData) {
    return await this.transaction(async (client) => {
      // Helper function to use raw client
      const transactionQueryOne = async (text, params) => {
        const result = await client.query(text, params);
        return result.rows.length > 0 ? result.rows[0] : null;
      };

      // Create journey first
      const journeyResult = await transactionQueryOne(`
        INSERT INTO ${this.journeysTableName} (
          id, encounter_id, patient_id, status, admission_type, admission_reason,
          attending_physician_id, current_location_id, current_ward, current_bed,
          admitted_at, expected_discharge_at, journey_metadata_jsonb
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `, [
        journeyData.id || this.generateId(),
        journeyData.encounter_id,
        journeyData.patient_id,
        journeyData.status || 'admitted',
        journeyData.admission_type,
        journeyData.admission_reason,
        journeyData.attending_physician_id,
        journeyData.current_location_id,
        journeyData.current_ward,
        journeyData.current_bed,
        journeyData.admitted_at || new Date().toISOString(),
        journeyData.expected_discharge_at,
        this.toJSONB(journeyData.journey_metadata_jsonb || {})
      ]);

      const journey = journeyResult;

      // Create initial daily note
      const noteResult = await transactionQueryOne(`
        INSERT INTO ${this.dailyNotesTableName} (
          id, journey_id, encounter_id, patient_id, note_type, note_day_sequence,
          source, status, note_date, note_time, subjective_notes, objective_notes_jsonb,
          assessment, plan, created_by_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `, [
        this.generateId(),
        journey.id,
        journey.encounter_id,
        journey.patient_id,
        initialNoteData.note_type || 'admission',
        1, // First note
        initialNoteData.source || 'manual',
        initialNoteData.status || 'draft',
        initialNoteData.note_date || new Date().toISOString().split('T')[0],
        initialNoteData.note_time || new Date().toTimeString().split(' ')[0],
        initialNoteData.subjective_notes,
        this.toJSONB(initialNoteData.objective_notes_jsonb || {}),
        initialNoteData.assessment,
        initialNoteData.plan,
        initialNoteData.created_by_user_id
      ]);

      // Update journey with current daily note
      await transactionQueryOne(`
        UPDATE ${this.journeysTableName}
        SET current_daily_note_id = $2,
            total_daily_notes = 1,
            updated_at = NOW()
        WHERE id = $1
      `, [journey.id, noteResult.id]);

      return {
        journey,
        initial_note: noteResult
      };
    });
  }

  /**
   * Health check with journey-specific metrics
   * @returns {Object} Health status and metrics
   */
  async healthCheck() {
    try {
      const baseHealth = await super.healthCheck();

      if (baseHealth.status !== 'healthy') {
        return baseHealth;
      }

      // Add journey-specific metrics
      const stats = await this.getJourneyStats();

      return {
        ...baseHealth,
        metrics: {
          total_journeys: parseInt(stats.total_journeys),
          active_admissions: parseInt(stats.active_admissions),
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

module.exports = { InpatientJourneysRepository };