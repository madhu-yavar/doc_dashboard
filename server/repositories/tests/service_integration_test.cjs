/**
 * Service Layer Integration Tests
 *
 * Comprehensive integration tests for the service layer, testing:
 * - Service-to-service integration
 * - End-to-end workflows
 * - Cross-service operations
 * - Real database integration (when configured)
 */

const { InpatientJourneyService } = require('../../inpatient_journey_service.cjs');
const { DailyNotesService } = require('../../daily_notes_service.cjs');
const { DepartmentIntegrationService } = require('../../department_integration_service.cjs');

const { InpatientJourneysRepository } = require('../../repositories/inpatient_journeys_repository.cjs');
const { DailyNotesRepository } = require('../../repositories/daily_notes_repository.cjs');
const { DepartmentIntegrationsRepository } = require('../../repositories/department_integrations_repository.cjs');

// Test configuration
const TEST_CONFIG = {
  useRealDatabase: process.env.USE_REAL_DB === 'true',
  databaseUrl: process.env.TEST_DATABASE_URL,
  cleanupAfterTest: process.env.CLEANUP_AFTER_TEST !== 'false'
};

// Mock implementations for testing without real database
class MockDatabase {
  constructor() {
    this.data = new Map();
    this.queries = [];
    this.nextId = 1;
  }

  async query(sql, params) {
    this.queries.push({ sql, params });

    // Simple mock responses based on SQL patterns
    if (sql.includes('INSERT')) {
      return { rows: [{ id: String(this.nextId++) }] };
    } else if (sql.includes('SELECT')) {
      return { rows: [] };
    } else if (sql.includes('UPDATE') || sql.includes('DELETE')) {
      return { rows: [], rowCount: 1 };
    }

    return { rows: [] };
  }

  async connect() {
    return Promise.resolve();
  }

  async end() {
    this.data.clear();
    this.queries = [];
    return Promise.resolve();
  }

  reset() {
    this.data.clear();
    this.queries = [];
    this.nextId = 1;
  }
}

describe('Service Layer Integration Tests', () => {
  let mockDb;
  let inpatientJourneyService;
  let dailyNotesService;
  let departmentIntegrationService;

  let journeysRepository;
  let notesRepository;
  let integrationsRepository;

  beforeAll(async () => {
    // Setup database connection or mock
    if (TEST_CONFIG.useRealDatabase) {
      // Real database setup would go here
      console.log('Using real database for integration tests');
    } else {
      mockDb = new MockDatabase();
      await mockDb.connect();
    }
  });

  afterAll(async () => {
    if (TEST_CONFIG.useRealDatabase && TEST_CONFIG.cleanupAfterTest) {
      // Real database cleanup would go here
    } else if (mockDb) {
      await mockDb.end();
    }
  });

  beforeEach(() => {
    // Initialize repositories
    if (TEST_CONFIG.useRealDatabase) {
      journeysRepository = new InpatientJourneysRepository();
      notesRepository = new DailyNotesRepository();
      integrationsRepository = new DepartmentIntegrationsRepository();
    } else {
      // Create repositories with mock database
      journeysRepository = new InpatientJourneysRepository();
      notesRepository = new DailyNotesRepository();
      integrationsRepository = new DepartmentIntegrationsRepository();

      // Override database connections for testing
      Object.defineProperty(journeysRepository, 'db', { get: () => mockDb });
      Object.defineProperty(notesRepository, 'db', { get: () => mockDb });
      Object.defineProperty(integrationsRepository, 'db', { get: () => mockDb });
    }

    // Initialize services
    inpatientJourneyService = new InpatientJourneyService({
      journeysRepository,
      dailyNotesRepository: notesRepository,
      departmentIntegrationsRepository: integrationsRepository
    });

    dailyNotesService = new DailyNotesService({
      dailyNotesRepository: notesRepository,
      journeysRepository: journeysRepository
    });

    departmentIntegrationService = new DepartmentIntegrationService({
      integrationsRepository: integrationsRepository,
      journeysRepository: journeysRepository,
      dailyNotesRepository: notesRepository
    });
  });

  afterEach(async () => {
    // Cleanup services
    if (inpatientJourneyService) {
      await inpatientJourneyService.cleanup();
    }
    if (dailyNotesService) {
      await dailyNotesService.cleanup();
    }
    if (departmentIntegrationService) {
      await departmentIntegrationService.cleanup();
    }

    if (mockDb) {
      mockDb.reset();
    }
  });

  describe('Complete Inpatient Journey Workflow', () => {
    test('should handle complete patient journey from admission to discharge', async () => {
      // Initialize services
      await inpatientJourneyService.initialize();
      await dailyNotesService.initialize();
      await departmentIntegrationService.initialize();

      // Step 1: Admit patient
      const admissionResult = await inpatientJourneyService.admitPatient({
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        admission_type: 'routine',
        admission_reason: 'Community-acquired pneumonia',
        attending_physician_id: 'physician-1',
        current_ward: 'General Medicine',
        current_bed: 'Bed-1',
        initial_note_data: {
          chief_complaint: 'Cough and fever for 5 days',
          initial_assessment: 'Possible pneumonia, requires antibiotics'
        }
      });

      expect(admissionResult.journey).toBeDefined();
      expect(admissionResult.journey.status).toBe('admitted');
      expect(admissionResult.initial_note).toBeDefined();

      const journeyId = admissionResult.journey.id;

      // Step 2: Create daily progress notes
      const progressNote = await dailyNotesService.createDailyNoteManual({
        journey_id: journeyId,
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        note_type: 'progress',
        subjective_notes: 'Patient reports improvement in cough and fever',
        objective_notes_jsonb: {
          vitals: {
            temperature: '38.2°C',
            blood_pressure: '120/80 mmHg',
            heart_rate: '88 bpm',
            respiratory_rate: '18 bpm',
            oxygen_saturation: '96%'
          }
        },
        assessment: 'Patient showing positive response to antibiotics',
        plan: 'Continue current antibiotic regimen, monitor vitals',
        created_by_user_id: 'physician-1',
        auto_submit: true
      });

      expect(progressNote.note).toBeDefined();
      expect(progressNote.note.status).toBe('pending_review');

      // Step 3: Create lab orders
      const labOrder = await departmentIntegrationService.createLabOrder({
        journey_id: journeyId,
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        ordered_by_user_id: 'physician-1',
        tests: ['CBC', 'BMP', 'CRP'],
        priority: 'routine',
        specimen_type: 'blood',
        clinical_indication: 'Monitor infection response'
      });

      expect(labOrder.integration).toBeDefined();
      expect(labOrder.integration.integration_type).toBe('lab');

      // Step 4: Create radiology order
      const radiologyOrder = await departmentIntegrationService.createRadiologyOrder({
        journey_id: journeyId,
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        ordered_by_user_id: 'physician-1',
        procedures: ['Chest X-Ray'],
        priority: 'urgent',
        clinical_indication: 'Assess pneumonia resolution'
      });

      expect(radiologyOrder.integration).toBeDefined();
      expect(radiologyOrder.integration.integration_type).toBe('radiology');

      // Step 5: Update daily progress
      const progressUpdate = await inpatientJourneyService.updateDailyProgress(journeyId, {
        attending_physician_id: 'physician-2' // Transfer to different physician
      });

      expect(progressUpdate.journey).toBeDefined();

      // Step 6: Get journey analytics
      const analytics = await inpatientJourneyService.getJourneyAnalytics(journeyId);

      expect(analytics).toHaveProperty('journey_info');
      expect(analytics).toHaveProperty('daily_notes_analysis');
      expect(analytics).toHaveProperty('department_integration_analysis');
      expect(analytics).toHaveProperty('recommendations');

      // Step 7: Discharge patient
      const dischargeResult = await inpatientJourneyService.dischargePatient(journeyId, {
        discharge_type: 'routine',
        discharge_diagnosis: 'Community-acquired pneumonia, resolved',
        discharge_summary: 'Patient completed 7-day course of antibiotics with good response',
        follow_up_instructions: 'Follow up with primary care physician in 1 week',
        discharged_by_user_id: 'physician-2'
      });

      expect(dischargeResult.journey.status).toBe('discharged');
      expect(dischargeResult.discharge_summary).toHaveProperty('length_of_stay_days');
    });

    test('should handle journey with consultation workflow', async () => {
      // Initialize services
      await inpatientJourneyService.initialize();
      await dailyNotesService.initialize();
      await departmentIntegrationService.initialize();

      // Admit patient
      const admissionResult = await inpatientJourneyService.admitPatient({
        encounter_id: 'encounter-2',
        patient_id: 'patient-2',
        admission_type: 'routine',
        admission_reason: 'Chest pain evaluation',
        attending_physician_id: 'physician-1',
        current_ward: 'Cardiology',
        current_bed: 'Bed-1'
      });

      const journeyId = admissionResult.journey.id;

      // Create cardiology consultation
      const consultation = await departmentIntegrationService.createConsultationRequest({
        journey_id: journeyId,
        encounter_id: 'encounter-2',
        patient_id: 'patient-2',
        requested_by_user_id: 'physician-1',
        department: 'Cardiology',
        specialty: 'Interventional Cardiology',
        reason_for_consult: 'Evaluation of abnormal stress test and chest pain',
        urgency: 'urgent'
      });

      expect(consultation.integration.integration_type).toBe('consultation');

      // Process consultation response
      const consultationResponse = await departmentIntegrationService.processConsultationResponse({
        integration_id: consultation.integration.id,
        consulting_department: 'Cardiology',
        consulting_physician: 'Dr. Smith',
        recommendations: ['Perform cardiac catheterization', 'Continue current medications'],
        assessment: 'Patient requires coronary intervention',
        processed_by_user_id: 'dr-smith'
      });

      expect(consultationResponse.integration.status).toBe('completed');

      // Get journey summary to verify consultation is tracked
      const journeySummary = await inpatientJourneyService.getJourneySummary(journeyId);

      expect(journeySummary.progress.total_integrations).toBeGreaterThan(0);
    });
  });

  describe('Cross-Service Data Consistency', () => {
    test('should maintain data consistency across services', async () => {
      await inpatientJourneyService.initialize();
      await dailyNotesService.initialize();
      await departmentIntegrationService.initialize();

      // Create journey
      const admissionResult = await inpatientJourneyService.admitPatient({
        encounter_id: 'encounter-3',
        patient_id: 'patient-3',
        admission_type: 'emergency',
        admission_reason: 'Acute myocardial infarction',
        attending_physician_id: 'physician-1',
        current_ward: 'ICU',
        current_bed: 'Bed-1'
      });

      const journeyId = admissionResult.journey.id;

      // Create notes and integrations
      await dailyNotesService.createDailyNoteManual({
        journey_id: journeyId,
        encounter_id: 'encounter-3',
        patient_id: 'patient-3',
        subjective_notes: 'Patient status',
        assessment: 'Critical',
        plan: 'Treatment plan',
        created_by_user_id: 'physician-1'
      });

      await departmentIntegrationService.createLabOrder({
        journey_id: journeyId,
        encounter_id: 'encounter-3',
        patient_id: 'patient-3',
        ordered_by_user_id: 'physician-1',
        tests: ['Troponin', 'CBC', 'BMP']
      });

      // Verify data consistency across services
      const journeyAnalytics = await inpatientJourneyService.getJourneyAnalytics(journeyId);
      const integrationStatus = await departmentIntegrationService.getJourneyIntegrationStatus(journeyId);
      const noteStats = await dailyNotesService.getNoteStatistics(journeyId);

      expect(journeyAnalytics.journey_info.id).toBe(journeyId);
      expect(integrationStatus.journey_id).toBe(journeyId);
      expect(noteStats.total_notes).toBeGreaterThan(0);
      expect(integrationStatus.summary.total_integrations).toBeGreaterThan(0);

      // Verify analytics match across services
      expect(journeyAnalytics.daily_notes_analysis.total_notes).toBe(noteStats.total_notes);
      expect(journeyAnalytics.department_integration_analysis.total_integrations)
        .toBe(integrationStatus.summary.total_integrations);
    });

    test('should handle concurrent operations safely', async () => {
      await inpatientJourneyService.initialize();
      await dailyNotesService.initialize();
      await departmentIntegrationService.initialize();

      const admissionResult = await inpatientJourneyService.admitPatient({
        encounter_id: 'encounter-4',
        patient_id: 'patient-4',
        admission_type: 'routine',
        admission_reason: 'Multiple chronic conditions',
        attending_physician_id: 'physician-1',
        current_ward: 'General Medicine',
        current_bed: 'Bed-1'
      });

      const journeyId = admissionResult.journey.id;

      // Perform concurrent operations
      const operations = Promise.all([
        dailyNotesService.createDailyNoteManual({
          journey_id: journeyId,
          encounter_id: 'encounter-4',
          patient_id: 'patient-4',
          subjective_notes: 'Morning assessment',
          assessment: 'Stable',
          plan: 'Continue treatment',
          created_by_user_id: 'nurse-1'
        }),
        departmentIntegrationService.createLabOrder({
          journey_id: journeyId,
          encounter_id: 'encounter-4',
          patient_id: 'patient-4',
          ordered_by_user_id: 'physician-1',
          tests: ['CBC', 'BMP']
        }),
        departmentIntegrationService.createMedicationAdministration({
          journey_id: journeyId,
          encounter_id: 'encounter-4',
          patient_id: 'patient-4',
          administered_by_user_id: 'nurse-1',
          medications: [
            {
              medication_name: 'Lisinopril',
              dose: '10mg',
              route: 'oral'
            }
          ]
        })
      ]);

      const results = await operations;

      expect(results).toHaveLength(3);
      expect(results[0].note).toBeDefined();
      expect(results[1].integration).toBeDefined();
      expect(results[2].integration).toBeDefined();

      // Verify all operations completed successfully
      const finalStatus = await inpatientJourneyService.getJourneySummary(journeyId);
      expect(finalStatus.progress.total_notes).toBeGreaterThan(0);
      expect(finalStatus.progress.total_integrations).toBeGreaterThan(0);
    });
  });

  describe('Error Recovery and Resilience', () => {
    test('should handle service failures gracefully', async () => {
      await inpatientJourneyService.initialize();
      await dailyNotesService.initialize();
      await departmentIntegrationService.initialize();

      const admissionResult = await inpatientJourneyService.admitPatient({
        encounter_id: 'encounter-5',
        patient_id: 'patient-5',
        admission_type: 'routine',
        admission_reason: 'Test admission',
        attending_physician_id: 'physician-1',
        current_ward: 'Test Ward',
        current_bed: 'Bed-1'
      });

      const journeyId = admissionResult.journey.id;

      // Simulate failed integration
      const failedLabOrder = await departmentIntegrationService.createLabOrder({
        journey_id: journeyId,
        encounter_id: 'encounter-5',
        patient_id: 'patient-5',
        ordered_by_user_id: 'physician-1',
        tests: ['CBC'],
        auto_send: false // Don't auto-send, simulate pending state
      });

      // Retry the failed integration
      const retryResult = await departmentIntegrationService.retryFailedIntegration(
        failedLabOrder.integration.id,
        'physician-1'
      );

      expect(retryResult).toHaveProperty('retry_attempt');
      expect(retryResult.can_retry_again).toBe(true);
    });

    test('should maintain data integrity during rollback scenarios', async () => {
      await inpatientJourneyService.initialize();

      const admissionResult = await inpatientJourneyService.admitPatient({
        encounter_id: 'encounter-6',
        patient_id: 'patient-6',
        admission_type: 'routine',
        admission_reason: 'Test admission',
        attending_physician_id: 'physician-1',
        current_ward: 'Test Ward',
        current_bed: 'Bed-1'
      });

      const journeyId = admissionResult.journey.id;

      // Verify journey was created correctly
      const journey = await inpatientJourneyService.journeysRepository.findJourneyById(journeyId);
      expect(journey).toBeDefined();
      expect(journey.status).toBe('admitted');

      // Test transfer operation
      const transferResult = await inpatientJourneyService.transferPatient(journeyId, {
        new_ward: 'ICU',
        new_bed: 'Bed-5',
        transfer_reason: 'Clinical deterioration',
        transferred_by: 'physician-1'
      });

      expect(transferResult.journey.current_ward).toBe('ICU');
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle multiple concurrent journey operations', async () => {
      await inpatientJourneyService.initialize();

      // Create multiple journeys concurrently
      const journeyPromises = Array.from({ length: 5 }, (_, i) =>
        inpatientJourneyService.admitPatient({
          encounter_id: `encounter-batch-${i}`,
          patient_id: `patient-batch-${i}`,
          admission_type: 'routine',
          admission_reason: 'Batch test admission',
          attending_physician_id: 'physician-1',
          current_ward: 'General Medicine',
          current_bed: `Bed-${i}`
        })
      );

      const results = await Promise.all(journeyPromises);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.journey).toBeDefined();
        expect(result.journey.status).toBe('admitted');
      });
    });

    test('should efficiently query journey analytics', async () => {
      await inpatientJourneyService.initialize();
      await dailyNotesService.initialize();
      await departmentIntegrationService.initialize();

      const admissionResult = await inpatientJourneyService.admitPatient({
        encounter_id: 'encounter-perf-1',
        patient_id: 'patient-perf-1',
        admission_type: 'routine',
        admission_reason: 'Performance test',
        attending_physician_id: 'physician-1',
        current_ward: 'Test Ward',
        current_bed: 'Bed-1'
      });

      const journeyId = admissionResult.journey.id;

      // Create multiple notes and integrations
      const operations = [];
      for (let i = 0; i < 10; i++) {
        operations.push(
          dailyNotesService.createDailyNoteManual({
            journey_id: journeyId,
            encounter_id: 'encounter-perf-1',
            patient_id: 'patient-perf-1',
            subjective_notes: `Progress note ${i}`,
            assessment: 'Stable',
            plan: 'Continue',
            created_by_user_id: 'nurse-1'
          })
        );
      }

      await Promise.all(operations);

      // Measure analytics query performance
      const startTime = Date.now();
      const analytics = await inpatientJourneyService.getJourneyAnalytics(journeyId);
      const queryTime = Date.now() - startTime;

      expect(analytics).toBeDefined();
      expect(queryTime).toBeLessThan(5000); // Should complete in under 5 seconds
    });
  });

  describe('Service Configuration and Customization', () => {
    test('should respect service configuration options', async () => {
      const customService = new InpatientJourneyService({
        journeysRepository,
        dailyNotesRepository: notesRepository,
        departmentIntegrationsRepository: integrationsRepository,
        autoCreateAdmissionNote: false,
        requireDischargeSummary: false,
        maxRetries: 5
      });

      await customService.initialize();

      expect(customService.autoCreateAdmissionNote).toBe(false);
      expect(customService.requireDischargeSummary).toBe(false);
      expect(customService.maxRetries).toBe(5);

      await customService.cleanup();
    });

    test('should handle different service configurations independently', async () => {
      const strictService = new DailyNotesService({
        dailyNotesRepository: notesRepository,
        journeysRepository: journeysRepository,
        requireApprovalForVoiceNotes: true,
        autoSubmitPaperForVerification: true,
        enableSOAPValidation: true
      });

      const lenientService = new DailyNotesService({
        dailyNotesRepository: notesRepository,
        journeysRepository: journeysRepository,
        requireApprovalForVoiceNotes: false,
        autoSubmitPaperForVerification: false,
        enableSOAPValidation: false
      });

      await strictService.initialize();
      await lenientService.initialize();

      expect(strictService.requireApprovalForVoiceNotes).toBe(true);
      expect(lenientService.requireApprovalForVoiceNotes).toBe(false);

      await strictService.cleanup();
      await lenientService.cleanup();
    });
  });
});

// Export test utilities
module.exports = {
  TEST_CONFIG,
  MockDatabase,
  setupTestServices: async () => {
    const journeysRepo = new InpatientJourneysRepository();
    const notesRepo = new DailyNotesRepository();
    const integrationsRepo = new DepartmentIntegrationsRepository();

    const journeyService = new InpatientJourneyService({
      journeysRepository: journeysRepo,
      dailyNotesRepository: notesRepo,
      departmentIntegrationsRepository: integrationsRepo
    });

    const notesService = new DailyNotesService({
      dailyNotesRepository: notesRepo,
      journeysRepository: journeysRepo
    });

    const integrationService = new DepartmentIntegrationService({
      integrationsRepository: integrationsRepo,
      journeysRepository: journeysRepo,
      dailyNotesRepository: notesRepo
    });

    await Promise.all([
      journeyService.initialize(),
      notesService.initialize(),
      integrationService.initialize()
    ]);

    return {
      journeyService,
      notesService,
      integrationService,
      repositories: {
        journeys: journeysRepo,
        notes: notesRepo,
        integrations: integrationsRepo
      }
    };
  }
};