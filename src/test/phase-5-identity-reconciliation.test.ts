/**
 * Phase 5: Identity Reconciliation Tests
 *
 * Comprehensive tests for identity reconciliation functionality:
 * - Normalization
 * - Exact-match resolution
 * - Ambiguity handling
 * - Merge behavior
 * - Foreign-key repointing
 * - Case creation
 * - Idempotency
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the postgres client
const mockPostgresClient = {
  connect: vi.fn(),
  close: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn()
};

// Import service and repositories
const { IdentityReconciliationService } = require('../../server/identity_reconciliation_service.cjs');
const { MasterDataRepository } = require('../../server/repositories/master_data_repository.cjs');
const { InteropRepository } = require('../../server/repositories/interop_repository.cjs');

describe('Phase 5: Identity Reconciliation Service', () => {
  let service: any;
  let masterDataRepo: any;
  let interopRepo: any;

  beforeEach(() => {
    vi.resetAllMocks();

    // Create instances
    masterDataRepo = new MasterDataRepository(mockPostgresClient);
    interopRepo = new InteropRepository(mockPostgresClient);
    service = new IdentityReconciliationService(mockPostgresClient);
  });

  afterEach(() => {
    // Clean up
  });

  // ========================================
  // Normalization Tests
  // ========================================

  describe('Normalization', () => {
    it('should normalize identifier value by trimming whitespace', () => {
      const result = service.normalizeIdentifierValue('  MRN12345  ');
      expect(result).toBe('mrn12345');
    });

    it('should normalize identifier value by converting to lowercase', () => {
      const result = service.normalizeIdentifierValue('MRN12345');
      expect(result).toBe('mrn12345');
    });

    it('should normalize identifier value by collapsing repeated spaces', () => {
      const result = service.normalizeIdentifierValue('MRN   12345');
      expect(result).toBe('mrn 12345');
    });

    it('should handle empty values', () => {
      const result = service.normalizeIdentifierValue('');
      expect(result).toBe('');
    });

    it('should handle null values', () => {
      const result = service.normalizeIdentifierValue(null as any);
      expect(result).toBe('');
    });

    it('should identify deterministic patient identifier systems', () => {
      expect(service.isDeterministicPatientSystem('mrn')).toBe(true);
      expect(service.isDeterministicPatientSystem('hospital_no')).toBe(true);
      expect(service.isDeterministicPatientSystem('hospital_number')).toBe(true);
      expect(service.isDeterministicPatientSystem('name')).toBe(false);
      expect(service.isDeterministicPatientSystem('label')).toBe(false);
    });

    it('should identify deterministic encounter identifier systems', () => {
      expect(service.isDeterministicEncounterSystem('episode_number')).toBe(true);
      expect(service.isDeterministicEncounterSystem('ipd_number')).toBe(true);
      expect(service.isDeterministicEncounterSystem('opd_number')).toBe(true);
      expect(service.isDeterministicEncounterSystem('encounter_label')).toBe(false);
    });
  });

  // ========================================
  // Exact-Match Resolution Tests
  // ========================================

  describe('Exact-Match Resolution', () => {
    it('should promote patient to reconciled when no matches exist', async () => {
      const mockPatient = {
        id: 'patient-1',
        identity_state: 'provisional',
        created_at: new Date().toISOString()
      };

      mockPostgresClient.queryOne.mockResolvedValue(mockPatient);
      mockPostgresClient.query.mockResolvedValue([]);

      const result = await service.reconcilePatient('patient-1', { dryRun: false });

      expect(result.action).toBe('reconciled');
      expect(result.patient_id).toBe('patient-1');
    });

    it('should promote encounter to reconciled when no matches exist', async () => {
      const mockEncounter = {
        id: 'encounter-1',
        identity_state: 'provisional',
        created_at: new Date().toISOString()
      };

      mockPostgresClient.queryOne.mockResolvedValue(mockEncounter);
      mockPostgresClient.query.mockResolvedValue([]);

      const result = await service.reconcileEncounter('encounter-1', { dryRun: false });

      expect(result.action).toBe('reconciled');
      expect(result.encounter_id).toBe('encounter-1');
    });

    it('should find exact matches by normalized identifier value', async () => {
      const mockIdentifiers = [
        { identifier_system: 'mrn', identifier_value: 'MRN12345', status: 'observed' }
      ];

      mockPostgresClient.query.mockResolvedValue(mockIdentifiers);

      const matches = await service.findPatientCandidateMatches('patient-1', mockIdentifiers);

      expect(matches).toBeDefined();
      expect(Array.isArray(matches)).toBe(true);
    });
  });

  // ========================================
  // Ambiguity Handling Tests
  // ========================================

  describe('Ambiguity Handling', () => {
    it('should create reconciliation case for multiple patient candidates', async () => {
      const mockCandidates = [
        { id: 'patient-1', identity_state: 'provisional', display_name: 'Patient 1' },
        { id: 'patient-2', identity_state: 'provisional', display_name: 'Patient 2' },
        { id: 'patient-3', identity_state: 'provisional', display_name: 'Patient 3' }
      ];

      mockPostgresClient.query.mockResolvedValue([]);
      // Mock the transaction to execute callback and return case result
      mockPostgresClient.transaction.mockImplementation(async (callback) => {
        mockPostgresClient.query.mockImplementationOnce(async () => ({
          rows: [{ id: 'case-1', entity_type: 'patient', case_status: 'open' }]
        }));
        return await callback(mockPostgresClient);
      });

      const result = await service.createPatientReconciliationCase(
        mockCandidates,
        'multiple_patient_candidates'
      );

      expect(result.action).toBe('case_created');
      expect(result.reason_code).toBe('multiple_patient_candidates');
      expect(result.candidates_affected).toBe(3);
    });

    it('should create reconciliation case for multiple encounter candidates', async () => {
      const mockCandidates = [
        { id: 'encounter-1', identity_state: 'provisional', patient_id: 'patient-1' },
        { id: 'encounter-2', identity_state: 'provisional', patient_id: 'patient-2' }
      ];

      mockPostgresClient.query.mockResolvedValue([]);
      // Mock the transaction to execute callback and return case result
      mockPostgresClient.transaction.mockImplementation(async (callback) => {
        mockPostgresClient.query.mockImplementationOnce(async () => ({
          rows: [{ id: 'case-2', entity_type: 'encounter', case_status: 'open' }]
        }));
        return await callback(mockPostgresClient);
      });

      const result = await service.createEncounterReconciliationCase(
        mockCandidates,
        'multiple_encounter_candidates'
      );

      expect(result.action).toBe('case_created');
      expect(result.reason_code).toBe('multiple_encounter_candidates');
    });

    it('should create case for patient-encounter mismatch', async () => {
      const mockEncounters = [
        { id: 'encounter-1', identity_state: 'provisional', patient_id: 'patient-1' },
        { id: 'encounter-2', identity_state: 'provisional', patient_id: 'patient-2' }
      ];

      mockPostgresClient.query.mockResolvedValue([]);
      // Mock the transaction to execute callback and return case result
      mockPostgresClient.transaction.mockImplementation(async (callback) => {
        mockPostgresClient.query.mockImplementationOnce(async () => ({
          rows: [{ id: 'case-3', entity_type: 'encounter', case_status: 'open' }]
        }));
        return await callback(mockPostgresClient);
      });

      const result = await service.createEncounterReconciliationCase(
        mockEncounters,
        'patient_encounter_mismatch'
      );

      expect(result.action).toBe('case_created');
      expect(result.reason_code).toBe('patient_encounter_mismatch');
    });

    it('should skip reconciliation when entity already under review', async () => {
      const mockPatient = { id: 'patient-1', identity_state: 'conflicted' };
      const mockOpenCases = [{ id: 'case-1', case_status: 'open' }];

      mockPostgresClient.queryOne.mockResolvedValueOnce(mockPatient);
      mockPostgresClient.query.mockResolvedValueOnce(mockOpenCases);

      const result = await service.reconcilePatient('patient-1', { dryRun: false });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('already_in_review');
    });

    it('should determine winner priority correctly', async () => {
      const mockPatient1 = { id: 'patient-1', identity_state: 'reconciled', created_at: '2024-01-01' };
      const mockPatient2 = { id: 'patient-2', identity_state: 'provisional', created_at: '2024-01-02' };

      mockPostgresClient.queryOne
        .mockResolvedValueOnce(mockPatient1)
        .mockResolvedValueOnce(mockPatient2);
      mockPostgresClient.query.mockResolvedValue([]);

      const decision = await service.determinePatientMergeWinner('patient-1', 'patient-2');

      expect(decision.shouldMerge).toBe(true);
      expect(decision.winner_id).toBe('patient-1');
      expect(decision.loser_id).toBe('patient-2');
    });

    it('should detect ambiguous priority tie', async () => {
      const mockPatient1 = { id: 'patient-1', identity_state: 'provisional', created_at: '2024-01-01' };
      const mockPatient2 = { id: 'patient-2', identity_state: 'provisional', created_at: '2024-01-01' };

      mockPostgresClient.queryOne
        .mockResolvedValueOnce(mockPatient1)
        .mockResolvedValueOnce(mockPatient2)
        .mockResolvedValue({ count: '0' });
      mockPostgresClient.query.mockResolvedValue([]);

      const decision = await service.determinePatientMergeWinner('patient-1', 'patient-2');

      expect(decision.shouldMerge).toBe(false);
      expect(decision.ambiguity_reason).toBe('priority_tie');
    });
  });

  // ========================================
  // Merge Behavior Tests
  // ========================================

  describe('Merge Behavior', () => {
    it('should execute patient merge correctly', async () => {
      const mockWinner = { id: 'patient-1', identity_state: 'provisional' };
      const mockLoser = { id: 'patient-2', identity_state: 'provisional' };
      const mockMergedResult = {
        winner: { id: 'patient-1', identity_state: 'reconciled' },
        loser: { id: 'patient-2', identity_state: 'inactive' },
        merged_at: new Date().toISOString()
      };

      mockPostgresClient.queryOne.mockResolvedValueOnce(mockWinner)
                                   .mockResolvedValueOnce(mockLoser)
                                   .mockResolvedValue(mockMergedResult);
      mockPostgresClient.query.mockResolvedValue([]);
      mockPostgresClient.transaction.mockImplementation(async (callback) => {
        return await callback(mockPostgresClient);
      });

      const result = await service.executePatientMerge('patient-1', 'patient-2', { dryRun: false });

      expect(result.action).toBe('merged');
      expect(result.winner_id).toBe('patient-1');
      expect(result.loser_id).toBe('patient-2');
      expect(result.merged_at).toBeDefined();
    });

    it('should execute encounter merge correctly', async () => {
      const mockWinner = { id: 'encounter-1', identity_state: 'provisional' };
      const mockLoser = { id: 'encounter-2', identity_state: 'provisional' };
      const mockMergedResult = {
        winner: { id: 'encounter-1', identity_state: 'reconciled' },
        loser: { id: 'encounter-2', identity_state: 'inactive' },
        merged_at: new Date().toISOString()
      };

      mockPostgresClient.queryOne.mockResolvedValueOnce(mockWinner)
                                   .mockResolvedValueOnce(mockLoser)
                                   .mockResolvedValue(mockMergedResult);
      mockPostgresClient.query.mockResolvedValue([]);
      mockPostgresClient.transaction.mockImplementation(async (callback) => {
        return await callback(mockPostgresClient);
      });

      const result = await service.executeEncounterMerge('encounter-1', 'encounter-2', { dryRun: false });

      expect(result.action).toBe('merged');
      expect(result.winner_id).toBe('encounter-1');
      expect(result.loser_id).toBe('encounter-2');
    });

    it('should verify patient compatibility before encounter merge', async () => {
      const mockEncounter1 = { id: 'encounter-1', patient_id: 'patient-1' };
      const mockEncounter2 = { id: 'encounter-2', patient_id: 'patient-1' };
      const mockPatient = { id: 'patient-1', identity_state: 'reconciled' };

      mockPostgresClient.queryOne.mockResolvedValue(mockEncounter1)
                                   .mockResolvedValue(mockEncounter2)
                                   .mockResolvedValue(mockPatient);

      const result = await service.verifyPatientCompatibility('encounter-1', 'encounter-2');

      expect(result.compatible).toBe(true);
    });

    it('should detect patient incompatibility for encounter merge', async () => {
      const mockEncounter1 = { id: 'encounter-1', patient_id: 'patient-1' };
      const mockEncounter2 = { id: 'encounter-2', patient_id: 'patient-2' };
      const mockPatient1 = { id: 'patient-1', identity_state: 'reconciled' };
      const mockPatient2 = { id: 'patient-2', identity_state: 'reconciled' };

      mockPostgresClient.queryOne.mockResolvedValueOnce(mockEncounter1)
                                   .mockResolvedValueOnce(mockEncounter2)
                                   .mockResolvedValueOnce(mockPatient1)
                                   .mockResolvedValueOnce(mockPatient2);

      const result = await service.verifyPatientCompatibility('encounter-1', 'encounter-2');

      expect(result.compatible).toBe(false);
      expect(result.reason).toBe('patient_encounter_mismatch');
    });
  });

  // ========================================
  // Foreign-Key Repointing Tests
  // ========================================

  describe('Foreign-Key Repointing', () => {
    it('should count references for patient correctly', async () => {
      const mockCounts = {
        encounters: 2,
        documents: 5,
        live_conversation_sessions: 3,
        interop_messages: 1,
        total: 11
      };

      mockPostgresClient.queryOne.mockResolvedValueOnce({ count: '2' })
                                   .mockResolvedValueOnce({ count: '5' })
                                   .mockResolvedValueOnce({ count: '3' })
                                   .mockResolvedValueOnce({ count: '1' });

      const result = await masterDataRepo.countReferencesForPatient('patient-1');

      expect(result.encounters).toBe(2);
      expect(result.documents).toBe(5);
      expect(result.live_conversation_sessions).toBe(3);
      expect(result.interop_messages).toBe(1);
      expect(result.total).toBe(11);
    });

    it('should count references for encounter correctly', async () => {
      const mockCounts = {
        documents: 3,
        live_conversation_sessions: 2,
        interop_messages: 1,
        total: 6
      };

      mockPostgresClient.queryOne.mockResolvedValueOnce({ count: '3' })
                                   .mockResolvedValueOnce({ count: '2' })
                                   .mockResolvedValueOnce({ count: '1' });

      const result = await masterDataRepo.countReferencesForEncounter('encounter-1');

      expect(result.documents).toBe(3);
      expect(result.live_conversation_sessions).toBe(2);
      expect(result.interop_messages).toBe(1);
      expect(result.total).toBe(6);
    });
  });

  // ========================================
  // Case Creation Tests
  // ========================================

  describe('Case Creation', () => {
    it('should create patient reconciliation case with valid data', async () => {
      const mockCase = {
        id: 'case-1',
        entity_type: 'patient',
        reason_code: 'multiple_patient_candidates',
        case_status: 'open',
        priority: 'medium'
      };

      // Set up fresh mock - using mockImplementationOnce to ensure it returns the correct value
      mockPostgresClient.queryOne.mockImplementationOnce(async () => mockCase);
      mockPostgresClient.query.mockResolvedValue([]);

      const result = await masterDataRepo.createReconciliationCase({
        entity_type: 'patient',
        candidate_patient_id: 'patient-1',
        reason_code: 'multiple_patient_candidates',
        case_status: 'open',
        observed_identifiers: {},
        candidate_matches: {}
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('case-1');
    });

    it('should create encounter reconciliation case with valid data', async () => {
      const mockCase = {
        id: 'case-2',
        entity_type: 'encounter',
        reason_code: 'multiple_encounter_candidates',
        case_status: 'open',
        priority: 'medium'
      };

      // Clear previous mocks and set up fresh mock
      mockPostgresClient.queryOne.mockClear().mockResolvedValue(mockCase);
      mockPostgresClient.query.mockResolvedValue([]);

      const result = await masterDataRepo.createReconciliationCase({
        entity_type: 'encounter',
        candidate_encounter_id: 'encounter-1',
        reason_code: 'multiple_encounter_candidates',
        case_status: 'open',
        observed_identifiers: {},
        candidate_matches: {}
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('case-2');
    });

    it('should determine case priority correctly', () => {
      const highPriority = service.determineCasePriority('patient_encounter_mismatch');
      expect(highPriority).toBe('high');

      const lowPriority = service.determineCasePriority('manual_review_required');
      expect(lowPriority).toBe('low');

      const mediumPriority = service.determineCasePriority('multiple_patient_candidates');
      expect(mediumPriority).toBe('medium');
    });

    it('should find reconciliation cases by entity', async () => {
      const mockCases = [
        { id: 'case-1', entity_type: 'patient', case_status: 'open' }
      ];

      mockPostgresClient.query.mockResolvedValue(mockCases);

      const result = await masterDataRepo.findReconciliationCasesByEntity('patient', 'patient-1');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
    });

    it('should update reconciliation case status', async () => {
      const mockUpdatedCase = {
        id: 'case-1',
        case_status: 'resolved',
        resolution_jsonb: { action: 'merged' }
      };

      mockPostgresClient.queryOne.mockResolvedValue(mockUpdatedCase);

      const result = await masterDataRepo.updateReconciliationCaseStatus('case-1', 'resolved', {
        action: 'merged'
      });

      expect(result).toBeDefined();
      expect(result.case_status).toBe('resolved');
    });

    it('should assign reconciliation case to user', async () => {
      const mockAssignedCase = {
        id: 'case-1',
        assigned_to_user_id: 'user-1',
        case_status: 'in_review'
      };

      mockPostgresClient.queryOne.mockResolvedValue(mockAssignedCase);

      const result = await masterDataRepo.assignReconciliationCase('case-1', 'user-1');

      expect(result).toBeDefined();
      expect(result.assigned_to_user_id).toBe('user-1');
      expect(result.case_status).toBe('in_review');
    });
  });

  // ========================================
  // Idempotency Tests
  // ========================================

  describe('Idempotency', () => {
    it('should skip already reconciled patients', async () => {
      const mockPatient = { id: 'patient-1', identity_state: 'reconciled' };

      mockPostgresClient.queryOne.mockImplementationOnce(async () => mockPatient);
      mockPostgresClient.query.mockResolvedValue([]);

      const result = await service.reconcilePatient('patient-1', { dryRun: false });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('already_reconciled');
    });

    it('should skip already reconciled encounters', async () => {
      const mockEncounter = { id: 'encounter-1', identity_state: 'reconciled' };

      mockPostgresClient.queryOne.mockResolvedValue(mockEncounter);

      const result = await service.reconcileEncounter('encounter-1', { dryRun: false });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('already_reconciled');
    });

    it('should skip already inactive patients', async () => {
      const mockPatient = { id: 'patient-1', identity_state: 'inactive' };

      mockPostgresClient.queryOne.mockResolvedValue(mockPatient);

      const result = await service.reconcilePatient('patient-1', { dryRun: false });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('already_inactive');
    });

    it('should keep patient provisional without deterministic identifiers', async () => {
      const mockPatient = { id: 'patient-1', identity_state: 'provisional' };
      const mockIdentifiers = [
        { identifier_system: 'name', identifier_value: 'John Doe', status: 'observed' }
      ];

      // Set up mocks with specific implementation
      mockPostgresClient.queryOne.mockImplementationOnce(async () => mockPatient);
      mockPostgresClient.query.mockImplementationOnce(async () => [])
                             .mockImplementationOnce(async () => mockIdentifiers);

      const result = await service.reconcilePatient('patient-1', { dryRun: false });

      expect(result.action).toBe('kept_provisional');
      expect(result.reason).toBe('no_deterministic_identifiers');
    });
  });

  // ========================================
  // Report Generation Tests
  // ========================================

  describe('Report Generation', () => {
    it('should generate reconciliation report', () => {
      service.report.patients_scanned = 10;
      service.report.patient_reconciliations = 5;
      service.report.cases_created_by_reason = {
        'multiple_patient_candidates': 2,
        'patient_encounter_mismatch': 1
      };

      const report = service.getReport();

      expect(report.patients_scanned).toBe(10);
      expect(report.patient_reconciliations).toBe(5);
      expect(report.cases_created_by_reason['multiple_patient_candidates']).toBe(2);
      expect(report.generated_at).toBeDefined();
    });

    it('should reset report correctly', () => {
      service.report.patients_scanned = 100;
      service.report.patient_reconciliations = 50;

      service.resetReport();

      const report = service.getReport();
      expect(report.patients_scanned).toBe(0);
      expect(report.patient_reconciliations).toBe(0);
    });
  });

  // ========================================
  // Batch Reconciliation Tests
  // ========================================

  describe('Batch Reconciliation', () => {
    it('should run batch patient reconciliation', async () => {
      const mockPatients = [
        { id: 'patient-1', identity_state: 'provisional' },
        { id: 'patient-2', identity_state: 'provisional' }
      ];

      mockPostgresClient.queryOne.mockResolvedValue({ count: 0 });
      mockPostgresClient.query.mockResolvedValueOnce(mockPatients)
                                   .mockResolvedValue([]);

      const results = await service.runBatchPatientReconciliation({
        identityStates: ['provisional'],
        batchSize: 100,
        dryRun: true
      });

      expect(results).toBeDefined();
      expect(results.length).toBe(2);
    });

    it('should run batch encounter reconciliation', async () => {
      const mockEncounters = [
        { id: 'encounter-1', identity_state: 'provisional' },
        { id: 'encounter-2', identity_state: 'provisional' }
      ];

      mockPostgresClient.queryOne.mockResolvedValue({ count: 0 });
      mockPostgresClient.query.mockResolvedValueOnce(mockEncounters)
                                   .mockResolvedValue([]);

      const results = await service.runBatchEncounterReconciliation({
        identityStates: ['provisional'],
        batchSize: 100,
        dryRun: true
      });

      expect(results).toBeDefined();
      expect(results.length).toBe(2);
    });
  });
});

// ========================================
// Repository Tests
// ========================================

describe('Phase 5: Master Data Repository', () => {
  let repo: any;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = new MasterDataRepository(mockPostgresClient);
  });

  describe('Patient Identifier Operations', () => {
    it('should find patient identifiers by normalized value', async () => {
      const mockIdentifiers = [
        { id: 'id-1', identifier_value: 'MRN12345' }
      ];

      mockPostgresClient.query.mockResolvedValue(mockIdentifiers);

      const result = await repo.findPatientIdentifiersByNormalizedValue('mrn12345');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
    });

    it('should update patient identifier status', async () => {
      const mockIdentifier = {
        id: 'id-1',
        identifier_system: 'mrn',
        identifier_value: 'MRN12345',
        status: 'verified'
      };

      mockPostgresClient.queryOne.mockResolvedValue(mockIdentifier);

      const result = await repo.updatePatientIdentifierStatus('id-1', 'verified');

      expect(result).toBeDefined();
      expect(result.status).toBe('verified');
    });

    it('should reject invalid identifier status', async () => {
      await expect(repo.updatePatientIdentifierStatus('id-1', 'invalid'))
        .rejects.toThrow('Invalid identifier status');
    });
  });

  describe('Encounter Identifier Operations', () => {
    it('should find encounter identifiers by normalized value', async () => {
      const mockIdentifiers = [
        { id: 'id-1', identifier_value: 'EP12345' }
      ];

      mockPostgresClient.query.mockResolvedValue(mockIdentifiers);

      const result = await repo.findEncounterIdentifiersByNormalizedValue('ep12345');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
    });

    it('should update encounter identifier status', async () => {
      const mockIdentifier = {
        id: 'id-1',
        identifier_system: 'episode_number',
        identifier_value: 'EP12345',
        status: 'verified'
      };

      mockPostgresClient.queryOne.mockResolvedValue(mockIdentifier);

      const result = await repo.updateEncounterIdentifierStatus('id-1', 'verified');

      expect(result).toBeDefined();
      expect(result.status).toBe('verified');
    });
  });

  describe('Identity State Operations', () => {
    it('should list patients by identity state', async () => {
      const mockPatients = [
        { id: 'patient-1', identity_state: 'provisional' }
      ];

      mockPostgresClient.query.mockResolvedValue(mockPatients);

      const result = await repo.listPatientsByIdentityState(['provisional']);

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
    });

    it('should list encounters by identity state', async () => {
      const mockEncounters = [
        { id: 'encounter-1', identity_state: 'provisional' }
      ];

      mockPostgresClient.query.mockResolvedValue(mockEncounters);

      const result = await repo.listEncountersByIdentityState(['provisional']);

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
    });

    it('should count patients by identity state', async () => {
      mockPostgresClient.queryOne.mockResolvedValue({ count: '5' });

      const result = await repo.countPatientsByIdentityState('provisional');

      expect(result).toBe(5);
    });

    it('should count encounters by identity state', async () => {
      mockPostgresClient.queryOne.mockResolvedValue({ count: '3' });

      const result = await repo.countEncountersByIdentityState('provisional');

      expect(result).toBe(3);
    });
  });

  describe('Merge Operations', () => {
    it('should merge patients correctly', async () => {
      mockPostgresClient.queryOne
        .mockResolvedValueOnce({ id: 'patient-1', identity_state: 'provisional' })
        .mockResolvedValueOnce({ id: 'patient-2', identity_state: 'provisional' })
        .mockResolvedValueOnce({ id: 'patient-1', identity_state: 'reconciled' })
        .mockResolvedValueOnce({ id: 'patient-2', identity_state: 'inactive' });
      mockPostgresClient.query.mockResolvedValue([]);
      mockPostgresClient.transaction.mockImplementation(async (callback) => {
        return await callback(mockPostgresClient);
      });

      const result = await repo.mergePatients('patient-1', 'patient-2', {
        reason: 'test_merge'
      });

      expect(result).toBeDefined();
      expect(result.winner.id).toBe('patient-1');
      expect(result.loser.id).toBe('patient-2');
    });

    it('should merge encounters correctly', async () => {
      mockPostgresClient.queryOne
        .mockResolvedValueOnce({ id: 'encounter-1', identity_state: 'provisional' })
        .mockResolvedValueOnce({ id: 'encounter-2', identity_state: 'provisional' })
        .mockResolvedValueOnce({ id: 'encounter-1', identity_state: 'reconciled' })
        .mockResolvedValueOnce({ id: 'encounter-2', identity_state: 'inactive' });
      mockPostgresClient.query.mockResolvedValue([]);
      mockPostgresClient.transaction.mockImplementation(async (callback) => {
        return await callback(mockPostgresClient);
      });

      const result = await repo.mergeEncounters('encounter-1', 'encounter-2', {
        reason: 'test_merge'
      });

      expect(result).toBeDefined();
      expect(result.winner.id).toBe('encounter-1');
      expect(result.loser.id).toBe('encounter-2');
    });

    it('should reject merging patient with itself', async () => {
      await expect(repo.mergePatients('patient-1', 'patient-1', {}))
        .rejects.toThrow('Cannot merge patient with itself');
    });

    it('should reject merging encounter with itself', async () => {
      await expect(repo.mergeEncounters('encounter-1', 'encounter-1', {}))
        .rejects.toThrow('Cannot merge encounter with itself');
    });
  });
});

// ========================================
// Interop Repository Tests
// ========================================

describe('Phase 5: Interop Repository', () => {
  let repo: any;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = new InteropRepository(mockPostgresClient);
  });

  describe('Endpoint Trust Configuration', () => {
    it('should find endpoint trust configuration', async () => {
      const mockEndpoint = {
        id: 'endpoint-1',
        name: 'EHR Interface',
        status: 'active',
        config_jsonb: JSON.stringify({
          identity_reconciliation: {
            trusted_patient_identifier_systems: ['mrn', 'hospital_no'],
            trusted_encounter_identifier_systems: ['episode_number']
          }
        })
      };

      mockPostgresClient.queryOne.mockImplementationOnce(async () => mockEndpoint);

      const result = await repo.findEndpointTrustConfig('endpoint-1');

      expect(result).toBeDefined();
      expect(result.endpoint_id).toBe('endpoint-1');
      expect(result.trusted_patient_identifier_systems).toContain('mrn');
      expect(result.trusted_encounter_identifier_systems).toContain('episode_number');
    });

    it('should return null for non-existent endpoint', async () => {
      mockPostgresClient.queryOne.mockImplementationOnce(async () => null);

      const result = await repo.findEndpointTrustConfig('non-existent');

      expect(result).toBeNull();
    });

    it('should check if endpoint is trusted for patient system', async () => {
      const mockEndpoint = {
        id: 'endpoint-1',
        name: 'EHR Interface',
        status: 'active',
        config_jsonb: JSON.stringify({
          identity_reconciliation: {
            trusted_patient_identifier_systems: ['mrn', 'hospital_no']
          }
        })
      };

      mockPostgresClient.queryOne.mockImplementationOnce(async () => mockEndpoint);

      const result = await repo.isEndpointTrustedForPatientSystem('endpoint-1', 'mrn');

      expect(result).toBe(true);
    });

    it('should check if endpoint is not trusted for patient system', async () => {
      const mockEndpoint = {
        id: 'endpoint-1',
        name: 'EHR Interface',
        status: 'active',
        config_jsonb: JSON.stringify({
          identity_reconciliation: {
            trusted_patient_identifier_systems: ['mrn']
          }
        })
      };

      mockPostgresClient.queryOne.mockResolvedValue(mockEndpoint);

      const result = await repo.isEndpointTrustedForPatientSystem('endpoint-1', 'name');

      expect(result).toBe(false);
    });
  });

  describe('Resource Link Operations', () => {
    it('should find active resource link by external resource', async () => {
      const mockLink = {
        id: 'link-1',
        internal_entity_type: 'patient',
        internal_entity_id: 'patient-1',
        external_system: 'ehr-1',
        external_resource_type: 'Patient',
        external_resource_id: 'pat-123',
        link_status: 'active'
      };

      mockPostgresClient.queryOne.mockResolvedValue(mockLink);

      const result = await repo.findActiveResourceLink('ehr-1', 'Patient', 'pat-123');

      expect(result).toBeDefined();
      expect(result.internal_entity_id).toBe('patient-1');
      expect(result.link_status).toBe('active');
    });

    it('should find resource links by internal entity', async () => {
      const mockLinks = [
        { id: 'link-1', internal_entity_type: 'patient', internal_entity_id: 'patient-1' }
      ];

      mockPostgresClient.query.mockResolvedValue(mockLinks);

      const result = await repo.findResourceLinksByInternalEntity('patient', 'patient-1');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
    });
  });
});
