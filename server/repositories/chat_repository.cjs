/**
 * Chat Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles chat sessions, messages, actions, and exports data access.
 * Provides PostgreSQL-based persistence for chat functionality.
 *
 * Related Tables:
 * - chat_sessions
 * - chat_messages
 * - chat_confirmed_actions
 * - chat_exports
 *
 * Phase 1: Create repository layer, do not change public routes
 * Phase 2: Add dual-write capability (JSON files + PostgreSQL)
 * Phase 3: Backfill existing data from chat_sessions.json, chat_actions.json, chat_exports.json
 * Phase 4: Read cutover to PostgreSQL
 */

const { BaseRepository } = require('./base_repository.cjs');

class ChatRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.chatSessionsTableName = 'chat_sessions';
    this.chatMessagesTableName = 'chat_messages';
    this.chatConfirmedActionsTableName = 'chat_confirmed_actions';
    this.chatExportsTableName = 'chat_exports';
    this.documentsTableName = 'documents';
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    await this.connect();
    const tablesExist = await this.tableExists(this.chatSessionsTableName);
    if (!tablesExist) {
      throw new Error('Chat tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // Chat Session Operations
  // ========================================

  /**
   * Create chat session
   */
  async createChatSession(sessionData) {
    const id = sessionData.id || this.generateId();
    const now = new Date().toISOString();

    const query = `
      INSERT INTO ${this.chatSessionsTableName} (
        id, document_id, user_id, status, pending_external_consent_jsonb,
        pending_clarification_jsonb, pending_provider_prompt_jsonb, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      sessionData.document_id || null,
      sessionData.user_id,
      sessionData.status || 'active',
      this.toJSONB(sessionData.pending_external_consent || {}),
      this.toJSONB(sessionData.pending_clarification || {}),
      this.toJSONB(sessionData.pending_provider_prompt || {}),
      now,
      now
    ]);
  }

  /**
   * Find chat session by ID
   */
  async findChatSessionById(sessionId) {
    return await this.findById(this.chatSessionsTableName, sessionId);
  }

  /**
   * Find chat sessions by document ID
   */
  async findChatSessionsByDocumentId(documentId) {
    return await this.query(
      `SELECT * FROM ${this.chatSessionsTableName} WHERE document_id = $1 ORDER BY created_at DESC`,
      [documentId]
    );
  }

  /**
   * Find chat sessions by user ID
   */
  async findChatSessionsByUserId(userId) {
    return await this.query(
      `SELECT * FROM ${this.chatSessionsTableName} WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
  }

  /**
   * Update chat session
   */
  async updateChatSession(sessionId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    // Handle status separately (it's a TEXT enum, not JSONB)
    if (updates.status !== undefined) {
      fields.push(`status = $${paramCount}`);
      values.push(updates.status);
      paramCount++;
    }

    // Handle JSONB fields with toJSONB
    const jsonbFields = ['pending_external_consent_jsonb', 'pending_clarification_jsonb', 'pending_provider_prompt_jsonb'];
    for (const field of jsonbFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = $${paramCount}`);
        values.push(this.toJSONB(updates[field]));
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return await this.findChatSessionById(sessionId);
    }

    // Always update updated_at
    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date().toISOString());
    paramCount++;

    values.push(sessionId);

    const query = `
      UPDATE ${this.chatSessionsTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * Delete chat session
   */
  async deleteChatSession(sessionId) {
    // This will cascade to messages, actions, and exports due to FK constraints
    const result = await this.execute(
      `DELETE FROM ${this.chatSessionsTableName} WHERE id = $1`,
      [sessionId]
    );
    return result > 0;
  }

  // ========================================
  // Chat Message Operations
  // ========================================

  /**
   * Create chat message
   */
  async createMessage(messageData) {
    const id = messageData.id || this.generateId();
    const createdAt = messageData.created_at || new Date().toISOString();

    const query = `
      INSERT INTO ${this.chatMessagesTableName} (
        id, chat_session_id, role, content, citations_jsonb, confidence_score,
        confidence_label, source_class, proposed_actions_jsonb, decision_prompt_jsonb,
        trace_jsonb, provider, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      messageData.chat_session_id,
      messageData.role,
      messageData.content,
      this.toJSONB(messageData.citations || []),
      messageData.confidence_score || null,
      messageData.confidence_label || null,
      messageData.source_class || null,
      this.toJSONB(messageData.proposed_actions || []),
      this.toJSONB(messageData.decision_prompt || {}),
      this.toJSONB(messageData.trace || {}),
      messageData.provider || null,
      createdAt
    ]);
  }

  /**
   * Find messages by chat session ID
   */
  async findMessagesByChatSessionId(sessionId, options = {}) {
    const {
      limit = null,
      orderBy = 'created_at ASC'
    } = options;

    let limitClause = '';
    if (limit) {
      limitClause = `LIMIT ${limit}`;
    }

    return await this.query(
      `SELECT * FROM ${this.chatMessagesTableName}
       WHERE chat_session_id = $1
       ORDER BY ${orderBy}
       ${limitClause}
      `,
      [sessionId]
    );
  }

  /**
   * Find message by ID
   */
  async findMessageById(messageId) {
    return await this.findById(this.chatMessagesTableName, messageId);
  }

  /**
   * Get message count for a session
   */
  async getMessageCount(sessionId) {
    const result = await this.queryOne(
      `SELECT COUNT(*) as count FROM ${this.chatMessagesTableName} WHERE chat_session_id = $1`,
      [sessionId]
    );
    return parseInt(result.count);
  }

  // ========================================
  // Chat Confirmed Actions Operations
  // ========================================

  /**
   * Create confirmed action
   */
  async createConfirmedAction(actionData) {
    const id = actionData.id || this.generateId();
    const confirmedAt = actionData.confirmed_at || new Date().toISOString();
    const createdAt = actionData.created_at || confirmedAt;

    const query = `
      INSERT INTO ${this.chatConfirmedActionsTableName} (
        id, chat_session_id, document_id, action_type, title, rationale,
        payload_jsonb, confirmed_by_user_id, confirmed_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      actionData.chat_session_id,
      actionData.document_id || null,
      actionData.action_type,
      actionData.title,
      actionData.rationale,
      this.toJSONB(actionData.payload || {}),
      actionData.confirmed_by_user_id || null,
      confirmedAt,
      createdAt
    ]);
  }

  /**
   * Find confirmed actions by session ID
   */
  async findActionsBySessionId(sessionId) {
    return await this.query(
      `SELECT * FROM ${this.chatConfirmedActionsTableName}
       WHERE chat_session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );
  }

  /**
   * Find confirmed actions by document ID
   */
  async findActionsByDocumentId(documentId) {
    return await this.query(
      `SELECT * FROM ${this.chatConfirmedActionsTableName}
       WHERE document_id = $1
       ORDER BY created_at ASC`,
      [documentId]
    );
  }

  // ========================================
  // Chat Exports Operations
  // ========================================

  /**
   * Create chat export
   */
  async createExport(exportData) {
    const id = exportData.id || this.generateId();
    const createdAt = exportData.created_at || new Date().toISOString();

    const query = `
      INSERT INTO ${this.chatExportsTableName} (
        id, chat_session_id, document_id, export_payload_jsonb, created_by_user_id, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6
      ) RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      exportData.chat_session_id,
      exportData.document_id || null,
      this.toJSONB(exportData.export_payload || {}),
      exportData.created_by_user_id || null,
      createdAt
    ]);
  }

  /**
   * Find export by ID
   */
  async findExportById(exportId) {
    return await this.findById(this.chatExportsTableName, exportId);
  }

  /**
   * Find exports by session ID
   */
  async findExportsBySessionId(sessionId) {
    return await this.query(
      `SELECT * FROM ${this.chatExportsTableName}
       WHERE chat_session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Get repository statistics
   */
  async getStats() {
    const totalSessions = await this.count(this.chatSessionsTableName);
    const activeSessions = await this.count(this.chatSessionsTableName, { status: 'active' });
    const totalMessages = await this.count(this.chatMessagesTableName);
    const totalActions = await this.count(this.chatConfirmedActionsTableName);
    const totalExports = await this.count(this.chatExportsTableName);

    return {
      totalSessions,
      activeSessions,
      totalMessages,
      totalActions,
      totalExports
    };
  }

  /**
   * Find recent activity across all chat entities
   */
  async findRecentActivity(limit = 50) {
    const messages = await this.query(
      `SELECT id, created_at, 'message' as type FROM ${this.chatMessagesTableName}
       WHERE created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    const actions = await this.query(
      `SELECT id, created_at, 'action' as type FROM ${this.chatConfirmedActionsTableName}
       WHERE created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return [
      ...messages.map(m => ({ ...m, table: 'chat_messages' })),
      ...actions.map(a => ({ ...a, table: 'chat_confirmed_actions' }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
  }
}

module.exports = { ChatRepository };
