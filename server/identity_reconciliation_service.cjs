/**
 * Identity Reconciliation Service - Phase 5: Identity Reconciliation
 *
 * Single reconciliation rules engine for patient and encounter identity resolution.
 * Implements exact identifier-based reconciliation with conservative merge rules.
 *
 * Responsibilities:
 * - Normalization of identifier values
 * - Candidate matching based on exact identifiers
 * - Ambiguity detection and case creation
 * - Safe merge execution with foreign key repointing
 * - Case creation for unresolved conflicts
 * - Report assembly
 *
 * Related Tables:
 * - patients, patient_identifiers
 * - encounters, encounter_identifiers
 * - identity_reconciliation_cases
 * - documents, live_conversation_sessions, interop_messages (for foreign key repointing)
 */

const { MasterDataRepository } = require('./repositories/master_data_repository.cjs');
const { InteropRepository } = require('./repositories/interop_repository.cjs');

class IdentityReconciliationService {
  constructor(postgresClientInstance = null) {
    this.masterDataRepo = new MasterDataRepository(postgresClientInstance);
    this.interopRepo = new InteropRepository(postgresClientInstance);

    // Allowed deterministic identifier systems per Phase 5 contract
    this.deterministicPatientSystems = ['mrn', 'hospital_no', 'hospital_number'];
    this.deterministicEncounterSystems = ['episode_number', 'ipd_number', 'opd_number'];

    // Valid source modes
    this.validSourceModes = ['internal', 'external', 'merged'];

    // Valid identifier statuses
    this.validIdentifierStatuses = ['observed', 'verified', 'deprecated'];

    // Valid identity states
    this.validIdentityStates = ['provisional', 'reconciled', 'conflicted', 'inactive'];

    // Valid case reason codes
    this.validReasonCodes = [
      'multiple_patient_candidates',
      'multiple_encounter_candidates',
      'patient_encounter_mismatch',
      'trusted_identifier_conflict',
      'untrusted_external_identifier',
      'entity_already_in_review',
      'manual_review_required'
    ];

    this.report = {
      patients_scanned: 0,
      encounters_scanned: 0,
      patient_reconciliations: 0,
      encounter_reconciliations: 0,
      trusted_external_patient_identifiers_attached: 0,
      trusted_external_encounter_identifiers_attached: 0,
      patient_merges: 0,
      encounter_merges: 0,
      cases_created_by_reason: {},
      cases_resolved: 0,
      cases_deferred: 0,
      entities_skipped_in_review: 0,
      identifiers_promoted_to_verified: 0,
      identifiers_marked_deprecated: 0,
      references_repointed: {},
      errors: []
    };
  }

  /**
   * Initialize the service
   */
  async initialize() {
    await this.masterDataRepo.initialize();
    await this.interopRepo.initialize();
  }

  // ========================================
  // Normalization Methods
  // ========================================

  /**
   * Normalize identifier value for comparison
   * Phase 5: Normalize before comparing
   */
  normalizeIdentifierValue(value) {
    if (!value || typeof value !== 'string') {
      return '';
    }

    // Trim whitespace, convert to lowercase, collapse repeated spaces
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /**
   * Check if identifier system is deterministic for patients
   * Phase 5: Exact identifier matching only
   */
  isDeterministicPatientSystem(system) {
    return this.deterministicPatientSystems.includes(system);
  }

  /**
   * Check if identifier system is deterministic for encounters
   * Phase 5: Exact identifier matching only
   */
  isDeterministicEncounterSystem(system) {
    return this.deterministicEncounterSystems.includes(system);
  }

  // ========================================
  // Patient Reconciliation
  // ========================================

  /**
   * Reconcile a single patient
   * Phase 5: Patient reconciliation flow
   */
  async reconcilePatient(patientId, options = {}) {
    const { dryRun = false } = options;

    try {
      this.report.patients_scanned++;

      // 1. Fetch patient with identifiers
      const patient = await this.masterDataRepo.findById('patients', patientId);
      if (!patient) {
        throw new Error(`Patient ${patientId} not found`);
      }

      // Skip if already inactive or reconciled
      if (patient.identity_state === 'inactive') {
        return { skipped: true, reason: 'already_inactive' };
      }
      if (patient.identity_state === 'reconciled') {
        return { skipped: true, reason: 'already_reconciled' };
      }

      // 2. Check if patient is already under review
      const openCases = await this.masterDataRepo.findReconciliationCasesByEntity('patient', patientId, {
        caseStatuses: ['open', 'in_review']
      });
      if (openCases.length > 0) {
        this.report.entities_skipped_in_review++;
        return { skipped: true, reason: 'already_in_review', case_count: openCases.length };
      }

      // 3. Get patient identifiers
      const identifiers = await this.masterDataRepo.findPatientIdentifiersWithStatus(patientId);

      // 4. Filter deterministic identifiers only
      const deterministicIdentifiers = identifiers.filter(id =>
        this.isDeterministicPatientSystem(id.identifier_system)
      );

      // 5. If there are identifiers but no deterministic ones, keep provisional
      if (identifiers.length > 0 && deterministicIdentifiers.length === 0) {
        return { action: 'kept_provisional', reason: 'no_deterministic_identifiers' };
      }

      // 6. Find candidate matches by normalized identifier values (only if deterministic identifiers exist)
      let candidateMatches = [];
      if (deterministicIdentifiers.length > 0) {
        candidateMatches = await this.findPatientCandidateMatches(patientId, deterministicIdentifiers);
      }

      // 7. If no other matches, mark as reconciled if conditions met
      if (candidateMatches.length === 0) {
        return await this.promotePatientToReconciled(patientId, { dryRun });
      }

      // 8. If exactly one match, determine winner and potentially merge
      if (candidateMatches.length === 1) {
        const otherPatient = candidateMatches[0];
        const decision = await this.determinePatientMergeWinner(patientId, otherPatient.id);

        if (decision.shouldMerge) {
          return await this.executePatientMerge(decision.winner_id, decision.loser_id, { dryRun });
        } else {
          // Ambiguous - create case
          return await this.createPatientReconciliationCase([patient, otherPatient], decision.ambiguity_reason, { dryRun });
        }
      }

      // 9. Multiple candidates - create case
      return await this.createPatientReconciliationCase([patient, ...candidateMatches], 'multiple_patient_candidates', { dryRun });

    } catch (error) {
      this.report.errors.push({
        entity_type: 'patient',
        entity_id: patientId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Find patient candidate matches by identifiers
   * Phase 5: Candidate discovery with exact system + value matching
   */
  async findPatientCandidateMatches(currentPatientId, deterministicIdentifiers) {
    const candidateSet = new Set();

    for (const identifier of deterministicIdentifiers) {
      const normalizedValue = this.normalizeIdentifierValue(identifier.identifier_value);
      // Match by BOTH system and normalized value to respect exact-match contract
      const matches = await this.masterDataRepo.findPatientIdentifiersBySystemAndNormalizedValue(
        identifier.identifier_system,
        normalizedValue
      );

      for (const match of matches) {
        // Exclude current patient
        if (match.patient_id !== currentPatientId) {
          candidateSet.add(match.patient_id);
        }
      }
    }

    // Fetch full patient records for candidates
    const candidates = [];
    for (const candidateId of candidateSet) {
      const candidate = await this.masterDataRepo.findById('patients', candidateId);
      if (candidate && candidate.identity_state !== 'inactive') {
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  /**
   * Determine patient merge winner
   * Phase 5: Winner selection priority
   */
  async determinePatientMergeWinner(patientId1, patientId2) {
    const patient1 = await this.masterDataRepo.findById('patients', patientId1);
    const patient2 = await this.masterDataRepo.findById('patients', patientId2);

    // Priority 1: Existing reconciled state
    if (patient1.identity_state === 'reconciled' && patient2.identity_state !== 'reconciled') {
      return { shouldMerge: true, winner_id: patientId1, loser_id: patientId2 };
    }
    if (patient2.identity_state === 'reconciled' && patient1.identity_state !== 'reconciled') {
      return { shouldMerge: true, winner_id: patientId2, loser_id: patientId1 };
    }

    // Both reconciled - ambiguous
    if (patient1.identity_state === 'reconciled' && patient2.identity_state === 'reconciled') {
      return { shouldMerge: false, ambiguity_reason: 'both_already_reconciled' };
    }

    // Priority 2: Row with any verified identifier
    const ids1 = await this.masterDataRepo.findPatientIdentifiersWithStatus(patientId1);
    const ids2 = await this.masterDataRepo.findPatientIdentifiersWithStatus(patientId2);

    const hasVerified1 = ids1.some(id => id.status === 'verified');
    const hasVerified2 = ids2.some(id => id.status === 'verified');

    if (hasVerified1 && !hasVerified2) {
      return { shouldMerge: true, winner_id: patientId1, loser_id: patientId2 };
    }
    if (hasVerified2 && !hasVerified1) {
      return { shouldMerge: true, winner_id: patientId2, loser_id: patientId1 };
    }

    // Priority 3: Active interop resource links
    const links1 = await this.interopRepo.findResourceLinksByInternalEntity('patient', patientId1);
    const links2 = await this.interopRepo.findResourceLinksByInternalEntity('patient', patientId2);

    if (links1.length > 0 && links2.length === 0) {
      return { shouldMerge: true, winner_id: patientId1, loser_id: patientId2 };
    }
    if (links2.length > 0 && links1.length === 0) {
      return { shouldMerge: true, winner_id: patientId2, loser_id: patientId1 };
    }

    // Priority 4: Reference count
    const refs1 = await this.masterDataRepo.countReferencesForPatient(patientId1);
    const refs2 = await this.masterDataRepo.countReferencesForPatient(patientId2);

    // Compare by documents, then sessions, then messages
    if (refs1.documents > refs2.documents) {
      return { shouldMerge: true, winner_id: patientId1, loser_id: patientId2 };
    }
    if (refs2.documents > refs1.documents) {
      return { shouldMerge: true, winner_id: patientId2, loser_id: patientId1 };
    }

    if (refs1.live_conversation_sessions > refs2.live_conversation_sessions) {
      return { shouldMerge: true, winner_id: patientId1, loser_id: patientId2 };
    }
    if (refs2.live_conversation_sessions > refs1.live_conversation_sessions) {
      return { shouldMerge: true, winner_id: patientId2, loser_id: patientId1 };
    }

    if (refs1.interop_messages > refs2.interop_messages) {
      return { shouldMerge: true, winner_id: patientId1, loser_id: patientId2 };
    }
    if (refs2.interop_messages > refs1.interop_messages) {
      return { shouldMerge: true, winner_id: patientId2, loser_id: patientId1 };
    }

    // Priority 5: Older created_at
    if (patient1.created_at < patient2.created_at) {
      return { shouldMerge: true, winner_id: patientId1, loser_id: patientId2 };
    }
    if (patient2.created_at < patient1.created_at) {
      return { shouldMerge: true, winner_id: patientId2, loser_id: patientId1 };
    }

    // Still tied - ambiguous
    return { shouldMerge: false, ambiguity_reason: 'priority_tie' };
  }

  /**
   * Promote patient to reconciled
   * Phase 5: Mark as reconciled when deterministic rules satisfied
   */
  async promotePatientToReconciled(patientId, options = {}) {
    const { dryRun = false } = options;

    if (dryRun) {
      return { action: 'would_reconcile', patient_id: patientId };
    }

    await this.masterDataRepo.updatePatient(patientId, {
      identity_state: 'reconciled',
      source_mode: 'internal'
    });

    this.report.patient_reconciliations++;
    return { action: 'reconciled', patient_id: patientId };
  }

  /**
   * Execute patient merge
   * Phase 5: Safe merge with foreign key repointing
   */
  async executePatientMerge(winnerId, loserId, options = {}) {
    const { dryRun = false } = options;

    if (dryRun) {
      return {
        action: 'would_merge',
        winner_id: winnerId,
        loser_id: loserId,
        reason: 'exact_identifier_match'
      };
    }

    const result = await this.masterDataRepo.mergePatients(winnerId, loserId, {
      reason: 'exact_identifier_match'
    });

    this.report.patient_merges++;
    this.report.identifiers_marked_deprecated += (await this.masterDataRepo.findPatientIdentifiersWithStatus(loserId)).length;

    // Update references repointed count
    const loserRefs = await this.masterDataRepo.countReferencesForPatient(loserId);
    this.report.references_repointed.patients = (this.report.references_repointed.patients || 0) + loserRefs.total;

    return {
      action: 'merged',
      winner_id: winnerId,
      loser_id: loserId,
      merged_at: result.merged_at
    };
  }

  /**
   * Create patient reconciliation case
   * Phase 5: Atomic case creation for ambiguous matches
   */
  async createPatientReconciliationCase(candidates, reasonCode, options = {}) {
    const { dryRun = false } = options;
    const primaryCandidate = candidates[0];

    const caseData = {
      entity_type: 'patient',
      candidate_patient_id: primaryCandidate.id,
      source_system: 'identity_reconciliation',
      reason_code: reasonCode,
      case_status: 'open',
      observed_identifiers: {
        identifiers: await this.collectPatientIdentifiers(candidates),
        candidates: candidates.map(c => ({
          patient_id: c.id,
          identity_state: c.identity_state,
          display_name: c.display_name
        }))
      },
      candidate_matches: {
        candidates: candidates.map(c => c.id),
        match_basis: 'exact_identifier_match',
        blocked_by: reasonCode
      }
    };

    // Only insert case if not in dry-run mode
    if (dryRun) {
      // Update report even in dry-run
      this.report.cases_created_by_reason[reasonCode] = (this.report.cases_created_by_reason[reasonCode] || 0) + 1;

      return {
        action: 'would_create_case',
        case_data: caseData,
        reason_code: reasonCode,
        candidates_affected: candidates.length,
        dry_run: dryRun
      };
    }

    // Execute case creation and state updates atomically in a single transaction
    const result = await this.masterDataRepo.transaction(async (client) => {
      const now = new Date().toISOString();

      // Insert case
      const caseResult = await client.query(
        `INSERT INTO ${this.masterDataRepo.identityReconciliationCasesTableName}
         (id, entity_type, candidate_patient_id, source_system, reason_code, case_status, observed_identifiers_jsonb, candidate_matches_jsonb, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          this.masterDataRepo.generateId(),
          caseData.entity_type,
          caseData.candidate_patient_id,
          caseData.source_system,
          caseData.reason_code,
          caseData.case_status,
          this.masterDataRepo.toJSONB(caseData.observed_identifiers),
          this.masterDataRepo.toJSONB(caseData.candidate_matches),
          now,
          now
        ]
      );

      const newCase = caseResult.rows[0];

      // Mark candidates as conflicted within same transaction
      for (const candidate of candidates) {
        if (candidate.identity_state !== 'conflicted') {
          await client.query(
            `UPDATE ${this.masterDataRepo.patientsTableName} SET identity_state = 'conflicted', updated_at = NOW() WHERE id = $1`,
            [candidate.id]
          );
        }
      }

      return newCase;
    });

    // Update report
    this.report.cases_created_by_reason[reasonCode] = (this.report.cases_created_by_reason[reasonCode] || 0) + 1;

    return {
      action: 'case_created',
      case_id: result.id,
      reason_code: reasonCode,
      candidates_affected: candidates.length,
      dry_run: dryRun
    };
  }

  /**
   * Collect identifiers from multiple patients for case evidence
   * Phase 5: Evidence preservation
   */
  async collectPatientIdentifiers(patients) {
    const allIdentifiers = [];

    for (const patient of patients) {
      const identifiers = await this.masterDataRepo.findPatientIdentifiersWithStatus(patient.id);
      for (const identifier of identifiers) {
        allIdentifiers.push({
          patient_id: patient.id,
          identifier_system: identifier.identifier_system,
          identifier_value: identifier.identifier_value,
          status: identifier.status,
          source_system: identifier.source_system
        });
      }
    }

    return allIdentifiers;
  }

  // ========================================
  // Encounter Reconciliation
  // ========================================

  /**
   * Reconcile a single encounter
   * Phase 5: Encounter reconciliation flow
   */
  async reconcileEncounter(encounterId, options = {}) {
    const { dryRun = false } = options;

    try {
      this.report.encounters_scanned++;

      // 1. Fetch encounter with identifiers
      const encounter = await this.masterDataRepo.findById('encounters', encounterId);
      if (!encounter) {
        throw new Error(`Encounter ${encounterId} not found`);
      }

      // Skip if already inactive or reconciled
      if (encounter.identity_state === 'inactive') {
        return { skipped: true, reason: 'already_inactive' };
      }
      if (encounter.identity_state === 'reconciled') {
        return { skipped: true, reason: 'already_reconciled' };
      }

      // 2. Check if encounter is already under review
      const openCases = await this.masterDataRepo.findReconciliationCasesByEntity('encounter', encounterId, {
        caseStatuses: ['open', 'in_review']
      });
      if (openCases.length > 0) {
        this.report.entities_skipped_in_review++;
        return { skipped: true, reason: 'already_in_review', case_count: openCases.length };
      }

      // 3. Get encounter identifiers
      const identifiers = await this.masterDataRepo.findEncounterIdentifiersWithStatus(encounterId);

      // 4. Filter deterministic identifiers only
      const deterministicIdentifiers = identifiers.filter(id =>
        this.isDeterministicEncounterSystem(id.identifier_system)
      );

      // 5. If there are identifiers but no deterministic ones, keep provisional
      if (identifiers.length > 0 && deterministicIdentifiers.length === 0) {
        return { action: 'kept_provisional', reason: 'no_deterministic_identifiers' };
      }

      // 6. Find candidate matches by normalized identifier values (only if deterministic identifiers exist)
      let candidateMatches = [];
      if (deterministicIdentifiers.length > 0) {
        candidateMatches = await this.findEncounterCandidateMatches(encounterId, deterministicIdentifiers);
      }

      // 7. If no other matches, mark as reconciled if conditions met
      if (candidateMatches.length === 0) {
        return await this.promoteEncounterToReconciled(encounterId, { dryRun });
      }

      // 8. If exactly one match, check patient compatibility first
      if (candidateMatches.length === 1) {
        const otherEncounter = candidateMatches[0];

        // Verify patient linkage compatibility
        const patientCompatibility = await this.verifyPatientCompatibility(encounterId, otherEncounter.id);
        if (!patientCompatibility.compatible) {
          return await this.createEncounterReconciliationCase(
            [encounter, otherEncounter],
            patientCompatibility.reason,
            { dryRun }
          );
        }

        const decision = await this.determineEncounterMergeWinner(encounterId, otherEncounter.id);

        if (decision.shouldMerge) {
          return await this.executeEncounterMerge(decision.winner_id, decision.loser_id, { dryRun });
        } else {
          return await this.createEncounterReconciliationCase([encounter, otherEncounter], decision.ambiguity_reason, { dryRun });
        }
      }

      // 9. Multiple candidates - create case
      return await this.createEncounterReconciliationCase(
        [encounter, ...candidateMatches],
        'multiple_encounter_candidates',
        { dryRun }
      );

    } catch (error) {
      this.report.errors.push({
        entity_type: 'encounter',
        entity_id: encounterId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Find encounter candidate matches by identifiers
   * Phase 5: Candidate discovery with exact system + value matching
   */
  async findEncounterCandidateMatches(currentEncounterId, deterministicIdentifiers) {
    const candidateSet = new Set();

    for (const identifier of deterministicIdentifiers) {
      const normalizedValue = this.normalizeIdentifierValue(identifier.identifier_value);
      // Match by BOTH system and normalized value to respect exact-match contract
      const matches = await this.masterDataRepo.findEncounterIdentifiersBySystemAndNormalizedValue(
        identifier.identifier_system,
        normalizedValue
      );

      for (const match of matches) {
        if (match.encounter_id !== currentEncounterId) {
          candidateSet.add(match.encounter_id);
        }
      }
    }

    const candidates = [];
    for (const candidateId of candidateSet) {
      const candidate = await this.masterDataRepo.findById('encounters', candidateId);
      if (candidate && candidate.identity_state !== 'inactive') {
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  /**
   * Verify patient linkage compatibility for encounter merge
   * Phase 5: Patient ownership check
   */
  async verifyPatientCompatibility(encounterId1, encounterId2) {
    const encounter1 = await this.masterDataRepo.findById('encounters', encounterId1);
    const encounter2 = await this.masterDataRepo.findById('encounters', encounterId2);

    // Both point to same patient or both null - compatible
    if (!encounter1.patient_id && !encounter2.patient_id) {
      return { compatible: true };
    }
    if (encounter1.patient_id && encounter2.patient_id && encounter1.patient_id === encounter2.patient_id) {
      return { compatible: true };
    }

    return { compatible: false, reason: 'patient_encounter_mismatch' };
  }

  /**
   * Determine encounter merge winner
   * Phase 5: Winner selection (simplified for encounters)
   */
  async determineEncounterMergeWinner(encounterId1, encounterId2) {
    const encounter1 = await this.masterDataRepo.findById('encounters', encounterId1);
    const encounter2 = await this.masterDataRepo.findById('encounters', encounterId2);

    // Priority 1: Existing reconciled state
    if (encounter1.identity_state === 'reconciled' && encounter2.identity_state !== 'reconciled') {
      return { shouldMerge: true, winner_id: encounterId1, loser_id: encounterId2 };
    }
    if (encounter2.identity_state === 'reconciled' && encounter1.identity_state !== 'reconciled') {
      return { shouldMerge: true, winner_id: encounterId2, loser_id: encounterId1 };
    }

    // Both reconciled - ambiguous
    if (encounter1.identity_state === 'reconciled' && encounter2.identity_state === 'reconciled') {
      return { shouldMerge: false, ambiguity_reason: 'both_already_reconciled' };
    }

    // Priority 2: Reference count
    const refs1 = await this.masterDataRepo.countReferencesForEncounter(encounterId1);
    const refs2 = await this.masterDataRepo.countReferencesForEncounter(encounterId2);

    if (refs1.total > refs2.total) {
      return { shouldMerge: true, winner_id: encounterId1, loser_id: encounterId2 };
    }
    if (refs2.total > refs1.total) {
      return { shouldMerge: true, winner_id: encounterId2, loser_id: encounterId1 };
    }

    // Priority 3: Older created_at
    if (encounter1.created_at < encounter2.created_at) {
      return { shouldMerge: true, winner_id: encounterId1, loser_id: encounterId2 };
    }
    if (encounter2.created_at < encounter1.created_at) {
      return { shouldMerge: true, winner_id: encounterId2, loser_id: encounterId1 };
    }

    return { shouldMerge: false, ambiguity_reason: 'priority_tie' };
  }

  /**
   * Promote encounter to reconciled
   * Phase 5: Mark as reconciled when deterministic rules satisfied
   */
  async promoteEncounterToReconciled(encounterId, options = {}) {
    const { dryRun = false } = options;

    if (dryRun) {
      return { action: 'would_reconcile', encounter_id: encounterId };
    }

    await this.masterDataRepo.updateEncounter(encounterId, {
      identity_state: 'reconciled',
      source_mode: 'internal'
    });

    this.report.encounter_reconciliations++;
    return { action: 'reconciled', encounter_id: encounterId };
  }

  /**
   * Execute encounter merge
   * Phase 5: Safe merge with foreign key repointing
   */
  async executeEncounterMerge(winnerId, loserId, options = {}) {
    const { dryRun = false } = options;

    if (dryRun) {
      return {
        action: 'would_merge',
        winner_id: winnerId,
        loser_id: loserId,
        reason: 'exact_identifier_match'
      };
    }

    const result = await this.masterDataRepo.mergeEncounters(winnerId, loserId, {
      reason: 'exact_identifier_match'
    });

    this.report.encounter_merges++;
    this.report.identifiers_marked_deprecated += (await this.masterDataRepo.findEncounterIdentifiersWithStatus(loserId)).length;

    const loserRefs = await this.masterDataRepo.countReferencesForEncounter(loserId);
    this.report.references_repointed.encounters = (this.report.references_repointed.encounters || 0) + loserRefs.total;

    return {
      action: 'merged',
      winner_id: winnerId,
      loser_id: loserId,
      merged_at: result.merged_at
    };
  }

  /**
   * Create encounter reconciliation case
   * Phase 5: Atomic case creation for ambiguous matches
   */
  async createEncounterReconciliationCase(candidates, reasonCode, options = {}) {
    const { dryRun = false } = options;
    const primaryCandidate = candidates[0];

    const caseData = {
      entity_type: 'encounter',
      candidate_encounter_id: primaryCandidate.id,
      source_system: 'identity_reconciliation',
      reason_code: reasonCode,
      case_status: 'open',
      observed_identifiers: {
        identifiers: await this.collectEncounterIdentifiers(candidates),
        candidates: candidates.map(c => ({
          encounter_id: c.id,
          identity_state: c.identity_state,
          patient_id: c.patient_id
        }))
      },
      candidate_matches: {
        candidates: candidates.map(c => c.id),
        match_basis: 'exact_identifier_match',
        blocked_by: reasonCode
      }
    };

    // Only insert case if not in dry-run mode
    if (dryRun) {
      // Update report even in dry-run
      this.report.cases_created_by_reason[reasonCode] = (this.report.cases_created_by_reason[reasonCode] || 0) + 1;

      return {
        action: 'would_create_case',
        case_data: caseData,
        reason_code: reasonCode,
        candidates_affected: candidates.length,
        dry_run: dryRun
      };
    }

    // Execute case creation and state updates atomically in a single transaction
    const result = await this.masterDataRepo.transaction(async (client) => {
      const now = new Date().toISOString();

      // Insert case
      const caseResult = await client.query(
        `INSERT INTO ${this.masterDataRepo.identityReconciliationCasesTableName}
         (id, entity_type, candidate_encounter_id, source_system, reason_code, case_status, observed_identifiers_jsonb, candidate_matches_jsonb, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          this.masterDataRepo.generateId(),
          caseData.entity_type,
          caseData.candidate_encounter_id,
          caseData.source_system,
          caseData.reason_code,
          caseData.case_status,
          this.masterDataRepo.toJSONB(caseData.observed_identifiers),
          this.masterDataRepo.toJSONB(caseData.candidate_matches),
          now,
          now
        ]
      );

      const newCase = caseResult.rows[0];

      // Mark candidates as conflicted within same transaction
      for (const candidate of candidates) {
        if (candidate.identity_state !== 'conflicted') {
          await client.query(
            `UPDATE ${this.masterDataRepo.encountersTableName} SET identity_state = 'conflicted', updated_at = NOW() WHERE id = $1`,
            [candidate.id]
          );
        }
      }

      return newCase;
    });

    this.report.cases_created_by_reason[reasonCode] = (this.report.cases_created_by_reason[reasonCode] || 0) + 1;

    return {
      action: 'case_created',
      case_id: result.id,
      reason_code: reasonCode,
      candidates_affected: candidates.length,
      dry_run: dryRun
    };
  }

  /**
   * Collect identifiers from multiple encounters for case evidence
   * Phase 5: Evidence preservation
   */
  async collectEncounterIdentifiers(encounters) {
    const allIdentifiers = [];

    for (const encounter of encounters) {
      const identifiers = await this.masterDataRepo.findEncounterIdentifiersWithStatus(encounter.id);
      for (const identifier of identifiers) {
        allIdentifiers.push({
          encounter_id: encounter.id,
          identifier_system: identifier.identifier_system,
          identifier_value: identifier.identifier_value,
          status: identifier.status,
          source_system: identifier.source_system
        });
      }
    }

    return allIdentifiers;
  }

  // ========================================
  // Batch Reconciliation
  // ========================================

  /**
   * Run batch patient reconciliation
   * Phase 5: Batch processing with ID collection to prevent skipping
   */
  async runBatchPatientReconciliation(options = {}) {
    const {
      identityStates = ['provisional', 'conflicted'],
      batchSize = 100,
      dryRun = false
    } = options;

    // First, collect all patient IDs to process
    const allPatientIds = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const patients = await this.masterDataRepo.listPatientsByIdentityState(identityStates, {
        limit: batchSize,
        offset
      });

      if (patients.length === 0) {
        hasMore = false;
        break;
      }

      // Collect just the IDs
      for (const patient of patients) {
        allPatientIds.push(patient.id);
      }

      offset += batchSize;
      hasMore = patients.length === batchSize;
    }

    // Now process all collected IDs
    const batchResults = [];
    for (const patientId of allPatientIds) {
      try {
        const result = await this.reconcilePatient(patientId, { dryRun });
        batchResults.push(result);
      } catch (error) {
        console.error(`Error reconciling patient ${patientId}:`, error);
        this.report.errors.push({
          entity_type: 'patient',
          entity_id: patientId,
          error: error.message
        });
      }
    }

    return batchResults;
  }

  /**
   * Run batch encounter reconciliation
   * Phase 5: Batch processing with ID collection to prevent skipping
   */
  async runBatchEncounterReconciliation(options = {}) {
    const {
      identityStates = ['provisional', 'conflicted'],
      batchSize = 100,
      dryRun = false
    } = options;

    // First, collect all encounter IDs to process
    const allEncounterIds = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const encounters = await this.masterDataRepo.listEncountersByIdentityState(identityStates, {
        limit: batchSize,
        offset
      });

      if (encounters.length === 0) {
        hasMore = false;
        break;
      }

      // Collect just the IDs
      for (const encounter of encounters) {
        allEncounterIds.push(encounter.id);
      }

      offset += batchSize;
      hasMore = encounters.length === batchSize;
    }

    // Now process all collected IDs
    const batchResults = [];
    for (const encounterId of allEncounterIds) {
      try {
        const result = await this.reconcileEncounter(encounterId, { dryRun });
        batchResults.push(result);
      } catch (error) {
        console.error(`Error reconciling encounter ${encounterId}:`, error);
        this.report.errors.push({
          entity_type: 'encounter',
          entity_id: encounterId,
          error: error.message
        });
      }
    }

    return batchResults;
  }

  // ========================================
  // Case Management
  // ========================================

  /**
   * Resolve reconciliation case
   * Phase 5: Manual case resolution with atomic transaction execution
   */
  async resolveReconciliationCase(caseId, resolution, options = {}) {
    const { dryRun = false, resolvedByUserId } = options;

    const existingCase = await this.masterDataRepo.findReconciliationCaseById(caseId);
    if (!existingCase) {
      throw new Error(`Case ${caseId} not found`);
    }

    const resolutionData = {
      action: resolution.action,
      winner_patient_id: resolution.winner_patient_id || null,
      winner_encounter_id: resolution.winner_encounter_id || null,
      loser_patient_id: resolution.loser_patient_id || null,
      loser_encounter_id: resolution.loser_encounter_id || null,
      identifier_updates: resolution.identifier_updates || [],
      reference_updates: resolution.reference_updates || [],
      resolved_by_user_id: resolvedByUserId,
      notes: resolution.notes || '',
      resolved_at: new Date().toISOString()
    };

    if (dryRun) {
      return { action: 'would_resolve', case_id: caseId, resolution: resolutionData };
    }

    // Execute entire resolution atomically in a single transaction
    const result = await this.masterDataRepo.transaction(async (client) => {
      let executionResult;

      // Execute the resolution based on action type
      switch (resolution.action) {
        case 'merge_patients':
          if (!resolution.winner_patient_id || !resolution.loser_patient_id) {
            throw new Error('merge_patients requires winner_patient_id and loser_patient_id');
          }
          // Execute merge within transaction using internal method
          executionResult = await this.masterDataRepo._mergePatientsInTransaction(
            client,
            resolution.winner_patient_id,
            resolution.loser_patient_id,
            { reason: 'manual_resolution' }
          );
          break;

        case 'merge_encounters':
          if (!resolution.winner_encounter_id || !resolution.loser_encounter_id) {
            throw new Error('merge_encounters requires winner_encounter_id and loser_encounter_id');
          }
          // Execute merge within transaction using internal method
          executionResult = await this.masterDataRepo._mergeEncountersInTransaction(
            client,
            resolution.winner_encounter_id,
            resolution.loser_encounter_id,
            { reason: 'manual_resolution' }
          );
          break;

        case 'link_to_existing':
          // Link entities without merge
          if (existingCase.entity_type === 'patient' && resolution.winner_patient_id) {
            await client.query(
              `UPDATE ${this.masterDataRepo.patientsTableName} SET identity_state = 'reconciled', updated_at = NOW() WHERE id = $1`,
              [resolution.winner_patient_id]
            );
          } else if (existingCase.entity_type === 'encounter' && resolution.winner_encounter_id) {
            await client.query(
              `UPDATE ${this.masterDataRepo.encountersTableName} SET identity_state = 'reconciled', updated_at = NOW() WHERE id = $1`,
              [resolution.winner_encounter_id]
            );
          }
          executionResult = { action: 'linked' };
          break;

        case 'keep_separate':
          // Mark entities as reconciled without merging
          if (existingCase.entity_type === 'patient' && existingCase.candidate_patient_id) {
            await client.query(
              `UPDATE ${this.masterDataRepo.patientsTableName} SET identity_state = 'reconciled', updated_at = NOW() WHERE id = $1`,
              [existingCase.candidate_patient_id]
            );
          } else if (existingCase.entity_type === 'encounter' && existingCase.candidate_encounter_id) {
            await client.query(
              `UPDATE ${this.masterDataRepo.encountersTableName} SET identity_state = 'reconciled', updated_at = NOW() WHERE id = $1`,
              [existingCase.candidate_encounter_id]
            );
          }
          executionResult = { action: 'kept_separate' };
          break;

        default:
          throw new Error(`Unknown resolution action: ${resolution.action}`);
      }

      // Apply identifier updates within transaction
      if (resolution.identifier_updates && resolution.identifier_updates.length > 0) {
        for (const update of resolution.identifier_updates) {
          if (update.entity_type === 'patient') {
            await client.query(
              `UPDATE ${this.masterDataRepo.patientIdentifiersTableName} SET status = $1 WHERE id = $2`,
              [update.status, update.identifier_id]
            );
          } else if (update.entity_type === 'encounter') {
            await client.query(
              `UPDATE ${this.masterDataRepo.encounterIdentifiersTableName} SET status = $1 WHERE id = $2`,
              [update.status, update.identifier_id]
            );
          }
        }
      }

      // Execute reference updates within transaction
      if (resolution.reference_updates && resolution.reference_updates.length > 0) {
        const allowedWhereColumns = ['id', 'patient_id', 'encounter_id', 'document_id'];

        for (const refUpdate of resolution.reference_updates) {
          // Validate where_column to prevent SQL injection
          if (!allowedWhereColumns.includes(refUpdate.where_column)) {
            throw new Error(`Invalid where_column: ${refUpdate.where_column}. Must be one of: ${allowedWhereColumns.join(', ')}`);
          }

          if (refUpdate.table === 'documents' && refUpdate.column === 'patient_id') {
            await client.query(
              `UPDATE documents SET patient_id = $1 WHERE ${refUpdate.where_column} = $2`,
              [refUpdate.new_value, refUpdate.where_value]
            );
          } else if (refUpdate.table === 'documents' && refUpdate.column === 'encounter_id') {
            await client.query(
              `UPDATE documents SET encounter_id = $1 WHERE ${refUpdate.where_column} = $2`,
              [refUpdate.new_value, refUpdate.where_value]
            );
          } else if (refUpdate.table === 'live_conversation_sessions' && refUpdate.column === 'patient_id') {
            await client.query(
              `UPDATE live_conversation_sessions SET patient_id = $1 WHERE ${refUpdate.where_column} = $2`,
              [refUpdate.new_value, refUpdate.where_value]
            );
          } else if (refUpdate.table === 'live_conversation_sessions' && refUpdate.column === 'encounter_id') {
            await client.query(
              `UPDATE live_conversation_sessions SET encounter_id = $1 WHERE ${refUpdate.where_column} = $2`,
              [refUpdate.new_value, refUpdate.where_value]
            );
          } else if (refUpdate.table === 'encounters' && refUpdate.column === 'patient_id') {
            await client.query(
              `UPDATE encounters SET patient_id = $1 WHERE ${refUpdate.where_column} = $2`,
              [refUpdate.new_value, refUpdate.where_value]
            );
          } else if (refUpdate.table === 'interop_messages' && refUpdate.column === 'patient_id') {
            await client.query(
              `UPDATE interop_messages SET patient_id = $1 WHERE ${refUpdate.where_column} = $2`,
              [refUpdate.new_value, refUpdate.where_value]
            );
          } else if (refUpdate.table === 'interop_messages' && refUpdate.column === 'encounter_id') {
            await client.query(
              `UPDATE interop_messages SET encounter_id = $1 WHERE ${refUpdate.where_column} = $2`,
              [refUpdate.new_value, refUpdate.where_value]
            );
          }
        }
      }

      // Mark case as resolved within transaction
      await client.query(
        `UPDATE ${this.masterDataRepo.identityReconciliationCasesTableName}
         SET case_status = 'resolved', resolution_jsonb = $1, updated_at = NOW(), resolved_at = NOW()
         WHERE id = $2`,
        [this.masterDataRepo.toJSONB(resolutionData), caseId]
      );

      return executionResult;
    });

    this.report.cases_resolved++;

    return {
      action: 'resolved',
      case_id: caseId,
      resolution: resolutionData,
      execution_result: result
    };
  }

  /**
   * Defer reconciliation case
   * Phase 5: Postpone case resolution
   */
  async deferReconciliationCase(caseId, options = {}) {
    const { dryRun = false } = options;

    if (dryRun) {
      return { action: 'would_defer', case_id: caseId };
    }

    const updatedCase = await this.masterDataRepo.updateReconciliationCaseStatus(caseId, 'deferred', {});

    this.report.cases_deferred++;

    return {
      action: 'deferred',
      case_id: caseId
    };
  }

  /**
   * Determine case priority
   * Phase 5: Priority assignment
   */
  determineCasePriority(reasonCode) {
    const highPriorityReasons = ['patient_encounter_mismatch', 'trusted_identifier_conflict'];
    const lowPriorityReasons = ['manual_review_required'];

    if (highPriorityReasons.includes(reasonCode)) {
      return 'high';
    }
    if (lowPriorityReasons.includes(reasonCode)) {
      return 'low';
    }
    return 'medium';
  }

  // ========================================
  // Reporting
  // ========================================

  /**
   * Get reconciliation report
   * Phase 5: Machine-readable report
   */
  getReport() {
    return {
      ...this.report,
      generated_at: new Date().toISOString()
    };
  }

  /**
   * Reset report
   * Phase 5: Report reset
   */
  resetReport() {
    this.report = {
      patients_scanned: 0,
      encounters_scanned: 0,
      patient_reconciliations: 0,
      encounter_reconciliations: 0,
      trusted_external_patient_identifiers_attached: 0,
      trusted_external_encounter_identifiers_attached: 0,
      patient_merges: 0,
      encounter_merges: 0,
      cases_created_by_reason: {},
      cases_resolved: 0,
      cases_deferred: 0,
      entities_skipped_in_review: 0,
      identifiers_promoted_to_verified: 0,
      identifiers_marked_deprecated: 0,
      references_repointed: {},
      errors: []
    };
  }

  /**
   * Attach trusted external identifier to entity
   * Phase 5: Trusted external-identifier attach flow
   */
  async attachTrustedExternalIdentifier(endpointId, entityType, entityId, identifierData, options = {}) {
    const { dryRun = false } = options;

    // 1. Verify endpoint trust configuration
    const trustConfig = await this.interopRepo.findEndpointTrustConfig(endpointId);
    if (!trustConfig || trustConfig.endpoint_status !== 'active') {
      throw new Error(`Endpoint ${endpointId} is not active or not found`);
    }

    // 2. Validate identifier system is trusted
    const isTrustedSystem = entityType === 'patient'
      ? trustConfig.trusted_patient_identifier_systems.includes(identifierData.system)
      : trustConfig.trusted_encounter_identifier_systems.includes(identifierData.system);

    if (!isTrustedSystem) {
      // Create case for untrusted external identifier
      return await this.createUntrustedIdentifierCase(endpointId, entityType, entityId, identifierData, { dryRun });
    }

    // 3. Verify anchor exists (internal identifier or active resource link)
    const hasAnchor = await this.verifyExternalAttachAnchor(endpointId, entityType, entityId, identifierData);
    if (!hasAnchor) {
      // Create case for identifier without anchor
      return await this.createUnanchoredIdentifierCase(endpointId, entityType, entityId, identifierData, { dryRun });
    }

    // 4. Attach the trusted external identifier
    if (dryRun) {
      return { action: 'would_attach', identifier: identifierData };
    }

    const result = await this.masterDataRepo.transaction(async (client) => {
      const now = new Date().toISOString();

      if (entityType === 'patient') {
        // Check for existing identifier on same entity (idempotency)
        const existingOnEntity = await client.query(
          `SELECT * FROM ${this.masterDataRepo.patientIdentifiersTableName}
           WHERE patient_id = $1 AND identifier_system = $2 AND identifier_value = $3`,
          [entityId, identifierData.system, identifierData.value]
        );

        if (existingOnEntity.rows && existingOnEntity.rows.length > 0) {
          // Already exists - no-op (idempotent)
          return {
            action: 'no-op',
            entity_type: entityType,
            entity_id: entityId,
            identifier: identifierData,
            reason: 'already_exists'
          };
        }

        // Check for conflicting identifier on different entity (global unique constraint)
        const existingGlobal = await client.query(
          `SELECT * FROM ${this.masterDataRepo.patientIdentifiersTableName}
           WHERE identifier_system = $1 AND identifier_value = $2 AND patient_id != $3`,
          [identifierData.system, identifierData.value, entityId]
        );

        if (existingGlobal.rows && existingGlobal.rows.length > 0) {
          // Conflict - create case for manual resolution using transaction client
          const conflictData = {
            entity_type: entityType,
            candidate_patient_id: entityId,
            source_system: 'trusted_external_conflict',
            reason_code: 'trusted_identifier_conflict',
            case_status: 'open',
            observed_identifiers: {
              endpoint_id: endpointId,
              identifier: identifierData,
              entity_id: entityId,
              conflicting_entity_id: existingGlobal.rows[0].patient_id
            },
            candidate_matches: {
              blocked_by: 'global_unique_constraint',
              conflicting_entities: [entityId, existingGlobal.rows[0].patient_id]
            }
          };

          const now = new Date().toISOString();

          // Create case using transaction client
          const caseResult = await client.query(
            `INSERT INTO ${this.masterDataRepo.identityReconciliationCasesTableName}
             (id, entity_type, candidate_patient_id, source_system, reason_code, case_status, observed_identifiers_jsonb, candidate_matches_jsonb, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
              this.masterDataRepo.generateId(),
              conflictData.entity_type,
              conflictData.candidate_patient_id,
              conflictData.source_system,
              conflictData.reason_code,
              conflictData.case_status,
              this.masterDataRepo.toJSONB(conflictData.observed_identifiers),
              this.masterDataRepo.toJSONB(conflictData.candidate_matches),
              now,
              now
            ]
          );

          // Mark entity as conflicted using same transaction client
          await client.query(
            `UPDATE ${this.masterDataRepo.patientsTableName} SET identity_state = 'conflicted', updated_at = NOW() WHERE id = $1`,
            [entityId]
          );

          this.report.cases_created_by_reason['trusted_identifier_conflict'] =
            (this.report.cases_created_by_reason['trusted_identifier_conflict'] || 0) + 1;

          return {
            action: 'conflict',
            entity_type: entityType,
            entity_id: entityId,
            identifier: identifierData,
            conflicting_entity_id: existingGlobal.rows[0].patient_id,
            case_id: caseResult.rows[0].id
          };
        }

        // Insert trusted external identifier as verified
        await client.query(
          `INSERT INTO ${this.masterDataRepo.patientIdentifiersTableName}
           (id, patient_id, identifier_system, identifier_value, identifier_type, assigning_authority, status, source_system, is_primary, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            this.masterDataRepo.generateId(),
            entityId,
            identifierData.system,
            identifierData.value,
            identifierData.type || null,
            identifierData.assigning_authority || endpointId,
            'verified',
            identifierData.source_system || 'external',
            false,
            now
          ]
        );

        // Update patient source_mode if both internal and external identifiers now exist
        await client.query(
          `UPDATE ${this.masterDataRepo.patientsTableName}
           SET source_mode = 'merged', updated_at = NOW()
           WHERE id = $1 AND source_mode = 'internal'`,
          [entityId]
        );

        this.report.trusted_external_patient_identifiers_attached++;
      } else if (entityType === 'encounter') {
        // Check for existing identifier on same entity (idempotency)
        const existingOnEntity = await client.query(
          `SELECT * FROM ${this.masterDataRepo.encounterIdentifiersTableName}
           WHERE encounter_id = $1 AND identifier_system = $2 AND identifier_value = $3`,
          [entityId, identifierData.system, identifierData.value]
        );

        if (existingOnEntity.rows && existingOnEntity.rows.length > 0) {
          // Already exists - no-op (idempotent)
          return {
            action: 'no-op',
            entity_type: entityType,
            entity_id: entityId,
            identifier: identifierData,
            reason: 'already_exists'
          };
        }

        // Check for conflicting identifier on different entity (global unique constraint)
        const existingGlobal = await client.query(
          `SELECT * FROM ${this.masterDataRepo.encounterIdentifiersTableName}
           WHERE identifier_system = $1 AND identifier_value = $2 AND encounter_id != $3`,
          [identifierData.system, identifierData.value, entityId]
        );

        if (existingGlobal.rows && existingGlobal.rows.length > 0) {
          // Conflict - create case for manual resolution using transaction client
          const conflictData = {
            entity_type: entityType,
            candidate_encounter_id: entityId,
            source_system: 'trusted_external_conflict',
            reason_code: 'trusted_identifier_conflict',
            case_status: 'open',
            observed_identifiers: {
              endpoint_id: endpointId,
              identifier: identifierData,
              entity_id: entityId,
              conflicting_entity_id: existingGlobal.rows[0].encounter_id
            },
            candidate_matches: {
              blocked_by: 'global_unique_constraint',
              conflicting_entities: [entityId, existingGlobal.rows[0].encounter_id]
            }
          };

          const now = new Date().toISOString();

          // Create case using transaction client
          const caseResult = await client.query(
            `INSERT INTO ${this.masterDataRepo.identityReconciliationCasesTableName}
             (id, entity_type, candidate_encounter_id, source_system, reason_code, case_status, observed_identifiers_jsonb, candidate_matches_jsonb, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
              this.masterDataRepo.generateId(),
              conflictData.entity_type,
              conflictData.candidate_encounter_id,
              conflictData.source_system,
              conflictData.reason_code,
              conflictData.case_status,
              this.masterDataRepo.toJSONB(conflictData.observed_identifiers),
              this.masterDataRepo.toJSONB(conflictData.candidate_matches),
              now,
              now
            ]
          );

          // Mark entity as conflicted using same transaction client
          await client.query(
            `UPDATE ${this.masterDataRepo.encountersTableName} SET identity_state = 'conflicted', updated_at = NOW() WHERE id = $1`,
            [entityId]
          );

          this.report.cases_created_by_reason['trusted_identifier_conflict'] =
            (this.report.cases_created_by_reason['trusted_identifier_conflict'] || 0) + 1;

          return {
            action: 'conflict',
            entity_type: entityType,
            entity_id: entityId,
            identifier: identifierData,
            conflicting_entity_id: existingGlobal.rows[0].encounter_id,
            case_id: caseResult.rows[0].id
          };
        }

        // Insert trusted external identifier as verified
        await client.query(
          `INSERT INTO ${this.masterDataRepo.encounterIdentifiersTableName}
           (id, encounter_id, identifier_system, identifier_value, identifier_type, assigning_authority, status, source_system, is_primary, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            this.masterDataRepo.generateId(),
            entityId,
            identifierData.system,
            identifierData.value,
            identifierData.type || null,
            identifierData.assigning_authority || endpointId,
            'verified',
            identifierData.source_system || 'external',
            false,
            now
          ]
        );

        // Update encounter source_mode if both internal and external identifiers now exist
        await client.query(
          `UPDATE ${this.masterDataRepo.encountersTableName}
           SET source_mode = 'merged', updated_at = NOW()
           WHERE id = $1 AND source_mode = 'internal'`,
          [entityId]
        );

        this.report.trusted_external_encounter_identifiers_attached++;
      }

      return {
        action: 'attached',
        entity_type: entityType,
        entity_id: entityId,
        identifier: identifierData,
        attached_at: now
      };
    });

    return result;
  }

  /**
   * Verify external attach anchor exists
   * Phase 5: Check for internal identifier or active resource link per contract
   */
  async verifyExternalAttachAnchor(endpointId, entityType, entityId, identifierData) {
    // Per Phase 5 contract, automatic attach is allowed only when:
    // 1. The message also contains an exact internal identifier already bound to one canonical entity, OR
    // 2. An active interop_resource_links row already maps that external resource to one canonical entity

    // Check for exact internal identifier on the entity
    if (entityType === 'patient') {
      const internalIdentifiers = await this.masterDataRepo.findPatientIdentifiersWithStatus(entityId);

      // Look for exact internal identifier already bound to this entity
      const hasExactInternal = internalIdentifiers.some(id =>
        id.identifier_system !== identifierData.system && // Different system
        (id.status === 'observed' || id.status === 'verified') && // Valid status
        (id.source_system === null || id.source_system === 'internal' || !id.source_system.includes('external')) // Internal source
      );

      if (hasExactInternal) return true;
    } else if (entityType === 'encounter') {
      const internalIdentifiers = await this.masterDataRepo.findEncounterIdentifiersWithStatus(entityId);

      // Look for exact internal identifier already bound to this entity
      const hasExactInternal = internalIdentifiers.some(id =>
        id.identifier_system !== identifierData.system && // Different system
        (id.status === 'observed' || id.status === 'verified') && // Valid status
        (id.source_system === null || id.source_system === 'internal' || !id.source_system.includes('external')) // Internal source
      );

      if (hasExactInternal) return true;
    }

    // Check for active resource link that maps this specific external resource to one canonical entity
    // Per contract: "an active interop_resource_links row already maps that external resource to one canonical entity"
    const resourceLink = await this.interopRepo.findActiveResourceLink(
      endpointId,
      entityType,
      identifierData.external_resource_id || identifierData.value || entityId
    );

    return !!resourceLink;
  }

  /**
   * Create case for untrusted external identifier
   * Phase 5: Atomic case creation for untrusted sources
   */
  async createUntrustedIdentifierCase(endpointId, entityType, entityId, identifierData, options = {}) {
    const { dryRun = false } = options;

    const caseData = {
      entity_type: entityType,
      candidate_patient_id: entityType === 'patient' ? entityId : null,
      candidate_encounter_id: entityType === 'encounter' ? entityId : null,
      source_system: 'untrusted_external',
      reason_code: 'untrusted_external_identifier',
      case_status: 'open',
      observed_identifiers: {
        endpoint_id: endpointId,
        identifier: identifierData,
        entity_id: entityId
      },
      candidate_matches: {
        blocked_by: 'untrusted_endpoint'
      }
    };

    // Only insert case if not in dry-run mode
    if (dryRun) {
      // Update report even in dry-run
      this.report.cases_created_by_reason['untrusted_external_identifier'] =
        (this.report.cases_created_by_reason['untrusted_external_identifier'] || 0) + 1;

      return {
        action: 'would_create_case',
        case_data: caseData,
        reason_code: 'untrusted_external_identifier',
        dry_run: dryRun
      };
    }

    // Execute case creation and state updates atomically in a single transaction
    const result = await this.masterDataRepo.transaction(async (client) => {
      const now = new Date().toISOString();

      // Insert case
      const caseResult = await client.query(
        `INSERT INTO ${this.masterDataRepo.identityReconciliationCasesTableName}
         (id, entity_type, candidate_patient_id, source_system, reason_code, case_status, observed_identifiers_jsonb, candidate_matches_jsonb, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          this.masterDataRepo.generateId(),
          caseData.entity_type,
          caseData.candidate_patient_id,
          caseData.source_system,
          caseData.reason_code,
          caseData.case_status,
          this.masterDataRepo.toJSONB(caseData.observed_identifiers),
          this.masterDataRepo.toJSONB(caseData.candidate_matches),
          now,
          now
        ]
      );

      const newCase = caseResult.rows[0];

      // Mark entity as conflicted within same transaction
      if (entityType === 'patient') {
        await client.query(
          `UPDATE ${this.masterDataRepo.patientsTableName} SET identity_state = 'conflicted', updated_at = NOW() WHERE id = $1`,
          [entityId]
        );
      } else if (entityType === 'encounter') {
        await client.query(
          `UPDATE ${this.masterDataRepo.encountersTableName} SET identity_state = 'conflicted', updated_at = NOW() WHERE id = $1`,
          [entityId]
        );
      }

      return newCase;
    });

    this.report.cases_created_by_reason['untrusted_external_identifier'] =
      (this.report.cases_created_by_reason['untrusted_external_identifier'] || 0) + 1;

    return {
      action: 'case_created',
      case_id: result.id,
      reason_code: 'untrusted_external_identifier',
      dry_run: dryRun
    };
  }

  /**
   * Create case for unanchored external identifier
   * Phase 5: Atomic case creation for identifiers without anchor
   */
  async createUnanchoredIdentifierCase(endpointId, entityType, entityId, identifierData, options = {}) {
    const { dryRun = false } = options;

    const caseData = {
      entity_type: entityType,
      candidate_patient_id: entityType === 'patient' ? entityId : null,
      candidate_encounter_id: entityType === 'encounter' ? entityId : null,
      source_system: 'external_unanchored',
      reason_code: 'trusted_identifier_conflict',
      case_status: 'open',
      observed_identifiers: {
        endpoint_id: endpointId,
        identifier: identifierData,
        entity_id: entityId
      },
      candidate_matches: {
        blocked_by: 'no_internal_anchor'
      }
    };

    // Only insert case if not in dry-run mode
    if (dryRun) {
      // Update report even in dry-run
      this.report.cases_created_by_reason['trusted_identifier_conflict'] =
        (this.report.cases_created_by_reason['trusted_identifier_conflict'] || 0) + 1;

      return {
        action: 'would_create_case',
        case_data: caseData,
        reason_code: 'trusted_identifier_conflict',
        dry_run: dryRun
      };
    }

    // Execute case creation and state updates atomically in a single transaction
    const result = await this.masterDataRepo.transaction(async (client) => {
      const now = new Date().toISOString();

      // Insert case
      const caseResult = await client.query(
        `INSERT INTO ${this.masterDataRepo.identityReconciliationCasesTableName}
         (id, entity_type, candidate_patient_id, source_system, reason_code, case_status, observed_identifiers_jsonb, candidate_matches_jsonb, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          this.masterDataRepo.generateId(),
          caseData.entity_type,
          caseData.candidate_patient_id,
          caseData.source_system,
          caseData.reason_code,
          caseData.case_status,
          this.masterDataRepo.toJSONB(caseData.observed_identifiers),
          this.masterDataRepo.toJSONB(caseData.candidate_matches),
          now,
          now
        ]
      );

      const newCase = caseResult.rows[0];

      // Mark entity as conflicted within same transaction
      if (entityType === 'patient') {
        await client.query(
          `UPDATE ${this.masterDataRepo.patientsTableName} SET identity_state = 'conflicted', updated_at = NOW() WHERE id = $1`,
          [entityId]
        );
      } else if (entityType === 'encounter') {
        await client.query(
          `UPDATE ${this.masterDataRepo.encountersTableName} SET identity_state = 'conflicted', updated_at = NOW() WHERE id = $1`,
          [entityId]
        );
      }

      return newCase;
    });

    this.report.cases_created_by_reason['trusted_identifier_conflict'] =
      (this.report.cases_created_by_reason['trusted_identifier_conflict'] || 0) + 1;

    return {
      action: 'case_created',
      case_id: result.id,
      reason_code: 'trusted_identifier_conflict',
      dry_run: dryRun
    };
  }

  /**
   * Get summary statistics
   * Phase 5: High-level summary
   */
  async getSummaryStats() {
    const patientStats = {
      total: await this.masterDataRepo.count('patients'),
      provisional: await this.masterDataRepo.countPatientsByIdentityState('provisional'),
      reconciled: await this.masterDataRepo.countPatientsByIdentityState('reconciled'),
      conflicted: await this.masterDataRepo.countPatientsByIdentityState('conflicted'),
      inactive: await this.masterDataRepo.countPatientsByIdentityState('inactive')
    };

    const encounterStats = {
      total: await this.masterDataRepo.count('encounters'),
      provisional: await this.masterDataRepo.countEncountersByIdentityState('provisional'),
      reconciled: await this.masterDataRepo.countEncountersByIdentityState('reconciled'),
      conflicted: await this.masterDataRepo.countEncountersByIdentityState('conflicted'),
      inactive: await this.masterDataRepo.countEncountersByIdentityState('inactive')
    };

    const caseStats = await this.masterDataRepo.getReconciliationStats();

    return {
      patients: patientStats,
      encounters: encounterStats,
      cases: caseStats
    };
  }
}

module.exports = { IdentityReconciliationService };
