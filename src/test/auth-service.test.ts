// @vitest-environment node

import fs from "fs/promises";
import os from "os";
import path from "path";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const authModulePromise = import("../../server/auth_service.cjs");

const tempDirs: string[] = [];
const originalEnv = {
  AUTH_BOOTSTRAP_ADMIN_USERNAME: process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME,
  AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH: process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH,
  AUTH_BOOTSTRAP_DOCTOR_USERNAME: process.env.AUTH_BOOTSTRAP_DOCTOR_USERNAME,
  AUTH_BOOTSTRAP_DOCTOR_PASSWORD_HASH: process.env.AUTH_BOOTSTRAP_DOCTOR_PASSWORD_HASH,
};

async function makeAuthService(sessionDurationMs = 8 * 60 * 60 * 1000) {
  const { AuthService } = await authModulePromise;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "doctor-dashboard-auth-"));
  tempDirs.push(dir);
  return new AuthService({
    storageDir: dir,
    sessionDurationMs,
    cookieSecure: false,
  });
}

beforeEach(() => {
  process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME = "";
  process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH = "";
  process.env.AUTH_BOOTSTRAP_DOCTOR_USERNAME = "";
  process.env.AUTH_BOOTSTRAP_DOCTOR_PASSWORD_HASH = "";
});

afterEach(async () => {
  process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME = originalEnv.AUTH_BOOTSTRAP_ADMIN_USERNAME;
  process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH = originalEnv.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH;
  process.env.AUTH_BOOTSTRAP_DOCTOR_USERNAME = originalEnv.AUTH_BOOTSTRAP_DOCTOR_USERNAME;
  process.env.AUTH_BOOTSTRAP_DOCTOR_PASSWORD_HASH = originalEnv.AUTH_BOOTSTRAP_DOCTOR_PASSWORD_HASH;

  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("AuthService", () => {
  it("bootstraps admin and doctor users from env hashes", async () => {
    process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME = "admin.user";
    process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH = await bcrypt.hash("admin-pass", 8);
    process.env.AUTH_BOOTSTRAP_DOCTOR_USERNAME = "doctor.user";
    process.env.AUTH_BOOTSTRAP_DOCTOR_PASSWORD_HASH = await bcrypt.hash("doctor-pass", 8);

    const authService = await makeAuthService();
    await authService.ensureStorage();

    const users = await authService.readUsers();
    expect(users).toHaveLength(2);
    expect(users.map((user: { username: string }) => user.username)).toEqual([
      "admin.user",
      "doctor.user",
    ]);
  });

  it("logs users in, creates sessions, and reads them back from cookies", async () => {
    process.env.AUTH_BOOTSTRAP_DOCTOR_USERNAME = "doctor.user";
    process.env.AUTH_BOOTSTRAP_DOCTOR_PASSWORD_HASH = await bcrypt.hash("doctor-pass", 8);

    const authService = await makeAuthService();
    const loginResult = await authService.login("doctor.user", "doctor-pass");

    expect(loginResult).not.toBeNull();
    expect(loginResult?.user.role).toBe("doctor");
    expect(loginResult?.session.username).toBe("doctor.user");

    const req = {
      headers: {
        cookie: `dd_session=${encodeURIComponent(loginResult?.session.sessionId || "")}`,
      },
    };
    const session = await authService.getSessionFromRequest(req);

    expect(session?.user.username).toBe("doctor.user");
    expect(session?.user.role).toBe("doctor");
  });

  it("rejects expired sessions and removes them on logout", async () => {
    process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME = "admin.user";
    process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH = await bcrypt.hash("admin-pass", 8);

    const authService = await makeAuthService(25);
    const loginResult = await authService.login("admin.user", "admin-pass");

    expect(await authService.verifyPassword("admin.user", "wrong-pass")).toBeNull();
    expect(loginResult?.session.sessionId).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 40));
    const expiredSession = await authService.getSession(loginResult?.session.sessionId || "", { touch: false });
    expect(expiredSession).toBeNull();

    const secondLogin = await authService.login("admin.user", "admin-pass");
    expect(secondLogin?.session.sessionId).toBeTruthy();
    await authService.logout(secondLogin?.session.sessionId || "");
    const removedSession = await authService.getSession(secondLogin?.session.sessionId || "", { touch: false });
    expect(removedSession).toBeNull();
  });
});
