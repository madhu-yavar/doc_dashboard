/**
 * Master Data Repository - Phase 3A: Master Data & Identity Backfill
 *
 * Handles patients, encounters, practitioners, and their identifiers.
 * Provides PostgreSQL-based persistence for identity and master data operations.
 *
 * Related Tables:
 * - organizations
 * - locations
 * - practitioners
 * - patients
 * - patient_identifiers
 * - encounters
 * - encounter_identifiers
 *
 * Phase 3A: Backfill existing identity and master data
 */

const { BaseRepository } = require('./base_repository.cjs');

class MasterDataRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.organizationsTableName = 'organizations';
    this.locationsTableName = 'locations';
    this.practitionersTableName = 'practitioners';
    this.patientsTableName = 'patients';
    this.patientIdentifiersTableName = 'patient_identifiers';
    this.encountersTableName = 'encounters';
    this.encounterIdentifiersTableName = 'encounter_identifiers';
    this.identityReconciliationCasesTableName = 'identity_reconciliation_cases';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    // Verify tables exist
    const tablesExist = await this.tableExists(this.patientsTableName);
    if (!tablesExist) {
      throw new Error('Master data tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // Practitioner Operations
  // ========================================

  /**
   * Find practitioner by NPI or registration number
   */
  async findPractitionerByNpi(npi) {
    return await this.queryOne(
      `SELECT * FROM ${this.practitionersTableName} WHERE npi_or_registration_no = $1`,
      [npi]
    );
  }

  /**
   * Find practitioner by backfill user ID
   */
  async findPractitionerByBackfillUserId(userId) {
    return await this.queryOne(
      `SELECT * FROM ${this.practitionersTableName} WHERE practitioner_jsonb->>'backfill_user_id' = $1`,
      [userId]
    );
  }

  /**
   * Create practitioner
   */
  async createPractitioner(practitionerData) {
    const id = practitionerData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.practitionersTableName} (
        id, display_name, npi_or_registration_no, role_code, practitioner_jsonb, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      practitionerData.display_name,
      practitionerData.npi_or_registration_no || null,
      practitionerData.role_code || null,
      this.toJSONB(practitionerData.practitioner_jsonb || {}),
      now,
      now
    ]);
  }

  // ========================================
  // Patient Operations
  // ========================================

  /**
   * Find patient by identifier
   */
  async findPatientByIdentifier(identifierSystem, identifierValue) {
    const query = `
      SELECT p.* FROM ${this.patientsTableName} p
      INNER JOIN ${this.patientIdentifiersTableName} pi ON p.id = pi.patient_id
      WHERE pi.identifier_system = $1 AND pi.identifier_value = $2
      LIMIT 1
    `;
    return await this.queryOne(query, [identifierSystem, identifierValue]);
  }

  /**
   * Create patient
   */
  async createPatient(patientData) {
    const id = patientData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.patientsTableName} (
        id, identity_state, source_mode, display_name, birth_date, sex_code,
        demographics_jsonb, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      patientData.identity_state || 'provisional',
      patientData.source_mode || null,
      patientData.display_name || null,
      patientData.birth_date || null,
      patientData.sex_code || null,
      this.toJSONB(patientData.demographics_jsonb || {}),
      now,
      now
    ]);
  }

  /**
   * Update patient
   */
  async updatePatient(patientId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = ['identity_state', 'source_mode', 'display_name', 'birth_date', 'sex_code'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = $${paramCount}`);
        values.push(updates[field]);
        paramCount++;
      }
    }

    if (updates.demographics_jsonb !== undefined) {
      fields.push(`demographics_jsonb = $${paramCount}`);
      values.push(this.toJSONB(updates.demographics_jsonb));
      paramCount++;
    }

    if (fields.length === 0) {
      return await this.findById(this.patientsTableName, patientId);
    }

    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date().toISOString());
    paramCount++;

    values.push(patientId);

    const query = `
      UPDATE ${this.patientsTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  // ========================================
  // Patient Identifier Operations
  // ========================================

  /**
   * Create patient identifier
   */
  async createPatientIdentifier(identifierData) {
    const id = identifierData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.patientIdentifiersTableName} (
        id, patient_id, identifier_system, identifier_value, identifier_type,
        assigning_authority, status, source_system, is_primary, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      identifierData.patient_id,
      identifierData.identifier_system,
      identifierData.identifier_value,
      identifierData.identifier_type || null,
      identifierData.assigning_authority || null,
      identifierData.status || 'observed',
      identifierData.source_system || null,
      identifierData.is_primary || false,
      now
    ]);
  }

  /**
   * Find patient identifiers by patient ID
   */
  async findPatientIdentifiersByPatientId(patientId) {
    return await this.query(
      `SELECT * FROM ${this.patientIdentifiersTableName} WHERE patient_id = $1 ORDER BY created_at ASC`,
      [patientId]
    );
  }

  // ========================================
  // Encounter Operations
  // ========================================

  /**
   * Find encounter by identifier
   */
  async findEncounterByIdentifier(identifierSystem, identifierValue) {
    const query = `
      SELECT e.* FROM ${this.encountersTableName} e
      INNER JOIN ${this.encounterIdentifiersTableName} ei ON e.id = ei.encounter_id
      WHERE ei.identifier_system = $1 AND ei.identifier_value = $2
      LIMIT 1
    `;
    return await this.queryOne(query, [identifierSystem, identifierValue]);
  }

  /**
   * Create encounter
   */
  async createEncounter(encounterData) {
    const id = encounterData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.encountersTableName} (
        id, patient_id, identity_state, source_mode, encounter_class, status,
        start_at, end_at, organization_id, location_id, practitioner_id,
        details_jsonb, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      encounterData.patient_id,
      encounterData.identity_state || 'provisional',
      encounterData.source_mode || null,
      encounterData.encounter_class || null,
      encounterData.status || null,
      encounterData.start_at || null,
      encounterData.end_at || null,
      encounterData.organization_id || null,
      encounterData.location_id || null,
      encounterData.practitioner_id || null,
      this.toJSONB(encounterData.details_jsonb || {}),
      now,
      now
    ]);
  }

  /**
   * Update encounter
   */
  async updateEncounter(encounterId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = ['identity_state', 'source_mode', 'encounter_class', 'status', 'start_at', 'end_at',
                           'organization_id', 'location_id', 'practitioner_id'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = $${paramCount}`);
        values.push(updates[field]);
        paramCount++;
      }
    }

    if (updates.details_jsonb !== undefined) {
      fields.push(`details_jsonb = $${paramCount}`);
      values.push(this.toJSONB(updates.details_jsonb));
      paramCount++;
    }

    if (fields.length === 0) {
      return await this.findById(this.encountersTableName, encounterId);
    }

    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date().toISOString());
    paramCount++;

    values.push(encounterId);

    const query = `
      UPDATE ${this.encountersTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  // ========================================
  // Encounter Identifier Operations
  // ========================================

  /**
   * Create encounter identifier
   */
  async createEncounterIdentifier(identifierData) {
    const id = identifierData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.encounterIdentifiersTableName} (
        id, encounter_id, identifier_system, identifier_value, identifier_type,
        assigning_authority, status, source_system, is_primary, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      identifierData.encounter_id,
      identifierData.identifier_system,
      identifierData.identifier_value,
      identifierData.identifier_type || null,
      identifierData.assigning_authority || null,
      identifierData.status || 'observed',
      identifierData.source_system || null,
      identifierData.is_primary || false,
      now
    ]);
  }

  /**
   * Find encounter identifiers by encounter ID
   */
  async findEncounterIdentifiersByEncounterId(encounterId) {
    return await this.query(
      `SELECT * FROM ${this.encounterIdentifiersTableName} WHERE encounter_id = $1 ORDER BY created_at ASC`,
      [encounterId]
    );
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Get repository statistics
   */
  async getStats() {
    const patientCount = await this.count(this.patientsTableName);
    const encounterCount = await this.count(this.encountersTableName);
    const practitionerCount = await this.count(this.practitionersTableName);

    const provisionalPatients = await this.queryOne(
      `SELECT COUNT(*) as count FROM ${this.patientsTableName} WHERE identity_state = 'provisional'`
    );

    return {
      patients: patientCount,
      encounters: encounterCount,
      practitioners: practitionerCount,
      provisionalPatients: parseInt(provisionalPatients.count) || 0
    };
  }

  // ========================================
  // Phase 5: Identity Reconciliation Methods
  // ========================================

  /**
   * Find patient identifiers by normalized value
   * Phase 5: Candidate discovery for reconciliation
   */
  async findPatientIdentifiersByNormalizedValue(normalizedValue) {
    const query = `
      SELECT * FROM ${this.patientIdentifiersTableName}
      WHERE LOWER(TRIM(identifier_value)) = LOWER(TRIM($1))
      ORDER BY created_at ASC
    `;
    return await this.query(query, [normalizedValue]);
  }

  /**
   * Find patient identifiers by system and normalized value
   * Phase 5: Exact-match candidate discovery for reconciliation
   */
  async findPatientIdentifiersBySystemAndNormalizedValue(identifierSystem, normalizedValue) {
    const query = `
      SELECT * FROM ${this.patientIdentifiersTableName}
      WHERE identifier_system = $1
        AND LOWER(TRIM(identifier_value)) = LOWER(TRIM($2))
      ORDER BY created_at ASC
    `;
    return await this.query(query, [identifierSystem, normalizedValue]);
  }

  /**
   * Find encounter identifiers by normalized value
   * Phase 5: Candidate discovery for reconciliation
   */
  async findEncounterIdentifiersByNormalizedValue(normalizedValue) {
    const query = `
      SELECT * FROM ${this.encounterIdentifiersTableName}
      WHERE LOWER(TRIM(identifier_value)) = LOWER(TRIM($1))
      ORDER BY created_at ASC
    `;
    return await this.query(query, [normalizedValue]);
  }

  /**
   * Find encounter identifiers by system and normalized value
   * Phase 5: Exact-match candidate discovery for reconciliation
   */
  async findEncounterIdentifiersBySystemAndNormalizedValue(identifierSystem, normalizedValue) {
    const query = `
      SELECT * FROM ${this.encounterIdentifiersTableName}
      WHERE identifier_system = $1
        AND LOWER(TRIM(identifier_value)) = LOWER(TRIM($2))
      ORDER BY created_at ASC
    `;
    return await this.query(query, [identifierSystem, normalizedValue]);
  }

  /**
   * List patients by identity state
   * Phase 5: Candidate discovery for reconciliation
   */
  async listPatientsByIdentityState(identityStates, options = {}) {
    const states = Array.isArray(identityStates) ? identityStates : [identityStates];
    const { limit = 1000, offset = 0 } = options;

    const query = `
      SELECT * FROM ${this.patientsTableName}
      WHERE identity_state = ANY($1)
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3
    `;
    return await this.query(query, [states, limit, offset]);
  }

  /**
   * List encounters by identity state
   * Phase 5: Candidate discovery for reconciliation
   */
  async listEncountersByIdentityState(identityStates, options = {}) {
    const states = Array.isArray(identityStates) ? identityStates : [identityStates];
    const { limit = 1000, offset = 0 } = options;

    const query = `
      SELECT * FROM ${this.encountersTableName}
      WHERE identity_state = ANY($1)
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3
    `;
    return await this.query(query, [states, limit, offset]);
  }

  /**
   * Count references for a patient across all tables
   * Phase 5: Reference counting for merge priority
   */
  async countReferencesForPatient(patientId) {
    const queries = [
      `SELECT COUNT(*) as count FROM encounters WHERE patient_id = $1`,
      `SELECT COUNT(*) as count FROM documents WHERE patient_id = $1`,
      `SELECT COUNT(*) as count FROM live_conversation_sessions WHERE patient_id = $1`,
      `SELECT COUNT(*) as count FROM interop_messages WHERE patient_id = $1`
    ];

    const [encounters, documents, sessions, messages] = await Promise.all(
      queries.map(q => this.queryOne(q, [patientId]))
    );

    return {
      encounters: parseInt(encounters.count) || 0,
      documents: parseInt(documents.count) || 0,
      live_conversation_sessions: parseInt(sessions.count) || 0,
      interop_messages: parseInt(messages.count) || 0,
      total: (parseInt(encounters.count) || 0) +
             (parseInt(documents.count) || 0) +
             (parseInt(sessions.count) || 0) +
             (parseInt(messages.count) || 0)
    };
  }

  /**
   * Count references for an encounter across all tables
   * Phase 5: Reference counting for merge priority
   */
  async countReferencesForEncounter(encounterId) {
    const queries = [
      `SELECT COUNT(*) as count FROM documents WHERE encounter_id = $1`,
      `SELECT COUNT(*) as count FROM live_conversation_sessions WHERE encounter_id = $1`,
      `SELECT COUNT(*) as count FROM interop_messages WHERE encounter_id = $1`
    ];

    const [documents, sessions, messages] = await Promise.all(
      queries.map(q => this.queryOne(q, [encounterId]))
    );

    return {
      documents: parseInt(documents.count) || 0,
      live_conversation_sessions: parseInt(sessions.count) || 0,
      interop_messages: parseInt(messages.count) || 0,
      total: (parseInt(documents.count) || 0) +
             (parseInt(sessions.count) || 0) +
             (parseInt(messages.count) || 0)
    };
  }

  async _queryRowsFromClient(client, text, params = []) {
    const result = await client.query(text, params);
    if (Array.isArray(result)) {
      return result;
    }
    return result?.rows || [];
  }

  async _queryOneFromClient(client, text, params = []) {
    if (typeof client.queryOne === 'function') {
      return await client.queryOne(text, params);
    }

    const rows = await this._queryRowsFromClient(client, text, params);
    return rows[0] || null;
  }

  /**
   * Update patient identifier status
   * Phase 5: Identifier status management
   */
  async updatePatientIdentifierStatus(identifierId, newStatus) {
    const validStatuses = ['observed', 'verified', 'deprecated'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid identifier status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`);
    }

    const query = `
      UPDATE ${this.patientIdentifiersTableName}
      SET status = $1
      WHERE id = $2
      RETURNING *
    `;
    return await this.queryOne(query, [newStatus, identifierId]);
  }

  /**
   * Update encounter identifier status
   * Phase 5: Identifier status management
   */
  async updateEncounterIdentifierStatus(identifierId, newStatus) {
    const validStatuses = ['observed', 'verified', 'deprecated'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid identifier status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`);
    }

    const query = `
      UPDATE ${this.encounterIdentifiersTableName}
      SET status = $1
      WHERE id = $2
      RETURNING *
    `;
    return await this.queryOne(query, [newStatus, identifierId]);
  }

  /**
   * Internal patient merge within existing transaction
   * Phase 5: Transactional merge for use within existing transaction
   * NOTE: This should NOT be called directly - use mergePatients() for standalone merges
   */
  async _mergePatientsInTransaction(client, winnerPatientId, loserPatientId, mergeMetadata = {}) {
    if (winnerPatientId === loserPatientId) {
      throw new Error('Cannot merge patient with itself');
    }

    const now = new Date().toISOString();

    // Fetch current patient states
    const winner = await this._queryOneFromClient(client, `SELECT * FROM ${this.patientsTableName} WHERE id = $1`, [winnerPatientId]);
    const loser = await this._queryOneFromClient(client, `SELECT * FROM ${this.patientsTableName} WHERE id = $1`, [loserPatientId]);

    if (!winner) {
      throw new Error(`Winner patient ${winnerPatientId} not found`);
    }
    if (!loser) {
      throw new Error(`Loser patient ${loserPatientId} not found`);
    }
    const winnerData = winner;
    const loserData = loser;

    // 1. Repoint foreign keys
    await client.query(`UPDATE encounters SET patient_id = $1 WHERE patient_id = $2`, [winnerPatientId, loserPatientId]);
    await client.query(`UPDATE documents SET patient_id = $1 WHERE patient_id = $2`, [winnerPatientId, loserPatientId]);
    await client.query(`UPDATE live_conversation_sessions SET patient_id = $1 WHERE patient_id = $2`, [winnerPatientId, loserPatientId]);
    await client.query(`UPDATE interop_messages SET patient_id = $1 WHERE patient_id = $2`, [winnerPatientId, loserPatientId]);

    // 2. Get all identifiers from both patients
    const loserIdentifiers = await this._queryRowsFromClient(
      client,
      `SELECT * FROM ${this.patientIdentifiersTableName} WHERE patient_id = $1`,
      [loserPatientId]
    );
    const winnerIdentifiers = await this._queryRowsFromClient(
      client,
      `SELECT * FROM ${this.patientIdentifiersTableName} WHERE patient_id = $1`,
      [winnerPatientId]
    );

    // 3. Move loser identifiers to winner, handle conflicts
    for (const loserId of loserIdentifiers) {
      // Check if winner already has identifier with same system and value
      const conflict = winnerIdentifiers.find(wid =>
        wid.identifier_system === loserId.identifier_system &&
        wid.identifier_value === loserId.identifier_value
      );

      if (conflict) {
        // Conflict exists: mark loser's identifier as deprecated
        await client.query(
          `UPDATE ${this.patientIdentifiersTableName} SET status = 'deprecated' WHERE id = $1`,
          [loserId.id]
        );
      } else {
        // No conflict: reassign identifier to winner
        await client.query(
          `UPDATE ${this.patientIdentifiersTableName} SET patient_id = $1 WHERE id = $2`,
          [winnerPatientId, loserId.id]
        );
      }
    }

    // 4. Update winner identity state to reconciled
    await client.query(`
      UPDATE ${this.patientsTableName}
      SET identity_state = 'reconciled',
          source_mode = CASE
            WHEN source_mode = 'internal' THEN 'merged'
            ELSE COALESCE(source_mode, 'merged')
          END,
          updated_at = NOW()
      WHERE id = $1
    `, [winnerPatientId]);

    // 5. Mark loser as inactive with merge trace
    const mergeTrace = {
      ...(typeof loserData.demographics_jsonb === 'string' ? JSON.parse(loserData.demographics_jsonb) : loserData.demographics_jsonb),
      _merge: {
        merged_into: winnerPatientId,
        merged_at: now,
        merge_reason: mergeMetadata.reason || 'identity_reconciliation',
        merge_metadata: mergeMetadata
      }
    };

    await client.query(`
      UPDATE ${this.patientsTableName}
      SET identity_state = 'inactive',
          demographics_jsonb = $1,
          updated_at = NOW()
      WHERE id = $2
    `, [this.toJSONB(mergeTrace), loserPatientId]);

    return {
      winner_id: winnerPatientId,
      loser_id: loserPatientId,
      merged_at: now,
      identifiers_moved: loserIdentifiers.length
    };
  }

  /**
   * Merge patients - winner keeps identifiers, loser becomes inactive
   * Phase 5: Safe merge with foreign key repointing
   */
  async mergePatients(winnerPatientId, loserPatientId, mergeMetadata = {}) {
    if (winnerPatientId === loserPatientId) {
      throw new Error('Cannot merge patient with itself');
    }

    // Execute merge in a transaction using internal method
    const result = await this.transaction(async (client) => {
      return await this._mergePatientsInTransaction(client, winnerPatientId, loserPatientId, mergeMetadata);
    });

    // Fetch and return the updated entities
    return {
      winner: await this.findById(this.patientsTableName, winnerPatientId),
      loser: await this.findById(this.patientsTableName, loserPatientId),
      merged_at: result.merged_at,
      identifiers_moved: result.identifiers_moved
    };
  }

  /**
   * Internal encounter merge within existing transaction
   * Phase 5: Transactional merge for use within existing transaction
   * NOTE: This should NOT be called directly - use mergeEncounters() for standalone merges
   */
  async _mergeEncountersInTransaction(client, winnerEncounterId, loserEncounterId, mergeMetadata = {}) {
    if (winnerEncounterId === loserEncounterId) {
      throw new Error('Cannot merge encounter with itself');
    }

    const now = new Date().toISOString();

    // Fetch current encounter states
    const winner = await this._queryOneFromClient(client, `SELECT * FROM ${this.encountersTableName} WHERE id = $1`, [winnerEncounterId]);
    const loser = await this._queryOneFromClient(client, `SELECT * FROM ${this.encountersTableName} WHERE id = $1`, [loserEncounterId]);

    if (!winner) {
      throw new Error(`Winner encounter ${winnerEncounterId} not found`);
    }
    if (!loser) {
      throw new Error(`Loser encounter ${loserEncounterId} not found`);
    }
    const winnerData = winner;
    const loserData = loser;

    // 1. Repoint foreign keys
    await client.query(`UPDATE documents SET encounter_id = $1 WHERE encounter_id = $2`, [winnerEncounterId, loserEncounterId]);
    await client.query(`UPDATE live_conversation_sessions SET encounter_id = $1 WHERE encounter_id = $2`, [winnerEncounterId, loserEncounterId]);
    await client.query(`UPDATE interop_messages SET encounter_id = $1 WHERE encounter_id = $2`, [winnerEncounterId, loserEncounterId]);

    // 2. Get all identifiers from both encounters
    const loserIdentifiers = await this._queryRowsFromClient(
      client,
      `SELECT * FROM ${this.encounterIdentifiersTableName} WHERE encounter_id = $1`,
      [loserEncounterId]
    );
    const winnerIdentifiers = await this._queryRowsFromClient(
      client,
      `SELECT * FROM ${this.encounterIdentifiersTableName} WHERE encounter_id = $1`,
      [winnerEncounterId]
    );

    // 3. Move loser identifiers to winner, handle conflicts
    for (const loserId of loserIdentifiers) {
      // Check if winner already has identifier with same system and value
      const conflict = winnerIdentifiers.find(wid =>
        wid.identifier_system === loserId.identifier_system &&
        wid.identifier_value === loserId.identifier_value
      );

      if (conflict) {
        // Conflict exists: mark loser's identifier as deprecated
        await client.query(
          `UPDATE ${this.encounterIdentifiersTableName} SET status = 'deprecated' WHERE id = $1`,
          [loserId.id]
        );
      } else {
        // No conflict: reassign identifier to winner
        await client.query(
          `UPDATE ${this.encounterIdentifiersTableName} SET encounter_id = $1 WHERE id = $2`,
          [winnerEncounterId, loserId.id]
        );
      }
    }

    // 4. Update winner identity state to reconciled
    await client.query(`
      UPDATE ${this.encountersTableName}
      SET identity_state = 'reconciled',
          source_mode = CASE
            WHEN source_mode = 'internal' THEN 'merged'
            ELSE COALESCE(source_mode, 'merged')
          END,
          updated_at = NOW()
      WHERE id = $1
    `, [winnerEncounterId]);

    // 5. Mark loser as inactive with merge trace
    const mergeTrace = {
      ...(typeof loserData.details_jsonb === 'string' ? JSON.parse(loserData.details_jsonb) : loserData.details_jsonb),
      _merge: {
        merged_into: winnerEncounterId,
        merged_at: now,
        merge_reason: mergeMetadata.reason || 'identity_reconciliation',
        merge_metadata: mergeMetadata
      }
    };

    await client.query(`
      UPDATE ${this.encountersTableName}
      SET identity_state = 'inactive',
          details_jsonb = $1,
          updated_at = NOW()
      WHERE id = $2
    `, [this.toJSONB(mergeTrace), loserEncounterId]);

    return {
      winner_id: winnerEncounterId,
      loser_id: loserEncounterId,
      merged_at: now,
      identifiers_moved: loserIdentifiers.length
    };
  }

  /**
   * Merge encounters - winner keeps identifiers, loser becomes inactive
   * Phase 5: Safe merge with foreign key repointing
   */
  async mergeEncounters(winnerEncounterId, loserEncounterId, mergeMetadata = {}) {
    if (winnerEncounterId === loserEncounterId) {
      throw new Error('Cannot merge encounter with itself');
    }

    // Execute merge in a transaction using internal method
    const result = await this.transaction(async (client) => {
      return await this._mergeEncountersInTransaction(client, winnerEncounterId, loserEncounterId, mergeMetadata);
    });

    // Fetch and return the updated entities
    return {
      winner: await this.findById(this.encountersTableName, winnerEncounterId),
      loser: await this.findById(this.encountersTableName, loserEncounterId),
      merged_at: result.merged_at,
      identifiers_moved: result.identifiers_moved
    };
  }

  /**
   * Find patients by identifier system and normalized value
   * Phase 5: Lookup patients for candidate discovery
   */
  async findPatientsByIdentifierSystemAndValue(system, normalizedValue) {
    const query = `
      SELECT DISTINCT p.* FROM ${this.patientsTableName} p
      INNER JOIN ${this.patientIdentifiersTableName} pi ON p.id = pi.patient_id
      WHERE pi.identifier_system = $1
        AND LOWER(TRIM(pi.identifier_value)) = LOWER(TRIM($2))
      ORDER BY p.created_at ASC
    `;
    return await this.query(query, [system, normalizedValue]);
  }

  /**
   * Find encounters by identifier system and normalized value
   * Phase 5: Lookup encounters for candidate discovery
   */
  async findEncountersByIdentifierSystemAndValue(system, normalizedValue) {
    const query = `
      SELECT DISTINCT e.* FROM ${this.encountersTableName} e
      INNER JOIN ${this.encounterIdentifiersTableName} ei ON e.id = ei.encounter_id
      WHERE ei.identifier_system = $1
        AND LOWER(TRIM(ei.identifier_value)) = LOWER(TRIM($2))
      ORDER BY e.created_at ASC
    `;
    return await this.query(query, [system, normalizedValue]);
  }

  /**
   * Check if patient has any deterministic identifiers
   * Phase 5: Candidate eligibility for reconciliation
   */
  async patientHasDeterministicIdentifiers(patientId) {
    const deterministicSystems = ['mrn', 'hospital_no', 'hospital_number'];
    const query = `
      SELECT COUNT(*) as count FROM ${this.patientIdentifiersTableName}
      WHERE patient_id = $1
        AND identifier_system = ANY($2)
    `;
    const result = await this.queryOne(query, [patientId, deterministicSystems]);
    return (parseInt(result.count) || 0) > 0;
  }

  /**
   * Check if encounter has any deterministic identifiers
   * Phase 5: Candidate eligibility for reconciliation
   */
  async encounterHasDeterministicIdentifiers(encounterId) {
    const deterministicSystems = ['episode_number', 'ipd_number', 'opd_number'];
    const query = `
      SELECT COUNT(*) as count FROM ${this.encounterIdentifiersTableName}
      WHERE encounter_id = $1
        AND identifier_system = ANY($2)
    `;
    const result = await this.queryOne(query, [encounterId, deterministicSystems]);
    return (parseInt(result.count) || 0) > 0;
  }

  // ========================================
  // Phase 5: Identity Reconciliation Cases
  // ========================================

  /**
   * Create identity reconciliation case
   * Phase 5: Case creation for ambiguous matches
   */
  async createReconciliationCase(caseData) {
    const id = caseData.id || this.generateId();
    const now = new Date().toISOString();

    const validEntityTypes = ['patient', 'encounter'];
    const validReasonCodes = [
      'multiple_patient_candidates',
      'multiple_encounter_candidates',
      'patient_encounter_mismatch',
      'trusted_identifier_conflict',
      'untrusted_external_identifier',
      'entity_already_in_review',
      'manual_review_required'
    ];

    if (!validEntityTypes.includes(caseData.entity_type)) {
      throw new Error(`Invalid entity_type: ${caseData.entity_type}`);
    }
    if (!validReasonCodes.includes(caseData.reason_code)) {
      throw new Error(`Invalid reason_code: ${caseData.reason_code}`);
    }

    const query = `
      INSERT INTO ${this.identityReconciliationCasesTableName} (
        id, entity_type, candidate_patient_id, candidate_encounter_id,
        source_system, reason_code, case_status, observed_identifiers_jsonb,
        candidate_matches_jsonb, resolution_jsonb, assigned_to_user_id,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      caseData.entity_type,
      caseData.candidate_patient_id || null,
      caseData.candidate_encounter_id || null,
      caseData.source_system || 'identity_reconciliation',
      caseData.reason_code,
      caseData.case_status || 'open',
      this.toJSONB(caseData.observed_identifiers || {}),
      this.toJSONB(caseData.candidate_matches || {}),
      this.toJSONB(caseData.resolution || {}),
      caseData.assigned_to_user_id || null,
      now,
      now
    ]);
  }

  /**
   * Find reconciliation cases by entity
   * Phase 5: Find open cases for a patient/encounter
   */
  async findReconciliationCasesByEntity(entityType, entityId, options = {}) {
    const { caseStatuses = ['open', 'in_review'] } = options;

    const query = `
      SELECT * FROM ${this.identityReconciliationCasesTableName}
      WHERE entity_type = $1
        AND (candidate_patient_id = $2 OR candidate_encounter_id = $2)
        AND case_status = ANY($3)
      ORDER BY created_at DESC
    `;
    return await this.query(query, [entityType, entityId, caseStatuses]);
  }

  /**
   * Find reconciliation case by ID
   * Phase 5: Case lookup
   */
  async findReconciliationCaseById(caseId) {
    return await this.findById(this.identityReconciliationCasesTableName, caseId);
  }

  /**
   * List reconciliation cases by filters
   * Phase 5: Case queue management
   */
  async listReconciliationCases(filters = {}, options = {}) {
    const {
      entity_type,
      case_status,
      reason_code,
      assigned_to_user_id
    } = filters;

    const { limit = 100, offset = 0, orderBy = 'created_at DESC' } = options;

    let whereClauses = [];
    let params = [];
    let paramCount = 1;

    if (entity_type) {
      whereClauses.push(`entity_type = $${paramCount}`);
      params.push(entity_type);
      paramCount++;
    }

    if (case_status) {
      whereClauses.push(`case_status = $${paramCount}`);
      params.push(case_status);
      paramCount++;
    }

    if (reason_code) {
      whereClauses.push(`reason_code = $${paramCount}`);
      params.push(reason_code);
      paramCount++;
    }

    if (assigned_to_user_id) {
      whereClauses.push(`assigned_to_user_id = $${paramCount}`);
      params.push(assigned_to_user_id);
      paramCount++;
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const query = `
      SELECT * FROM ${this.identityReconciliationCasesTableName}
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    params.push(limit, offset);

    return await this.query(query, params);
  }

  /**
   * Update reconciliation case status
   * Phase 5: Case lifecycle management
   */
  async updateReconciliationCaseStatus(caseId, newStatus, resolutionData = {}) {
    const validStatuses = ['open', 'in_review', 'resolved', 'deferred'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid case status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`);
    }

    // Set resolved_at when status is 'resolved'
    const resolvedAt = newStatus === 'resolved' ? 'NOW()' : 'resolved_at';

    const query = `
      UPDATE ${this.identityReconciliationCasesTableName}
      SET case_status = $1,
          resolution_jsonb = $2,
          updated_at = NOW(),
          resolved_at = ${resolvedAt}
      WHERE id = $3
      RETURNING *
    `;

    return await this.queryOne(query, [newStatus, this.toJSONB(resolutionData), caseId]);
  }

  /**
   * Assign reconciliation case to user
   * Phase 5: Case assignment
   */
  async assignReconciliationCase(caseId, userId) {
    const query = `
      UPDATE ${this.identityReconciliationCasesTableName}
      SET assigned_to_user_id = $1,
          case_status = 'in_review',
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    return await this.queryOne(query, [userId, caseId]);
  }

  /**
   * Get reconciliation case statistics
   * Phase 5: Reporting
   */
  async getReconciliationStats() {
    const totalCases = await this.count(this.identityReconciliationCasesTableName);

    const byStatus = await this.query(`
      SELECT case_status, COUNT(*) as count
      FROM ${this.identityReconciliationCasesTableName}
      GROUP BY case_status
      ORDER BY count DESC
    `);

    const byReason = await this.query(`
      SELECT reason_code, COUNT(*) as count
      FROM ${this.identityReconciliationCasesTableName}
      GROUP BY reason_code
      ORDER BY count DESC
    `);

    const byEntityType = await this.query(`
      SELECT entity_type, COUNT(*) as count
      FROM ${this.identityReconciliationCasesTableName}
      GROUP BY entity_type
      ORDER BY count DESC
    `);

    return {
      total: totalCases,
      byStatus,
      byReason,
      byEntityType
    };
  }

  /**
   * Count patients by identity state
   * Phase 5: Reporting
   */
  async countPatientsByIdentityState(identityState) {
    return await this.count(this.patientsTableName, { identity_state: identityState });
  }

  /**
   * Count encounters by identity state
   * Phase 5: Reporting
   */
  async countEncountersByIdentityState(identityState) {
    return await this.count(this.encountersTableName, { identity_state: identityState });
  }

  /**
   * Find all identifiers for a patient with status
   * Phase 5: Identifier analysis for reconciliation
   */
  async findPatientIdentifiersWithStatus(patientId) {
    const query = `
      SELECT * FROM ${this.patientIdentifiersTableName}
      WHERE patient_id = $1
      ORDER BY
        CASE status
          WHEN 'verified' THEN 1
          WHEN 'observed' THEN 2
          WHEN 'deprecated' THEN 3
          ELSE 4
        END,
        created_at ASC
    `;
    return await this.query(query, [patientId]);
  }

  /**
   * Find all identifiers for an encounter with status
   * Phase 5: Identifier analysis for reconciliation
   */
  async findEncounterIdentifiersWithStatus(encounterId) {
    const query = `
      SELECT * FROM ${this.encounterIdentifiersTableName}
      WHERE encounter_id = $1
      ORDER BY
        CASE status
          WHEN 'verified' THEN 1
          WHEN 'observed' THEN 2
          WHEN 'deprecated' THEN 3
          ELSE 4
        END,
        created_at ASC
    `;
    return await this.query(query, [encounterId]);
  }
}

module.exports = { MasterDataRepository };
