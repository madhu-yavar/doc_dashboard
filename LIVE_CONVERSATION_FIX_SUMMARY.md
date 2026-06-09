# Live Conversation Status Mapping Fix

## Problem
During the PostgreSQL migration, live conversation sessions disappeared from the UI because of a **status contract mismatch** between the database model and the React frontend.

### Root Cause
- **Database Model** (PostgreSQL): Uses `session_status_enum` with only `active`, `ended`, `abandoned`
- **UI Model** (React): Expects `draft`, `live`, `paused`, `review_required`, `finalizing`, `finalized`, `failed`
- **Missing Translation Layer**: No mapping between DB and UI statuses, causing sessions to become invisible

### Impact
- Past conversations disappeared from the UI (even though data existed in database)
- "New Session" button disappeared (only showed for certain UI statuses)
- "Start" button disappeared (only showed for certain UI statuses)
- Write failures when storing UI statuses not recognized by DB enum

## Solution
Implemented a **bidirectional status mapping layer** in `server/live_conversation_store.cjs`:

### DB → UI Status Mapping
```javascript
// PostgreSQL 'active' maps to various UI states based on context:
active + default context → draft
active + recording/has transcript → live
active + paused → paused
active + has review items → review_required
active + finalizing → finalizing

// PostgreSQL 'ended' maps to completed state:
ended → finalized

// PostgreSQL 'abandoned' maps to failed state:
abandoned → failed
```

### UI → DB Status Mapping
```javascript
// All active workflow states map to 'active':
draft → active
live → active
paused → active
review_required → active
finalizing → active

// Completed and failed states:
finalized → ended
failed → abandoned
```

## Implementation Details

### Files Modified
1. **`server/live_conversation_store.cjs`**:
   - Added status mapping functions (`mapDbStatusToUiStatus`, `mapUiStatusToDbStatus`)
   - Updated `readSessions()` to apply DB→UI mapping
   - Updated `writeSessions()` to apply UI→DB mapping
   - Updated `toPublicSession()` to apply DB→UI mapping

### Files Created
1. **`repair_live_sessions.cjs`**: Repairs existing sessions to work with new mapping
2. **`simple_test_status_mapping.cjs`**: Tests status mapping functions

## Testing & Verification

### Test Results
✅ **All 18 tests passed**:
- 8 DB → UI mapping tests passed
- 7 UI → DB mapping tests passed
- 3 real database session tests passed

### Database Verification
Successfully repaired 3 existing sessions:
- `live-1780050028586-71263adf` (Patient: Madhu)
- `live-1780045031764-0a74befe` (Patient: Ashiq)
- `live-1780041426955-ae64df87` (Patient: N/A)

All sessions now properly map from DB status `ended` to UI status `finalized`.

### Expected UI Behavior After Fix
✅ **Past conversations should now appear** in the "Completed" section
✅ **"New Session" button** should appear when selecting finalized/failed sessions
✅ **Status badges** should display correct UI statuses
✅ **No more write failures** when updating session statuses

## Deployment Instructions

### 1. Deploy the Code Changes
The fix has been applied to `server/live_conversation_store.cjs`. Deploy this file to your server.

### 2. Run the Repair Script (One-time)
```bash
node repair_live_sessions.cjs
```
This ensures existing sessions have proper metadata for status mapping.

### 3. Verify the Fix
```bash
node simple_test_status_mapping.cjs
```
All tests should pass (18/18).

### 4. Check the UI
Navigate to the live conversation page and verify:
- Past conversations appear in "Completed" section
- Status badges show correct UI statuses
- "New Session" button appears when appropriate
- Session workflow works end-to-end

## Technical Details

### Status Mapping Logic
The mapping is **context-aware** for the `active` DB status:
- If the session has transcripts or is recording → `live`
- If the session is paused → `paused`
- If the session has pending review items → `review_required`
- If the session is finalizing → `finalizing`
- Otherwise → `draft` (newly created)

This ensures the UI accurately reflects the session's current state while maintaining a simple 3-state database model.

### Database Compatibility
- **No schema changes required** - uses existing `session_status_enum`
- **No migration needed** - works with existing data
- **Backward compatible** - doesn't break existing workflows

### Performance Impact
- **Minimal overhead** - status mapping is simple string lookups
- **No additional queries** - uses context already available in session data
- **Caching friendly** - mapping functions are pure and deterministic

## Monitoring & Maintenance

### Logs to Watch
The fix adds enhanced logging:
```
Session created in Postgres: { id, uiStatus, dbStatus }
Session updated in Postgres: { id, uiStatus, dbStatus }
```

### Potential Issues
1. **Sessions not appearing**: Check that sessions have proper `transport_state_jsonb` and `draft_extraction_jsonb`
2. **Incorrect status mapping**: Verify context signals (hasTranscript, hasReviewItems, etc.)
3. **Write failures**: Ensure UI→DB mapping is applied before database writes

### Future Enhancements
1. Add status transition validation (prevent invalid state transitions)
2. Add status change audit logging
3. Consider adding UI-specific status column if workflow complexity increases

## Summary
This fix resolves the migration compatibility issue by implementing a proper translation layer between the database model and UI model. The solution is:
- ✅ **Non-breaking** - no schema changes required
- ✅ **Complete** - handles all DB and UI statuses
- ✅ **Tested** - all mapping functions verified
- ✅ **Data-safe** - existing data repaired and preserved
- ✅ **Performant** - minimal computational overhead

The 3 "lost" conversations should now be visible in the UI under the "Completed" section with proper `finalized` status badges.