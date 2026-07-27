/**
 * Repository Integration Test
 *
 * Practical integration test to verify the repository implementations
 * Tests actual database operations and validates functionality
 */

const { InpatientJourneysRepository } = require('../inpatient_journeys_repository.cjs');
const { DailyNotesRepository } = require('../daily_notes_repository.cjs');
const { DepartmentIntegrationsRepository } = require('../department_integrations_repository.cjs');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logSection(message) {
  log(`\n${colors.bold}${colors.blue}=== ${message} ===${colors.reset}`, 'blue');
}

// Test result tracking
const testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

async function runTest(testName, testFn) {
  try {
    log(`\nRunning: ${testName}...`, 'yellow');
    await testFn();
    testResults.passed++;
    logSuccess(`${testName} - PASSED`);
  } catch (error) {
    testResults.failed++;
    testResults.errors.push({ test: testName, error: error.message });
    logError(`${testName} - FAILED: ${error.message}`);
  }
}

// Cleanup function to remove test data
async function cleanupTestData(repository, journeyId, noteIds = [], integrationIds = []) {
  try {
    // Clean up department integrations
    for (const integrationId of integrationIds) {
      await repository.deleteIntegration(integrationId);
    }

    // Clean up daily notes
    for (const noteId of noteIds) {
      await repository.deleteNote(noteId, 'test-cleanup');
    }

    // Clean up journey
    if (journeyId) {
      await repository.deleteJourney(journeyId, 'test-cleanup');
    }
  } catch (error) {
    log(`Cleanup warning: ${error.message}`, 'yellow');
  }
}

async function runIntegrationTests() {
  logSection('INPATIENT JOURNEY REPOSITORY INTEGRATION TESTS');

  let journeyRepo, notesRepo, integrationRepo;
  let testJourneyId, testNoteId, testIntegrationId;
  const createdIds = { notes: [], integrations: [] };

  try {
    // Initialize repositories
    log('\nInitializing repositories...', 'yellow');
    journeyRepo = new InpatientJourneysRepository();
    notesRepo = new DailyNotesRepository();
    integrationRepo = new DepartmentIntegrationsRepository();

    await journeyRepo.initialize();
    await notesRepo.initialize();
    await integrationRepo.initialize();
    logSuccess('Repositories initialized successfully');

    // Test 1: Health Check
    await runTest('Repository Health Check', async () => {
      const health = await journeyRepo.healthCheck();
      if (health.status !== 'healthy') {
        throw new Error('Health check failed');
      }
    });

    // Test 2: Create Journey
    await runTest('Create Inpatient Journey', async () => {
      const journeyData = {
        encounter_id: `test-encounter-${Date.now()}`,
        patient_id: `test-patient-${Date.now()}`,
        status: 'admitted',
        admission_type: 'emergency',
        admission_reason: 'Test admission for integration testing',
        attending_physician_id: 'test-physician-1',
        current_location_id: 'test-location-1',
        current_ward: 'ICU',
        current_bed: 'Bed-1',
        journey_metadata_jsonb: { test: true, integration_test: true }
      };

      const journey = await journeyRepo.createJourney(journeyData);

      if (!journey || !journey.id) {
        throw new Error('Failed to create journey');
      }

      testJourneyId = journey.id;
      log(`  Created journey: ${journey.id}`, 'blue');
    });

    // Test 3: Find Journey by ID
    await runTest('Find Journey by ID', async () => {
      const journey = await journeyRepo.findJourneyById(testJourneyId);

      if (!journey || journey.id !== testJourneyId) {
        throw new Error('Failed to find journey');
      }

      if (journey.status !== 'admitted') {
        throw new Error('Journey status incorrect');
      }
    });

    // Test 4: Find Journeys by Patient
    await runTest('Find Journeys by Patient', async () => {
      const journeys = await journeyRepo.findJourneysByPatient(testJourneyId.split('-')[2]);

      if (!Array.isArray(journeys)) {
        throw new Error('Result should be an array');
      }
    });

    // Test 5: Update Journey
    await runTest('Update Journey', async () => {
      const updateData = {
        current_ward: 'General Ward',
        current_bed: 'Bed-5',
        journey_metadata_jsonb: { updated: true }
      };

      const updatedJourney = await journeyRepo.updateJourney(testJourneyId, updateData);

      if (!updatedJourney || updatedJourney.current_ward !== 'General Ward') {
        throw new Error('Failed to update journey');
      }
    });

    // Test 6: Create Daily Note
    await runTest('Create Daily Note', async () => {
      const noteData = {
        journey_id: testJourneyId,
        encounter_id: `test-encounter-${Date.now()}`,
        patient_id: `test-patient-${Date.now()}`,
        note_type: 'progress',
        note_day_sequence: 1,
        source: 'manual',
        status: 'draft',
        note_date: new Date().toISOString().split('T')[0],
        note_time: '10:30:00',
        subjective_notes: 'Patient is feeling better today - integration test',
        objective_notes_jsonb: {
          vitals: { bp: '120/80', temp: '98.6F', pulse: '72' },
          physical_exam: 'No acute distress'
        },
        assessment: 'Patient improving',
        plan: 'Continue current treatment',
        created_by_user_id: 'test-user-1'
      };

      const note = await notesRepo.createDailyNote(noteData);

      if (!note || !note.id) {
        throw new Error('Failed to create daily note');
      }

      testNoteId = note.id;
      createdIds.notes.push(note.id);
      log(`  Created note: ${note.id}`, 'blue');
    });

    // Test 7: Find Notes by Journey
    await runTest('Find Notes by Journey', async () => {
      const notes = await notesRepo.findNotesByJourney(testJourneyId);

      if (!Array.isArray(notes) || notes.length === 0) {
        throw new Error('Failed to find notes for journey');
      }
    });

    // Test 8: Update Daily Note
    await runTest('Update Daily Note', async () => {
      const updateData = {
        subjective_notes: 'Updated subjective notes - integration test',
        assessment: 'Updated assessment'
      };

      const updatedNote = await notesRepo.updateNote(testNoteId, updateData);

      if (!updatedNote || updatedNote.subjective_notes.indexOf('Updated') !== 0) {
        throw new Error('Failed to update note');
      }
    });

    // Test 9: Voice Session Integration
    await runTest('Link Voice Session to Note', async () => {
      const linkedNote = await notesRepo.linkVoiceSession(
        testNoteId,
        `test-voice-session-${Date.now()}`,
        `test-transcript-${Date.now()}`
      );

      if (!linkedNote || !linkedNote.voice_session_id) {
        throw new Error('Failed to link voice session');
      }
    });

    // Test 10: Create Department Integration
    await runTest('Create Department Integration', async () => {
      const integrationData = {
        journey_id: testJourneyId,
        daily_note_id: testNoteId,
        encounter_id: `test-encounter-${Date.now()}`,
        patient_id: `test-patient-${Date.now()}`,
        integration_type: 'lab',
        direction: 'outbound',
        external_order_id: `ext-lab-${Date.now()}`,
        order_payload_jsonb: { test: 'lab order', priority: 'routine' },
        status: 'pending'
      };

      const integration = await integrationRepo.createIntegration(integrationData);

      if (!integration || !integration.id) {
        throw new Error('Failed to create integration');
      }

      testIntegrationId = integration.id;
      createdIds.integrations.push(integration.id);
      log(`  Created integration: ${integration.id}`, 'blue');
    });

    // Test 11: Find Integrations by Journey
    await runTest('Find Integrations by Journey', async () => {
      const integrations = await integrationRepo.findIntegrationsByJourney(testJourneyId);

      if (!Array.isArray(integrations) || integrations.length === 0) {
        throw new Error('Failed to find integrations for journey');
      }
    });

    // Test 12: Update Integration Status
    await runTest('Update Integration Status', async () => {
      const updatedIntegration = await integrationRepo.updateIntegrationStatus(
        testIntegrationId,
        'completed',
        {
          completed_at: new Date().toISOString(),
          result_payload_jsonb: { result: 'lab results', status: 'normal' }
        }
      );

      if (!updatedIntegration || updatedIntegration.status !== 'completed') {
        throw new Error('Failed to update integration status');
      }
    });

    // Test 13: Journey Timeline
    await runTest('Get Journey Timeline', async () => {
      const timeline = await journeyRepo.getJourneyTimeline(testJourneyId);

      if (!timeline || !timeline.journey || !timeline.timeline) {
        throw new Error('Failed to get journey timeline');
      }

      if (!timeline.timeline.daily_notes || !timeline.timeline.department_integrations) {
        throw new Error('Timeline missing expected data');
      }
    });

    // Test 14: Journey Statistics
    await runTest('Get Journey Statistics', async () => {
      const stats = await journeyRepo.getJourneyStats();

      if (!stats || typeof stats.total_journeys !== 'number') {
        throw new Error('Failed to get journey statistics');
      }
    });

    // Test 15: Daily Notes Statistics
    await runTest('Get Daily Notes Statistics', async () => {
      const stats = await notesRepo.getDailyNotesStats({
        journey_id: testJourneyId
      });

      if (!stats || typeof stats.total_notes !== 'number') {
        throw new Error('Failed to get daily notes statistics');
      }
    });

    // Test 16: Department Integration Statistics
    await runTest('Get Integration Statistics', async () => {
      const stats = await integrationRepo.getIntegrationStats({
        journey_id: testJourneyId
      });

      if (!stats || typeof stats.total_integrations !== 'number') {
        throw new Error('Failed to get integration statistics');
      }
    });

    // Test 17: Update Note Status (Review Workflow)
    await runTest('Update Note Status (Review Workflow)', async () => {
      const reviewData = {
        reviewed_by_user_id: 'test-reviewer-1',
        reviewed_at: new Date().toISOString(),
        review_notes_jsonb: [{ comment: 'Integration test review' }]
      };

      const updatedNote = await notesRepo.updateNoteStatus(testNoteId, 'approved', reviewData);

      if (!updatedNote || updatedNote.status !== 'approved') {
        throw new Error('Failed to update note status');
      }
    });

    // Test 18: Find Active Journeys by Location
    await runTest('Find Active Journeys by Location', async () => {
      // First update our test journey back to admitted status
      await journeyRepo.updateJourneyStatus(testJourneyId, 'admitted', {});

      const journeys = await journeyRepo.findActiveJourneysByLocation('test-location-1', 'ICU');

      if (!Array.isArray(journeys)) {
        throw new Error('Result should be an array');
      }
    });

    // Test 19: Error Handling - Invalid Journey ID
    await runTest('Error Handling - Invalid Journey ID', async () => {
      const journey = await journeyRepo.findJourneyById('invalid-id-that-does-not-exist');

      if (journey !== null) {
        throw new Error('Should return null for invalid ID');
      }
    });

    // Test 20: Transaction Support - Create Journey with Initial Note
    await runTest('Transaction Support - Create Journey with Initial Note', async () => {
      const journeyData = {
        encounter_id: `test-encounter-transaction-${Date.now()}`,
        patient_id: `test-patient-transaction-${Date.now()}`,
        status: 'admitted',
        admission_type: 'routine',
        admission_reason: 'Transaction test admission'
      };

      const noteData = {
        note_type: 'admission',
        note_date: new Date().toISOString().split('T')[0],
        subjective_notes: 'Admission note for transaction test',
        assessment: 'Initial assessment',
        plan: 'Treatment plan',
        created_by_user_id: 'test-user-1'
      };

      const result = await journeyRepo.createJourneyWithInitialNote(journeyData, noteData);

      if (!result || !result.journey || !result.initial_note) {
        throw new Error('Transaction failed');
      }

      if (result.initial_note.journey_id !== result.journey.id) {
        throw new Error('Note not linked to journey correctly');
      }

      // Clean up the transaction test journey
      await journeyRepo.deleteJourney(result.journey.id, 'test-cleanup');
      log(`  Cleaned up transaction test journey: ${result.journey.id}`, 'blue');
    });

  } catch (error) {
    logError(`FATAL ERROR: ${error.message}`);
    testResults.failed++;
    testResults.errors.push({ test: 'Test Suite', error: error.message });
  } finally {
    // Clean up test data
    logSection('CLEANUP');
    log('Cleaning up test data...', 'yellow');

    try {
      if (journeyRepo && testJourneyId) {
        await cleanupTestData({
          deleteJourney: journeyRepo.deleteJourney.bind(journeyRepo),
          deleteNote: notesRepo?.deleteNote.bind(notesRepo),
          deleteIntegration: integrationRepo?.deleteIntegration.bind(integrationRepo)
        }, testJourneyId, createdIds.notes, createdIds.integrations);
        logSuccess('Test data cleaned up successfully');
      }
    } catch (cleanupError) {
      logError(`Cleanup failed: ${cleanupError.message}`);
    }

    // Close repository connections
    try {
      if (journeyRepo) await journeyRepo.close();
      if (notesRepo) await notesRepo.close();
      if (integrationRepo) await integrationRepo.close();
      logSuccess('Repository connections closed');
    } catch (closeError) {
      logError(`Failed to close connections: ${closeError.message}`);
    }
  }

  // Print test results summary
  logSection('TEST RESULTS SUMMARY');

  const totalTests = testResults.passed + testResults.failed;
  const passRate = ((testResults.passed / totalTests) * 100).toFixed(1);

  console.log(`
┌─────────────────────────────────────────┐
│         INTEGRATION TEST RESULTS         │
├─────────────────────────────────────────┤
│ Total Tests:    ${totalTests.toString().padStart(25)} │
│ Passed:         ${testResults.passed.toString().padStart(25)} │
│ Failed:         ${testResults.failed.toString().padStart(25)} │
│ Pass Rate:      ${passRate.toString().padStart(25)}% │
└─────────────────────────────────────────┘
  `);

  if (testResults.errors.length > 0) {
    log('\nFailed Tests Details:', 'red');
    testResults.errors.forEach(({ test, error }) => {
      log(`  • ${test}: ${error}`, 'red');
    });
  }

  if (testResults.failed === 0) {
    log('\n🎉 ALL TESTS PASSED! Repository implementation is working correctly.', 'green');
  } else {
    log('\n⚠️  Some tests failed. Please review the errors above.', 'yellow');
  }

  return testResults.failed === 0;
}

// Run the tests
runIntegrationTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    logError(`Test suite crashed: ${error.message}`);
    console.error(error);
    process.exit(1);
  });