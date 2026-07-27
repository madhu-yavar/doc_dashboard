/**
 * Department Integration Service Tests
 *
 * Comprehensive test suite for DepartmentIntegrationService functionality
 * including lab, radiology, consultation, and medication workflows
 */

const { DepartmentIntegrationService } = require('../../department_integration_service.cjs');

// Mock repositories and external services
class MockDepartmentIntegrationsRepository {
  constructor() {
    this.initialize = jest.fn().mockResolvedValue(true);
    this.close = jest.fn().mockResolvedValue(true);
    this.createIntegration = jest.fn().mockResolvedValue({
      id: 'integration-1',
      status: 'pending',
      integration_type: 'lab'
    });
    this.findIntegrationById = jest.fn().mockResolvedValue({
      id: 'integration-1',
      status: 'pending',
      integration_type: 'lab'
    });
    this.findIntegrationsByJourney = jest.fn().mockResolvedValue([]);
    this.findIntegrationsByExternalRef = jest.fn().mockResolvedValue([]);
    this.updateIntegrationStatus = jest.fn().mockResolvedValue({
      id: 'integration-1',
      status: 'sent'
    });
    this.findIntegrationsWithFilters = jest.fn().mockResolvedValue([]);
  }

  reset() {
    this.createIntegration.mockClear();
    this.findIntegrationById.mockClear();
    this.updateIntegrationStatus.mockClear();
  }
}

class MockJourneysRepository {
  constructor() {
    this.initialize = jest.fn().mockResolvedValue(true);
    this.close = jest.fn().mockResolvedValue(true);
    this.findJourneyById = jest.fn().mockResolvedValue({
      id: 'journey-1',
      patient_id: 'patient-1',
      status: 'admitted'
    });
  }

  reset() {
    this.findJourneyById.mockClear();
  }
}

class MockDailyNotesRepository {
  constructor() {
    this.initialize = jest.fn().mockResolvedValue(true);
    this.close = jest.fn().mockResolvedValue(true);
    this.createDailyNote = jest.fn().mockResolvedValue({
      id: 'note-1'
    });
  }

  reset() {
    this.createDailyNote.mockClear();
  }
}

class MockLabIntegrationService {
  constructor() {
    this.initialize = jest.fn().mockResolvedValue(true);
    this.sendOrder = jest.fn().mockResolvedValue({
      order_id: 'lab-order-1',
      sent_at: new Date().toISOString()
    });
  }

  reset() {
    this.sendOrder.mockClear();
  }
}

class MockRadiologyIntegrationService {
  constructor() {
    this.initialize = jest.fn().mockResolvedValue(true);
    this.sendOrder = jest.fn().mockResolvedValue({
      order_id: 'rad-order-1',
      sent_at: new Date().toISOString()
    });
  }

  reset() {
    this.sendOrder.mockClear();
  }
}

class MockConsultationIntegrationService {
  constructor() {
    this.initialize = jest.fn().mockResolvedValue(true);
    this.sendRequest = jest.fn().mockResolvedValue({
      request_id: 'consult-1',
      sent_at: new Date().toISOString()
    });
  }

  reset() {
    this.sendRequest.mockClear();
  }
}

class MockPharmacyIntegrationService {
  constructor() {
    this.initialize = jest.fn().mockResolvedValue(true);
    this.recordAdministration = jest.fn().mockResolvedValue({
      record_id: 'med-admin-1',
      recorded_at: new Date().toISOString()
    });
  }

  reset() {
    this.recordAdministration.mockClear();
  }
}

describe('DepartmentIntegrationService', () => {
  let service;
  let mockIntegrationsRepo;
  let mockJourneysRepo;
  let mockNotesRepo;
  let mockLabService;
  let mockRadiologyService;
  let mockConsultationService;
  let mockPharmacyService;

  beforeEach(() => {
    mockIntegrationsRepo = new MockDepartmentIntegrationsRepository();
    mockJourneysRepo = new MockJourneysRepository();
    mockNotesRepo = new MockDailyNotesRepository();
    mockLabService = new MockLabIntegrationService();
    mockRadiologyService = new MockRadiologyIntegrationService();
    mockConsultationService = new MockConsultationIntegrationService();
    mockPharmacyService = new MockPharmacyIntegrationService();

    service = new DepartmentIntegrationService({
      integrationsRepository: mockIntegrationsRepo,
      journeysRepository: mockJourneysRepo,
      dailyNotesRepository: mockNotesRepo,
      labIntegrationService: mockLabService,
      radiologyIntegrationService: mockRadiologyService,
      consultationIntegrationService: mockConsultationService,
      pharmacyIntegrationService: mockPharmacyService
    });
  });

  afterEach(async () => {
    if (service) {
      await service.cleanup();
    }
  });

  describe('Service Initialization', () => {
    test('should initialize service with all repositories and services', async () => {
      await service.initialize();

      expect(mockIntegrationsRepo.initialize).toHaveBeenCalled();
      expect(mockJourneysRepo.initialize).toHaveBeenCalled();
      expect(mockNotesRepo.initialize).toHaveBeenCalled();
      expect(mockLabService.initialize).toHaveBeenCalled();
      expect(mockRadiologyService.initialize).toHaveBeenCalled();
      expect(mockConsultationService.initialize).toHaveBeenCalled();
      expect(mockPharmacyService.initialize).toHaveBeenCalled();
    });

    test('should handle initialization without external services', async () => {
      const serviceBasic = new DepartmentIntegrationService({
        integrationsRepository: mockIntegrationsRepo,
        journeysRepository: mockJourneysRepo,
        dailyNotesRepository: mockNotesRepo
      });

      await serviceBasic.initialize();

      expect(mockIntegrationsRepo.initialize).toHaveBeenCalled();
      expect(mockJourneysRepo.initialize).toHaveBeenCalled();
    });

    test('should handle initialization errors gracefully', async () => {
      mockIntegrationsRepo.initialize.mockRejectedValue(new Error('Database error'));

      await expect(service.initialize()).rejects.toThrow('Database error');
    });
  });

  describe('Lab Orders and Results', () => {
    test('should create lab order successfully', async () => {
      const labOrderData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        ordered_by_user_id: 'user-1',
        tests: ['CBC', 'BMP', 'Lipid Panel'],
        priority: 'routine',
        specimen_type: 'blood',
        clinical_indication: 'Annual health screening'
      };

      const result = await service.createLabOrder(labOrderData);

      expect(result).toHaveProperty('integration');
      expect(result).toHaveProperty('send_result');
      expect(result.send_result.success).toBe(true);
      expect(mockLabService.sendOrder).toHaveBeenCalled();
    });

    test('should validate required lab order fields', async () => {
      const invalidOrder = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        ordered_by_user_id: 'user-1'
        // Missing tests array
      };

      await expect(service.createLabOrder(invalidOrder))
        .rejects.toThrow('At least one test must be specified');
    });

    test('should validate journey status before creating lab order', async () => {
      mockJourneysRepo.findJourneyById.mockResolvedValue({
        id: 'journey-1',
        status: 'discharged'
      });

      const labOrderData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        ordered_by_user_id: 'user-1',
        tests: ['CBC']
      };

      await expect(service.createLabOrder(labOrderData))
        .rejects.toThrow('Cannot create lab order for journey with status');
    });

    test('should process lab results successfully', async () => {
      mockIntegrationsRepo.findIntegrationById.mockResolvedValue({
        id: 'integration-1',
        integration_type: 'lab',
        status: 'sent'
      });

      const labResultData = {
        integration_id: 'integration-1',
        results: [
          { test_name: 'Potassium', result_value: 7.2, abnormal: true, critical: true },
          { test_name: 'Sodium', result_value: 140, abnormal: false, critical: false }
        ],
        processed_by_user_id: 'user-1'
      };

      const result = await service.processLabResults(labResultData);

      expect(result).toHaveProperty('integration');
      expect(result.critical_results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            test_name: 'Potassium',
            severity: 'critically_high'
          })
        ])
      );
    });

    test('should create critical result notes when configured', async () => {
      mockIntegrationsRepo.findIntegrationById.mockResolvedValue({
        id: 'integration-1',
        integration_type: 'lab',
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        status: 'sent'
      });

      const criticalResults = [
        { test_name: 'Potassium', result_value: 7.2, severity: 'critically_high' }
      ];

      await service.createCriticalResultNote(
        { id: 'integration-1', journey_id: 'journey-1', encounter_id: 'encounter-1', patient_id: 'patient-1', integration_type: 'lab' },
        criticalResults,
        'user-1'
      );

      expect(mockNotesRepo.createDailyNote).toHaveBeenCalledWith(
        expect.objectContaining({
          note_type: 'progress',
          subjective_notes: expect.stringContaining('Critical lab results'),
          assessment: expect.stringContaining('immediate attention')
        })
      );
    });
  });

  describe('Radiology Orders and Reports', () => {
    test('should create radiology order successfully', async () => {
      const radiologyOrderData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        ordered_by_user_id: 'user-1',
        procedures: ['Chest X-Ray', 'CT Abdomen'],
        priority: 'urgent',
        clinical_indication: 'Abdominal pain',
        contrast_required: true
      };

      const result = await service.createRadiologyOrder(radiologyOrderData);

      expect(result).toHaveProperty('integration');
      expect(result).toHaveProperty('send_result');
      expect(result.send_result.success).toBe(true);
      expect(mockRadiologyService.sendOrder).toHaveBeenCalled();
    });

    test('should validate required radiology order fields', async () => {
      const invalidOrder = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        ordered_by_user_id: 'user-1'
        // Missing procedures array
      };

      await expect(service.createRadiologyOrder(invalidOrder))
        .rejects.toThrow('At least one procedure must be specified');
    });

    test('should process radiology reports successfully', async () => {
      mockIntegrationsRepo.findIntegrationById.mockResolvedValue({
        id: 'integration-1',
        integration_type: 'radiology',
        status: 'sent'
      });

      const radiologyReportData = {
        integration_id: 'integration-1',
        report_data: { report_id: 'rad-123' },
        findings: 'No acute abnormalities. Normal cardiac size. Clear lung fields.',
        impression: 'Normal chest X-ray',
        processed_by_user_id: 'radiologist-1'
      };

      const result = await service.processRadiologyReport(radiologyReportData);

      expect(result).toHaveProperty('integration');
      expect(result.integration.status).toBe('completed');
      expect(result).toHaveProperty('report_summary');
    });

    test('should identify critical radiology findings', () => {
      const findingsWithCritical = 'Patient has acute stroke with middle cerebral artery occlusion. No pneumothorax or acute fracture.';

      const criticalFindings = service.identifyCriticalRadiologyFindings(findingsWithCritical);

      expect(criticalFindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pattern: 'acute stroke'
          })
        ])
      );

      expect(criticalFindings).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pattern: 'pneumothorax'
          })
        ])
      );
    });
  });

  describe('Consultation Requests and Responses', () => {
    test('should create consultation request successfully', async () => {
      const consultationData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        requested_by_user_id: 'user-1',
        department: 'Cardiology',
        specialty: 'Interventional Cardiology',
        consultation_type: 'outpatient',
        reason_for_consult: 'Evaluation of chest pain and abnormal stress test',
        urgency: 'urgent'
      };

      const result = await service.createConsultationRequest(consultationData);

      expect(result).toHaveProperty('integration');
      expect(result.integration.integration_type).toBe('consultation');
      expect(result).toHaveProperty('send_result');
      expect(result.send_result.success).toBe(true);
      expect(mockConsultationService.sendRequest).toHaveBeenCalled();
    });

    test('should validate required consultation fields', async () => {
      const invalidConsult = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        requested_by_user_id: 'user-1'
        // Missing department and specialty
      };

      await expect(service.createConsultationRequest(invalidConsult))
        .rejects.toThrow('Department and specialty must be specified');
    });

    test('should process consultation response successfully', async () => {
      mockIntegrationsRepo.findIntegrationById.mockResolvedValue({
        id: 'integration-1',
        integration_type: 'consultation',
        status: 'sent'
      });

      const consultationResponse = {
        integration_id: 'integration-1',
        consulting_department: 'Cardiology',
        consulting_physician: 'Dr. Smith',
        recommendations: ['Perform cardiac catheterization', 'Continue current medications'],
        assessment: 'Patient requires further cardiac evaluation',
        processed_by_user_id: 'user-1'
      };

      const result = await service.processConsultationResponse(consultationResponse);

      expect(result).toHaveProperty('integration');
      expect(result.integration.status).toBe('completed');
      expect(result).toHaveProperty('response_summary');
    });
  });

  describe('Medication Administration', () => {
    test('should create medication administration record successfully', async () => {
      const medicationData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        administered_by_user_id: 'nurse-1',
        medications: [
          {
            medication_name: 'Lisinopril',
            dose: '10mg',
            route: 'oral',
            administration_time: '2026-07-23T09:00:00Z'
          },
          {
            medication_name: 'Metformin',
            dose: '500mg',
            route: 'oral',
            administration_time: '2026-07-23T09:00:00Z'
          }
        ]
      };

      const result = await service.createMedicationAdministration(medicationData);

      expect(result).toHaveProperty('integration');
      expect(result.integration.integration_type).toBe('medication');
      expect(result).toHaveProperty('send_result');
      expect(result.send_result.success).toBe(true);
      expect(mockPharmacyService.recordAdministration).toHaveBeenCalled();
    });

    test('should validate medication administration fields', async () => {
      const invalidMedData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        administered_by_user_id: 'nurse-1'
        // Missing medications array
      };

      await expect(service.createMedicationAdministration(invalidMedData))
        .rejects.toThrow('At least one medication must be specified');
    });
  });

  describe('Integration Status and Error Management', () => {
    test('should retry failed integration successfully', async () => {
      mockIntegrationsRepo.findIntegrationById.mockResolvedValue({
        id: 'integration-1',
        integration_type: 'lab',
        status: 'failed',
        retry_count: 0
      });

      const result = await service.retryFailedIntegration('integration-1', 'user-1');

      expect(result).toHaveProperty('retry_attempt', 1);
      expect(result.can_retry_again).toBe(true);
      expect(mockLabService.sendOrder).toHaveBeenCalled();
    });

    test('should prevent retry when max attempts reached', async () => {
      mockIntegrationsRepo.findIntegrationById.mockResolvedValue({
        id: 'integration-1',
        integration_type: 'lab',
        status: 'failed',
        retry_count: 3 // Already at max
      });

      await expect(service.retryFailedIntegration('integration-1', 'user-1'))
        .rejects.toThrow('Maximum retry attempts reached');
    });

    test('should only allow retry for failed integrations', async () => {
      mockIntegrationsRepo.findIntegrationById.mockResolvedValue({
        id: 'integration-1',
        integration_type: 'lab',
        status: 'completed' // Not failed
      });

      await expect(service.retryFailedIntegration('integration-1', 'user-1'))
        .rejects.toThrow('Only failed integrations can be retried');
    });

    test('should get journey integration status', async () => {
      const integrations = [
        { id: 'int-1', integration_type: 'lab', status: 'completed', priority: 'routine', ordered_at: new Date().toISOString() },
        { id: 'int-2', integration_type: 'radiology', status: 'pending', priority: 'urgent', ordered_at: new Date().toISOString() },
        { id: 'int-3', integration_type: 'consultation', status: 'failed', priority: 'routine', ordered_at: new Date().toISOString() }
      ];

      mockIntegrationsRepo.findIntegrationsByJourney.mockResolvedValue(integrations);

      const result = await service.getJourneyIntegrationStatus('journey-1');

      expect(result).toHaveProperty('journey_id', 'journey-1');
      expect(result.summary).toHaveProperty('total_integrations', 3);
      expect(result.summary).toHaveProperty('completed_count', 1);
      expect(result.summary).toHaveProperty('pending_count', 1);
      expect(result.summary).toHaveProperty('failed_count', 1);
      expect(result.summary).toHaveProperty('urgent_pending', 1);
    });

    test('should get integration statistics', async () => {
      const integrations = [
        { integration_type: 'lab', status: 'completed', ordered_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { integration_type: 'radiology', status: 'completed', ordered_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { integration_type: 'lab', status: 'failed', ordered_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      ];

      mockIntegrationsRepo.findIntegrationsWithFilters.mockResolvedValue(integrations);

      const stats = await service.getIntegrationStatistics({ journey_id: 'journey-1' });

      expect(stats).toHaveProperty('total_integrations', 3);
      expect(stats.completion_rate).toBeGreaterThan(0);
      expect(stats.failure_rate).toBeGreaterThan(0);
    });
  });

  describe('Helper Methods', () => {
    test('should calculate expected turnaround time correctly', () => {
      const labTime = service.calculateExpectedTurnaround('lab', 'routine', 5);
      const radiologyTime = service.calculateExpectedTurnaround('radiology', 'urgent', 2);
      const emergencyTime = service.calculateExpectedTurnaround('lab', 'emergency', 1);

      expect(labTime).toBeGreaterThan(0);
      expect(radiologyTime).toBeGreaterThan(0);
      expect(emergencyTime).toBeLessThan(labTime); // Emergency should be faster
    });

    test('should identify critical lab results correctly', () => {
      const results = [
        { test_name: 'Potassium', result_value: 7.2, abnormal: true },
        { test_name: 'Sodium', result_value: 140, abnormal: false },
        { test_name: 'Glucose', result_value: 45, abnormal: true }
      ];

      const criticalResults = service.identifyCriticalLabResults(results);

      expect(criticalResults).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            test_name: 'Potassium',
            severity: 'critically_high'
          })
        ])
      );

      expect(criticalResults).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            test_name: 'Glucose',
            severity: 'critically_low'
          })
        ])
      );
    });

    test('should generate lab result summary correctly', () => {
      const results = [
        { test_name: 'CBC', abnormal: false, critical: false },
        { test_name: 'Potassium', abnormal: true, critical: true },
        { test_name: 'Lipid Panel', abnormal: false, critical: false }
      ];

      const summary = service.generateLabResultSummary(results);

      expect(summary).toHaveProperty('total_tests', 3);
      expect(summary).toHaveProperty('abnormal_results', 1);
      expect(summary).toHaveProperty('critical_results', 1);
    });

    test('should generate consultation response summary correctly', () => {
      const recommendations = ['Continue treatment', 'Follow up in 2 weeks'];
      const summary = service.generateConsultationResponseSummary('Patient stable', recommendations);

      expect(summary).toHaveProperty('has_assessment', true);
      expect(summary).toHaveProperty('recommendations_count', 2);
    });

    test('should determine next actions for different integration types', () => {
      const pendingIntegration = {
        id: 'int-1',
        status: 'pending'
      };

      const labActions = service.determineLabNextActions(pendingIntegration, null);
      const radiologyActions = service.determineRadiologyNextActions(pendingIntegration, null);
      const consultActions = service.determineConsultationNextActions(pendingIntegration, null);

      expect(Array.isArray(labActions)).toBe(true);
      expect(Array.isArray(radiologyActions)).toBe(true);
      expect(Array.isArray(consultActions)).toBe(true);
    });

    test('should group integrations by type correctly', () => {
      const integrations = [
        { integration_type: 'lab' },
        { integration_type: 'lab' },
        { integration_type: 'radiology' }
      ];

      const grouped = service.groupIntegrationsByType(integrations);

      expect(grouped).toEqual({
        lab: 2,
        radiology: 1
      });
    });

    test('should group integrations by status correctly', () => {
      const integrations = [
        { status: 'completed' },
        { status: 'pending' },
        { status: 'failed' },
        { status: 'completed' }
      ];

      const grouped = service.groupIntegrationsByStatus(integrations);

      expect(grouped).toEqual({
        completed: 2,
        pending: 1,
        failed: 1
      });
    });
  });

  describe('Configuration Options', () => {
    test('should respect autoRetryFailedIntegrations configuration', () => {
      const serviceNoRetry = new DepartmentIntegrationService({
        integrationsRepository: mockIntegrationsRepo,
        journeysRepository: mockJourneysRepo,
        dailyNotesRepository: mockNotesRepo,
        autoRetryFailedIntegrations: false
      });

      expect(serviceNoRetry.autoRetryFailedIntegrations).toBe(false);
    });

    test('should respect maxRetryAttempts configuration', () => {
      const serviceCustomMax = new DepartmentIntegrationService({
        integrationsRepository: mockIntegrationsRepo,
        journeysRepository: mockJourneysRepo,
        dailyNotesRepository: mockNotesRepo,
        maxRetryAttempts: 5
      });

      expect(serviceCustomMax.maxRetryAttempts).toBe(5);
    });

    test('should respect createNotesForCriticalResults configuration', () => {
      const serviceNoNotes = new DepartmentIntegrationService({
        integrationsRepository: mockIntegrationsRepo,
        journeysRepository: mockJourneysRepo,
        dailyNotesRepository: mockNotesRepo,
        createNotesForCriticalResults: false
      });

      expect(serviceNoNotes.createNotesForCriticalResults).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('should handle integration not found errors', async () => {
      mockIntegrationsRepo.findIntegrationById.mockResolvedValue(null);

      await expect(service.retryFailedIntegration('nonexistent-integration', 'user-1'))
        .rejects.toThrow('Integration not found');
    });

    test('should handle external service errors gracefully', async () => {
      mockLabService.sendOrder.mockRejectedValue(new Error('Lab system unavailable'));

      const labOrderData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        ordered_by_user_id: 'user-1',
        tests: ['CBC']
      };

      const result = await service.createLabOrder(labOrderData);

      expect(mockIntegrationsRepo.updateIntegrationStatus).toHaveBeenCalledWith(
        expect.any(String),
        'failed',
        expect.objectContaining({
          error_message_jsonb: expect.arrayContaining([
            expect.objectContaining({
              send_error: expect.any(String)
            })
          ])
        })
      );
    });

    test('should handle cleanup errors gracefully', async () => {
      mockIntegrationsRepo.close.mockRejectedValue(new Error('Close error'));

      await expect(service.cleanup()).resolves.not.toThrow();
    });

    test('should handle missing external services gracefully', async () => {
      const serviceNoExternal = new DepartmentIntegrationService({
        integrationsRepository: mockIntegrationsRepo,
        journeysRepository: mockJourneysRepo,
        dailyNotesRepository: mockNotesRepo
      });

      const labOrderData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        ordered_by_user_id: 'user-1',
        tests: ['CBC'],
        auto_send: true
      };

      const result = await serviceNoExternal.createLabOrder(labOrderData);

      // Should complete without error, but send_result should be null
      expect(result).toHaveProperty('integration');
      expect(result.send_result).toBeNull();
    });
  });
});

module.exports = {
  MockDepartmentIntegrationsRepository,
  MockJourneysRepository,
  MockDailyNotesRepository,
  MockLabIntegrationService,
  MockRadiologyIntegrationService,
  MockConsultationIntegrationService,
  MockPharmacyIntegrationService
};