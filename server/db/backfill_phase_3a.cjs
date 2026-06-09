/**
 * Phase 3A Backfill Script - Master Data + Identity
 *
 * Implements the Phase 3A backfill contract:
 * - Backfill users and auth_sessions
 * - Create practitioners for doctor users
 * - Harvest identity signals from documents and session stores
 * - Create provisional patients and encounters
 * - Create patient_identifiers and encounter_identifiers
 *
 * Usage: node server/db/backfill_phase_3a.cjs [--dry-run] [--report-only]
 *
 * Preconditions:
 * - Phase 0 schema exists and has been code-review approved
 * - Phase 1 repositories exist and have been code-review approved
 * - Phase 2A dual-write is stable
 *
 * Phase 3A Exit Gate:
 * - users row count matches users.json.users.length
 * - active auth_sessions count matches non-expired filesystem sessions
 * - every auth_sessions.user_id references an existing users.id
 * - doctor-role users have deterministic practitioner_id links
 * - admin users remain allowed to have practitioner_id = NULL
 * - every identifier row has source_system
 * - every identifier row is observed, not verified
 * - no patient or encounter was merged by name-only heuristics
 * - linkedPatient and encounterLabel were not inserted into identifier tables
 */

const fs = require('fs');
const path = require('path');
const { AuthRepository } = require('../repositories/auth_repository.cjs');
const { MasterDataRepository } = require('../repositories/master_data_repository.cjs');
const { postgresClient } = require('./postgres_client.cjs');

class Phase3ABackfill {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.reportOnly = options.reportOnly || false;
    this.storagePath = path.join(__dirname, '../storage');

    this.authRepo = new AuthRepository(postgresClient);
    this.masterDataRepo = new MasterDataRepository(postgresClient);

    this.report = {
      users: { inserted: 0, skipped: 0 },
      sessions: { inserted: 0, skippedExpired: 0, total: 0 },
      practitioners: { inserted: 0, linked: 0 },
      patients: { inserted: 0, bySource: {} },
      patientIdentifiers: { inserted: 0, skippedMalformed: 0, duplicates: 0 },
      encounters: { inserted: 0, bySource: {} },
      encounterIdentifiers: { inserted: 0, skippedMalformed: 0, duplicates: 0 },
      identitySignals: { documents: 0, voiceSessions: 0, liveSessions: 0, voiceSessionsSkipped: 0, liveSessionsSkipped: 0 },
      errors: []
    };
  }

  async initialize() {
    console.log('='.repeat(70));
    console.log('Phase 3A Backfill: Master Data + Identity');
    console.log('='.repeat(70));
    console.log(`Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE'}${this.reportOnly ? ' (REPORT ONLY)' : ''}`);
    console.log('='.repeat(70));
    console.log();

    await this.authRepo.initialize();
    await this.masterDataRepo.initialize();

    // Track start time
    this.startTime = Date.now();
  }

  /**
   * Load JSON storage file
   */
  loadStorageFile(filename) {
    const filePath = path.join(this.storagePath, filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`  ⚠️  File not found: ${filename}`);
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`  ✗ Failed to parse ${filename}:`, error.message);
      this.report.errors.push({ file: filename, error: error.message });
      return null;
    }
  }

  /**
   * Normalize identifier value for comparison
   */
  normalizeIdentifier(value) {
    if (value === null || value === undefined) return null;
    return String(value).toLowerCase().trim();
  }

  /**
   * Check if identifier is a valid candidate for identifier tables
   */
  isValidIdentifierCandidate(value, fieldName) {
    const normalized = this.normalizeIdentifier(value);
    if (!normalized || normalized.length < 2) return false;

    const allowedFields = new Set([
      'mrn',
      'hospital_no',
      'hospital_number',
      'ipd_number',
      'opd_number',
      'episode_number'
    ]);
    const placeholderValues = new Set(['null', 'undefined', 'na', 'n/a', 'unknown']);

    return allowedFields.has(fieldName) && !placeholderValues.has(normalized);
  }

  /**
   * Step 1: Backfill users
   */
  async backfillUsers() {
    console.log('Step 1: Backfilling users...');
    const usersData = this.loadStorageFile('users.json');
    if (!usersData || !usersData.users) {
      console.log('  ✗ No users found');
      return;
    }

    console.log(`  Found ${usersData.users.length} users in filesystem`);

    for (const user of usersData.users) {
      try {
        // Check if user already exists
        const existing = await this.authRepo.findUserByUsername(user.username);
        if (existing) {
          console.log(`  - User already exists: ${user.username}`);
          this.report.users.skipped++;
          continue;
        }

        if (!this.dryRun && !this.reportOnly) {
          await this.authRepo.createUser({
            id: user.id,
            username: user.username,
            password_hash: user.passwordHash,
            role: user.role,
            display_name: user.displayName,
            status: 'active',
            created_at: user.createdAt || new Date().toISOString()
          });
        }

        console.log(`  ✓ Backfilled user: ${user.username} (${user.role})`);
        this.report.users.inserted++;
      } catch (error) {
        console.error(`  ✗ Failed to backfill user ${user.username}:`, error.message);
        this.report.errors.push({ user: user.username, error: error.message });
      }
    }

    console.log(`  Users: ${this.report.users.inserted} inserted, ${this.report.users.skipped} skipped`);
    console.log();
  }

  /**
   * Step 2: Backfill active auth_sessions (skip expired)
   */
  async backfillAuthSessions() {
    console.log('Step 2: Backfilling active auth_sessions...');
    const sessionsData = this.loadStorageFile('auth_sessions.json');
    if (!sessionsData || !sessionsData.sessions) {
      console.log('  ✗ No sessions found');
      return;
    }

    console.log(`  Found ${sessionsData.sessions.length} sessions in filesystem`);
    this.report.sessions.total = sessionsData.sessions.length;

    const now = new Date();
    for (const session of sessionsData.sessions) {
      try {
        const expiresAt = new Date(session.expiresAt);

        // Skip expired sessions
        if (expiresAt < now) {
          console.log(`  - Skipping expired session: ${session.sessionId.substring(0, 8)}...`);
          this.report.sessions.skippedExpired++;
          continue;
        }

        // Check if session already exists
        const existing = await this.authRepo.findSessionByToken(session.sessionId);
        if (existing) {
          console.log(`  - Session already exists: ${session.sessionId.substring(0, 8)}...`);
          this.report.sessions.skipped++;
          continue;
        }

        if (!this.dryRun && !this.reportOnly) {
          await this.authRepo.createSession({
            id: session.sessionId,
            session_token: session.sessionId,
            user_id: session.userId,
            expires_at: session.expiresAt,
            last_seen_at: session.lastSeenAt || session.createdAt,
            created_at: session.createdAt
          });
        }

        console.log(`  ✓ Backfilled session for user: ${session.username}`);
        this.report.sessions.inserted++;
      } catch (error) {
        console.error(`  ✗ Failed to backfill session ${session.sessionId}:`, error.message);
        this.report.errors.push({ session: session.sessionId, error: error.message });
      }
    }

    console.log(`  Sessions: ${this.report.sessions.inserted} inserted, ${this.report.sessions.skippedExpired} expired skipped`);
    console.log();
  }

  /**
   * Step 3: Create practitioners for doctor users
   */
  async createPractitioners() {
    console.log('Step 3: Creating practitioners for doctor users...');
    const usersData = this.loadStorageFile('users.json');
    if (!usersData || !usersData.users) {
      console.log('  ✗ No users found');
      return;
    }

    for (const user of usersData.users) {
      // Only create practitioners for doctor roles
      if (user.role !== 'doctor') {
        console.log(`  - Skipping non-doctor user: ${user.username} (${user.role})`);
        continue;
      }

      try {
        // Check if practitioner already exists
        const existingByUserId = await this.masterDataRepo.findPractitionerByBackfillUserId(user.id);
        if (existingByUserId) {
          console.log(`  - Practitioner already exists for user: ${user.username}`);
          continue;
        }

        if (!this.dryRun && !this.reportOnly) {
          const practitioner = await this.masterDataRepo.createPractitioner({
            display_name: user.displayName || user.username,
            role_code: user.role,
            practitioner_jsonb: {
              backfill_user_id: user.id,
              source: 'phase_3a_backfill'
            }
          });

          // Link user to practitioner
          await this.authRepo.updateUser(user.id, {
            practitioner_id: practitioner.id
          });

          console.log(`  ✓ Created practitioner for user: ${user.username} -> ${practitioner.id}`);
          this.report.practitioners.linked++;
        } else {
          console.log(`  [DRY RUN] Would create practitioner for: ${user.username}`);
        }

        this.report.practitioners.inserted++;
      } catch (error) {
        console.error(`  ✗ Failed to create practitioner for ${user.username}:`, error.message);
        this.report.errors.push({ user: user.username, error: error.message });
      }
    }

    console.log(`  Practitioners: ${this.report.practitioners.inserted} created, ${this.report.practitioners.linked} linked`);
    console.log();
  }

  /**
   * Extract identity signals from document
   */
  extractDocumentIdentitySignals(document) {
    const signals = {
      linkedPatient: document.linkedPatient || null,
      encounterLabel: document.encounterLabel || null
    };

    // Extract from result.extracted_data.patient if present
    if (document.result && document.result.extracted_data && document.result.extracted_data.patient) {
      const patient = document.result.extracted_data.patient;
      signals.mrn = patient.mrn || null;
      signals.hospital_no = patient.hospital_no || patient.hospital_number || null;
      signals.ipd_number = patient.ipd_number || null;
      signals.opd_number = patient.opd_number || null;
      signals.episode_number = patient.episode_number || null;
    }

    // Extract from result.sample_patient_data if present
    if (document.result && document.result.sample_patient_data) {
      const samplePatient = document.result.sample_patient_data;
      signals.patientName = samplePatient.patient_name || samplePatient.patientName || samplePatient.name || signals.patientName || null;
      signals.mrn = samplePatient.mrn || signals.mrn || null;
      signals.hospital_no = samplePatient.hospital_no || samplePatient.hospital_number || signals.hospital_no || null;
      signals.ipd_number = samplePatient.ipd_number || signals.ipd_number || null;
      signals.opd_number = samplePatient.opd_number || signals.opd_number || null;
      signals.episode_number = samplePatient.episode_number || signals.episode_number || null;
    }

    // Extract from result.meta if present
    if (document.result && document.result.meta) {
      const meta = document.result.meta;
      signals.patientName = meta.patient_name || meta.patientName || signals.patientName || null;
      signals.mrn = meta.mrn || signals.mrn || null;
      signals.hospital_no = meta.hospital_no || meta.hospital_number || signals.hospital_no || null;
      signals.ipd_number = meta.ipd_number || signals.ipd_number || null;
      signals.opd_number = meta.opd_number || signals.opd_number || null;
      signals.episode_number = meta.episode_number || signals.episode_number || null;
    }

    return signals;
  }

  /**
   * Extract identity signals from voice session
   */
  extractVoiceSessionIdentitySignals(session) {
    const signals = {
      linkedPatient: session.linkedPatient || null,
      encounterLabel: session.encounterLabel || null
    };

    // Extract from extractedData.patient if present
    if (session.extractedData && session.extractedData.patient) {
      const patient = session.extractedData.patient;
      signals.patientName = patient.name || signals.patientName || null;
      signals.mrn = patient.mrn || null;
      signals.hospital_no = patient.hospital_no || patient.hospital_number || null;
      signals.ipd_number = patient.ipd_number || null;
      signals.opd_number = patient.opd_number || null;
      signals.episode_number = patient.episode_number || null;
    }

    // Extract from sample_patient_data if present
    const samplePatient = session.sample_patient_data || session.dashboardPayload?.sample_patient_data;
    if (samplePatient) {
      signals.patientName = samplePatient.patient_name || samplePatient.patientName || samplePatient.name || signals.patientName || null;
      signals.mrn = samplePatient.mrn || signals.mrn || null;
      signals.hospital_no = samplePatient.hospital_no || samplePatient.hospital_number || signals.hospital_no || null;
      signals.ipd_number = samplePatient.ipd_number || signals.ipd_number || null;
      signals.opd_number = samplePatient.opd_number || signals.opd_number || null;
      signals.episode_number = samplePatient.episode_number || signals.episode_number || null;
    }

    return signals;
  }

  /**
   * Extract identity signals from live conversation session
   */
  extractLiveSessionIdentitySignals(session) {
    const signals = {
      linkedPatient: session.linkedPatient || null,
      encounterLabel: session.encounterLabel || null
    };

    // Extract from draftExtraction.extractedData.patient if present
    if (session.draftExtraction && session.draftExtraction.extractedData && session.draftExtraction.extractedData.patient) {
      const patient = session.draftExtraction.extractedData.patient;
      signals.patientName = patient.name || signals.patientName || null;
      signals.mrn = patient.mrn || null;
      signals.hospital_no = patient.hospital_no || patient.hospital_number || null;
      signals.ipd_number = patient.ipd_number || null;
      signals.opd_number = patient.opd_number || null;
      signals.episode_number = patient.episode_number || null;
    }

    return signals;
  }

  /**
   * Steps 4-8: Harvest identity signals and create provisional patients/encounters
   */
  async harvestIdentityAndCreateProvisionalRecords() {
    console.log('Step 4-8: Harvesting identity signals and creating provisional records...');

    // Track unique patients and encounters by identifier
    const patientIdentifiersSeen = new Map(); // key: system:value, value: { patient_id, signals }
    const encounterIdentifiersSeen = new Map(); // key: system:value, value: { encounter_id, signals }
    const provisionalPatients = new Map(); // key: source_record_id, value: patient data
    const provisionalEncounters = new Map(); // key: source_record_id, value: encounter data

    // Track document IDs that already exist in canonical documents.json
    // to avoid creating duplicate provisional identities from session stores
    const canonicalDocumentIds = new Set();

    // Source priority: documents.json > voice_sessions.json > live_conversation_sessions.json

    // 1. Scan documents.json
    console.log('  Scanning documents.json...');
    const documentsData = this.loadStorageFile('documents.json');
    if (documentsData && documentsData.documents) {
      this.report.identitySignals.documents = documentsData.documents.length;
      for (const doc of documentsData.documents) {
        // Track canonical document IDs
        canonicalDocumentIds.add(doc.id);

        const signals = this.extractDocumentIdentitySignals(doc);
        await this.processIdentitySignals(
          signals,
          `document:${doc.id}`,
          patientIdentifiersSeen,
          encounterIdentifiersSeen,
          provisionalPatients,
          provisionalEncounters,
          'documents.json'
        );
      }
      console.log(`    Processed ${documentsData.documents.length} documents`);
    }

    // 2. Scan voice_sessions.json (only for signals NOT already in documents.json)
    console.log('  Scanning voice_sessions.json...');
    const voiceSessionsData = this.loadStorageFile('voice_sessions.json');
    if (voiceSessionsData && voiceSessionsData.sessions) {
      let voiceSessionsProcessed = 0;
      let voiceSessionsSkipped = 0;
      for (const session of voiceSessionsData.sessions) {
        // Skip sessions that already have a canonical document in documents.json
        // Check both session.documentId (explicit link) AND session.id (sessions can be their own canonical docs)
        if (
          (session.documentId && canonicalDocumentIds.has(session.documentId)) ||
          canonicalDocumentIds.has(session.id)
        ) {
          voiceSessionsSkipped++;
          continue;
        }

        voiceSessionsProcessed++;
        const signals = this.extractVoiceSessionIdentitySignals(session);
        await this.processIdentitySignals(
          signals,
          `voice_session:${session.id}`,
          patientIdentifiersSeen,
          encounterIdentifiersSeen,
          provisionalPatients,
          provisionalEncounters,
          'voice_sessions.json'
        );
      }
      this.report.identitySignals.voiceSessions = voiceSessionsProcessed;
      this.report.identitySignals.voiceSessionsSkipped = voiceSessionsSkipped;
      console.log(`    Processed ${voiceSessionsProcessed} voice sessions, skipped ${voiceSessionsSkipped} with canonical documents`);
    }

    // 3. Scan live_conversation_sessions.json (only for signals NOT already in documents.json)
    console.log('  Scanning live_conversation_sessions.json...');
    const liveSessionsData = this.loadStorageFile('live_conversation_sessions.json');
    if (liveSessionsData && liveSessionsData.sessions) {
      let liveSessionsProcessed = 0;
      let liveSessionsSkipped = 0;
      for (const session of liveSessionsData.sessions) {
        // Skip sessions that already have a canonical document in documents.json
        // Check both session.documentId (explicit link) AND session.id (sessions can be their own canonical docs)
        if (
          (session.documentId && canonicalDocumentIds.has(session.documentId)) ||
          canonicalDocumentIds.has(session.id)
        ) {
          liveSessionsSkipped++;
          continue;
        }

        liveSessionsProcessed++;
        const signals = this.extractLiveSessionIdentitySignals(session);
        await this.processIdentitySignals(
          signals,
          `live_session:${session.id}`,
          patientIdentifiersSeen,
          encounterIdentifiersSeen,
          provisionalPatients,
          provisionalEncounters,
          'live_conversation_sessions.json'
        );
      }
      this.report.identitySignals.liveSessions = liveSessionsProcessed;
      this.report.identitySignals.liveSessionsSkipped = liveSessionsSkipped;
      console.log(`    Processed ${liveSessionsProcessed} live sessions, skipped ${liveSessionsSkipped} with canonical documents`);
    }

    console.log(`  Total identity signals: ${this.report.identitySignals.documents} documents, ` +
                `${this.report.identitySignals.voiceSessions} voice sessions, ` +
                `${this.report.identitySignals.liveSessions} live sessions`);
    console.log();

    // Step 9: Create provisional patients
    console.log('Step 9: Creating provisional patients...');
    for (const [sourceRecordId, patientData] of provisionalPatients) {
      await this.createPatientWithIdentifiers(patientData);
    }
    console.log(`  Patients: ${this.report.patients.inserted} created`);
    console.log();

    // Step 10: Create provisional encounters
    console.log('Step 10: Creating provisional encounters...');
    for (const [sourceRecordId, encounterData] of provisionalEncounters) {
      await this.createEncounterWithIdentifiers(encounterData);
    }
    console.log(`  Encounters: ${this.report.encounters.inserted} created`);
    console.log();
  }

  /**
   * Process identity signals and populate provisional record maps
   */
  async processIdentitySignals(signals, sourceRecordId, patientIdentifiersSeen, encounterIdentifiersSeen, provisionalPatients, provisionalEncounters, sourceSystem) {
    // Patient natural-key strategy: mrn > hospital_no/hospital_number
    let patientIdentifierKey = null;
    let patientIdentifierType = null;

    if (signals.mrn && this.isValidIdentifierCandidate(signals.mrn, 'mrn')) {
      patientIdentifierKey = `mrn:${this.normalizeIdentifier(signals.mrn)}`;
      patientIdentifierType = 'mrn';
    } else if (signals.hospital_no && this.isValidIdentifierCandidate(signals.hospital_no, 'hospital_no')) {
      patientIdentifierKey = `hospital_no:${this.normalizeIdentifier(signals.hospital_no)}`;
      patientIdentifierType = 'hospital_no';
    }

    // Encounter natural-key strategy: episode_number > ipd_number > opd_number
    let encounterIdentifierKey = null;
    let encounterIdentifierType = null;

    if (signals.episode_number && this.isValidIdentifierCandidate(signals.episode_number, 'episode_number')) {
      encounterIdentifierKey = `episode_number:${this.normalizeIdentifier(signals.episode_number)}`;
      encounterIdentifierType = 'episode_number';
    } else if (signals.ipd_number && this.isValidIdentifierCandidate(signals.ipd_number, 'ipd_number')) {
      encounterIdentifierKey = `ipd_number:${this.normalizeIdentifier(signals.ipd_number)}`;
      encounterIdentifierType = 'ipd_number';
    } else if (signals.opd_number && this.isValidIdentifierCandidate(signals.opd_number, 'opd_number')) {
      encounterIdentifierKey = `opd_number:${this.normalizeIdentifier(signals.opd_number)}`;
      encounterIdentifierType = 'opd_number';
    }

    // Create or update patient
    if (patientIdentifierKey && !patientIdentifiersSeen.has(patientIdentifierKey)) {
      const patientId = this.masterDataRepo.generateId();
      patientIdentifiersSeen.set(patientIdentifierKey, {
        patient_id: patientId,
        identifier_type: patientIdentifierType,
        identifier_value: signals[patientIdentifierType]
      });

      provisionalPatients.set(sourceRecordId, {
        id: patientId,
        identifier_type: patientIdentifierType,
        identifier_value: signals[patientIdentifierType],
        linked_patient_label: signals.linkedPatient,
        source_system: sourceSystem,
        source_record_id: sourceRecordId,
        demographics: { name: signals.patientName || signals.linkedPatient }
      });
    } else if (!patientIdentifierKey && signals.linkedPatient) {
      // No deterministic identifier - create source-scoped provisional patient
      const patientId = this.masterDataRepo.generateId();
      provisionalPatients.set(sourceRecordId, {
        id: patientId,
        linked_patient_label: signals.linkedPatient,
        source_system: sourceSystem,
        source_record_id: sourceRecordId,
        demographics: { name: signals.linkedPatient }
      });
    }

    // Create or update encounter (only if we have a patient)
    if (encounterIdentifierKey && !encounterIdentifiersSeen.has(encounterIdentifierKey)) {
      const encounterId = this.masterDataRepo.generateId();
      encounterIdentifiersSeen.set(encounterIdentifierKey, {
        encounter_id: encounterId,
        identifier_type: encounterIdentifierType,
        identifier_value: signals[encounterIdentifierType]
      });

      // Link to patient (need to find patient ID from patientIdentifiersSeen or provisionalPatients)
      let patientId = null;
      if (patientIdentifierKey && patientIdentifiersSeen.has(patientIdentifierKey)) {
        patientId = patientIdentifiersSeen.get(patientIdentifierKey).patient_id;
      }
      if (!patientId && provisionalPatients.has(sourceRecordId)) {
        patientId = provisionalPatients.get(sourceRecordId).id;
      }

      if (patientId) {
        provisionalEncounters.set(sourceRecordId, {
          id: encounterId,
          patient_id: patientId,
          identifier_type: encounterIdentifierType,
          identifier_value: signals[encounterIdentifierType],
          encounter_label: signals.encounterLabel,
          source_system: sourceSystem,
          source_record_id: sourceRecordId
        });
      } else {
        console.log(`  ⚠️  Skipping encounter for ${sourceRecordId}: no patient available`);
      }
    } else if (!encounterIdentifierKey && signals.encounterLabel) {
      // No deterministic identifier - create source-scoped provisional encounter
      let patientId = null;
      if (patientIdentifierKey && patientIdentifiersSeen.has(patientIdentifierKey)) {
        patientId = patientIdentifiersSeen.get(patientIdentifierKey).patient_id;
      }
      // Also check if we have a provisional patient for this sourceRecordId
      if (!patientId && provisionalPatients.has(sourceRecordId)) {
        patientId = provisionalPatients.get(sourceRecordId).id;
      }

      // Only create encounter if we have a patient (NOT NULL constraint)
      if (patientId) {
        provisionalEncounters.set(sourceRecordId, {
          id: this.masterDataRepo.generateId(),
          patient_id: patientId,
          encounter_label: signals.encounterLabel,
          source_system: sourceSystem,
          source_record_id: sourceRecordId
        });
      } else {
        console.log(`  ⚠️  Skipping encounter for ${sourceRecordId}: no patient available`);
      }
    }
  }

  /**
   * Create patient with identifiers
   */
  async createPatientWithIdentifiers(patientData) {
    try {
      const sourceKey = patientData.source_system || 'unknown';
      this.report.patients.bySource[sourceKey] = (this.report.patients.bySource[sourceKey] || 0) + 1;

      if (!this.dryRun && !this.reportOnly) {
        // Create patient
        await this.masterDataRepo.createPatient({
          id: patientData.id,
          identity_state: 'provisional',
          source_mode: 'backfill',
          display_name: patientData.demographics?.name || patientData.linked_patient_label || 'Unknown Patient',
          demographics_jsonb: {
            ...patientData.demographics,
            linked_patient_label: patientData.linked_patient_label,
            source_system: patientData.source_system,
            source_record_id: patientData.source_record_id
          }
        });

        // Create identifier if we have a deterministic one
        if (patientData.identifier_type && patientData.identifier_value) {
          try {
            await this.masterDataRepo.createPatientIdentifier({
              patient_id: patientData.id,
              identifier_system: patientData.identifier_type,
              identifier_value: patientData.identifier_value,
              identifier_type: patientData.identifier_type,
              status: 'observed',
              source_system: patientData.source_system
            });
            this.report.patientIdentifiers.inserted++;
          } catch (error) {
            if (error.message.includes('unique constraint')) {
              this.report.patientIdentifiers.duplicates++;
            } else {
              this.report.patientIdentifiers.skippedMalformed++;
              this.report.errors.push({
                patient: patientData.id,
                error: error.message
              });
            }
          }
        }

        console.log(`  ✓ Created patient: ${patientData.id} from ${patientData.source_system}`);
      } else {
        console.log(`  [DRY RUN] Would create patient: ${patientData.id} from ${patientData.source_system}`);
        if (patientData.identifier_type && patientData.identifier_value) {
          this.report.patientIdentifiers.inserted++;
        }
      }

      this.report.patients.inserted++;
    } catch (error) {
      console.error(`  ✗ Failed to create patient ${patientData.id}:`, error.message);
      this.report.errors.push({ patient: patientData.id, error: error.message });
    }
  }

  /**
   * Create encounter with identifiers
   */
  async createEncounterWithIdentifiers(encounterData) {
    try {
      const sourceKey = encounterData.source_system || 'unknown';
      this.report.encounters.bySource[sourceKey] = (this.report.encounters.bySource[sourceKey] || 0) + 1;

      if (!this.dryRun && !this.reportOnly) {
        // Create encounter
        await this.masterDataRepo.createEncounter({
          id: encounterData.id,
          patient_id: encounterData.patient_id,
          identity_state: 'provisional',
          source_mode: 'backfill',
          details_jsonb: {
            encounter_label: encounterData.encounter_label,
            source_system: encounterData.source_system,
            source_record_id: encounterData.source_record_id
          }
        });

        // Create identifier if we have a deterministic one
        if (encounterData.identifier_type && encounterData.identifier_value) {
          try {
            await this.masterDataRepo.createEncounterIdentifier({
              encounter_id: encounterData.id,
              identifier_system: encounterData.identifier_type,
              identifier_value: encounterData.identifier_value,
              identifier_type: encounterData.identifier_type,
              status: 'observed',
              source_system: encounterData.source_system
            });
            this.report.encounterIdentifiers.inserted++;
          } catch (error) {
            if (error.message.includes('unique constraint')) {
              this.report.encounterIdentifiers.duplicates++;
            } else {
              this.report.encounterIdentifiers.skippedMalformed++;
              this.report.errors.push({
                encounter: encounterData.id,
                error: error.message
              });
            }
          }
        }

        console.log(`  ✓ Created encounter: ${encounterData.id} from ${encounterData.source_system}`);
      } else {
        console.log(`  [DRY RUN] Would create encounter: ${encounterData.id} from ${encounterData.source_system}`);
        if (encounterData.identifier_type && encounterData.identifier_value) {
          this.report.encounterIdentifiers.inserted++;
        }
      }

      this.report.encounters.inserted++;
    } catch (error) {
      console.error(`  ✗ Failed to create encounter ${encounterData.id}:`, error.message);
      this.report.errors.push({ encounter: encounterData.id, error: error.message });
    }
  }

  /**
   * Step 12: Emit backfill report
   */
  emitReport() {
    const duration = Date.now() - this.startTime;
    console.log('='.repeat(70));
    console.log('Phase 3A Backfill Report');
    console.log('='.repeat(70));
    console.log(`Duration: ${Math.round(duration / 1000)}s`);
    console.log(`Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE'}${this.reportOnly ? ' (REPORT ONLY)' : ''}`);
    console.log();
    console.log('Users:');
    console.log(`  Inserted: ${this.report.users.inserted}`);
    console.log(`  Skipped: ${this.report.users.skipped}`);
    console.log();
    console.log('Auth Sessions:');
    console.log(`  Total source records: ${this.report.sessions.total}`);
    console.log(`  Inserted: ${this.report.sessions.inserted}`);
    console.log(`  Skipped (expired): ${this.report.sessions.skippedExpired}`);
    console.log();
    console.log('Practitioners:');
    console.log(`  Created: ${this.report.practitioners.inserted}`);
    console.log(`  Linked to users: ${this.report.practitioners.linked}`);
    console.log();
    console.log('Patients:');
    console.log(`  Created: ${this.report.patients.inserted}`);
    console.log(`  By source: ${JSON.stringify(this.report.patients.bySource)}`);
    console.log()
    console.log('Patient Identifiers:');
    console.log(`  Inserted: ${this.report.patientIdentifiers.inserted}`);
    console.log(`  Skipped (malformed): ${this.report.patientIdentifiers.skippedMalformed}`);
    console.log(`  Duplicates handled: ${this.report.patientIdentifiers.duplicates}`);
    console.log();
    console.log('Encounters:');
    console.log(`  Created: ${this.report.encounters.inserted}`);
    console.log(`  By source: ${JSON.stringify(this.report.encounters.bySource)}`);
    console.log();
    console.log('Encounter Identifiers:');
    console.log(`  Inserted: ${this.report.encounterIdentifiers.inserted}`);
    console.log(`  Skipped (malformed): ${this.report.encounterIdentifiers.skippedMalformed}`);
    console.log(`  Duplicates handled: ${this.report.encounterIdentifiers.duplicates}`);
    console.log();
    console.log('Identity Signals Processed:');
    console.log(`  Documents: ${this.report.identitySignals.documents}`);
    console.log(`  Voice sessions: ${this.report.identitySignals.voiceSessions} processed, ${this.report.identitySignals.voiceSessionsSkipped} skipped (canonical docs exist)`);
    console.log(`  Live sessions: ${this.report.identitySignals.liveSessions} processed, ${this.report.identitySignals.liveSessionsSkipped} skipped (canonical docs exist)`);
    console.log();
    if (this.report.errors.length > 0) {
      console.log(`Errors (${this.report.errors.length}):`);
      this.report.errors.slice(0, 10).forEach(err => {
        console.log(`  - ${JSON.stringify(err)}`);
      });
      if (this.report.errors.length > 10) {
        console.log(`  ... and ${this.report.errors.length - 10} more`);
      }
      console.log();
    }
    console.log('='.repeat(70));
  }

  /**
   * Run the complete backfill
   */
  async run() {
    await this.initialize();

    try {
      await this.backfillUsers();
      await this.backfillAuthSessions();
      await this.createPractitioners();
      await this.harvestIdentityAndCreateProvisionalRecords();
      this.emitReport();
      console.log();
      console.log('✓ Phase 3A backfill completed');
    } catch (error) {
      console.error('✗ Phase 3A backfill failed:', error);
      throw error;
    } finally {
      // Only close the connection once (shared by both repositories)
      await this.authRepo.close();
      // masterDataRepo shares the same client, so don't close it again
    }
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    reportOnly: args.includes('--report-only')
  };

  const backfill = new Phase3ABackfill(options);
  backfill.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { Phase3ABackfill };
