const express = require('express');
const { abdmConfig, getPublicAbdmConfig } = require('./abdm_config.cjs');
const { AbdmNotConfiguredError, abdmSessionService } = require('./abdm_session_service.cjs');

function buildPhase0Status(config, gatewaySession) {
  const blockers = [];
  const credentialsReady = config.enabled;
  const callbackReady = Boolean(config.callbackBaseUrl);
  const gatewayConfigReady = config.configurationIssues.length === 0;
  const gatewayVerified = Boolean(gatewaySession.cached || gatewaySession.connected);

  if (!credentialsReady) {
    blockers.push(`Missing credentials: ${config.missingCredentials.join(', ')}`);
  }
  if (!callbackReady) {
    blockers.push('Missing ABDM_CALLBACK_BASE_URL.');
  }
  for (const issue of config.configurationIssues) {
    blockers.push(issue);
  }
  if (credentialsReady && gatewayConfigReady && !gatewayVerified) {
    blockers.push('Gateway session has not been verified in this server process.');
  }

  return {
    name: 'phase-0-sandbox-readiness',
    implementationReady: true,
    gatewayVerificationAvailable: credentialsReady && gatewayConfigReady,
    sandboxReady: credentialsReady && callbackReady && gatewayConfigReady && gatewayVerified,
    requirements: {
      credentials: credentialsReady,
      callbackUrl: callbackReady,
      gatewayConfiguration: gatewayConfigReady,
      gatewaySessionVerified: gatewayVerified,
    },
    blockers,
  };
}

function buildAbdmStatus(config, sessionService) {
  const gatewaySession = sessionService.getCachedStatus();
  return {
    ...getPublicAbdmConfig(config),
    gatewaySession,
    phase0: buildPhase0Status(config, gatewaySession),
  };
}

function createAbdmRouter({ config = abdmConfig, sessionService = abdmSessionService } = {}) {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    res.json(buildAbdmStatus(config, sessionService));
  });

  router.post('/session/verify', async (_req, res) => {
    try {
      const gatewaySession = await sessionService.verifyGatewaySession();
      return res.json({
        ...buildAbdmStatus(config, sessionService),
        gatewaySession,
      });
    } catch (error) {
      if (error instanceof AbdmNotConfiguredError || error?.code === 'ABDM_NOT_CONFIGURED') {
        return res.status(503).json({
          ...buildAbdmStatus(config, sessionService),
          error: 'ABDM credentials are not configured.',
        });
      }

      console.error('[ABDM] Gateway session verification failed', {
        name: error?.name,
        statusCode: error?.statusCode || null,
        requestId: error?.requestId || null,
      });
      return res.status(502).json({
        ...buildAbdmStatus(config, sessionService),
        error: 'ABDM gateway session verification failed.',
      });
    }
  });

  router.get('/callbacks/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'abdm-callbacks',
      environment: config.environment,
      callbackConfigured: Boolean(config.callbackBaseUrl),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

function registerAbdmRoutes(app, dependencies = {}) {
  app.use('/api/abdm', createAbdmRouter(dependencies));
}

module.exports = {
  buildPhase0Status,
  buildAbdmStatus,
  createAbdmRouter,
  registerAbdmRoutes,
};
