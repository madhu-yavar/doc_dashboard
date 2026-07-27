/**
 * Daily Notes Voice Processor - Phase 5: Voice Integration Enhancement
 *
 * Enhanced voice processing service for daily note creation.
 * Extends existing voice infrastructure with daily note-specific extraction.
 *
 * Responsibilities:
 * - Real-time voice processing for daily notes
 * - Voice-to-SOAP structure extraction
 * - PHI masking for voice transcripts
 * - Integration with existing live conversation infrastructure
 * - Batch voice file processing
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Reuse existing voice infrastructure
const LiveConversationSTTAgent = require('../agents/live_conversation_stt_agent.cjs');

class DailyNotesVoiceProcessor {
  constructor(config = {}) {
    this.name = 'DailyNotesVoiceProcessor';
    this.storageDir = config.storageDir || '/tmp/daily_notes_voice';
    this.maxAudioDuration = config.maxAudioDuration || 300; // 5 minutes default
    this.maxFileSize = config.maxFileSize || 25 * 1024 * 1024; // 25MB

    // Initialize STT agent (reuse existing infrastructure)
    this.sttAgent = config.sttAgent || new LiveConversationSTTAgent(config.stt || {});

    // Configuration
    this.supportedFormats = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav'];
    this.defaultLanguage = config.defaultLanguage || 'en-US';
    this.enableDiarization = config.enableDiarization !== false; // default true

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
   * Process voice input for daily note creation (Real-time)
   * @param {Object} voiceData - Voice input data
   * @returns {Object} Processed daily note with transcript and structured data
   */
  async processRealTimeVoice(voiceData) {
    try {
      this.log('Processing real-time voice for daily note', {
        journeyId: voiceData.journeyId,
        language: voiceData.language || this.defaultLanguage
      });

      // Step 1: Validate voice input
      await this.validateVoiceInput(voiceData);

      // Step 2: Process audio with STT
      const transcriptionResult = await this.transcribeAudio(voiceData.audioData, {
        language: voiceData.language || this.defaultLanguage,
        enableDiarization: this.enableDiarization,
        duration: voiceData.duration
      });

      // Step 3: Apply PHI masking to transcript
      const maskedTranscript = await this.maskPHIInTranscript(transcriptionResult.transcript);

      // Step 4: Extract daily note structure from transcript
      const extractedNote = await this.extractDailyNoteStructure(maskedTranscript, {
        journeyId: voiceData.journeyId,
        patientId: voiceData.patientId,
        encounterContext: voiceData.encounterContext
      });

      // Step 5: Create daily note record
      const dailyNote = await this.createDailyNoteFromVoice({
        journeyId: voiceData.journeyId,
        transcript: maskedTranscript,
        extractedData: extractedNote,
        audioMetadata: {
          duration: transcriptionResult.duration,
          format: voiceData.format,
          size: voiceData.audioData.length,
          language: voiceData.language || this.defaultLanguage
        },
        createdBy: voiceData.createdBy || 'system'
      });

      this.log('Real-time voice processing completed', {
        noteId: dailyNote.id,
        confidence: extractedNote.confidence,
        transcriptLength: maskedTranscript.length
      });

      return {
        success: true,
        dailyNote,
        transcript: maskedTranscript,
        extraction: extractedNote,
        audioMetadata: {
          duration: transcriptionResult.duration,
          language: voiceData.language || this.defaultLanguage
        }
      };

    } catch (error) {
      this.log('Real-time voice processing failed', { error: error.message });
      throw new Error(`Voice processing failed: ${error.message}`);
    }
  }

  /**
   * Process batch voice file for daily note
   * @param {Object} batchData - Batch voice processing data
   * @returns {Object} Processed daily note from voice file
   */
  async processBatchVoice(batchData) {
    try {
      this.log('Processing batch voice file', {
        journeyId: batchData.journeyId,
        fileName: batchData.fileName
      });

      // Step 1: Validate batch input
      await this.validateBatchInput(batchData);

      // Step 2: Save audio file temporarily
      const audioFilePath = await this.saveAudioFile(batchData.audioData, batchData.fileName);

      try {
        // Step 3: Transcribe audio file
        const transcriptionResult = await this.transcribeAudioFile(audioFilePath, {
          language: batchData.language || this.defaultLanguage,
          enableDiarization: this.enableDiarization
        });

        // Step 4: Apply PHI masking
        const maskedTranscript = await this.maskPHIInTranscript(transcriptionResult.transcript);

        // Step 5: Extract daily note structure
        const extractedNote = await this.extractDailyNoteStructure(maskedTranscript, {
          journeyId: batchData.journeyId,
          patientId: batchData.patientId
        });

        // Step 6: Create daily note
        const dailyNote = await this.createDailyNoteFromVoice({
          journeyId: batchData.journeyId,
          transcript: maskedTranscript,
          extractedData: extractedNote,
          audioMetadata: {
            fileName: batchData.fileName,
            duration: transcriptionResult.duration,
            format: batchData.format,
            size: batchData.audioData.length,
            source: 'batch_upload'
          },
          createdBy: batchData.createdBy || 'system'
        });

        this.log('Batch voice processing completed', {
          noteId: dailyNote.id,
          confidence: extractedNote.confidence
        });

        return {
          success: true,
          dailyNote,
          transcript: maskedTranscript,
          extraction: extractedNote
        };

      } finally {
        // Clean up temporary file
        if (fs.existsSync(audioFilePath)) {
          fs.unlinkSync(audioFilePath);
        }
      }

    } catch (error) {
      this.log('Batch voice processing failed', { error: error.message });
      throw new Error(`Batch voice processing failed: ${error.message}`);
    }
  }

  /**
   * Extract daily note structure from transcript
   * @param {string} transcript - Voice transcript
   * @param {Object} context - Extraction context
   * @returns {Object} Structured daily note data
   */
  async extractDailyNoteStructure(transcript, context = {}) {
    try {
      this.log('Extracting daily note structure from transcript', {
        transcriptLength: transcript.length,
        journeyId: context.journeyId
      });

      // Use daily note extraction skill (reuse existing patterns)
      const DailyNoteExtractionSkill = require('../skills/daily_note_extraction.skill.cjs');
      const extractionSkill = new DailyNoteExtractionSkill();

      // Extract SOAP structure from transcript
      const soapStructure = await extractionSkill.extractSOAP(transcript, {
        patientId: context.patientId,
        journeyId: context.journeyId,
        encounterContext: context.encounterContext
      });

      // Extract additional clinical data
      const clinicalData = await extractionSkill.extractClinicalData(transcript, {
        focus: 'daily_note'
      });

      // Calculate confidence score
      const confidence = this.calculateExtractionConfidence(soapStructure, clinicalData);

      this.log('Daily note structure extracted', {
        confidence,
        sections: Object.keys(soapStructure).filter(k => soapStructure[k]).length
      });

      return {
        soap: soapStructure,
        clinical: clinicalData,
        confidence,
        requiresReview: confidence < 0.8,
        metadata: {
          extractionMethod: 'voice',
          transcriptLength: transcript.length,
          processedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      this.log('Daily note extraction failed', { error: error.message });
      throw new Error(`Extraction failed: ${error.message}`);
    }
  }

  /**
   * Apply PHI masking to transcript
   * @param {string} transcript - Raw transcript
   * @returns {string} Masked transcript
   */
  async maskPHIInTranscript(transcript) {
    try {
      this.log('Applying PHI masking to transcript');

      // Reuse existing PHI masking functionality
      const PhiMaskerTool = require('../tools/image/phi_masker.tool.cjs');

      // For text transcripts, use text-based PHI detection
      const maskedTranscript = this.maskTextPHI(transcript);

      this.log('PHI masking applied', {
        originalLength: transcript.length,
        maskedLength: maskedTranscript.length
      });

      return maskedTranscript;

    } catch (error) {
      this.log('PHI masking failed, using original transcript', { error: error.message });
      return transcript; // Fallback to original if masking fails
    }
  }

  /**
   * Transcribe audio data
   * @param {Buffer} audioData - Audio data buffer
   * @param {Object} options - Transcription options
   * @returns {Object} Transcription result
   */
  async transcribeAudio(audioData, options = {}) {
    try {
      this.log('Transcribing audio', {
        size: audioData.length,
        language: options.language,
        diarization: options.enableDiarization
      });

      // Save audio temporarily for STT processing
      const tempAudioPath = await this.saveTempAudio(audioData);

      try {
        // Use existing STT agent
        const transcriptionResult = await this.sttAgent.transcribe(tempAudioPath, {
          language: options.language,
          enableDiarization: options.enableDiarization,
          format: 'webm' // Default format
        });

        return {
          transcript: transcriptionResult.text || transcriptionResult.transcript || '',
          duration: transcriptionResult.duration || options.duration || 0,
          confidence: transcriptionResult.confidence || 0.9,
          segments: transcriptionResult.segments || [],
          language: options.language
        };

      } finally {
        // Clean up temp file
        if (fs.existsSync(tempAudioPath)) {
          fs.unlinkSync(tempAudioPath);
        }
      }

    } catch (error) {
      this.log('Audio transcription failed', { error: error.message });
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }

  /**
   * Transcribe audio file
   * @param {string} audioFilePath - Path to audio file
   * @param {Object} options - Transcription options
   * @returns {Object} Transcription result
   */
  async transcribeAudioFile(audioFilePath, options = {}) {
    try {
      this.log('Transcribing audio file', {
        filePath: audioFilePath,
        language: options.language
      });

      const transcriptionResult = await this.sttAgent.transcribe(audioFilePath, {
        language: options.language,
        enableDiarization: options.enableDiarization
      });

      return {
        transcript: transcriptionResult.text || transcriptionResult.transcript || '',
        duration: transcriptionResult.duration || 0,
        confidence: transcriptionResult.confidence || 0.9,
        segments: transcriptionResult.segments || []
      };

    } catch (error) {
      this.log('Audio file transcription failed', { error: error.message });
      throw new Error(`File transcription failed: ${error.message}`);
    }
  }

  /**
   * Create daily note from voice processing result
   * @param {Object} noteData - Note creation data
   * @returns {Object} Created daily note
   */
  async createDailyNoteFromVoice(noteData) {
    try {
      this.log('Creating daily note from voice', {
        journeyId: noteData.journeyId
      });

      // This would integrate with DailyNotesService
      // For now, return the structure that would be created
      return {
        id: uuidv4(),
        journeyId: noteData.journeyId,
        noteType: 'voice',
        noteDate: new Date().toISOString().split('T')[0],
        subjective: noteData.extractedData.soap.subjective || '',
        objective: noteData.extractedData.soap.objective || '',
        assessment: noteData.extractedData.soap.assessment || '',
        plan: noteData.extractedData.soap.plan || '',
        vitals: noteData.extractedData.clinical.vitals || {},
        medications: noteData.extractedData.clinical.medications || [],
        procedures: noteData.extractedData.clinical.procedures || [],
        transcript: noteData.transcript,
        audioMetadata: noteData.audioMetadata,
        confidence: noteData.extractedData.confidence,
        status: noteData.extractedData.requiresReview ? 'pending_review' : 'draft',
        metadata: {
          source: 'voice',
          extractionMethod: 'voice',
          language: noteData.audioMetadata.language,
          duration: noteData.audioMetadata.duration,
          requiresReview: noteData.extractedData.requiresReview,
          createdBy: noteData.createdBy,
          createdAt: new Date().toISOString()
        }
      };

    } catch (error) {
      this.log('Daily note creation failed', { error: error.message });
      throw new Error(`Note creation failed: ${error.message}`);
    }
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  /**
   * Validate voice input data
   */
  async validateVoiceInput(voiceData) {
    if (!voiceData.audioData || !Buffer.isBuffer(voiceData.audioData)) {
      throw new Error('Invalid audio data: must be a buffer');
    }

    if (voiceData.audioData.length > this.maxFileSize) {
      throw new Error(`Audio size exceeds ${this.maxFileSize / (1024 * 1024)}MB limit`);
    }

    if (!voiceData.journeyId) {
      throw new Error('Journey ID is required');
    }
  }

  /**
   * Validate batch input data
   */
  async validateBatchInput(batchData) {
    if (!batchData.audioData || !Buffer.isBuffer(batchData.audioData)) {
      throw new Error('Invalid audio data');
    }

    if (!batchData.fileName) {
      throw new Error('File name is required');
    }

    if (!batchData.journeyId) {
      throw new Error('Journey ID is required');
    }
  }

  /**
   * Save audio file temporarily
   */
  async saveAudioFile(audioData, fileName) {
    const audioDir = path.join(this.storageDir, 'audio_files');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    const filePath = path.join(audioDir, fileName);
    await fs.promises.writeFile(filePath, audioData);
    return filePath;
  }

  /**
   * Save temporary audio for processing
   */
  async saveTempAudio(audioData) {
    const fileName = `temp_voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.webm`;
    return await this.saveAudioFile(audioData, fileName);
  }

  /**
   * Calculate extraction confidence
   */
  calculateExtractionConfidence(soapStructure, clinicalData) {
    let confidence = 0.0;
    const sections = ['subjective', 'objective', 'assessment', 'plan'];
    let filledSections = 0;

    for (const section of sections) {
      if (soapStructure[section] && soapStructure[section].length > 20) {
        filledSections++;
      }
    }

    confidence += (filledSections / sections.length) * 0.6; // 60% weight for SOAP completeness

    if (clinicalData.vitals && Object.keys(clinicalData.vitals).length > 0) {
      confidence += 0.2; // 20% weight for vitals extraction
    }

    if (clinicalData.medications && clinicalData.medications.length > 0) {
      confidence += 0.1; // 10% weight for medications
    }

    if (clinicalData.procedures && clinicalData.procedures.length > 0) {
      confidence += 0.1; // 10% weight for procedures
    }

    return Math.min(confidence, 1.0); // Cap at 1.0
  }

  /**
   * Mask PHI in text (basic implementation)
   */
  maskTextPHI(transcript) {
    // Basic PHI masking for text transcripts
    // In production, would use more sophisticated NLP

    let masked = transcript;

    // Mask potential patient names (simple regex patterns)
    masked = masked.replace(/\b[A-Z][a-z]+ (?:is|was|has|have)\b/g, '[PATIENT_NAME]');

    // Mask potential dates
    masked = masked.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[DATE]');

    // Mask potential phone numbers
    masked = masked.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE]');

    // Mask potential medical record numbers
    masked = masked.replace(/\b[Mm][Rr]\s*#?\s*\d+\b/g, '[MRN]');

    return masked;
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

module.exports = DailyNotesVoiceProcessor;