/**
 * Route Registration Tests - Phase 3: API Layer Integration Tests
 *
 * Tests that routes are properly registered with Express app
 * and verify the complete integration chain.
 */

const express = require('express');
const InpatientJourneyRoutes = require('../../inpatient_journey_routes.cjs');

// Mock services
class MockAuthService {
  async authenticateFromRequest(req) {
    return { id: 'test-user', username: 'testuser', role: 'doctor' };
  }
}

class MockJourneyService {
  constructor() {
    this.journeys = new Map();
    this.journeys.set('journey-1', {
      id: 'journey-1',
      patientId: 'patient-1',
      status: 'active',
      admissionDate: new Date().toISOString()
    });
  }

  async findJourneyById(id) {
    return this.journeys.get(id) || null;
  }
}

class MockDailyNotesService {
  async getNotesByJourney(journeyId) {
    return [];
  }
}

class MockDepartmentIntegrationService {
  async getIntegrationsByJourney(journeyId) {
    return [];
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
    console.log('🧪 Running Route Registration Tests...\n');

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

// Main Test Execution
async function runRouteRegistrationTests() {
  const runner = new TestRunner();

  // Setup mock Express app
  function createMockApp() {
    const app = express();
    app.routes = [];
    app._rawMethods = {};

    // Patch Express methods to track route registration
    const originalGet = app.get;
    const originalPost = app.post;
    const originalPut = app.put;
    const originalDelete = app.delete;

    app.get = function(path, ...handlers) {
      this.routes.push({ method: 'GET', path, handlers });
      this._rawMethods[`${path}_GET`] = handlers;
      return originalGet.call(this, path, ...handlers);
    };

    app.post = function(path, ...handlers) {
      this.routes.push({ method: 'POST', path, handlers });
      this._rawMethods[`${path}_POST`] = handlers;
      return originalPost.call(this, path, ...handlers);
    };

    app.put = function(path, ...handlers) {
      this.routes.push({ method: 'PUT', path, handlers });
      this._rawMethods[`${path}_PUT`] = handlers;
      return originalPut.call(this, path, ...handlers);
    };

    app.delete = function(path, ...handlers) {
      this.routes.push({ method: 'DELETE', path, handlers });
      this._rawMethods[`${path}_DELETE`] = handlers;
      return originalDelete.call(this, path, ...handlers);
    };

    return app;
  }

  // Create mock services
  const mockAuthService = new MockAuthService();
  const mockJourneyService = new MockJourneyService();
  const mockDailyNotesService = new MockDailyNotesService();
  const mockDepartmentService = new MockDepartmentIntegrationService();

  // Test route registration
  runner.test('should register routes with Express app', async () => {
    const app = createMockApp();
    const routes = new InpatientJourneyRoutes({
      storageDir: '/tmp/test',
      journeyService: mockJourneyService,
      dailyNotesService: mockDailyNotesService,
      departmentIntegrationService: mockDepartmentService
    });

    routes.registerRoutes(app, mockAuthService);

    assertTrue(app.routes.length > 0, 'Should register routes');
    assertTrue(app.routes.length >= 20, 'Should register at least 20 routes');
  });

  runner.test('should register journey management endpoints', async () => {
    const app = createMockApp();
    const routes = new InpatientJourneyRoutes({
      storageDir: '/tmp/test',
      journeyService: mockJourneyService,
      dailyNotesService: mockDailyNotesService,
      departmentIntegrationService: mockDepartmentService
    });

    routes.registerRoutes(app, mockAuthService);

    const journeyEndpoints = app.routes.filter(r =>
      r.path.includes('/journeys') && !r.path.includes('/notes') && !r.path.includes('/integrations')
    );

    assertTrue(journeyEndpoints.length >= 6, 'Should register journey endpoints');
    assertTrue(
      journeyEndpoints.some(r => r.method === 'GET' && r.path === '/api/journeys/:id'),
      'Should have GET /api/journeys/:id endpoint'
    );
    assertTrue(
      journeyEndpoints.some(r => r.method === 'POST' && r.path === '/api/journeys/admit'),
      'Should have POST /api/journeys/admit endpoint'
    );
  });

  runner.test('should register daily notes endpoints', async () => {
    const app = createMockApp();
    const routes = new InpatientJourneyRoutes({
      storageDir: '/tmp/test',
      journeyService: mockJourneyService,
      dailyNotesService: mockDailyNotesService,
      departmentIntegrationService: mockDepartmentService
    });

    routes.registerRoutes(app, mockAuthService);

    const notesEndpoints = app.routes.filter(r => r.path.includes('/notes'));

    assertTrue(notesEndpoints.length >= 6, 'Should register notes endpoints');
    assertTrue(
      notesEndpoints.some(r => r.method === 'GET' && r.path === '/api/journeys/:journeyId/notes'),
      'Should have GET notes endpoint'
    );
    assertTrue(
      notesEndpoints.some(r => r.method === 'POST' && r.path === '/api/journeys/:journeyId/notes'),
      'Should have POST notes endpoint'
    );
  });

  runner.test('should register department integration endpoints', async () => {
    const app = createMockApp();
    const routes = new InpatientJourneyRoutes({
      storageDir: '/tmp/test',
      journeyService: mockJourneyService,
      dailyNotesService: mockDailyNotesService,
      departmentIntegrationService: mockDepartmentService
    });

    routes.registerRoutes(app, mockAuthService);

    const integrationEndpoints = app.routes.filter(r =>
      r.path.includes('/integrations') || r.path.includes('/department-integrations')
    );

    assertTrue(integrationEndpoints.length >= 6, 'Should register integration endpoints');
  });

  runner.test('should register file upload endpoints with raw middleware', async () => {
    const app = createMockApp();
    const routes = new InpatientJourneyRoutes({
      storageDir: '/tmp/test',
      journeyService: mockJourneyService,
      dailyNotesService: mockDailyNotesService,
      departmentIntegrationService: mockDepartmentService
    });

    routes.registerRoutes(app, mockAuthService);

    const voiceEndpoint = app.routes.find(r =>
      r.method === 'POST' && r.path === '/api/journeys/:journeyId/notes/:noteId/voice'
    );

    assertNotNull(voiceEndpoint, 'Should register voice upload endpoint');
    assertTrue(
      voiceEndpoint.handlers.length > 1,
      'Voice endpoint should have multiple handlers (middleware + route handler)'
    );
  });

  runner.test('should register statistics endpoints', async () => {
    const app = createMockApp();
    const routes = new InpatientJourneyRoutes({
      storageDir: '/tmp/test',
      journeyService: mockJourneyService,
      dailyNotesService: mockDailyNotesService,
      departmentIntegrationService: mockDepartmentService
    });

    routes.registerRoutes(app, mockAuthService);

    const statsEndpoints = app.routes.filter(r => r.path.includes('/stats'));

    assertTrue(statsEndpoints.length >= 2, 'Should register statistics endpoints');
    assertTrue(
      statsEndpoints.some(r => r.method === 'GET' && r.path === '/api/journeys/stats/overview'),
      'Should have overview statistics endpoint'
    );
  });

  runner.test('routes should have proper HTTP methods', async () => {
    const app = createMockApp();
    const routes = new InpatientJourneyRoutes({
      storageDir: '/tmp/test',
      journeyService: mockJourneyService,
      dailyNotesService: mockDailyNotesService,
      departmentIntegrationService: mockDepartmentService
    });

    routes.registerRoutes(app, mockAuthService);

    const methods = app.routes.map(r => r.method);
    assertTrue(methods.includes('GET'), 'Should have GET methods');
    assertTrue(methods.includes('POST'), 'Should have POST methods');
    assertTrue(methods.includes('PUT'), 'Should have PUT methods');
  });

  runner.test('routes should follow RESTful conventions', async () => {
    const app = createMockApp();
    const routes = new InpatientJourneyRoutes({
      storageDir: '/tmp/test',
      journeyService: mockJourneyService,
      dailyNotesService: mockDailyNotesService,
      departmentIntegrationService: mockDepartmentService
    });

    routes.registerRoutes(app, mockAuthService);

    // Check for RESTful patterns
    assertTrue(
      app.routes.some(r => r.method === 'GET' && r.path.includes('/:id')),
      'Should have GET by ID pattern'
    );
    assertTrue(
      app.routes.some(r => r.method === 'POST' && r.path.includes('/admit')),
      'Should have POST for create action pattern'
    );
    assertTrue(
      app.routes.some(r => r.method === 'PUT' && r.path.includes('/:id')),
      'Should have PUT for update pattern'
    );
  });

  runner.test('routes should have consistent path structure', async () => {
    const app = createMockApp();
    const routes = new InpatientJourneyRoutes({
      storageDir: '/tmp/test',
      journeyService: mockJourneyService,
      dailyNotesService: mockDailyNotesService,
      departmentIntegrationService: mockDepartmentService
    });

    routes.registerRoutes(app, mockAuthService);

    // All routes should start with /api/
    const allRoutesStartWithApi = app.routes.every(r => r.path.startsWith('/api/'));
    assertTrue(allRoutesStartWithApi, 'All routes should start with /api/');

    // Journey routes should be under /api/journeys
    const journeyRoutes = app.routes.filter(r => r.path.includes('/journeys'));
    assertTrue(journeyRoutes.length > 0, 'Should have journey routes');
  });

  // Run all tests
  await runner.run();
}

// Execute tests if run directly
if (require.main === module) {
  runRouteRegistrationTests().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = { runRouteRegistrationTests };