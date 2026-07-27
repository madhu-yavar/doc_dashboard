/**
 * Paper Digitization Service - Phase 4: Paper Digitization Workflow
 *
 * Main service for converting paper medical notes to digital format.
 * Orchestrates the complete paper-to-digital workflow with AI integration.
 *
 * Responsibilities:
 * - Photo capture workflow management
 * - Batch scanning workflow for medical records
 * - AI-powered content extraction
 * - Human verification workflow orchestration
 * - Progressive digitization support
 * - Quality assurance and tracking
 */

const fs = require('fs');
const path = require('path');
const { HandwritingExtractionService } = require('./handwriting_extraction_service.cjs');
const { DailyNotesService } = require('./daily_notes_service.cjs');
const { InpatientJourneysRepository } = require('./repositories/inpatient_journeys_repository.cjs');
const { DailyNotesRepository } = require('./repositories/daily_notes_repository.cjs');

class PaperDigitizationService {
  constructor(config = {}) {
    this.name = 'PaperDigitizationService';
    this.storageDir = config.storageDir || '/tmp/paper_digitization';
    this.maxBatchSize = config.maxBatchSize || 50;

    // Initialize services (check if provided or create new instance)
    if (config.handwritingService) {
      this.handwritingService = config.handwritingService;
    } else {
      const HandwritingExtractionService = require('./handwriting_extraction_service.cjs');
      this.handwritingService = new HandwritingExtractionService(config.handwriting || {});
    }
    this.dailyNotesService = config.dailyNotesService || new DailyNotesService();
    this.journeysRepository = config.journeysRepository || new InpatientJourneysRepository();
    this.dailyNotesRepository = config.dailyNotesRepository || new DailyNotesRepository();

    // Configuration
    this.autoVerifyThreshold = config.autoVerifyThreshold || 0.9;
    this.requireVerification = config.requireVerification !== false; // default true
    this.supportedImageFormats = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    this.maxFileSize = config.maxFileSize || 15 * 1024 * 1024; // 15MB

    this.ensureStorageDir();
  }

  /**
   * Ensure storage directory exists
   */
  ensureStorageDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Capture paper note during rounds (mobile-optimized)
   * @param {Object} captureData - Paper capture data
   * @returns {Object} Created daily note with extraction status
   */
  async capturePaperNote(captureData) {
    try {
      this.log('Starting paper note capture', {
        journeyId: captureData.journeyId,
        noteDate: captureData.noteDate
      });

      // Validate input
      await this.validateCaptureData(captureData);

      // Step 1: Store original paper image
      const storedImagePath = await this.storePaperImage(captureData.imageData, captureData);

      // Step 2: Extract content using AI
      const extractionResult = await this.extractContentFromPaper(
        captureData.imageData,
        captureData.options || {}
      );

      // Step 3: Create daily note with extracted content
      const noteData = {
        journeyId: captureData.journeyId,
        noteDate: captureData.noteDate || new Date().toISOString().split('T')[0],
        noteType: 'paper',
        subjective: extractionResult.data.soap?.subjective || '',
        objective: extractionResult.data.soap?.objective || '',
        assessment: extractionResult.data.soap?.assessment || '',
        plan: extractionResult.data.soap?.plan || '',
        vitals: extractionResult.data.vitals || {},
        medications: extractionResult.data.medications || [],
        procedures: extractionResult.data.procedures || [],
        metadata: {
          originalImagePath: storedImagePath,
          extractionMethod: 'handwriting',
          extractedAt: new Date().toISOString(),
          confidence: extractionResult.quality.overallConfidence,
          requiresReview: extractionResult.quality.requiresReview,
          digitizationSource: captureData.source || 'mobile_capture'
        },
        createdBy: captureData.createdBy || 'system'
      };

      const note = await this.dailyNotesRepository.createDailyNote(noteData);

      // Step 4: Queue for verification if needed
      if (extractionResult.quality.requiresReview && this.requireVerification) {
        await this.queueForVerification(note.id, extractionResult);
      }

      this.log('Paper note capture completed', {
        noteId: note.id,
        confidence: extractionResult.quality.overallConfidence,
        requiresReview: extractionResult.quality.requiresReview
      });

      return {
        success: true,
        note,
        extraction: extractionResult,
        status: extractionResult.quality.requiresReview ? 'pending_verification' : 'completed'
      };

    } catch (error) {
      this.log('Paper note capture failed', { error: error.message });
      throw new Error(`Paper note capture failed: ${error.message}`);
    }
  }

  /**
   * Upload batch of scanned paper charts
   * @param {Object} batchData - Batch upload data
   * @returns {Object} Batch processing results
   */
  async uploadBatchPaperChart(batchData) {
    try {
      this.log('Starting batch paper chart upload', {
        patientId: batchData.patientId,
        imageCount: batchData.images.length
      });

      // Validate batch size
      if (batchData.images.length > this.maxBatchSize) {
        throw new Error(`Batch size exceeds ${this.maxBatchSize} images limit`);
      }

      const results = [];
      const errors = [];

      // Process each image in the batch
      for (let i = 0; i < batchData.images.length; i++) {
        const imageData = batchData.images[i];

        try {
          this.log(`Processing batch image ${i + 1}/${batchData.images.length}`);

          // Extract journey information from document
          const journeyInfo = await this.extractJourneyFromImage(imageData, batchData);

          // Create paper note for this image
          const captureResult = await this.capturePaperNote({
            imageData: imageData.buffer,
            journeyId: journeyInfo.journeyId || batchData.journeyId,
            noteDate: journeyInfo.noteDate || batchData.noteDate,
            source: 'batch_scan',
            createdBy: batchData.createdBy || 'system',
            options: batchData.options || {}
          });

          results.push({
            imageIndex: i,
            success: true,
            noteId: captureResult.note.id,
            journeyId: captureResult.note.journeyId
          });

        } catch (error) {
          this.log(`Batch image ${i + 1} processing failed`, { error: error.message });
          errors.push({
            imageIndex: i,
            error: error.message
          });
        }
      }

      this.log('Batch processing completed', {
        total: batchData.images.length,
        successful: results.length,
        failed: errors.length
      });

      return {
        success: true,
        batchResults: {
          total: batchData.images.length,
          successful: results.length,
          failed: errors.length,
          results,
          errors
        },
        summary: {
          digitizationRate: results.length / batchData.images.length,
          requiresVerification: results.filter(r => r.requiresVerification).length
        }
      };

    } catch (error) {
      this.log('Batch upload failed', { error: error.message });
      throw new Error(`Batch upload failed: ${error.message}`);
    }
  }

  /**
   * Verify extracted content (human verification workflow)
   * @param {Object} verificationData - Verification data
   * @returns {Object} Updated note with verified content
   */
  async verifyExtractedContent(verificationData) {
    try {
      this.log('Starting content verification', {
        noteId: verificationData.noteId,
        verifierId: verificationData.verifierId
      });

      // Get current note
      const note = await this.dailyNotesRepository.findNoteById(verificationData.noteId);
      if (!note) {
        throw new Error('Note not found');
      }

      // Update note with verified data
      const updatedNote = await this.dailyNotesRepository.updateDailyNote(note.id, {
        subjective: verificationData.verifiedData.subjective || note.subjective,
        objective: verificationData.verifiedData.objective || note.objective,
        assessment: verificationData.verifiedData.assessment || note.assessment,
        plan: verificationData.verifiedData.plan || note.plan,
        vitals: verificationData.verifiedData.vitals || note.vitals,
        medications: verificationData.verifiedData.medications || note.medications,
        procedures: verificationData.verifiedData.procedures || note.procedures,
        status: 'verified',
        verifiedBy: verificationData.verifierId,
        verifiedAt: new Date().toISOString(),
        verificationNotes: verificationData.notes || ''
      });

      // Update verification queue
      await this.removeFromVerificationQueue(note.id);

      this.log('Content verification completed', {
        noteId: note.id,
        verifiedBy: verificationData.verifierId
      });

      return {
        success: true,
        note: updatedNote,
        previousStatus: note.status,
        verificationCompletedAt: new Date().toISOString()
      };

    } catch (error) {
      this.log('Content verification failed', { error: error.message });
      throw new Error(`Verification failed: ${error.message}`);
    }
  }

  /**
   * Get paper digitization statistics for a journey
   * @param {string} journeyId - Journey ID
   * @returns {Object} Digitization statistics
   */
  async getPaperDigitizationStats(journeyId) {
    try {
      this.log('Getting paper digitization stats', { journeyId });

      // Get all notes for the journey
      const notes = await this.dailyNotesRepository.findNotesByJourney(journeyId);

      // Calculate statistics
      const paperNotes = notes.filter(note => note.noteType === 'paper');
      const verifiedNotes = paperNotes.filter(note => note.status === 'verified');
      const pendingNotes = paperNotes.filter(note => note.status === 'pending_verification');

      const digitizationStatus = this.calculateDigitizationStatus(notes);
      const averageConfidence = this.calculateAverageConfidence(paperNotes);
      const verificationRate = paperNotes.length > 0 ? verifiedNotes.length / paperNotes.length : 0;

      return {
        journeyId,
        digitizationStatus,
        totalNotes: notes.length,
        paperNotes: paperNotes.length,
        digitizedNotes: paperNotes.length,
        verifiedNotes: verifiedNotes.length,
        pendingVerification: pendingNotes.length,
        verificationRate,
        averageConfidence,
        breakdown: {
          byType: this.groupNotesByType(notes),
          byStatus: this.groupNotesByStatus(notes),
          bySource: this.groupNotesBySource(paperNotes)
        },
        timeline: this.buildDigitizationTimeline(paperNotes)
      };

    } catch (error) {
      this.log('Failed to get digitization stats', { error: error.message });
      throw new Error(`Failed to get stats: ${error.message}`);
    }
  }

  /**
   * Get verification queue items
   * @param {Object} filters - Filter options
   * @returns {Object} Verification queue items
   */
  async getVerificationQueue(filters = {}) {
    try {
      this.log('Getting verification queue', filters);

      const notes = await this.dailyNotesRepository.findNotesByStatus('pending_verification');

      const queueItems = notes.map(note => ({
        noteId: note.id,
        journeyId: note.journeyId,
        patientId: note.patientId,
        noteDate: note.noteDate,
        capturedAt: note.createdAt,
        priority: this.calculateVerificationPriority(note),
        estimatedComplexity: this.estimateComplexity(note),
        metadata: note.metadata
      }));

      // Apply filters
      let filteredItems = queueItems;
      if (filters.journeyId) {
        filteredItems = filteredItems.filter(item => item.journeyId === filters.journeyId);
      }
      if (filters.priority) {
        filteredItems = filteredItems.filter(item => item.priority === filters.priority);
      }

      // Sort by priority (high to low)
      filteredItems.sort((a, b) => this.priorityScore(b.priority) - this.priorityScore(a.priority));

      return {
        success: true,
        queue: filteredItems,
        total: queueItems.length,
        filtered: filteredItems.length
      };

    } catch (error) {
      this.log('Failed to get verification queue', { error: error.message });
      throw new Error(`Failed to get queue: ${error.message}`);
    }
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  /**
   * Validate paper capture data
   */
  async validateCaptureData(captureData) {
    if (!captureData.imageData) {
      throw new Error('Image data is required');
    }

    if (!captureData.journeyId) {
      throw new Error('Journey ID is required');
    }

    if (!Buffer.isBuffer(captureData.imageData)) {
      throw new Error('Image data must be a buffer');
    }

    if (captureData.imageData.length > this.maxFileSize) {
      throw new Error(`Image size exceeds ${this.maxFileSize / (1024 * 1024)}MB limit`);
    }

    // Validate journey exists
    const journey = await this.journeysRepository.findJourneyById(captureData.journeyId);
    if (!journey) {
      throw new Error('Journey not found');
    }
  }

  /**
   * Store paper image for later reference
   */
  async storePaperImage(imageData, captureData) {
    const filename = `paper_${captureData.journeyId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
    const storagePath = path.join(this.storageDir, 'paper_images', filename);

    // Ensure directory exists
    const dir = path.dirname(storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await fs.promises.writeFile(storagePath, imageData);
    return storagePath;
  }

  /**
   * Extract content from paper using handwriting service
   */
  async extractContentFromPaper(imageData, options) {
    return await this.handwritingService.extractHandwriting(imageData, options);
  }

  /**
   * Extract journey information from document image
   */
  async extractJourneyFromImage(imageData, batchData) {
    try {
      // Try to extract journey information from the document
      const extractionResult = await this.handwritingService.extractHandwriting(imageData, {
        focus: 'demographics'
      });

      // Extract journey ID and note date from document
      const journeyId = extractionResult.data.journeyId || batchData.journeyId;
      const noteDate = extractionResult.data.noteDate || batchData.noteDate;

      return { journeyId, noteDate };

    } catch (error) {
      this.log('Failed to extract journey info from image', { error: error.message });
      // Fallback to batch data
      return {
        journeyId: batchData.journeyId,
        noteDate: batchData.noteDate
      };
    }
  }

  /**
   * Queue note for verification
   */
  async queueForVerification(noteId, extractionResult) {
    try {
      this.log('Queuing note for verification', { noteId });

      // Update note status
      await this.dailyNotesRepository.updateDailyNote(noteId, {
        status: 'pending_verification',
        queuedAt: new Date().toISOString()
      });

      // Store extraction result for verification reference
      const queueData = {
        noteId,
        extractionResult,
        queuedAt: new Date().toISOString(),
        priority: this.calculateVerificationPriorityFromExtraction(extractionResult)
      };

      // In a real implementation, would store in verification queue table
      const queuePath = path.join(this.storageDir, 'verification_queue', `${noteId}.json`);
      await fs.promises.writeFile(queuePath, JSON.stringify(queueData, null, 2));

    } catch (error) {
      this.log('Failed to queue for verification', { error: error.message });
      // Don't throw - note is still created, just not queued
    }
  }

  /**
   * Remove from verification queue
   */
  async removeFromVerificationQueue(noteId) {
    try {
      const queuePath = path.join(this.storageDir, 'verification_queue', `${noteId}.json`);
      if (fs.existsSync(queuePath)) {
        await fs.promises.unlink(queuePath);
      }
    } catch (error) {
      this.log('Failed to remove from verification queue', { error: error.message });
      // Don't throw - verification is still complete
    }
  }

  /**
   * Calculate digitization status for journey
   */
  calculateDigitizationStatus(notes) {
    if (notes.length === 0) return 'none';

    const paperNotes = notes.filter(note => note.noteType === 'paper');
    if (paperNotes.length === 0) return 'digital_only';
    if (paperNotes.length === notes.length) return 'full_paper';
    if (paperNotes.length > notes.length / 2) return 'majority_paper';
    return 'partial_paper';
  }

  /**
   * Calculate average confidence score
   */
  calculateAverageConfidence(notes) {
    if (notes.length === 0) return 0;

    const confidences = notes
      .map(note => note.metadata?.confidence || 0.8)
      .filter(conf => conf > 0);

    if (confidences.length === 0) return 0;

    return confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
  }

  /**
   * Group notes by type
   */
  groupNotesByType(notes) {
    return notes.reduce((groups, note) => {
      const type = note.noteType || 'unknown';
      groups[type] = (groups[type] || 0) + 1;
      return groups;
    }, {});
  }

  /**
   * Group notes by status
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
   */
  groupNotesBySource(notes) {
    return notes.reduce((groups, note) => {
      const source = note.metadata?.digitizationSource || 'unknown';
      groups[source] = (groups[source] || 0) + 1;
      return groups;
    }, {});
  }

  /**
   * Build digitization timeline
   */
  buildDigitizationTimeline(notes) {
    return notes
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(note => ({
        date: note.createdAt,
        noteId: note.id,
        confidence: note.metadata?.confidence || 0,
        status: note.status,
        source: note.metadata?.digitizationSource || 'unknown'
      }));
  }

  /**
   * Calculate verification priority
   */
  calculateVerificationPriority(note) {
    const confidence = note.metadata?.confidence || 0.8;
    const age = Date.now() - new Date(note.createdAt).getTime();

    // High priority if low confidence or old
    if (confidence < 0.5) return 'high';
    if (age > 7 * 24 * 60 * 60 * 1000) return 'high'; // 7 days old
    if (confidence < 0.7) return 'medium';
    return 'low';
  }

  /**
   * Calculate verification priority from extraction result
   */
  calculateVerificationPriorityFromExtraction(extractionResult) {
    const confidence = extractionResult.quality.overallConfidence;
    if (confidence < 0.5) return 'high';
    if (confidence < 0.7) return 'medium';
    return 'low';
  }

  /**
   * Estimate complexity of verification
   */
  estimateComplexity(note) {
    const confidence = note.metadata?.confidence || 0.8;
    const contentLength = JSON.stringify({
      subjective: note.subjective,
      objective: note.objective,
      assessment: note.assessment,
      plan: note.plan
    }).length;

    if (confidence < 0.5 || contentLength > 2000) return 'high';
    if (confidence < 0.7 || contentLength > 1000) return 'medium';
    return 'low';
  }

  /**
   * Priority score for sorting
   */
  priorityScore(priority) {
    const scores = { high: 3, medium: 2, low: 1 };
    return scores[priority] || 0;
  }

  /**
   * Logging utility
   */
  log(message, data = {}) {
    console.log(`[${this.name}] ${message}`, data);
  }

  /**
   * Get service version
   */
  get version() {
    return '1.0.0';
  }
}

module.exports = PaperDigitizationService;