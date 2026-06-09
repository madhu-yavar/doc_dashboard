/**
 * Base Repository Class for Phase 1: Repository & Data-Access Layer
 *
 * Provides common patterns and utilities for all domain repositories.
 * Each repository extends this base class and implements domain-specific methods.
 *
 * Phase 1 Goals:
 * - Create persistence boundaries per domain
 * - Keep filesystem assets in place
 * - Do not change public routes
 * - Maintain compatibility with existing interfaces
 */

const { postgresClient } = require('../db/postgres_client.cjs');

class BaseRepository {
  constructor(postgresClientInstance = null) {
    this.client = postgresClientInstance || postgresClient;
    this.isConnected = false;
  }

  /**
   * Initialize database connection
   */
  async connect() {
    if (!this.isConnected) {
      await this.client.connect();
      this.isConnected = true;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.isConnected) {
      await this.client.close();
      this.isConnected = false;
    }
  }

  /**
   * Execute a query and return all rows
   */
  async query(text, params = []) {
    if (!this.isConnected) {
      await this.connect();
    }
    return await this.client.query(text, params);
  }

  /**
   * Execute a query and return the first row (or null)
   */
  async queryOne(text, params = []) {
    if (!this.isConnected) {
      await this.connect();
    }
    return await this.client.queryOne(text, params);
  }

  /**
   * Execute a query and return the affected row count
   */
  async execute(text, params = []) {
    if (!this.isConnected) {
      await this.connect();
    }
    const result = await this.client.execute(text, params);
    return result.rowCount || 0;
  }

  /**
   * Check if a table exists in the database
   */
  async tableExists(tableName) {
    try {
      const result = await this.queryOne(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = $1
        )
      `, [tableName]);
      return result.exists || false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a record exists by ID
   */
  async existsById(tableName, id) {
    try {
      const result = await this.queryOne(`SELECT 1 FROM ${tableName} WHERE id = $1 LIMIT 1`, [id]);
      return !!result;
    } catch (error) {
      return false;
    }
  }

  /**
   * Find a record by ID
   */
  async findById(tableName, id) {
    return await this.queryOne(`SELECT * FROM ${tableName} WHERE id = $1`, [id]);
  }

  /**
   * Find multiple records by a column value
   */
  async findByColumn(tableName, columnName, value) {
    return await this.query(`SELECT * FROM ${tableName} WHERE ${columnName} = $1`, [value]);
  }

  /**
   * Find multiple records with pagination
   */
  async findPaginated(tableName, options = {}) {
    const {
      where = {},
      orderBy = 'created_at DESC',
      limit = 50,
      offset = 0
    } = options;

    let whereClause = '';
    let params = [];

    if (Object.keys(where).length > 0) {
      const conditions = Object.entries(where)
        .map(([key, value]) => `${key} = $${params.length + 1}`)
        .join(' AND ');

      whereClause = `WHERE ${conditions}`;
      params = [...Object.values(where)];
    }

    const query = `
      SELECT * FROM ${tableName}
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    params.push(limit, offset);
    return await this.query(query, params);
  }

  /**
   * Count records with optional filter
   */
  async count(tableName, where = {}) {
    let whereClause = '';
    let params = [];

    if (Object.keys(where).length > 0) {
      const conditions = Object.entries(where)
        .map(([key, value]) => `${key} = $${params.length + 1}`)
        .join(' AND ');

      whereClause = `WHERE ${conditions}`;
      params = [...Object.values(where)];
    }

    const query = `SELECT COUNT(*) as count FROM ${tableName} ${whereClause}`;
    const result = await this.queryOne(query, params);
    return parseInt(result.count);
  }

  /**
   * Generate a unique ID
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Convert array to JSONB for PostgreSQL
   */
  toJSONB(obj) {
    return JSON.stringify(obj || {});
  }

  /**
   * Parse JSONB from PostgreSQL
   */
  fromJSONB(jsonb) {
    if (typeof jsonb === 'string') {
      try {
        return JSON.parse(jsonb);
      } catch {
        return {};
      }
    }
    return jsonb || {};
  }

  /**
   * Transaction wrapper
   */
  async transaction(callback) {
    return await this.client.transaction(callback);
  }

  /**
   * Health check for repository
   */
  async healthCheck() {
    try {
      await this.connect();
      await this.query('SELECT 1');
      return { status: 'healthy', connected: true };
    } catch (error) {
      return { status: 'unhealthy', connected: false, error: error.message };
    }
  }
}

module.exports = { BaseRepository };