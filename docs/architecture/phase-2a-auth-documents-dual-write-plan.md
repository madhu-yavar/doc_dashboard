# Phase 2A: Auth & Documents Dual-Write Implementation Plan

## Scope & Sequencing

**Phase 2A Scope**: Auth + Documents domains only
**Phase 2B Scope**: Remaining domains (voice/live/chat/audit/alerts/analytics/interop)
**Interop Boundary**: Keep HL7/FHIR adapters disabled throughout Phase 2

## Critical Decisions (Locked Down)

### 1. Source of Truth
**Decision**: **Filesystem/JSON remains authoritative during Phase 2**
- PostgreSQL is the "shadow copy" during dual-write
- Read operations continue from filesystem
- PostgreSQL used for validation and parity checks only
- **Why**: Allows safe rollback by ignoring PostgreSQL if issues arise

### 2. Write Order
**Decision**: **Filesystem first, PostgreSQL second**
- All mutations write to filesystem first
- Only after filesystem write succeeds, write to PostgreSQL
- PostgreSQL write failures are logged but don't block the request
- **Why**: Maintains existing system behavior, PostgreSQL failures are non-blocking

### 3. Failure Behavior
**Decision**: **PostgreSQL failures are logged but non-blocking**
- Filesystem write failure → Request fails (existing behavior)
- PostgreSQL write failure → Log error, continue, create repair record
- Constraint violations → Log details, continue, don't block user request
- **Why**: Prevents PostgreSQL issues from breaking existing functionality

### 4. Idempotency Rules
**Decision**: **All writes must be idempotent**
- Check for existing records before insert
- Use upsert operations where possible
- Retry logic should not create duplicate data
- **Why**: Essential for repair mechanisms and retry safety

### 5. Observability Requirements
**Decision**: **Every divergence is logged and counted**
- Dual-write mismatch log: `server/storage/dual_write_mismatches.jsonl`
- Health check endpoint: `/api/health/dual-write-status`
- Counters: successful_writes, postgres_failures, parity_failures
- **Why**: Enables detection of silent divergence

## Phase 2A Implementation Domains

### Auth Domain
**Tables**: `users`, `auth_sessions`
**File Sources**: `server/storage/users.json`, `server/storage/auth_sessions.json`

**Operations to Dual-Write**:
- User creation
- User updates (password changes, role changes)
- Session creation
- Session revocation/deletion

**Idempotency Strategy**:
- Users: Check username uniqueness before insert
- Sessions: Check session_token uniqueness before insert

### Documents Domain
**Tables**: `documents`, `document_assets`, `document_extractions`
**File Sources**: `server/storage/documents.json`, existing file paths

**Operations to Dual-Write**:
- Document creation
- Document metadata updates
- Asset creation
- Extraction creation/updates

**Idempotency Strategy**:
- Documents: Check `sha256_hash` for deduplication
- Assets: Check `path_or_uri` for uniqueness
- Extractions: Use version numbers for upsert logic

## Implementation Steps

### Step 1: Create Dual-Write Infrastructure (1 day)

**1.1 Create Dual-Write Manager**
```javascript
// server/dual_write/dual_write_manager.cjs
class DualWriteManager {
  async writeWithFallback(fileOperation, postgresOperation, context) {
    // File operation first
    try {
      const fileResult = await fileOperation();
      if (!fileResult.success) {
        return { success: false, error: fileResult.error };
      }
    } catch (error) {
      return { success: false, error };
    }

    // PostgreSQL operation second (non-blocking)
    try {
      const pgResult = await postgresOperation();
      this.logSuccess(context);
    } catch (error) {
      this.logPostgresFailure(context, error);
      this.createRepairRecord(context, error);
    }

    return { success: true, data: fileResult.data };
  }
}
```

**1.2 Create Parity Checker**
```javascript
// server/dual_write/parity_checker.cjs
class ParityChecker {
  async compareAuthData() {
    // Compare users.json vs users table
    // Compare auth_sessions.json vs auth_sessions table
  }

  async compareDocumentData() {
    // Compare documents.json vs documents table
    // Verify asset file references match database records
  }

  async reportDivergences() {
    // Return detailed mismatch report
  }
}
```

**1.3 Create Observability Infrastructure**
```javascript
// server/dual_write/health_monitor.cjs
class DualWriteHealthMonitor {
  constructor() {
    this.metrics = {
      total_writes: 0,
      successful_dual_writes: 0,
      postgres_failures: 0,
      parity_failures: 0,
      last_check: null
    };
  }

  async recordWrite(domain, operation, success) {
    this.metrics.total_writes++;
    if (success) {
      this.metrics.successful_dual_writes++;
    } else {
      this.metrics.postgres_failures++;
    }
  }

  getHealthStatus() {
    return {
      status: this.calculateHealthStatus(),
      metrics: this.metrics,
      recommendations: this.getRecommendations()
    };
  }
}
```

### Step 2: Modify Existing Auth Service (2 days)

**2.1 Update AuthService to use Dual-Write Manager**

**Current Pattern**:
```javascript
// Existing code in auth_service.cjs
async createUser(userData) {
  const users = this.readUsers();
  // ... validation logic ...
  users.push(newUser);
  this.writeUsers(users);
  return newUser;
}
```

**Dual-Write Pattern**:
```javascript
// Modified auth_service.cjs
async createUser(userData) {
  const users = this.readUsers();
  // ... existing validation logic ...

  const dualWriteManager = require('../dual_write/dual_write_manager.cjs');

  return await dualWriteManager.writeWithFallback(
    // File operation (existing)
    async () => {
      users.push(newUser);
      this.writeUsers(users);
      return { success: true, data: newUser };
    },
    // PostgreSQL operation (new)
    async () => {
      const { AuthRepository } = require('../repositories/index.cjs');
      const authRepo = new AuthRepository();
      await authRepo.createUser(newUser);
      await authRepo.close();
      return { success: true };
    },
    { domain: 'auth', operation: 'createUser', userId: userData.username }
  );
}
```

**2.2 Apply Same Pattern to Other Auth Operations**
- `createSession()`
- `updateUser()`
- `revokeSession()`
- `deleteUser()`

### Step 3: Modify Existing Document Operations (3 days)

**3.1 Update Document Creation**

**Current Pattern**:
```javascript
// Existing code in server/index.cjs or document handlers
async handleDocumentUpload(req, res) {
  const documents = this.readDocuments();
  const newDoc = {
    id: generateId(),
    // ... document fields ...
  };
  documents.push(newDoc);
  this.writeDocuments(documents);
  return newDoc;
}
```

**Dual-Write Pattern**:
```javascript
// Modified document handler
async handleDocumentUpload(req, res) {
  const dualWriteManager = require('../dual_write/dual_write_manager.cjs');
  const { DocumentsRepository } = require('../repositories/index.cjs');

  const documents = this.readDocuments();
  const newDoc = {
    id: generateId(),
    // ... document fields ...
  };

  return await dualWriteManager.writeWithFallback(
    // File operation (existing)
    async () => {
      // Check for duplicate hash (idempotency)
      const existing = documents.find(d => d.sha256_hash === newDoc.sha256_hash);
      if (existing) {
        return { success: true, data: existing }; // Idempotent
      }
      documents.push(newDoc);
      this.writeDocuments(documents);
      return { success: true, data: newDoc };
    },
    // PostgreSQL operation (new)
    async () => {
      const docRepo = new DocumentsRepository();
      await docRepo.initialize();

      // Check for existing hash (idempotency)
      const existing = await docRepo.findDocumentByHash(newDoc.sha256_hash);
      if (existing) {
        await docRepo.updateDocument(existing.id, newDoc);
      } else {
        await docRepo.createDocument(newDoc);
      }
      await docRepo.close();
      return { success: true };
    },
    { domain: 'documents', operation: 'createDocument', docId: newDoc.id }
  );
}
```

**3.2 Apply Same Pattern to Other Document Operations**
- Document metadata updates
- Asset creation
- Extraction creation/updates

### Step 4: Add Idempotency Guards (1 day)

**4.1 Auth Domain Idempotency**
```javascript
// In auth_service.cjs modifications
async createUser(userData) {
  // Check for existing username (file + postgres)
  const existingUser = users.find(u => u.username === userData.username);
  if (existingUser) {
    throw new Error(`User ${userData.username} already exists`);
  }

  // ... proceed with dual-write ...
}
```

**4.2 Document Domain Idempotency**
```javascript
// In document handlers
async handleDocumentUpload(req, res) {
  // Check for existing hash (file + postgres)
  const existingByHash = documents.find(d => d.sha256_hash === fileHash);
  if (existingByHash) {
    return existingByHash; // Return existing document (idempotent)
  }

  // ... proceed with dual-write ...
}
```

### Step 5: Add Observability Endpoints (1 day)

**5.1 Health Check Endpoint**
```javascript
// GET /api/health/dual-write-status
app.get('/api/health/dual-write-status', async (req, res) => {
  const { DualWriteHealthMonitor } = require('../dual_write/health_monitor.cjs');
  const monitor = new DualWriteHealthMonitor();
  
  const health = await monitor.getHealthStatus();
  res.json(health);
});
```

**5.2 Parity Check Endpoint**
```javascript
// GET /api/health/dual-write-parity
app.get('/api/health/dual-write-parity', async (req, res) => {
  const { ParityChecker } = require('../dual_write/parity_checker.cjs');
  const checker = new ParityChecker();
  
  const authParity = await checker.compareAuthData();
  const documentParity = await checker.compareDocumentData();
  
  res.json({
    auth: authParity,
    documents: documentParity,
    timestamp: new Date().toISOString()
  });
});
```

### Step 6: Add Logging & Repair Records (1 day)

**6.1 Dual-Write Mismatch Log**
```javascript
// server/dual_write/mismatch_logger.cjs
class MismatchLogger {
  async logMismatch(context, error) {
    const mismatch = {
      timestamp: new Date().toISOString(),
      domain: context.domain,
      operation: context.operation,
      entity_id: context.entityId,
      error_type: error.constructor.name,
      error_message: error.message,
      stack_trace: error.stack,
      resolved: false
    };

    // Write to JSONL file
    fs.appendFileSync(
      'server/storage/dual_write_mismatches.jsonl',
      JSON.stringify(mismatch) + '\n'
    );
  }

  async createRepairRecord(context, error) {
    const repair = {
      timestamp: new Date().toISOString(),
      domain: context.domain,
      operation: context.operation,
      entity_id: context.entityId,
      file_data: context.fileData,
      required_postgres_operation: context.postgresOp,
      error_details: error.message,
      priority: this.determinePriority(error),
      created_at: new Date().toISOString()
    };

    // Write to repair queue
    fs.appendFileSync(
      'server/storage/repair_queue.jsonl',
      JSON.stringify(repair) + '\n'
    );
  }
}
```

## Testing Strategy for Phase 2A

### Unit Tests (Add to existing test suite)

**Test File**: `server/dual_write/test_dual_write.cjs`

```javascript
describe('Phase 2A Dual-Write Tests', () => {
  test('Auth user creation writes to both file and postgres', async () => {
    // Create user
    const result = await authService.createUser(userData);

    // Verify file write
    const fileUsers = JSON.parse(fs.readFileSync('server/storage/users.json'));
    expect(fileUsers.find(u => u.username === userData.username)).toBeTruthy();

    // Verify postgres write
    const authRepo = new AuthRepository();
    await authRepo.initialize();
    const pgUser = await authRepo.findUserByUsername(userData.username);
    expect(pgUser).toBeTruthy();
    expect(pgUser.username).toBe(userData.username);
    await authRepo.close();
  });

  test('Document creation writes to both file and postgres', async () => {
    // Upload document
    const result = await documentHandler.handleUpload(fileData);

    // Verify file write
    const fileDocs = JSON.parse(fs.readFileSync('server/storage/documents.json'));
    expect(fileDocs.find(d => d.id === result.id)).toBeTruthy();

    // Verify postgres write
    const docRepo = new DocumentsRepository();
    await docRepo.initialize();
    const pgDoc = await docRepo.findDocumentById(result.id);
    expect(pgDoc).toBeTruthy();
    expect(pgDoc.sha256_hash).toBe(result.sha256_hash);
    await docRepo.close();
  });

  test('PostgreSQL failure does not block file write', async () => {
    // Mock postgres failure
    jest.spyOn(AuthRepository.prototype, 'createUser').mockRejectedValue(new Error('PG down'));

    // Should still succeed (file write)
    const result = await authService.createUser(userData);

    // Verify file write succeeded
    const fileUsers = JSON.parse(fs.readFileSync('server/storage/users.json'));
    expect(fileUsers.find(u => u.username === userData.username)).toBeTruthy();
  });

  test('Idempotent user creation does not create duplicates', async () => {
    // Create same user twice
    const result1 = await authService.createUser(userData);
    const result2 = await authService.createUser(userData);

    // Should return same user, not create duplicate
    expect(result1.username).toBe(result2.username);

    // Verify only one record in each
    const fileUsers = JSON.parse(fs.readFileSync('server/storage/users.json'));
    const fileDuplicates = fileUsers.filter(u => u.username === userData.username);
    expect(fileDuplicates.length).toBe(1);

    const authRepo = new AuthRepository();
    await authRepo.initialize();
    const pgUser = await authRepo.findUserByUsername(userData.username);
    await authRepo.close();

    // Should have exactly one user in postgres
    expect(pgUser).toBeTruthy();
  });
});
```

### Integration Tests

**Test File**: `server/dual_write/test_integration.cjs`

```javascript
describe('Phase 2A Integration Tests', () => {
  test('Full auth workflow with dual-write', async () => {
    // Create user → login → create session → logout → revoke session
    const user = await authService.createUser(userData);
    const session = await authService.createSession(user.id);
    await authService.revokeSession(session.id);

    // Verify consistency across file and postgres
    const parity = await parityChecker.compareAuthData();
    expect(parity.mismatches).toHaveLength(0);
  });

  test('Full document workflow with dual-write', async () => {
    // Upload document → process → create extraction → update metadata
    const doc = await documentHandler.handleUpload(fileData);
    await processingService.processDocument(doc.id);
    const extraction = await extractionService.createExtraction(doc.id);

    // Verify consistency
    const parity = await parityChecker.compareDocumentData();
    expect(parity.mismatches).toHaveLength(0);
  });
});
```

## Success Criteria for Phase 2A

### Code-Level Criteria
- [ ] All auth operations use dual-write pattern
- [ ] All document operations use dual-write pattern
- [ ] Idempotency guards prevent duplicate records
- [ ] PostgreSQL failures are logged but non-blocking
- [ ] Every divergence logged to `dual_write_mismatches.jsonl`
- [ ] Repair records created for failed postgres writes

### Operational Criteria
- [ ] `/api/health/dual-write-status` returns healthy status
- [ ] `/api/health/dual-write-parity` shows 0 mismatches
- [ ] No performance degradation (>50ms increase) on auth operations
- [ ] No performance degradation (>100ms increase) on document operations
- [ ] Existing functionality completely preserved

### Testing Criteria
- [ ] All unit tests pass (new + existing)
- [ ] All integration tests pass
- [ ] Manual testing confirms existing workflows unchanged
- [ ] Parity checks show consistent data

## Risk Mitigation

### Risk 1: Performance Degradation
**Mitigation**: PostgreSQL operations are async and non-blocking, minimal performance impact

### Risk 2: Silent Data Divergence
**Mitigation**: Comprehensive parity checks and mismatch logging

### Risk 3: PostgreSQL Contention
**Mitigation**: Connection pooling, timeout limits, retry logic with exponential backoff

### Risk 4: Idempotency Failures
**Mitigation**: Pre-write checks for existing records, use of upsert where possible

## Rollback Strategy

If Phase 2A issues are detected:
1. **Immediate Rollback**: Disable dual-write by commenting out postgres operations
2. **Data Cleanup**: PostgreSQL data can be safely ignored (filesystem is authoritative)
3. **Repair Process**: Use repair queue to reconcile any missed writes
4. **Monitoring**: Health checks will immediately show dual-write issues

## Timeline Estimate

- **Step 1**: Dual-write infrastructure (1 day)
- **Step 2**: Modify auth service (2 days)
- **Step 3**: Modify document operations (3 days)
- **Step 4**: Add idempotency guards (1 day)
- **Step 5**: Add observability endpoints (1 day)
- **Step 6**: Add logging and repair records (1 day)
- **Testing**: Unit + integration tests (2 days)
- **Buffer**: Manual testing and refinement (2 days)

**Total Phase 2A Estimate**: 13 days

## Dependencies

- Phase 1 repository layer (complete ✅)
- Phase 0 database schema (complete ✅)
- Existing auth service (needs modification)
- Existing document handlers (needs modification)

## Success Metrics

### Before Phase 2A
- Auth operations: Filesystem only
- Document operations: Filesystem only
- Observability: Basic logging

### After Phase 2A
- Auth operations: Dual-write (file + postgres)
- Document operations: Dual-write (file + postgres)
- Observability: Health checks, parity monitoring, mismatch logging
- **No change to existing functionality or performance**

## Next Steps (After Phase 2A Approval)

1. **Implement Phase 2A** using this plan
2. **Test thoroughly** in development environment
3. **Deploy to QA** with real PostgreSQL instance
4. **Run parity checks** to validate consistency
5. **Monitor health endpoints** for divergence
6. **Once 2A is stable**, plan Phase 2B for remaining domains

---

**Document Status**: Ready for implementation
**Estimated Implementation Time**: 13 days
**Risk Level**: Medium (mitigated by non-blocking postgres writes)
**Rollback**: Safe (filesystem remains authoritative)