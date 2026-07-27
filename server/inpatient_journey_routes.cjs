/**
 * Inpatient Journey Routes - Phase 3: API Layer (HTTP Endpoints)
 *
 * REST API endpoints for inpatient journey management system.
 * Integrates with service layer and provides comprehensive HTTP interface.
 *
 * Responsibilities:
 * - Journey management endpoints (admission, transfer, discharge)
 * - Daily notes endpoints (manual, voice, paper)
 * - Department integration endpoints
 * - File upload handling (voice, documents)
 * - Authentication and authorization
 * - Error handling and validation
 */

const express = require('express');
const path = require('path');
const { InpatientJourneyService } = require('./inpatient_journey_service.cjs');
const { DailyNotesService } = require('./daily_notes_service.cjs');
const { DepartmentIntegrationService } = require('./department_integration_service.cjs');
const { DischargeSummaryService } = require('./discharge_summary_service.cjs');

class InpatientJourneyRoutes {
  constructor(config = {}) {
    this.storageDir = config.storageDir || config.storage?.storageDir;
    this.uploadDir = config.uploadDir || path.join(this.storageDir, 'uploads');

    // Initialize services
    this.journeyService = config.journeyService || new InpatientJourneyService();
    this.dailyNotesService = config.dailyNotesService || new DailyNotesService();
    this.departmentIntegrationService = config.departmentIntegrationService || new DepartmentIntegrationService();
    this.dischargeSummaryService = config.dischargeSummaryService || new DischargeSummaryService();

    // Configuration
    this.maxFileSize = config.maxFileSize || 50 * 1024 * 1024; // 50MB default
    this.allowedMimeTypes = config.allowedMimeTypes || [
      'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3',
      'image/jpeg', 'image/png', 'image/jpg', 'application/pdf'
    ];
  }

  log(message, data = {}) {
    console.log(`[InpatientJourneyRoutes] ${message}`, data);
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
   * Register all journey routes with Express app
   */
  registerRoutes(app, authService) {
    // ========================================
    // Journey Management Endpoints
    // ========================================

    /**
     * GET /api/journeys/:id
     * Get single journey by ID
     */
    app.get('/api/journeys/:id', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const journey = await this.journeyService.findJourneyById(req.params.id);
        if (!journey) {
          res.status(404).json({ error: 'Journey not found' });
          return;
        }

        res.json(journey);
      }, req, res);
    });

    /**
     * GET /api/journeys/patient/:patientId
     * Get all journeys for a specific patient
     */
    app.get('/api/journeys/patient/:patientId', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const journeys = await this.journeyService.findJourneysByPatient(req.params.patientId);
        res.json({ journeys });
      }, req, res);
    });

    /**
     * GET /api/journeys
     * List journeys with filters
     * Query params: status, location, department, startDate, endDate
     */
    app.get('/api/journeys', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const filters = {
          status: req.query.status,
          locationId: req.query.location,
          departmentId: req.query.department,
          startDate: req.query.startDate,
          endDate: req.query.endDate,
          limit: parseInt(req.query.limit) || 50,
          offset: parseInt(req.query.offset) || 0
        };

        const result = await this.journeyService.listJourneys(filters);
        res.json(result);
      }, req, res);
    });

    /**
     * POST /api/journeys/admit
     * Admit a new patient
     */
    app.post('/api/journeys/admit', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const admissionData = {
          ...req.body,
          admittedBy: user.id || user.username
        };

        const journey = await this.journeyService.admitPatient(admissionData);
        res.status(201).json(journey);
      }, req, res);
    });

    /**
     * PUT /api/journeys/:id/status
     * Update journey status (admitting, active, discharged, etc.)
     */
    app.put('/api/journeys/:id/status', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const { status } = req.body;
        if (!status) {
          res.status(400).json({ error: 'Status is required' });
          return;
        }

        const journey = await this.journeyService.updateJourneyStatus(
          req.params.id,
          status,
          { updatedBy: user.id || user.username }
        );

        if (!journey) {
          res.status(404).json({ error: 'Journey not found' });
          return;
        }

        res.json(journey);
      }, req, res);
    });

    /**
     * POST /api/journeys/:id/discharge
     * Discharge a patient
     */
    app.post('/api/journeys/:id/discharge', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const dischargeData = {
          ...req.body,
          dischargedBy: user.id || user.username
        };

        const journey = await this.journeyService.dischargePatient(req.params.id, dischargeData);
        if (!journey) {
          res.status(404).json({ error: 'Journey not found' });
          return;
        }

        res.json(journey);
      }, req, res);
    });

    /**
     * GET /api/journeys/:id/discharge-summary
     * Get discharge summary for journey
     */
    app.get('/api/journeys/:id/discharge-summary', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        try {
          const journey = await this.journeyService.getJourneyById(req.params.id);
          if (!journey) {
            res.status(404).json({ error: 'Journey not found' });
            return;
          }

          const dischargeSummary = await this.dischargeSummaryService.generateDischargeSummary(
            journey,
            { userId: user.id || user.username }
          );

          res.json(dischargeSummary);
        } catch (error) {
          this.log('Failed to get discharge summary', { error: error.message });
          res.status(500).json({ error: 'Failed to generate discharge summary' });
        }
      }, req, res);
    });

    /**
     * POST /api/journeys/:id/generate-discharge-summary
     * Generate new discharge summary
     */
    app.post('/api/journeys/:id/generate-discharge-summary', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        try {
          const journey = await this.journeyService.getJourneyById(req.params.id);
          if (!journey) {
            res.status(404).json({ error: 'Journey not found' });
            return;
          }

          const dischargeSummary = await this.dischargeSummaryService.generateDischargeSummary(
            journey,
            { userId: user.id || user.username, ...req.body }
          );

          res.json({
            success: true,
            message: 'Discharge summary generated successfully',
            data: dischargeSummary
          });
        } catch (error) {
          this.log('Failed to generate discharge summary', { error: error.message });
          res.status(500).json({ error: 'Failed to generate discharge summary' });
        }
      }, req, res);
    });

    /**
     * POST /api/journeys/:id/export-discharge-summary
     * Export discharge summary to PDF or Word
     */
    app.post('/api/journeys/:id/export-discharge-summary', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        try {
          const journey = await this.journeyService.getJourneyById(req.params.id);
          if (!journey) {
            res.status(404).json({ error: 'Journey not found' });
            return;
          }

          const { format = 'pdf' } = req.body;

          // First generate the summary
          const dischargeSummary = await this.dischargeSummaryService.generateDischargeSummary(
            journey,
            { userId: user.id || user.username }
          );

          // Then export it
          let exportResult;
          if (format === 'pdf') {
            exportResult = await this.dischargeSummaryService.exportToPDF(dischargeSummary);
          } else if (format === 'word') {
            exportResult = await this.dischargeSummaryService.exportToWord(dischargeSummary);
          } else {
            res.status(400).json({ error: 'Invalid format. Use "pdf" or "word"' });
            return;
          }

          res.json({
            success: true,
            message: `Discharge summary exported as ${format.toUpperCase()}`,
            data: exportResult
          });
        } catch (error) {
          this.log('Failed to export discharge summary', { error: error.message });
          res.status(500).json({ error: 'Failed to export discharge summary' });
        }
      }, req, res);
    });

    /**
     * POST /api/journeys/:id/transfer
     * Transfer patient to new location
     */
    app.post('/api/journeys/:id/transfer', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const transferData = {
          ...req.body,
          transferredBy: user.id || user.username
        };

        const journey = await this.journeyService.transferPatient(req.params.id, transferData);
        if (!journey) {
          res.status(404).json({ error: 'Journey not found' });
          return;
        }

        res.json(journey);
      }, req, res);
    });

    /**
     * GET /api/journeys/:id/analytics
     * Get journey statistics and analytics
     */
    app.get('/api/journeys/:id/analytics', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const analytics = await this.journeyService.getJourneyAnalytics(req.params.id);
        if (!analytics) {
          res.status(404).json({ error: 'Journey not found' });
          return;
        }

        res.json(analytics);
      }, req, res);
    });

    // ========================================
    // Daily Notes Endpoints
    // ========================================

    /**
     * GET /api/journeys/:journeyId/notes
     * Get all daily notes for a journey
     */
    app.get('/api/journeys/:journeyId/notes', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const filters = {
          noteType: req.query.noteType,
          status: req.query.status,
          startDate: req.query.startDate,
          endDate: req.query.endDate
        };

        const notes = await this.dailyNotesService.getNotesByJourney(req.params.journeyId, filters);
        res.json({ notes });
      }, req, res);
    });

    /**
     * GET /api/journeys/:journeyId/notes/:noteId
     * Get specific daily note
     */
    app.get('/api/journeys/:journeyId/notes/:noteId', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const note = await this.dailyNotesService.getNoteById(req.params.noteId);
        if (!note || note.journeyId !== req.params.journeyId) {
          res.status(404).json({ error: 'Note not found' });
          return;
        }

        res.json(note);
      }, req, res);
    });

    /**
     * POST /api/journeys/:journeyId/notes
     * Create a new daily note (manual entry)
     */
    app.post('/api/journeys/:journeyId/notes', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const noteData = {
          ...req.body,
          journeyId: req.params.journeyId,
          createdBy: user.id || user.username,
          noteType: req.body.noteType || 'manual'
        };

        const note = await this.dailyNotesService.createDailyNoteManual(noteData);
        res.status(201).json(note);
      }, req, res);
    });

    /**
     * PUT /api/journeys/:journeyId/notes/:noteId
     * Update existing daily note
     */
    app.put('/api/journeys/:journeyId/notes/:noteId', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const updateData = {
          ...req.body,
          updatedBy: user.id || user.username
        };

        const note = await this.dailyNotesService.updateDailyNote(
          req.params.noteId,
          updateData
        );

        if (!note) {
          res.status(404).json({ error: 'Note not found' });
          return;
        }

        res.json(note);
      }, req, res);
    });

    /**
     * POST /api/journeys/:journeyId/notes/:noteId/voice
     * Create voice daily note with audio file
     */
    app.post('/api/journeys/:journeyId/notes/:noteId/voice',
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
            journeyId: req.params.journeyId,
            noteId: req.params.noteId,
            audioData: file.buffer,
            mimeType: file.mimetype,
            createdBy: user.id || user.username,
            durationMs: req.headers['x-duration-ms'] ?
              parseInt(req.headers['x-duration-ms']) : undefined
          };

          const note = await this.dailyNotesService.createDailyNoteVoice(voiceData);
          res.status(201).json(note);
        }, req, res);
      }
    );

    /**
     * POST /api/journeys/:journeyId/notes/:noteId/paper
     * Create paper digitization daily note
     */
    app.post('/api/journeys/:journeyId/notes/:noteId/paper',
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

          const paperData = {
            journeyId: req.params.journeyId,
            noteId: req.params.noteId,
            imageData: file.buffer,
            mimeType: file.mimetype,
            createdBy: user.id || user.username
          };

          const note = await this.dailyNotesService.createDailyNotePaper(paperData);
          res.status(201).json(note);
        }, req, res);
      }
    );

    /**
     * POST /api/journeys/:journeyId/notes/:noteId/submit-review
     * Submit daily note for review
     */
    app.post('/api/journeys/:journeyId/notes/:noteId/submit-review', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const { reviewerId } = req.body;
        const note = await this.dailyNotesService.submitForReview(
          req.params.noteId,
          reviewerId || user.id || user.username
        );

        if (!note) {
          res.status(404).json({ error: 'Note not found' });
          return;
        }

        res.json(note);
      }, req, res);
    });

    /**
     * POST /api/journeys/:journeyId/notes/:noteId/approve
     * Approve daily note
     */
    app.post('/api/journeys/:journeyId/notes/:noteId/approve', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const { feedback } = req.body;
        const note = await this.dailyNotesService.approveDailyNote(
          req.params.noteId,
          user.id || user.username,
          feedback
        );

        if (!note) {
          res.status(404).json({ error: 'Note not found' });
          return;
        }

        res.json(note);
      }, req, res);
    });

    /**
     * GET /api/journeys/:journeyId/notes/timeline
     * Get daily notes timeline
     */
    app.get('/api/journeys/:journeyId/notes/timeline', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const timeline = await this.dailyNotesService.getDailyNotesTimeline(req.params.journeyId);
        res.json({ timeline });
      }, req, res);
    });

    // ========================================
    // Department Integration Endpoints
    // ========================================

    /**
     * GET /api/journeys/:journeyId/integrations
     * Get department integrations for journey
     */
    app.get('/api/journeys/:journeyId/integrations', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const filters = {
          integrationType: req.query.type,
          status: req.query.status
        };

        const integrations = await this.departmentIntegrationService.getIntegrationsByJourney(
          req.params.journeyId,
          filters
        );

        res.json({ integrations });
      }, req, res);
    });

    /**
     * POST /api/journeys/:journeyId/integrations/lab-orders
     * Create lab order
     */
    app.post('/api/journeys/:journeyId/integrations/lab-orders', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const orderData = {
          ...req.body,
          journeyId: req.params.journeyId,
          createdBy: user.id || user.username
        };

        const order = await this.departmentIntegrationService.createLabOrder(orderData);
        res.status(201).json(order);
      }, req, res);
    });

    /**
     * POST /api/journeys/:journeyId/integrations/radiology-orders
     * Create radiology order
     */
    app.post('/api/journeys/:journeyId/integrations/radiology-orders', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const orderData = {
          ...req.body,
          journeyId: req.params.journeyId,
          createdBy: user.id || user.username
        };

        const order = await this.departmentIntegrationService.createRadiologyOrder(orderData);
        res.status(201).json(order);
      }, req, res);
    });

    /**
     * POST /api/journeys/:journeyId/integrations/medication-orders
     * Create medication order
     */
    app.post('/api/journeys/:journeyId/integrations/medication-orders', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const orderData = {
          ...req.body,
          journeyId: req.params.journeyId,
          createdBy: user.id || user.username
        };

        const order = await this.departmentIntegrationService.createMedicationOrder(orderData);
        res.status(201).json(order);
      }, req, res);
    });

    /**
     * POST /api/journeys/:journeyId/integrations/consultation-requests
     * Create consultation request
     */
    app.post('/api/journeys/:journeyId/integrations/consultation-requests', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const consultationData = {
          ...req.body,
          journeyId: req.params.journeyId,
          createdBy: user.id || user.username
        };

        const consultation = await this.departmentIntegrationService.createConsultationRequest(consultationData);
        res.status(201).json(consultation);
      }, req, res);
    });

    // ========================================
    // Department Integration External Endpoints
    // ========================================

    /**
     * POST /api/department-integrations/lab-results
     * Process lab results from external system
     */
    app.post('/api/department-integrations/lab-results', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const results = await this.departmentIntegrationService.processLabResults(req.body);
        res.status(201).json(results);
      }, req, res);
    });

    /**
     * POST /api/department-integrations/radiology-results
     * Process radiology results from external system
     */
    app.post('/api/department-integrations/radiology-results', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const results = await this.departmentIntegrationService.processRadiologyResults(req.body);
        res.status(201).json(results);
      }, req, res);
    });

    /**
     * GET /api/department-integrations/pending/:departmentType
     * Get pending integrations by department type
     */
    app.get('/api/department-integrations/pending/:departmentType', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const pendingOrders = await this.departmentIntegrationService.exportPendingOrders(
          req.params.departmentType
        );

        res.json({ orders: pendingOrders });
      }, req, res);
    });

    /**
     * POST /api/department-integrations/export/:departmentType
     * Export orders to external system
     */
    app.post('/api/department-integrations/export/:departmentType', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const exportResult = await this.departmentIntegrationService.exportToExternalSystem(
          req.params.departmentType,
          req.body.options || {}
        );

        res.json(exportResult);
      }, req, res);
    });

    // ========================================
    // Statistics and Monitoring Endpoints
    // ========================================

    /**
     * GET /api/journeys/stats/overview
     * Get overall journey statistics
     */
    app.get('/api/journeys/stats/overview', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const stats = await this.journeyService.getJourneyStats();
        res.json(stats);
      }, req, res);
    });

    /**
     * GET /api/journeys/stats/department/:departmentId
     * Get statistics by department
     */
    app.get('/api/journeys/stats/department/:departmentId', async (req, res) => {
      await this.handleAsyncRoute(async () => {
        const user = await this.requireAuth(req, res, authService);
        if (!user) return;

        const stats = await this.journeyService.getDepartmentStats(req.params.departmentId);
        if (!stats) {
          res.status(404).json({ error: 'Department not found' });
          return;
        }

        res.json(stats);
      }, req, res);
    });

    this.log('Routes registered successfully');
  }
}

module.exports = InpatientJourneyRoutes;