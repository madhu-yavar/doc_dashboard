# Live Conversation System Recovery Plan

**Date:** 2026-06-16
**Status:** 🔴 **CRITICAL** - System 100% non-functional
**Objective:** Restore live conversation functionality and eliminate technical debt

---

## Phase 1: Critical Stabilization (Priority: 🔴 CRITICAL)

**Goal:** Get system working in 1-2 hours
**Risk:** High - System completely down

### Step 1.1: Fix the Crash Bug (15 minutes)

**File:** `server/live_conversation_websocket.cjs`
**Line:** 53 (constructor)

```diff
+ this.sessionChunkCount = new Map();  // ADD THIS LINE
```

**Why:** This is the immediate crash causing 100% failure
**Testing:** Start server, verify no TypeError on line 1168

---

### Step 1.2: Fix Schema Status Mismatch (20 minutes)

**Problem:** Code uses `'live'` status but schema only has `'active', 'ended', 'abandoned'`

**Option A (Quick):** Update code to use `'active'`
```diff
// All occurrences of status: 'live' → status: 'active'
```

**Option B (Proper):** Update schema
```sql
ALTER TYPE session_status_enum ADD VALUE 'live' BEFORE 'active';
ALTER TYPE session_status_enum ADD VALUE 'review_required' BEFORE 'ended';
ALTER TYPE session_status_enum ADD VALUE 'finalized' BEFORE 'ended';
```

**Decision:** Use Option A for speed, add Option B to Phase 2

**Files to update:**
- `server/live_conversation_store.cjs` - Lines 7-15 UI status definitions
- `server/live_conversation_websocket.cjs` - Line 186 (session begin)
- Any other `'live'` references

**Testing:** Create session, verify status persists correctly

---

### Step 1.3: Add Missing Schema Enum Values (10 minutes)

**File:** `server/db/schema.cjs`

```diff
CREATE TYPE segment_status_enum AS ENUM (
-  'active',
-  'edited',
-  'deleted'
+  'interim',
+  'active',
+  'edited', 
+  'deleted',
+  'final'
);
```

**Why:** Code uses `'interim'` and `'final'` statuses that don't exist in schema

**Testing:** Verify segment status writes don't fail

---

### Step 1.4: Fix CORS Configuration (5 minutes)

**File:** `server/index.cjs` ~ Line 179

```javascript
origin: function origin(corsOrigin, callback) {
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:8081',
    'http://localhost:8001',  // Add for testing
    'http://localhost:3000',
  ];
  // ... rest of logic
}
```

**Testing:** Verify no CORS errors in logs

---

### Step 1.5: E2E Smoke Test (15 minutes)

**Test:**
```bash
node test_e2e_live_conversation.cjs
```

**Expected:** At least 3/5 tests pass
- ✅ WebSocket Connection
- ✅ Session Flow
- ⚠️ Database State (may still have issues)
- ❌ Transcription Quality (no audio file)
- ⚠️ Server Logs (may have warnings)

**Success Criteria:** System can establish WebSocket, send audio, end session

---

## Phase 2: Code Consolidation (Priority: 🟡 HIGH)

**Goal:** Eliminate redundancy and confusion in 3-4 hours
**Risk:** Medium - Well-understood changes

### Step 2.1: Create Shared Utilities Module (30 minutes)

**Create:** `server/utils/text_utils.cjs`

```javascript
/**
 * Normalize transcript text by removing artifacts
 * Consolidated from 4 duplicate implementations
 */
function normalizeTranscriptText(value = "") {
  return String(value || "")
    .replace(/<\|[^>]+\|>/g, " ")
    .replace(/<\/?s>/gi, " ")
    .replace(/\[(?:music|silence|blank_audio|inaudible|noise)\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if transcript has meaningful content
 */
function isMeaningfulTranscriptText(text = "") {
  const cleaned = normalizeTranscriptText(text);
  if (!cleaned) return false;

  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.length >= 3 && cleaned.length >= 15;
}

module.exports = {
  normalizeTranscriptText,
  isMeaningfulTranscriptText
};
```

**Remove from:**
- `server/live_conversation_websocket.cjs` lines 88-94
- `server/live_conversation_store.cjs` lines 114-119
- `server/live_conversation_routes.cjs` lines 42-47
- `agents/live_conversation_stt_agent.cjs` lines 154-160

**Add imports:**
```javascript
const { normalizeTranscriptText, isMeaningfulTranscriptText } = require('../utils/text_utils.cjs');
```

---

### Step 2.2: Consolidate Chunk Tracking (45 minutes)

**Create:** `server/utils/chunk_tracker.cjs`

```javascript
/**
 * Unified chunk tracking for live sessions
 * Replaces 3 overlapping tracking mechanisms
 */
class ChunkTracker {
  constructor(sessionId, options = {}) {
    this.sessionId = sessionId;
    this.maxInMemoryChunks = options.maxInMemoryChunks || 10;
    this.storageDir = options.storageDir;

    this.inMemoryChunks = [];
    this.files = [];
    this.totalBytes = 0;
    this.count = 0;
  }

  addChunk(buffer) {
    const chunk = { buffer, timestamp: Date.now() };
    this.inMemoryChunks.push(chunk);
    this.totalBytes += buffer.length;
    this.count++;

    // Auto-flush if too many chunks in memory
    if (this.inMemoryChunks.length >= this.maxInMemoryChunks) {
      return this.flush();
    }
    return null;
  }

  async flush(tempDir) {
    if (this.inMemoryChunks.length === 0) return null;

    const combined = Buffer.concat(this.inMemoryChunks.map(c => c.buffer));
    const filename = `${this.sessionId}-${this.count}-${Date.now()}.webm`;
    const filepath = path.join(tempDir, filename);

    await fs.writeFile(filepath, combined);
    this.files.push(filepath);

    this.inMemoryChunks = [];
    return filepath;
  }

  async createSnapshot(outputPath) {
    // Combine all chunk files into single audio file
    // Handle WebM header properly
  }

  clear() {
    this.inMemoryChunks = [];
  }

  async cleanup() {
    // Delete all chunk files
  }
}

module.exports = { ChunkTracker };
```

**Refactor in websocket.cjs:**
```diff
- this.chunkBuffer = new Map();
- this.sessionChunkFiles = new Map();
- this.sessionChunkCount = new Map();
+ this.chunkTrackers = new Map();
+ const { ChunkTracker } = require('../utils/chunk_tracker.cjs');

  getChunkTracker(sessionId) {
    if (!this.chunkTrackers.has(sessionId)) {
      this.chunkTrackers.set(sessionId, new ChunkTracker(sessionId, {
        maxInMemoryChunks: this.config.liveTranscriptWindowChunks || 6,
        storageDir: this.storageDir
      }));
    }
    return this.chunkTrackers.get(sessionId);
  }
```

---

### Step 2.3: Consolidate Status Mapping (30 minutes)

**Create:** `server/utils/session_status_mapper.cjs`

```javascript
/**
 * Single source of truth for session status mapping
 * Between UI (7 states) and DB (3 states)
 */

// UI Statuses (what frontend/user sees)
const UI_STATUSES = {
  DRAFT: 'draft',
  LIVE: 'live',
  PAUSED: 'paused',
  REVIEW_REQUIRED: 'review_required',
  FINALIZING: 'finalizing',
  FINALIZED: 'finalized',
  FAILED: 'failed'
};

// DB Statuses (what Postgres stores)
const DB_STATUSES = {
  ACTIVE: 'active',
  ENDED: 'ended', 
  ABANDONED: 'abandoned'
};

/**
 * Convert UI status to DB status
 */
function uiToDb(uiStatus, context = {}) {
  const mapping = {
    [UI_STATUSES.DRAFT]: DB_STATUSES.ACTIVE,
    [UI_STATUSES.LIVE]: DB_STATUSES.ACTIVE,
    [UI_STATUSES.PAUSED]: DB_STATUSES.ACTIVE,
    [UI_STATUSES.REVIEW_REQUIRED]: DB_STATUSES.ENDED,
    [UI_STATUSES.FINALIZING]: DB_STATUSES.ENDED,
    [UI_STATUSES.FINALIZED]: DB_STATUSES.ENDED,
    [UI_STATUSES.FAILED]: DB_STATUSES.ABANDONED
  };

  return mapping[uiStatus] || DB_STATUSES.ACTIVE;
}

/**
 * Convert DB status to UI status with context
 */
function dbToUi(dbStatus, context = {}) {
  // Complex logic from store.cjs lines 742-934 goes here
  // But simplified and single source of truth
  const { hasTranscript, hasReviewItems, documentId, endedAt } = context;

  if (dbStatus === DB_STATUSES.ABANDONED) return UI_STATUSES.FAILED;
  if (dbStatus === DB_STATUSES.ACTIVE && !endedAt) return UI_STATUSES.LIVE;
  if (dbStatus === DB_STATUSES.ENDED && documentId) return UI_STATUSES.FINALIZED;
  if (dbStatus === DB_STATUSES.ENDED && hasReviewItems) return UI_STATUSES.REVIEW_REQUIRED;

  return UI_STATUSES.REVIEW_REQUIRED; // Default
}

module.exports = {
  UI_STATUSES,
  DB_STATUSES,
  uiToDb,
  dbToUi
};
```

**Remove duplicates from:**
- `store.cjs` lines 49-90
- `store.cjs` lines 742-934 (readSessions reconciliation logic)

---

### Step 2.4: Consolidate Recovery Logic (15 minutes)

**Move to:** `server/utils/session_utils.cjs`

```javascript
/**
 * Check if session can be recovered
 * Single implementation
 */
function isRecoverableLiveSession(session, staleThresholdMs = 15000) {
  if (!session || session.endedAt) return false;

  const referenceTime = session.startedAt || session.updatedAt;
  if (!referenceTime) return true;

  const startedAtMs = new Date(referenceTime).getTime();
  if (!Number.isFinite(startedAtMs)) return true;

  const ageMs = Date.now() - startedAtMs;
  return ageMs > staleThresholdMs;
}

function isEmptySessionCapture(session) {
  const chunkCount = session.audio?.chunkCount || 0;
  return chunkCount === 0;
}

module.exports = {
  isRecoverableLiveSession,
  isEmptySessionCapture
};
```

**Remove from:**
- `websocket.cjs` lines 109-118
- `routes.cjs` lines 96-102

---

## Phase 3: Schema Alignment (Priority: 🟢 MEDIUM)

**Goal:** Fix database schema to match code reality in 2-3 hours
**Risk:** Medium - Requires migration

### Step 3.1: Create Migration System (45 minutes)

**Create:** `server/db/migrations/`

**Directory Structure:**
```
server/db/migrations/
  ├── 001_add_session_status_values.sql
  ├── 002_add_segment_status_values.sql
  ├── 003_add_events_column.sql
  ├── 004_create_migration_tracking.sql
  └── runner.cjs
```

**Create migration runner:**
```javascript
// server/db/migrations/runner.cjs
const fs = require('fs');
const path = require('path');

async function runMigrations(pool) {
  const migrationsDir = path.join(__dirname);
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && f !== 'runner.cjs')
    .sort();

  for (const file of files) {
    const migrationName = path.basename(file, '.sql');
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    console.log(`Running migration: ${migrationName}`);
    await pool.query(sql);
    console.log(`✓ ${migrationName} completed`);
  }
}

module.exports = { runMigrations };
```

---

### Step 3.2: Schema Migration Files (30 minutes)

**001_add_session_status_values.sql**
```sql
-- Add missing UI statuses to support current code
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'live') THEN
    ALTER TYPE session_status_enum ADD VALUE 'live' BEFORE 'active';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'review_required') THEN
    ALTER TYPE session_status_enum ADD VALUE 'review_required' BEFORE 'ended';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'finalized') THEN
    ALTER TYPE session_status_enum ADD VALUE 'finalized' BEFORE 'ended';
  END IF;
END $$;
```

**002_add_segment_status_values.sql**
```sql
-- Add missing segment statuses
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'interim') THEN
    ALTER TYPE segment_status_enum ADD VALUE 'interim' BEFORE 'active';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'final') THEN
    ALTER TYPE segment_status_enum ADD VALUE 'final' AFTER 'edited';
  END IF;
END $$;
```

**003_add_events_column.sql**
```sql
-- Add events tracking if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'live_conversation_sessions' AND column_name = 'events_jsonb'
  ) THEN
    ALTER TABLE live_conversation_sessions
    ADD COLUMN events_jsonb jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;
```

**004_create_migration_tracking.sql**
```sql
-- Track which migrations have run
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT NOW()
);
```

---

### Step 3.3: Update Schema Definition (20 minutes)

**File:** `server/db/schema.cjs`

```diff
CREATE TYPE session_status_enum AS ENUM (
+  'live',
  'active',
+  'review_required',
+  'finalized',
  'ended',
  'abandoned'
);

CREATE TYPE segment_status_enum AS ENUM (
+  'interim',
  'active',
  'edited',
  'deleted',
+  'final'
);
```

---

### Step 3.4: Run Migrations (10 minutes)

**Add to server startup:**
```javascript
// server/index.cjs
const { runMigrations } = require('./db/migrations/runner.cjs');

async function startServer() {
  // Run migrations on startup
  await runMigrations(pool);
  console.log('✓ Database migrations completed');

  // ... rest of startup
}
```

---

## Phase 4: WebM Chunk Handling Redesign (Priority: 🟡 HIGH)

**Goal:** Fix the fundamental WebM chunk issue once and for all in 2-3 hours
**Risk:** High - Core architectural change

### Problem Analysis

**Current broken approach:**
- Browser sends WebM chunks (part of stream, need headers)
- We try to write individual chunks as valid files (they're not!)
- We try to combine them (complex, error-prone)

### Solution: Browser-Side Recording + Server-Side Processing

**Step 4.1: Change Audio Transmission Strategy (1 hour)**

**Option A: Full Audio Upload (RECOMMENDED)**
```javascript
// Frontend: Record complete audio, upload at end
class LiveConversationRecorder {
  async startRecording() {
    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });
    this.chunks = [];
    // ... collect chunks
  }

  async stopRecording() {
    this.mediaRecorder.stop();
    const blob = new Blob(this.chunks, { type: 'audio/webm' });
    return blob; // Complete, valid WebM file
  }

  async uploadAudio(blob) {
    const formData = new FormData();
    formData.append('audio', blob);
    await fetch('/api/voice/live/sessions/:id/audio', {
      method: 'POST',
      body: formData
    });
  }
}
```

**Option B: Use Browser Speech API (ALTERNATIVE)**
```javascript
// Real-time transcription in browser
const recognition = new webkitSpeechRecognition();
recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  websocket.send({ type: 'transcript', text: transcript });
};
```

**Step 4.2: Simplify Server Chunk Handling (30 minutes)**

```diff
// websocket.cjs
- async handleAudioChunk(sessionId, buffer) {
-   // Complex chunk tracking logic
- }

+ async handleAudioUpload(sessionId, audioFile) {
+   // Just save the file, it's already valid WebM
+   const path = await this.saveAudioFile(sessionId, audioFile);
+   return path;
+ }

+ async transcribeSession(sessionId) {
+   const session = await this.store.get(sessionId);
+   const audioPath = session.audio.combinedPath;
+
+   const result = await this.sttAgent.execute({
+     audioPath,
+     options: { /* ... */ }
+   });
+
+   // Process result...
+ }
```

**Step 4.3: Update Frontend Integration (30 minutes)**

**Files to modify:**
- `src/components/voice/LiveConversationWorkspace.tsx`
- `src/hooks/useLiveConversationAudio.ts`

**Changes:**
- Remove incremental chunk sending
- Add full audio upload on session end
- Add browser-based real-time feedback (optional)

---

## Phase 5: Testing & Validation (Priority: 🔴 CRITICAL)

**Goal:** Ensure everything works in 1-2 hours

### Step 5.1: Unit Tests (30 minutes)

**Create:** `src/test/live-conversation-chunk-tracker.test.ts`

```typescript
describe('ChunkTracker', () => {
  it('should track chunks correctly', () => {
    const tracker = new ChunkTracker('test-session');
    tracker.addChunk(Buffer.from('audio-data'));
    expect(tracker.count).toBe(1);
  });

  it('should flush when memory limit reached', async () => {
    const tracker = new ChunkTracker('test', { maxInMemoryChunks: 2 });
    await tracker.addChunk(Buffer.from('chunk1'));
    const flushed = await tracker.addChunk(Buffer.from('chunk2'));
    expect(flushed).not.toBeNull();
  });
});
```

### Step 5.2: Integration Tests (30 minutes)

**Create:** `src/test/live-conversation-integration.test.ts`

```typescript
describe('Live Conversation Integration', () => {
  it('should complete full session flow', async () => {
    const ws = new WebSocket('ws://localhost:8001/api/voice/live/sessions/test/stream');

    await waitForOpen(ws);

    ws.send(JSON.stringify({ type: 'session.begin' }));
    await expectState(ws, 'live');

    ws.send(JSON.stringify({ type: 'audio.chunk', data: 'base64...' }));
    await sleep(5000);

    ws.send(JSON.stringify({ type: 'session.end' }));
    await expectState(ws, 'review_required');

    ws.close();
  });
});
```

### Step 5.3: E2E Test Suite (30 minutes)

**Enhanced:** `test_e2e_live_conversation.cjs`

**Add:**
- Full session with real audio
- Transcription validation
- Extraction validation
- Database state verification

**Success Criteria:**
- 5/5 tests pass
- Transcription quality > 90% word match
- Extraction produces valid medical data

---

## Implementation Timeline

| Phase | Tasks | Duration | Dependencies | Priority |
|-------|-------|----------|--------------|----------|
| **Phase 1** | Critical Stabilization | 1.5 hours | None | 🔴 CRITICAL |
| **Phase 2** | Code Consolidation | 3 hours | Phase 1 | 🟡 HIGH |
| **Phase 3** | Schema Alignment | 3 hours | Phase 1 | 🟢 MEDIUM |
| **Phase 4** | WebM Redesign | 3 hours | Phase 2 | 🟡 HIGH |
| **Phase 5** | Testing | 2 hours | All phases | 🔴 CRITICAL |

**Total:** ~12.5 hours

**Recommended Execution:**
1. **Day 1:** Phase 1 + Phase 5.1 (get it working, basic tests)
2. **Day 2:** Phase 2 + Phase 5.2 (consolidate, integration tests)
3. **Day 3:** Phase 3 + Phase 4 + Phase 5.3 (schema, redesign, E2E)

---

## Success Criteria

### Minimum Viable (Day 1)
- ✅ System starts without crashing
- ✅ WebSocket connection established
- ✅ Session can begin, receive audio, end
- ✅ Basic transcription works

### Full Recovery (Day 2-3)
- ✅ No duplicate code
- ✅ Single source of truth for status/chunks
- ✅ Schema matches code
- ✅ E2E tests pass 5/5
- ✅ WebM handling works reliably

### Production Ready
- ✅ All tests pass
- ✅ No console errors
- ✅ Performance acceptable
- ✅ Documentation updated

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Regression in existing features | Medium | High | Comprehensive tests |
| Migration fails | Low | High | Backup DB, test on staging |
| WebM redesign breaks things | High | High | Thorough testing, rollback plan |
| Time overruns | Medium | Medium | Prioritize critical path |

---

## Rollback Plan

If any phase fails:
1. **Revert to last working commit**
2. **Apply only Phase 1 fixes** (get it working)
3. **Defer remaining phases** to separate sprint

**Known good commits:**
- Before WebM fix attempts (pre-June 16)
- After PostgreSQL migration (June 9)

---

## Next Steps

**Immediate (Today):**
1. ✅ Apply Phase 1 fixes (1.5 hours)
2. ✅ Run basic smoke test
3. ✅ Verify system working

**Tomorrow:**
1. ✅ Execute Phase 2 (consolidation)
2. ✅ Add integration tests
3. ✅ Verify no regressions

**Day 3:**
1. ✅ Execute Phase 3 & 4
2. ✅ Full E2E test suite
3. ✅ Documentation update

---

**Ready to proceed?** Which phase should we start with?
