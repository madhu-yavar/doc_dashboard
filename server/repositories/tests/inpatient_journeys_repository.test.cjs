/**
 * Inpatient Journeys Repository Unit Tests
 *
 * Tests for InpatientJourneysRepository functionality including:
 * - CRUD operations
 * - Domain-specific queries
 * - Transaction support
 * - Error handling
 */

const { InpatientJourneysRepository } = require('../inpatient_journeys_repository.cjs');

describe('InpatientJourneysRepository', () => {
  let repository;
  let testJourneyId;

  beforeAll(async () => {
    // Initialize repository with test database connection
    repository = new InpatientJourneysRepository();
    await repository.initialize();
  });

  afterAll(async () => {
    // Clean up and close connection
    await repository.close();
  });

  describe('Repository Initialization', () => {
    test('should initialize successfully', async () => {
      expect(repository).toBeInstanceOf(InpatientJourneysRepository);
      expect(repository.isConnected).toBe(true);
    });

    test('should have health check return healthy status', async () => {
      const health = await repository.healthCheck();
      expect(health.status).toBe('healthy');
      expect(health.connected).toBe(true);
    });
  });

  describe('CRUD Operations', () => {
    test('should create a new journey', async () => {
      const journeyData = {
        encounter_id: 'test-encounter-1',
        patient_id: 'test-patient-1',
        status: 'admitted',
        admission_type: 'emergency',
        admission_reason: 'Test admission',
        attending_physician_id: 'test-physician-1',
        current_location_id: 'test-location-1',
        current_ward: 'ICU',
        current_bed: 'Bed-1',
        journey_metadata_jsonb: { test: true }
      };

      const journey = await repository.createJourney(journeyData);

      expect(journey).toBeDefined();
      expect(journey.id).toBeDefined();
      expect(journey.patient_id).toBe('test-patient-1');
      expect(journey.status).toBe('admitted');
      expect(journey.current_ward).toBe('ICU');

      testJourneyId = journey.id;
    });

    test('should find journey by ID', async () => {
      const journey = await repository.findJourneyById(testJourneyId);

      expect(journey).toBeDefined();
      expect(journey.id).toBe(testJourneyId);
      expect(journey.patient_id).toBe('test-patient-1');
    });

    test('should find journeys by patient', async () => {
      const journeys = await repository.findJourneysByPatient('test-patient-1');

      expect(journeys).toBeDefined();
      expect(journeys.length).toBeGreaterThan(0);
      expect(journeys[0].patient_id).toBe('test-patient-1');
    });

    test('should update journey information', async () => {
      const updateData = {
        current_ward: 'General Ward',
        current_bed: 'Bed-5',
        journey_metadata_jsonb = { updated: true }
      };

      const updatedJourney = await repository.updateJourney(testJourneyId, updateData);

      expect(updatedJourney).toBeDefined();
      expect(updatedJourney.current_ward).toBe('General Ward');
      expect(updatedJourney.current_bed).toBe('Bed-5');
    });

    test('should update journey status', async () => {
      const statusData = {
        discharged_at: new Date().toISOString(),
        discharge_type: 'routine',
        discharge_diagnosis: 'Test diagnosis'
      };

      const updatedJourney = await repository.updateJourneyStatus(testJourneyId, 'discharged', statusData);

      expect(updatedJourney).toBeDefined();
      expect(updatedJourney.status).toBe('discharged');
      expect(updatedJourney.discharge_type).toBe('routine');
    });
  });

  describe('Domain-Specific Queries', () => {
    test('should get journey statistics', async () => {
      const stats = await repository.getJourneyStats();

      expect(stats).toBeDefined();
      expect(stats.total_journeys).toBeDefined();
      expect(stats.active_admissions).toBeDefined();
    });

    test('should find journeys by date range', async () => {
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      const journeys = await repository.findJourneysByDateRange(startDate, endDate);

      expect(journeys).toBeDefined();
      expect(Array.isArray(journeys)).toBe(true);
    });

    test('should find active journeys by location', async () => {
      const journeys = await repository.findActiveJourneysByLocation('test-location-1', 'ICU');

      expect(journeys).toBeDefined();
      expect(Array.isArray(journeys)).toBe(true);
    });

    test('should get journey timeline', async () => {
      const timeline = await repository.getJourneyTimeline(testJourneyId);

      expect(timeline).toBeDefined();
      expect(timeline.journey).toBeDefined();
      expect(timeline.timeline).toBeDefined();
      expect(timeline.timeline.daily_notes).toBeDefined();
    });
  });

  describe('Transaction Support', () => {
    test('should create journey with initial note atomically', async () => {
      const journeyData = {
        encounter_id: 'test-encounter-2',
        patient_id: 'test-patient-2',
        status: 'admitted',
        admission_type: 'routine',
        admission_reason: 'Another test admission'
      };

      const noteData = {
        note_type: 'admission',
        note_date: new Date().toISOString().split('T')[0],
        subjective_notes: 'Patient admitted for observation',
        assessment: 'Initial assessment',
        plan: 'Observation and monitoring',
        created_by_user_id: 'test-user-1'
      };

      const result = await repository.createJourneyWithInitialNote(journeyData, noteData);

      expect(result).toBeDefined();
      expect(result.journey).toBeDefined();
      expect(result.initial_note).toBeDefined();
      expect(result.initial_note.journey_id).toBe(result.journey.id);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid journey ID gracefully', async () => {
      const journey = await repository.findJourneyById('invalid-id');
      expect(journey).toBeNull();
    });

    test('should handle update with no valid fields', async () => {
      await expect(
        repository.updateJourney(testJourneyId, { invalid_field: 'value' })
      ).rejects.toThrow('No valid fields to update');
    });

    test('should handle non-existent journey update', async () => {
      const result = await repository.updateJourney('non-existent-id', { current_ward: 'Test' });
      expect(result).toBeNull();
    });
  });

  describe('Search and Filter Operations', () => {
    test('should search journeys by multiple criteria', async () => {
      const criteria = {
        patient_id: 'test-patient-1',
        status: 'discharged',
        limit: 10
      };

      const journeys = await repository.searchJourneys(criteria);

      expect(journeys).toBeDefined();
      expect(Array.isArray(journeys)).toBe(true);
    });

    test('should find journeys requiring attention', async () => {
      const journeys = await repository.findJourneysRequiringAttention({
        long_stay_days: 30,
        no_notes_hours: 48
      });

      expect(journeys).toBeDefined();
      expect(Array.isArray(journeys)).toBe(true);
    });
  });

  describe('Transfer Operations', () => {
    test('should transfer patient to new location', async () => {
      const transferData = {
        new_location_id: 'test-location-2',
        new_ward: 'Step Down Unit',
        new_bed: 'Bed-3',
        transfer_reason: 'Patient improved',
        transferred_by: 'test-user-1'
      };

      const updatedJourney = await repository.transferPatient(testJourneyId, transferData);

      expect(updatedJourney).toBeDefined();
      expect(updatedJourney.current_ward).toBe('Step Down Unit');
      expect(updatedJourney.current_bed).toBe('Bed-3');

      // Verify transfer history was saved
      const metadata = JSON.parse(updatedJourney.journey_metadata_jsonb || '{}');
      expect(metadata.transfer_history).toBeDefined();
      expect(metadata.transfer_history.length).toBeGreaterThan(0);
    });
  });

  describe('Statistics and Reporting', () => {
    test('should get admission statistics by ward', async () => {
      const stats = await repository.getAdmissionStatsByWard('ICU');

      expect(stats).toBeDefined();
      expect(Array.isArray(stats)).toBe(true);
    });

    test('should get all ward statistics', async () => {
      const stats = await repository.getAdmissionStatsByWard();

      expect(stats).toBeDefined();
      expect(Array.isArray(stats)).toBe(true);
      expect(stats.length).toBeGreaterThan(0);
    });
  });

  describe('Cleanup', () => {
    test('should soft delete journey', async () => {
      const result = await repository.deleteJourney(testJourneyId, 'test-user-1');
      expect(result).toBe(true);

      // Verify journey still exists but is marked as deleted
      const journey = await repository.findJourneyById(testJourneyId);
      const metadata = JSON.parse(journey.journey_metadata_jsonb || '{}');
      expect(metadata.deleted).toBeDefined();
    });
  });
});

// Export for use in other test files
module.exports = { InpatientJourneysRepository };