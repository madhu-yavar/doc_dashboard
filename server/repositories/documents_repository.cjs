/**
 * Documents Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles documents and related entities (assets, extractions, chart notes, prescriptions).
 * Provides PostgreSQL-based persistence while maintaining interface compatibility
 * with existing file-based document operations.
 *
 * Related Tables:
 * - documents (main table)
 * - document_assets (file references)
 * - document_extractions (versioned extraction results)
 * - chart_notes (versioned chart notes)
 * - prescription_artifacts (generated prescriptions)
 *
 * Phase 1: Create repository layer, do not change public routes
 * Phase 2: Add dual-write capability (file + PostgreSQL)
 * Phase 3: Backfill existing data
 * Phase 4: Read cutover to PostgreSQL
 */

const { BaseRepository } = require('./base_repository.cjs');

class DocumentsRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.documentsTableName = 'documents';
    this.documentAssetsTableName = 'document_assets';
    this.documentExtractionsTableName = 'document_extractions';
    this.chartNotesTableName = 'chart_notes';
    this.prescriptionArtifactsTableName = 'prescription_artifacts';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    // Verify tables exist
    const tablesExist = await this.tableExists(this.documentsTableName);
    if (!tablesExist) {
      throw new Error('Documents tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // Document Operations
  // ========================================

  /**
   * Read all documents (compatible with readDocuments function)
   */
  async readDocuments(options = {}) {
    const {
      limit = null,
      offset = null,
      orderBy = 'created_at DESC',
      where = {}
    } = options;

    let whereClause = '';
    let params = [];
    let limitClause = '';
    let offsetClause = '';

    // Build WHERE clause from options
    if (Object.keys(where).length > 0) {
      const conditions = Object.entries(where)
        .map(([key, value]) => {
          if (value === null) {
            return `${key} IS NULL`;
          } else if (typeof value === 'object' && value.$ne !== undefined) {
            return `${key} != $${params.length + 1}`;
          } else if (typeof value === 'object' && value.$in !== undefined) {
            return `${key} IN (${value.$in.map((_, i) => `$${params.length + 1 + i}`).join(', ')})`;
          } else {
            return `${key} = $${params.length + 1}`;
          }
        })
        .join(' AND ');
      whereClause = `WHERE ${conditions}`;
      params = [...params, ...Object.values(where).filter(v => typeof v !== 'object'), ...(where.$in || [])];
    }

    // Build LIMIT and OFFSET clauses
    if (limit !== null) {
      limitClause = `LIMIT ${limit}`;
    }
    if (offset !== null) {
      offsetClause = `OFFSET ${offset}`;
    }

    const query = `
      SELECT * FROM ${this.documentsTableName}
      ${whereClause}
      ORDER BY ${orderBy}
      ${limitClause}
      ${offsetClause}
    `;

    const documents = await this.query(query, params);

    // Convert to format compatible with existing code
    return documents.map(doc => ({
      id: doc.id,
      patient_id: doc.patient_id,
      encounter_id: doc.encounter_id,
      document_type: doc.document_type,
      document_subtype: doc.document_subtype,
      source_kind: doc.source_kind,
      status: doc.status,
      department: doc.department,
      name: doc.name,
      original_filename: doc.original_filename,
      mime_type: doc.mime_type,
      size_bytes: doc.size_bytes,
      sha256_hash: doc.sha256_hash,
      linked_patient_label: doc.linked_patient_label,
      encounter_label: doc.encounter_label,
      current_extraction_id: doc.current_extraction_id,
      current_transcript_id: doc.current_transcript_id,
      current_chart_note_id: doc.current_chart_note_id,
      last_audit_run_id: doc.last_audit_run_id,
      error_code: doc.error_code,
      error_message: doc.error_message,
      uploaded_at: doc.uploaded_at,
      processed_at: doc.processed_at,
      created_at: doc.created_at,
      updated_at: doc.updated_at
    }));
  }

  /**
   * Find document by ID
   */
  async findDocumentById(documentId) {
    return await this.findById(this.documentsTableName, documentId);
  }

  /**
   * Find document by SHA256 hash
   */
  async findDocumentByHash(hash) {
    return await this.queryOne(
      `SELECT * FROM ${this.documentsTableName} WHERE sha256_hash = $1`,
      [hash]
    );
  }

  /**
   * Find documents by patient ID
   */
  async findDocumentsByPatientId(patientId, options = {}) {
    return await this.findByColumn(this.documentsTableName, 'patient_id', patientId);
  }

  /**
   * Create new document
   */
  async createDocument(documentData) {
    const id = documentData.id || this.generateId();
    const now = new Date().toISOString();
    // Use provided timestamps if available (for backfill), otherwise use now
    const createdAt = documentData.created_at || now;
    const updatedAt = documentData.updated_at || now;

    const query = `
      INSERT INTO ${this.documentsTableName} (
        id, patient_id, encounter_id, document_type, document_subtype, source_kind, status,
        department, name, original_filename, mime_type, size_bytes, sha256_hash,
        linked_patient_label, encounter_label, current_extraction_id, current_transcript_id,
        current_chart_note_id, last_audit_run_id, error_code, error_message,
        uploaded_at, processed_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      documentData.patient_id || null,
      documentData.encounter_id || null,
      documentData.document_type || 'unknown',
      documentData.document_subtype || 'unknown',
      documentData.source_kind,
      documentData.status || 'pending',
      documentData.department || null,
      documentData.name,
      documentData.original_filename || null,
      documentData.mime_type || null,
      documentData.size_bytes || null,
      documentData.sha256_hash || null,
      documentData.linked_patient_label || null,
      documentData.encounter_label || null,
      documentData.current_extraction_id || null,
      documentData.current_transcript_id || null,
      documentData.current_chart_note_id || null,
      documentData.last_audit_run_id || null,
      documentData.error_code || null,
      documentData.error_message || null,
      documentData.uploaded_at || null,
      documentData.processed_at || null,
      createdAt,
      updatedAt
    ]);
  }

  /**
   * Update document
   */
  async updateDocument(documentId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    // Build dynamic UPDATE query
    const allowedFields = [
      'patient_id', 'encounter_id', 'document_type', 'document_subtype', 'source_kind',
      'status', 'department', 'name', 'original_filename', 'mime_type', 'size_bytes',
      'sha256_hash', 'linked_patient_label', 'encounter_label',
      'current_extraction_id', 'current_transcript_id', 'current_chart_note_id',
      'last_audit_run_id', 'error_code', 'error_message', 'uploaded_at', 'processed_at'
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = $${paramCount}`);
        values.push(updates[field]);
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return await this.findDocumentById(documentId);
    }

    // Always update updated_at
    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date().toISOString());
    paramCount++;

    values.push(documentId); // WHERE clause

    const query = `
      UPDATE ${this.documentsTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * Delete document
   */
  async deleteDocument(documentId) {
    // This will cascade to document_assets, document_extractions, etc. due to FK constraints
    const result = await this.execute(
      `DELETE FROM ${this.documentsTableName} WHERE id = $1`,
      [documentId]
    );
    return result > 0;
  }

  // ========================================
  // Document Assets Operations
  // ========================================

  /**
   * Create document asset
   */
  async createDocumentAsset(assetData) {
    const id = assetData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.documentAssetsTableName} (
        id, document_id, live_session_id, asset_role, storage_backend,
        path_or_uri, mime_type, size_bytes, sha256_hash, metadata_jsonb, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      assetData.document_id || null,
      assetData.live_session_id || null,
      assetData.asset_role,
      assetData.storage_backend || 'filesystem',
      assetData.path_or_uri,
      assetData.mime_type || null,
      assetData.size_bytes || null,
      assetData.sha256_hash || null,
      this.toJSONB(assetData.metadata || {}),
      now
    ]);
  }

  /**
   * Find assets by document ID
   */
  async findAssetsByDocumentId(documentId) {
    return await this.query(
      `SELECT * FROM ${this.documentAssetsTableName} WHERE document_id = $1 ORDER BY created_at ASC`,
      [documentId]
    );
  }

  /**
   * Find assets by live session ID
   */
  async findAssetsByLiveSessionId(sessionId) {
    return await this.query(
      `SELECT * FROM ${this.documentAssetsTableName} WHERE live_session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    );
  }

  /**
   * Find asset by ID
   */
  async findAssetById(assetId) {
    return await this.findById(this.documentAssetsTableName, assetId);
  }

  /**
   * Upsert document asset by ID
   */
  async upsertDocumentAsset(assetData) {
    const assetId = assetData.id || this.generateId();
    const existing = await this.findAssetById(assetId);

    if (existing) {
      const query = `
        UPDATE ${this.documentAssetsTableName}
        SET document_id = $1,
            live_session_id = $2,
            asset_role = $3,
            storage_backend = $4,
            path_or_uri = $5,
            mime_type = $6,
            size_bytes = $7,
            sha256_hash = $8,
            metadata_jsonb = $9
        WHERE id = $10
        RETURNING *
      `;

      return await this.queryOne(query, [
        assetData.document_id || null,
        assetData.live_session_id || null,
        assetData.asset_role,
        assetData.storage_backend || "filesystem",
        assetData.path_or_uri,
        assetData.mime_type || null,
        assetData.size_bytes || null,
        assetData.sha256_hash || null,
        this.toJSONB(assetData.metadata || {}),
        assetId,
      ]);
    }

    return await this.createDocumentAsset({
      ...assetData,
      id: assetId,
    });
  }

  /**
   * Delete assets for a live session
   */
  async deleteAssetsByLiveSessionId(sessionId, assetRole = null) {
    if (assetRole) {
      return await this.execute(
        `DELETE FROM ${this.documentAssetsTableName} WHERE live_session_id = $1 AND asset_role = $2`,
        [sessionId, assetRole]
      );
    }

    return await this.execute(
      `DELETE FROM ${this.documentAssetsTableName} WHERE live_session_id = $1`,
      [sessionId]
    );
  }

  // ========================================
  // Document Extractions Operations
  // ========================================

  /**
   * Create document extraction
   */
  async createDocumentExtraction(extractionData) {
    const id = extractionData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.documentExtractionsTableName} (
        id, document_id, version_no, status, agent_name, agent_version, audit_run_id,
        provider_tokens_jsonb, extracted_data_jsonb, dashboard_payload_jsonb, meta_jsonb,
        stage1_jsonb, stage3_jsonb, presentation_jsonb, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      extractionData.document_id,
      extractionData.version_no,
      extractionData.status || 'pending',
      extractionData.agent_name || null,
      extractionData.agent_version || null,
      extractionData.audit_run_id || null,
      this.toJSONB(extractionData.provider_tokens || {}),
      this.toJSONB(extractionData.extracted_data || {}),
      this.toJSONB(extractionData.dashboard_payload || {}),
      this.toJSONB(extractionData.meta || {}),
      this.toJSONB(extractionData.stage1 || {}),
      this.toJSONB(extractionData.stage3 || {}),
      this.toJSONB(extractionData.presentation || {}),
      now
    ]);
  }

  /**
   * Find current extraction for document
   */
  async findCurrentExtraction(documentId) {
    const document = await this.findDocumentById(documentId);
    if (!document || !document.current_extraction_id) {
      return null;
    }

    return await this.findById(this.documentExtractionsTableName, document.current_extraction_id);
  }

  /**
   * Find all extractions for a document
   */
  async findDocumentExtractions(documentId) {
    return await this.query(
      `SELECT * FROM ${this.documentExtractionsTableName} WHERE document_id = $1 ORDER BY version_no DESC`,
      [documentId]
    );
  }

  // ========================================
  // Chart Notes & Prescription Artifacts
  // ========================================

  /**
   * Create chart note
   */
  async createChartNote(chartNoteData) {
    const id = chartNoteData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.chartNotesTableName} (
        id, document_id, version_no, content, validation_jsonb, citations_jsonb,
        reasoning_steps_jsonb, tokens_used, generation_time_ms, audit_run_id,
        created_by_user_id, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      chartNoteData.document_id,
      chartNoteData.version_no,
      chartNoteData.content,
      this.toJSONB(chartNoteData.validation || {}),
      this.toJSONB(chartNoteData.citations || []),
      this.toJSONB(chartNoteData.reasoning_steps || []),
      chartNoteData.tokens_used || null,
      chartNoteData.generation_time_ms || null,
      chartNoteData.audit_run_id || null,
      chartNoteData.created_by_user_id || null,
      now
    ]);
  }

  /**
   * Find chart notes for document
   */
  async findChartNotesByDocumentId(documentId) {
    return await this.query(
      `SELECT * FROM ${this.chartNotesTableName} WHERE document_id = $1 ORDER BY version_no DESC`,
      [documentId]
    );
  }

  /**
   * Create prescription artifact
   */
  async createPrescriptionArtifact(prescriptionData) {
    const id = prescriptionData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.prescriptionArtifactsTableName} (
        id, document_id, version_no, prescription_payload_jsonb, html_asset_id,
        pdf_asset_id, created_by_user_id, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      prescriptionData.document_id,
      prescriptionData.version_no,
      this.toJSONB(prescriptionData.prescription_payload || {}),
      prescriptionData.html_asset_id || null,
      prescriptionData.pdf_asset_id || null,
      prescriptionData.created_by_user_id || null,
      now
    ]);
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Get repository statistics
   */
  async getStats() {
    const totalDocuments = await this.count(this.documentsTableName);
    const documentsByType = await this.query(`
      SELECT document_type, COUNT(*) as count
      FROM ${this.documentsTableName}
      GROUP BY document_type
      ORDER BY count DESC
    `);

    const documentsByStatus = await this.query(`
      SELECT status, COUNT(*) as count
      FROM ${this.documentsTableName}
      GROUP BY status
      ORDER BY count DESC
    `);

    return {
      totalDocuments,
      documentsByType,
      documentsByStatus
    };
  }

  /**
   * Search documents by content or metadata
   */
  async searchDocuments(searchTerm, options = {}) {
    const {
      searchIn = ['name', 'original_filename', 'linked_patient_label'],
      limit = 50
    } = options;

    const searchConditions = searchIn.map(field => `${field} ILIKE $1`);
    const searchParams = [`%${searchTerm}%`];

    const query = `
      SELECT * FROM ${this.documentsTableName}
      WHERE ${searchConditions.join(' OR ')}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return await this.query(query, searchParams);
  }
}

module.exports = { DocumentsRepository };
