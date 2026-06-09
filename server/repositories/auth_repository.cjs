/**
 * Auth Repository - Phase 1: Repository & Data-Access Layer
 *
 * Handles user and authentication session data access.
 * Provides PostgreSQL-based persistence while maintaining interface compatibility
 * with existing file-based AuthService.
 *
 * Phase 1: Create repository layer, do not change public routes
 * Phase 2: Add dual-write capability (file + PostgreSQL)
 * Phase 3: Backfill existing data
 * Phase 4: Read cutover to PostgreSQL
 */

const { BaseRepository } = require('./base_repository.cjs');

class AuthRepository extends BaseRepository {
  constructor(postgresClientInstance = null) {
    super(postgresClientInstance);
    this.usersTableName = 'users';
    this.authSessionsTableName = 'auth_sessions';
  }

  /**
   * Initialize the repository (set up connection, etc.)
   */
  async initialize() {
    await this.connect();
    // Verify tables exist
    const usersExists = await this.tableExists(this.usersTableName);
    const sessionsExists = await this.tableExists(this.authSessionsTableName);

    if (!usersExists || !sessionsExists) {
      throw new Error('Required auth tables do not exist. Run migration first.');
    }
  }

  // ========================================
  // User Operations
  // ========================================

  /**
   * Read all users (compatible with AuthService.readUsers)
   */
  async readUsers() {
    const users = await this.query(`
      SELECT id, username, password_hash, role, display_name,
             practitioner_id, status, created_at, updated_at
      FROM ${this.usersTableName}
      ORDER BY created_at ASC
    `);

    // Convert to format compatible with existing code
    return users.map(user => ({
      id: user.id,
      username: user.username,
      password_hash: user.password_hash,
      role: user.role,
      display_name: user.display_name,
      practitioner_id: user.practitioner_id,
      status: user.status,
      created_at: user.created_at,
      updated_at: user.updated_at
    }));
  }

  /**
   * Find user by username
   */
  async findUserByUsername(username) {
    return await this.queryOne(
      `SELECT * FROM ${this.usersTableName} WHERE username = $1`,
      [username]
    );
  }

  /**
   * Find user by ID
   */
  async findUserById(userId) {
    return await this.findById(this.usersTableName, userId);
  }

  /**
   * Create new user
   */
  async createUser(userData) {
    const id = userData.id || this.generateId();
    const now = new Date().toISOString();
    // Use provided timestamps if available (for backfill), otherwise use now
    const createdAt = userData.created_at || now;
    const updatedAt = userData.updated_at || now;

    const query = `
      INSERT INTO ${this.usersTableName} (id, username, password_hash, role, display_name, practitioner_id, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await this.queryOne(query, [
      id,
      userData.username,
      userData.password_hash,
      userData.role || 'staff',
      userData.display_name,
      userData.practitioner_id || null,
      userData.status || 'active',
      createdAt,
      updatedAt
    ]);

    return result;
  }

  /**
   * Update user
   */
  async updateUser(userId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    // Build dynamic UPDATE query
    const allowedFields = ['username', 'password_hash', 'role', 'display_name', 'practitioner_id', 'status'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = $${paramCount}`);
        values.push(updates[field]);
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return await this.findUserById(userId);
    }

    // Always update updated_at
    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date().toISOString());
    paramCount++;

    values.push(userId); // WHERE clause

    const query = `
      UPDATE ${this.usersTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * Delete user
   */
  async deleteUser(userId) {
    const result = await this.execute(
      `DELETE FROM ${this.usersTableName} WHERE id = $1`,
      [userId]
    );
    return result > 0;
  }

  // ========================================
  // Auth Session Operations
  // ========================================

  /**
   * Read all sessions (compatible with AuthService.readSessions)
   */
  async readSessions() {
    const sessions = await this.query(`
      SELECT id, session_token, user_id, expires_at, last_seen_at, revoked_at, created_at
      FROM ${this.authSessionsTableName}
      ORDER BY created_at DESC
    `);

    // Convert to format compatible with existing code
    return sessions.map(session => ({
      id: session.id,
      session_token: session.session_token,
      user_id: session.user_id,
      expires_at: session.expires_at,
      last_seen_at: session.last_seen_at,
      revoked_at: session.revoked_at,
      created_at: session.created_at
    }));
  }

  /**
   * Read sessions with user information (for Phase 4 read cutover compatibility)
   */
  async readSessionsWithUsers() {
    const sessions = await this.query(`
      SELECT
        s.id, s.session_token, s.user_id, s.expires_at, s.last_seen_at, s.revoked_at, s.created_at,
        u.username, u.role, u.display_name
      FROM ${this.authSessionsTableName} s
      LEFT JOIN ${this.usersTableName} u ON s.user_id = u.id
      ORDER BY s.created_at DESC
    `);

    // Convert to format compatible with existing code
    return sessions.map(session => ({
      id: session.id,
      session_token: session.session_token,
      user_id: session.user_id,
      username: session.username,
      role: session.role,
      display_name: session.display_name,
      expires_at: session.expires_at,
      last_seen_at: session.last_seen_at,
      revoked_at: session.revoked_at,
      created_at: session.created_at
    }));
  }

  /**
   * Find session by token
   */
  async findSessionByToken(token) {
    return await this.queryOne(
      `SELECT * FROM ${this.authSessionsTableName} WHERE session_token = $1`,
      [token]
    );
  }

  /**
   * Find active sessions for a user
   */
  async findActiveSessionsByUserId(userId) {
    const now = new Date().toISOString();
    return await this.query(
      `SELECT * FROM ${this.authSessionsTableName}
       WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > $2
       ORDER BY created_at DESC`,
      [userId, now]
    );
  }

  /**
   * Create new session
   */
  async createSession(sessionData) {
    const id = sessionData.id || this.generateId();
    const now = new Date().toISOString();
    // Use provided created_at if available (for backfill), otherwise use now
    const createdAt = sessionData.created_at || now;

    const query = `
      INSERT INTO ${this.authSessionsTableName} (id, session_token, user_id, expires_at, last_seen_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    return await this.queryOne(query, [
      id,
      sessionData.session_token,
      sessionData.user_id,
      sessionData.expires_at,
      sessionData.last_seen_at || now,
      createdAt
    ]);
  }

  /**
   * Update session (last_seen_at, revoke, etc.)
   */
  async updateSession(sessionId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = ['last_seen_at', 'revoked_at', 'expires_at'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = $${paramCount}`);
        values.push(updates[field]);
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return await this.findById(this.authSessionsTableName, sessionId);
    }

    values.push(sessionId); // WHERE clause

    const query = `
      UPDATE ${this.authSessionsTableName}
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    return await this.queryOne(query, values);
  }

  /**
   * Revoke session
   */
  async revokeSession(sessionId) {
    const now = new Date().toISOString();
    return await this.updateSession(sessionId, { revoked_at: now });
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId) {
    const now = new Date().toISOString();
    return await this.execute(
      `UPDATE ${this.authSessionsTableName}
       SET revoked_at = $1
       WHERE user_id = $2
       AND revoked_at IS NULL`,
      [now, userId]
    );
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions() {
    const now = new Date().toISOString();
    return await this.execute(
      `DELETE FROM ${this.authSessionsTableName} WHERE expires_at < $1`,
      [now]
    );
  }

  /**
   * Delete session by session_token (for dual-write logout matching filesystem semantics)
   */
  async deleteSessionByToken(sessionToken) {
    return await this.execute(
      `DELETE FROM ${this.authSessionsTableName} WHERE session_token = $1`,
      [sessionToken]
    );
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Get repository statistics
   */
  async getStats() {
    const userCount = await this.count(this.usersTableName);
    const now = new Date().toISOString();

    const activeSessionCount = await this.queryOne(
      `SELECT COUNT(*) as count FROM ${this.authSessionsTableName}
       WHERE revoked_at IS NULL AND expires_at > $1`,
      [now]
    );

    return {
      users: userCount,
      activeSessions: parseInt(activeSessionCount.count) || 0
    };
  }

  /**
   * Validate session data integrity
   */
  async validateSessionIntegrity() {
    // Check for orphaned sessions (user_id references non-existent users)
    const query = `
      SELECT COUNT(*) as orphaned_count
      FROM ${this.authSessionsTableName} s
      LEFT JOIN ${this.usersTableName} u ON s.user_id = u.id
      WHERE s.user_id IS NOT NULL
      AND u.id IS NULL
    `;

    const result = await this.queryOne(query);
    return parseInt(result.orphaned_count);
  }
}

module.exports = { AuthRepository };