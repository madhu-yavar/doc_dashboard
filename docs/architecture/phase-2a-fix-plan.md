# Phase 2A Fix Plan: Dual-Write Integration (CORRECTED)

## Strategy

**DO NOT repair the current parallel-service design.** Instead, integrate dual-write capabilities into existing mutation boundaries while preserving all current API contracts and JSON file shapes.

## Phase 1: Immediate Stabilization (Critical)

### Fix 1.1: Disable Broken Phase 2A Health Router
**Problem:** Server startup fails with MODULE_NOT_FOUND from `server/health_dual_write.cjs`

**File:** `server/index.cjs`
**Line:** 1709
**Change:** Comment out the broken Phase 2A health router mount

```javascript
// TEMPORARY: Disable Phase 2A dual-write health router until properly integrated
// Line 1709: app.use('/api/health', dualWriteHealthRouter);
```

**Validation:**
```bash
# Check for MODULE_NOT_FOUND on import (will start server but should not crash)
timeout 5s node -e "require('./server/index.cjs')" 2>&1 | grep -i "MODULE_NOT_FOUND" && echo "FAILED: Module import error" || echo "OK: No module errors"

# Full server start test
npm start &
SERVER_PID=$!
sleep 3
curl http://localhost:8001/api/health
kill $SERVER_PID
```

---

## Phase 2: Core Dual-Write Integration

### Fix 2.1: Update AuthRepository to Support last_seen_at on Create
**Problem:** AuthRepository.createSession() doesn't include last_seen_at in INSERT statement

**File:** `server/repositories/auth_repository.cjs`
**Lines:** ~220

**Change:** Add last_seen_at to the INSERT query

```javascript
async createSession(sessionData) {
  const id = sessionData.id || this.generateId();
  const now = new Date().toISOString();

  const query = `
    INSERT INTO ${this.authSessionsTableName} (id, session_token, user_id, expires_at, last_seen_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;

  return await this.queryOne(query, [
    id,
    sessionData.session_token,
    sessionData.user_id,
    sessionData.expires_at,
    sessionData.last_seen_at || now, // Allow override, default to now
    now
  ]);
}
```

---

### Fix 2.2: Add Postgres User Shadow/Seed Before Session Shadow-Writes
**Problem:** Postgres users must exist before Postgres sessions can be shadow-written (FK constraint)

**File:** `server/auth_service.cjs`
**Lines:** ~173 (bootstrapUsersIfNeededRaw), ~264 (createSession)

**Change:** Add Postgres user shadow write during bootstrap

```javascript
const { AuthRepository } = require('./repositories/auth_repository.cjs');

// At class initialization:
constructor(config = {}) {
  // ... existing code ...
  this.authRepository = new AuthRepository();
  this.authRepository.initialize().catch(err => {
    console.error('[AuthService] Failed to initialize AuthRepository:', err.message);
  });
}

// In bootstrapUsersIfNeededRaw() - AFTER filesystem write, add shadow write:
async bootstrapUsersIfNeededRaw() {
  const users = await this.readCollectionRaw(this.usersPath, "users");
  if (users.length > 0) {
    // Shadow existing filesystem users to Postgres if dual-write enabled
    if (process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true') {
      await this.shadowUsersToPostgres(users);
    }
    return users;
  }

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
  
  // NEW: Shadow bootstrap users to Postgres if dual-write enabled
  if (process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true') {
    await this.shadowUsersToPostgres(seededUsers);
  }
  
  return seededUsers;
}

// NEW: Helper method to shadow users to Postgres
async shadowUsersToPostgres(users) {
  for (const user of users) {
    try {
      // Check if user already exists in Postgres
      const existingUser = await this.authRepository.findUserByUsername(user.username);
      if (existingUser) {
        console.log(`[DualWrite] User already exists in Postgres: ${user.username}`);
        continue;
      }
      
      // Map filesystem user schema to Postgres schema
      await this.authRepository.createUser({
        id: user.id,
        username: user.username,
        password_hash: user.passwordHash,
        role: user.role,
        display_name: user.displayName,
        status: 'active'
      });
      console.log(`[DualWrite] Shadowed user to Postgres: ${user.username}`);
    } catch (pgError) {
      console.error(`[DualWrite] Failed to shadow user ${user.username} to Postgres:`, pgError.message);
      // Continue with other users
    }
  }
}

// In createSession() - AFTER filesystem write, add shadow write:
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

  // EXISTING FILESYSTEM WRITE (unchanged)
  await this.mutateSessions(async (sessions) => {
    const activeSessions = sessions.filter((entry) => !isExpired(entry));
    activeSessions.unshift(session);
    sessions.splice(0, sessions.length, ...activeSessions);
  });

  // NEW: Shadow write to Postgres if enabled
  if (process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true') {
    try {
      // Map filesystem session schema to Postgres schema
      await this.authRepository.createSession({
        id: session.sessionId,
        session_token: session.sessionId,
        user_id: session.userId,
        expires_at: session.expiresAt,
        last_seen_at: session.lastSeenAt
      });
    } catch (pgError) {
      console.error('[DualWrite] Failed to shadow write session to Postgres:', pgError.message);
      // Do NOT fail the request - this is a shadow write
    }
  }

  return session;
}

// In logout() - AFTER filesystem delete, add shadow delete:
async logout(sessionId) {
  if (!sessionId) return false;

  let removed = false;
  
  // EXISTING FILESYSTEM DELETE (unchanged)
  await this.mutateSessions(async (sessions) => {
    const filtered = sessions.filter((entry) => entry.sessionId !== sessionId && !isExpired(entry));
    removed = filtered.length !== sessions.length;
    sessions.splice(0, sessions.length, ...filtered);
  });

  // NEW: Shadow delete from Postgres if enabled
  if (removed && process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true') {
    try {
      // Find session by session_token in Postgres
      const pgSession = await this.authRepository.findSessionByToken(sessionId);
      if (pgSession) {
        await this.authRepository.revokeSession(pgSession.id);
      }
    } catch (pgError) {
      console.error('[DualWrite] Failed to shadow delete session from Postgres:', pgError.message);
      // Do NOT fail the request
    }
  }
  
  return removed;
}
```

**Validation:**
- Start server with fresh storage (delete users.json if exists)
- Verify bootstrap users are created in filesystem users.json
- Check Postgres `users` table has shadow-written bootstrap users (when ENABLE_DUAL_WRITE_PHASE_2A=true)
- Login with existing test credentials (admin/madhu)
- Verify `session.sessionId` exists (same as before)
- Check Postgres `auth_sessions` table has shadow-written record with last_seen_at (when ENABLE_DUAL_WRITE_PHASE_2A=true)
- Verify login/logout work when ENABLE_DUAL_WRITE_PHASE_2A=false
- Verify login fails gracefully if Postgres is down

---

### Fix 2.2: Use Existing DocumentsRepository
**Problem:** Need to shadow document writes to Postgres using the existing repository

**File:** `server/index.cjs`
**Line:** ~2642 (document upload), ~204 (document storage structure)

**Change:** Add Postgres shadow writes using existing DocumentsRepository

**Current filesystem document object structure:**
```javascript
{
  id: uuid,
  name: "original.pdf",
  size: 12345,
  uploadedAt: "2026-06-01T10:00:00.000Z",
  status: "queued",
  department: "radiology",
  filePath: "/path/to/uploads/id.pdf",
  hash: "sha256...",
  result: null,
  error: null
}
```

```javascript
const { DocumentsRepository } = require('./repositories/documents_repository.cjs');

// Initialize repository (add near top of server/index.cjs):
const docsRepository = new DocumentsRepository();
docsRepository.initialize().catch(err => {
  console.error('[Server] Failed to initialize DocumentsRepository:', err.message);
});

// In document upload handler (line ~2642) - AFTER filesystem write:
const document = {
  id,
  name: file.originalname,
  size: file.size,
  uploadedAt: new Date().toISOString(),
  status: "queued",
  department: inferDepartment(file.originalname),
  filePath,
  hash,
  result: null,
  error: null,
};

// EXISTING FILESYSTEM WRITE (unchanged)
await mutateDocuments(async (documents) => {
  documents.unshift(document); // Note: unshift, not push
});

// NEW: Shadow write to Postgres if enabled
if (process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true') {
  try {
    // Map filesystem document schema to Postgres schema
    await docsRepository.createDocument({
      id: document.id,
      name: document.name,
      original_filename: document.name,
      mime_type: 'application/pdf', // or detect from file
      size_bytes: document.size,
      sha256_hash: document.hash,
      source_kind: 'pdf_upload',
      status: document.status === 'queued' ? 'pending' : document.status,
      department: document.department,
      uploaded_at: document.uploadedAt,
      processed_at: document.result?.processedAt || null,
      error_code: document.error ? 'PROCESSING_ERROR' : null,
      error_message: document.error || null
      // NOTE: filePath is NOT shadowed - documents table has no storage_path column
      // File path metadata would go in document_assets table (future enhancement)
    });
  } catch (pgError) {
    console.error('[DualWrite] Failed to shadow write document to Postgres:', pgError.message);
    // Do NOT fail the request
  }
}
```

**For document updates (e.g., status changes in processing):**
```javascript
// When updating document status (around line 1277, 1968, 2007, etc.):
await mutateDocuments(async (documents) => {
  const doc = documents.find(d => d.id === documentId);
  if (doc) {
    doc.status = newStatus;
    doc.result = result;
    doc.error = error;
  }
});

// NEW: Shadow update to Postgres if enabled
if (process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true') {
  try {
    await docsRepository.updateDocument(documentId, {
      status: newStatus === 'queued' ? 'pending' : newStatus,
      processed_at: newStatus === 'completed' ? new Date().toISOString() : null,
      error_code: error ? 'PROCESSING_ERROR' : null,
      error_message: error || null
    });
  } catch (pgError) {
    console.error('[DualWrite] Failed to shadow update document in Postgres:', pgError.message);
  }
}
```

**Validation:**
- Upload document via POST /api/documents/upload
- Verify `documents.json` still has `{ documents: [...] }` structure
- Verify document uses `unshift` (prepends to array, not appended)
- Check Postgres `documents` table has shadow-written record (when ENABLE_DUAL_WRITE_PHASE_2A=true)
- Verify upload works when ENABLE_DUAL_WRITE_PHASE_2A=false
- Verify upload fails gracefully if Postgres is down

---

### Fix 2.3: Add Feature Flag for Dual-Write
**Problem:** Need ability to enable/disable dual-write without code changes

**File:** `.env`
**Change:** Add feature flag (default disabled)

```bash
# Phase 2A Dual-Write (Postgres shadow writes)
ENABLE_DUAL_WRITE_PHASE_2A=false
```

**Validation:**
- Set ENABLE_DUAL_WRITE_PHASE_2A=false, verify no Postgres writes occur
- Set ENABLE_DUAL_WRITE_PHASE_2A=true, verify Postgres writes occur
- Server should start and run normally in both modes

---

## Phase 3: Parity & Repair (After Core Dual-Write Works)

### Fix 3.1: Create Parity Check Endpoints
**Problem:** Need endpoints to compare filesystem vs Postgres data using REAL file formats

**File:** `server/index.cjs`
**Change:** Add parity endpoints that read actual current file formats

```javascript
const { AuthRepository } = require('./repositories/auth_repository.cjs');
const { DocumentsRepository } = require('./repositories/documents_repository.cjs');

// Add parity endpoints when dual-write is enabled
if (process.env.ENABLE_DUAL_WRITE_PHASE_2A === 'true') {
  const authRepo = new AuthRepository();
  const docsRepo = new DocumentsRepository();
  
  app.get('/api/parity/sessions', async (req, res) => {
    try {
      // Read ACTUAL filesystem format: { sessions: [...] }
      const fsData = JSON.parse(await fs.readFile(path.join(__dirname, 'storage', 'auth_sessions.json'), 'utf8'));
      const fsSessions = fsData.sessions || [];
      
      // Read Postgres sessions (note: different field names)
      const pgSessions = await authRepo.readSessions();
      
      // Compare by sessionId (filesystem) vs session_token (postgres)
      const mismatches = [];
      fsSessions.forEach(fsSession => {
        const pgSession = pgSessions.find(s => s.session_token === fsSession.sessionId);
        if (!pgSession) {
          mismatches.push({ 
            type: 'missing_in_postgres', 
            sessionId: fsSession.sessionId,
            username: fsSession.username 
          });
        } else {
          // Compare key fields
          if (pgSession.user_id !== fsSession.userId) {
            mismatches.push({
              type: 'user_id_mismatch',
              sessionId: fsSession.sessionId,
              fs: fsSession.userId,
              pg: pgSession.user_id
            });
          }
        }
      });
      
      // Check for Postgres-only sessions
      pgSessions.forEach(pgSession => {
        const fsSession = fsSessions.find(s => s.sessionId === pgSession.session_token);
        if (!fsSession) {
          mismatches.push({
            type: 'missing_in_filesystem',
            sessionId: pgSession.session_token,
            userId: pgSession.user_id
          });
        }
      });
      
      res.json({ 
        mismatches, 
        fsCount: fsSessions.length, 
        pgCount: pgSessions.length,
        status: mismatches.length === 0 ? 'healthy' : 'diverged'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get('/api/parity/documents', async (req, res) => {
    try {
      // Read ACTUAL filesystem format: { documents: [...] }
      const fsData = JSON.parse(await fs.readFile(path.join(__dirname, 'storage', 'documents.json'), 'utf8'));
      const fsDocuments = fsData.documents || [];
      
      // Read Postgres documents
      const pgDocuments = await docsRepo.readDocuments();
      
      // Compare by id
      const mismatches = [];
      fsDocuments.forEach(fsDoc => {
        const pgDoc = pgDocuments.find(d => d.id === fsDoc.id);
        if (!pgDoc) {
          mismatches.push({
            type: 'missing_in_postgres',
            id: fsDoc.id,
            name: fsDoc.name
          });
        } else {
          // Compare key fields (filesystem uses camelCase, Postgres uses snake_case)
          if (pgDoc.name !== fsDoc.name) {
            mismatches.push({
              type: 'name_mismatch',
              id: fsDoc.id,
              fs: fsDoc.name,
              pg: pgDoc.name
            });
          }
          if (pgDoc.status !== fsDoc.status) {
            mismatches.push({
              type: 'status_mismatch',
              id: fsDoc.id,
              fs: fsDoc.status,
              pg: pgDoc.status
            });
          }
        }
      });
      
      // Check for Postgres-only documents
      pgDocuments.forEach(pgDoc => {
        const fsDoc = fsDocuments.find(d => d.id === pgDoc.id);
        if (!fsDoc) {
          mismatches.push({
            type: 'missing_in_filesystem',
            id: pgDoc.id,
            name: pgDoc.name
          });
        }
      });
      
      res.json({
        mismatches,
        fsCount: fsDocuments.length,
        pgCount: pgDocuments.length,
        status: mismatches.length === 0 ? 'healthy' : 'diverged'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get('/api/parity/users', async (req, res) => {
    try {
      // Read ACTUAL filesystem format: { users: [...] }
      const fsData = JSON.parse(await fs.readFile(path.join(__dirname, 'storage', 'users.json'), 'utf8'));
      const fsUsers = fsData.users || [];
      
      // Read Postgres users
      const pgUsers = await authRepo.readUsers();
      
      // Compare by username
      const mismatches = [];
      fsUsers.forEach(fsUser => {
        const pgUser = pgUsers.find(u => u.username === fsUser.username);
        if (!pgUser) {
          mismatches.push({
            type: 'missing_in_postgres',
            username: fsUser.username,
            id: fsUser.id
          });
        }
      });
      
      res.json({
        mismatches,
        fsCount: fsUsers.length,
        pgCount: pgUsers.length,
        status: mismatches.length === 0 ? 'healthy' : 'diverged'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
```

**Validation:**
- Login to create session
- Call GET /api/parity/sessions
- Verify counts match and no mismatches reported
- Upload document
- Call GET /api/parity/documents
- Verify counts match and no mismatches reported
- Call GET /api/parity/users
- Verify counts match and no mismatches reported

---

## Cleanup (After Phase 2A is Working)

### Remove Parallel Services
**Files to delete:**
- `server/auth_service_dual_write.cjs`
- `server/document_service_dual_write.cjs`
- `server/health_dual_write.cjs`
- `server/dual_write/parity_checker.cjs` (replaced by simpler parity endpoints above)
- `server/dual_write/dual_write_manager.cjs` (no longer needed with embedded approach)

**Reason:** These were built as parallel replacement services. With the new approach, we integrate dual-write into existing services rather than creating replacements.

---

## Validation Checklist

Run after all fixes complete:

### Server Startup
- [ ] `node -e "require('./server/index.cjs')"` - no MODULE_NOT_FOUND errors (server starts but doesn't need to exit)
- [ ] `npm start` - server starts successfully on port 8001
- [ ] GET /api/health returns 200 with health status
- [ ] Fresh server startup creates bootstrap users in both filesystem and Postgres (when ENABLE_DUAL_WRITE_PHASE_2A=true)

### Auth Functionality (Dual-Write Disabled)
- [ ] Login works with existing credentials (admin/madhu)
- [ ] Returns `session.sessionId` in expected format
- [ ] Logout works correctly
- [ ] Filesystem `auth_sessions.json` has `{ sessions: [...] }` structure
- [ ] Sessions use `sessionId`, `userId`, `expiresAt`, `lastSeenAt` fields

### Auth Functionality (Dual-Write Enabled)
- [ ] Bootstrap users are shadowed to Postgres `users` table on first startup
- [ ] Login still works same as before
- [ ] Postgres `auth_sessions` table gets shadow-written with last_seen_at
- [ ] Mapped correctly: sessionId→session_token, userId→user_id, expiresAt→expires_at, lastSeenAt→last_seen_at
- [ ] Logout shadows deletion to Postgres
- [ ] Login fails gracefully if Postgres is down

### Document Functionality (Dual-Write Disabled)
- [ ] Document upload via POST /api/documents/upload works
- [ ] `documents.json` maintains `{ documents: [...] }` structure
- [ ] Documents use `unshift` (prepended to array, not appended)
- [ ] Document fields: id, name, size, uploadedAt, status, department, filePath, hash, result, error
- [ ] Document updates work

### Document Functionality (Dual-Write Enabled)
- [ ] Document upload shadows to Postgres `documents` table
- [ ] Mapped correctly: name→name, size→size_bytes, hash→sha256_hash, status→status
- [ ] filePath is NOT shadowed (documents table has no storage_path column)
- [ ] Document updates shadow to Postgres
- [ ] Filesystem format unchanged
- [ ] Upload/update fails gracefully if Postgres is down

### Parity Checks (Dual-Write Enabled)
- [ ] GET /api/parity/sessions compares correctly
- [ ] GET /api/parity/documents compares correctly  
- [ ] GET /api/parity/users compares correctly
- [ ] All report status: 'healthy' when synchronized

---

## Summary

**Key principle:** Add Postgres shadow writes to EXISTING mutation boundaries using EXISTING repositories. Do NOT create parallel services. Preserve ALL current API contracts and file formats. Make dual-write optional via feature flag.

**Key differences from previous plan:**
1. **Reuse existing repositories:** Use `AuthRepository` and `DocumentsRepository` instead of creating new ones
2. **Correct schema mapping:** Map between camelCase filesystem fields and snake_case Postgres fields
3. **Real file formats:** Preserve exact `{ sessions: [...] }` and `{ documents: [...] }` wrapper structure
4. **Real app behavior:** Document upload uses `unshift` not `push`, sessions use `sessionId` not `session_token`
5. **Correct validation:** Use port 8001, /api/health endpoint, POST /api/documents/upload route
6. **User bootstrap prerequisite:** Shadow bootstrap users to Postgres before session shadow-writes (FK constraint)
7. **Repository updates:** Update AuthRepository.createSession() to support last_seen_at on INSERT
8. **Removed invalid mapping:** Documents table has no storage_path column, so filePath is not shadowed

**Order of operations:**
1. Fix server startup by disabling broken health router (5 minutes)
2. Update AuthRepository.createSession() to support last_seen_at (5 minutes)
3. Integrate user bootstrap shadow writes into auth_service.cjs (15 minutes)
4. Integrate session shadow writes into auth_service.cjs using AuthRepository (15 minutes)
5. Integrate document shadow writes into server/index.cjs using DocumentsRepository (30 minutes)
6. Add feature flag (5 minutes)
7. Add parity endpoints that read real file formats (30 minutes)
8. Delete parallel services (10 minutes)

**Total estimated time:** ~2 hours

**Sign-off criteria:** All validation checks pass with ENABLE_DUAL_WRITE_PHASE_2A in both true and false states.
