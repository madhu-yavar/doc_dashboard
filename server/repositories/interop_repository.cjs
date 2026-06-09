/**
 * Interop Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles interoperability endpoint and message data access.
 * Provides PostgreSQL-based persistence for external system integrations.
 *
 * Related Tables:
 * - interop_endpoints (external system endpoint configuration)
 * - interop_messages (individual messages sent/received)
 * - interop_message_events (message processing event tracking)
 * - interop_resource_links (links between internal and external resources)
 *
 * Phase 1: Create repository layer, do not change public routes
 * Phase 2: Add dual-write capability (JSON files + PostgreSQL)
 * Phase 3: Backfill existing data
 * Phase 4: Read cutover to PostgreSQL
 */

const { BaseRepository } = require('./base_repository.cjs');

class InteropRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.endpointsTableName = 'interop_endpoints';
    this.messagesTableName = 'interop_messages';
    this.messageEventsTableName = 'interop_message_events';
    this.resourceLinksTableName = 'interop_resource_links';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    // Verify tables exist
    const endpointsExist = await this.tableExists(this.endpointsTableName);
    if (!endpointsExist) {
      throw new Error('Interop tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // Endpoint Operations
  // ========================================

  /**
   * Create endpoint
   */
  async createEndpoint(endpointData) {
    const id = endpointData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.endpointsTableName} (
        id, name, direction, standard, transport, status, organization_id, config_jsonb, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      endpointData.name,
      endpointData.direction || 'outbound',
      endpointData.standard || 'hl7_v2',
      endpointData.transport || 'http',
      endpointData.status || 'inactive',
      endpointData.organization_id || null,
      this.toJSONB(endpointData.config || {}),
      now,
      now
    ]);
  }

  /**
   * Find endpoint by ID
   */
  async findEndpointById(endpointId) {
    return await this.findById(this.endpointsTableName, endpointId);
  }

  /**
   * Find endpoint by name
   */
  async findEndpointByName(name) {
    return await this.queryOne(
      `SELECT * FROM ${this.endpointsTableName} WHERE name = $1`,
      [name]
    );
  }

  /**
   * Find active endpoints
   */
  async findActiveEndpoints() {
    return await this.query(
      `SELECT * FROM ${this.endpointsTableName} WHERE status = 'active' ORDER BY created_at ASC`
    );
  }

  /**
   * Find endpoints by direction
   */
  async findEndpointsByDirection(direction) {
    return await this.query(
      `SELECT * FROM ${this.endpointsTableName} WHERE direction = $1 ORDER BY created_at DESC`,
      [direction]
    );
  }

  /**
   * Update endpoint
   */
  async updateEndpoint(endpointId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = ['name', 'direction', 'standard', 'transport', 'status', 'organization_id', 'config_jsonb'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field.includes('_jsonb')) {
          fields.push(`${field} = $${paramCount}`);
          values.push(this.toJSONB(updates[field]));
        } else {
          fields.push(`${field} = $${paramCount}`);
          values.push(updates[field]);
        }
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return await this.findEndpointById(endpointId);
    }

    // Always update updated_at
    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date().toISOString());
    paramCount++;

    values.push(endpointId);

    const query = `
      UPDATE ${this.endpointsTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * Delete endpoint
   */
  async deleteEndpoint(endpointId) {
    // This will be restricted by FK constraints if there are messages
    const result = await this.execute(
      `DELETE FROM ${this.endpointsTableName} WHERE id = $1`,
      [endpointId]
    );
    return result > 0;
  }

  // ========================================
  // Message Operations
  // ========================================

  /**
   * Create interop message
   */
  async createMessage(messageData) {
    const id = messageData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.messagesTableName} (
        id, endpoint_id, direction, standard, message_family, message_type,
        trigger_event, control_id, correlation_key, patient_id, encounter_id, document_id,
        processing_state, ack_state, raw_payload_text, normalized_payload_jsonb,
        error_message, received_at, sent_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      messageData.endpoint_id,
      messageData.direction || 'outbound',
      messageData.standard || 'hl7_v2',
      messageData.message_family,
      messageData.message_type,
      messageData.trigger_event || null,
      messageData.control_id || null,
      messageData.correlation_key || null,
      messageData.patient_id || null,
      messageData.encounter_id || null,
      messageData.document_id || null,
      messageData.processing_state || 'pending',
      messageData.ack_state || 'pending',
      messageData.raw_payload_text || null,
      this.toJSONB(messageData.normalized_payload || {}),
      messageData.error_message || null,
      messageData.received_at || null,
      messageData.sent_at || null,
      now
    ]);
  }

  /**
   * Find message by ID
   */
  async findMessageById(messageId) {
    return await this.findById(this.messagesTableName, messageId);
  }

  /**
   * Find messages by endpoint ID
   */
  async findMessagesByEndpointId(endpointId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy = 'created_at DESC'
    } = options;

    return await this.query(
      `SELECT * FROM ${this.messagesTableName}
       WHERE endpoint_id = $1
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [endpointId, limit, offset]
    );
  }

  /**
   * Find messages by processing state
   */
  async findMessagesByProcessingState(processingState) {
    return await this.query(
      `SELECT * FROM ${this.messagesTableName} WHERE processing_state = $1 ORDER BY created_at ASC`,
      [processingState]
    );
  }

  /**
   * Find pending messages
   */
  async findPendingMessages() {
    return await this.query(
      `SELECT * FROM ${this.messagesTableName} WHERE processing_state = 'pending' ORDER BY created_at ASC`
    );
  }

  /**
   * Find messages by entity
   */
  async findMessagesByEntity(entityType, entityId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy = 'created_at DESC'
    } = options;

    let whereClause = '';
    if (entityType === 'patient') whereClause = 'patient_id';
    else if (entityType === 'encounter') whereClause = 'encounter_id';
    else if (entityType === 'document') whereClause = 'document_id';
    else return [];

    return await this.query(
      `SELECT * FROM ${this.messagesTableName}
       WHERE ${whereClause} = $1
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [entityId, limit, offset]
    );
  }

  /**
   * Update message
   */
  async updateMessage(messageId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = [
      'processing_state', 'ack_state', 'normalized_payload_jsonb',
      'error_message', 'received_at', 'sent_at'
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field.includes('_jsonb')) {
          fields.push(`${field} = $${paramCount}`);
          values.push(this.toJSONB(updates[field]));
        } else {
          fields.push(`${field} = $${paramCount}`);
          values.push(updates[field]);
        }
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return await this.findMessageById(messageId);
    }

    values.push(messageId);

    const query = `
      UPDATE ${this.messagesTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * Mark message as processed
   */
  async markMessageAsProcessed(messageId, result = {}) {
    return await this.updateMessage(messageId, {
      processing_state: 'completed',
      normalized_payload_jsonb: result
    });
  }

  /**
   * Mark message as failed
   */
  async markMessageAsFailed(messageId, errorMessage) {
    return await this.updateMessage(messageId, {
      processing_state: 'failed',
      error_message: errorMessage
    });
  }

  /**
   * Delete message
   */
  async deleteMessage(messageId) {
    // This will cascade to message_events due to FK constraints
    const result = await this.execute(
      `DELETE FROM ${this.messagesTableName} WHERE id = $1`,
      [messageId]
    );
    return result > 0;
  }

  // ========================================
  // Message Event Operations
  // ========================================

  /**
   * Create message event
   */
  async createMessageEvent(eventData) {
    const id = eventData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.messageEventsTableName} (
        id, interop_message_id, event_type, status, details_jsonb, occurred_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      eventData.interop_message_id,
      eventData.event_type,
      eventData.status || 'started',
      this.toJSONB(eventData.details || {}),
      eventData.occurred_at || now,
      now
    ]);
  }

  /**
   * Find events by message ID
   */
  async findEventsByMessageId(messageId) {
    return await this.query(
      `SELECT * FROM ${this.messageEventsTableName} WHERE interop_message_id = $1 ORDER BY occurred_at ASC`,
      [messageId]
    );
  }

  // ========================================
  // Resource Link Operations
  // ========================================

  /**
   * Create resource link
   */
  async createResourceLink(linkData) {
    const id = linkData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.resourceLinksTableName} (
        id, internal_entity_type, internal_entity_id, external_system,
        external_resource_type, external_resource_id, external_version,
        sync_direction, link_status, last_synced_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      linkData.internal_entity_type,
      linkData.internal_entity_id,
      linkData.external_system,
      linkData.external_resource_type,
      linkData.external_resource_id,
      linkData.external_version || null,
      linkData.sync_direction || 'none',
      linkData.link_status || 'active',
      linkData.last_synced_at || null,
      now,
      now
    ]);
  }

  /**
   * Find resource links by internal entity
   */
  async findResourceLinksByInternalEntity(entityType, entityId) {
    return await this.query(
      `SELECT * FROM ${this.resourceLinksTableName}
       WHERE internal_entity_type = $1 AND internal_entity_id = $2
       ORDER BY created_at DESC`,
      [entityType, entityId]
    );
  }

  /**
   * Update resource link
   */
  async updateResourceLink(linkId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = [
      'external_version', 'sync_direction', 'link_status', 'last_synced_at'
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = $${paramCount}`);
        values.push(updates[field]);
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return await this.findById(this.resourceLinksTableName, linkId);
    }

    // Always update updated_at
    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date().toISOString());
    paramCount++;

    values.push(linkId);

    const query = `
      UPDATE ${this.resourceLinksTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Get repository statistics
   */
  async getStats() {
    const totalEndpoints = await this.count(this.endpointsTableName);
    const activeEndpoints = await this.count(this.endpointsTableName, { status: 'active' });
    const totalMessages = await this.count(this.messagesTableName);
    const pendingMessages = await this.count(this.messagesTableName, { processing_state: 'pending' });

    const endpointsByDirection = await this.query(`
      SELECT direction, COUNT(*) as count
      FROM ${this.endpointsTableName}
      GROUP BY direction
      ORDER BY count DESC
    `);

    const messagesByState = await this.query(`
      SELECT processing_state, COUNT(*) as count
      FROM ${this.messagesTableName}
      GROUP BY processing_state
      ORDER BY count DESC
    `);

    return {
      totalEndpoints,
      activeEndpoints,
      totalMessages,
      pendingMessages,
      endpointsByDirection,
      messagesByState
    };
  }

  /**
   * Get endpoint health summary
   */
  async getEndpointHealthSummary() {
    const query = `
      SELECT
        e.id, e.name, e.direction, e.standard, e.status,
        COUNT(m.id) FILTER (WHERE m.processing_state = 'pending') as pending_messages,
        COUNT(m.id) FILTER (WHERE m.processing_state = 'completed') as completed_messages,
        COUNT(m.id) FILTER (WHERE m.processing_state = 'failed') as failed_messages,
        MAX(m.created_at) as last_message_at
      FROM ${this.endpointsTableName} e
      LEFT JOIN ${this.messagesTableName} m ON e.id = m.endpoint_id
      WHERE e.status = 'active'
      GROUP BY e.id, e.name, e.direction, e.standard, e.status
      ORDER BY e.name
    `;

    return await this.query(query);
  }

  /**
   * Search endpoints
   */
  async searchEndpoints(searchTerm, limit = 50) {
    const searchPattern = `%${searchTerm}%`;
    return await this.query(
      `SELECT * FROM ${this.endpointsTableName}
       WHERE name ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [searchPattern, limit]
    );
  }

  /**
   * Clean up old messages
   */
  async cleanupOldMessages(daysToKeep = 90) {
    const threshold = `${daysToKeep} days`;

    return await this.execute(
      `DELETE FROM ${this.messagesTableName}
       WHERE created_at < NOW() - INTERVAL '${threshold}'
       AND processing_state IN ('completed', 'failed')`
    );
  }

  // ========================================
  // Phase 5: Identity Reconciliation Helper Methods
  // ========================================

  /**
   * Find endpoint trust configuration
   * Phase 5: Retrieve trusted identifier systems for external attach
   */
  async findEndpointTrustConfig(endpointId) {
    const endpoint = await this.findById(this.endpointsTableName, endpointId);
    if (!endpoint) {
      return null;
    }

    const config = this.fromJSONB(endpoint.config_jsonb);

    return {
      endpoint_id: endpoint.id,
      endpoint_name: endpoint.name,
      endpoint_status: endpoint.status,
      trusted_patient_identifier_systems: config.identity_reconciliation?.trusted_patient_identifier_systems || [],
      trusted_encounter_identifier_systems: config.identity_reconciliation?.trusted_encounter_identifier_systems || []
    };
  }

  /**
   * Find endpoint trust config by name
   * Phase 5: Convenient lookup by endpoint name
   */
  async findEndpointTrustConfigByName(endpointName) {
    const endpoint = await this.findEndpointByName(endpointName);
    if (!endpoint) {
      return null;
    }

    return await this.findEndpointTrustConfig(endpoint.id);
  }

  /**
   * Find messages by external resource identifier
   * Phase 5: Lookup messages for external identifier attach
   */
  async findMessagesByExternalResource(externalSystem, resourceType, externalResourceId) {
    const query = `
      SELECT m.* FROM ${this.messagesTableName} m
      WHERE m.normalized_payload_jsonb::text ILIKE $1
      ORDER BY m.created_at DESC
      LIMIT 100
    `;

    const searchPattern = `%${externalSystem}%${resourceType}%${externalResourceId}%`;
    return await this.query(query, [searchPattern]);
  }

  /**
   * Find active resource link by external resource
   * Phase 5: Lookup existing resource links for external identifier attach
   */
  async findActiveResourceLink(externalSystem, resourceType, externalResourceId) {
    const query = `
      SELECT * FROM ${this.resourceLinksTableName}
      WHERE external_system = $1
        AND external_resource_type = $2
        AND external_resource_id = $3
        AND link_status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    return await this.queryOne(query, [externalSystem, resourceType, externalResourceId]);
  }

  /**
   * Find resource links by internal entity
   * Phase 5: Find all external links for an internal entity
   */
  async findResourceLinksByInternalEntity(entityType, entityId) {
    const query = `
      SELECT * FROM ${this.resourceLinksTableName}
      WHERE internal_entity_type = $1
        AND internal_entity_id = $2
        AND link_status = 'active'
      ORDER BY created_at DESC
    `;

    return await this.query(query, [entityType, entityId]);
  }

  /**
   * Check if endpoint is trusted for patient identifier system
   * Phase 5: Validate endpoint trust for specific identifier system
   */
  async isEndpointTrustedForPatientSystem(endpointId, identifierSystem) {
    const config = await this.findEndpointTrustConfig(endpointId);
    if (!config || config.endpoint_status !== 'active') {
      return false;
    }

    return config.trusted_patient_identifier_systems.includes(identifierSystem);
  }

  /**
   * Check if endpoint is trusted for encounter identifier system
   * Phase 5: Validate endpoint trust for specific identifier system
   */
  async isEndpointTrustedForEncounterSystem(endpointId, identifierSystem) {
    const config = await this.findEndpointTrustConfig(endpointId);
    if (!config || config.endpoint_status !== 'active') {
      return false;
    }

    return config.trusted_encounter_identifier_systems.includes(identifierSystem);
  }

  /**
   * Find messages by entity
   * Phase 5: Find messages that reference a specific patient/encounter
   */
  async findMessagesByEntityWithPayload(entityType, entityId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy = 'created_at DESC'
    } = options;

    let whereClause = '';
    if (entityType === 'patient') whereClause = 'patient_id';
    else if (entityType === 'encounter') whereClause = 'encounter_id';
    else if (entityType === 'document') whereClause = 'document_id';
    else return [];

    const query = `
      SELECT * FROM ${this.messagesTableName}
      WHERE ${whereClause} = $1
      ORDER BY ${orderBy}
      LIMIT $2 OFFSET $3
    `;

    return await this.query(query, [entityId, limit, offset]);
  }

  /**
   * Extract identifiers from interop message payload
   * Phase 5: Helper to extract identifiers from normalized payload
   */
  extractIdentifiersFromMessagePayload(message) {
    const payload = this.fromJSONB(message.normalized_payload_jsonb);
    const identifiers = {
      patient: [],
      encounter: []
    };

    // Extract patient identifiers if present
    if (payload.patient) {
      const patient = payload.patient;
      if (patient.identifiers) {
        identifiers.patient = patient.identifiers;
      } else {
        // Fallback: try common fields
        if (patient.mrn) identifiers.patient.push({ system: 'mrn', value: patient.mrn });
        if (patient.hospital_number) identifiers.patient.push({ system: 'hospital_number', value: patient.hospital_number });
      }
    }

    // Extract encounter identifiers if present
    if (payload.encounter) {
      const encounter = payload.encounter;
      if (encounter.identifiers) {
        identifiers.encounter = encounter.identifiers;
      } else {
        // Fallback: try common fields
        if (encounter.episode_number) identifiers.encounter.push({ system: 'episode_number', value: encounter.episode_number });
        if (encounter.visit_number) identifiers.encounter.push({ system: 'visit_number', value: encounter.visit_number });
        if (encounter.ipd_number) identifiers.encounter.push({ system: 'ipd_number', value: encounter.ipd_number });
        if (encounter.opd_number) identifiers.encounter.push({ system: 'opd_number', value: encounter.opd_number });
      }
    }

    return {
      endpoint_id: message.endpoint_id,
      message_id: message.id,
      identifiers,
      raw_payload: payload
    };
  }

  /**
   * Find messages with patient identifiers
   * Phase 5: Find messages that contain patient identifier data
   */
  async findMessagesWithPatientIdentifiers(patientId) {
    const query = `
      SELECT * FROM ${this.messagesTableName}
      WHERE patient_id = $1
        AND normalized_payload_jsonb IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 100
    `;

    const messages = await this.query(query, [patientId]);
    return messages.map(msg => this.extractIdentifiersFromMessagePayload(msg));
  }

  /**
   * Find messages with encounter identifiers
   * Phase 5: Find messages that contain encounter identifier data
   */
  async findMessagesWithEncounterIdentifiers(encounterId) {
    const query = `
      SELECT * FROM ${this.messagesTableName}
      WHERE encounter_id = $1
        AND normalized_payload_jsonb IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 100
    `;

    const messages = await this.query(query, [encounterId]);
    return messages.map(msg => this.extractIdentifiersFromMessagePayload(msg));
  }

  /**
   * Get endpoint statistics
   * Phase 5: Endpoint statistics for reconciliation reporting
   */
  async getEndpointStats(endpointId) {
    const query = `
      SELECT
        COUNT(DISTINCT m.id) FILTER (WHERE m.patient_id IS NOT NULL) as patient_messages,
        COUNT(DISTINCT m.id) FILTER (WHERE m.encounter_id IS NOT NULL) as encounter_messages,
        COUNT(DISTINCT rl.id) as active_resource_links,
        COUNT(DISTINCT rl.id) FILTER (WHERE rl.internal_entity_type = 'patient') as patient_links,
        COUNT(DISTINCT rl.id) FILTER (WHERE rl.internal_entity_type = 'encounter') as encounter_links
      FROM ${this.endpointsTableName} e
      LEFT JOIN ${this.messagesTableName} m ON e.id = m.endpoint_id
      LEFT JOIN ${this.resourceLinksTableName} rl ON e.id::text = rl.external_system AND rl.link_status = 'active'
      WHERE e.id = $1
      GROUP BY e.id
    `;

    return await this.queryOne(query, [endpointId]);
  }
}

module.exports = { InteropRepository };
