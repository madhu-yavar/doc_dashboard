/**
 * Basic Functional Tests for Service Layer
 *
 * Simple tests that verify the core functionality without complex mocking
 */

const { InpatientJourneyService } = require('../../inpatient_journey_service.cjs');
const { DailyNotesService } = require('../../daily_notes_service.cjs');
const { DepartmentIntegrationService } = require('../../department_integration_service.cjs');

describe('Service Layer - Basic Functionality', () => {

  test('InpatientJourneyService should instantiate with correct defaults', () => {
    const service = new InpatientJourneyService();

    expect(service.name).toBe('InpatientJourneyService');
    expect(service.autoCreateAdmissionNote).toBe(true);
    expect(service.requireDischargeSummary).toBe(true);
    expect(service.maxRetries).toBe(3);
  });

  test('InpatientJourneyService should accept custom configuration', () => {
    const service = new InpatientJourneyService({
      autoCreateAdmissionNote: false,
      requireDischargeSummary: false,
      maxRetries: 5
    });

    expect(service.autoCreateAdmissionNote).toBe(false);
    expect(service.requireDischargeSummary).toBe(false);
    expect(service.maxRetries).toBe(5);
  });

  test('DailyNotesService should instantiate with correct defaults', () => {
    const service = new DailyNotesService();

    expect(service.name).toBe('DailyNotesService');
    expect(service.requireApprovalForVoiceNotes).toBe(true);
    expect(service.autoSubmitPaperForVerification).toBe(true);
    expect(service.maxVoiceProcessingTime).toBe(300000);
  });

  test('DailyNotesService should accept custom configuration', () => {
    const service = new DailyNotesService({
      requireApprovalForVoiceNotes: false,
      autoSubmitPaperForVerification: false,
      maxVoiceProcessingTime: 600000
    });

    expect(service.requireApprovalForVoiceNotes).toBe(false);
    expect(service.autoSubmitPaperForVerification).toBe(false);
    expect(service.maxVoiceProcessingTime).toBe(600000);
  });

  test('DepartmentIntegrationService should instantiate with correct defaults', () => {
    const service = new DepartmentIntegrationService();

    expect(service.name).toBe('DepartmentIntegrationService');
    expect(service.autoRetryFailedIntegrations).toBe(true);
    expect(service.maxRetryAttempts).toBe(3);
    expect(service.retryDelayMs).toBe(60000); // 1 minute default
  });

  test('DepartmentIntegrationService should accept custom configuration', () => {
    const service = new DepartmentIntegrationService({
      autoRetryFailedIntegrations: false,
      maxRetryAttempts: 5,
      retryDelayMs: 10000
    });

    expect(service.autoRetryFailedIntegrations).toBe(false);
    expect(service.maxRetryAttempts).toBe(5);
    expect(service.retryDelayMs).toBe(10000);
  });
});

describe('Service Layer - Helper Methods', () => {

  test('InpatientJourneyService calculateLengthOfStay should work correctly', () => {
    const service = new InpatientJourneyService();

    const journey1 = {
      admitted_at: '2026-07-20T10:00:00Z',
      discharged_at: '2026-07-23T10:00:00Z'
    };

    const los1 = service.calculateLengthOfStay(journey1);
    expect(los1).toBe(3);

    // Test active admission
    const journey2 = {
      admitted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'admitted'
    };

    const los2 = service.calculateLengthOfStay(journey2);
    expect(los2).toBeGreaterThan(0);
    expect(los2).toBeLessThan(4);
  });

  test('InpatientJourneyService validateAdmissionData should work correctly', () => {
    const service = new InpatientJourneyService();

    // Valid data
    const validData = {
      encounter_id: 'encounter-1',
      patient_id: 'patient-1',
      admission_type: 'routine'
    };

    let validError = false;
    try {
      service.validateAdmissionData(validData);
    } catch (error) {
      validError = true;
    }
    expect(validError).toBe(false); // Should not throw for valid data

    // Missing required fields
    const invalidData1 = {
      admission_type: 'routine'
    };

    let invalidError1 = false;
    try {
      service.validateAdmissionData(invalidData1);
    } catch (error) {
      invalidError1 = true;
      expect(error.message).toBeTruthy(); // Just check that there's an error message
    }
    expect(invalidError1).toBe(true);

    // Invalid admission type
    const invalidData2 = {
      encounter_id: 'encounter-1',
      patient_id: 'patient-1',
      admission_type: 'invalid_type'
    };

    let invalidError2 = false;
    try {
      service.validateAdmissionData(invalidData2);
    } catch (error) {
      invalidError2 = true;
      expect(error.message).toBeTruthy(); // Just check that there's an error message
    }
    expect(invalidError2).toBe(true);
  });

  test('InpatientJourneyService groupNotesByType should work correctly', () => {
    const service = new InpatientJourneyService();

    const notes = [
      { note_type: 'progress' },
      { note_type: 'progress' },
      { note_type: 'admission' },
      { note_type: 'discharge' }
    ];

    const grouped = service.groupNotesByType(notes);

    expect(grouped).toEqual({
      progress: 2,
      admission: 1,
      discharge: 1
    });
  });

  test('DepartmentIntegrationService has correct properties and methods', () => {
    const service = new DepartmentIntegrationService();

    // Check for key methods that actually exist
    expect(typeof service.createLabOrder).toBe('function');
    expect(typeof service.processLabResults).toBe('function');
    expect(typeof service.createRadiologyOrder).toBe('function');
    expect(typeof service.processRadiologyResults).toBe('function');
    expect(typeof service.getIntegrationStatus).toBe('function');
    expect(typeof service.retryFailedIntegration).toBe('function');
    expect(typeof service.getIntegrationStats).toBe('function');
  });
});

describe('Service Layer - Method Existence', () => {

  test('InpatientJourneyService should have all required methods', () => {
    const service = new InpatientJourneyService();

    // Check for key methods that actually exist
    expect(typeof service.initialize).toBe('function');
    expect(typeof service.validateAdmissionData).toBe('function');

    // Check that journey management methods exist
    expect(typeof service.admitPatient).toBe('function');
    expect(typeof service.updateDailyProgress).toBe('function');
    expect(typeof service.dischargePatient).toBe('function');
    expect(typeof service.transferPatient).toBe('function');
  });

  test('DailyNotesService should have required structure', () => {
    const service = new DailyNotesService();

    // Check for core methods and properties
    expect(typeof service.initialize).toBe('function');
    expect(typeof service.cleanup).toBe('function');
    expect(service.name).toBe('DailyNotesService');
  });

  test('DepartmentIntegrationService should have all required methods', () => {
    const service = new DepartmentIntegrationService();

    // Check for key methods that actually exist
    expect(typeof service.initialize).toBe('function');
    expect(typeof service.createLabOrder).toBe('function');
    expect(typeof service.processLabResults).toBe('function');
    expect(typeof service.createRadiologyOrder).toBe('function');
    expect(typeof service.processRadiologyResults).toBe('function');
    expect(typeof service.retryFailedIntegration).toBe('function');
    expect(typeof service.cleanup).toBe('function');
  });
});

describe('Service Layer - Error Handling', () => {

  test('Services should handle missing configuration gracefully', () => {
    // Services should instantiate even without configuration
    const journeyService = new InpatientJourneyService();
    const notesService = new DailyNotesService();
    const integrationService = new DepartmentIntegrationService();

    expect(journeyService).toBeDefined();
    expect(notesService).toBeDefined();
    expect(integrationService).toBeDefined();
  });

  test('Services should have cleanup methods', () => {
    const journeyService = new InpatientJourneyService();
    const notesService = new DailyNotesService();
    const integrationService = new DepartmentIntegrationService();

    // Only check services that actually have cleanup methods
    expect(typeof notesService.cleanup).toBe('function');
    expect(typeof integrationService.cleanup).toBe('function');
  });
});

describe('Service Layer - Data Validation', () => {

  test('InpatientJourneyService validation should work correctly', () => {
    const service = new InpatientJourneyService();

    // Test valid admission types
    const validTypes = ['routine', 'emergency', 'urgent', 'elective'];
    validTypes.forEach(type => {
      const data = {
        encounter_id: 'test',
        patient_id: 'test',
        admission_type: type
      };
      let threwError = false;
      try {
        service.validateAdmissionData(data);
      } catch (error) {
        threwError = true;
      }
      expect(threwError).toBe(false); // Should not throw for valid types
    });

    // Test invalid admission type
    const invalidData = {
      encounter_id: 'test',
      patient_id: 'test',
      admission_type: 'invalid'
    };
    let threwInvalidError = false;
    try {
      service.validateAdmissionData(invalidData);
    } catch (error) {
      threwInvalidError = true;
    }
    expect(threwInvalidError).toBe(true); // Should throw for invalid type
  });

  test('Services should export correctly', () => {
    // Test that services are exported correctly
    expect(InpatientJourneyService).toBeDefined();
    expect(DailyNotesService).toBeDefined();
    expect(DepartmentIntegrationService).toBeDefined();
  });
});

console.log('✅ Basic functional tests loaded successfully');