/**
 * PostgreSQL Schema for Doctor Dashboard
 * Phase 0: Schema Foundation
 *
 * This schema implements the canonical PostgreSQL persistence architecture
 * as defined in postgres-persistence-interoperability-plan.md
 *
 * Tables are created in dependency order to respect foreign key relationships
 */

const fs = require('fs');
const path = require('path');

/**
 * Schema definition for Phase 0 implementation
 */
const SCHEMA_DEFINITION = {
  // Enums and custom types
  enums: [
    // Identity lifecycle states
    `CREATE TYPE identity_state_enum AS ENUM ('provisional', 'reconciled', 'conflicted', 'inactive');`,

    // Identifier evidence states
    `CREATE TYPE identifier_status_enum AS ENUM ('observed', 'verified', 'deprecated');`,

    // Document and workflow states
    `CREATE TYPE document_status_enum AS ENUM ('pending', 'processing', 'completed', 'failed', 'archived');`,
    `CREATE TYPE extraction_status_enum AS ENUM ('pending', 'in_progress', 'completed', 'failed', 'superseded');`,
    `CREATE TYPE review_status_enum AS ENUM ('pending', 'approved', 'rejected', 'superseded');`,
    `CREATE TYPE session_status_enum AS ENUM ('active', 'ended', 'abandoned');`,
    `CREATE TYPE chat_status_enum AS ENUM ('active', 'archived', 'deleted');`,
    `CREATE TYPE alert_status_enum AS ENUM ('pending', 'sent', 'failed', 'expired');`,
    `CREATE TYPE audit_status_enum AS ENUM ('in_progress', 'completed', 'failed');`,
    `CREATE TYPE event_status_enum AS ENUM ('started', 'completed', 'failed', 'warning');`,

    // Interoperability states
    `CREATE TYPE direction_enum AS ENUM ('inbound', 'outbound', 'bidirectional');`,
    `CREATE TYPE standard_enum AS ENUM ('hl7_v2', 'fhir', 'custom');`,
    `CREATE TYPE transport_enum AS ENUM ('mllp', 'http', 'websocket', 'file');`,
    `CREATE TYPE endpoint_status_enum AS ENUM ('active', 'inactive', 'error');`,
    `CREATE TYPE processing_state_enum AS ENUM ('pending', 'processing', 'completed', 'failed', 'retrying');`,
    `CREATE TYPE ack_state_enum AS ENUM ('pending', 'accepted', 'rejected', 'error');`,
    `CREATE TYPE sync_direction_enum AS ENUM ('none', 'inbound', 'outbound', 'bidirectional');`,
    `CREATE TYPE link_status_enum AS ENUM ('active', 'inactive', 'orphaned', 'conflicted');`,

    // Identity reconciliation
    `CREATE TYPE case_status_enum AS ENUM ('open', 'in_review', 'resolved', 'deferred');`,
    `CREATE TYPE entity_type_enum AS ENUM ('patient', 'encounter');`,

    // User and document types
    `CREATE TYPE user_role_enum AS ENUM ('admin', 'doctor', 'nurse', 'staff');`,
    `CREATE TYPE user_status_enum AS ENUM ('active', 'inactive', 'suspended');`,
    `CREATE TYPE document_type_enum AS ENUM ('prescription', 'discharge_summary', 'inpatient_record', 'outpatient_record', 'lab_report', 'radiology_report', 'chart_note', 'voice_dictation', 'live_conversation', 'unknown');`,
    `CREATE TYPE document_subtype_enum AS ENUM ('opd_prescription', 'ipd_prescription', 'general_discharge', 'death_discharge', 'routine_lab', 'emergency_lab', 'x_ray', 'ct_scan', 'mri', 'ultrasound', 'unknown');`,
    `CREATE TYPE source_kind_enum AS ENUM ('pdf_upload', 'voice_upload', 'live_conversation', 'system_generated');`,
    `CREATE TYPE asset_role_enum AS ENUM ('source_pdf', 'source_audio', 'transcript_json', 'masked_image', 'chart_note_pdf', 'prescription_html', 'prescription_pdf', 'other');`,
    `CREATE TYPE storage_backend_enum AS ENUM ('filesystem', 's3', 'azure_blob', 'gcs', 'unknown');`,
    `CREATE TYPE speaker_role_enum AS ENUM ('physician', 'patient', 'nurse', 'family', 'other', 'unknown');`,
    `CREATE TYPE segment_status_enum AS ENUM ('active', 'edited', 'deleted');`,
    `CREATE TYPE alert_family_enum AS ENUM ('pharmacy', 'department', 'system', 'external');`,
    `CREATE TYPE channel_enum AS ENUM ('email', 'sms', 'websocket', 'http', 'internal');`,
    `CREATE TYPE workflow_enum AS ENUM ('document_processing', 'voice_upload', 'live_conversation', 'chat', 'audit', 'external_sync');`
  ],

  // Master data tables
  masterData: [
    // Organizations table
    `CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      organization_type TEXT,
      identifiers_jsonb JSONB DEFAULT '{}',
      organization_jsonb JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // Locations table
    `CREATE TABLE locations (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      name TEXT NOT NULL,
      location_type TEXT,
      identifiers_jsonb JSONB DEFAULT '{}',
      location_jsonb JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_locations_organization FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
    );`,

    // Practitioners table
    `CREATE TABLE practitioners (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      npi_or_registration_no TEXT UNIQUE,
      role_code TEXT,
      practitioner_jsonb JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // Patients table
    `CREATE TABLE patients (
      id TEXT PRIMARY KEY,
      identity_state identity_state_enum NOT NULL DEFAULT 'provisional',
      source_mode TEXT,
      display_name TEXT,
      birth_date DATE,
      sex_code TEXT,
      demographics_jsonb JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // Patient identifiers table
    `CREATE TABLE patient_identifiers (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      identifier_system TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      identifier_type TEXT,
      assigning_authority TEXT,
      status identifier_status_enum NOT NULL DEFAULT 'observed',
      source_system TEXT,
      is_primary BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_patient_identifiers_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      CONSTRAINT uk_patient_identifier UNIQUE (identifier_system, identifier_value)
    );`,

    // Encounters table
    `CREATE TABLE encounters (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      identity_state identity_state_enum NOT NULL DEFAULT 'provisional',
      source_mode TEXT,
      encounter_class TEXT,
      status TEXT,
      start_at TIMESTAMPTZ,
      end_at TIMESTAMPTZ,
      organization_id TEXT,
      location_id TEXT,
      practitioner_id TEXT,
      details_jsonb JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_encounters_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      CONSTRAINT fk_encounters_organization FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
      CONSTRAINT fk_encounters_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
      CONSTRAINT fk_encounters_practitioner FOREIGN KEY (practitioner_id) REFERENCES practitioners(id) ON DELETE SET NULL
    );`,

    // Encounter identifiers table
    `CREATE TABLE encounter_identifiers (
      id TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL,
      identifier_system TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      identifier_type TEXT,
      assigning_authority TEXT,
      status identifier_status_enum NOT NULL DEFAULT 'observed',
      source_system TEXT,
      is_primary BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_encounter_identifiers_encounter FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE,
      CONSTRAINT uk_encounter_identifier UNIQUE (identifier_system, identifier_value)
    );`
  ],

  // Application identity tables
  applicationIdentity: [
    // Users table
    `CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role user_role_enum NOT NULL DEFAULT 'staff',
      display_name TEXT,
      practitioner_id TEXT,
      status user_status_enum NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_users_practitioner FOREIGN KEY (practitioner_id) REFERENCES practitioners(id) ON DELETE SET NULL
    );`,

    // Auth sessions table
    `CREATE TABLE auth_sessions (
      id TEXT PRIMARY KEY,
      session_token TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );`
  ],

  // Core clinical document tables
  clinicalDocuments: [
    // Documents table (canonical final record)
    `CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      patient_id TEXT,
      encounter_id TEXT,
      document_type document_type_enum NOT NULL DEFAULT 'unknown',
      document_subtype document_subtype_enum DEFAULT 'unknown',
      source_kind source_kind_enum NOT NULL,
      status document_status_enum NOT NULL DEFAULT 'pending',
      department TEXT,
      name TEXT NOT NULL,
      original_filename TEXT,
      mime_type TEXT,
      size_bytes BIGINT,
      sha256_hash TEXT UNIQUE,
      linked_patient_label TEXT,
      encounter_label TEXT,
      current_extraction_id TEXT,
      current_transcript_id TEXT,
      current_chart_note_id TEXT,
      last_audit_run_id TEXT,
      error_code TEXT,
      error_message TEXT,
      uploaded_at TIMESTAMPTZ,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_documents_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
      CONSTRAINT fk_documents_encounter FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
    );`,

    // Document assets table (external file metadata)
    `CREATE TABLE document_assets (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      live_session_id TEXT,
      asset_role asset_role_enum NOT NULL,
      storage_backend storage_backend_enum NOT NULL DEFAULT 'filesystem',
      path_or_uri TEXT NOT NULL,
      mime_type TEXT,
      size_bytes BIGINT,
      sha256_hash TEXT,
      metadata_jsonb JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_document_assets_reference CHECK (
        (document_id IS NOT NULL AND live_session_id IS NULL) OR
        (document_id IS NULL AND live_session_id IS NOT NULL)
      ),
      CONSTRAINT fk_document_assets_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );`,

    // Document extractions table (versioned extraction results)
    `CREATE TABLE document_extractions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version_no INT NOT NULL,
      status extraction_status_enum NOT NULL DEFAULT 'pending',
      agent_name TEXT,
      agent_version TEXT,
      audit_run_id TEXT,
      provider_tokens_jsonb JSONB DEFAULT '{}',
      extracted_data_jsonb JSONB DEFAULT '{}',
      dashboard_payload_jsonb JSONB DEFAULT '{}',
      meta_jsonb JSONB DEFAULT '{}',
      stage1_jsonb JSONB DEFAULT '{}',
      stage3_jsonb JSONB DEFAULT '{}',
      presentation_jsonb JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_document_extractions_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CONSTRAINT uk_document_extraction_version UNIQUE (document_id, version_no)
    );`,

    // Transcripts table (transcript-level payload)
    `CREATE TABLE transcripts (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      live_session_id TEXT,
      backend TEXT,
      language_code TEXT,
      raw_text TEXT,
      normalized_text TEXT,
      quality_jsonb JSONB DEFAULT '{}',
      transcript_jsonb JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_transcripts_reference CHECK (
        (document_id IS NOT NULL AND live_session_id IS NULL) OR
        (document_id IS NULL AND live_session_id IS NOT NULL)
      ),
      CONSTRAINT fk_transcripts_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
    );`,

    // Transcript segments table (time-based segments)
    `CREATE TABLE transcript_segments (
      id TEXT PRIMARY KEY,
      transcript_id TEXT NOT NULL,
      segment_order INT NOT NULL,
      speaker_id TEXT,
      speaker_role speaker_role_enum DEFAULT 'unknown',
      speaker_label TEXT,
      start_ms INT,
      end_ms INT,
      text TEXT NOT NULL,
      normalized_text TEXT,
      confidence_score REAL,
      flags_jsonb JSONB DEFAULT '{}',
      status segment_status_enum NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_transcript_segments_transcript FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE,
      CONSTRAINT uk_transcript_segment_order UNIQUE (transcript_id, segment_order)
    );`
  ],

  // Review and workflow tables
  reviewWorkflow: [
    // Review items table
    `CREATE TABLE review_items (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      live_session_id TEXT,
      transcript_id TEXT,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      reason_code TEXT,
      title TEXT NOT NULL,
      field_path TEXT,
      required_flag BOOLEAN DEFAULT FALSE,
      provenance_text TEXT,
      provenance_range_jsonb JSONB DEFAULT '{}',
      extracted_value_jsonb JSONB DEFAULT '{}',
      suggested_value_jsonb JSONB DEFAULT '{}',
      current_resolution review_status_enum NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_review_items_reference CHECK (
        (document_id IS NOT NULL AND live_session_id IS NULL) OR
        (document_id IS NULL AND live_session_id IS NOT NULL)
      ),
      CONSTRAINT fk_review_items_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CONSTRAINT fk_review_items_transcript FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE SET NULL
    );`,

    // Review item resolutions table (append-only resolution history)
    `CREATE TABLE review_item_resolutions (
      id TEXT PRIMARY KEY,
      review_item_id TEXT NOT NULL,
      resolved_by_user_id TEXT,
      resolution review_status_enum NOT NULL,
      edited_value_jsonb JSONB DEFAULT '{}',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_review_item_resolutions_review_item FOREIGN KEY (review_item_id) REFERENCES review_items(id) ON DELETE CASCADE,
      CONSTRAINT fk_review_item_resolutions_user FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );`,

    // Live conversation sessions table (in-progress capture state)
    `CREATE TABLE live_conversation_sessions (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT NOT NULL,
      patient_id TEXT,
      encounter_id TEXT,
      status session_status_enum NOT NULL DEFAULT 'active',
      linked_patient_label TEXT,
      encounter_label TEXT,
      document_id TEXT,
      duration_ms INT,
      transport_state_jsonb JSONB DEFAULT '{}',
      draft_extraction_jsonb JSONB DEFAULT '{}',
      events_jsonb JSONB DEFAULT '[]',
      current_transcript_id TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_live_sessions_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_live_sessions_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
      CONSTRAINT fk_live_sessions_encounter FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL,
      CONSTRAINT fk_live_sessions_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
      CONSTRAINT fk_live_sessions_transcript FOREIGN KEY (current_transcript_id) REFERENCES transcripts(id) ON DELETE SET NULL
    );`
  ],

  // Chat, generation, alert, and audit tables
  additionalTables: [
    // Chat sessions table
    `CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      user_id TEXT NOT NULL,
      status chat_status_enum NOT NULL DEFAULT 'active',
      pending_external_consent_jsonb JSONB DEFAULT '{}',
      pending_clarification_jsonb JSONB DEFAULT '{}',
      pending_provider_prompt_jsonb JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_chat_sessions_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CONSTRAINT fk_chat_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,

    // Chat messages table
    `CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      chat_session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations_jsonb JSONB DEFAULT '[]',
      confidence_score REAL,
      confidence_label TEXT,
      source_class TEXT,
      proposed_actions_jsonb JSONB DEFAULT '[]',
      decision_prompt_jsonb JSONB DEFAULT '{}',
      trace_jsonb JSONB DEFAULT '{}',
      provider TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_chat_messages_session FOREIGN KEY (chat_session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );`,

    // Chat confirmed actions table
    `CREATE TABLE chat_confirmed_actions (
      id TEXT PRIMARY KEY,
      chat_session_id TEXT NOT NULL,
      document_id TEXT,
      action_type TEXT NOT NULL,
      title TEXT NOT NULL,
      rationale TEXT,
      payload_jsonb JSONB DEFAULT '{}',
      confirmed_by_user_id TEXT,
      confirmed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_chat_confirmed_actions_session FOREIGN KEY (chat_session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      CONSTRAINT fk_chat_confirmed_actions_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
      CONSTRAINT fk_chat_confirmed_actions_user FOREIGN KEY (confirmed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );`,

    // Chat exports table
    `CREATE TABLE chat_exports (
      id TEXT PRIMARY KEY,
      chat_session_id TEXT NOT NULL,
      document_id TEXT,
      export_payload_jsonb JSONB DEFAULT '{}',
      created_by_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_chat_exports_session FOREIGN KEY (chat_session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      CONSTRAINT fk_chat_exports_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
      CONSTRAINT fk_chat_exports_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );`,

    // Chart notes table
    `CREATE TABLE chart_notes (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version_no INT NOT NULL,
      content TEXT NOT NULL,
      validation_jsonb JSONB DEFAULT '{}',
      citations_jsonb JSONB DEFAULT '[]',
      reasoning_steps_jsonb JSONB DEFAULT '[]',
      tokens_used INT,
      generation_time_ms INT,
      audit_run_id TEXT,
      created_by_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_chart_notes_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CONSTRAINT fk_chart_notes_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT uk_chart_note_version UNIQUE (document_id, version_no)
    );`,

    // Prescription artifacts table
    `CREATE TABLE prescription_artifacts (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version_no INT NOT NULL,
      prescription_payload_jsonb JSONB DEFAULT '{}',
      html_asset_id TEXT,
      pdf_asset_id TEXT,
      created_by_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_prescription_artifacts_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CONSTRAINT fk_prescription_artifacts_html FOREIGN KEY (html_asset_id) REFERENCES document_assets(id) ON DELETE SET NULL,
      CONSTRAINT fk_prescription_artifacts_pdf FOREIGN KEY (pdf_asset_id) REFERENCES document_assets(id) ON DELETE SET NULL,
      CONSTRAINT fk_prescription_artifacts_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT uk_prescription_artifact_version UNIQUE (document_id, version_no)
    );`,

    // Alert deliveries table
    `CREATE TABLE alert_deliveries (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      alert_family alert_family_enum NOT NULL,
      target_name TEXT NOT NULL,
      channel channel_enum NOT NULL,
      recipient TEXT NOT NULL,
      status alert_status_enum NOT NULL DEFAULT 'pending',
      payload_jsonb JSONB DEFAULT '{}',
      result_jsonb JSONB DEFAULT '{}',
      error_message TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_alert_deliveries_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );`,

    // Audit runs table
    `CREATE TABLE audit_runs (
      id TEXT PRIMARY KEY,
      workflow workflow_enum NOT NULL,
      document_id TEXT,
      chat_session_id TEXT,
      request_id TEXT,
      actor_user_id TEXT,
      actor_label TEXT,
      status audit_status_enum NOT NULL DEFAULT 'in_progress',
      title TEXT NOT NULL,
      metadata_jsonb JSONB DEFAULT '{}',
      summary_jsonb JSONB DEFAULT '{}',
      error_message TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      duration_ms INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_audit_runs_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
      CONSTRAINT fk_audit_runs_chat_session FOREIGN KEY (chat_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL,
      CONSTRAINT fk_audit_runs_user FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );`,

    // Audit events table (append-only timeline)
    `CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      audit_run_id TEXT,
      workflow workflow_enum,
      document_id TEXT,
      chat_session_id TEXT,
      event_type TEXT NOT NULL,
      status event_status_enum NOT NULL DEFAULT 'started',
      title TEXT NOT NULL,
      details_jsonb JSONB DEFAULT '{}',
      occurred_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_audit_events_audit_run FOREIGN KEY (audit_run_id) REFERENCES audit_runs(id) ON DELETE SET NULL,
      CONSTRAINT fk_audit_events_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
      CONSTRAINT fk_audit_events_chat_session FOREIGN KEY (chat_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
    );`
  ],

  // Interoperability infrastructure tables
  interopInfrastructure: [
    // Interop endpoints table
    `CREATE TABLE interop_endpoints (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      direction direction_enum NOT NULL,
      standard standard_enum NOT NULL,
      transport transport_enum NOT NULL,
      status endpoint_status_enum NOT NULL DEFAULT 'inactive',
      organization_id TEXT,
      config_jsonb JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_interop_endpoints_organization FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
    );`,

    // Interop messages table
    `CREATE TABLE interop_messages (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL,
      direction direction_enum NOT NULL,
      standard standard_enum NOT NULL,
      message_family TEXT NOT NULL,
      message_type TEXT NOT NULL,
      trigger_event TEXT,
      control_id TEXT,
      correlation_key TEXT,
      patient_id TEXT,
      encounter_id TEXT,
      document_id TEXT,
      processing_state processing_state_enum NOT NULL DEFAULT 'pending',
      ack_state ack_state_enum NOT NULL DEFAULT 'pending',
      raw_payload_text TEXT,
      normalized_payload_jsonb JSONB DEFAULT '{}',
      error_message TEXT,
      received_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_interop_messages_endpoint FOREIGN KEY (endpoint_id) REFERENCES interop_endpoints(id) ON DELETE RESTRICT,
      CONSTRAINT fk_interop_messages_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
      CONSTRAINT fk_interop_messages_encounter FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL,
      CONSTRAINT fk_interop_messages_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
      CONSTRAINT uk_interop_messages_control UNIQUE (endpoint_id, control_id)
    );`,

    // Interop message events table
    `CREATE TABLE interop_message_events (
      id TEXT PRIMARY KEY,
      interop_message_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status event_status_enum NOT NULL DEFAULT 'started',
      details_jsonb JSONB DEFAULT '{}',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_interop_message_events_message FOREIGN KEY (interop_message_id) REFERENCES interop_messages(id) ON DELETE CASCADE
    );`,

    // Interop resource links table
    `CREATE TABLE interop_resource_links (
      id TEXT PRIMARY KEY,
      internal_entity_type TEXT NOT NULL,
      internal_entity_id TEXT NOT NULL,
      external_system TEXT NOT NULL,
      external_resource_type TEXT NOT NULL,
      external_resource_id TEXT NOT NULL,
      external_version TEXT,
      sync_direction sync_direction_enum NOT NULL DEFAULT 'none',
      link_status link_status_enum NOT NULL DEFAULT 'active',
      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uk_interop_resource_link UNIQUE (
        internal_entity_type,
        internal_entity_id,
        external_system,
        external_resource_type,
        external_resource_id
      )
    );`,

    // Identity reconciliation cases table
    `CREATE TABLE identity_reconciliation_cases (
      id TEXT PRIMARY KEY,
      entity_type entity_type_enum NOT NULL,
      candidate_patient_id TEXT,
      candidate_encounter_id TEXT,
      source_system TEXT NOT NULL,
      case_status case_status_enum NOT NULL DEFAULT 'open',
      reason_code TEXT NOT NULL,
      observed_identifiers_jsonb JSONB DEFAULT '{}',
      candidate_matches_jsonb JSONB DEFAULT '{}',
      resolution_jsonb JSONB DEFAULT '{}',
      assigned_to_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      CONSTRAINT fk_identity_reconciliation_cases_user FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
    );`
  ],

  // Migration tracking table
  migrationTracking: [
    // Schema migrations table (for migration version tracking)
    `CREATE TABLE schema_migrations (
      id SERIAL PRIMARY KEY,
      version TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_time_ms INT,
      checksum TEXT,
      metadata_jsonb JSONB DEFAULT '{}'
    );`
  ],

  // Indexes for performance and constraints
  indexes: [
    // Organizations and locations
    'CREATE INDEX idx_organizations_name ON organizations(name);',
    'CREATE INDEX idx_organizations_type ON organizations(organization_type);',
    'CREATE INDEX idx_organizations_identifiers ON organizations USING GIN (identifiers_jsonb);',
    'CREATE INDEX idx_locations_organization ON locations(organization_id);',
    'CREATE INDEX idx_locations_name ON locations(name);',

    // Practitioners
    'CREATE INDEX idx_practitioners_display_name ON practitioners(display_name);',
    'CREATE INDEX idx_practitioners_npi ON practitioners(npi_or_registration_no) WHERE npi_or_registration_no IS NOT NULL;',

    // Patients
    'CREATE INDEX idx_patients_identity_state ON patients(identity_state);',
    'CREATE INDEX idx_patients_display_name ON patients(display_name);',
    'CREATE INDEX idx_patients_demographics ON patients USING GIN (demographics_jsonb);',

    // Patient identifiers
    'CREATE INDEX idx_patient_identifiers_patient ON patient_identifiers(patient_id);',
    'CREATE INDEX idx_patient_identifiers_status ON patient_identifiers(status);',
    'CREATE INDEX idx_patient_identifiers_system_value ON patient_identifiers(identifier_system, identifier_value);',

    // Encounters
    'CREATE INDEX idx_encounters_patient ON encounters(patient_id);',
    'CREATE INDEX idx_encounters_status_start ON encounters(status, start_at);',
    'CREATE INDEX idx_encounters_details ON encounters USING GIN (details_jsonb);',

    // Encounter identifiers
    'CREATE INDEX idx_encounter_identifiers_encounter ON encounter_identifiers(encounter_id);',
    'CREATE INDEX idx_encounter_identifiers_status ON encounter_identifiers(status);',

    // Users
    'CREATE INDEX idx_users_username ON users(username);',
    'CREATE INDEX idx_users_role ON users(role);',
    'CREATE INDEX idx_users_status ON users(status);',

    // Auth sessions
    'CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);',
    'CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);',
    'CREATE INDEX idx_auth_sessions_active ON auth_sessions(user_id) WHERE revoked_at IS NULL;',

    // Documents
    'CREATE INDEX idx_documents_status ON documents(status);',
    'CREATE INDEX idx_documents_type ON documents(document_type);',
    'CREATE INDEX idx_documents_subtype ON documents(document_subtype);',
    'CREATE INDEX idx_documents_patient ON documents(patient_id);',
    'CREATE INDEX idx_documents_encounter ON documents(encounter_id);',
    'CREATE INDEX idx_documents_uploaded ON documents(uploaded_at);',
    'CREATE INDEX idx_documents_processed ON documents(processed_at);',

    // Document assets
    'CREATE INDEX idx_document_assets_document ON document_assets(document_id);',
    'CREATE INDEX idx_document_assets_live_session ON document_assets(live_session_id);',
    'CREATE INDEX idx_document_assets_role ON document_assets(asset_role);',

    // Document extractions
    'CREATE INDEX idx_document_extractions_document ON document_extractions(document_id);',
    'CREATE INDEX idx_document_extractions_status ON document_extractions(status);',
    'CREATE INDEX idx_document_extractions_extracted_data ON document_extractions USING GIN (extracted_data_jsonb);',
    'CREATE INDEX idx_document_extractions_meta ON document_extractions USING GIN (meta_jsonb);',

    // Transcripts
    'CREATE INDEX idx_transcripts_document ON transcripts(document_id);',
    'CREATE INDEX idx_transcripts_live_session ON transcripts(live_session_id);',

    // Transcript segments
    'CREATE INDEX idx_transcript_segments_transcript ON transcript_segments(transcript_id);',
    'CREATE INDEX idx_transcript_segments_timing ON transcript_segments(transcript_id, start_ms);',
    'CREATE INDEX idx_transcript_segments_speaker ON transcript_segments(speaker_id) WHERE speaker_id IS NOT NULL;',

    // Review items
    'CREATE INDEX idx_review_items_document ON review_items(document_id);',
    'CREATE INDEX idx_review_items_live_session ON review_items(live_session_id);',
    'CREATE INDEX idx_review_items_transcript ON review_items(transcript_id);',
    'CREATE INDEX idx_review_items_resolution ON review_items(current_resolution);',
    'CREATE INDEX idx_review_items_severity ON review_items(severity);',
    'CREATE INDEX idx_review_items_category ON review_items(category);',

    // Review item resolutions
    'CREATE INDEX idx_review_item_resolutions_item ON review_item_resolutions(review_item_id);',
    'CREATE INDEX idx_review_item_resolutions_user ON review_item_resolutions(resolved_by_user_id);',

    // Live conversation sessions
    'CREATE INDEX idx_live_sessions_user ON live_conversation_sessions(created_by_user_id);',
    'CREATE INDEX idx_live_sessions_status ON live_conversation_sessions(status);',
    'CREATE INDEX idx_live_sessions_document ON live_conversation_sessions(document_id);',
    'CREATE INDEX idx_live_sessions_patient ON live_conversation_sessions(patient_id);',
    'CREATE INDEX idx_live_sessions_encounter ON live_conversation_sessions(encounter_id);',
    'CREATE INDEX idx_live_sessions_started ON live_conversation_sessions(started_at);',

    // Chat sessions
    'CREATE INDEX idx_chat_sessions_document ON chat_sessions(document_id);',
    'CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id);',
    'CREATE INDEX idx_chat_sessions_status ON chat_sessions(status);',

    // Chat messages
    'CREATE INDEX idx_chat_messages_session_created ON chat_messages(chat_session_id, created_at);',

    // Chat confirmed actions
    'CREATE INDEX idx_chat_confirmed_actions_session ON chat_confirmed_actions(chat_session_id);',
    'CREATE INDEX idx_chat_confirmed_actions_document ON chat_confirmed_actions(document_id);',

    // Chat exports
    'CREATE INDEX idx_chat_exports_document ON chat_exports(document_id);',
    'CREATE INDEX idx_chat_exports_session ON chat_exports(chat_session_id);',

    // Chart notes
    'CREATE INDEX idx_chart_notes_document ON chart_notes(document_id);',
    'CREATE INDEX idx_chart_notes_created_user ON chart_notes(created_by_user_id);',

    // Prescription artifacts
    'CREATE INDEX idx_prescription_artifacts_document ON prescription_artifacts(document_id);',
    'CREATE INDEX idx_prescription_artifacts_html ON prescription_artifacts(html_asset_id) WHERE html_asset_id IS NOT NULL;',
    'CREATE INDEX idx_prescription_artifacts_pdf ON prescription_artifacts(pdf_asset_id) WHERE pdf_asset_id IS NOT NULL;',

    // Alert deliveries
    'CREATE INDEX idx_alert_deliveries_document ON alert_deliveries(document_id);',
    'CREATE INDEX idx_alert_deliveries_family_target ON alert_deliveries(alert_family, target_name);',
    'CREATE INDEX idx_alert_deliveries_status ON alert_deliveries(status);',
    'CREATE INDEX idx_alert_deliveries_sent ON alert_deliveries(sent_at);',

    // Audit runs
    'CREATE INDEX idx_audit_runs_workflow ON audit_runs(workflow);',
    'CREATE INDEX idx_audit_runs_document ON audit_runs(document_id);',
    'CREATE INDEX idx_audit_runs_chat_session ON audit_runs(chat_session_id);',
    'CREATE INDEX idx_audit_runs_request_id ON audit_runs(request_id);',
    'CREATE INDEX idx_audit_runs_started ON audit_runs(started_at);',

    // Audit events
    'CREATE INDEX idx_audit_events_run_occurred ON audit_events(audit_run_id, occurred_at);',
    'CREATE INDEX idx_audit_events_document ON audit_events(document_id);',
    'CREATE INDEX idx_audit_events_workflow ON audit_events(workflow);',
    'CREATE INDEX idx_audit_events_chat_session ON audit_events(chat_session_id);',

    // Interoperability
    'CREATE INDEX idx_interop_endpoints_direction_standard_status ON interop_endpoints(direction, standard, status);',
    'CREATE INDEX idx_interop_messages_endpoint ON interop_messages(endpoint_id);',
    'CREATE INDEX idx_interop_messages_processing_state ON interop_messages(processing_state);',
    'CREATE INDEX idx_interop_messages_patient ON interop_messages(patient_id);',
    'CREATE INDEX idx_interop_messages_encounter ON interop_messages(encounter_id);',
    'CREATE INDEX idx_interop_messages_document ON interop_messages(document_id);',
    'CREATE INDEX idx_interop_messages_control_id ON interop_messages(endpoint_id, control_id) WHERE control_id IS NOT NULL;',
    'CREATE INDEX idx_interop_message_events_message_occurred ON interop_message_events(interop_message_id, occurred_at);',

    // Identity reconciliation
    'CREATE INDEX idx_identity_reconciliation_cases_status ON identity_reconciliation_cases(case_status);',
    'CREATE INDEX idx_identity_reconciliation_cases_assigned ON identity_reconciliation_cases(assigned_to_user_id);',
    'CREATE INDEX idx_identity_reconciliation_cases_entity ON identity_reconciliation_cases(entity_type);'
  ],

  // Analytics table
  analytics: [
    // Analytics document metrics table (migrated from analytics.sqlite)
    `CREATE TABLE analytics_document_metrics (
      document_id TEXT PRIMARY KEY,
      document_name TEXT NOT NULL,
      document_type document_type_enum NOT NULL,
      processed_at TIMESTAMPTZ,
      uploaded_at TIMESTAMPTZ,
      gemma_tokens INT NOT NULL DEFAULT 0,
      gemma_cache_hit BOOLEAN DEFAULT FALSE,
      transcript_takes INT NOT NULL DEFAULT 0,
      transcript_confidence REAL,
      voice_review_items INT NOT NULL DEFAULT 0,
      voice_review_items_resolved INT NOT NULL DEFAULT 0,
      live_review_items INT NOT NULL DEFAULT 0,
      live_review_items_resolved INT NOT NULL DEFAULT 0,
      medications_count INT NOT NULL DEFAULT 0,
      diagnoses_count INT NOT NULL DEFAULT 0,
      lab_results_count INT NOT NULL DEFAULT 0,
      radiology_results_count INT NOT NULL DEFAULT 0,
      procedures_count INT NOT NULL DEFAULT 0,
      ordered_lab_count INT NOT NULL DEFAULT 0,
      ordered_radiology_count INT NOT NULL DEFAULT 0,
      ordered_medications_count INT NOT NULL DEFAULT 0,
      nuclear_medicine_count INT NOT NULL DEFAULT 0,
      has_occupational_therapy BOOLEAN DEFAULT FALSE,
      has_dietary_recommendations BOOLEAN DEFAULT FALSE,
      has_patient_education BOOLEAN DEFAULT FALSE,
      metadata_jsonb JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_analytics_document_metrics_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );`
  ]
};

/**
 * Schema creation and management functions
 */
class PostgresSchema {
  constructor(postgresClient) {
    this.client = postgresClient;
    this.schemaDefinition = SCHEMA_DEFINITION;
  }

  /**
   * Check if a table exists in the database
   */
  async tableExists(tableName) {
    return await this.client.tableExists(tableName);
  }

  /**
   * Get all existing table names
   */
  async getExistingTables() {
    const query = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    const rows = await this.client.query(query);
    return rows.map(row => row.table_name);
  }

  /**
   * Create all enums
   */
  async createEnums() {
    console.log('Creating custom enums...');
    const created = [];

    for (const enumSql of this.schemaDefinition.enums) {
      try {
        await this.client.query(enumSql);
        const enumName = enumSql.match(/CREATE TYPE (\w+) AS/)[1];
        created.push(enumName);
        console.log(`✓ Created enum: ${enumName}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`- Enum already exists: ${enumSql.match(/CREATE TYPE (\w+) AS/)[1]}`);
        } else {
          console.error(`✗ Failed to create enum: ${error.message}`);
          throw error;
        }
      }
    }

    return created;
  }

  /**
   * Create master data tables
   */
  async createMasterDataTable() {
    console.log('Creating master data tables...');
    const created = [];

    for (const tableSql of this.schemaDefinition.masterData) {
      const tableName = tableSql.match(/CREATE TABLE (\w+)/)[1];

      if (await this.tableExists(tableName)) {
        console.log(`- Table already exists: ${tableName}`);
        continue;
      }

      try {
        await this.client.query(tableSql);
        created.push(tableName);
        console.log(`✓ Created table: ${tableName}`);
      } catch (error) {
        console.error(`✗ Failed to create table ${tableName}: ${error.message}`);
        throw error;
      }
    }

    return created;
  }

  /**
   * Create application identity tables
   */
  async createApplicationIdentityTables() {
    console.log('Creating application identity tables...');
    const created = [];

    for (const tableSql of this.schemaDefinition.applicationIdentity) {
      const tableName = tableSql.match(/CREATE TABLE (\w+)/)[1];

      if (await this.tableExists(tableName)) {
        console.log(`- Table already exists: ${tableName}`);
        continue;
      }

      try {
        await this.client.query(tableSql);
        created.push(tableName);
        console.log(`✓ Created table: ${tableName}`);
      } catch (error) {
        console.error(`✗ Failed to create table ${tableName}: ${error.message}`);
        throw error;
      }
    }

    return created;
  }

  /**
   * Create clinical document tables
   */
  async createClinicalDocumentTables() {
    console.log('Creating clinical document tables...');
    const created = [];

    for (const tableSql of this.schemaDefinition.clinicalDocuments) {
      const tableName = tableSql.match(/CREATE TABLE (\w+)/)[1];

      if (await this.tableExists(tableName)) {
        console.log(`- Table already exists: ${tableName}`);
        continue;
      }

      try {
        await this.client.query(tableSql);
        created.push(tableName);
        console.log(`✓ Created table: ${tableName}`);
      } catch (error) {
        console.error(`✗ Failed to create table ${tableName}: ${error.message}`);
        throw error;
      }
    }

    return created;
  }

  /**
   * Create review and workflow tables
   */
  async createReviewWorkflowTables() {
    console.log('Creating review and workflow tables...');
    const created = [];

    for (const tableSql of this.schemaDefinition.reviewWorkflow) {
      const tableName = tableSql.match(/CREATE TABLE (\w+)/)[1];

      if (await this.tableExists(tableName)) {
        console.log(`- Table already exists: ${tableName}`);
        continue;
      }

      try {
        await this.client.query(tableSql);
        created.push(tableName);
        console.log(`✓ Created table: ${tableName}`);
      } catch (error) {
        console.error(`✗ Failed to create table ${tableName}: ${error.message}`);
        throw error;
      }
    }

    return created;
  }

  /**
   * Create additional tables (chat, alerts, audit)
   */
  async createAdditionalTables() {
    console.log('Creating additional tables (chat, alerts, audit)...');
    const created = [];

    for (const tableSql of this.schemaDefinition.additionalTables) {
      const tableName = tableSql.match(/CREATE TABLE (\w+)/)[1];

      if (await this.tableExists(tableName)) {
        console.log(`- Table already exists: ${tableName}`);
        continue;
      }

      try {
        await this.client.query(tableSql);
        created.push(tableName);
        console.log(`✓ Created table: ${tableName}`);
      } catch (error) {
        console.error(`✗ Failed to create table ${tableName}: ${error.message}`);
        throw error;
      }
    }

    return created;
  }

  /**
   * Create interoperability infrastructure tables
   */
  async createInteropInfrastructureTables() {
    console.log('Creating interoperability infrastructure tables...');
    const created = [];

    for (const tableSql of this.schemaDefinition.interopInfrastructure) {
      const tableName = tableSql.match(/CREATE TABLE (\w+)/)[1];

      if (await this.tableExists(tableName)) {
        console.log(`- Table already exists: ${tableName}`);
        continue;
      }

      try {
        await this.client.query(tableSql);
        created.push(tableName);
        console.log(`✓ Created table: ${tableName}`);
      } catch (error) {
        console.error(`✗ Failed to create table ${tableName}: ${error.message}`);
        throw error;
      }
    }

    return created;
  }

  /**
   * Create analytics table
   */
  async createAnalyticsTable() {
    console.log('Creating analytics table...');
    const created = [];

    for (const tableSql of this.schemaDefinition.analytics) {
      const tableName = tableSql.match(/CREATE TABLE (\w+)/)[1];

      if (await this.tableExists(tableName)) {
        console.log(`- Table already exists: ${tableName}`);
        continue;
      }

      try {
        await this.client.query(tableSql);
        created.push(tableName);
        console.log(`✓ Created table: ${tableName}`);
      } catch (error) {
        console.error(`✗ Failed to create table ${tableName}: ${error.message}`);
        throw error;
      }
    }

    return created;
  }

  /**
   * Create migration tracking table
   */
  async createMigrationTrackingTable() {
    console.log('Creating migration tracking table...');
    const created = [];

    for (const tableSql of this.schemaDefinition.migrationTracking) {
      const tableName = tableSql.match(/CREATE TABLE (\w+)/)[1];

      if (await this.tableExists(tableName)) {
        console.log(`- Table already exists: ${tableName}`);
        continue;
      }

      try {
        await this.client.query(tableSql);
        created.push(tableName);
        console.log(`✓ Created table: ${tableName}`);
      } catch (error) {
        console.error(`✗ Failed to create table ${tableName}: ${error.message}`);
        throw error;
      }
    }

    return created;
  }

  /**
   * Record migration in tracking table
   */
  async recordMigration(version, name, description, metadata = {}) {
    // Extract execution_time_ms and checksum from metadata for proper columns
    const executionTimeMs = metadata.execution_time_ms || null;
    const checksum = metadata.checksum || null;

    // Remove these from metadata_jsonb to avoid duplication
    const metadataJson = { ...metadata };
    delete metadataJson.execution_time_ms;
    delete metadataJson.checksum;

    const query = `
      INSERT INTO schema_migrations (version, name, description, execution_time_ms, checksum, metadata_jsonb)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (version) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        execution_time_ms = EXCLUDED.execution_time_ms,
        checksum = EXCLUDED.checksum,
        metadata_jsonb = EXCLUDED.metadata_jsonb,
        applied_at = NOW()
      RETURNING id, version, name, applied_at, execution_time_ms;
    `;
    const result = await this.client.queryOne(query, [version, name, description, executionTimeMs, checksum, JSON.stringify(metadataJson)]);
    console.log(`✓ Recorded migration: ${version} - ${name} (${executionTimeMs}ms)`);
    return result;
  }

  /**
   * Get migration history
   */
  async getMigrationHistory() {
    // Check if schema_migrations table exists
    const tableExists = await this.tableExists('schema_migrations');
    if (!tableExists) {
      return []; // Return empty array if table doesn't exist
    }

    const query = `
      SELECT id, version, name, description, applied_at, execution_time_ms, checksum, metadata_jsonb
      FROM schema_migrations
      ORDER BY applied_at DESC;
    `;
    return await this.client.query(query);
  }

  /**
   * Create all indexes
   */
  async createIndexes() {
    console.log('Creating indexes...');
    const created = [];

    for (const indexSql of this.schemaDefinition.indexes) {
      try {
        await this.client.query(indexSql);
        const indexName = indexSql.match(/CREATE INDEX (\w+)/)[1];
        created.push(indexName);
        console.log(`✓ Created index: ${indexName}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          const indexName = indexSql.match(/CREATE INDEX (\w+)/)[1];
          console.log(`- Index already exists: ${indexName}`);
        } else {
          console.error(`✗ Failed to create index: ${error.message}`);
          console.error(`✗ Index SQL: ${indexSql}`);
          // FAIL-FAST: Throw error on index creation failures
          throw new Error(`Index creation failed: ${error.message}`);
        }
      }
    }

    return created;
  }

  /**
   * Create deferred foreign key constraints (to handle circular dependencies)
   */
  async createDeferredForeignKeyConstraints() {
    console.log('Creating deferred foreign key constraints...');
    const created = [];

    const deferredConstraints = [
      // Documents current_* pointer foreign keys
      'ALTER TABLE documents ADD CONSTRAINT fk_documents_current_extraction FOREIGN KEY (current_extraction_id) REFERENCES document_extractions(id) ON DELETE SET NULL;',
      'ALTER TABLE documents ADD CONSTRAINT fk_documents_current_transcript FOREIGN KEY (current_transcript_id) REFERENCES transcripts(id) ON DELETE SET NULL;',
      'ALTER TABLE documents ADD CONSTRAINT fk_documents_current_chart_note FOREIGN KEY (current_chart_note_id) REFERENCES chart_notes(id) ON DELETE SET NULL;',
      'ALTER TABLE documents ADD CONSTRAINT fk_documents_last_audit_run FOREIGN KEY (last_audit_run_id) REFERENCES audit_runs(id) ON DELETE SET NULL;',
      // Live session foreign keys (deferred due to circular dependencies)
      'ALTER TABLE document_assets ADD CONSTRAINT fk_document_assets_live_session FOREIGN KEY (live_session_id) REFERENCES live_conversation_sessions(id) ON DELETE CASCADE;',
      'ALTER TABLE transcripts ADD CONSTRAINT fk_transcripts_live_session FOREIGN KEY (live_session_id) REFERENCES live_conversation_sessions(id) ON DELETE CASCADE;',
      'ALTER TABLE review_items ADD CONSTRAINT fk_review_items_live_session FOREIGN KEY (live_session_id) REFERENCES live_conversation_sessions(id) ON DELETE CASCADE;',
      // Audit run foreign keys (deferred due to circular dependencies)
      'ALTER TABLE document_extractions ADD CONSTRAINT fk_document_extractions_audit_run FOREIGN KEY (audit_run_id) REFERENCES audit_runs(id) ON DELETE SET NULL;',
      'ALTER TABLE chart_notes ADD CONSTRAINT fk_chart_notes_audit_run FOREIGN KEY (audit_run_id) REFERENCES audit_runs(id) ON DELETE SET NULL;'
    ];

    for (const constraintSql of deferredConstraints) {
      try {
        await this.client.query(constraintSql);
        const constraintName = constraintSql.match(/CONSTRAINT (\w+)/)[1];
        created.push(constraintName);
        console.log(`✓ Created deferred FK: ${constraintName}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          const constraintName = constraintSql.match(/CONSTRAINT (\w+)/)[1];
          console.log(`- Deferred FK already exists: ${constraintName}`);
        } else {
          console.error(`✗ Failed to create deferred FK: ${error.message}`);
          console.error(`✗ Constraint SQL: ${constraintSql}`);
          // FAIL-FAST: Throw error on FK creation failures
          throw new Error(`Deferred foreign key creation failed: ${error.message}`);
        }
      }
    }

    return created;
  }

  /**
   * Create complete schema (all tables and indexes)
   */
  async createCompleteSchema() {
    console.log('Creating complete PostgreSQL schema for Doctor Dashboard...');
    console.log('='.repeat(60));

    const results = {
      enums: [],
      masterData: [],
      applicationIdentity: [],
      clinicalDocuments: [],
      reviewWorkflow: [],
      additionalTables: [],
      interopInfrastructure: [],
      analytics: [],
      migrationTracking: [],
      indexes: [],
      deferredFKs: []
    };

    try {
      // Create enums first
      results.enums = await this.createEnums();
      console.log('');

      // Create tables in dependency order
      results.masterData = await this.createMasterDataTable();
      results.applicationIdentity = await this.createApplicationIdentityTables();
      results.clinicalDocuments = await this.createClinicalDocumentTables();
      results.reviewWorkflow = await this.createReviewWorkflowTables();
      results.additionalTables = await this.createAdditionalTables();
      results.interopInfrastructure = await this.createInteropInfrastructureTables();
      results.analytics = await this.createAnalyticsTable();
      results.migrationTracking = await this.createMigrationTrackingTable();
      console.log('');

      // Create indexes
      results.indexes = await this.createIndexes();
      console.log('');

      // Create deferred foreign key constraints
      results.deferredFKs = await this.createDeferredForeignKeyConstraints();
      console.log('');

      console.log('='.repeat(60));
      console.log('✓ Complete schema creation successful');
      console.log('='.repeat(60));

      return results;
    } catch (error) {
      console.error('='.repeat(60));
      console.error('✗ Schema creation failed:', error.message);
      console.error('='.repeat(60));
      throw error;
    }
  }

  /**
   * Get schema summary
   */
  async getSchemaSummary() {
    const existingTables = await this.getExistingTables();
    const tableCounts = await Promise.all(
      existingTables.map(async tableName => {
        try {
          const count = await this.client.getTableRowCount(tableName);
          return { table: tableName, count };
        } catch (error) {
          return { table: tableName, count: 'Error' };
        }
      })
    );

    return {
      totalTables: existingTables.length,
      tables: existingTables,
      rowCounts: tableCounts,
      databaseStatus: this.client.getStatus()
    };
  }

  /**
   * Drop all tables (use with caution!)
   */
  async dropAllTables() {
    console.log('⚠️  WARNING: Dropping all tables...');
    const existingTables = await this.getExistingTables();

    // Drop tables in reverse dependency order
    const tablesInOrder = [
      'schema_migrations',  // Migration tracking table (drop first as it has no dependencies)
      'analytics_document_metrics',
      'identity_reconciliation_cases',
      'interop_resource_links',
      'interop_message_events',
      'interop_messages',
      'interop_endpoints',
      'audit_events',
      'audit_runs',
      'alert_deliveries',
      'prescription_artifacts',
      'chart_notes',
      'chat_exports',
      'chat_confirmed_actions',
      'chat_messages',
      'chat_sessions',
      'live_conversation_sessions',
      'review_item_resolutions',
      'review_items',
      'transcript_segments',
      'transcripts',
      'document_extractions',
      'document_assets',
      'documents',
      'auth_sessions',
      'users',
      'encounter_identifiers',
      'encounters',
      'patient_identifiers',
      'patients',
      'practitioners',
      'locations',
      'organizations'
    ];

    for (const tableName of tablesInOrder) {
      if (existingTables.includes(tableName)) {
        try {
          await this.client.query(`DROP TABLE IF EXISTS ${tableName} CASCADE;`);
          console.log(`✓ Dropped table: ${tableName}`);
        } catch (error) {
          console.error(`✗ Failed to drop table ${tableName}: ${error.message}`);
        }
      }
    }

    // Drop enums
    const enums = [
      'identity_state_enum', 'identifier_status_enum', 'document_status_enum',
      'extraction_status_enum', 'review_status_enum', 'session_status_enum',
      'chat_status_enum', 'alert_status_enum', 'audit_status_enum',
      'event_status_enum', 'direction_enum', 'standard_enum', 'transport_enum',
      'endpoint_status_enum', 'processing_state_enum', 'ack_state_enum',
      'sync_direction_enum', 'link_status_enum', 'case_status_enum',
      'entity_type_enum', 'user_role_enum', 'user_status_enum',
      'document_type_enum', 'document_subtype_enum', 'source_kind_enum',
      'asset_role_enum', 'storage_backend_enum', 'speaker_role_enum',
      'segment_status_enum', 'alert_family_enum', 'channel_enum', 'workflow_enum'
    ];

    for (const enumName of enums) {
      try {
        await this.client.query(`DROP TYPE IF EXISTS ${enumName} CASCADE;`);
        console.log(`✓ Dropped enum: ${enumName}`);
      } catch (error) {
        console.error(`✗ Failed to drop enum ${enumName}: ${error.message}`);
      }
    }

    console.log('✓ All tables and enums dropped');
  }
}

module.exports = { PostgresSchema, SCHEMA_DEFINITION };