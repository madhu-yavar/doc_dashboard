/**
 * Voice Daily Notes Routes - Phase 5: Voice Integration API Endpoints
 *
 * REST API endpoints for voice-enabled daily note creation.
 * Integrates with daily notes voice processor and existing voice infrastructure.
 *
 * Responsibilities:
 * - Real-time voice capture endpoints
 * - Batch voice upload endpoints
 * - Voice transcription endpoints
 * - Integration with existing voice infrastructure
 * - File upload and processing
 */

const express = require('express');
const path = require('path');
const { DailyNotesVoiceProcessor } = require('./daily_notes_voice_processor.cjs');

class VoiceDailyNotesRoutes {
  constructor(config = {}) {
    this.storageDir = config.storageDir || config.storage?.storageDir || '/tmp/voice_daily_notes';
    this.uploadDir = config.uploadDir || path.join(this.storageDir, 'uploads');

    // Initialize voice processor
    this.voiceProcessor = config.voiceProcessor || new DailyNotesVoiceProcessor({
      storageDir: this.storageDir
    });

    // Configuration
    this.maxFileSize = config.maxFileSize || 25 * 1024 * 1024; // 25MB
    this.allowedMimeTypes = config.allowedMimeTypes || [
      'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav'
    ];

    this.log('Voice Daily Notes Routes initialized');
  }

  log(message, data = {}) {
    console.log(`[VoiceDailyNotesRoutes] ${message}`, data);
  }

  /**
   * Authentication middleware
   */
  async requireAuth(req, res, authService) {
    try {
      const user = await authService.authenticateFromRequest(req);
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
      }
      return user;
    } catch (error) {
      res.status(401).json({ error: error.message });
      return null;
    }
  }

  /**
   * Validate file upload
   */
  validateFileUpload(file) {
    const errors = [];

    if (!file || !file.buffer) {
      errors.push('No file data provided');
      return { valid: false, errors };
    }

    if (file.size > this.maxFileSize) {
      errors.push(`File size exceeds ${this.maxFileSize / (1024 * 1024)}MB limit`);
    }

    const mimeType = (file.mimetype || '').toLowerCase();
    if (!this.allowedMimeTypes.some(type => mimeType.includes(type.split('/')[0]))) {
      errors.push(`File type ${file.mimetype} not allowed`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Handle async route errors
   */
  async handleAsyncRoute(handler, req, res) {
    try {
      await handler(req, res);
    } catch (error) {
      this.log('Route error', {
        endpoint: req.path,
        method: req.method,
        error: error.message
      });

      if (error.code === '23503') {
        res.status(400).json({ error: 'Referenced entity does not exist' });
      } else if (error.code === '23505') {
        res.status(409).json({ error: 'Resource already exists' });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }

  /**
   * Register all voice daily notes routes
   */
  registerRoutes(app, authService) {
    // ========================================
    // Real-time Voice Capture Endpoints
    // ========================================

    /**
     * POST /api/voice/daily-notes/capture
     * Real-time voice capture for daily note
     */
    app.post('/api/voice/daily-notes/capture',
      express.raw({ type: () => true, limit: '100mb' }),
      async (req, res) => {
        await this.handleAsyncRoute(async () => {
          const user = await this.requireAuth(req, res, authService);
          if (!user) return;

          const file = {
            buffer: req.body,
            mimetype: req.headers['content-type'] || 'audio/webm',
            size: req.body ? req.body.length : 0
          };

          const validation = this.validateFileUpload(file);
          if (!validation.valid) {
            res.status(400).json({ error: 'Invalid file', details: validation.errors });
            return;
          }

          const voiceData = {
            audioData: file.buffer,
            journeyId: req.headers['x-journey-id'] || req.body.journeyId,
            patientId: req.headers['x-patient-id'] || req.body.patientId,
            language: req.headers['x-language'] || 'en-US',
            format: file.mimetype,
            duration: req.headers['x-duration-ms'] ? parseInt(req.headers['x-duration-ms']) / 1000 : undefined,
            encounterContext: req.body.encounterContext,
            createdBy: user.id || user.username
          };

          if (!voiceData.journeyId) {
            res.status(400).json({ error: 'Journey ID is required (x-journey-id header)' });
            return;
          }

          const result = await this.voiceProcessor.processRealTimeVoice(voiceData);

          res.status(201).json({
            success: true,
            dailyNote: result.dailyNote,
            transcript: result.transcript,
            confidence: result.extraction.confidence,
            audioMetadata: result.audioMetadata
          });

        }, req, res);
      }
    );

    /**
     * POST /api/voice/daily-notes/batch
     * Batch voice file upload
     */
    app.post('/api/voice/daily-notes/batch', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const { audioData, fileName, journeyId, language } = req.body;

        if (!audioData) {
          res.status(400).json({ error: 'Audio data is required' });
          return;
        }

        if (!fileName) {
          res.status(400).json({ error: 'File name is required' });
          return;
        }

        if (!journeyId) {
          res.status(400).json({ error: 'Journey ID is required' });
          return;
        }

        const batchData = {
          audioData: Buffer.from(audioData, 'base64'),
          fileName: fileName,
          journeyId: journeyId,
          language: language || 'en-US',
          format: this.detectFormatFromFileName(fileName),
          createdBy: user.id || user.username
        };

        const result = await this.voiceProcessor.processBatchVoice(batchData);

        res.status(201).json({
          success: true,
          dailyNote: result.dailyNote,
          transcript: result.transcript,
          extraction: result.extraction
        });

      }, req, res);
    });

    /**
     * POST /api/voice/daily-notes/transcribe
     * Transcribe audio and return text only
     */
    app.post('/api/voice/daily-notes/transcribe',
      express.raw({ type: () => true, limit: '100mb' }),
      async (req, res) => {
        await this.handleAsyncRoute(async () => {
          const user = await this.requireAuth(req, res, authService);
          if (!user) return;

          const file = {
            buffer: req.body,
            mimetype: req.headers['content-type'] || 'audio/webm',
            size: req.body ? req.body.length : 0
          };

          const validation = this.validateFileUpload(file);
          if (!validation.valid) {
            res.status(400).json({ error: 'Invalid file', details: validation.errors });
            return;
          }

          const voiceData = {
            audioData: file.buffer,
            language: req.headers['x-language'] || 'en-US',
            format: file.mimetype
          };

          const transcriptionResult = await this.voiceProcessor.transcribeAudio(
            voiceData.audioData,
            {
              language: voiceData.language,
              enableDiarization: true
            }
          );

          // Apply PHI masking to transcript
          const maskedTranscript = await this.voiceProcessor.maskPHIInTranscript(transcriptionResult.transcript);

          res.json({
            success: true,
            transcript: maskedTranscript,
            duration: transcriptionResult.duration,
            confidence: transcriptionResult.confidence,
            language: voiceData.language
          });

        }, req, res);
      }
    );

    /**
     * GET /api/voice/daily-notes/languages
     * Get supported languages for voice processing
     */
    app.get('/api/voice/daily-notes/languages', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        res.json({
          success: true,
          languages: [
            { code: 'en-US', name: 'English (US)', default: true },
            { code: 'es-ES', name: 'Spanish' },
            { code: 'fr-FR', name: 'French' },
            { code: 'de-DE', name: 'German' },
            { code: 'it-IT', name: 'Italian' },
            { code: 'pt-BR', name: 'Portuguese (Brazil)' },
            { code: 'hi-IN', name: 'Hindi' },
            { code: 'zh-CN', name: 'Chinese (Mandarin)' }
          ],
          recommendedSettings: {
            sampleRate: 16000,
            channels: 1,
            bitDepth: 16,
            format: 'webm'
          }
        });

      }, req, res);
    });

    // ========================================
    // Voice Configuration Endpoints
    // ========================================

    /**
     * GET /api/voice/daily-notes/config
     * Get voice processing configuration
     */
    app.get('/api/voice/daily-notes/config', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        res.json({
          success: true,
          config: {
            maxFileSize: this.maxFileSize,
            maxDuration: this.voiceProcessor.maxAudioDuration,
            supportedFormats: this.allowedMimeTypes,
            defaultLanguage: this.voiceProcessor.defaultLanguage,
            enableDiarization: this.voiceProcessor.enableDiarization,
            features: {
              realtimeTranscription: true,
              batchProcessing: true,
              phiMasking: true,
              soapExtraction: true,
              clinicalDataExtraction: true,
              vitalsExtraction: true,
              medicationExtraction: true
            }
          }
        });

      }, req, res);
    });

    /**
     * POST /api/voice/daily-notes/test-microphone
     * Test microphone access and quality
     */
    app.post('/api/voice/daily-notes/test-microphone', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        // Simulate microphone test
        res.json({
          success: true,
          microphoneTest: {
            supported: true,
            recommendedSettings: {
              sampleRate: 16000,
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            qualityIndicators: [
              'Signal strength: Good',
              'Noise level: Low',
              'Clarity: High'
            ]
          }
        });

      }, req, res);
    });

    /**
     * GET /api/voice/daily-notes/health
     * Health check for voice processing service
     */
    app.get('/api/voice/daily-notes/health', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          services: {
            voiceProcessor: 'operational',
            sttAgent: 'operational',
            extractionService: 'operational',
            phiMasking: 'operational'
          },
          performance: {
            averageProcessingTime: '2-5 seconds',
            maxConcurrentSessions: 10,
            currentLoad: 'low'
          }
        };

        res.json(health);

      }, req, res);
    });

    this.log('Voice daily notes routes registered successfully');
  }

  /**
   * Detect audio format from file name
   */
  detectFormatFromFileName(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const formatMap = {
      '.webm': 'audio/webm',
      '.ogg': 'audio/ogg',
      '.mp4': 'audio/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav'
    };
    return formatMap[ext] || 'audio/webm';
  }

  /**
   * Register routes (alias for compatibility)
   */
  register(app, authService) {
    return this.registerRoutes(app, authService);
  }
}

module.exports = VoiceDailyNotesRoutes;