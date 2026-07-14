const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { abdmConfig } = require('./abdm_config.cjs');

const SENSITIVE_KEY_PATTERN = /(aadhaar|access.?token|authorization|client.?secret|otp|password|refresh.?token|secret|token)/i;

function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSensitive(child),
    ])
  );
}

class AbdmHttpError extends Error {
  constructor(message, { statusCode = null, requestId = null } = {}) {
    super(message);
    this.name = 'AbdmHttpError';
    this.statusCode = statusCode;
    this.requestId = requestId;
  }
}

function nativeJsonRequest({ method, url, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: timeoutMs,
    }, (response) => {
      let rawBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        rawBody += chunk;
      });
      response.on('end', () => {
        let responseBody = {};
        if (rawBody) {
          try {
            responseBody = JSON.parse(rawBody);
          } catch {
            responseBody = { message: rawBody };
          }
        }
        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers,
          body: responseBody,
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('ABDM request timed out'));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

class AbdmHttpClient {
  constructor({ config = abdmConfig, requestImpl = nativeJsonRequest, logger = console } = {}) {
    this.config = config;
    this.requestImpl = requestImpl;
    this.logger = logger;
  }

  async request({ method, url, body, headers = {} }) {
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const response = await this.requestImpl({
      method,
      url,
      body,
      timeoutMs: this.config.requestTimeoutMs,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'REQUEST-ID': requestId,
        TIMESTAMP: timestamp,
        ...(this.config.cmId ? { 'X-CM-ID': this.config.cmId } : {}),
        ...headers,
      },
    });

    this.logger.info?.('[ABDM HTTP]', {
      method,
      host: new URL(url).host,
      path: new URL(url).pathname,
      requestId,
      statusCode: response.statusCode,
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AbdmHttpError(`ABDM request failed with status ${response.statusCode}`, {
        statusCode: response.statusCode,
        requestId,
      });
    }

    return response.body;
  }

  post(url, body, options = {}) {
    return this.request({ method: 'POST', url, body, headers: options.headers });
  }
}

const abdmHttpClient = new AbdmHttpClient();

module.exports = {
  AbdmHttpClient,
  AbdmHttpError,
  abdmHttpClient,
  nativeJsonRequest,
  redactSensitive,
};
