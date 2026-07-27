/**
 * Paper Digitization Tests - Phase 4: Paper Digitization Workflow Testing
 *
 * Comprehensive test suite for paper digitization services and routes.
 * Tests handwriting extraction, batch processing, and verification workflows.
 */

const PaperDigitizationService = require('../../paper_digitization_service.cjs');
const HandwritingExtractionService = require('../../handwriting_extraction_service.cjs');
const PaperDigitizationRoutes = require('../../paper_digitization_routes.cjs');

// Mock services
class MockHandwritingService {
  constructor() {
    this.extractionResults = new Map();
  }

  async extractHandwriting(imageData, options) {
    return {
      success: true,
      data: {
        soap: {
          subjective: 'Patient feels better today',
          objective: 'Vitals stable, no fever',
          assessment: 'Improving condition',
          plan: 'Continue current treatment'
        },
        vitals: {
          temperature: '98.6°F',
          bloodPressure: '120/80',
          heartRate: '72'
        },
        medications: [],
        procedures: []
      },
      quality: {
        overallConfidence: 0.85,
        completeness: 0.9,
        consistency: 0.9,
        requiresReview: false
      }
    };
  }
}

class MockDailyNotesRepository {
  constructor() {
    this.notes = new Map();
  }

  async createDailyNote(noteData) {
    const note = {
      id: 'note-' + Date.now(),
      ...noteData,
      createdAt: new Date().toISOString(),
      status: 'draft'
    };
    this.notes.set(note.id, note);
    return note;
  }

  async findNoteById(noteId) {
    return this.notes.get(noteId) || null;
  }

  async findNotesByJourney(journeyId) {
    const allNotes = Array.from(this.notes.values());
    console.log(`MockDailyNotesRepository.findNotesByJourney(${journeyId})`, {
      totalNotes: allNotes.length,
      matchingNotes: allNotes.filter(n => n.journeyId === journeyId).length,
      allJourneys: allNotes.map(n => ({ id: n.id, journeyId: n.journeyId, noteType: n.noteType }))
    });
    return allNotes.filter(n => n.journeyId === journeyId);
  }

  async findNotesByStatus(status) {
    return Array.from(this.notes.values()).filter(n => n.status === status);
  }

  async updateDailyNote(noteId, updates) {
    const note = this.notes.get(noteId);
    if (note) {
      Object.assign(note, updates);
      this.notes.set(noteId, note);
      return note;
    }
    return null;
  }
}

class MockJourneysRepository {
  constructor() {
    this.journeys = new Map();
  }

  async findJourneyById(journeyId) {
    return this.journeys.get(journeyId) || {
      id: journeyId,
      patientId: 'patient-1',
      status: 'active'
    };
  }

  async createJourney(journeyData) {
    const journey = {
      id: 'journey-' + Date.now(),
      ...journeyData,
      createdAt: new Date().toISOString()
    };
    this.journeys.set(journey.id, journey);
    return journey;
  }
}

// Test Framework
class TestRunner {
  constructor() {
    this.tests = [];
    this.results = { passed: 0, failed: 0, skipped: 0 };
  }

  test(description, testFn) {
    this.tests.push({ description, testFn });
  }

  async run() {
    console.log('🧪 Running Paper Digitization Tests...\n');

    for (const testCase of this.tests) {
      try {
        await testCase.testFn();
        this.results.passed++;
        console.log(`✓ ${testCase.description}`);
      } catch (error) {
        this.results.failed++;
        console.log(`✗ ${testCase.description}`);
        console.log(`  Error: ${error.message}`);
      }
    }

    console.log('\n📊 Test Results:');
    console.log(`   Total:  ${this.tests.length} tests`);
    console.log(`   ✓ Pass: ${this.results.passed} tests ✅`);
    console.log(`   ✗ Fail: ${this.results.failed} tests`);
    console.log(`   ⊘ Skip: ${this.results.skipped} tests`);
    console.log(`   Success Rate: ${((this.results.passed / this.tests.length) * 100).toFixed(1)}%`);
  }
}

// Assertions
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`${message}: value is falsy`);
  }
}

function assertNotNull(value, message) {
  if (value === null || value === undefined) {
    throw new Error(`${message}: value is null/undefined`);
  }
}

function assertGreaterThan(value, threshold, message) {
  if (value <= threshold) {
    throw new Error(`${message}: ${value} is not greater than ${threshold}`);
  }
}

// Main Test Execution
async function runPaperDigitizationTests() {
  const runner = new TestRunner();

  // Setup mock services
  const mockHandwritingService = new MockHandwritingService();
  const mockDailyNotesRepository = new MockDailyNotesRepository();
  const mockJourneysRepository = new MockJourneysRepository();

  // ========================================
  // Handwriting Extraction Service Tests
  // ========================================

  runner.test('HandwritingExtractionService - should initialize successfully', async () => {
    const service = new HandwritingExtractionService({
      tempDir: '/tmp/test_handwriting'
    });

    assertNotNull(service, 'Service should be initialized');
    assertEqual(service.name, 'HandwritingExtractionService', 'Service name should be correct');
  });

  runner.test('HandwritingExtractionService - should extract handwriting from image', async () => {
    const service = new HandwritingExtractionService({
      tempDir: '/tmp/test_handwriting',
      handwritingService: mockHandwritingService
    });

    const mockImageData = Buffer.from('test image data');
    const result = await service.extractHandwriting(mockImageData, {
      mimeType: 'image/jpeg'
    });

    assertTrue(result.success, 'Extraction should succeed');
    assertNotNull(result.data, 'Should return extracted data');
    assertNotNull(result.data.soap, 'Should contain SOAP structure');
  });

  runner.test('HandwritingExtractionService - should validate image input', async () => {
    const service = new HandwritingExtractionService();

    // Test invalid input
    try {
      await service.validateImageInput('not a buffer', 'image/jpeg');
      throw new Error('Should have thrown validation error');
    } catch (error) {
      assertTrue(error.message.includes('must be a buffer'), 'Should validate buffer type');
    }
  });

  // ========================================
  // Paper Digitization Service Tests
  // ========================================

  runner.test('PaperDigitizationService - should capture paper note', async () => {
    const service = new PaperDigitizationService({
      storageDir: '/tmp/test_paper',
      handwritingService: mockHandwritingService,
      dailyNotesRepository: mockDailyNotesRepository,
      journeysRepository: mockJourneysRepository
    });

    // Create a journey first
    await mockJourneysRepository.createJourney({
      id: 'journey-1',
      patientId: 'patient-1',
      status: 'active'
    });

    const captureData = {
      imageData: Buffer.from('test paper image'),
      journeyId: 'journey-1',
      noteDate: '2024-01-15',
      source: 'mobile_capture',
      createdBy: 'test-user'
    };

    const result = await service.capturePaperNote(captureData);

    assertTrue(result.success, 'Capture should succeed');
    assertNotNull(result.note, 'Should return created note');
    assertEqual(result.note.noteType, 'paper', 'Note should be paper type');
    assertEqual(result.note.journeyId, 'journey-1', 'Note should belong to journey');
  });

  runner.test('PaperDigitizationService - should handle batch upload', async () => {
    const service = new PaperDigitizationService({
      storageDir: '/tmp/test_paper',
      handwritingService: mockHandwritingService,
      dailyNotesRepository: mockDailyNotesRepository,
      journeysRepository: mockJourneysRepository
    });

    const batchData = {
      images: [
        { buffer: Buffer.from('image1') },
        { buffer: Buffer.from('image2') }
      ],
      journeyId: 'journey-1',
      noteDate: '2024-01-15',
      createdBy: 'test-user'
    };

    const result = await service.uploadBatchPaperChart(batchData);

    assertTrue(result.success, 'Batch upload should succeed');
    assertEqual(result.batchResults.total, 2, 'Should process 2 images');
    assertEqual(result.batchResults.successful, 2, 'Should successfully process both images');
  });

  runner.test('PaperDigitizationService - should verify extracted content', async () => {
    const service = new PaperDigitizationService({
      storageDir: '/tmp/test_paper',
      dailyNotesRepository: mockDailyNotesRepository
    });

    // Create a note to verify
    const note = await mockDailyNotesRepository.createDailyNote({
      journeyId: 'journey-1',
      noteType: 'paper',
      subjective: 'Original subjective',
      objective: 'Original objective',
      status: 'pending_verification'
    });

    const verificationData = {
      noteId: note.id,
      verifierId: 'verifier-1',
      verifiedData: {
        subjective: 'Verified subjective',
        objective: 'Verified objective',
        assessment: 'New assessment',
        plan: 'New plan'
      }
    };

    const result = await service.verifyExtractedContent(verificationData);

    assertTrue(result.success, 'Verification should succeed');
    assertEqual(result.note.status, 'verified', 'Note should be verified');
    assertEqual(result.note.verifiedBy, 'verifier-1', 'Should record verifier');
  });

  runner.test('PaperDigitizationService - should get digitization statistics', async () => {
    // Create a fresh service for this test
    const freshDailyNotesRepository = new MockDailyNotesRepository();
    const freshJourneysRepository = new MockJourneysRepository();

    const service = new PaperDigitizationService({
      storageDir: '/tmp/test_paper',
      dailyNotesRepository: freshDailyNotesRepository,
      journeysRepository: freshJourneysRepository
    });

    // Create some test notes
    await freshDailyNotesRepository.createDailyNote({
      journeyId: 'journey-stats-1',
      noteType: 'paper',
      status: 'verified',
      metadata: { confidence: 0.9 }
    });

    await freshDailyNotesRepository.createDailyNote({
      journeyId: 'journey-stats-1',
      noteType: 'paper',  // Changed to 'paper' to match what we're testing
      status: 'completed'
    });

    const stats = await service.getPaperDigitizationStats('journey-stats-1');

    assertNotNull(stats, 'Should return statistics');
    assertEqual(stats.journeyId, 'journey-stats-1', 'Should have correct journey ID');
    assertTrue(stats.paperNotes > 0, 'Should have paper notes count');
    assertTrue(stats.verificationRate >= 0, 'Should have verification rate');
  });

  runner.test('PaperDigitizationService - should get verification queue', async () => {
    const service = new PaperDigitizationService({
      storageDir: '/tmp/test_paper',
      dailyNotesRepository: mockDailyNotesRepository
    });

    // Create pending verification note
    await mockDailyNotesRepository.createDailyNote({
      journeyId: 'journey-queue-1',
      noteType: 'paper',
      status: 'pending_verification',
      metadata: { confidence: 0.6 }
    });

    const queue = await service.getVerificationQueue({ journeyId: 'journey-queue-1' });

    assertTrue(queue.success, 'Should get queue successfully');
    assertNotNull(queue.queue, 'Should return queue array');
  });

  // ========================================
  // Paper Digitization Routes Tests
  // ========================================

  runner.test('PaperDigitizationRoutes - should initialize successfully', async () => {
    const routes = new PaperDigitizationRoutes({
      storageDir: '/tmp/test_routes'
    });

    assertNotNull(routes, 'Routes should initialize');
    assertEqual(routes.maxFileSize, 15 * 1024 * 1024, 'Should have correct max file size');
  });

  runner.test('PaperDigitizationRoutes - should validate file uploads', async () => {
    const routes = new PaperDigitizationRoutes();

    // Test valid file
    const validFile = {
      buffer: Buffer.alloc(1024),
      mimetype: 'image/jpeg',
      size: 1024
    };

    const validResult = routes.validateFileUpload(validFile);
    assertTrue(validResult.valid, 'Valid file should pass validation');

    // Test oversized file
    const oversizedFile = {
      buffer: Buffer.alloc(20 * 1024 * 1024),
      mimetype: 'image/jpeg',
      size: 20 * 1024 * 1024
    };

    const oversizedResult = routes.validateFileUpload(oversizedFile);
    assertTrue(!oversizedResult.valid, 'Oversized file should fail validation');
    assertTrue(oversizedResult.errors.length > 0, 'Should have validation errors');
  });

  runner.test('PaperDigitizationRoutes - should register routes with Express', async () => {
    const express = require('express');
    const app = express();

    // Mock authentication service
    const mockAuthService = {
      authenticateFromRequest: async () => ({
        id: 'test-user',
        username: 'testuser',
        role: 'doctor'
      })
    };

    const routes = new PaperDigitizationRoutes({
      storageDir: '/tmp/test_routes'
    });

    // Track route registration
    const registeredRoutes = [];
    const originalGet = app.get;
    const originalPost = app.post;

    app.get = function(path, ...handlers) {
      registeredRoutes.push({ method: 'GET', path });
      return originalGet.call(this, path, ...handlers);
    };

    app.post = function(path, ...handlers) {
      registeredRoutes.push({ method: 'POST', path });
      return originalPost.call(this, path, ...handlers);
    };

    routes.registerRoutes(app, mockAuthService);

    assertTrue(registeredRoutes.length > 0, 'Should register routes');
    assertTrue(
      registeredRoutes.some(r => r.path.includes('/api/paper-digitization')),
      'Should register paper digitization routes'
    );
  });

  // ========================================
  // Integration Tests
  // ========================================

  runner.test('Integration - complete paper digitization workflow', async () => {
    // Setup complete service stack
    const mockHandwritingService = new MockHandwritingService();
    const mockDailyNotesRepository = new MockDailyNotesRepository();
    const mockJourneysRepository = new MockJourneysRepository();

    const service = new PaperDigitizationService({
      storageDir: '/tmp/test_integration',
      handwritingService: mockHandwritingService,
      dailyNotesRepository: mockDailyNotesRepository,
      journeysRepository: mockJourneysRepository
    });

    // Create journey
    await mockJourneysRepository.createJourney({
      id: 'journey-integration-1',
      patientId: 'patient-integration-1',
      status: 'active'
    });

    // Capture paper note
    const captureResult = await service.capturePaperNote({
      imageData: Buffer.from('integration test image'),
      journeyId: 'journey-integration-1',
      noteDate: '2024-01-15',
      createdBy: 'integration-test'
    });

    assertTrue(captureResult.success, 'Capture should succeed');
    assertNotNull(captureResult.note, 'Should create note');
    assertEqual(captureResult.note.status, 'draft', 'Initial status should be draft');

    // Verify content
    const verificationResult = await service.verifyExtractedContent({
      noteId: captureResult.note.id,
      verifierId: 'integration-verifier',
      verifiedData: captureResult.extraction.data
    });

    assertTrue(verificationResult.success, 'Verification should succeed');
    assertEqual(verificationResult.note.status, 'verified', 'Note should be verified');

    // Get statistics
    const stats = await service.getPaperDigitizationStats('journey-integration-1');
    assertNotNull(stats, 'Should get statistics');
    assertEqual(stats.paperNotes, 1, 'Should have 1 paper note');
    assertEqual(stats.verifiedNotes, 1, 'Should have 1 verified note');
  });

  runner.test('Integration - batch processing workflow', async () => {
    const service = new PaperDigitizationService({
      storageDir: '/tmp/test_batch_integration',
      handwritingService: mockHandwritingService,
      dailyNotesRepository: mockDailyNotesRepository,
      journeysRepository: mockJourneysRepository
    });

    // Create journey for batch test
    await mockJourneysRepository.createJourney({
      id: 'journey-batch-1',
      patientId: 'patient-batch-1',
      status: 'active'
    });

    const batchData = {
      images: [
        { buffer: Buffer.from('batch image 1') },
        { buffer: Buffer.from('batch image 2') },
        { buffer: Buffer.from('batch image 3') }
      ],
      journeyId: 'journey-batch-1',
      noteDate: '2024-01-15',
      createdBy: 'batch-test'
    };

    const batchResult = await service.uploadBatchPaperChart(batchData);

    assertTrue(batchResult.success, 'Batch upload should succeed');
    assertEqual(batchResult.batchResults.total, 3, 'Should process 3 images');
    assertEqual(batchResult.batchResults.successful, 3, 'All images should succeed');
    assertGreaterThan(batchResult.summary.digitizationRate, 0.8, 'Should have high digitization rate');
  });

  // Run all tests
  await runner.run();
}

// Execute tests if run directly
if (require.main === module) {
  runPaperDigitizationTests().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = { runPaperDigitizationTests };