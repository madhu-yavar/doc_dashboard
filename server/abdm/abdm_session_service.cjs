const { abdmConfig } = require('./abdm_config.cjs');
const { abdmHttpClient } = require('./abdm_http_client.cjs');

class AbdmNotConfiguredError extends Error {
  constructor(missingCredentials) {
    super(`ABDM credentials are not configured: ${missingCredentials.join(', ')}`);
    this.name = 'AbdmNotConfiguredError';
    this.code = 'ABDM_NOT_CONFIGURED';
  }
}

function readTokenResponse(response) {
  const accessToken = response?.accessToken || response?.access_token;
  const expiresIn = Number(response?.expiresIn || response?.expires_in || 0);
  if (!accessToken) {
    throw new Error('ABDM gateway response did not include an access token');
  }
  return { accessToken, expiresIn };
}

class AbdmSessionService {
  constructor({ config = abdmConfig, httpClient = abdmHttpClient, now = () => Date.now() } = {}) {
    this.config = config;
    this.httpClient = httpClient;
    this.now = now;
    this.cachedToken = null;
  }

  getCachedStatus() {
    const valid = Boolean(this.cachedToken && this.cachedToken.expiresAt > this.now());
    return {
      cached: valid,
      expiresAt: valid ? new Date(this.cachedToken.expiresAt).toISOString() : null,
    };
  }

  clearToken() {
    this.cachedToken = null;
  }

  async getAccessToken({ forceRefresh = false } = {}) {
    if (!this.config.enabled) {
      throw new AbdmNotConfiguredError(this.config.missingCredentials);
    }

    const refreshWindowMs = 30_000;
    if (
      !forceRefresh &&
      this.cachedToken &&
      this.cachedToken.expiresAt - refreshWindowMs > this.now()
    ) {
      return this.cachedToken.accessToken;
    }

    const response = await this.httpClient.post(this.config.sessionUrl, {
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
    });
    const { accessToken, expiresIn } = readTokenResponse(response);
    const ttlSeconds = expiresIn > 0 ? expiresIn : this.config.tokenCacheTtlSeconds;
    this.cachedToken = {
      accessToken,
      expiresAt: this.now() + ttlSeconds * 1000,
    };
    return accessToken;
  }

  async verifyGatewaySession() {
    await this.getAccessToken({ forceRefresh: true });
    return {
      connected: true,
      ...this.getCachedStatus(),
    };
  }
}

const abdmSessionService = new AbdmSessionService();

module.exports = {
  AbdmNotConfiguredError,
  AbdmSessionService,
  abdmSessionService,
  readTokenResponse,
};
