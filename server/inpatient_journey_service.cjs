/**
 * Inpatient Journey Service - Phase 2: Service Layer (Business Logic)
 *
 * Orchestrates inpatient journey management with business logic and validation.
 * Coordinates between repositories and other services for complete journey workflows.
 *
 * Responsibilities:
 * - Journey lifecycle management (admission, transfer, discharge)
 * - Clinical workflow coordination
 * - Business rules and validation
 * - Statistics and reporting
 * - Integration with other services
 */

const { InpatientJourneysRepository } = require('./repositories/inpatient_journeys_repository.cjs');
const { DailyNotesRepository } = require('./repositories/daily_notes_repository.cjs');
const { DepartmentIntegrationsRepository } = require('./repositories/department_integrations_repository.cjs');

class InpatientJourneyService {
  constructor(config = {}) {
    this.name = 'InpatientJourneyService';
    this.journeysRepository = config.journeysRepository || new InpatientJourneysRepository();
    this.dailyNotesRepository = config.dailyNotesRepository || new DailyNotesRepository();
    this.departmentIntegrationsRepository = config.departmentIntegrationsRepository || new DepartmentIntegrationsRepository();

    // Configuration options
    this.autoCreateAdmissionNote = config.autoCreateAdmissionNote !== false; // default true
    this.requireDischargeSummary = config.requireDischargeSummary !== false; // default true
    this.maxRetries = config.maxRetries || 3;
  }

  /**
   * Initialize the service and its repositories
   */
  async initialize() {
    await this.journeysRepository.initialize();
    await this.dailyNotesRepository.initialize();
    await this.departmentIntegrationsRepository.initialize();
  }

  // ========================================
  // Journey Lifecycle Management
  // ========================================

  /**
   * Admit a patient as inpatient
   * @param {Object} admissionData - Patient admission information
   * @returns {Object} Created journey with initial data
   */
  async admitPatient(admissionData) {
    const {
      encounter_id,
      patient_id,
      admission_type = 'routine',
      admission_reason,
      attending_physician_id,
      current_location_id,
      current_ward,
      current_bed,
      expected_discharge_at,
      create_initial_note = true,
      initial_note_data = {},
      admitted_at = new Date().toISOString()
    } = admissionData;

    // Validate required fields
    this.validateAdmissionData({ encounter_id, patient_id, admission_type });

    // Check for existing active admission
    const existingActive = await this.journeysRepository.findJourneysByPatient(patient_id);
    const activeJourney = existingActive.find(j => j.status === 'admitted');

    if (activeJourney) {
      throw new Error(`Patient already has an active admission: ${activeJourney.id}`);
    }

    // Prepare journey data
    const journeyData = {
      encounter_id,
      patient_id,
      status: 'admitted',
      admission_type,
      admission_reason,
      attending_physician_id,
      current_location_id,
      current_ward,
      current_bed,
      admitted_at,
      expected_discharge_at,
      journey_metadata_jsonb: {
        admission_source: 'manual',
        admission_notes: initial_note_data.admission_notes || ''
      }
    };

    let result;

    // Create journey with optional initial note
    if (this.autoCreateAdmissionNote && create_initial_note) {
      const noteData = {
        note_type: 'admission',
        note_date: admitted_at.split('T')[0],
        note_time: admitted_at.split('T')[1].split('.')[0],
        subjective_notes: initial_note_data.chief_complaint || admission_reason,
        objective_notes_jsonb: initial_note_data.admission_findings || {},
        assessment: initial_note_data.initial_assessment || 'Patient admitted for ' + admission_reason,
        plan: initial_note_data.initial_plan || 'Treatment plan to be determined',
        created_by_user_id: initial_note_data.created_by_user_id || 'system'
      };

      result = await this.journeysRepository.createJourneyWithInitialNote(journeyData, noteData);
    } else {
      const journey = await this.journeysRepository.createJourney(journeyData);
      result = { journey, initial_note: null };
    }

    return {
      journey: result.journey,
      initial_note: result.initial_note,
      admission_summary: this.generateAdmissionSummary(result.journey)
    };
  }

  /**
   * Update patient daily progress
   * @param {string} journeyId - Journey ID
   * @param {Object} progressData - Progress update data
   * @returns {Object} Updated journey with progress summary
   */
  async updateDailyProgress(journeyId, progressData) {
    // Validate journey exists and is active
    const journey = await this.journeysRepository.findJourneyById(journeyId);
    if (!journey) {
      throw new Error('Journey not found');
    }

    if (journey.status !== 'admitted' && journey.status !== 'in_progress') {
      throw new Error(`Cannot update progress for journey with status: ${journey.status}`);
    }

    const updates = {};

    // Handle location changes
    if (progressData.location_change) {
      const { new_location_id, new_ward, new_bed, reason, changed_by } = progressData.location_change;

      if (new_ward && new_ward !== journey.current_ward) {
        updates.current_ward = new_ward;
      }

      if (new_bed && new_bed !== journey.current_bed) {
        updates.current_bed = new_bed;
      }

      if (new_location_id && new_location_id !== journey.current_location_id) {
        updates.current_location_id = new_location_id;
      }

      // Add transfer to metadata if significant change
      if (updates.current_ward || updates.current_location_id) {
        const metadata = this.journeysRepository.fromJSONB(journey.journey_metadata_jsonb || '{}');
        const transferHistory = metadata.transfer_history || [];

        transferHistory.push({
          from: { ward: journey.current_ward, location: journey.current_location_id, bed: journey.current_bed },
          to: { ward: new_ward, location: new_location_id, bed: new_bed },
          reason: reason || 'Daily progress update',
          changed_at: new Date().toISOString(),
          changed_by: changed_by || 'system'
        });

        updates.journey_metadata_jsonb = { ...metadata, transfer_history: transferHistory };
      }
    }

    // Handle physician changes
    if (progressData.attending_physician_id && progressData.attending_physician_id !== journey.attending_physician_id) {
      updates.attending_physician_id = progressData.attending_physician_id;
    }

    // Handle expected discharge updates
    if (progressData.expected_discharge_at) {
      updates.expected_discharge_at = progressData.expected_discharge_at;
    }

    // Update journey if there are changes
    let updatedJourney = journey;
    if (Object.keys(updates).length > 0) {
      updatedJourney = await this.journeysRepository.updateJourney(journeyId, updates);
    }

    // Get latest statistics
    const stats = await this.getJourneyProgressStats(journeyId);

    return {
      journey: updatedJourney,
      progress_summary: stats,
      changes_made: Object.keys(updates)
    };
  }

  /**
   * Discharge a patient from inpatient care
   * @param {string} journeyId - Journey ID
   * @param {Object} dischargeData - Discharge information
   * @returns {Object} Discharged journey with summary
   */
  async dischargePatient(journeyId, dischargeData) {
    const {
      discharge_type = 'routine',
      discharge_diagnosis,
      discharge_summary,
      discharge_medications,
      discharge_notes,
      final_vitals,
      follow_up_instructions,
      discharged_by_user_id,
      discharged_at = new Date().toISOString()
    } = dischargeData;

    // Validate journey exists and can be discharged
    const journey = await this.journeysRepository.findJourneyById(journeyId);
    if (!journey) {
      throw new Error('Journey not found');
    }

    if (journey.status !== 'admitted' && journey.status !== 'in_progress') {
      throw new Error(`Cannot discharge journey with status: ${journey.status}`);
    }

    // Validate required discharge data
    if (this.requireDischargeSummary && !discharge_diagnosis) {
      throw new Error('Discharge diagnosis is required');
    }

    // Calculate length of stay
    const admittedDate = new Date(journey.admitted_at);
    const dischargeDate = new Date(discharged_at);
    const lengthOfStayDays = Math.ceil((dischargeDate - admittedDate) / (1000 * 60 * 60 * 24));

    // Prepare discharge status data
    const statusData = {
      discharged_at,
      discharge_type,
      discharge_diagnosis,
      discharge_summary_jsonb: {
        summary: discharge_summary,
        medications: discharge_medications,
        final_vitals: final_vitals,
        follow_up: follow_up_instructions,
        notes: discharge_notes,
        discharged_by: discharged_by_user_id
      },
      discharge_medications_jsonb: discharge_medications || []
    };

    // Update journey status to discharged
    const dischargedJourney = await this.journeysRepository.updateJourneyStatus(
      journeyId,
      'discharged',
      statusData
    );

    // Create final discharge note if specified
    let dischargeNote = null;
    if (dischargeData.create_discharge_note !== false) {
      const noteData = {
        journey_id: journeyId,
        encounter_id: journey.encounter_id,
        patient_id: journey.patient_id,
        note_type: 'discharge',
        note_day_sequence: journey.total_daily_notes + 1,
        source: 'manual',
        status: 'approved',
        note_date: discharged_at.split('T')[0],
        note_time: discharged_at.split('T')[1].split('.')[0],
        subjective_notes: discharge_summary || `Patient discharged: ${discharge_diagnosis}`,
        objective_notes_jsonb: {
          final_vitals: final_vitals,
          discharge_condition: discharge_notes
        },
        assessment: discharge_diagnosis,
        plan: follow_up_instructions || 'Follow up as needed',
        created_by_user_id: discharged_by_user_id || 'system'
      };

      dischargeNote = await this.dailyNotesRepository.createDailyNote(noteData);
    }

    // Generate discharge summary
    const dischargeSummary = await this.generateDischargeSummary(dischargedJourney, {
      length_of_stay_days: lengthOfStayDays,
      discharge_note: dischargeNote
    });

    return {
      journey: dischargedJourney,
      discharge_note: dischargeNote,
      discharge_summary: dischargeSummary
    };
  }

  /**
   * Transfer patient to new location
   * @param {string} journeyId - Journey ID
   * @param {Object} transferData - Transfer information
   * @returns {Object} Updated journey with transfer summary
   */
  async transferPatient(journeyId, transferData) {
    const {
      new_location_id,
      new_ward,
      new_bed,
      transfer_reason,
      transfer_type = 'internal', // internal, external, clinical
      transferred_by,
      transfer_notes = '',
      emergency_transfer = false
    } = transferData;

    // Validate journey exists and is active
    const journey = await this.journeysRepository.findJourneyById(journeyId);
    if (!journey) {
      throw new Error('Journey not found');
    }

    if (journey.status !== 'admitted' && journey.status !== 'in_progress') {
      throw new Error(`Cannot transfer patient with status: ${journey.status}`);
    }

    // Validate transfer data
    if (!new_ward && !new_location_id) {
      throw new Error('Either new_ward or new_location_id must be specified');
    }

    // Use repository transfer method
    const updatedJourney = await this.journeysRepository.transferPatient(journeyId, {
      new_location_id,
      new_ward,
      new_bed,
      transfer_reason: `${transfer_type} transfer: ${transfer_reason}`,
      transferred_by
    });

    // Create transfer note if specified
    let transferNote = null;
    if (transferData.create_transfer_note !== false) {
      const noteData = {
        journey_id: journeyId,
        encounter_id: journey.encounter_id,
        patient_id: journey.patient_id,
        note_type: 'progress',
        note_day_sequence: journey.total_daily_notes + 1,
        source: 'manual',
        status: 'approved',
        note_date: new Date().toISOString().split('T')[0],
        note_time: new Date().toTimeString().split(' ')[0],
        subjective_notes: `Patient transfer: ${transfer_reason}`,
        objective_notes_jsonb: {
          transfer_type,
          from_location: { ward: journey.current_ward, bed: journey.current_bed },
          to_location: { ward: new_ward, bed: new_bed },
          emergency: emergency_transfer
        },
        assessment: `Patient transferred ${emergency_transfer ? 'emergently' : ''} to ${new_ward}`,
        plan: transfer_notes || 'Continue care in new location',
        created_by_user_id: transferred_by || 'system'
      };

      transferNote = await this.dailyNotesRepository.createDailyNote(noteData);
    }

    return {
      journey: updatedJourney,
      transfer_note: transferNote,
      transfer_summary: {
        from: { ward: journey.current_ward, bed: journey.current_bed, location: journey.current_location_id },
        to: { ward: new_ward, bed: new_bed, location: new_location_id },
        type: transfer_type,
        emergency: emergency_transfer,
        reason: transfer_reason
      }
    };
  }

  // ========================================
  // Journey Information and Statistics
  // ========================================

  /**
   * Get journey summary for display
   * @param {string} journeyId - Journey ID
   * @returns {Object} Journey summary with key information
   */
  async getJourneySummary(journeyId) {
    const journey = await this.journeysRepository.findJourneyById(journeyId);
    if (!journey) {
      throw new Error('Journey not found');
    }

    const timeline = await this.journeysRepository.getJourneyTimeline(journeyId);
    const progressStats = await this.getJourneyProgressStats(journeyId);

    return {
      journey,
      timeline: timeline.timeline,
      progress: progressStats,
      current_status: this.determineJourneyStatus(journey, progressStats),
      length_of_stay: this.calculateLengthOfStay(journey),
      risk_factors: this.identifyRiskFactors(journey, progressStats)
    };
  }

  /**
   * Get journey analytics and insights
   * @param {string} journeyId - Journey ID
   * @returns {Object} Journey analytics with trends and patterns
   */
  async getJourneyAnalytics(journeyId) {
    const journey = await this.journeysRepository.findJourneyById(journeyId);
    if (!journey) {
      throw new Error('Journey not found');
    }

    const stats = await this.getJourneyProgressStats(journeyId);
    const dailyNotes = await this.dailyNotesRepository.findNotesByJourney(journeyId);
    const integrations = await this.departmentIntegrationsRepository.findIntegrationsByJourney(journeyId);

    // Analyze patterns
    const notePatterns = this.analyzeDailyNotePatterns(dailyNotes);
    const integrationPatterns = this.analyzeIntegrationPatterns(integrations);
    const careContinuity = this.assessCareContinuity(journey, dailyNotes);

    return {
      journey_info: {
        id: journey.id,
        patient_id: journey.patient_id,
        admission_date: journey.admitted_at,
        current_status: journey.status,
        current_location: journey.current_ward,
        length_of_stay_days: this.calculateLengthOfStay(journey)
      },
      daily_notes_analysis: notePatterns,
      department_integration_analysis: integrationPatterns,
      care_continuity_assessment: careContinuity,
      recommendations: this.generateCareRecommendations(journey, stats, notePatterns)
    };
  }

  /**
   * Get patient journey history
   * @param {string} patientId - Patient ID
   * @returns {Array} Patient journey history with summaries
   */
  async getPatientJourneyHistory(patientId) {
    const journeys = await this.journeysRepository.findJourneysByPatient(patientId);

    const journeySummaries = await Promise.all(
      journeys.map(async (journey) => {
        try {
          const stats = await this.getJourneyProgressStats(journey.id);
          return {
            journey,
            summary: {
              length_of_stay_days: this.calculateLengthOfStay(journey),
              total_notes: stats.total_notes,
              total_integrations: stats.total_integrations,
              admission_type: journey.admission_type,
              discharge_type: journey.discharge_type
            }
          };
        } catch (error) {
          return {
            journey,
            summary: null,
            error: error.message
          };
        }
      })
    );

    return {
      patient_id: patientId,
      total_journeys: journeys.length,
      active_journeys: journeys.filter(j => j.status === 'admitted').length,
      journey_history: journeySummaries.sort((a, b) =>
        new Date(b.journey.admitted_at) - new Date(a.journey.admitted_at)
      )
    };
  }

  // ========================================
  // Validation and Helper Methods
  // ========================================

  /**
   * Validate admission data
   * @param {Object} admissionData - Data to validate
   * @throws {Error} If validation fails
   */
  validateAdmissionData(admissionData) {
    const requiredFields = ['encounter_id', 'patient_id'];
    const missingFields = requiredFields.filter(field => !admissionData[field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required admission fields: ${missingFields.join(', ')}`);
    }

    const validAdmissionTypes = ['routine', 'emergency', 'urgent', 'elective'];
    if (admissionData.admission_type && !validAdmissionTypes.includes(admissionData.admission_type)) {
      throw new Error(`Invalid admission_type: ${admissionData.admission_type}. Must be one of: ${validAdmissionTypes.join(', ')}`);
    }
  }

  /**
   * Get journey progress statistics
   * @param {string} journeyId - Journey ID
   * @returns {Object} Progress statistics
   */
  async getJourneyProgressStats(journeyId) {
    const notes = await this.dailyNotesRepository.findNotesByJourney(journeyId);
    const integrations = await this.departmentIntegrationsRepository.findIntegrationsByJourney(journeyId);

    return {
      total_notes: notes.length,
      notes_by_type: this.groupNotesByType(notes),
      notes_by_status: this.groupNotesByStatus(notes),
      notes_by_source: this.groupNotesBySource(notes),
      total_integrations: integrations.length,
      integrations_by_type: this.groupIntegrationsByType(integrations),
      integrations_by_status: this.groupIntegrationsByStatus(integrations),
      last_note_date: notes.length > 0 ? notes[0].note_date : null,
      last_activity: this.calculateLastActivity(notes, integrations)
    };
  }

  /**
   * Generate admission summary
   * @param {Object} journey - Journey record
   * @returns {Object} Admission summary
   */
  generateAdmissionSummary(journey) {
    return {
      journey_id: journey.id,
      patient_id: journey.patient_id,
      admission_date: journey.admitted_at,
      admission_type: journey.admission_type,
      admission_reason: journey.admission_reason,
      current_location: {
        ward: journey.current_ward,
        bed: journey.current_bed,
        location_id: journey.current_location_id
      },
      attending_physician: journey.attending_physician_id,
      expected_discharge: journey.expected_discharge_at,
      status: journey.status
    };
  }

  /**
   * Generate discharge summary
   * @param {Object} journey - Journey record
   * @param {Object} additionalData - Additional discharge data
   * @returns {Object} Discharge summary
   */
  async generateDischargeSummary(journey, additionalData = {}) {
    const stats = await this.getJourneyProgressStats(journey.id);
    const { length_of_stay_days, discharge_note } = additionalData;

    return {
      journey_id: journey.id,
      patient_id: journey.patient_id,
      admission_date: journey.admitted_at,
      discharge_date: journey.discharged_at,
      length_of_stay_days: length_of_stay_days || this.calculateLengthOfStay(journey),
      admission_type: journey.admission_type,
      discharge_type: journey.discharge_type,
      discharge_diagnosis: journey.discharge_diagnosis,
      final_location: {
        ward: journey.current_ward,
        bed: journey.current_bed
      },
      care_summary: {
        total_notes: stats.total_notes,
        total_integrations: stats.total_integrations,
        discharge_note_created: !!discharge_note
      }
    };
  }

  // ========================================
  // Analysis and Assessment Methods
  // ========================================

  /**
   * Determine overall journey status
   * @param {Object} journey - Journey record
   * @param {Object} stats - Progress statistics
   * @returns {string} Overall status assessment
   */
  determineJourneyStatus(journey, stats) {
    if (journey.status === 'discharged') {
      return 'discharged';
    }

    const daysSinceAdmission = this.calculateLengthOfStay(journey);
    const daysSinceLastNote = stats.last_note_date ?
      Math.floor((Date.now() - new Date(stats.last_note_date)) / (1000 * 60 * 60 * 24)) : 999;

    if (daysSinceLastNote > 2) {
      return 'needs_attention';
    } else if (daysSinceAdmission > 14 && journey.status === 'admitted') {
      return 'long_stay';
    } else if (daysSinceAdmission > 7 && journey.status === 'admitted') {
      return 'extended_stay';
    } else {
      return 'normal_progress';
    }
  }

  /**
   * Identify risk factors for the journey
   * @param {Object} journey - Journey record
   * @param {Object} stats - Progress statistics
   * @returns {Array} Identified risk factors
   */
  identifyRiskFactors(journey, stats) {
    const risks = [];

    // Check for long stay
    const los = this.calculateLengthOfStay(journey);
    if (los > 7) {
      risks.push({ type: 'long_stay', severity: 'medium', days: los });
    }
    if (los > 14) {
      risks.push({ type: 'extended_long_stay', severity: 'high', days: los });
    }

    // Check for lack of documentation
    const daysSinceLastNote = stats.last_note_date ?
      Math.floor((Date.now() - new Date(stats.last_note_date)) / (1000 * 60 * 60 * 24)) : 999;
    if (daysSinceLastNote > 2) {
      risks.push({ type: 'lack_documentation', severity: 'medium', days: daysSinceLastNote });
    }

    // Check for pending integrations
    const pendingIntegrations = stats.integrations_by_status?.pending || 0;
    if (pendingIntegrations > 5) {
      risks.push({ type: 'pending_integrations', severity: 'medium', count: pendingIntegrations });
    }

    // Check for failed integrations
    const failedIntegrations = stats.integrations_by_status?.failed || 0;
    if (failedIntegrations > 0) {
      risks.push({ type: 'failed_integrations', severity: 'high', count: failedIntegrations });
    }

    return risks;
  }

  /**
   * Analyze daily note patterns
   * @param {Array} notes - Daily notes array
   * @returns {Object} Pattern analysis
   */
  analyzeDailyNotePatterns(notes) {
    const patterns = {
      total_notes: notes.length,
      average_notes_per_day: 0,
      most_common_type: null,
      source_distribution: {},
      completion_rate: 0,
      documentation_quality: 'good'
    };

    if (notes.length === 0) {
      return patterns;
    }

    // Calculate source distribution
    patterns.source_distribution = this.groupNotesBySource(notes);

    // Find most common type
    const typeCounts = this.groupNotesByType(notes);
    const maxTypeCount = Math.max(...Object.values(typeCounts));
    patterns.most_common_type = Object.keys(typeCounts).find(key => typeCounts[key] === maxTypeCount);

    // Calculate completion rate (approved notes vs total)
    const approvedNotes = notes.filter(n => n.status === 'approved').length;
    patterns.completion_rate = notes.length > 0 ? (approvedNotes / notes.length) * 100 : 0;

    // Assess documentation quality
    if (patterns.completion_rate < 50) {
      patterns.documentation_quality = 'poor';
    } else if (patterns.completion_rate < 75) {
      patterns.documentation_quality = 'fair';
    }

    return patterns;
  }

  /**
   * Analyze integration patterns
   * @param {Array} integrations - Department integrations array
   * @returns {Object} Pattern analysis
   */
  analyzeIntegrationPatterns(integrations) {
    const patterns = {
      total_integrations: integrations.length,
      by_department: this.groupIntegrationsByType(integrations),
      completion_rate: 0,
      avg_processing_time: null,
      error_rate: 0
    };

    if (integrations.length === 0) {
      return patterns;
    }

    const completedIntegrations = integrations.filter(i => i.status === 'completed' || i.status === 'received');
    const failedIntegrations = integrations.filter(i => i.status === 'failed');

    patterns.completion_rate = (completedIntegrations.length / integrations.length) * 100;
    patterns.error_rate = (failedIntegrations.length / integrations.length) * 100;

    return patterns;
  }

  /**
   * Assess care continuity
   * @param {Object} journey - Journey record
   * @param {Array} notes - Daily notes array
   * @returns {Object} Continuity assessment
   */
  assessCareContinuity(journey, notes) {
    const continuity = {
      score: 'good',
      gaps_identified: [],
      handovers_count: 0,
      care_team_changes: 0
    };

    if (notes.length < 2) {
      return continuity;
    }

    // Look for documentation gaps
    const sortedNotes = [...notes].sort((a, b) => new Date(a.note_date) - new Date(b.note_date));

    for (let i = 1; i < sortedNotes.length; i++) {
      const daysDiff = Math.floor(
        (new Date(sortedNotes[i].note_date) - new Date(sortedNotes[i-1].note_date)) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff > 2) {
        continuity.gaps_identified.push({
          start: sortedNotes[i-1].note_date,
          end: sortedNotes[i].note_date,
          gap_days: daysDiff
        });
      }
    }

    // Assess overall continuity based on gaps
    if (continuity.gaps_identized.length > 3) {
      continuity.score = 'poor';
    } else if (continuity.gaps_identized.length > 0) {
      continuity.score = 'fair';
    }

    return continuity;
  }

  /**
   * Generate care recommendations
   * @param {Object} journey - Journey record
   * @param {Object} stats - Progress statistics
   * @param {Object} patterns - Note patterns
   * @returns {Array} Care recommendations
   */
  generateCareRecommendations(journey, stats, patterns) {
    const recommendations = [];

    // Check documentation quality
    if (patterns.documentation_quality === 'poor') {
      recommendations.push({
        type: 'documentation',
        priority: 'high',
        recommendation: 'Improve daily note completion rate',
        action: 'Complete and approve pending daily notes'
      });
    }

    // Check for long stay
    const los = this.calculateLengthOfStay(journey);
    if (los > 7) {
      recommendations.push({
        type: 'length_of_stay',
        priority: los > 14 ? 'high' : 'medium',
        recommendation: 'Review extended hospitalization',
        action: 'Assess discharge readiness and care plan'
      });
    }

    // Check for pending integrations
    const pendingCount = stats.integrations_by_status?.pending || 0;
    if (pendingCount > 3) {
      recommendations.push({
        type: 'integrations',
        priority: 'medium',
        recommendation: 'Process pending department integrations',
        action: 'Review and complete pending lab/radiology orders'
      });
    }

    return recommendations;
  }

  // ========================================
  // Helper and Utility Methods
  // ========================================

  /**
   * Calculate length of stay in days
   * @param {Object} journey - Journey record
   * @returns {number} Length of stay in days
   */
  calculateLengthOfStay(journey) {
    const admissionDate = new Date(journey.admitted_at);
    const endDate = journey.discharged_at ? new Date(journey.discharged_at) : new Date();
    return Math.ceil((endDate - admissionDate) / (1000 * 60 * 60 * 24));
  }

  /**
   * Calculate last activity timestamp
   * @param {Array} notes - Daily notes array
   * @param {Array} integrations - Department integrations array
   * @returns {string|null} Last activity timestamp
   */
  calculateLastActivity(notes, integrations) {
    const timestamps = [];

    notes.forEach(note => {
      timestamps.push(new Date(note.created_at));
    });

    integrations.forEach(integration => {
      timestamps.push(new Date(integration.updated_at));
    });

    return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
  }

  /**
   * Group notes by type
   * @param {Array} notes - Daily notes array
   * @returns {Object} Grouped notes by type
   */
  groupNotesByType(notes) {
    return notes.reduce((groups, note) => {
      const type = note.note_type || 'unknown';
      groups[type] = (groups[type] || 0) + 1;
      return groups;
    }, {});
  }

  /**
   * Group notes by status
   * @param {Array} notes - Daily notes array
   * @returns {Object} Grouped notes by status
   */
  groupNotesByStatus(notes) {
    return notes.reduce((groups, note) => {
      const status = note.status || 'unknown';
      groups[status] = (groups[status] || 0) + 1;
      return groups;
    }, {});
  }

  /**
   * Group notes by source
   * @param {Array} notes - Daily notes array
   * @returns {Object} Grouped notes by source
   */
  groupNotesBySource(notes) {
    return notes.reduce((groups, note) => {
      const source = note.source || 'unknown';
      groups[source] = (groups[source] || 0) + 1;
      return groups;
    }, {});
  }

  /**
   * Group integrations by type
   * @param {Array} integrations - Department integrations array
   * @returns {Object} Grouped integrations by type
   */
  groupIntegrationsByType(integrations) {
    return integrations.reduce((groups, integration) => {
      const type = integration.integration_type || 'unknown';
      groups[type] = (groups[type] || 0) + 1;
      return groups;
    }, {});
  }

  /**
   * Group integrations by status
   * @param {Array} integrations - Department integrations array
   * @returns {Object} Grouped integrations by status
   */
  groupIntegrationsByStatus(integrations) {
    return integrations.reduce((groups, integration) => {
      const status = integration.status || 'unknown';
      groups[status] = (groups[status] || 0) + 1;
      return groups;
    }, {});
  }
}

module.exports = { InpatientJourneyService };