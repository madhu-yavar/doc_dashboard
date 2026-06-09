/**
 * Repository Index - Phase 1: Repository & Data-Access Layer
 *
 * Central export point for all repository classes.
 * This file provides a unified interface to the repository layer.
 *
 * Repositories create persistence boundaries per domain as per Phase 1 requirements:
 * - AuthRepository (users, auth_sessions)
 * - DocumentsRepository (documents, assets, extractions, chart notes, prescriptions)
 * - TranscriptsRepository (transcripts, segments)
 * - ChatRepository (chat sessions, messages, actions, exports)
 * - LiveSessionsRepository (live conversation sessions, participants)
 * - AuditRepository (audit runs, items)
 * - AlertsRepository (pharmacy alerts, department alerts)
 * - AnalyticsRepository (analytics document metrics)
 * - InteropRepository (interoperability integrations, sync jobs)
 *
 * Phase 1: Create repository layer, do not change public routes
 * Phase 2: Add dual-write capability
 * Phase 3: Backfill existing data
 * Phase 4: Read cutover to PostgreSQL
 */

const { AuthRepository } = require('./auth_repository.cjs');
const { DocumentsRepository } = require('./documents_repository.cjs');
const { TranscriptsRepository } = require('./transcripts_repository.cjs');
const { ChatRepository } = require('./chat_repository.cjs');
const { LiveSessionsRepository } = require('./live_sessions_repository.cjs');
const { ReviewWorkflowRepository } = require('./review_workflow_repository.cjs');
const { AuditRepository } = require('./audit_repository.cjs');
const { AlertsRepository } = require('./alerts_repository.cjs');
const { AnalyticsRepository } = require('./analytics_repository.cjs');
const { InteropRepository } = require('./interop_repository.cjs');
const { MasterDataRepository } = require('./master_data_repository.cjs');

// Export all repository classes
module.exports = {
  AuthRepository,
  DocumentsRepository,
  TranscriptsRepository,
  ChatRepository,
  LiveSessionsRepository,
  ReviewWorkflowRepository,
  AuditRepository,
  AlertsRepository,
  AnalyticsRepository,
  InteropRepository,
  MasterDataRepository,

  // Factory function to get initialized repository
  getRepository: (repositoryType, clientInstance = null) => {
    let repository;

    switch (repositoryType) {
      case 'auth':
        repository = new AuthRepository(clientInstance);
        break;
      case 'documents':
        repository = new DocumentsRepository(clientInstance);
        break;
      case 'transcripts':
        repository = new TranscriptsRepository(clientInstance);
        break;
      case 'chat':
        repository = new ChatRepository(clientInstance);
        break;
      case 'live_sessions':
        repository = new LiveSessionsRepository(clientInstance);
        break;
      case 'review_workflow':
        repository = new ReviewWorkflowRepository(clientInstance);
        break;
      case 'audit':
        repository = new AuditRepository(clientInstance);
        break;
      case 'alerts':
        repository = new AlertsRepository(clientInstance);
        break;
      case 'analytics':
        repository = new AnalyticsRepository(clientInstance);
        break;
      case 'interop':
        repository = new InteropRepository(clientInstance);
        break;
      case 'master_data':
        repository = new MasterDataRepository(clientInstance);
        break;
      default:
        throw new Error(`Unknown repository type: ${repositoryType}`);
    }

    return repository;
  },

  // Initialize all repositories
  initializeAll: async () => {
    const { postgresClient } = require('../db/postgres_client.cjs');
    await postgresClient.connect();

    const repositories = [
      new AuthRepository(postgresClient),
      new DocumentsRepository(postgresClient),
      new TranscriptsRepository(postgresClient),
      new ChatRepository(postgresClient),
      new LiveSessionsRepository(postgresClient),
      new ReviewWorkflowRepository(postgresClient),
      new AuditRepository(postgresClient),
      new AlertsRepository(postgresClient),
      new AnalyticsRepository(postgresClient),
      new InteropRepository(postgresClient),
      new MasterDataRepository(postgresClient)
    ];

    const initPromises = repositories.map(repo => repo.initialize().catch(error => {
      console.error(`Failed to initialize repository: ${error.message}`);
      throw error;
    }));

    await Promise.all(initPromises);

    console.log('✓ All repositories initialized successfully');
    return repositories;
  }
};