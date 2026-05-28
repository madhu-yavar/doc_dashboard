const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

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

    this.userMutationQueue = Promise.resolve();
    this.sessionMutationQueue = Promise.resolve();
    this.storageReadyPromise = null;
  }

  async ensureStorage() {
    if (!this.storageReadyPromise) {
      this.storageReadyPromise = (async () => {
        await fs.mkdir(this.storageDir, { recursive: true });
        await this.ensureCollectionFile(this.usersPath, { users: [] });
        await this.ensureCollectionFile(this.sessionsPath, { sessions: [] });
        await this.bootstrapUsersIfNeededRaw();
      })().catch((error) => {
        this.storageReadyPromise = null;
        throw error;
      });
    }

    return this.storageReadyPromise;
  }

  async ensureCollectionFile(filePath, initialValue) {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, JSON.stringify(initialValue, null, 2), "utf8");
    }
  }

  queueUserMutation(task) {
    const run = this.userMutationQueue.then(task, task);
    this.userMutationQueue = run.catch(() => {});
    return run;
  }

  queueSessionMutation(task) {
    const run = this.sessionMutationQueue.then(task, task);
    this.sessionMutationQueue = run.catch(() => {});
    return run;
  }

  async readUsers() {
    await this.ensureStorage();
    return this.readCollectionRaw(this.usersPath, "users");
  }

  async writeUsers(users) {
    await this.ensureStorage();
    await this.writeCollectionRaw(this.usersPath, "users", users);
  }

  async mutateUsers(mutator) {
    return this.queueUserMutation(async () => {
      const users = await this.readUsers();
      const result = await mutator(users);
      await this.writeUsers(users);
      return result;
    });
  }

  async readSessions() {
    await this.ensureStorage();
    return this.readCollectionRaw(this.sessionsPath, "sessions");
  }

  async writeSessions(sessions) {
    await this.ensureStorage();
    await this.writeCollectionRaw(this.sessionsPath, "sessions", sessions);
  }

  async mutateSessions(mutator) {
    return this.queueSessionMutation(async () => {
      const sessions = await this.readSessions();
      const result = await mutator(sessions);
      await this.writeSessions(sessions);
      return result;
    });
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

  async readCollectionRaw(filePath, key) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed[key]) ? parsed[key] : [];
  }

  async writeCollectionRaw(filePath, key, items) {
    await fs.writeFile(filePath, JSON.stringify({ [key]: items }, null, 2), "utf8");
  }

  async bootstrapUsersIfNeededRaw() {
    const users = await this.readCollectionRaw(this.usersPath, "users");
    if (users.length > 0) return users;

    const bootstrapSpecs = this.getBootstrapUserSpecs();
    if (bootstrapSpecs.length === 0) {
      console.warn(
        "[Auth] No bootstrap users configured. Set AUTH_BOOTSTRAP_* env vars to enable login."
      );
      return users;
    }

    const seededUsers = bootstrapSpecs.map((entry) => ({
      id: crypto.randomUUID(),
      username: entry.username,
      passwordHash: entry.passwordHash,
      role: entry.role,
      displayName: buildDisplayName(entry.username, entry.role),
      createdAt: new Date().toISOString(),
    }));

    await this.writeCollectionRaw(this.usersPath, "users", seededUsers);
    console.log(`[Auth] Bootstrapped ${seededUsers.length} user(s).`);
    return seededUsers;
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
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionDurationMs).toISOString();
    const session = {
      sessionId: crypto.randomUUID(),
      userId: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName || buildDisplayName(user.username, user.role),
      createdAt: now.toISOString(),
      expiresAt,
      lastSeenAt: now.toISOString(),
    };

    await this.mutateSessions(async (sessions) => {
      const activeSessions = sessions.filter((entry) => !isExpired(entry));
      activeSessions.unshift(session);
      sessions.splice(0, sessions.length, ...activeSessions);
    });

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

    let removed = false;
    await this.mutateSessions(async (sessions) => {
      const filtered = sessions.filter((entry) => entry.sessionId !== sessionId && !isExpired(entry));
      removed = filtered.length !== sessions.length;
      sessions.splice(0, sessions.length, ...filtered);
    });
    return removed;
  }

  async getSession(sessionId, options = {}) {
    if (!sessionId) return null;

    const { touch = true } = options;
    const now = Date.now();

    return this.mutateSessions(async (sessions) => {
      const activeSessions = sessions.filter((entry) => !isExpired(entry, now));
      sessions.splice(0, sessions.length, ...activeSessions);

      const session = sessions.find((entry) => entry.sessionId === sessionId);
      if (!session) return null;

      if (touch) {
        const updatedAt = new Date().toISOString();
        session.lastSeenAt = updatedAt;
        session.expiresAt = new Date(now + this.sessionDurationMs).toISOString();
      }

      return {
        ...session,
        user: this.buildPublicUser(session),
      };
    });
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
