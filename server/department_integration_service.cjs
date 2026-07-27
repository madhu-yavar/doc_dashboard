/**
 * Department Integration Service - Phase 2: Service Layer (Business Logic)
 *
 * Orchestrates department integrations for inpatient journeys.
 * Handles external system communication for lab, radiology, pharmacy, and billing.
 *
 * Responsibilities:
 * - Order creation and management (lab, radiology, pharmacy)
 * - Results processing and normalization
 * - External system communication
 * - Batch import/export operations
 * - Error handling and retry logic
 * - Integration monitoring and reporting
 */

const { DepartmentIntegrationsRepository } = require('./repositories/department_integrations_repository.cjs');
const { InpatientJourneysRepository } = require('./repositories/inpatient_journeys_repository.cjs');
const { DailyNotesRepository } = require('./repositories/daily_notes_repository.cjs');

class DepartmentIntegrationService {
  constructor(config = {}) {
    this.name = 'DepartmentIntegrationService';
    this.departmentIntegrationsRepository = config.departmentIntegrationsRepository || new DepartmentIntegrationsRepository();
    this.journeysRepository = config.journeysRepository || new InpatientJourneysRepository();
    this.dailyNotesRepository = config.dailyNotesRepository || new DailyNotesRepository();

    // Interop service for external system communication
    this.interopRepository = config.interopRepository || null;

    // Configuration options
    this.autoRetryFailedIntegrations = config.autoRetryFailedIntegrations !== false; // default true
    this.maxRetryAttempts = config.maxRetryAttempts || 3;
    this.retryDelayMs = config.retryDelayMs || 60000; // 1 minute default
    this.enableHL7Processing = config.enableHL7Processing !== false; // default true
    this.enableFHIRProcessing = config.enableFHIRProcessing !== false; // default true
    this.batchSyncInterval = config.batchSyncInterval || 3600000; // 1 hour default
  }

  /**
   * Initialize the service and its repositories
   */
  async initialize() {
    await this.departmentIntegrationsRepository.initialize();
    await this.journeysRepository.initialize();
    await this.dailyNotesRepository.initialize();

    // Initialize interop service if provided
    if (this.interopRepository && this.interopRepository.initialize) {
      await this.interopRepository.initialize();
    }
  }

  // ========================================
  // Lab Orders and Results
  // ========================================

  /**
   * Create a lab order
   * @param {Object} orderData - Lab order information
   * @returns {Object} Created integration record
   */
  async createLabOrder(orderData) {
    const {
      journey_id,
      daily_note_id,
      encounter_id,
      patient_id,
      lab_tests,
      priority = 'routine',
      ordered_by,
      ordering_physician,
      clinical_indications = '',
      specimen_details = {},
      auto_send = true
    } = orderData;

    // Validate journey exists and is active
    const journey = await this.journeysRepository.findJourneyById(journey_id);
    if (!journey) {
      throw new Error('Journey not found');
    }

    if (journey.status !== 'admitted' && journey.status !== 'in_progress') {
      throw new Error(`Cannot create lab order for journey with status: ${journey.status}`);
    }

    // Validate lab tests data
    if (!lab_tests || !Array.isArray(lab_tests) || lab_tests.length === 0) {
      throw new Error('Lab tests array is required');
    }

    // Generate external order ID
    const external_order_id = this.generateExternalOrderId('lab', journey_id);

    // Prepare order payload
    const order_payload_jsonb = {
      lab_tests: lab_tests,
      priority,
      ordered_by,
      ordering_physician,
      clinical_indications,
      specimen_details,
      patient_info: {
        patient_id,
        encounter_id,
        journey_id,
        current_location: journey.current_ward,
        attending_physician: journey.attending_physician_id
      },
      order_timestamp: new Date().toISOString()
    };

    // Create integration record
    const integrationData = {
      journey_id,
      daily_note_id,
      encounter_id,
      patient_id,
      integration_type: 'lab',
      direction: 'outbound',
      external_order_id,
      order_payload_jsonb,
      status: 'pending'
    };

    const integration = await this.departmentIntegrationsRepository.createIntegration(integrationData);

    // Auto-send to external system if enabled
    let sendResult = null;
    if (auto_send) {
      sendResult = await this.sendLabOrderToExternalSystem(integration.id, order_payload_jsonb);
    }

    return {
      integration,
      send_result: sendResult,
      order_summary: {
        order_id: external_order_id,
        integration_id: integration.id,
        lab_tests_count: lab_tests.length,
        priority,
        status: integration.status
      }
    };
  }

  /**
   * Process lab results from external system
   * @param {Object} resultsData - Lab results information
   * @returns {Object} Processed integration record
   */
  async processLabResults(resultsData) {
    const {
      external_result_id,
      external_order_id,
      patient_id,
      encounter_id,
      journey_id,
      lab_results,
      processing_timestamp = new Date().toISOString(),
      auto_link_to_note = true,
      critical_values = []
    } = resultsData;

    // Find corresponding order if available
    let existingOrder = null;
    if (external_order_id) {
      const orderResults = await this.departmentIntegrationsRepository.searchIntegrations({
        external_order_id,
        integration_type: 'lab'
      });
      existingOrder = orderResults.length > 0 ? orderResults[0] : null;
    }

    // Validate patient/journey if linking to existing order
    const targetJourneyId = journey_id || (existingOrder?.journey_id);
    const targetPatientId = patient_id || (existingOrder?.patient_id);

    if (targetJourneyId) {
      const journey = await this.journeysRepository.findJourneyById(targetJourneyId);
      if (!journey) {
        throw new Error('Journey not found');
      }
    }

    // Normalize lab results data
    const normalized_payload_jsonb = this.normalizeLabResults(lab_results);

    // Prepare result payload
    const result_payload_jsonb = {
      external_result_id,
      external_order_id,
      lab_results,
      normalized_results: normalized_payload_jsonb,
      processing_timestamp,
      critical_values,
      result_status: this.determineLabResultStatus(normalized_payload_jsonb)
    };

    // Create or update integration record
    let integration;
    if (existingOrder) {
      // Update existing order with results
      integration = await this.departmentIntegrationsRepository.updateIntegrationStatus(
        existingOrder.id,
        'completed',
        {
          completed_at: processing_timestamp,
          result_payload_jsonb,
          normalized_payload_jsonb,
          external_result_id
        }
      );
    } else {
      // Create new inbound integration
      integration = await this.departmentIntegrationsRepository.createIntegration({
        journey_id: targetJourneyId,
        encounter_id,
        patient_id: targetPatientId,
        integration_type: 'lab',
        direction: 'inbound',
        external_result_id,
        external_order_id,
        result_payload_jsonb,
        normalized_payload_jsonb,
        status: 'completed',
        completed_at: processing_timestamp
      });
    }

    // Handle critical values
    if (critical_values.length > 0) {
      await this.handleCriticalLabValues(integration.id, critical_values, targetJourneyId);
    }

    // Auto-link to daily note if enabled
    let linkedNote = null;
    if (auto_link_to_note && targetJourneyId) {
      linkedNote = await this.linkLabResultsToDailyNote(integration.id, targetJourneyId);
    }

    return {
      integration,
      linked_note: linkedNote,
      processing_summary: {
        results_processed: lab_results.length || 1,
        critical_values_found: critical_values.length,
        linked_to_note: !!linkedNote,
        result_status: result_payload_jsonb.result_status
      }
    };
  }

  // ========================================
  // Radiology Orders and Results
  // ========================================

  /**
   * Create a radiology order
   * @param {Object} orderData - Radiology order information
   * @returns {Object} Created integration record
   */
  async createRadiologyOrder(orderData) {
    const {
      journey_id,
      daily_note_id,
      encounter_id,
      patient_id,
      radiology_procedures,
      priority = 'routine',
      ordered_by,
      ordering_physician,
      clinical_indications = '',
      patient_preparation = '',
      auto_send = true
    } = orderData;

    // Validate journey exists and is active
    const journey = await this.journeysRepository.findJourneyById(journey_id);
    if (!journey) {
      throw new Error('Journey not found');
    }

    if (journey.status !== 'admitted' && journey.status !== 'in_progress') {
      throw new Error(`Cannot create radiology order for journey with status: ${journey.status}`);
    }

    // Validate radiology procedures data
    if (!radiology_procedures || !Array.isArray(radiology_procedures) || radiology_procedures.length === 0) {
      throw new Error('Radiology procedures array is required');
    }

    // Generate external order ID
    const external_order_id = this.generateExternalOrderId('radiology', journey_id);

    // Prepare order payload
    const order_payload_jsonb = {
      radiology_procedures: radiology_procedures,
      priority,
      ordered_by,
      ordering_physician,
      clinical_indications,
      patient_preparation,
      patient_info: {
        patient_id,
        encounter_id,
        journey_id,
        current_location: journey.current_ward,
        attending_physician: journey.attending_physician_id
      },
      order_timestamp: new Date().toISOString()
    };

    // Create integration record
    const integrationData = {
      journey_id,
      daily_note_id,
      encounter_id,
      patient_id,
      integration_type: 'radiology',
      direction: 'outbound',
      external_order_id,
      order_payload_jsonb,
      status: 'pending'
    };

    const integration = await this.departmentIntegrationsRepository.createIntegration(integrationData);

    // Auto-send to external system if enabled
    let sendResult = null;
    if (auto_send) {
      sendResult = await this.sendRadiologyOrderToExternalSystem(integration.id, order_payload_jsonb);
    }

    return {
      integration,
      send_result: sendResult,
      order_summary: {
        order_id: external_order_id,
        integration_id: integration.id,
        procedures_count: radiology_procedures.length,
        priority,
        status: integration.status
      }
    };
  }

  /**
   * Process radiology results from external system
   * @param {Object} resultsData - Radiology results information
   * @returns {Object} Processed integration record
   */
  async processRadiologyResults(resultsData) {
    const {
      external_result_id,
      external_order_id,
      patient_id,
      encounter_id,
      journey_id,
      radiology_reports,
      imaging_studies = [],
      processing_timestamp = new Date().toISOString(),
      auto_link_to_note = true,
      urgent_findings = []
    } = resultsData;

    // Find corresponding order if available
    let existingOrder = null;
    if (external_order_id) {
      const orderResults = await this.departmentIntegrationsRepository.searchIntegrations({
        external_order_id,
        integration_type: 'radiology'
      });
      existingOrder = orderResults.length > 0 ? orderResults[0] : null;
    }

    // Target journey and patient
    const targetJourneyId = journey_id || (existingOrder?.journey_id);
    const targetPatientId = patient_id || (existingOrder?.patient_id);

    if (targetJourneyId) {
      const journey = await this.journeysRepository.findJourneyById(targetJourneyId);
      if (!journey) {
        throw new Error('Journey not found');
      }
    }

    // Normalize radiology results data
    const normalized_payload_jsonb = this.normalizeRadiologyResults(radiology_reports, imaging_studies);

    // Prepare result payload
    const result_payload_jsonb = {
      external_result_id,
      external_order_id,
      radiology_reports,
      imaging_studies,
      normalized_results: normalized_payload_jsonb,
      processing_timestamp,
      urgent_findings,
      result_status: this.determineRadiologyResultStatus(normalized_payload_jsonb)
    };

    // Create or update integration record
    let integration;
    if (existingOrder) {
      integration = await this.departmentIntegrationsRepository.updateIntegrationStatus(
        existingOrder.id,
        'completed',
        {
          completed_at: processing_timestamp,
          result_payload_jsonb,
          normalized_payload_jsonb,
          external_result_id
        }
      );
    } else {
      integration = await this.departmentIntegrationsRepository.createIntegration({
        journey_id: targetJourneyId,
        encounter_id,
        patient_id: targetPatientId,
        integration_type: 'radiology',
        direction: 'inbound',
        external_result_id,
        external_order_id,
        result_payload_jsonb,
        normalized_payload_jsonb,
        status: 'completed',
        completed_at: processing_timestamp
      });
    }

    // Handle urgent findings
    if (urgent_findings.length > 0) {
      await this.handleUrgentRadiologyFindings(integration.id, urgent_findings, targetJourneyId);
    }

    // Auto-link to daily note if enabled
    let linkedNote = null;
    if (auto_link_to_note && targetJourneyId) {
      linkedNote = await this.linkRadiologyResultsToDailyNote(integration.id, targetJourneyId);
    }

    return {
      integration,
      linked_note: linkedNote,
      processing_summary: {
        reports_processed: radiology_reports.length || 1,
        urgent_findings_found: urgent_findings.length,
        linked_to_note: !!linkedNote,
        result_status: result_payload_jsonb.result_status
      }
    };
  }

  // ========================================
  // External System Communication
  // ========================================

  /**
   * Send lab order to external system
   * @param {string} integrationId - Integration ID
   * @param {Object} orderPayload - Order payload
   * @returns {Object} Send result
   */
  async sendLabOrderToExternalSystem(integrationId, orderPayload) {
    if (!this.interopRepository) {
      throw new Error('Interop repository not configured');
    }

    try {
      // Generate HL7 message if enabled
      let hl7Message = null;
      if (this.enableHL7Processing) {
        hl7Message = this.generateHL7LabOrder(orderPayload);
      }

      // Send to external system via interop repository
      const sendResult = await this.interopRepository.sendLabOrder(orderPayload);

      // Update integration status based on send result
      if (sendResult.success) {
        await this.departmentIntegrationsRepository.updateIntegrationStatus(
          integrationId,
          'sent',
          { completed_at: new Date().toISOString() }
        );
      } else {
        await this.departmentIntegrationsRepository.updateIntegrationStatus(
          integrationId,
          'failed',
          { error_message: sendResult.error }
        );
      }

      return sendResult;

    } catch (error) {
      // Mark integration as failed
      await this.departmentIntegrationsRepository.updateIntegrationStatus(
        integrationId,
        'failed',
        { error_message: error.message }
      );

      // Schedule retry if enabled
      if (this.autoRetryFailedIntegrations) {
        await this.scheduleRetry(integrationId, 'lab_order');
      }

      throw error;
    }
  }

  /**
   * Send radiology order to external system
   * @param {string} integrationId - Integration ID
   * @param {Object} orderPayload - Order payload
   * @returns {Object} Send result
   */
  async sendRadiologyOrderToExternalSystem(integrationId, orderPayload) {
    if (!this.interopRepository) {
      throw new Error('Interop repository not configured');
    }

    try {
      // Generate HL7 message if enabled
      let hl7Message = null;
      if (this.enableHL7Processing) {
        hl7Message = this.generateHL7RadiologyOrder(orderPayload);
      }

      // Send to external system via interop repository
      const sendResult = await this.interopRepository.sendRadiologyOrder(orderPayload);

      // Update integration status based on send result
      if (sendResult.success) {
        await this.departmentIntegrationsRepository.updateIntegrationStatus(
          integrationId,
          'sent',
          { completed_at: new Date().toISOString() }
        );
      } else {
        await this.departmentIntegrationsRepository.updateIntegrationStatus(
          integrationId,
          'failed',
          { error_message: sendResult.error }
        );
      }

      return sendResult;

    } catch (error) {
      // Mark integration as failed
      await this.departmentIntegrationsRepository.updateIntegrationStatus(
        integrationId,
        'failed',
        { error_message: error.message }
      );

      // Schedule retry if enabled
      if (this.autoRetryFailedIntegrations) {
        await this.scheduleRetry(integrationId, 'radiology_order');
      }

      throw error;
    }
  }

  // ========================================
  // Batch Import/Export Operations
  // ========================================

  /**
   * Export pending lab orders
   * @param {Object} filters - Export filters
   * @returns {Object} Export result
   */
  async exportPendingLabOrders(filters = {}) {
    const {
      status = ['pending'],
      limit = 100,
      date_from = null,
      date_to = null
    } = filters;

    // Get pending lab orders
    const pendingOrders = await this.departmentIntegrationsRepository.findPendingIntegrations({
      integration_type: 'lab',
      direction: 'outbound',
      limit
    });

    if (pendingOrders.length === 0) {
      return {
        exported_count: 0,
        orders: [],
        export_summary: 'No pending lab orders found'
      };
    }

    // Process each order
    const exportResults = [];
    let exportedCount = 0;
    let failedCount = 0;

    for (const order of pendingOrders) {
      try {
        const orderPayload = this.departmentIntegrationsRepository.fromJSONB(order.order_payload_jsonb);
        const sendResult = await this.sendLabOrderToExternalSystem(order.id, orderPayload);

        if (sendResult.success) {
          exportedCount++;
          exportResults.push({ integration_id: order.id, status: 'exported', external_id: sendResult.external_id });
        } else {
          failedCount++;
          exportResults.push({ integration_id: order.id, status: 'failed', error: sendResult.error });
        }
      } catch (error) {
        failedCount++;
        exportResults.push({ integration_id: order.id, status: 'error', error: error.message });
      }
    }

    return {
      exported_count: exportedCount,
      failed_count: failedCount,
      total_processed: pendingOrders.length,
      orders: exportResults,
      export_summary: `Exported ${exportedCount} lab orders, ${failedCount} failed`
    };
  }

  /**
   * Import lab results from external system
   * @param {Object} importData - Import configuration
   * @returns {Object} Import result
   */
  async importLabResults(importData) {
    const {
      external_system_id,
      date_from = null,
      date_to = null,
      max_results = 100,
      auto_process = true
    } = importData;

    if (!this.interopRepository) {
      throw new Error('Interop repository not configured');
    }

    try {
      // Fetch lab results from external system
      const externalResults = await this.interopRepository.fetchLabResults({
        external_system_id,
        date_from,
        date_to,
        max_results
      });

      if (!externalResults || externalResults.length === 0) {
        return {
          imported_count: 0,
          results: [],
          import_summary: 'No lab results found to import'
        };
      }

      // Process each result
      const importResults = [];
      let importedCount = 0;
      let failedCount = 0;

      for (const result of externalResults) {
        try {
          if (auto_process) {
            const processedResult = await this.processLabResults({
              external_result_id: result.external_id,
              external_order_id: result.external_order_id,
              patient_id: result.patient_id,
              encounter_id: result.encounter_id,
              lab_results: result.lab_results,
              processing_timestamp: result.timestamp
            });

            importedCount++;
            importResults.push({
              external_id: result.external_id,
              status: 'imported',
              integration_id: processedResult.integration.id
            });
          } else {
            importResults.push({
              external_id: result.external_id,
              status: 'fetched',
              data: result
            });
          }
        } catch (error) {
          failedCount++;
          importResults.push({
            external_id: result.external_id,
            status: 'failed',
            error: error.message
          });
        }
      }

      return {
        imported_count: importedCount,
        failed_count: failedCount,
        total_fetched: externalResults.length,
        results: importResults,
        import_summary: `Imported ${importedCount} lab results, ${failedCount} failed`
      };

    } catch (error) {
      throw new Error(`Lab results import failed: ${error.message}`);
    }
  }

  /**
   * Get integration status for a journey
   * @param {string} journeyId - Journey ID
   * @returns {Object} Integration status summary
   */
  async getIntegrationStatus(journeyId) {
    return await this.departmentIntegrationsRepository.getJourneyIntegrationStatus(journeyId);
  }

  /**
   * Get integrations requiring attention
   * @param {Object} criteria - Search criteria
   * @returns {Array} Integrations needing attention
   */
  async getIntegrationsRequiringAttention(criteria = {}) {
    const {
      integration_type = null,
      limit = 50
    } = criteria;

    const integrations = await this.departmentIntegrationsRepository.getIntegrationsRequiringAttention({
      pending_hours: 4,
      failed_recently_hours: 24,
      limit
    });

    // Enrich with urgency assessment and recommended actions
    return integrations.map(integration => ({
      ...integration,
      urgency: this.assessIntegrationUrgency(integration),
      recommended_action: this.recommendActionForIntegration(integration)
    }));
  }

  // ========================================
  // Error Handling and Retry Logic
  // ========================================

  /**
   * Retry failed integrations
   * @param {string} integrationId - Integration ID
   * @returns {Object} Retry result
   */
  async retryFailedIntegration(integrationId) {
    const integration = await this.departmentIntegrationsRepository.findIntegrationById(integrationId);
    if (!integration) {
      throw new Error('Integration not found');
    }

    if (integration.status !== 'failed') {
      throw new Error(`Cannot retry integration with status: ${integration.status}`);
    }

    const retryCount = this.departmentIntegrationsRepository.fromJSONB(integration.journey_metadata_jsonb || '{}').retry_count || 0;

    if (retryCount >= this.maxRetryAttempts) {
      throw new Error('Max retry attempts exceeded');
    }

    // Update retry count and status
    const metadata = this.departmentIntegrationsRepository.fromJSONB(integration.journey_metadata_jsonb || '{}');
    metadata.retry_count = retryCount + 1;
    metadata.last_retry_at = new Date().toISOString();

    await this.departmentIntegrationsRepository.updateIntegration(integrationId, {
      journey_metadata_jsonb: metadata
    });

    // Reset to pending for retry
    const resetIntegration = await this.departmentIntegrationsRepository.updateIntegrationStatus(
      integrationId,
      'pending',
      { error_message: null }
    );

    // Process based on integration type and direction
    let result;
    if (integration.direction === 'outbound' && integration.integration_type === 'lab') {
      const orderPayload = this.departmentIntegrationsRepository.fromJSONB(integration.order_payload_jsonb);
      result = await this.sendLabOrderToExternalSystem(integrationId, orderPayload);
    } else if (integration.direction === 'outbound' && integration.integration_type === 'radiology') {
      const orderPayload = this.departmentIntegrationsRepository.fromJSONB(integration.order_payload_jsonb);
      result = await this.sendRadiologyOrderToExternalSystem(integrationId, orderPayload);
    } else {
      throw new Error(`Retry not implemented for ${integration.direction} ${integration.integration_type}`);
    }

    return {
      integration: resetIntegration,
      retry_result: result,
      retry_summary: {
        attempt: retryCount + 1,
        max_attempts: this.maxRetryAttempts,
        success: result.success
      }
    };
  }

  /**
   * Schedule retry for failed integration
   * @param {string} integrationId - Integration ID
   * @param {string} integrationType - Type of integration
   * @returns {boolean} Success status
   */
  async scheduleRetry(integrationId, integrationType) {
    // In a real implementation, this would use a job queue or scheduler
    // For now, we'll store retry information in metadata
    try {
      const integration = await this.departmentIntegrationsRepository.findIntegrationById(integrationId);
      if (!integration) {
        return false;
      }

      const metadata = this.departmentIntegrationsRepository.fromJSONB(integration.journey_metadata_jsonb || '{}');
      metadata.scheduled_retry = true;
      metadata.retry_after = new Date(Date.now() + this.retryDelayMs).toISOString();

      await this.departmentIntegrationsRepository.updateIntegration(integrationId, {
        journey_metadata_jsonb: metadata
      });

      return true;
    } catch (error) {
      console.error('Failed to schedule retry:', error);
      return false;
    }
  }

  // ========================================
  // Statistics and Monitoring
  // ========================================

  /**
   * Get integration statistics
   * @param {Object} filters - Statistic filters
   * @returns {Object} Integration statistics
   */
  async getIntegrationStats(filters = {}) {
    return await this.departmentIntegrationsRepository.getIntegrationStats(filters);
  }

  /**
   * Get integration errors for monitoring
   * @param {Object} filters - Error filter criteria
   * @returns {Array} Failed integration records
   */
  async getIntegrationErrors(filters = {}) {
    return await this.departmentIntegrationsRepository.getIntegrationErrors(filters);
  }

  // ========================================
  // Helper and Normalization Methods
  // ========================================

  /**
   * Generate external order ID
   * @param {string} integrationType - Type of integration
   * @param {string} journeyId - Journey ID
   * @returns {string} Generated external order ID
   */
  generateExternalOrderId(integrationType, journeyId) {
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').substring(0, 14);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${integrationType.toUpperCase()}-${timestamp}-${random}`;
  }

  /**
   * Normalize lab results data
   * @param {Array} labResults - Raw lab results
   * @returns {Object} Normalized lab results
   */
  normalizeLabResults(labResults) {
    if (!Array.isArray(labResults)) {
      labResults = [labResults];
    }

    return {
      total_tests: labResults.length,
      abnormal_count: labResults.filter(r => r.abnormal).length,
      critical_count: labResults.filter(r => r.critical).length,
      tests: labResults.map(result => ({
        test_code: result.test_code,
        test_name: result.test_name,
        result_value: result.value,
        unit: result.unit,
        reference_range: result.reference_range,
        abnormal: result.abnormal || false,
        critical: result.critical || false,
        interpretation: result.interpretation
      }))
    };
  }

  /**
   * Normalize radiology results data
   * @param {Array} radiologyReports - Raw radiology reports
   * @param {Array} imagingStudies - Imaging studies data
   * @returns {Object} Normalized radiology results
   */
  normalizeRadiologyResults(radiologyReports, imagingStudies = []) {
    if (!Array.isArray(radiologyReports)) {
      radiologyReports = [radiologyReports];
    }

    return {
      total_reports: radiologyReports.length,
      urgent_findings_count: radiologyReports.filter(r => r.urgent).length,
      reports: radiologyReports.map(report => ({
        procedure_code: report.procedure_code,
        procedure_name: report.procedure_name,
        findings: report.findings,
        impression: report.impression,
        urgent: report.urgent || false,
        recommendation: report.recommendation
      })),
      imaging_studies: imagingStudies.map(study => ({
        study_type: study.study_type,
        image_count: study.image_count || 0,
        study_date: study.study_date,
        modality: study.modality
      }))
    };
  }

  /**
   * Determine lab result status
   * @param {Object} normalizedResults - Normalized lab results
   * @returns {string} Result status
   */
  determineLabResultStatus(normalizedResults) {
    if (normalizedResults.critical_count > 0) {
      return 'critical';
    } else if (normalizedResults.abnormal_count > 0) {
      return 'abnormal';
    } else {
      return 'normal';
    }
  }

  /**
   * Determine radiology result status
   * @param {Object} normalizedResults - Normalized radiology results
   * @returns {string} Result status
   */
  determineRadiologyResultStatus(normalizedResults) {
    if (normalizedResults.urgent_findings_count > 0) {
      return 'urgent';
    } else if (normalizedResults.reports.some(r => r.urgent)) {
      return 'abnormal';
    } else {
      return 'normal';
    }
  }

  /**
   * Handle critical lab values
   * @param {string} integrationId - Integration ID
   * @param {Array} criticalValues - Critical values found
   * @param {string} journeyId - Journey ID
   * @returns {Object} Handling result
   */
  async handleCriticalLabValues(integrationId, criticalValues, journeyId) {
    // Create notification or alert for critical values
    const alertData = {
      journey_id,
      integration_id: integrationId,
      alert_type: 'critical_lab_value',
      severity: 'high',
      message: `Critical lab values detected: ${criticalValues.map(v => v.test_name).join(', ')}`,
      critical_values: criticalValues,
      requires_immediate_action: true
    };

    // In a real implementation, this would create alerts/notifications
    console.log('CRITICAL LAB VALUE ALERT:', alertData);

    return { alert_created: true, alert_data: alertData };
  }

  /**
   * Handle urgent radiology findings
   * @param {string} integrationId - Integration ID
   * @param {Array} urgentFindings - Urgent findings
   * @param {string} journeyId - Journey ID
   * @returns {Object} Handling result
   */
  async handleUrgentRadiologyFindings(integrationId, urgentFindings, journeyId) {
    // Create notification or alert for urgent findings
    const alertData = {
      journey_id,
      integration_id: integrationId,
      alert_type: 'urgent_radiology_finding',
      severity: 'high',
      message: `Urgent radiology findings detected: ${urgentFindings.map(f => f.procedure_name).join(', ')}`,
      urgent_findings: urgentFindings,
      requires_immediate_action: true
    };

    // In a real implementation, this would create alerts/notifications
    console.log('URGENT RADIOLOGY FINDING ALERT:', alertData);

    return { alert_created: true, alert_data: alertData };
  }

  /**
   * Link lab results to daily note
   * @param {string} integrationId - Integration ID
   * @param {string} journeyId - Journey ID
   * @returns {Object} Created/updated daily note
   */
  async linkLabResultsToDailyNote(integrationId, journeyId) {
    const integration = await this.departmentIntegrationsRepository.findIntegrationById(integrationId);
    if (!integration) {
      throw new Error('Integration not found');
    }

    // Get most recent progress note
    const latestNote = await this.dailyNotesRepository.findLatestNoteByType(journeyId, 'progress');

    if (!latestNote) {
      // Create a new note if no progress note exists
      const journey = await this.journeysRepository.findJourneyById(journeyId);
      const noteData = {
        journey_id: journeyId,
        encounter_id: journey.encounter_id,
        patient_id: journey.patient_id,
        note_type: 'progress',
        note_day_sequence: 1,
        source: 'manual',
        status: 'draft',
        note_date: new Date().toISOString().split('T')[0],
        note_time: new Date().toTimeString().split(' ')[0],
        subjective_notes: 'Lab results received',
        objective_notes_jsonb: {},
        assessment: 'Lab results available',
        plan: 'Review lab results',
        created_by_user_id: 'system'
      };

      return await this.dailyNotesRepository.createDailyNote(noteData);
    } else {
      // Update existing note with lab results reference
      const labResultsJsonb = this.dailyNotesRepository.fromJSONB(latestNote.lab_results_jsonb || '{}');
      const newLabResults = Array.isArray(labResultsJsonb) ? labResultsJsonb : [];

      newLabResults.push({
        integration_id: integrationId,
        external_result_id: integration.external_result_id,
        received_at: new Date().toISOString()
      });

      return await this.dailyNotesRepository.updateNote(latestNote.id, {
        lab_results_jsonb: newLabResults
      });
    }
  }

  /**
   * Link radiology results to daily note
   * @param {string} integrationId - Integration ID
   * @param {string} journeyId - Journey ID
   * @returns {Object} Created/updated daily note
   */
  async linkRadiologyResultsToDailyNote(integrationId, journeyId) {
    const integration = await this.departmentIntegrationsRepository.findIntegrationById(integrationId);
    if (!integration) {
      throw new Error('Integration not found');
    }

    // Get most recent progress note
    const latestNote = await this.dailyNotesRepository.findLatestNoteByType(journeyId, 'progress');

    if (!latestNote) {
      // Create a new note if no progress note exists
      const journey = await this.journeysRepository.findJourneyById(journeyId);
      const noteData = {
        journey_id: journeyId,
        encounter_id: journey.encounter_id,
        patient_id: journey.patient_id,
        note_type: 'progress',
        note_day_sequence: 1,
        source: 'manual',
        status: 'draft',
        note_date: new Date().toISOString().split('T')[0],
        note_time: new Date().toTimeString().split(' ')[0],
        subjective_notes: 'Radiology results received',
        objective_notes_jsonb: {},
        assessment: 'Radiology results available',
        plan: 'Review radiology results',
        created_by_user_id: 'system'
      };

      return await this.dailyNotesRepository.createDailyNote(noteData);
    } else {
      // Update existing note with radiology results reference
      const radResultsJsonb = this.dailyNotesRepository.fromJSONB(latestNote.radiology_results_jsonb || '{}');
      const newRadResults = Array.isArray(radResultsJsonb) ? radResultsJsonb : [];

      newRadResults.push({
        integration_id: integrationId,
        external_result_id: integration.external_result_id,
        received_at: new Date().toISOString()
      });

      return await this.dailyNotesRepository.updateNote(latestNote.id, {
        radiology_results_jsonb: newRadResults
      });
    }
  }

  /**
   * Generate HL7 lab order message
   * @param {Object} orderPayload - Order payload
   * @returns {string} HL7 message
   */
  generateHL7LabOrder(orderPayload) {
    // In a real implementation, this would generate proper HL7 ORM^O01 message
    // For now, return a placeholder
    const hl7Message = `MSH|^~\\&|DOCTOR_DASHBOARD|HOSPITAL|2000||ORM^O01|${this.generateExternalOrderId('hl7', 'lab')}|P|2.5|||ER|AL
ORC|RE||${orderPayload.patient_info.patient_id}||||||||${orderPayload.priority}|${orderPayload.ordered_by}|${orderPayload.ordering_physician}
OBR|1||${orderPayload.lab_tests[0]?.test_code}||${orderPayload.lab_tests[0]?.test_name}||${orderPayload.priority}||${orderPayload.clinical_indications}
OBX|1|NM|${orderPayload.lab_tests[0]?.test_code}|${orderPayload.lab_tests[0]?.test_name}|1|${orderPayload.lab_tests[0]?.unit}|||||F|||${orderPayload.order_timestamp}|||${orderPayload.patient_info.patient_id}`;

    return hl7Message;
  }

  /**
   * Generate HL7 radiology order message
   * @param {Object} orderPayload - Order payload
   * @returns {string} HL7 message
   */
  generateHL7RadiologyOrder(orderPayload) {
    // In a real implementation, this would generate proper HL7 ORM^O01 message
    // For now, return a placeholder
    const hl7Message = `MSH|^~\\&|DOCTOR_DASHBOARD|HOSPITAL|2000||ORM^O01|${this.generateExternalOrderId('hl7', 'radiology')}|P|2.5|||ER|AL
ORC|RE||${orderPayload.patient_info.patient_id}||||||||${orderPayload.priority}|${orderPayload.ordered_by}|${orderPayload.ordering_physician}
OBR|1||${orderPayload.radiology_procedures[0]?.procedure_code}||${orderPayload.radiology_procedures[0]?.procedure_name}||${orderPayload.priority}||${orderPayload.clinical_indications}
OBX|1|TX|${orderPayload.radiology_procedures[0]?.procedure_code}||${orderPayload.radiology_procedures[0]?.procedure_name}|1|||||||||F|||${orderPayload.order_timestamp}|||${orderPayload.patient_info.patient_id}`;

    return hl7Message;
  }

  /**
   * Assess integration urgency
   * @param {Object} integration - Integration record
   * @returns {string} Urgency level
   */
  assessIntegrationUrgency(integration) {
    if (integration.status === 'failed') {
      return 'high';
    } else if (integration.status === 'pending') {
      const hoursPending = integration.created_at ?
        Math.floor((Date.now() - new Date(integration.created_at)) / (1000 * 60 * 60)) : 999;
      return hoursPending > 4 ? 'high' : 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Recommend action for integration
   * @param {Object} integration - Integration record
   * @returns {string} Recommended action
   */
  recommendActionForIntegration(integration) {
    if (integration.status === 'failed') {
      return 'retry_integration';
    } else if (integration.status === 'pending') {
      return 'send_to_external_system';
    } else if (integration.status === 'sent') {
      return 'monitor_for_completion';
    } else if (integration.status === 'completed') {
      return 'review_results';
    } else {
      return 'no_action';
    }
  }

  /**
   * Clean up service resources
   */
  async cleanup() {
    try {
      if (this.departmentIntegrationsRepository) await this.departmentIntegrationsRepository.close();
      if (this.journeysRepository) await this.journeysRepository.close();
      if (this.dailyNotesRepository) await this.dailyNotesRepository.close();
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

module.exports = { DepartmentIntegrationService };