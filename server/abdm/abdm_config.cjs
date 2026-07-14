const DEFAULT_SANDBOX_GATEWAY_BASE_URL = 'https://dev.abdm.gov.in/gateway';
const DEFAULT_PRODUCTION_GATEWAY_BASE_URL = 'https://apis.abdm.gov.in/gateway';
const DEFAULT_SESSION_PATH = '/v0.5/sessions';
const SUPPORTED_ENVIRONMENTS = new Set(['sandbox', 'production']);

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildLegacyGatewayBaseUrl(value) {
  const baseUrl = trimTrailingSlash(value);
  if (!baseUrl) return '';
  return baseUrl.endsWith('/gateway') ? baseUrl : `${baseUrl}/gateway`;
}

function isLocalCallbackUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function validateUrl(name, value, { requireHttps = false } = {}) {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return `${name} must use http or https.`;
    }
    if (requireHttps && parsed.protocol !== 'https:' && !isLocalCallbackUrl(value)) {
      return `${name} must use https for public ABDM callbacks.`;
    }
    return null;
  } catch {
    return `${name} must be a valid URL.`;
  }
}

function createAbdmConfig(env = process.env) {
  const requestedEnvironment = String(env.ABDM_ENV || 'sandbox').trim().toLowerCase();
  const environment = SUPPORTED_ENVIRONMENTS.has(requestedEnvironment)
    ? requestedEnvironment
    : 'sandbox';
  const defaultGatewayBaseUrl = environment === 'production'
    ? DEFAULT_PRODUCTION_GATEWAY_BASE_URL
    : DEFAULT_SANDBOX_GATEWAY_BASE_URL;
  const gatewayBaseUrl = trimTrailingSlash(
    env.ABDM_GATEWAY_BASE_URL || buildLegacyGatewayBaseUrl(env.ABDM_SANDBOX_URL) || defaultGatewayBaseUrl
  );
  const sessionPath = String(env.ABDM_SESSION_PATH || DEFAULT_SESSION_PATH).trim();
  const clientId = String(env.ABDM_CLIENT_ID || '').trim();
  const clientSecret = String(env.ABDM_CLIENT_SECRET || '').trim();
  const callbackBaseUrl = trimTrailingSlash(
    env.ABDM_CALLBACK_BASE_URL || env.ABDM_CALLBACK_URL
  );
  const missingCredentials = [];
  const configurationIssues = [];

  if (!clientId) missingCredentials.push('ABDM_CLIENT_ID');
  if (!clientSecret) missingCredentials.push('ABDM_CLIENT_SECRET');
  if (!SUPPORTED_ENVIRONMENTS.has(requestedEnvironment)) {
    configurationIssues.push('ABDM_ENV must be sandbox or production.');
  }

  const gatewayUrlIssue = validateUrl('ABDM_GATEWAY_BASE_URL', gatewayBaseUrl);
  if (gatewayUrlIssue) configurationIssues.push(gatewayUrlIssue);

  const callbackUrlIssue = validateUrl('ABDM_CALLBACK_BASE_URL', callbackBaseUrl, {
    requireHttps: true,
  });
  if (callbackUrlIssue) configurationIssues.push(callbackUrlIssue);

  return Object.freeze({
    environment,
    enabled: missingCredentials.length === 0,
    clientId,
    clientSecret,
    callbackBaseUrl,
    gatewayBaseUrl,
    sessionUrl: `${gatewayBaseUrl}${sessionPath.startsWith('/') ? sessionPath : `/${sessionPath}`}`,
    cmId: String(env.ABDM_CM_ID || 'sbx').trim(),
    hipId: String(env.ABDM_HIP_ID || '').trim(),
    hiuId: String(env.ABDM_HIU_ID || '').trim(),
    hfrId: String(env.ABDM_HFR_ID || '').trim(),
    requestTimeoutMs: Number.parseInt(env.ABDM_REQUEST_TIMEOUT_MS || '15000', 10),
    tokenCacheTtlSeconds: Number.parseInt(env.ABDM_TOKEN_CACHE_TTL_SECONDS || '900', 10),
    missingCredentials: Object.freeze(missingCredentials),
    configurationIssues: Object.freeze(configurationIssues),
  });
}

function getPublicAbdmConfig(config) {
  return {
    environment: config.environment,
    enabled: config.enabled,
    gatewayBaseUrl: config.gatewayBaseUrl,
    callbackConfigured: Boolean(config.callbackBaseUrl),
    cmId: config.cmId || null,
    hipConfigured: Boolean(config.hipId),
    hiuConfigured: Boolean(config.hiuId),
    hfrConfigured: Boolean(config.hfrId),
    missingCredentials: [...config.missingCredentials],
    configurationIssues: [...config.configurationIssues],
  };
}

const abdmConfig = createAbdmConfig();

module.exports = {
  abdmConfig,
  createAbdmConfig,
  getPublicAbdmConfig,
};
