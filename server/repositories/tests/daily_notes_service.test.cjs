/**
 * Daily Notes Service Tests
 *
 * Comprehensive test suite for DailyNotesService functionality including
 * manual notes, voice processing, and paper digitization workflows
 */

const { DailyNotesService } = require('../../daily_notes_service.cjs');

// Mock repositories and services
class MockDailyNotesRepository {
  constructor() {
    this.initialize = jest.fn().mockResolvedValue(true);
    this.close = jest.fn().mockResolvedValue(true);
    this.createDailyNote = jest.fn().mockResolvedValue({
      id: 'note-1',
      status: 'draft',
      source: 'manual'
    });
    this.findNoteById = jest.fn().mockResolvedValue({
      id: 'note-1',
      status: 'draft',
      source: 'manual'
    });
    this.findNotesByJourney = jest.fn().mockResolvedValue([]);
    this.updateNote = jest.fn().mockResolvedValue({
      id: 'note-1',
      status: 'pending_review'
    });
    this.updateNoteStatus = jest.fn().mockResolvedValue({
      id: 'note-1',
      status: 'pending_review'
    });
    this.deleteNote = jest.fn().mockResolvedValue(true);
  }

  reset() {
    this.initialize.mockClear();
    this.createDailyNote.mockClear();
    this.findNoteById.mockClear();
    this.updateNote.mockClear();
    this.updateNoteStatus.mockClear();
    this.deleteNote.mockClear();
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
    this.initialize.mockClear();
    this.findJourneyById.mockClear();
  }
}

class MockVoiceProcessor {
  constructor() {
    this.initialize = jest.fn().mockResolvedValue(true);
    this.startSession = jest.fn().mockResolvedValue({
      id: 'session-1',
      status: 'active'
    });
    this.processAudio = jest.fn().mockResolvedValue({
      raw_text: 'Patient is doing well with improved appetite and sleep.',
      structured_data: {
        subjective: 'Patient reports improved appetite and sleep.',
        objective: { vitals: 'stable' },
        assessment: 'Patient improving',
        plan: 'Continue current management'
      }
    });
    this.processAudioFile = jest.fn().mockResolvedValue({
      raw_text: 'Patient is doing well.',
      processing_time: 1200
    });
    this.extractDailyNoteStructure = jest.fn().mockResolvedValue({
      subjective: 'Patient reports improved appetite and sleep.',
      objective: { vitals: 'stable' },
      assessment: 'Patient improving',
      plan: 'Continue current management'
    });
  }

  reset() {
    this.startSession.mockClear();
    this.processAudio.mockClear();
    this.extractDailyNoteStructure.mockClear();
  }
}

class MockPaperDigitizationService {
  constructor() {
    this.initialize = jest.fn().mockResolvedValue(true);
    this.processPaperNote = jest.fn().mockResolvedValue({
      success: true,
      extracted_text: 'Patient progress note from paper chart',
      extracted_data: {
        subjective: 'Extracted from paper notes',
        objective: { findings: 'normal' },
        assessment: 'Stable',
        plan: 'Continue treatment'
      }
    });
    this.detectDate = jest.fn().mockResolvedValue('2026-07-23');
  }

  reset() {
    this.processPaperNote.mockClear();
    this.detectDate.mockClear();
  }
}

describe('DailyNotesService', () => {
  let service;
  let mockNotesRepo;
  let mockJourneysRepo;
  let mockVoiceProcessor;
  let mockPaperService;

  beforeEach(() => {
    mockNotesRepo = new MockDailyNotesRepository();
    mockJourneysRepo = new MockJourneysRepository();
    mockVoiceProcessor = new MockVoiceProcessor();
    mockPaperService = new MockPaperDigitizationService();

    service = new DailyNotesService({
      dailyNotesRepository: mockNotesRepo,
      journeysRepository: mockJourneysRepo,
      voiceProcessor: mockVoiceProcessor,
      paperDigitizationService: mockPaperService
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

      expect(mockNotesRepo.initialize).toHaveBeenCalled();
      expect(mockJourneysRepo.initialize).toHaveBeenCalled();
      expect(mockVoiceProcessor.initialize).toHaveBeenCalled();
      expect(mockPaperService.initialize).toHaveBeenCalled();
    });

    test('should handle initialization without optional services', async () => {
      const serviceBasic = new DailyNotesService({
        dailyNotesRepository: mockNotesRepo,
        journeysRepository: mockJourneysRepo
      });

      await serviceBasic.initialize();

      expect(mockNotesRepo.initialize).toHaveBeenCalled();
      expect(mockJourneysRepo.initialize).toHaveBeenCalled();
    });

    test('should handle initialization errors gracefully', async () => {
      mockNotesRepo.initialize.mockRejectedValue(new Error('Database error'));

      await expect(service.initialize()).rejects.toThrow('Database error');
    });
  });

  describe('Manual Note Creation', () => {
    test('should create manual daily note with valid data', async () => {
      const noteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        note_type: 'progress',
        subjective_notes: 'Patient reports improved symptoms',
        assessment: 'Patient improving',
        plan: 'Continue current treatment',
        created_by_user_id: 'user-1'
      };

      const result = await service.createDailyNoteManual(noteData);

      expect(result).toHaveProperty('note');
      expect(result).toHaveProperty('validation_warnings');
      expect(result).toHaveProperty('next_actions');
      expect(mockNotesRepo.createDailyNote).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'manual',
          note_type: 'progress'
        })
      );
    });

    test('should validate journey exists and is active', async () => {
      mockJourneysRepo.findJourneyById.mockResolvedValue({
        id: 'journey-1',
        status: 'discharged' // Not active
      });

      const noteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        subjective_notes: 'Test note',
        assessment: 'Test',
        plan: 'Test',
        created_by_user_id: 'user-1'
      };

      await expect(service.createDailyNoteManual(noteData))
        .rejects.toThrow('Cannot create note for journey with status');
    });

    test('should validate SOAP note data when enabled', async () => {
      const serviceWithValidation = new DailyNotesService({
        dailyNotesRepository: mockNotesRepo,
        journeysRepository: mockJourneysRepo,
        enableSOAPValidation: true
      });

      const invalidNoteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        // Missing subjective_notes, assessment, plan
        created_by_user_id: 'user-1'
      };

      await expect(serviceWithValidation.createDailyNoteManual(invalidNoteData))
        .rejects.toThrow('SOAP note validation failed');
    });

    test('should calculate note day sequence correctly', async () => {
      mockNotesRepo.findNotesByJourney.mockResolvedValue([
        { id: 'note-1', note_day_sequence: 1 },
        { id: 'note-2', note_day_sequence: 2 }
      ]);

      const noteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        subjective_notes: 'Test note',
        assessment: 'Test',
        plan: 'Test',
        created_by_user_id: 'user-1'
      };

      await service.createDailyNoteManual(noteData);

      expect(mockNotesRepo.createDailyNote).toHaveBeenCalledWith(
        expect.objectContaining({
          note_day_sequence: 3
        })
      );
    });

    test('should auto-submit note when requested', async () => {
      const noteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        subjective_notes: 'Test note',
        assessment: 'Test',
        plan: 'Test',
        created_by_user_id: 'user-1',
        auto_submit: true
      };

      await service.createDailyNoteManual(noteData);

      expect(mockNotesRepo.createDailyNote).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending_review'
        })
      );
    });
  });

  describe('Voice Note Processing', () => {
    test('should process voice note successfully', async () => {
      const voiceNoteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        audio_data: Buffer.from('mock audio data'),
        created_by_user_id: 'user-1'
      };

      const result = await service.createDailyNoteVoice(voiceNoteData);

      expect(result).toHaveProperty('note');
      expect(result).toHaveProperty('processing_result');
      expect(result.processing_result.success).toBe(true);
      expect(mockVoiceProcessor.processAudio).toHaveBeenCalled();
    });

    test('should handle voice processing errors gracefully', async () => {
      mockVoiceProcessor.processAudio.mockRejectedValue(new Error('Audio processing failed'));

      const voiceNoteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        audio_data: Buffer.from('mock audio data'),
        created_by_user_id: 'user-1'
      };

      const result = await service.createDailyNoteVoice(voiceNoteData);

      expect(mockNotesRepo.updateNoteStatus).toHaveBeenCalledWith(
        expect.any(String),
        'draft',
        expect.objectContaining({
          review_notes_jsonb: expect.arrayContaining([
            expect.objectContaining({
              processing_error: expect.any(String)
            })
          ])
        })
      );
    });

    test('should require approval for voice notes when configured', async () => {
      const serviceWithApproval = new DailyNotesService({
        dailyNotesRepository: mockNotesRepo,
        journeysRepository: mockJourneysRepo,
        voiceProcessor: mockVoiceProcessor,
        requireApprovalForVoiceNotes: true
      });

      const voiceNoteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        audio_data: Buffer.from('mock audio data'),
        created_by_user_id: 'user-1'
      };

      const result = await service.createDailyNoteVoice(voiceNoteData);

      expect(result.requires_review).toBe(true);
      expect(mockNotesRepo.updateNoteStatus).toHaveBeenCalledWith(
        expect.any(String),
        'pending_review',
        expect.any(Object)
      );
    });

    test('should process voice audio file in batch mode', async () => {
      const voiceNoteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        audio_file_path: '/path/to/audio.wav',
        real_time_processing: false,
        created_by_user_id: 'user-1'
      };

      const result = await service.createDailyNoteVoice(voiceNoteData);

      expect(mockVoiceProcessor.processAudioFile).toHaveBeenCalledWith('/path/to/audio.wav', expect.any(Object));
      expect(result.processing_result.success).toBe(true);
    });

    test('should update note from voice transcription results', async () => {
      const processingResult = {
        success: true,
        transcript: { raw_text: 'Patient is doing well' },
        extracted_data: {
          subjective: 'Patient reports doing well',
          objective: { vitals: 'stable' },
          assessment: 'Patient stable',
          plan: 'Continue current management'
        }
      };

      await service.updateNoteFromVoiceTranscription('note-1', processingResult);

      expect(mockNotesRepo.updateNote).toHaveBeenCalledWith('note-1', {
        subjective_notes: 'Patient reports doing well',
        objective_notes_jsonb: { vitals: 'stable' },
        assessment: 'Patient stable',
        plan: 'Continue current management',
        vitals_jsonb: {},
        medications_jsonb: {}
      });
    });
  });

  describe('Paper Digitization Workflow', () => {
    test('should process paper note successfully', async () => {
      const paperNoteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        image_data: Buffer.from('mock image data'),
        created_by_user_id: 'user-1'
      };

      const result = await service.createDailyNoteFromPaper(paperNoteData);

      expect(result).toHaveProperty('note');
      expect(result).toHaveProperty('digitization_result');
      expect(result.digitization_result.success).toBe(true);
      expect(mockPaperService.processPaperNote).toHaveBeenCalled();
    });

    test('should detect date from paper image', async () => {
      const paperNoteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        image_file_path: '/path/to/paper_note.jpg',
        created_by_user_id: 'user-1'
      };

      await service.createDailyNoteFromPaper(paperNoteData);

      expect(mockPaperService.detectDate).toHaveBeenCalled();
      expect(mockNotesRepo.createDailyNote).toHaveBeenCalledWith(
        expect.objectContaining({
          note_date: '2026-07-23'
        })
      );
    });

    test('should auto-submit paper notes for verification when configured', async () => {
      const serviceWithVerification = new DailyNotesService({
        dailyNotesRepository: mockNotesRepo,
        journeysRepository: mockJourneysRepo,
        paperDigitizationService: mockPaperService,
        autoSubmitPaperForVerification: true
      });

      const paperNoteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        image_data: Buffer.from('mock image data'),
        created_by_user_id: 'user-1'
      };

      const result = await service.createDailyNoteFromPaper(paperNoteData);

      expect(result.requires_verification).toBe(true);
    });

    test('should handle paper digitization errors gracefully', async () => {
      mockPaperService.processPaperNote.mockResolvedValue({
        success: false,
        error: 'OCR processing failed'
      });

      const paperNoteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        image_data: Buffer.from('mock image data'),
        created_by_user_id: 'user-1'
      };

      const result = await service.createDailyNoteFromPaper(paperNoteData);

      expect(mockNotesRepo.updateNoteStatus).toHaveBeenCalledWith(
        expect.any(String),
        'draft',
        expect.objectContaining({
          review_notes_jsonb: expect.arrayContaining([
            expect.objectContaining({
              digitization_error: 'OCR processing failed'
            })
          ])
        })
      );
    });

    test('should update note from paper extraction results', async () => {
      const digitizationResult = {
        success: true,
        extracted_data: {
          subjective: 'Extracted from paper notes',
          objective: { findings: 'normal' },
          assessment: 'Stable',
          plan: 'Continue treatment'
        }
      };

      await service.updateNoteFromPaperExtraction('note-1', digitizationResult);

      expect(mockNotesRepo.updateNote).toHaveBeenCalledWith('note-1', {
        subjective_notes: 'Extracted from paper notes',
        objective_notes_jsonb: { findings: 'normal' },
        assessment: 'Stable',
        plan: 'Continue treatment'
      });
    });
  });

  describe('Note Update and Management', () => {
    test('should update existing daily note', async () => {
      mockNotesRepo.findNoteById.mockResolvedValue({
        id: 'note-1',
        status: 'draft',
        source: 'manual'
      });

      const updateData = {
        subjective_notes: 'Updated subjective notes',
        assessment: 'Updated assessment'
      };

      const result = await service.updateDailyNote('note-1', updateData, {
        updated_by_user_id: 'user-1'
      });

      expect(result).toHaveProperty('note');
      expect(mockNotesRepo.updateNote).toHaveBeenCalledWith('note-1', updateData);
    });

    test('should prevent editing approved notes without permission', async () => {
      mockNotesRepo.findNoteById.mockResolvedValue({
        id: 'note-1',
        status: 'approved',
        source: 'manual'
      });

      const updateData = {
        subjective_notes: 'Trying to edit approved note'
      };

      await expect(service.updateDailyNote('note-1', updateData, {
        updated_by_user_id: 'user-1'
      })).rejects.toThrow('Cannot edit approved note');
    });

    test('should validate update data when enabled', async () => {
      const serviceWithValidation = new DailyNotesService({
        dailyNotesRepository: mockNotesRepo,
        journeysRepository: mockJourneysRepo,
        enableSOAPValidation: true
      });

      mockNotesRepo.findNoteById.mockResolvedValue({
        id: 'note-1',
        status: 'draft',
        source: 'manual'
      });

      const invalidUpdate = {
        subjective_notes: 'Updated note'
        // Missing assessment and plan
      };

      await expect(serviceWithValidation.updateDailyNote('note-1', invalidUpdate))
        .rejects.toThrow('SOAP note validation failed');
    });

    test('should delete daily note when allowed', async () => {
      mockNotesRepo.findNoteById.mockResolvedValue({
        id: 'note-1',
        status: 'draft',
        source: 'manual'
      });

      const result = await service.deleteDailyNote('note-1', 'user-1');

      expect(result).toBe(true);
      expect(mockNotesRepo.deleteNote).toHaveBeenCalledWith('note-1', 'user-1');
    });

    test('should prevent deleting approved notes when configured', async () => {
      mockNotesRepo.findNoteById.mockResolvedValue({
        id: 'note-1',
        status: 'approved',
        source: 'manual'
      });

      await expect(service.deleteDailyNote('note-1', 'user-1'))
        .rejects.toThrow('Cannot delete approved note');
    });
  });

  describe('Review and Approval Processes', () => {
    test('should submit note for review', async () => {
      mockNotesRepo.findNoteById.mockResolvedValue({
        id: 'note-1',
        status: 'draft',
        source: 'manual'
      });

      await service.submitForReview('note-1', 'user-1');

      expect(mockNotesRepo.updateNoteStatus).toHaveBeenCalledWith('note-1', 'pending_review', expect.any(Object));
    });

    test('should approve daily note', async () => {
      mockNotesRepo.findNoteById.mockResolvedValue({
        id: 'note-1',
        status: 'pending_review',
        source: 'manual'
      });

      await service.approveDailyNote('note-1', 'user-1');

      expect(mockNotesRepo.updateNoteStatus).toHaveBeenCalledWith('note-1', 'approved', expect.any(Object));
    });

    test('should reject daily note with reason', async () => {
      mockNotesRepo.findNoteById.mockResolvedValue({
        id: 'note-1',
        status: 'pending_review',
        source: 'manual'
      });

      await service.rejectDailyNote('note-1', 'user-1', 'Incomplete documentation');

      expect(mockNotesRepo.updateNoteStatus).toHaveBeenCalledWith('note-1', 'rejected', expect.objectContaining({
        rejection_reason: 'Incomplete documentation'
      }));
    });

    test('should submit note for verification', async () => {
      mockNotesRepo.findNoteById.mockResolvedValue({
        id: 'note-1',
        status: 'draft',
        source: 'manual'
      });

      await service.submitForVerification('note-1', 'user-1');

      expect(mockNotesRepo.updateNoteStatus).toHaveBeenCalledWith('note-1', 'pending_review', expect.objectContaining({
        review_required_by_user_id: 'user-1'
      }));
    });
  });

  describe('Note Analytics and Statistics', () => {
    test('should get note statistics for journey', async () => {
      mockNotesRepo.findNotesByJourney.mockResolvedValue([
        { id: 'note-1', note_type: 'progress', status: 'approved', source: 'manual', note_date: '2026-07-23' },
        { id: 'note-2', note_type: 'admission', status: 'approved', source: 'voice', note_date: '2026-07-22' },
        { id: 'note-3', note_type: 'progress', status: 'draft', source: 'manual', note_date: '2026-07-23' }
      ]);

      const stats = await service.getNoteStatistics('journey-1');

      expect(stats).toHaveProperty('total_notes', 3);
      expect(stats.notes_by_type).toEqual({
        progress: 2,
        admission: 1
      });
      expect(stats.notes_by_status).toEqual({
        approved: 2,
        draft: 1
      });
    });

    test('should analyze note patterns', async () => {
      const notes = [
        { note_type: 'progress', status: 'approved', source: 'manual', created_at: '2026-07-23T10:00:00Z' },
        { note_type: 'progress', status: 'approved', source: 'voice', created_at: '2026-07-23T14:00:00Z' },
        { note_type: 'admission', status: 'approved', source: 'manual', created_at: '2026-07-22T09:00:00Z' }
      ];

      const patterns = service.analyzeDailyNotePatterns(notes);

      expect(patterns).toHaveProperty('total_notes', 3);
      expect(patterns).toHaveProperty('most_common_type', 'progress');
      expect(patterns).toHaveProperty('completion_rate', 100);
    });

    test('should assess documentation quality', async () => {
      const notes = [
        { note_type: 'progress', status: 'approved', source: 'manual' },
        { note_type: 'progress', status: 'draft', source: 'voice' },
        { note_type: 'progress', status: 'pending_review', source: 'manual' }
      ];

      const quality = service.assessDocumentationQuality(notes);

      expect(quality).toHaveProperty('overall_quality');
      expect(quality).toHaveProperty('completion_rate');
      expect(quality).toHaveProperty('source_diversity');
    });

    test('should calculate note frequency', async () => {
      const notes = [
        { note_date: '2026-07-23' },
        { note_date: '2026-07-23' },
        { note_date: '2026-07-22' },
        { note_date: '2026-07-21' }
      ];

      const frequency = service.calculateNoteFrequency(notes);

      expect(frequency).toHaveProperty('frequency');
      expect(frequency).toHaveProperty('consistency');
      expect(frequency).toHaveProperty('total_days', 3);
    });
  });

  describe('Helper and Utility Methods', () => {
    test('should validate SOAP note data correctly', () => {
      const validSOAP = {
        subjective_notes: 'Patient symptoms',
        assessment: 'Patient condition',
        plan: 'Treatment plan'
      };

      expect(() => service.validateSOAPNoteData(validSOAP)).not.toThrow();
    });

    test('should detect note date from paper image', async () => {
      mockPaperService.detectDate.mockResolvedValue('2026-07-20');

      const detectedDate = await service.detectNoteDateFromImage(Buffer.from('mock image'));

      expect(detectedDate).toBe('2026-07-20');
    });

    test('should default to today when date detection fails', async () => {
      mockPaperService.detectDate.mockRejectedValue(new Error('Detection failed'));

      const detectedDate = await service.detectNoteDateFromImage(Buffer.from('mock image'));

      expect(detectedDate).toBe(new Date().toISOString().split('T')[0]);
    });

    test('should validate note quality correctly', () => {
      const note = {
        subjective_notes: 'Comprehensive patient assessment with detailed symptoms and history',
        assessment: 'Clear clinical assessment with findings',
        plan: 'Detailed treatment plan with medications and follow-up'
      };

      const warnings = service.validateNoteQuality(note);

      expect(Array.isArray(warnings)).toBe(true);
    });

    test('should determine next actions for notes', () => {
      const draftNote = {
        id: 'note-1',
        status: 'draft',
        source: 'manual'
      };

      const actions = service.determineNextActions(draftNote, false);

      expect(Array.isArray(actions)).toBe(true);
    });
  });

  describe('Configuration Options', () => {
    test('should respect requireApprovalForVoiceNotes configuration', async () => {
      const serviceNoApproval = new DailyNotesService({
        dailyNotesRepository: mockNotesRepo,
        journeysRepository: mockJourneysRepo,
        voiceProcessor: mockVoiceProcessor,
        requireApprovalForVoiceNotes: false
      });

      const voiceNoteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        audio_data: Buffer.from('mock audio data'),
        created_by_user_id: 'user-1'
      };

      const result = await serviceNoApproval.createDailyNoteVoice(voiceNoteData);

      expect(result.requires_review).toBe(false);
    });

    test('should respect autoSubmitPaperForVerification configuration', async () => {
      const serviceNoVerification = new DailyNotesService({
        dailyNotesRepository: mockNotesRepo,
        journeysRepository: mockJourneysRepo,
        paperDigitizationService: mockPaperService,
        autoSubmitPaperForVerification: false
      });

      const paperNoteData = {
        journey_id: 'journey-1',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        image_data: Buffer.from('mock image data'),
        created_by_user_id: 'user-1'
      };

      const result = await serviceNoVerification.createDailyNoteFromPaper(paperNoteData);

      expect(result.requires_verification).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('should handle note not found errors', async () => {
      mockNotesRepo.findNoteById.mockResolvedValue(null);

      await expect(service.updateDailyNote('nonexistent-note', {}))
        .rejects.toThrow('Note not found');
    });

    test('should handle journey not found errors', async () => {
      mockJourneysRepo.findJourneyById.mockResolvedValue(null);

      const noteData = {
        journey_id: 'nonexistent-journey',
        encounter_id: 'encounter-1',
        patient_id: 'patient-1',
        subjective_notes: 'Test',
        assessment: 'Test',
        plan: 'Test',
        created_by_user_id: 'user-1'
      };

      await expect(service.createDailyNoteManual(noteData))
        .rejects.toThrow('Journey not found');
    });

    test('should handle cleanup errors gracefully', async () => {
      mockNotesRepo.close.mockRejectedValue(new Error('Close error'));

      await expect(service.cleanup()).resolves.not.toThrow();
    });
  });
});

module.exports = {
  MockDailyNotesRepository,
  MockJourneysRepository,
  MockVoiceProcessor,
  MockPaperDigitizationService
};