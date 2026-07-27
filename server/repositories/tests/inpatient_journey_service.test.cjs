/**
 * Inpatient Journey Service Tests
 *
 * Comprehensive test suite for InpatientJourneyService functionality
 */

const { InpatientJourneyService } = require('../../inpatient_journey_service.cjs');
const { InpatientJourneysRepository } = require('../../repositories/inpatient_journeys_repository.cjs');
const { DailyNotesRepository } = require('../../repositories/daily_notes_repository.cjs');
const { DepartmentIntegrationsRepository } = require('../../repositories/department_integrations_repository.cjs');

// Mock database for testing
class MockDatabase {
  constructor() {
    this.data = new Map();
    this.queries = [];
  }

  async query(sql, params) {
    this.queries.push({ sql, params });
    return { rows: [] };
  }

  reset() {
    this.data.clear();
    this.queries = [];
  }
}

describe('InpatientJourneyService', () => {
  let service;
  let mockDb;
  let mockJourneysRepo;
  let mockNotesRepo;
  let mockIntegrationsRepo;

  beforeEach(() => {
    mockDb = new MockDatabase();

    // Create mock repositories with minimal dependencies
    mockJourneysRepo = {
      initialize: jest.fn().mockResolvedValue(true),
      createJourney: jest.fn().mockResolvedValue({
        id: 'journey-1',
        patient_id: 'patient-1',
        status: 'admitted',
        admitted_at: new Date().toISOString()
      }),
      createJourneyWithInitialNote: jest.fn().mockResolvedValue({
        journey: {
          id: 'journey-1',
          patient_id: 'patient-1',
          status: 'admitted'
        },
        initial_note: {
          id: 'note-1',
          note_type: 'admission'
        }
      }),
      findJourneyById: jest.fn().mockResolvedValue({
        id: 'journey-1',
        patient_id: 'patient-1',
        status: 'admitted',
        admitted_at: new Date().toISOString()
      }),
      findJourneysByPatient: jest.fn().mockResolvedValue([]),
      updateJourney: jest.fn().mockResolvedValue({
        id: 'journey-1',
        status: 'admitted'
      }),
      updateJourneyStatus: jest.fn().mockResolvedValue({
        id: 'journey-1',
        status: 'discharged'
      }),
      transferPatient: jest.fn().mockResolvedValue({
        id: 'journey-1',
        current_ward: 'new-ward'
      }),
      getJourneyTimeline: jest.fn().mockResolvedValue({
        timeline: []
      }),
      close: jest.fn().mockResolvedValue(true)
    };

    mockNotesRepo = {
      initialize: jest.fn().mockResolvedValue(true),
      findNotesByJourney: jest.fn().mockResolvedValue([]),
      createDailyNote: jest.fn().mockResolvedValue({
        id: 'note-1'
      }),
      close: jest.fn().mockResolvedValue(true)
    };

    mockIntegrationsRepo = {
      initialize: jest.fn().mockResolvedValue(true),
      findIntegrationsByJourney: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue(true)
    };

    service = new InpatientJourneyService({
      journeysRepository: mockJourneysRepo,
      dailyNotesRepository: mockNotesRepo,
      departmentIntegrationsRepository: mockIntegrationsRepo
    });
  });

  afterEach(async () => {
    if (service) {
      await service.cleanup();
    }
  });

  describe('Service Initialization', () => {
    test('should initialize service with all repositories', async () => {
      await service.initialize();

      expect(mockJourneysRepo.initialize).toHaveBeenCalled();
      expect(mockNotesRepo.initialize).toHaveBeenCalled();
      expect(mockIntegrationsRepo.initialize).toHaveBeenCalled();
    });

    test('should handle initialization errors gracefully', async () => {
      mockJourneysRepo.initialize.mockRejectedValue(new Error('DB error'));

      await expect(service.initialize()).rejects.toThrow('DB error');
    });
  });

  describe('Patient Admission', () => {
    test('should admit patient with valid data', async () => {
      const admissionData = {
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        admission_type: 'routine',
        admission_reason: 'Pneumonia treatment',
        attending_physician_id: 'physician-1',
        current_ward: 'General Medicine',
        current_bed: 'Bed-1'
      };

      const result = await service.admitPatient(admissionData);

      expect(result).toHaveProperty('journey');
      expect(result).toHaveProperty('initial_note');
      expect(result).toHaveProperty('admission_summary');
      expect(mockJourneysRepo.createJourneyWithInitialNote).toHaveBeenCalled();
    });

    test('should validate required admission fields', async () => {
      const invalidData = {
        // Missing encounter_id and patient_id
        admission_type: 'routine'
      };

      await expect(service.admitPatient(invalidData)).rejects.toThrow('Missing required admission fields');
    });

    test('should validate admission type', async () => {
      const invalidData = {
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        admission_type: 'invalid_type'
      };

      await expect(service.admitPatient(invalidData)).rejects.toThrow('Invalid admission_type');
    });

    test('should prevent duplicate active admissions', async () => {
      const existingJourney = {
        id: 'existing-journey',
        patient_id: 'patient-1',
        status: 'admitted'
      };

      mockJourneysRepo.findJourneysByPatient.mockResolvedValue([existingJourney]);

      const admissionData = {
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        admission_type: 'routine'
      };

      await expect(service.admitPatient(admissionData)).rejects.toThrow('already has an active admission');
    });

    test('should allow admission without initial note when configured', async () => {
      const serviceNoNote = new InpatientJourneyService({
        journeysRepository: mockJourneysRepo,
        dailyNotesRepository: mockNotesRepo,
        departmentIntegrationsRepository: mockIntegrationsRepo,
        autoCreateAdmissionNote: false
      });

      const admissionData = {
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        admission_type: 'routine'
      };

      const result = await serviceNoNote.admitPatient(admissionData);

      expect(mockJourneysRepo.createJourney).toHaveBeenCalled();
      expect(result.initial_note).toBeNull();
    });
  });

  describe('Daily Progress Updates', () => {
    test('should update patient daily progress', async () => {
      const progressData = {
        location_change: {
          new_ward: 'ICU',
          new_bed: 'Bed-5',
          reason: 'Clinical deterioration',
          changed_by: 'physician-1'
        }
      };

      const result = await service.updateDailyProgress('journey-1', progressData);

      expect(result).toHaveProperty('journey');
      expect(result).toHaveProperty('progress_summary');
      expect(mockJourneysRepo.updateJourney).toHaveBeenCalled();
    });

    test('should validate journey status before progress update', async () => {
      mockJourneysRepo.findJourneyById.mockResolvedValue({
        id: 'journey-1',
        status: 'discharged' // Can't update discharged journey
      });

      const progressData = {
        location_change: {
          new_ward: 'ICU'
        }
      };

      await expect(service.updateDailyProgress('journey-1', progressData))
        .rejects.toThrow('Cannot update progress for journey with status');
    });

    test('should handle physician changes', async () => {
      const progressData = {
        attending_physician_id: 'physician-2'
      };

      const result = await service.updateDailyProgress('journey-1', progressData);

      expect(mockJourneysRepo.updateJourney).toHaveBeenCalledWith(
        'journey-1',
        expect.objectContaining({
          attending_physician_id: 'physician-2'
        })
      );
    });

    test('should track transfer history in metadata', async () => {
      const progressData = {
        location_change: {
          new_ward: 'ICU',
          new_bed: 'Bed-5',
          reason: 'Clinical deterioration',
          changed_by: 'physician-1'
        }
      };

      await service.updateDailyProgress('journey-1', progressData);

      expect(mockJourneysRepo.updateJourney).toHaveBeenCalledWith(
        'journey-1',
        expect.objectContaining({
          journey_metadata_jsonb: expect.objectContaining({
            transfer_history: expect.arrayContaining([
              expect.objectContaining({
                reason: 'Clinical deterioration'
              })
            ])
          })
        })
      );
    });
  });

  describe('Patient Discharge', () => {
    test('should discharge patient with required data', async () => {
      const dischargeData = {
        discharge_type: 'routine',
        discharge_diagnosis: 'Pneumonia resolved',
        discharge_summary: 'Patient improved significantly',
        discharged_by_user_id: 'physician-1'
      };

      const result = await service.dischargePatient('journey-1', dischargeData);

      expect(result).toHaveProperty('journey');
      expect(result.journey.status).toBe('discharged');
      expect(result).toHaveProperty('discharge_summary');
    });

    test('should require discharge diagnosis when configured', async () => {
      const serviceStrict = new InpatientJourneyService({
        journeysRepository: mockJourneysRepo,
        dailyNotesRepository: mockNotesRepo,
        departmentIntegrationsRepository: mockIntegrationsRepo,
        requireDischargeSummary: true
      });

      const dischargeData = {
        discharge_type: 'routine'
        // Missing discharge_diagnosis
      };

      await expect(serviceStrict.dischargePatient('journey-1', dischargeData))
        .rejects.toThrow('Discharge diagnosis is required');
    });

    test('should calculate length of stay correctly', async () => {
      const admissionDate = new Date('2026-07-20T10:00:00Z');
      const dischargeDate = new Date('2026-07-23T10:00:00Z');

      mockJourneysRepo.findJourneyById.mockResolvedValue({
        id: 'journey-1',
        admitted_at: admissionDate.toISOString(),
        status: 'admitted'
      });

      const dischargeData = {
        discharge_type: 'routine',
        discharge_diagnosis: 'Resolved',
        discharged_at: dischargeDate.toISOString(),
        discharged_by_user_id: 'physician-1'
      };

      const result = await service.dischargePatient('journey-1', dischargeData);

      expect(result.discharge_summary.length_of_stay_days).toBe(3);
    });

    test('should create discharge note when requested', async () => {
      const dischargeData = {
        discharge_type: 'routine',
        discharge_diagnosis: 'Resolved',
        discharged_by_user_id: 'physician-1',
        create_discharge_note: true
      };

      const result = await service.dischargePatient('journey-1', dischargeData);

      expect(mockNotesRepo.createDailyNote).toHaveBeenCalledWith(
        expect.objectContaining({
          note_type: 'discharge',
          assessment: 'Resolved'
        })
      );
    });
  });

  describe('Patient Transfer', () => {
    test('should transfer patient to new location', async () => {
      const transferData = {
        new_location_id: 'location-2',
        new_ward: 'ICU',
        new_bed: 'Bed-5',
        transfer_reason: 'Clinical deterioration',
        transfer_type: 'clinical',
        transferred_by: 'physician-1'
      };

      const result = await service.transferPatient('journey-1', transferData);

      expect(result).toHaveProperty('journey');
      expect(result).toHaveProperty('transfer_summary');
      expect(mockJourneysRepo.transferPatient).toHaveBeenCalledWith(
        'journey-1',
        expect.objectContaining({
          new_ward: 'ICU',
          new_bed: 'Bed-5'
        })
      );
    });

    test('should validate transfer data', async () => {
      const invalidTransfer = {
        // Missing new_ward and new_location_id
        transfer_reason: 'Transfer needed'
      };

      await expect(service.transferPatient('journey-1', invalidTransfer))
        .rejects.toThrow('Either new_ward or new_location_id must be specified');
    });

    test('should create transfer note when requested', async () => {
      const transferData = {
        new_ward: 'ICU',
        new_bed: 'Bed-5',
        transfer_reason: 'Clinical deterioration',
        transferred_by: 'physician-1',
        create_transfer_note: true
      };

      await service.transferPatient('journey-1', transferData);

      expect(mockNotesRepo.createDailyNote).toHaveBeenCalledWith(
        expect.objectContaining({
          note_type: 'progress',
          subjective_notes: expect.stringContaining('Patient transfer')
        })
      );
    });
  });

  describe('Journey Analytics and Information', () => {
    test('should get journey summary', async () => {
      const journey = {
        id: 'journey-1',
        patient_id: 'patient-1',
        status: 'admitted',
        admitted_at: new Date().toISOString(),
        current_ward: 'General Medicine'
      };

      mockJourneysRepo.findJourneyById.mockResolvedValue(journey);
      mockNotesRepo.findNotesByJourney.mockResolvedValue([
        { id: 'note-1', note_type: 'progress', status: 'approved' }
      ]);
      mockIntegrationsRepo.findIntegrationsByJourney.mockResolvedValue([]);

      const result = await service.getJourneySummary('journey-1');

      expect(result).toHaveProperty('journey');
      expect(result).toHaveProperty('timeline');
      expect(result).toHaveProperty('progress');
      expect(result).toHaveProperty('current_status');
      expect(result).toHaveProperty('length_of_stay');
    });

    test('should get journey analytics', async () => {
      mockJourneysRepo.findJourneyById.mockResolvedValue({
        id: 'journey-1',
        patient_id: 'patient-1',
        status: 'admitted'
      });
      mockNotesRepo.findNotesByJourney.mockResolvedValue([
        { id: 'note-1', note_type: 'progress', status: 'approved' }
      ]);
      mockIntegrationsRepo.findIntegrationsByJourney.mockResolvedValue([]);

      const result = await service.getJourneyAnalytics('journey-1');

      expect(result).toHaveProperty('journey_info');
      expect(result).toHaveProperty('daily_notes_analysis');
      expect(result).toHaveProperty('department_integration_analysis');
      expect(result).toHaveProperty('care_continuity_assessment');
      expect(result).toHaveProperty('recommendations');
    });

    test('should get patient journey history', async () => {
      const journeys = [
        {
          id: 'journey-1',
          patient_id: 'patient-1',
          status: 'discharged',
          admitted_at: '2026-07-01T10:00:00Z',
          discharged_at: '2026-07-03T10:00:00Z'
        },
        {
          id: 'journey-2',
          patient_id: 'patient-1',
          status: 'admitted',
          admitted_at: '2026-07-20T10:00:00Z'
        }
      ];

      mockJourneysRepo.findJourneysByPatient.mockResolvedValue(journeys);

      const result = await service.getPatientJourneyHistory('patient-1');

      expect(result).toHaveProperty('patient_id', 'patient-1');
      expect(result).toHaveProperty('total_journeys', 2);
      expect(result).toHaveProperty('active_journeys', 1);
      expect(result.journey_history).toHaveLength(2);
    });
  });

  describe('Risk Assessment and Recommendations', () => {
    test('should identify long stay risk', async () => {
      const longStayJourney = {
        id: 'journey-1',
        admitted_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
        status: 'admitted'
      };

      mockJourneysRepo.findJourneyById.mockResolvedValue(longStayJourney);
      mockNotesRepo.findNotesByJourney.mockResolvedValue([]);
      mockIntegrationsRepo.findIntegrationsByJourney.mockResolvedValue([]);

      const result = await service.getJourneySummary('journey-1');

      expect(result.risk_factors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'long_stay',
            severity: 'medium'
          })
        ])
      );
    });

    test('should identify lack of documentation risk', async () => {
      mockJourneysRepo.findJourneyById.mockResolvedValue({
        id: 'journey-1',
        admitted_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'admitted'
      });
      mockNotesRepo.findNotesByJourney.mockResolvedValue([
        {
          id: 'note-1',
          note_date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        }
      ]);
      mockIntegrationsRepo.findIntegrationsByJourney.mockResolvedValue([]);

      const result = await service.getJourneySummary('journey-1');

      expect(result.risk_factors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'lack_documentation',
            severity: 'medium'
          })
        ])
      );
    });

    test('should generate care recommendations', async () => {
      mockJourneysRepo.findJourneyById.mockResolvedValue({
        id: 'journey-1',
        admitted_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'admitted'
      });
      mockNotesRepo.findNotesByJourney.mockResolvedValue([]);
      mockIntegrationsRepo.findIntegrationsByJourney.mockResolvedValue([]);

      const result = await service.getJourneyAnalytics('journey-1');

      expect(result.recommendations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'length_of_stay',
            priority: 'medium',
            recommendation: expect.stringContaining('extended hospitalization')
          })
        ])
      );
    });
  });

  describe('Helper Methods', () => {
    test('should calculate length of stay correctly', () => {
      const journey = {
        admitted_at: '2026-07-20T10:00:00Z',
        discharged_at: '2026-07-23T10:00:00Z'
      };

      const los = service.calculateLengthOfStay(journey);
      expect(los).toBe(3);
    });

    test('should calculate length of stay for active admission', () => {
      const journey = {
        admitted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'admitted'
      };

      const los = service.calculateLengthOfStay(journey);
      expect(los).toBe(2);
    });

    test('should validate admission data correctly', () => {
      const validData = {
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        admission_type: 'routine'
      };

      expect(() => service.validateAdmissionData(validData)).not.toThrow();
    });

    test('should group notes by type correctly', () => {
      const notes = [
        { note_type: 'progress' },
        { note_type: 'progress' },
        { note_type: 'admission' }
      ];

      const grouped = service.groupNotesByType(notes);

      expect(grouped).toEqual({
        progress: 2,
        admission: 1
      });
    });

    test('should determine journey status correctly', () => {
      const journey = {
        status: 'admitted',
        admitted_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
      };

      const stats = {
        last_note_date: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      };

      const status = service.determineJourneyStatus(journey, stats);
      expect(status).toBe('normal_progress');
    });
  });

  describe('Error Handling', () => {
    test('should handle journey not found errors', async () => {
      mockJourneysRepo.findJourneyById.mockResolvedValue(null);

      await expect(service.updateDailyProgress('nonexistent-journey', {}))
        .rejects.toThrow('Journey not found');
    });

    test('should handle repository errors gracefully', async () => {
      mockJourneysRepo.createJourney.mockRejectedValue(new Error('Database error'));

      const admissionData = {
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        admission_type: 'routine'
      };

      await expect(service.admitPatient(admissionData)).rejects.toThrow('Database error');
    });

    test('should handle cleanup errors gracefully', async () => {
      mockJourneysRepo.close.mockRejectedValue(new Error('Close error'));

      await expect(service.cleanup()).resolves.not.toThrow();
    });
  });

  describe('Configuration Options', () => {
    test('should respect autoCreateAdmissionNote configuration', async () => {
      const serviceNoNote = new InpatientJourneyService({
        journeysRepository: mockJourneysRepo,
        dailyNotesRepository: mockNotesRepo,
        departmentIntegrationsRepository: mockIntegrationsRepo,
        autoCreateAdmissionNote: false
      });

      const admissionData = {
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        admission_type: 'routine'
      };

      await serviceNoNote.admitPatient(admissionData);

      expect(mockJourneysRepo.createJourney).toHaveBeenCalled();
      expect(mockJourneysRepo.createJourneyWithInitialNote).not.toHaveBeenCalled();
    });

    test('should respect requireDischargeSummary configuration', async () => {
      const serviceLenient = new InpatientJourneyService({
        journeysRepository: mockJourneysRepo,
        dailyNotesRepository: mockNotesRepo,
        departmentIntegrationsRepository: mockIntegrationsRepo,
        requireDischargeSummary: false
      });

      const dischargeData = {
        discharge_type: 'routine'
        // Missing discharge_diagnosis but should be allowed
      };

      await expect(serviceLenient.dischargePatient('journey-1', dischargeData))
        .resolves.not.toThrow();
    });
  });
});

// Export for use in other test files
module.exports = {
  MockDatabase,
  createMockRepositories: () => ({
    journeysRepo: {
      initialize: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true)
    },
    notesRepo: {
      initialize: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true)
    },
    integrationsRepo: {
      initialize: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true)
    }
  })
};