const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { AuthRepository } = require('./repositories/auth_repository.cjs');

const DEFAULT_COOKIE_NAME = "dd_session";
const DEFAULT_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function parseCookies(header = "") {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const index = entry.indexOf("=");
      if (index === -1) return acc;
      const key = entry.slice(0, index).trim();
      const value = entry.slice(index + 1).trim();
      if (!key) return acc;
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return role === "admin" || role === "doctor" ? role : null;
}

function buildDisplayName(username = "", role = "doctor") {
  const parts = String(username || "")
    .trim()
    .split(/[._\-\s]+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return role === "admin" ? "Admin" : "Doctor";
  }

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sanitizeUsername(value) {
  return String(value || "").trim();
}

function isExpired(session, now = Date.now()) {
  const expiresAt = Date.parse(String(session?.expiresAt || ""));
  return Number.isNaN(expiresAt) || expiresAt <= now;
}

class AuthService {
  constructor(config = {}) {
    if (!config.storageDir) {
      throw new Error("AuthService requires a storageDir");
    }

    this.storageDir = config.storageDir;
    this.usersPath = config.usersPath || path.join(this.storageDir, "users.json");
    this.sessionsPath = config.sessionsPath || path.join(this.storageDir, "auth_sessions.json");
    this.cookieName = config.cookieName || DEFAULT_COOKIE_NAME;
    this.sessionDurationMs = config.sessionDurationMs || DEFAULT_SESSION_DURATION_MS;
    this.cookieSecure =
      config.cookieSecure ??
      (process.env.AUTH_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production");

    // Phase 6: AuthRepository is now the only source of truth.
    // Allow injection for tests and isolated tooling.
    this.authRepository = config.authRepository || new AuthRepository();
    this.authRepository.initialize().catch(err => {
      console.error('[AuthService] Failed to initialize AuthRepository:', err.message);
    });
  }

  async ensureStorage() {
    // Phase 6: Bootstrap users into the primary auth repository when needed.
    return this.bootstrapUsersIfNeeded();
  }

  async readUsers() {
    // Phase 6: Read from the primary auth repository only.
    // Ensure bootstrap credentials are materialized before reads/login checks.
    await this.bootstrapUsersIfNeeded();
    const users = await this.authRepository.readUsers();
    // Transform Postgres result to match legacy JSON structure for API compatibility
    return users.map(user => ({
      id: user.id,
      username: user.username,
      passwordHash: user.password_hash,
      role: user.role,
      displayName: user.display_name,
      createdAt: user.created_at,
      practitionerId: user.practitioner_id
    }));
  }

  async readSessions() {
    // Phase 6: Read from Postgres only (legacy filesystem reads removed)
    await this.authRepository.initialize();
    const sessions = await this.authRepository.readSessionsWithUsers();
    // Transform Postgres result to match legacy JSON structure for API compatibility
    return sessions.map(session => ({
      sessionId: session.session_token,
      userId: session.user_id,
      username: session.username || null,
      role: session.role || null,
      displayName: session.display_name || null,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
      lastSeenAt: session.last_seen_at
    }));
  }

  getBootstrapUserSpecs() {
    return [
      {
        username: sanitizeUsername(process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME),
        passwordHash: String(process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH || "").trim(),
        role: "admin",
      },
      {
        username: sanitizeUsername(process.env.AUTH_BOOTSTRAP_DOCTOR_USERNAME),
        passwordHash: String(process.env.AUTH_BOOTSTRAP_DOCTOR_PASSWORD_HASH || "").trim(),
        role: "doctor",
      },
    ].filter((entry) => entry.username && entry.passwordHash);
  }

  async bootstrapUsersIfNeeded() {
    // Phase 6: Bootstrap users directly into Postgres (no filesystem).
    // Keep configured bootstrap users in sync with Postgres so local/dev login
    // remains deterministic after migrations or data refreshes.
    await this.authRepository.initialize();

    const bootstrapSpecs = this.getBootstrapUserSpecs();
    const existingUsers = await this.authRepository.readUsers();

    if (bootstrapSpecs.length === 0) {
      if (existingUsers.length > 0) {
        console.log(`[Auth] Found ${existingUsers.length} existing user(s) in Postgres, no bootstrap sync configured.`);
        return existingUsers;
      }

      console.warn(
        "[Auth] No bootstrap users configured. Set AUTH_BOOTSTRAP_* env vars to enable login."
      );
      return [];
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const entry of bootstrapSpecs) {
      const displayName = buildDisplayName(entry.username, entry.role);
      const existingUser = existingUsers.find((user) => user.username === entry.username);

      try {
        if (existingUser) {
          await this.authRepository.updateUser(existingUser.id, {
            password_hash: entry.passwordHash,
            role: entry.role,
            display_name: displayName,
            status: "active",
          });
          updatedCount += 1;
          console.log(`[Auth] Synced bootstrap user: ${entry.username} (${entry.role})`);
          continue;
        }

        const userId = crypto.randomUUID();
        await this.authRepository.createUser({
          id: userId,
          username: entry.username,
          password_hash: entry.passwordHash,
          role: entry.role,
          display_name: displayName,
          status: "active",
        });

        createdCount += 1;
        console.log(`[Auth] Bootstrapped user: ${entry.username} (${entry.role})`);
      } catch (pgError) {
        console.error(`[Auth] Failed to bootstrap user ${entry.username}:`, pgError.message);
      }
    }

    const users = await this.authRepository.readUsers();
    console.log(
      `[Auth] Bootstrap sync complete. Created ${createdCount}, updated ${updatedCount}, total users ${users.length}.`
    );
    return users;
  }

  buildPublicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName || buildDisplayName(user.username, user.role),
      role: user.role,
    };
  }

  getCookieOptions() {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure,
      path: "/",
      maxAge: this.sessionDurationMs,
    };
  }

  setSessionCookie(res, sessionId) {
    res.cookie(this.cookieName, sessionId, this.getCookieOptions());
  }

  clearSessionCookie(res) {
    res.clearCookie(this.cookieName, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure,
      path: "/",
    });
  }

  async verifyPassword(username, password) {
    const normalizedUsername = sanitizeUsername(username);
    if (!normalizedUsername || !password) return null;

    const users = await this.readUsers();
    const user = users.find((entry) => entry.username === normalizedUsername);
    if (!user || !user.passwordHash || !normalizeRole(user.role)) return null;

    const matches = await bcrypt.compare(String(password), String(user.passwordHash));
    if (!matches) return null;

    return {
      ...user,
      role: normalizeRole(user.role),
      displayName: user.displayName || buildDisplayName(user.username, user.role),
    };
  }

  async createSession(user) {
    // Phase 6: Create session in Postgres only
    await this.authRepository.initialize();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionDurationMs).toISOString();
    const sessionId = crypto.randomUUID();

    // Create session in Postgres
    await this.authRepository.createSession({
      id: sessionId,
      session_token: sessionId,
      user_id: user.id,
      expires_at: expiresAt,
      last_seen_at: now.toISOString()
    });

    const session = {
      sessionId: sessionId,
      userId: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName || buildDisplayName(user.username, user.role),
      createdAt: now.toISOString(),
      expiresAt: expiresAt,
      lastSeenAt: now.toISOString(),
    };

    return session;
  }

  async login(username, password) {
    const user = await this.verifyPassword(username, password);
    if (!user) return null;

    const session = await this.createSession(user);
    return {
      user: this.buildPublicUser(user),
      session,
    };
  }

  async logout(sessionId) {
    if (!sessionId) return false;

    // Phase 6: Delete session from Postgres only
    await this.authRepository.initialize();

    // Delete session from Postgres
    const deleted = await this.authRepository.deleteSessionByToken(sessionId);
    return deleted;
  }

  async getSession(sessionId, options = {}) {
    if (!sessionId) return null;

    // Phase 6: Get session from Postgres only
    const { touch = true } = options;
    const now = Date.now();

    try {
      await this.authRepository.initialize();
      const pgSession = await this.authRepository.findSessionByToken(sessionId);

      if (!pgSession) {
        return null;
      }

      // Check if session is expired
      if (pgSession.expires_at && new Date(pgSession.expires_at) < now) {
        return null;
      }

      // Touch session if requested
      if (touch) {
        const updatedAt = new Date().toISOString();
        const expiresAt = new Date(now + this.sessionDurationMs).toISOString();

        await this.authRepository.updateSession(pgSession.id, {
          last_seen_at: updatedAt,
          expires_at: expiresAt
        });

        return {
          sessionId: pgSession.session_token,
          userId: pgSession.user_id,
          username: pgSession.username || null,
          role: pgSession.role || null,
          displayName: pgSession.display_name || null,
          createdAt: pgSession.created_at,
          expiresAt: expiresAt,
          lastSeenAt: updatedAt,
          user: await this.buildPublicUserFromPostgres(pgSession)
        };
      }

      return {
        sessionId: pgSession.session_token,
        userId: pgSession.user_id,
        username: pgSession.username || null,
        role: pgSession.role || null,
        displayName: pgSession.display_name || null,
        createdAt: pgSession.created_at,
        expiresAt: pgSession.expires_at,
        lastSeenAt: pgSession.last_seen_at || null,
        user: await this.buildPublicUserFromPostgres(pgSession)
      };
    } catch (error) {
      console.error('[Auth] Failed to get session from Postgres:', error.message);
      return null;
    }
  }

  // Helper method to build public user from Postgres session data
  async buildPublicUserFromPostgres(pgSession) {
    // Phase 6: Get user from Postgres only
    try {
      const pgUser = await this.authRepository.findUserById(pgSession.user_id);
      if (pgUser) {
        return {
          id: pgUser.id,
          username: pgUser.username,
          role: pgUser.role,
          displayName: pgUser.display_name,
          practitionerId: pgUser.practitioner_id
        };
      }
    } catch (err) {
      console.error('[Auth] Failed to get user from Postgres:', err.message);
    }

    // Return basic user info from session if user not found in Postgres
    return {
      id: pgSession.user_id,
      username: pgSession.username || 'unknown',
      role: pgSession.role || 'user',
      displayName: pgSession.display_name || null
    };
  }

  async getSessionFromRequest(req, options = {}) {
    const cookies = parseCookies(req?.headers?.cookie || "");
    const sessionId = cookies[this.cookieName];
    if (!sessionId) return null;
    return this.getSession(sessionId, options);
  }

  async authenticateFromRequest(req, options = {}) {
    const session = await this.getSessionFromRequest(req, options);
    return session?.user || null;
  }
}

module.exports = {
  AuthService,
  DEFAULT_COOKIE_NAME,
  DEFAULT_SESSION_DURATION_MS,
  buildDisplayName,
  parseCookies,
};
