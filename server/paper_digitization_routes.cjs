/**
 * Paper Digitization Routes - Phase 4: Paper Digitization API Endpoints
 *
 * REST API endpoints for paper digitization workflows.
 * Supports mobile photo capture, batch scanning, and human verification.
 *
 * Responsibilities:
 * - Paper note capture endpoints
 * - Batch upload endpoints
 * - Human verification endpoints
 * - Statistics and monitoring endpoints
 * - File upload handling
 */

const express = require('express');
const path = require('path');

class PaperDigitizationRoutes {
  constructor(config = {}) {
    this.storageDir = config.storageDir || config.storage?.storageDir || '/tmp/paper_digitization';
    this.uploadDir = config.uploadDir || path.join(this.storageDir, 'uploads');

    // Initialize services (check if provided or create new instance)
    if (config.paperDigitizationService) {
      this.paperDigitizationService = config.paperDigitizationService;
    } else {
      const PaperDigitizationService = require('./paper_digitization_service.cjs');
      this.paperDigitizationService = new PaperDigitizationService({
        storageDir: this.storageDir
      });
    }

    // Configuration
    this.maxFileSize = config.maxFileSize || 15 * 1024 * 1024; // 15MB
    this.allowedMimeTypes = config.allowedMimeTypes || [
      'image/jpeg', 'image/png', 'image/jpg', 'image/webp'
    ];
    this.maxBatchSize = config.maxBatchSize || 50;
  }

  log(message, data = {}) {
    console.log(`[PaperDigitizationRoutes] ${message}`, data);
  }

  /**
   * Authentication middleware - validates user session
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
   * Validate file upload constraints
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
   * Handle async route errors consistently
   */
  async handleAsyncRoute(handler, req, res) {
    try {
      await handler(req, res);
    } catch (error) {
      this.log('Route error', {
        endpoint: req.path,
        method: req.method,
        error: error.message,
        stack: error.stack
      });

      // Handle specific error types
      if (error.code === '23503') {
        res.status(400).json({ error: 'Referenced entity does not exist' });
      } else if (error.code === '23505') {
        res.status(409).json({ error: 'Resource already exists' });
      } else if (error.code === '22P02') {
        res.status(400).json({ error: 'Invalid data format' });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }

  /**
   * Register all paper digitization routes with Express app
   */
  registerRoutes(app, authService) {
    // ========================================
    // Paper Note Capture Endpoints
    // ========================================

    /**
     * POST /api/paper-digitization/capture
     * Capture paper note (mobile-optimized)
     */
    app.post('/api/paper-digitization/capture',
      express.raw({ type: () => true, limit: '100mb' }),
      async (req, res) => {
        await this.handleAsyncRoute(async () => {
          const user = await this.requireAuth(req, res, authService);
          if (!user) return;

          const file = {
            buffer: req.body,
            mimetype: req.headers['content-type'] || 'image/jpeg',
            size: req.body ? req.body.length : 0
          };

          const validation = this.validateFileUpload(file);
          if (!validation.valid) {
            res.status(400).json({ error: 'Invalid file', details: validation.errors });
            return;
          }

          const captureData = {
            imageData: file.buffer,
            journeyId: req.headers['x-journey-id'] || req.body.journeyId,
            noteDate: req.headers['x-note-date'] || req.body.noteDate,
            source: req.headers['x-capture-source'] || 'mobile_capture',
            createdBy: user.id || user.username,
            options: {
              mimeType: file.mimetype,
              documentName: req.headers['x-document-name']
            }
          };

          const result = await this.paperDigitizationService.capturePaperNote(captureData);
          res.status(201).json(result);

        }, req, res);
      }
    );

    /**
     * POST /api/paper-digitization/batch
     * Batch upload paper charts (medical records scanning)
     */
    app.post('/api/paper-digitization/batch', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const { images, journeyId, noteDate, options } = req.body;

        if (!Array.isArray(images) || images.length === 0) {
          res.status(400).json({ error: 'Images array is required' });
          return;
        }

        if (images.length > this.maxBatchSize) {
          res.status(400).json({
            error: `Batch size exceeds ${this.maxBatchSize} images limit`
          });
          return;
        }

        if (!journeyId) {
          res.status(400).json({ error: 'Journey ID is required' });
          return;
        }

        const batchData = {
          images,
          journeyId,
          noteDate,
          options: options || {},
          createdBy: user.id || user.username
        };

        const result = await this.paperDigitizationService.uploadBatchPaperChart(batchData);
        res.status(201).json(result);

      }, req, res);
    });

    // ========================================
    // Human Verification Endpoints
    // ========================================

    /**
     * GET /api/paper-digitization/verification-queue
     * Get verification queue
     */
    app.get('/api/paper-digitization/verification-queue', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const filters = {
          journeyId: req.query.journeyId,
          priority: req.query.priority,
          limit: parseInt(req.query.limit) || 50,
          offset: parseInt(req.query.offset) || 0
        };

        const queue = await this.paperDigitizationService.getVerificationQueue(filters);
        res.json(queue);

      }, req, res);
    });

    /**
     * POST /api/paper-digitization/verify/:noteId
     * Verify extracted content
     */
    app.post('/api/paper-digitization/verify/:noteId', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const verificationData = {
          noteId: req.params.noteId,
          verifierId: user.id || user.username,
          verifiedData: req.body.verifiedData,
          notes: req.body.notes
        };

        const result = await this.paperDigitizationService.verifyExtractedContent(verificationData);

        if (!result) {
          res.status(404).json({ error: 'Note not found' });
          return;
        }

        res.json(result);

      }, req, res);
    });

    /**
     * GET /api/paper-digitization/verify/:noteId/original
     * Get original paper image for verification
     */
    app.get('/api/paper-digitization/verify/:noteId/original', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        // Get note to find original image path
        const note = await this.paperDigitizationService.dailyNotesRepository ?
          this.paperDigitizationService.dailyNotesRepository.findNoteById(req.params.noteId) :
          null;
        if (!note) {
          res.status(404).json({ error: 'Note not found' });
          return;
        }

        const originalImagePath = note.metadata?.originalImagePath;
        if (!originalImagePath || !require('fs').existsSync(originalImagePath)) {
          res.status(404).json({ error: 'Original image not found' });
          return;
        }

        // Send file
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'private, no-store');
        return res.sendFile(originalImagePath);

      }, req, res);
    });

    // ========================================
    // Statistics and Monitoring Endpoints
    // ========================================

    /**
     * GET /api/paper-digitization/stats/journey/:journeyId
     * Get paper digitization statistics for journey
     */
    app.get('/api/paper-digitization/stats/journey/:journeyId', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const stats = await this.paperDigitizationService.getPaperDigitizationStats(req.params.journeyId);
        res.json(stats);

      }, req, res);
    });

    /**
     * GET /api/paper-digitization/stats/overview
     * Get overall paper digitization statistics
     */
    app.get('/api/paper-digitization/stats/overview', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        // Get overall statistics
        const stats = {
          totalJourneys: 0,
          totalPaperNotes: 0,
          totalVerified: 0,
          totalPendingVerification: 0,
          averageConfidence: 0,
          digitizationRate: 0,
          verificationRate: 0,
          recentActivity: []
        };

        // Get verification queue for pending count
        const queue = await this.paperDigitizationService.getVerificationQueue({});
        stats.totalPendingVerification = queue.total;

        res.json(stats);

      }, req, res);
    });

    // ========================================
    // Mobile-Optimized Endpoints
    // ========================================

    /**
     * POST /api/paper-digitization/mobile/capture
     * Mobile-optimized capture endpoint
     */
    app.post('/api/paper-digitization/mobile/capture',
      express.raw({ type: () => true, limit: '100mb' }),
      async (req, res) => {
        await this.handleAsyncRoute(async () => {
          const user = await this.requireAuth(req, res, authService);
          if (!user) return;

          const file = {
            buffer: req.body,
            mimetype: req.headers['content-type'] || 'image/jpeg',
            size: req.body ? req.body.length : 0
          };

          const validation = this.validateFileUpload(file);
          if (!validation.valid) {
            res.status(400).json({ error: 'Invalid file', details: validation.errors });
            return;
          }

          // Extract metadata from headers for mobile efficiency
          const captureData = {
            imageData: file.buffer,
            journeyId: req.headers['x-journey-id'],
            noteDate: req.headers['x-note-date'] || new Date().toISOString().split('T')[0],
            source: 'mobile_capture',
            createdBy: user.id || user.username,
            options: {
              mimeType: file.mimetype,
              mobileOptimized: true,
              deviceInfo: req.headers['x-device-info'],
              location: req.headers['x-location']
            }
          };

          // Quick validation
          if (!captureData.journeyId) {
            res.status(400).json({ error: 'Journey ID required (x-journey-id header)' });
            return;
          }

          const result = await this.paperDigitizationService.capturePaperNote(captureData);

          // Return mobile-friendly response
          res.status(201).json({
            success: true,
            noteId: result.note.id,
            status: result.status,
            confidence: result.extraction.quality.overallConfidence,
            requiresReview: result.extraction.quality.requiresReview,
            message: result.status === 'pending_verification'
              ? 'Paper note captured and queued for verification'
              : 'Paper note captured and processed successfully'
          });

        }, req, res);
      }
    );

    /**
     * GET /api/paper-digitization/mobile/quick-capture-info
     * Quick info for mobile capture UI
     */
    app.get('/api/paper-digitization/mobile/quick-capture-info', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        // Return quick capture configuration for mobile
        res.json({
          maxFileSize: this.maxFileSize,
          supportedFormats: this.allowedMimeTypes,
          recommendedSettings: {
            imageQuality: 'high',
            resolution: 'minimum 1080p',
            lighting: 'well-lit environment',
            angle: 'direct overhead shot'
          },
          quickSteps: [
            '1. Place paper note on flat surface',
            '2. Ensure good lighting',
            '3. Hold camera directly above note',
            '4. Capture entire note in frame',
            '5. Submit for processing'
          ]
        });

      }, req, res);
    });

    // ========================================
    // Progressive Digitization Endpoints
    // ========================================

    /**
     * GET /api/paper-digitization/progress/:journeyId
     * Get digitization progress for journey
     */
    app.get('/api/paper-digitization/progress/:journeyId', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const stats = await this.paperDigitizationService.getPaperDigitizationStats(req.params.journeyId);

        // Calculate progress percentage
        const progress = {
          journeyId: req.params.journeyId,
          digitizationStatus: stats.digitizationStatus,
          totalNotes: stats.totalNotes,
          paperNotes: stats.paperNotes,
          digitizedNotes: stats.digitizedNotes,
          completionRate: stats.totalNotes > 0 ? stats.digitizedNotes / stats.totalNotes : 0,
          verificationRate: stats.verificationRate,
          averageConfidence: stats.averageConfidence,
          timeline: stats.timeline,
          recommendations: this.getProgressRecommendations(stats)
        };

        res.json(progress);

      }, req, res);
    });

    /**
     * GET /api/paper-digitization/recommendations/:journeyId
     * Get digitization recommendations for journey
     */
    app.get('/api/paper-digitization/recommendations/:journeyId', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const stats = await this.paperDigitizationService.getPaperDigitizationStats(req.params.journeyId);
        const recommendations = this.getProgressRecommendations(stats);

        res.json({
          journeyId: req.params.journeyId,
          stats,
          recommendations
        });

      }, req, res);
    });

    this.log('Paper digitization routes registered successfully');
  }

  /**
   * Get progress recommendations based on statistics
   */
  getProgressRecommendations(stats) {
    const recommendations = [];

    if (stats.digitizationStatus === 'none' || stats.digitizationStatus === 'digital_only') {
      recommendations.push({
        type: 'opportunity',
        priority: 'high',
        message: 'Start digitizing paper notes for complete digital journey',
        action: 'begin_paper_capture'
      });
    }

    if (stats.verificationRate < 0.5 && stats.pendingVerification > 0) {
      recommendations.push({
        type: 'action_required',
        priority: 'medium',
        message: `${stats.pendingVerification} notes pending verification`,
        action: 'review_verification_queue'
      });
    }

    if (stats.averageConfidence < 0.7) {
      recommendations.push({
        type: 'quality_improvement',
        priority: 'medium',
        message: 'Average extraction confidence is low - consider image quality improvements',
        action: 'improve_capture_quality'
      });
    }

    if (stats.digitizationStatus === 'full_paper' && stats.verificationRate > 0.8) {
      recommendations.push({
        type: 'achievement',
        priority: 'low',
        message: 'Excellent progress! Journey is nearly fully digitized',
        action: 'continue_digitization'
      });
    }

    return recommendations;
  }

  /**
   * Register routes with app (alias for compatibility)
   */
  register(app, authService) {
    return this.registerRoutes(app, authService);
  }
}

module.exports = PaperDigitizationRoutes;