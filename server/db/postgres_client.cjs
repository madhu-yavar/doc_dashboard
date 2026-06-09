const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

/**
 * PostgreSQL client for Doctor Dashboard persistence layer
 * This provides the database connection infrastructure for the phased migration
 */
class PostgresClient {
  constructor(config = {}) {
    // PostgreSQL connection configuration from environment or defaults
    this.config = {
      host: config.host || process.env.PGHOST || 'localhost',
      port: config.port || parseInt(process.env.PGPORT || '5432'),
      database: config.database || process.env.PGDATABASE || 'doctor_dashboard',
      user: config.user || process.env.PGUSER || 'postgres',
      password: config.password || process.env.PGPASSWORD || '',
      max: config.max || parseInt(process.env.PGPOOL_MAX || '20'), // Connection pool size
      idleTimeoutMillis: config.idleTimeoutMillis || parseInt(process.env.PGIDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: config.connectionTimeoutMillis || parseInt(process.env.PGCONNECTION_TIMEOUT || '2000'),
      ...config
    };

    this.pool = null;
    this.isConnected = false;
  }

  /**
   * Initialize the database connection pool
   */
  async connect() {
    if (this.isConnected) {
      console.log('PostgreSQL connection already established');
      return;
    }

    try {
      console.log('Establishing PostgreSQL connection pool...');
      console.log(`Host: ${this.config.host}:${this.config.port}`);
      console.log(`Database: ${this.config.database}`);
      console.log(`User: ${this.config.user}`);

      this.pool = new Pool(this.config);

      // Test the connection
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW() as current_time');
      console.log('✓ PostgreSQL connection successful:', result.rows[0].current_time);
      client.release();

      this.isConnected = true;
      console.log('✓ PostgreSQL connection pool ready');
    } catch (error) {
      console.error('✗ PostgreSQL connection failed:', error.message);
      throw error;
    }
  }

  /**
   * Execute a query and return all rows
   */
  async query(text, params = []) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const result = await this.pool.query(text, params);
      return result.rows;
    } catch (error) {
      console.error('Query execution failed:', error.message);
      console.error('Query:', text);
      throw error;
    }
  }

  /**
   * Execute a query and return the first row (or null)
   */
  async queryOne(text, params = []) {
    const rows = await this.query(text, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Execute a transaction with a callback
   */
  async transaction(callback) {
    if (!this.isConnected) {
      await this.connect();
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if a table exists
   */
  async tableExists(tableName) {
    const query = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      );
    `;
    const result = await this.queryOne(query, [tableName]);
    return result.exists;
  }

  /**
   * Execute a query and return the full result (for DELETE/UPDATE operations)
   */
  async execute(text, params = []) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const result = await this.pool.query(text, params);
      return result;
    } catch (error) {
      console.error('Execute failed:', error.message);
      console.error('Query:', text);
      throw error;
    }
  }

  /**
   * Get table row count
   */
  async getTableRowCount(tableName) {
    const query = `SELECT COUNT(*) as count FROM ${tableName};`;
    const result = await this.queryOne(query);
    return parseInt(result.count);
  }

  /**
   * Close the database connection pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      console.log('PostgreSQL connection pool closed');
    }
  }

  /**
   * Get connection pool status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      config: {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        max: this.config.max
      },
      pool: this.pool ? {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      } : null
    };
  }
}

// Export singleton instance
const postgresClient = new PostgresClient();

module.exports = { PostgresClient, postgresClient };