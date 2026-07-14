import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createAbdmConfig,
  getPublicAbdmConfig,
} = require('../../server/abdm/abdm_config.cjs');
const {
  AbdmHttpClient,
  redactSensitive,
} = require('../../server/abdm/abdm_http_client.cjs');
const {
  AbdmNotConfiguredError,
  AbdmSessionService,
} = require('../../server/abdm/abdm_session_service.cjs');
const {
  buildPhase0Status,
  buildAbdmStatus,
  createAbdmRouter,
} = require('../../server/abdm/routes.cjs');

type AbdmRequest = {
  method: string;
  url: string;
  body: Record<string, string>;
  headers: Record<string, string>;
};

type ExpressRouterLayer = {
  route?: {
    path?: string;
  };
};

describe('ABDM Phase 0 foundation', () => {
  it('loads safely without credentials and never exposes secrets in public config', () => {
    const config = createAbdmConfig({ ABDM_ENV: 'sandbox' });
    const publicConfig = getPublicAbdmConfig(config);

    expect(config.enabled).toBe(false);
    expect(config.gatewayBaseUrl).toBe('https://dev.abdm.gov.in/gateway');
    expect(publicConfig.missingCredentials).toEqual(['ABDM_CLIENT_ID', 'ABDM_CLIENT_SECRET']);
    expect(publicConfig.configurationIssues).toEqual([]);
    expect(JSON.stringify(publicConfig)).not.toContain('clientSecret');
  });

  it('reports invalid environment and callback URL configuration without crashing', () => {
    const config = createAbdmConfig({
      ABDM_ENV: 'staging',
      ABDM_CLIENT_ID: 'client-id',
      ABDM_CLIENT_SECRET: 'client-secret',
      ABDM_CALLBACK_BASE_URL: 'http://example.test/api/abdm/callbacks',
    });

    expect(config.environment).toBe('sandbox');
    expect(config.enabled).toBe(true);
    expect(config.configurationIssues).toEqual([
      'ABDM_ENV must be sandbox or production.',
      'ABDM_CALLBACK_BASE_URL must use https for public ABDM callbacks.',
    ]);
  });

  it('requests and caches an ABDM gateway session token using standard headers', async () => {
    const config = createAbdmConfig({
      ABDM_ENV: 'sandbox',
      ABDM_CLIENT_ID: 'sandbox-client',
      ABDM_CLIENT_SECRET: 'sandbox-secret',
      ABDM_GATEWAY_BASE_URL: 'https://dev.abdm.gov.in/gateway/',
      ABDM_CM_ID: 'sbx',
    });
    const requests: AbdmRequest[] = [];
    const httpClient = new AbdmHttpClient({
      config,
      logger: { info() {} },
      requestImpl: async (request: AbdmRequest) => {
        requests.push(request);
        return {
          statusCode: 200,
          headers: {},
          body: { accessToken: 'gateway-token', expiresIn: 900 },
        };
      },
    });
    const sessionService = new AbdmSessionService({
      config,
      httpClient,
      now: () => Date.parse('2026-06-15T10:00:00.000Z'),
    });

    const verification = await sessionService.verifyGatewaySession();
    const cachedToken = await sessionService.getAccessToken();

    expect(verification).toEqual({
      connected: true,
      cached: true,
      expiresAt: '2026-06-15T10:15:00.000Z',
    });
    expect(cachedToken).toBe('gateway-token');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://dev.abdm.gov.in/gateway/v0.5/sessions',
      body: {
        clientId: 'sandbox-client',
        clientSecret: 'sandbox-secret',
      },
      headers: {
        'X-CM-ID': 'sbx',
      },
    });
    expect(requests[0].headers['REQUEST-ID']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(requests[0].headers.TIMESTAMP).toBeTruthy();
  });

  it('rejects live verification when credentials are absent', async () => {
    const config = createAbdmConfig({});
    const sessionService = new AbdmSessionService({
      config,
      httpClient: { post: async () => ({}) },
    });

    await expect(sessionService.verifyGatewaySession()).rejects.toBeInstanceOf(AbdmNotConfiguredError);
  });

  it('redacts nested credentials, tokens, OTPs, and Aadhaar fields', () => {
    expect(redactSensitive({
      clientSecret: 'secret',
      nested: {
        access_token: 'token',
        otp: '123456',
        aadhaarNumber: '000011112222',
      },
    })).toEqual({
      clientSecret: '[REDACTED]',
      nested: {
        access_token: '[REDACTED]',
        otp: '[REDACTED]',
        aadhaarNumber: '[REDACTED]',
      },
    });
  });

  it('registers only the Phase 0 routes and returns secret-safe status', () => {
    const config = createAbdmConfig({
      ABDM_CLIENT_ID: 'client-id',
      ABDM_CLIENT_SECRET: 'client-secret',
      ABDM_CALLBACK_BASE_URL: 'https://example.test/api/abdm/callbacks',
    });
    const sessionService = {
      getCachedStatus: () => ({ cached: false, expiresAt: null }),
      verifyGatewaySession: async () => ({ connected: true, cached: true, expiresAt: null }),
    };
    const router = createAbdmRouter({ config, sessionService });
    const paths = (router.stack as ExpressRouterLayer[])
      .map((layer) => layer.route?.path)
      .filter(Boolean);
    const status = buildAbdmStatus(config, sessionService);

    expect(paths).toEqual(['/status', '/session/verify', '/callbacks/health']);
    expect(status.enabled).toBe(true);
    expect(status.callbackConfigured).toBe(true);
    expect(status.phase0).toMatchObject({
      name: 'phase-0-sandbox-readiness',
      implementationReady: true,
      gatewayVerificationAvailable: true,
      sandboxReady: false,
      requirements: {
        credentials: true,
        callbackUrl: true,
        gatewayConfiguration: true,
        gatewaySessionVerified: false,
      },
    });
    expect(JSON.stringify(status)).not.toContain('client-secret');
    expect(JSON.stringify(status)).not.toContain('clientId');
  });

  it('marks Phase 0 sandbox-ready only after credentials, callback, and session verification are present', () => {
    const config = createAbdmConfig({
      ABDM_CLIENT_ID: 'client-id',
      ABDM_CLIENT_SECRET: 'client-secret',
      ABDM_CALLBACK_BASE_URL: 'https://doctor-dashboard.example/api/abdm/callbacks',
    });

    expect(buildPhase0Status(config, { cached: false, expiresAt: null })).toMatchObject({
      sandboxReady: false,
      blockers: ['Gateway session has not been verified in this server process.'],
    });

    expect(buildPhase0Status(config, { cached: true, expiresAt: '2026-06-21T00:00:00.000Z' })).toMatchObject({
      sandboxReady: true,
      blockers: [],
    });
  });
});
