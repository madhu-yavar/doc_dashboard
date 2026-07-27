/**
 * Daily Notes Repository Unit Tests
 *
 * Tests for DailyNotesRepository functionality including:
 * - CRUD operations
 * - Voice integration
 * - Paper digitization support
 * - Timeline queries
 * - Review workflow
 */

const { DailyNotesRepository } = require('../daily_notes_repository.cjs');

describe('DailyNotesRepository', () => {
  let repository;
  let testJourneyId;
  let testNoteId;

  beforeAll(async () => {
    // Initialize repository with test database connection
    repository = new DailyNotesRepository();
    await repository.initialize();

    // Create a test journey first
    const { InpatientJourneysRepository } = require('../inpatient_journeys_repository.cjs');
    const journeyRepo = new InpatientJourneysRepository();
    await journeyRepo.initialize();

    const journeyData = {
      encounter_id: 'test-encounter-daily-notes',
      patient_id: 'test-patient-daily-notes',
      status: 'admitted',
      admission_type: 'routine',
      current_ward: 'General Ward'
    };

    const journey = await journeyRepo.createJourney(journeyData);
    testJourneyId = journey.id;

    await journeyRepo.close();
  });

  afterAll(async () => {
    // Clean up and close connection
    await repository.close();
  });

  describe('Repository Initialization', () => {
    test('should initialize successfully', async () => {
      expect(repository).toBeInstanceOf(DailyNotesRepository);
      expect(repository.isConnected).toBe(true);
    });

    test('should have health check return healthy status', async () => {
      const health = await repository.healthCheck();
      expect(health.status).toBe('healthy');
      expect(health.connected).toBe(true);
    });
  });

  describe('CRUD Operations', () => {
    test('should create a new daily note', async () => {
      const noteData = {
        journey_id: testJourneyId,
        encounter_id: 'test-encounter-daily-notes',
        patient_id: 'test-patient-daily-notes',
        note_type: 'progress',
        note_day_sequence: 1,
        source: 'manual',
        status: 'draft',
        note_date: new Date().toISOString().split('T')[0],
        note_time: '10:30:00',
        subjective_notes: 'Patient is feeling better today',
        objective_notes_jsonb = {
          vitals: { bp: '120/80', temp: '98.6F', pulse: '72' },
          physical_exam: 'No acute distress'
        },
        assessment: 'Patient improving',
        plan: 'Continue current treatment',
        created_by_user_id: 'test-user-1'
      };

      const note = await repository.createDailyNote(noteData);

      expect(note).toBeDefined();
      expect(note.id).toBeDefined();
      expect(note.journey_id).toBe(testJourneyId);
      expect(note.note_type).toBe('progress');
      expect(note.source).toBe('manual');

      testNoteId = note.id;
    });

    test('should find note by ID', async () => {
      const note = await repository.findNoteById(testNoteId);

      expect(note).toBeDefined();
      expect(note.id).toBe(testNoteId);
      expect(note.journey_id).toBe(testJourneyId);
    });

    test('should find notes by journey', async () => {
      const notes = await repository.findNotesByJourney(testJourneyId);

      expect(notes).toBeDefined();
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0].journey_id).toBe(testJourneyId);
    });

    test('should update note', async () => {
      const updateData = {
        subjective_notes: 'Updated subjective notes',
        assessment: 'Updated assessment',
        vitals_jsonb: { bp: '118/78', temp: '98.4F' }
      };

      const updatedNote = await repository.updateNote(testNoteId, updateData);

      expect(updatedNote).toBeDefined();
      expect(updatedNote.subjective_notes).toBe('Updated subjective notes');
      expect(updatedNote.assessment).toBe('Updated assessment');
    });

    test('should update note status', async () => {
      const reviewData = {
        reviewed_by_user_id: 'test-reviewer-1',
        reviewed_at: new Date().toISOString(),
        review_notes_jsonb: [{ comment: 'Looks good, approved' }]
      };

      const updatedNote = await repository.updateNoteStatus(testNoteId, 'approved', reviewData);

      expect(updatedNote).toBeDefined();
      expect(updatedNote.status).toBe('approved');
      expect(updatedNote.reviewed_by_user_id).toBe('test-reviewer-1');
    });
  });

  describe('Timeline and Statistics', () => {
    test('should get daily notes timeline', async () => {
      const timeline = await repository.getDailyNotesTimeline(testJourneyId);

      expect(timeline).toBeDefined();
      expect(timeline.notes).toBeDefined();
      expect(timeline.statistics).toBeDefined();
      expect(timeline.statistics.total_notes).toBeGreaterThan(0);
    });

    test('should get daily notes statistics', async () => {
      const stats = await repository.getDailyNotesStats({
        journey_id: testJourneyId
      });

      expect(stats).toBeDefined();
      expect(stats.total_notes).toBeDefined();
      expect(stats.approved_notes).toBeDefined();
    });

    test('should find notes by status', async () => {
      const notes = await repository.findNotesByStatus('approved', {
        journey_id: testJourneyId
      });

      expect(notes).toBeDefined();
      expect(Array.isArray(notes)).toBe(true);
    });

    test('should find latest note by type', async () => {
      const note = await repository.findLatestNoteByType(testJourneyId, 'progress');

      expect(note).toBeDefined();
      expect(note.note_type).toBe('progress');
    });
  });

  describe('Voice Integration', () => {
    test('should link voice session to note', async () => {
      const linkedNote = await repository.linkVoiceSession(
        testNoteId,
        'test-voice-session-1',
        'test-transcript-1'
      );

      expect(linkedNote).toBeDefined();
      expect(linkedNote.voice_session_id).toBe('test-voice-session-1');
      expect(linkedNote.transcript_id).toBe('test-transcript-1');
      expect(linkedNote.source).toBe('voice_upload');
    });

    test('should find notes by voice session', async () => {
      const notes = await repository.findNotesByVoiceSession('test-voice-session-1');

      expect(notes).toBeDefined();
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0].voice_session_id).toBe('test-voice-session-1');
    });

    test('should find notes by transcript', async () => {
      const notes = await repository.findNotesByTranscript('test-transcript-1');

      expect(notes).toBeDefined();
      expect(Array.isArray(notes)).toBe(true);
    });
  });

  describe('Paper Digitization Support', () => {
    test('should find notes by source', async () => {
      const notes = await repository.findNotesBySource('manual', {
        journey_id: testJourneyId
      });

      expect(notes).toBeDefined();
      expect(Array.isArray(notes)).toBe(true);
    });

    test('should update verification status', async () => {
      const verificationData = {
        verified_by_user_id: 'test-verifier-1',
        verification_status: 'verified',
        verification_notes: 'Content verified and accurate',
        verified_data_jsonb = { verified_fields: ['subjective_notes', 'assessment'] }
      };

      const updatedNote = await repository.updateVerificationStatus(testNoteId, verificationData);

      expect(updatedNote).toBeDefined();
      expect(updatedNote.status).toBe('approved'); // Verified notes become approved
      expect(updatedNote.reviewed_by_user_id).toBe('test-verifier-1');
    });

    test('should find unverified notes', async () => {
      // Create another draft note that needs verification
      const draftNoteData = {
        journey_id: testJourneyId,
        encounter_id: 'test-encounter-daily-notes',
        patient_id: 'test-patient-daily-notes',
        note_type: 'progress',
        note_day_sequence: 2,
        source: 'manual',
        status: 'draft',
        note_date: new Date().toISOString().split('T')[0],
        subjective_notes: 'Draft note needing verification',
        created_by_user_id: 'test-user-1'
      };

      await repository.createDailyNote(draftNoteData);

      const unverifiedNotes = await repository.findUnverifiedNotes({
        journey_id: testJourneyId
      });

      expect(unverifiedNotes).toBeDefined();
      expect(Array.isArray(unverifiedNotes)).toBe(true);
    });
  });

  describe('Batch Operations', () => {
    test('should batch update note statuses', async () => {
      // Create multiple test notes
      const noteIds = [];
      for (let i = 0; i < 3; i++) {
        const noteData = {
          journey_id: testJourneyId,
          encounter_id: 'test-encounter-daily-notes',
          patient_id: 'test-patient-daily-notes',
          note_type: 'progress',
          note_day_sequence: 3 + i,
          source: 'manual',
          status: 'draft',
          note_date: new Date().toISOString().split('T')[0],
          subjective_notes = `Test note ${i + 1}`,
          created_by_user_id: 'test-user-1'
        };

        const note = await repository.createDailyNote(noteData);
        noteIds.push(note.id);
      }

      const updateCount = await repository.batchUpdateStatus(
        noteIds,
        'pending_review',
        { review_required_by_user_id: 'test-reviewer-1' }
      );

      expect(updateCount).toBe(3);
    });
  });

  describe('Search and Filter Operations', () => {
    test('should find notes by date range', async () => {
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endDate = new Date().toISOString().split('T')[0];

      const notes = await repository.findNotesByDateRange(
        'test-patient-daily-notes',
        startDate,
        endDate
      );

      expect(notes).toBeDefined();
      expect(Array.isArray(notes)).toBe(true);
    });

    test('should find notes needing attention', async () => {
      const notes = await repository.findNotesNeedingAttention({
        status: ['draft'],
        source: 'manual',
        limit: 10
      });

      expect(notes).toBeDefined();
      expect(Array.isArray(notes)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid note ID gracefully', async () => {
      const note = await repository.findNoteById('invalid-id');
      expect(note).toBeNull();
    });

    test('should handle update with no valid fields', async () => {
      await expect(
        repository.updateNote(testNoteId, { invalid_field: 'value' })
      ).rejects.toThrow('No valid fields to update');
    });

    test('should handle non-existent note update', async () => {
      const result = await repository.updateNote('non-existent-id', { subjective_notes: 'Test' });
      expect(result).toBeNull();
    });
  });

  describe('Delete Operations', () => {
    test('should soft delete note', async () => {
      const result = await repository.deleteNote(testNoteId, 'test-user-1');
      expect(result).toBe(true);

      // Verify note still exists but is superseded
      const note = await repository.findNoteById(testNoteId);
      expect(note.status).toBe('superseded');
    });
  });
});

module.exports = { DailyNotesRepository };