/**
 * Daily Notes Service - Phase 2: Service Layer (Business Logic)
 *
 * Orchestrates daily progress notes management with multi-source support.
 * Handles manual entry, voice dictation, and paper digitization workflows.
 *
 * Responsibilities:
 * - Multi-source note creation (manual, voice, paper)
 * - Voice session integration
 * - Paper digitization workflow
 * - Review and approval processes
 * - Clinical documentation standards
 * - Statistics and reporting
 */

const { DailyNotesRepository } = require('./repositories/daily_notes_repository.cjs');
const { InpatientJourneysRepository } = require('./repositories/inpatient_journeys_repository.cjs');

class DailyNotesService {
  constructor(config = {}) {
    this.name = 'DailyNotesService';
    this.dailyNotesRepository = config.dailyNotesRepository || new DailyNotesRepository();
    this.journeysRepository = config.journeysRepository || new InpatientJourneysRepository();

    // Voice processing service (to be integrated later)
    this.voiceProcessor = config.voiceProcessor || null;

    // Paper digitization service (to be integrated later)
    this.paperDigitizationService = config.paperDigitizationService || null;

    // Configuration options
    this.requireApprovalForVoiceNotes = config.requireApprovalForVoiceNotes !== false; // default true
    this.autoSubmitPaperForVerification = config.autoSubmitPaperForVerification !== false; // default true
    this.maxVoiceProcessingTime = config.maxVoiceProcessingTime || 300000; // 5 minutes default
    this.enableSOAPValidation = config.enableSOAPValidation !== false; // default true
  }

  /**
   * Initialize the service and its repositories
   */
  async initialize() {
    await this.dailyNotesRepository.initialize();
    await this.journeysRepository.initialize();

    // Initialize optional services if provided
    if (this.voiceProcessor && this.voiceProcessor.initialize) {
      await this.voiceProcessor.initialize();
    }

    if (this.paperDigitizationService && this.paperDigitizationService.initialize) {
      await this.paperDigitizationService.initialize();
    }
  }

  // ========================================
  // Manual Note Creation and Management
  // ========================================

  /**
   * Create a manual daily note
   * @param {Object} noteData - Note creation data
   * @returns {Object} Created daily note with validation results
   */
  async createDailyNoteManual(noteData) {
    const {
      journey_id,
      encounter_id,
      patient_id,
      note_type = 'progress',
      note_date = new Date().toISOString().split('T')[0],
      note_time = new Date().toTimeString().split(' ')[0],
      subjective_notes,
      objective_notes_jsonb = {},
      assessment,
      plan,
      created_by_user_id,
      auto_submit = false,
      skip_validation = false
    } = noteData;

    // Validate journey exists and is active
    const journey = await this.journeysRepository.findJourneyById(journey_id);
    if (!journey) {
      throw new Error('Journey not found');
    }

    if (journey.status !== 'admitted' && journey.status !== 'in_progress') {
      throw new Error(`Cannot create note for journey with status: ${journey.status}`);
    }

    // Validate note data if enabled
    if (!skip_validation && this.enableSOAPValidation) {
      this.validateSOAPNoteData({ subjective_notes, assessment, plan });
    }

    // Calculate note day sequence
    const existingNotes = await this.dailyNotesRepository.findNotesByJourney(journey_id);
    const maxSequence = existingNotes.length > 0 ? Math.max(...existingNotes.map(n => n.note_day_sequence || 0)) : 0;
    const note_day_sequence = maxSequence + 1;

    // Prepare note data
    const completeNoteData = {
      journey_id,
      encounter_id,
      patient_id,
      note_type,
      note_day_sequence,
      source: 'manual',
      status: auto_submit ? 'pending_review' : 'draft',
      note_date,
      note_time,
      subjective_notes,
      objective_notes_jsonb,
      assessment,
      plan,
      created_by_user_id
    };

    // Create the note
    const note = await this.dailyNotesRepository.createDailyNote(completeNoteData);

    // Auto-submit if requested
    if (auto_submit) {
      await this.submitForReview(note.id, created_by_user_id);
    }

    return {
      note,
      validation_warnings: this.validateNoteQuality(note),
      next_actions: this.determineNextActions(note, auto_submit)
    };
  }

  /**
   * Update an existing daily note
   * @param {string} noteId - Note ID
   * @param {Object} updateData - Data to update
   * @param {Object} options - Update options
   * @returns {Object} Updated note with validation results
   */
  async updateDailyNote(noteId, updateData, options = {}) {
    const {
      updated_by_user_id,
      create_new_version = false,
      skip_status_change = false
    } = options;

    // Get existing note
    const existingNote = await this.dailyNotesRepository.findNoteById(noteId);
    if (!existingNote) {
      throw new Error('Note not found');
    }

    // Check if note can be edited
    if (existingNote.status === 'approved' && !options.allow_edit_approved) {
      throw new Error('Cannot edit approved note without special permission');
    }

    // Validate update data if SOAP enabled
    if (this.enableSOAPValidation && !options.skip_validation) {
      const { subjective_notes, assessment, plan } = updateData;
      this.validateSOAPNoteData({ subjective_notes, assessment, plan });
    }

    // Update the note
    const updatedNote = await this.dailyNotesRepository.updateNote(noteId, updateData);

    // Update status if needed
    let statusUpdated = false;
    if (!skip_status_change && updatedNote.status === 'draft' && this.isNoteComplete(updatedNote)) {
      await this.dailyNotesRepository.updateNoteStatus(noteId, 'pending_review', {});
      statusUpdated = true;
    }

    return {
      note: updatedNote,
      status_updated: statusUpdated,
      validation_warnings: this.validateNoteQuality(updatedNote),
      version_created: create_new_version
    };
  }

  /**
   * Delete a daily note
   * @param {string} noteId - Note ID
   * @param {string} deletedBy - User ID performing deletion
   * @returns {boolean} Success status
   */
  async deleteDailyNote(noteId, deletedBy) {
    const note = await this.dailyNotesRepository.findNoteById(noteId);
    if (!note) {
      throw new Error('Note not found');
    }

    // Check if note can be deleted
    if (note.status === 'approved' && !this.allowDeleteApproved) {
      throw new Error('Cannot delete approved note');
    }

    return await this.dailyNotesRepository.deleteNote(noteId, deletedBy);
  }

  // ========================================
  // Voice Note Creation and Processing
  // ========================================

  /**
   * Create a daily note from voice dictation
   * @param {Object} voiceNoteData - Voice note creation data
   * @returns {Object} Created note with processing status
   */
  async createDailyNoteVoice(voiceNoteData) {
    const {
      journey_id,
      encounter_id,
      patient_id,
      audio_data,
      audio_file_path,
      note_type = 'progress',
      real_time_processing = true,
      created_by_user_id,
      processing_options = {}
    } = voiceNoteData;

    // Validate journey exists and is active
    const journey = await this.journeysRepository.findJourneyById(journey_id);
    if (!journey) {
      throw new Error('Journey not found');
    }

    // Calculate note day sequence
    const existingNotes = await this.dailyNotesRepository.findNotesByJourney(journey_id);
    const maxSequence = existingNotes.length > 0 ? Math.max(...existingNotes.map(n => n.note_day_sequence || 0)) : 0;
    const note_day_sequence = maxSequence + 1;

    // Create initial note record
    const initialNoteData = {
      journey_id,
      encounter_id,
      patient_id,
      note_type,
      note_day_sequence,
      source: 'voice_upload',
      status: 'draft', // Will be updated after processing
      note_date: new Date().toISOString().split('T')[0],
      note_time: new Date().toTimeString().split(' ')[0],
      subjective_notes: '', // Will be populated by voice processing
      created_by_user_id
    };

    const note = await this.dailyNotesRepository.createDailyNote(initialNoteData);

    // Process voice and extract content
    let processingResult;
    try {
      if (real_time_processing && this.voiceProcessor) {
        // Real-time voice processing
        processingResult = await this.processVoiceRealTime(audio_data, note.id, processing_options);
      } else {
        // Batch processing
        processingResult = await this.processVoiceBatch(audio_file_path, note.id, processing_options);
      }

      // Update note with extracted content
      if (processingResult.success) {
        await this.updateNoteFromVoiceTranscription(note.id, processingResult);

        // Set status based on configuration
        const finalStatus = this.requireApprovalForVoiceNotes ? 'pending_review' : 'draft';
        await this.dailyNotesRepository.updateNoteStatus(note.id, finalStatus, {
          reviewed_by_user_id: created_by_user_id
        });
      } else {
        // Mark processing as failed
        await this.dailyNotesRepository.updateNoteStatus(note.id, 'draft', {
          review_notes_jsonb: [{ processing_error: processingResult.error }]
        });
      }

    } catch (error) {
      // Handle processing errors
      await this.dailyNotesRepository.updateNoteStatus(note.id, 'draft', {
        review_notes_jsonb: [{ processing_error: error.message }]
      });
      throw error;
    }

    // Get updated note
    const finalNote = await this.dailyNotesRepository.findNoteById(note.id);

    return {
      note: finalNote,
      processing_result: processingResult,
      requires_review: this.requireApprovalForVoiceNotes,
      next_actions: this.determineNextActions(finalNote, true)
    };
  }

  /**
   * Process voice audio in real-time
   * @param {Buffer} audioData - Audio data buffer
   * @param {string} noteId - Note ID for linking
   * @param {Object} options - Processing options
   * @returns {Object} Processing result
   */
  async processVoiceRealTime(audioData, noteId, options = {}) {
    if (!this.voiceProcessor) {
      throw new Error('Voice processor not configured');
    }

    try {
      // Start voice processing session
      const session = await this.voiceProcessor.startSession({
        note_id: noteId,
        processing_mode: 'real_time',
        max_duration: this.maxVoiceProcessingTime,
        ...options
      });

      // Process audio chunks
      const transcript = await this.voiceProcessor.processAudio(audioData, session.id);

      // Extract structured data from transcript
      const extractedData = await this.voiceProcessor.extractDailyNoteStructure(transcript);

      return {
        success: true,
        transcript,
        extracted_data: extractedData,
        session_id: session.id
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process voice audio file (batch)
   * @param {string} audioFilePath - Path to audio file
   * @param {string} noteId - Note ID for linking
   * @param {Object} options - Processing options
   * @returns {Object} Processing result
   */
  async processVoiceBatch(audioFilePath, noteId, options = {}) {
    if (!this.voiceProcessor) {
      throw new Error('Voice processor not configured');
    }

    try {
      // Process audio file
      const transcript = await this.voiceProcessor.processAudioFile(audioFilePath, options);

      // Extract structured data from transcript
      const extractedData = await this.voiceProcessor.extractDailyNoteStructure(transcript);

      return {
        success: true,
        transcript,
        extracted_data: extractedData,
        processing_time: transcript.processing_time
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update note from voice transcription results
   * @param {string} noteId - Note ID
   * @param {Object} processingResult - Voice processing result
   * @returns {Object} Updated note
   */
  async updateNoteFromVoiceTranscription(noteId, processingResult) {
    const { transcript, extracted_data } = processingResult;

    const updateData = {
      subjective_notes: extracted_data.subjective || transcript.raw_text,
      objective_notes_jsonb: extracted_data.objective || {},
      assessment: extracted_data.assessment || '',
      plan: extracted_data.plan || '',
      vitals_jsonb: extracted_data.vitals || {},
      medications_jsonb: extracted_data.medications || {}
    };

    return await this.dailyNotesRepository.updateNote(noteId, updateData);
  }

  // ========================================
  // Paper Digitization Workflow
  // ========================================

  /**
   * Create a daily note from paper digitization
   * @param {Object} paperNoteData - Paper note creation data
   * @returns {Object} Created note with digitization status
   */
  async createDailyNoteFromPaper(paperNoteData) {
    const {
      journey_id,
      encounter_id,
      patient_id,
      image_data,
      image_file_path,
      note_type = 'progress',
      note_date = null, // Will try to detect from image
      created_by_user_id,
      digitization_options = {}
    } = paperNoteData;

    // Validate journey exists and is active
    const journey = await this.journeysRepository.findJourneyById(journey_id);
    if (!journey) {
      throw new Error('Journey not found');
    }

    // Calculate note day sequence
    const existingNotes = await this.dailyNotesRepository.findNotesByJourney(journey_id);
    const maxSequence = existingNotes.length > 0 ? Math.max(...existingNotes.map(n => n.note_day_sequence || 0)) : 0;
    const note_day_sequence = maxSequence + 1;

    // Detect note date from image or use today
    const detectedDate = note_date || await this.detectNoteDateFromImage(image_data || image_file_path);

    // Create initial note record
    const initialNoteData = {
      journey_id,
      encounter_id,
      patient_id,
      note_type,
      note_day_sequence,
      source: 'manual', // Will be marked as paper after verification
      status: 'draft', // Will be updated after digitization
      note_date: detectedDate,
      note_time: new Date().toTimeString().split(' ')[0],
      subjective_notes: '', // Will be populated by digitization
      created_by_user_id
    };

    const note = await this.dailyNotesRepository.createDailyNote(initialNoteData);

    // Process paper digitization
    let digitizationResult;
    try {
      if (this.paperDigitizationService) {
        digitizationResult = await this.paperDigitizationService.processPaperNote({
          image_data: image_data,
          image_file_path: image_file_path,
          note_id: note.id,
          journey_id: journey_id,
          patient_id: patient_id,
          options: digitization_options
        });

        // Update note with extracted content
        if (digitizationResult.success) {
          await this.updateNoteFromPaperExtraction(note.id, digitizationResult);

          // Auto-submit for verification if enabled
          if (this.autoSubmitPaperForVerification) {
            await this.submitForVerification(note.id, created_by_user_id);
          }
        } else {
          // Mark digitization as failed
          await this.dailyNotesRepository.updateNoteStatus(note.id, 'draft', {
            review_notes_jsonb: [{ digitization_error: digitizationResult.error }]
          });
        }
      } else {
        // No digitization service available, mark for manual processing
        await this.dailyNotesRepository.updateNoteStatus(note.id, 'draft', {
          review_notes_jsonb: [{ note: 'Manual digitization required - service not available' }]
        });
      }

    } catch (error) {
      // Handle digitization errors
      await this.dailyNotesRepository.updateNoteStatus(note.id, 'draft', {
        review_notes_jsonb: [{ digitization_error: error.message }]
      });
      throw error;
    }

    // Get updated note
    const finalNote = await this.dailyNotesRepository.findNoteById(note.id);

    return {
      note: finalNote,
      digitization_result: digitizationResult,
      requires_verification: this.autoSubmitPaperForVerification,
      next_actions: this.determineNextActions(finalNote, true)
    };
  }

  /**
   * Submit note for human verification
   * @param {string} noteId - Note ID
   * @param {string} submittedBy - User ID submitting for verification
   * @returns {Object} Updated note
   */
  async submitForVerification(noteId, submittedBy) {
    const note = await this.dailyNotesRepository.findNoteById(noteId);
    if (!note) {
      throw new Error('Note not found');
    }

    if (note.source !== 'manual') {
      throw new Error('Only manual notes can be submitted for verification');
    }

    // Update note status to indicate it needs verification
    return await this.dailyNotesRepository.updateNoteStatus(noteId, 'pending_review', {
      review_required_by_user_id: submittedBy,
      review_notes_jsonb: [{ submitted_for_verification: true, submitted_by: submittedBy, submitted_at: new Date().toISOString() }]
    });
  }

  /**
   * Verify and approve paper-extracted note
   * @param {string} noteId - Note ID
   * @param {Object} verificationData - Verification information
   * @returns {Object} Verification result
   */
  async verifyPaperExtractedContent(noteId, verificationData) {
    const {
      verified_by_user_id,
      verification_status, // 'verified', 'rejected', 'needs_revision'
      corrected_content = {},
      verification_notes = '',
      confidence_scores = {}
    } = verificationData;

    const note = await this.dailyNotesRepository.findNoteById(noteId);
    if (!note) {
      throw new Error('Note not found');
    }

    // Apply corrections if provided
    if (Object.keys(corrected_content).length > 0) {
      await this.dailyNotesRepository.updateNote(noteId, corrected_content);
    }

    // Update verification status
    const updatedNote = await this.dailyNotesRepository.updateVerificationStatus(noteId, {
      verified_by_user_id,
      verification_status,
      verification_notes,
      verified_data_jsonb: {
        confidence_scores,
        corrections_applied: Object.keys(corrected_content).length > 0,
        verification_timestamp: new Date().toISOString()
      }
    });

    return {
      note: updatedNote,
      verification_complete: true,
      next_actions: this.determineNextActions(updatedNote)
    };
  }

  /**
   * Update note from paper extraction results
   * @param {string} noteId - Note ID
   * @param {Object} digitizationResult - Paper digitization result
   * @returns {Object} Updated note
   */
  async updateNoteFromPaperExtraction(noteId, digitizationResult) {
    const { extracted_data, confidence_scores } = digitizationResult;

    const updateData = {
      subjective_notes: extracted_data.subjective || '',
      objective_notes_jsonb: extracted_data.objective || {},
      assessment: extracted_data.assessment || '',
      plan: extracted_data.plan || '',
      vitals_jsonb: extracted_data.vitals || {},
      medications_jsonb: extracted_data.medications || {},
      procedures_jsonb: extracted_data.procedures || {}
    };

    const updatedNote = await this.dailyNotesRepository.updateNote(noteId, updateData);

    // Store confidence scores in metadata for verification
    return updatedNote;
  }

  // ========================================
  // Review and Approval Workflow
  // ========================================

  /**
   * Submit note for review
   * @param {string} noteId - Note ID
   * @param {string} submittedBy - User ID submitting for review
   * @returns {Object} Updated note
   */
  async submitForReview(noteId, submittedBy) {
    const note = await this.dailyNotesRepository.findNoteById(noteId);
    if (!note) {
      throw new Error('Note not found');
    }

    if (note.status !== 'draft') {
      throw new Error(`Cannot submit note with status: ${note.status}`);
    }

    // Validate note completeness before submission
    const validationWarnings = this.validateNoteQuality(note);
    if (validationWarnings.length > 0 && !this.allowIncompleteSubmission) {
      throw new Error('Note validation failed: ' + validationWarnings.join(', '));
    }

    return await this.dailyNotesRepository.updateNoteStatus(noteId, 'pending_review', {
      review_required_by_user_id: submittedBy,
      review_notes_jsonb: [{ submitted_for_review: true, submitted_by: submittedBy, submitted_at: new Date().toISOString() }]
    });
  }

  /**
   * Approve a daily note
   * @param {string} noteId - Note ID
   * @param {Object} approvalData - Approval information
   * @returns {Object} Approval result
   */
  async approveDailyNote(noteId, approvalData) {
    const {
      approved_by_user_id,
      approval_notes = '',
      minor_corrections = {},
      approver_role = 'physician'
    } = approvalData;

    const note = await this.dailyNotesRepository.findNoteById(noteId);
    if (!note) {
      throw new Error('Note not found');
    }

    if (note.status !== 'pending_review') {
      throw new Error(`Cannot approve note with status: ${note.status}`);
    }

    // Apply minor corrections if provided
    if (Object.keys(minor_corrections).length > 0) {
      await this.dailyNotesRepository.updateNote(noteId, minor_corrections);
    }

    // Approve the note
    const reviewNotes = [
      ...(this.dailyNotesRepository.fromJSONB(note.review_notes_jsonb || '[]')),
      {
        action: 'approved',
        approved_by: approved_by_user_id,
        approver_role: approver_role,
        approval_notes: approval_notes,
        corrections_applied: Object.keys(minor_corrections).length > 0,
        approved_at: new Date().toISOString()
      }
    ];

    const approvedNote = await this.dailyNotesRepository.updateNoteStatus(noteId, 'approved', {
      reviewed_by_user_id: approved_by_user_id,
      reviewed_at: new Date().toISOString(),
      review_notes_jsonb: reviewNotes
    });

    return {
      note: approvedNote,
      approval_complete: true,
      approval_summary: {
        approved_by: approved_by_user_id,
        approver_role: approver_role,
        corrections_applied: Object.keys(minor_corrections).length,
        approval_notes: approval_notes
      }
    };
  }

  /**
   * Reject a daily note
   * @param {string} noteId - Note ID
   * @param {Object} rejectionData - Rejection information
   * @returns {Object} Rejection result
   */
  async rejectDailyNote(noteId, rejectionData) {
    const {
      rejected_by_user_id,
      rejection_reason,
      required_changes = [],
      return_to_draft = true
    } = rejectionData;

    const note = await this.dailyNotesRepository.findNoteById(noteId);
    if (!note) {
      throw new Error('Note not found');
    }

    if (note.status !== 'pending_review') {
      throw new Error(`Cannot reject note with status: ${note.status}`);
    }

    const reviewNotes = [
      ...(this.dailyNotesRepository.fromJSONB(note.review_notes_jsonb || '[]')),
      {
        action: 'rejected',
        rejected_by: rejected_by_user_id,
        rejection_reason: rejection_reason,
        required_changes: required_changes,
        rejected_at: new Date().toISOString()
      }
    ];

    // Return to draft or mark as rejected
    const newStatus = return_to_draft ? 'draft' : 'superseded';
    const rejectedNote = await this.dailyNotesRepository.updateNoteStatus(noteId, newStatus, {
      reviewed_by_user_id: rejected_by_user_id,
      reviewed_at: new Date().toISOString(),
      review_notes_jsonb: reviewNotes
    });

    return {
      note: rejectedNote,
      rejection_complete: true,
      rejection_summary: {
        rejected_by: rejected_by_user_id,
        rejection_reason: rejection_reason,
        required_changes: required_changes,
        returned_to_draft: return_to_draft
      }
    };
  }

  // ========================================
  // Daily Notes Information and Statistics
  // ========================================

  /**
   * Get daily notes timeline for a journey
   * @param {string} journeyId - Journey ID
   * @returns {Object} Timeline with statistics
   */
  async getDailyNotesTimeline(journeyId) {
    return await this.dailyNotesRepository.getDailyNotesTimeline(journeyId);
  }

  /**
   * Get daily notes summary
   * @param {string} journeyId - Journey ID
   * @returns {Object} Summary statistics
   */
  async getDailyNotesSummary(journeyId) {
    const stats = await this.dailyNotesRepository.getDailyNotesStats({ journey_id: journeyId });
    const notes = await this.dailyNotesRepository.findNotesByJourney(journeyId);

    return {
      statistics: stats,
      recent_notes: notes.slice(0, 5), // Last 5 notes
      documentation_trends: this.analyzeDocumentationTrends(notes),
      quality_assessment: this.assessDocumentationQuality(stats)
    };
  }

  /**
   * Get notes needing attention/review
   * @param {Object} criteria - Search criteria
   * @returns {Array} Notes needing attention
   */
  async getNotesNeedingAttention(criteria = {}) {
    const {
      status = ['draft', 'pending_review'],
      source = null,
      patient_id = null,
      limit = 50
    } = criteria;

    const notes = await this.dailyNotesRepository.findNotesNeedingAttention({
      status,
      source,
      patient_id,
      limit
    });

    // Enrich with urgency assessment
    return notes.map(note => ({
      ...note,
      urgency: this.assessNoteUrgency(note),
      recommended_action: this.recommendActionForNote(note)
    }));
  }

  // ========================================
  // Validation and Quality Assessment
  // ========================================

  /**
   * Validate SOAP note data
   * @param {Object} soapData - SOAP data to validate
   * @throws {Error} If validation fails
   */
  validateSOAPNoteData(soapData) {
    const { subjective_notes, assessment, plan } = soapData;

    if (!subjective_notes || subjective_notes.trim().length === 0) {
      throw new Error('Subjective notes (S) are required');
    }

    if (!assessment || assessment.trim().length === 0) {
      throw new Error('Assessment (A) is required');
    }

    if (!plan || plan.trim().length === 0) {
      throw new Error('Plan (P) is required');
    }
  }

  /**
   * Validate note quality and completeness
   * @param {Object} note - Note to validate
   * @returns {Array} Validation warnings
   */
  validateNoteQuality(note) {
    const warnings = [];

    // Check for missing SOAP sections
    if (!note.subjective_notes || note.subjective_notes.trim().length === 0) {
      warnings.push('Missing subjective notes');
    }

    if (!note.assessment || note.assessment.trim().length === 0) {
      warnings.push('Missing assessment');
    }

    if (!note.plan || note.plan.trim().length === 0) {
      warnings.push('Missing plan');
    }

    // Check for minimal content length
    if (note.subjective_notes && note.subjective_notes.length < 10) {
      warnings.push('Subjective notes too brief');
    }

    if (note.assessment && note.assessment.length < 5) {
      warnings.push('Assessment too brief');
    }

    // Check for objective data if this is a progress note
    if (note.note_type === 'progress') {
      const objectiveData = this.dailyNotesRepository.fromJSONB(note.objective_notes_jsonb || '{}');
      if (Object.keys(objectiveData).length === 0) {
        warnings.push('No objective data provided');
      }
    }

    return warnings;
  }

  /**
   * Assess documentation quality
   * @param {Object} stats - Note statistics
   * @returns {Object} Quality assessment
   */
  assessDocumentationQuality(stats) {
    const { total_notes, approved_notes, draft_notes } = stats;

    if (total_notes === 0) {
      return { quality: 'none', score: 0, issues: ['No documentation found'] };
    }

    const completionRate = (approved_notes / total_notes) * 100;
    const draftRate = (draft_notes / total_notes) * 100;

    let quality, score, issues;

    if (completionRate >= 90) {
      quality = 'excellent';
      score = 5;
      issues = [];
    } else if (completionRate >= 75) {
      quality = 'good';
      score = 4;
      issues = draftRate > 20 ? ['High number of draft notes'] : [];
    } else if (completionRate >= 50) {
      quality = 'fair';
      score = 3;
      issues = ['Many uncompleted notes', 'Improve completion rate'];
    } else {
      quality = 'poor';
      score = 1;
      issues = ['Low completion rate', 'Many drafts require attention'];
    }

    return { quality, score, issues, completion_rate: Math.round(completionRate) };
  }

  /**
   * Determine if note is complete
   * @param {Object} note - Note to check
   * @returns {boolean} Completion status
   */
  isNoteComplete(note) {
    const warnings = this.validateNoteQuality(note);
    return warnings.length === 0;
  }

  /**
   * Determine next actions for a note
   * @param {Object} note - Note to analyze
   * @param {boolean} autoSubmitted - Whether note was auto-submitted
   * @returns {Array} Recommended actions
   */
  determineNextActions(note, autoSubmitted = false) {
    const actions = [];

    if (note.status === 'draft') {
      actions.push({ action: 'complete_note', priority: 'high', description: 'Complete and submit note for review' });
    }

    if (note.status === 'pending_review') {
      actions.push({ action: 'review_note', priority: 'high', description: 'Review and approve/reject note' });
    }

    if (note.source === 'manual' && this.autoSubmitPaperForVerification) {
      actions.push({ action: 'verify_content', priority: 'medium', description: 'Verify paper-extracted content' });
    }

    if (note.source === 'voice_upload' && this.requireApprovalForVoiceNotes) {
      actions.push({ action: 'review_transcription', priority: 'medium', description: 'Review voice transcription accuracy' });
    }

    return actions;
  }

  /**
   * Assess note urgency
   * @param {Object} note - Note to assess
   * @returns {string} Urgency level
   */
  assessNoteUrgency(note) {
    const daysSinceCreation = Math.floor((Date.now() - new Date(note.created_at)) / (1000 * 60 * 60 * 24));

    if (note.status === 'draft' && daysSinceCreation > 2) {
      return 'high';
    } else if (note.status === 'pending_review' && daysSinceCreation > 1) {
      return 'high';
    } else if (note.status === 'draft' || note.status === 'pending_review') {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Recommend action for note
   * @param {Object} note - Note to analyze
   * @returns {string} Recommended action
   */
  recommendActionForNote(note) {
    const warnings = this.validateNoteQuality(note);

    if (warnings.length > 0) {
      return 'complete_note';
    } else if (note.status === 'draft') {
      return 'submit_for_review';
    } else if (note.status === 'pending_review') {
      return 'review_and_approve';
    } else {
      return 'no_action';
    }
  }

  /**
   * Analyze documentation trends
   * @param {Array} notes - Notes array
   * @returns {Object} Trend analysis
   */
  analyzeDocumentationTrends(notes) {
    if (notes.length === 0) {
      return { trends: [], frequency: 0, consistency: 'none' };
    }

    const sortedNotes = [...notes].sort((a, b) => new Date(a.note_date) - new Date(b.note_date));

    // Calculate documentation frequency
    const dateGroups = sortedNotes.reduce((groups, note) => {
      const date = note.note_date;
      groups[date] = (groups[date] || 0) + 1;
      return groups;
    }, {});

    const avgNotesPerDay = Object.values(dateGroups).reduce((sum, count) => sum + count, 0) / Object.keys(dateGroups).length;

    // Assess consistency
    let consistency = 'consistent';
    if (avgNotesPerDay < 0.5) {
      consistency = 'poor';
    } else if (avgNotesPerDay < 1) {
      consistency = 'fair';
    } else if (avgNotesPerDay >= 2) {
      consistency = 'excellent';
    }

    return {
      frequency: Math.round(avgNotesPerDay * 10) / 10,
      consistency,
      total_days: Object.keys(dateGroups).length,
      most_documented_day: Object.entries(dateGroups).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    };
  }

  // ========================================
  // Helper and Utility Methods
  // ========================================

  /**
   * Detect note date from paper image
   * @param {Buffer|string} imageData - Image data or file path
   * @returns {string} Detected date ISO string
   */
  async detectNoteDateFromImage(imageData) {
    // If paper digitization service is available, use it
    if (this.paperDigitizationService && this.paperDigitizationService.detectDate) {
      try {
        const detectedDate = await this.paperDigitizationService.detectDate(imageData);
        if (detectedDate) {
          return detectedDate;
        }
      } catch (error) {
        console.warn('Date detection failed, using today:', error.message);
      }
    }

    // Default to today
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Clean up service resources
   */
  async cleanup() {
    try {
      if (this.dailyNotesRepository) await this.dailyNotesRepository.close();
      if (this.journeysRepository) await this.journeysRepository.close();
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

module.exports = { DailyNotesService };