/**
 * Phase 3B Backfill Script - Documents + Extractions
 *
 * Implements the Phase 3B backfill contract:
 * - Backfill documents from documents.json
 * - Create document_assets for file references
 * - Create document_extractions for processed documents
 * - Create chart_notes for cached chart notes
 * - Create prescription_artifacts for deterministically linked prescriptions
 *
 * Usage: node server/db/backfill_phase_3b.cjs [--dry-run] [--report-only]
 *
 * Preconditions:
 * - Phase 0 schema exists and has been code-review approved
 * - Phase 1 repositories exist and have been code-review approved
 * - Phase 2A dual-write is stable
 * - Phase 3A has already created provisional patient_id and encounter_id records
 *
 * Phase 3B Exit Gate:
 * - documents row count matches documents.json.documents.length
 * - every source document row has the expected normalized Postgres status
 * - every document with filePath and an existing file has an appropriate asset_role row (source_pdf, source_audio, etc.)
 * - every document with structured output has exactly one baseline extraction row
 * - documents.current_extraction_id is populated whenever an extraction exists
 * - cached chart notes, when present, have matching chart_notes rows
 * - prescription artifacts are backfilled only from deterministic document links
 * - no transcript/review/session rows were created by Phase 3B
 * - no delivery-history rows were guessed from alert preview payloads
 */

const fs = require('fs');
const path = require('path');
const { DocumentsRepository } = require('../repositories/documents_repository.cjs');
const { MasterDataRepository } = require('../repositories/master_data_repository.cjs');
const { postgresClient } = require('./postgres_client.cjs');

class Phase3BBackfill {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.reportOnly = options.reportOnly || false;
    this.storagePath = path.join(__dirname, '../storage');

    this.documentsRepo = new DocumentsRepository(postgresClient);
    this.masterDataRepo = new MasterDataRepository(postgresClient);

    this.report = {
      documents: { inserted: 0, updated: 0, skipped: 0, byStatus: {}, total: 0 },
      assets: { inserted: 0, byRole: {}, skippedMissing: 0 },
      extractions: { inserted: 0, skipped: 0 },
      chartNotes: { inserted: 0 },
      prescriptions: { inserted: 0, skipped: 0, filesMissing: 0 },
      errors: []
    };
  }

  async initialize() {
    console.log('='.repeat(70));
    console.log('Phase 3B Backfill: Documents + Extractions');
    console.log('='.repeat(70));
    console.log(`Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE'}${this.reportOnly ? ' (REPORT ONLY)' : ''}`);
    console.log('='.repeat(70));
    console.log();

    await this.documentsRepo.initialize();
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
   * Normalize document status from filesystem to Postgres
   */
  normalizeDocumentStatus(fsStatus) {
    const statusMap = {
      'queued': 'pending',
      'transcribing': 'processing',
      'processing': 'processing',
      'processed': 'completed',
      'partial': 'completed',
      'failed': 'failed'
    };

    const postgresStatus = statusMap[fsStatus];
    if (!postgresStatus) {
      throw new Error(`Unrecognized document status: ${fsStatus}`);
    }

    return postgresStatus;
  }

  /**
   * Infer document type from document row
   */
  inferDocumentType(document) {
    // Use precedence: documentType > result.meta.document_type > result.stage1.detected_type > unknown
    if (document.documentType) {
      // Map filesystem values to Postgres enum values
      if (document.documentType === 'voice') return 'voice_dictation';
      if (document.documentType === 'live_conversation') return 'live_conversation';
      return document.documentType;
    }
    if (document.result && document.result.meta && document.result.meta.document_type) {
      return this.mapDocumentTypeToEnum(document.result.meta.document_type);
    }
    if (document.result && document.result.stage1 && document.result.stage1.detected_type) {
      return this.mapDocumentTypeToEnum(document.result.stage1.detected_type);
    }
    return 'unknown';
  }

  /**
   * Map document type to Postgres enum value
   */
  mapDocumentTypeToEnum(type) {
    if (type === 'voice') return 'voice_dictation';
    if (type === 'live_conversation') return 'live_conversation';
    return type;
  }

  /**
   * Infer document subtype from document row
   */
  inferDocumentSubtype(document) {
    // "live_conversation" is not a valid subtype enum value
    if (document.documentSubtype === 'live_conversation') {
      return 'unknown';
    }
    return document.documentSubtype || 'unknown';
  }

  /**
   * Infer source_kind from document row
   */
  inferSourceKind(document) {
    // Map based on row shape characteristics
    if (document.documentSubtype === 'live_conversation' || document.documentType === 'live_conversation') {
      return 'live_conversation';
    }
    if (document.documentType === 'voice' || document.mimeType?.startsWith('audio/')) {
      return 'voice_upload';
    }
    if (document.filePath || document.mimeType === 'application/pdf') {
      return 'pdf_upload';
    }
    return 'pdf_upload'; // Default assumption
  }

  /**
   * Find patient_id by deterministic identifier (MRN, hospital_no, etc.)
   */
  async findPatientIdByIdentifier(document) {
    // Try to find patient by deterministic identifiers from result.extracted_data
    const identifiers = [];

    if (document.result && document.result.extracted_data && document.result.extracted_data.patient) {
      const patient = document.result.extracted_data.patient;
      if (patient.mrn) identifiers.push({ value: patient.mrn, system: 'mrn' });
      if (patient.hospital_no || patient.hospital_number) identifiers.push({ value: patient.hospital_no || patient.hospital_number, system: 'hospital_no' });
    }

    if (document.result && document.result.sample_patient_data) {
      const sample = document.result.sample_patient_data;
      if (sample.mrn) identifiers.push({ value: sample.mrn, system: 'mrn' });
      if (sample.hospital_no || sample.hospital_number) {
        identifiers.push({ value: sample.hospital_no || sample.hospital_number, system: 'hospital_no' });
      }
    }

    if (document.result && document.result.meta) {
      const meta = document.result.meta;
      if (meta.mrn) identifiers.push({ value: meta.mrn, system: 'mrn' });
      if (meta.hospital_no || meta.hospital_number) {
        identifiers.push({ value: meta.hospital_no || meta.hospital_number, system: 'hospital_no' });
      }
    }

    // Search for each identifier
    for (const identifier of identifiers) {
      const result = await this.documentsRepo.queryOne(
        `SELECT pi.patient_id FROM patient_identifiers pi WHERE pi.identifier_value = $1 AND pi.identifier_system = $2 LIMIT 1`,
        [identifier.value, identifier.system]
      );
      if (result) return result.patient_id;
    }

    return null;
  }

  /**
   * Find encounter_id by deterministic identifier (episode_number, ipd_number, opd_number)
   */
  async findEncounterIdByIdentifier(document) {
    // Try to find encounter by deterministic identifiers from result.extracted_data
    const identifiers = [];

    if (document.result && document.result.extracted_data && document.result.extracted_data.patient) {
      const patient = document.result.extracted_data.patient;
      if (patient.episode_number) identifiers.push({ value: patient.episode_number, system: 'episode_number' });
      if (patient.ipd_number) identifiers.push({ value: patient.ipd_number, system: 'ipd_number' });
      if (patient.opd_number) identifiers.push({ value: patient.opd_number, system: 'opd_number' });
    }

    if (document.result && document.result.sample_patient_data) {
      const sample = document.result.sample_patient_data;
      if (sample.episode_number) identifiers.push({ value: sample.episode_number, system: 'episode_number' });
      if (sample.ipd_number) identifiers.push({ value: sample.ipd_number, system: 'ipd_number' });
      if (sample.opd_number) identifiers.push({ value: sample.opd_number, system: 'opd_number' });
    }

    if (document.result && document.result.meta) {
      const meta = document.result.meta;
      if (meta.episode_number) identifiers.push({ value: meta.episode_number, system: 'episode_number' });
      if (meta.ipd_number) identifiers.push({ value: meta.ipd_number, system: 'ipd_number' });
      if (meta.opd_number) identifiers.push({ value: meta.opd_number, system: 'opd_number' });
    }

    // Search for each identifier
    for (const identifier of identifiers) {
      const result = await this.documentsRepo.queryOne(
        `SELECT ei.encounter_id FROM encounter_identifiers ei WHERE ei.identifier_value = $1 AND ei.identifier_system = $2 LIMIT 1`,
        [identifier.value, identifier.system]
      );
      if (result) return result.encounter_id;
    }

    return null;
  }

  /**
   * Step 1: Snapshot current source counts
   */
  async snapshotSourceCounts() {
    console.log('Step 1: Snapshotting current source counts...');
    const documentsData = this.loadStorageFile('documents.json');

    if (documentsData && documentsData.documents) {
      this.report.documents.total = documentsData.documents.length;
      console.log(`  Source documents: ${documentsData.documents.length}`);
    }
    console.log();
  }

  /**
   * Step 2-4: Backfill documents and create source-file assets
   */
  async backfillDocuments() {
    console.log('Step 2-4: Backfilling documents and creating source-file assets...');
    const documentsData = this.loadStorageFile('documents.json');
    if (!documentsData || !documentsData.documents) {
      console.log('  ✗ No documents found');
      return;
    }

    console.log(`  Found ${documentsData.documents.length} documents in filesystem`);

    for (const doc of documentsData.documents) {
      try {
        // Check if document already exists
        const existing = await this.documentsRepo.findDocumentById(doc.id);
        if (existing) {
          console.log(`  - Document already exists: ${doc.id}`);
          this.report.documents.skipped++;
          continue;
        }

        // Normalize status
        const status = this.normalizeDocumentStatus(doc.status);
        this.report.documents.byStatus[status] = (this.report.documents.byStatus[status] || 0) + 1;

        // Infer document type and source kind
        const documentType = this.inferDocumentType(doc);
        const sourceKind = this.inferSourceKind(doc);
        const documentSubtype = this.inferDocumentSubtype(doc);

        // Find patient_id and encounter_id from Phase 3A provisional records.
        // Labels remain labels only; deterministic links come from identifier tables.
        let patientId = await this.findPatientIdByIdentifier(doc);
        let encounterId = await this.findEncounterIdByIdentifier(doc);

        // Create document with source timestamps
        if (!this.dryRun && !this.reportOnly) {
          await this.documentsRepo.createDocument({
            id: doc.id,
            patient_id: patientId,
            encounter_id: encounterId,
            document_type: documentType,
            document_subtype: documentSubtype,
            source_kind: sourceKind,
            status: status,
            department: doc.department || null,
            name: doc.name,
            original_filename: doc.fileName || doc.name,
            mime_type: doc.mimeType || doc.fileType || null,
            size_bytes: doc.size || null,
            sha256_hash: doc.hash || null,
            linked_patient_label: doc.linkedPatient || null,
            encounter_label: doc.encounterLabel || null,
            error_code: null,
            error_message: doc.error || null,
            uploaded_at: doc.uploadedAt || null,
            processed_at: doc.processedAt || null,
            created_at: doc.uploadedAt || null,
            updated_at: doc.processedAt || doc.uploadedAt || null
          });

          // Create source asset if filePath exists
          if (doc.filePath) {
            await this.createSourceAsset(doc, doc.filePath);
          }

          console.log(`  ✓ Backfilled document: ${doc.id} (${documentType}, ${status})`);
        } else {
          console.log(`  [DRY RUN] Would backfill document: ${doc.id} (${documentType}, ${status})`);
        }

        this.report.documents.inserted++;
      } catch (error) {
        console.error(`  ✗ Failed to backfill document ${doc.id}:`, error.message);
        this.report.errors.push({ document: doc.id, error: error.message });
      }
    }

    console.log(`  Documents: ${this.report.documents.inserted} inserted, ${this.report.documents.skipped} skipped`);
    console.log(`  Assets: ${this.report.assets.inserted} created, ${this.report.assets.skippedMissing} skipped (missing files)`);
    console.log();
  }

  /**
   * Create source asset for document
   */
  async createSourceAsset(document, filePath) {
    try {
      // filePath is already an absolute path, don't join with storagePath
      const fullPath = filePath;
      const inferredSourceKind = this.inferSourceKind(document);

      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        console.log(`    ⚠️  File missing, skipping asset: ${filePath}`);
        this.report.assets.skippedMissing++;
        return null;
      }

      // Get file stats
      const stats = fs.statSync(fullPath);
      const assetId = this.documentsRepo.generateId();

      // Infer asset role from document type, mime type, and filePath extension
      let assetRole = 'other';
      if (inferredSourceKind === 'voice_upload') {
        assetRole = 'source_audio';
      } else if (
        inferredSourceKind === 'pdf_upload' ||
        document.mimeType?.includes('pdf') ||
        (filePath && (filePath.endsWith('.pdf') || filePath.toLowerCase().includes('.pdf'))
      )) {
        assetRole = 'source_pdf';
      }

      if (!this.dryRun && !this.reportOnly) {
        await this.documentsRepo.createDocumentAsset({
          id: assetId,
          document_id: document.id,
          asset_role: assetRole,
          storage_backend: 'filesystem',
          path_or_uri: fullPath,
          size_bytes: stats.size,
          metadata: { original_filename: document.fileName || document.name }
        });

        console.log(`    ✓ Created asset: ${assetId} for ${document.id}`);
      }

      this.report.assets.inserted++;
      this.report.assets.byRole[assetRole] = (this.report.assets.byRole[assetRole] || 0) + 1;
      return assetId;
    } catch (error) {
      console.error(`    ✗ Failed to create asset for ${document.id}:`, error.message);
      this.report.errors.push({ document: document.id, asset: filePath, error: error.message });
      return null;
    }
  }

  /**
   * Step 5-6: Create baseline document extractions
   */
  async backfillDocumentExtractions() {
    console.log('Step 5-6: Creating baseline document extractions...');
    const documentsData = this.loadStorageFile('documents.json');
    if (!documentsData || !documentsData.documents) {
      console.log('  ✗ No documents found');
      return;
    }

    for (const doc of documentsData.documents) {
      try {
        // Only create extraction for processed documents with structured output
        if (doc.status !== 'processed' && doc.status !== 'partial') {
          this.report.extractions.skipped++;
          continue;
        }

        if (!doc.result || !doc.result.extracted_data) {
          this.report.extractions.skipped++;
          continue;
        }

        // Check if extraction already exists
        const existing = await this.documentsRepo.findDocumentById(doc.id);
        if (!existing) {
          console.log(`  - Document not found, skipping extraction: ${doc.id}`);
          this.report.extractions.skipped++;
          continue;
        }

        if (existing.current_extraction_id) {
          console.log(`  - Extraction already exists: ${doc.id}`);
          this.report.extractions.skipped++;
          continue;
        }

        // Create extraction
        if (!this.dryRun && !this.reportOnly) {
          const extractionId = this.documentsRepo.generateId();

          await this.documentsRepo.createDocumentExtraction({
            id: extractionId,
            document_id: doc.id,
            version_no: 1,
            status: 'completed',
            agent_name: doc.agentInfo?.name || doc.result?.meta?.agent_name || null,
            agent_version: doc.agentInfo?.version || doc.result?.meta?.agent_version || null,
            provider_tokens: doc.agentInfo?.tokens || null,
            extracted_data: doc.result.extracted_data || {},
            dashboard_payload: doc.result.dashboard_cards || {},
            meta: doc.result.meta || {},
            stage1: doc.result.stage1 || {},
            stage3: doc.result.stage3 || {},
            presentation: doc.result.presentation || {}
          });

          // Update document.current_extraction_id
          await this.documentsRepo.updateDocument(doc.id, {
            current_extraction_id: extractionId
          });

          console.log(`  ✓ Created extraction: ${extractionId} for ${doc.id}`);
        } else {
          console.log(`  [DRY RUN] Would create extraction for: ${doc.id}`);
        }

        this.report.extractions.inserted++;
      } catch (error) {
        console.error(`  ✗ Failed to create extraction for ${doc.id}:`, error.message);
        this.report.errors.push({ document: doc.id, error: error.message });
      }
    }

    console.log(`  Extractions: ${this.report.extractions.inserted} created, ${this.report.extractions.skipped} skipped`);
    console.log();
  }

  /**
   * Step 7: Create chart notes for cached chart notes
   */
  async backfillChartNotes() {
    console.log('Step 7: Creating chart notes for cached chart notes...');
    const documentsData = this.loadStorageFile('documents.json');
    if (!documentsData || !documentsData.documents) {
      console.log('  ✗ No documents found');
      return;
    }

    for (const doc of documentsData.documents) {
      try {
        // Only create chart note if cached in document
        if (!doc.chartNote) {
          continue;
        }

        // Check if document exists
        const existing = await this.documentsRepo.findDocumentById(doc.id);
        if (!existing) {
          console.log(`  - Document not found, skipping chart note: ${doc.id}`);
          continue;
        }

        if (existing.current_chart_note_id) {
          console.log(`  - Chart note already exists: ${doc.id}`);
          continue;
        }

        // Create chart note
        if (!this.dryRun && !this.reportOnly) {
          const chartNoteId = this.documentsRepo.generateId();

          await this.documentsRepo.createChartNote({
            id: chartNoteId,
            document_id: doc.id,
            version_no: 1,
            content: doc.chartNote.content,
            validation: doc.chartNote.validation || {},
            citations: doc.chartNote.citations || [],
            reasoning_steps: doc.chartNote.reasoningSteps || [],
            tokens_used: doc.chartNote.tokensUsed || null,
            generation_time_ms: doc.chartNote.generationTime || null,
            audit_run_id: doc.chartNote.auditRunId || null
          });

          // Update document.current_chart_note_id
          await this.documentsRepo.updateDocument(doc.id, {
            current_chart_note_id: chartNoteId
          });

          console.log(`  ✓ Created chart note: ${chartNoteId} for ${doc.id}`);
        } else {
          console.log(`  [DRY RUN] Would create chart note for: ${doc.id}`);
        }

        this.report.chartNotes.inserted++;
      } catch (error) {
        console.error(`  ✗ Failed to create chart note for ${doc.id}:`, error.message);
        this.report.errors.push({ document: doc.id, error: error.message });
      }
    }

    console.log(`  Chart notes: ${this.report.chartNotes.inserted} created`);
    console.log();
  }

  /**
   * Step 8-11: Scan and backfill prescription artifacts
   */
  async backfillPrescriptionArtifacts() {
    console.log('Step 8-11: Scanning and backfilling prescription artifacts...');

    const prescriptionsDir = path.join(this.storagePath, 'prescriptions');
    if (!fs.existsSync(prescriptionsDir)) {
      console.log('  ✗ Prescriptions directory not found');
      return;
    }

    const files = fs.readdirSync(prescriptionsDir);
    const htmlFiles = files.filter(f => f.endsWith('.html'));
    const pdfFiles = files.filter(f => f.endsWith('.pdf'));

    console.log(`  Found ${htmlFiles.length} HTML files, ${pdfFiles.length} PDF files`);

    // Group prescription files by source document
    const prescriptionGroups = new Map();

    for (const htmlFile of htmlFiles) {
      try {
        const htmlPath = path.join(prescriptionsDir, htmlFile);
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        const { sourceDocumentId } = this.extractPrescriptionDataFromHtml(htmlContent);
        if (!sourceDocumentId) {
          console.log(`  - Skipping HTML without source document ID: ${htmlFile}`);
          this.report.prescriptions.skipped++;
          continue;
        }

        if (!prescriptionGroups.has(sourceDocumentId)) {
          prescriptionGroups.set(sourceDocumentId, []);
        }

        prescriptionGroups.get(sourceDocumentId).push({
          type: 'html',
          file: htmlFile,
          path: path.join('prescriptions', htmlFile)
        });
      } catch (error) {
        console.error(`  ✗ Failed to parse HTML ${htmlFile}:`, error.message);
        this.report.prescriptions.skipped++;
      }
    }

    // Match PDF files to HTML groups
    for (const pdfFile of pdfFiles) {
      const baseName = pdfFile.replace('.pdf', '');
      let matched = false;

      for (const [sourceDocId, files] of prescriptionGroups) {
        if (files.some(f => f.file.startsWith(baseName))) {
          files.push({
            type: 'pdf',
            file: pdfFile,
            path: path.join('prescriptions', pdfFile)
          });
          matched = true;
          break;
        }
      }

      if (!matched) {
        console.log(`  - Skipping unmatched PDF: ${pdfFile}`);
        this.report.prescriptions.skipped++;
      }
    }

    // Create prescription artifacts for deterministic groups
    for (const [sourceDocumentId, files] of prescriptionGroups) {
      await this.createPrescriptionArtifact(sourceDocumentId, files);
    }

    console.log(`  Prescriptions: ${this.report.prescriptions.inserted} created, ${this.report.prescriptions.skipped} skipped`);
    console.log();
  }

  /**
   * Create prescription artifact for a document
   */
  async createPrescriptionArtifact(documentId, files) {
    try {
      // Check if document exists
      const document = await this.documentsRepo.findDocumentById(documentId);
      if (!document) {
        console.log(`  - Document not found, skipping prescription: ${documentId}`);
        this.report.prescriptions.skipped++;
        return;
      }

      const htmlFile = files.find(f => f.type === 'html');
      const pdfFile = files.find(f => f.type === 'pdf');

      if (!htmlFile) {
        console.log(`  - No HTML file found for ${documentId}`);
        this.report.prescriptions.skipped++;
        return;
      }

      // Read prescription data from HTML
      const htmlPath = path.join(this.storagePath, htmlFile.path);
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const { prescriptionPayload } = this.extractPrescriptionDataFromHtml(htmlContent);

      if (!this.dryRun && !this.reportOnly) {
        // Create assets
        let htmlAssetId = null;
        let pdfAssetId = null;

        const htmlStats = fs.statSync(htmlPath);
        htmlAssetId = this.documentsRepo.generateId();
        await this.documentsRepo.createDocumentAsset({
          id: htmlAssetId,
          document_id: documentId,
          asset_role: 'prescription_html',
          storage_backend: 'filesystem',
          path_or_uri: htmlFile.path,
          size_bytes: htmlStats.size,
          metadata: { original_filename: htmlFile.file }
        });

        if (pdfFile) {
          const pdfPath = path.join(this.storagePath, pdfFile.path);
          if (fs.existsSync(pdfPath)) {
            const pdfStats = fs.statSync(pdfPath);
            pdfAssetId = this.documentsRepo.generateId();
            await this.documentsRepo.createDocumentAsset({
              id: pdfAssetId,
              document_id: documentId,
              asset_role: 'prescription_pdf',
              storage_backend: 'filesystem',
              path_or_uri: pdfFile.path,
              size_bytes: pdfStats.size,
              metadata: { original_filename: pdfFile.file }
            });
          }
        }

        // Create prescription artifact with proper versioning
        // Find existing prescription artifacts for this document to determine next version
        const existingArtifacts = await this.documentsRepo.query(
          `SELECT MAX(version_no) as max_version FROM prescription_artifacts WHERE document_id = $1`,
          [documentId]
        );
        const nextVersion = (existingArtifacts[0]?.max_version || 0) + 1;

        const artifactId = this.documentsRepo.generateId();
        await this.documentsRepo.createPrescriptionArtifact({
          id: artifactId,
          document_id: documentId,
          version_no: nextVersion,
          prescription_payload: prescriptionPayload,
          html_asset_id: htmlAssetId,
          pdf_asset_id: pdfAssetId
        });

        console.log(`  ✓ Created prescription artifact: ${artifactId} v${nextVersion} for ${documentId}`);
      } else {
        console.log(`  [DRY RUN] Would create prescription artifact for: ${documentId}`);
      }

      this.report.prescriptions.inserted++;
      this.report.assets.byRole['prescription_html'] = (this.report.assets.byRole['prescription_html'] || 0) + 1;
      if (pdfFile) {
        this.report.assets.byRole['prescription_pdf'] = (this.report.assets.byRole['prescription_pdf'] || 0) + 1;
      }
    } catch (error) {
      console.error(`  ✗ Failed to create prescription artifact for ${documentId}:`, error.message);
      this.report.errors.push({ document: documentId, error: error.message });
    }
  }

  /**
   * Extract prescription payload and deterministic sourceDocumentId from HTML.
   */
  extractPrescriptionDataFromHtml(htmlContent) {
    const prescriptionDataMatch = htmlContent.match(/window\.prescriptionData\s*=\s*({[\s\S]*?});/);
    if (!prescriptionDataMatch) {
      return { sourceDocumentId: null, prescriptionPayload: {} };
    }

    try {
      const prescriptionPayload = JSON.parse(prescriptionDataMatch[1]);
      const metadata = prescriptionPayload._metadata || prescriptionPayload.metadata || {};
      return {
        sourceDocumentId: metadata.sourceDocumentId || null,
        prescriptionPayload
      };
    } catch (error) {
      return { sourceDocumentId: null, prescriptionPayload: {} };
    }
  }

  /**
   * Step 12: Emit backfill report
   */
  emitReport() {
    const duration = Date.now() - this.startTime;
    console.log('='.repeat(70));
    console.log('Phase 3B Backfill Report');
    console.log('='.repeat(70));
    console.log(`Duration: ${Math.round(duration / 1000)}s`);
    console.log(`Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE'}${this.reportOnly ? ' (REPORT ONLY)' : ''}`);
    console.log();
    console.log('Documents:');
    console.log(`  Total source records: ${this.report.documents.total}`);
    console.log(`  Inserted: ${this.report.documents.inserted}`);
    console.log(`  Updated: ${this.report.documents.updated}`);
    console.log(`  Skipped: ${this.report.documents.skipped}`);
    console.log(`  By status: ${JSON.stringify(this.report.documents.byStatus)}`);
    console.log();
    console.log('Document Assets:');
    console.log(`  Inserted: ${this.report.assets.inserted}`);
    console.log(`  By role: ${JSON.stringify(this.report.assets.byRole)}`);
    console.log(`  Skipped (missing files): ${this.report.assets.skippedMissing}`);
    console.log();
    console.log('Document Extractions:');
    console.log(`  Inserted: ${this.report.extractions.inserted}`);
    console.log(`  Skipped: ${this.report.extractions.skipped}`);
    console.log();
    console.log('Chart Notes:');
    console.log(`  Inserted: ${this.report.chartNotes.inserted}`);
    console.log();
    console.log('Prescription Artifacts:');
    console.log(`  Inserted: ${this.report.prescriptions.inserted}`);
    console.log(`  Skipped: ${this.report.prescriptions.skipped}`);
    console.log(`  Files missing: ${this.report.prescriptions.filesMissing}`);
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
      await this.snapshotSourceCounts();
      await this.backfillDocuments();
      await this.backfillDocumentExtractions();
      await this.backfillChartNotes();
      await this.backfillPrescriptionArtifacts();
      this.emitReport();
      console.log();
      console.log('✓ Phase 3B backfill completed');
    } catch (error) {
      console.error('✗ Phase 3B backfill failed:', error);
      throw error;
    } finally {
      // Only close the connection once (shared by both repositories)
      await this.documentsRepo.close();
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

  const backfill = new Phase3BBackfill(options);
  backfill.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { Phase3BBackfill };
