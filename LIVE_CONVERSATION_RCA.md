# Live Conversation Issues - Root Cause Analysis

## Summary
Three issues reported:
1. Timer continues running after ending conversation
2. No transcriptions happening
3. No extractions happening

## Analysis

### Issue 1: Timer Continues Running After Ending Conversation

**Root Cause:** The timer is controlled by the `phase` variable which is derived from multiple state sources that can become out of sync during session end.

**Flow:**
1. Frontend timer runs when `phase === "capturing"` ([LiveConversationWorkspace.tsx:657-666](src/components/voice/LiveConversationWorkspace.tsx#L657-L666))
2. `phase` is determined by `deriveCanonicalEncounterPhase()` which checks:
   - `captureState` (from `useLiveConversationAudio`)
   - `sessionStatus` (from backend)
   - `transportState` (WebSocket connection)

**Problem Location:** [useLiveConversationAPI.ts:659](src/hooks/useLiveConversationAPI.ts#L659)
```typescript
// When sessionStatus === "live" && captureState === "idle" 
// and transport is NOT "closed" or "connecting":
return "capturing";  // Timer keeps running!
```

**Race Condition:**
1. User clicks "End Session"
2. Frontend: `endSession()` → sets `recorderState` to "stopping" → uploads → sets to "idle" → sends "session.end"
3. Backend: processes `handleEnd()` (can take 5-60 seconds for transcription)
4. During this time, frontend has:
   - `recorderState = "idle"`
   - `sessionStatus = "live"` (not yet updated from backend)
   - `transportState = "connected"` (WebSocket still open)
5. This combination causes `phase === "capturing"`, so timer keeps running

**Evidence:**
- Timer useEffect only checks `phase !== "capturing"` ([line 658](src/components/voice/LiveConversationWorkspace.tsx#L658))
- The condition that returns "capturing" includes the case above ([line 659](src/hooks/useLiveConversationAPI.ts#L659))

### Issue 2: No Transcriptions Happening

**Root Cause:** Chunk flushing and transcription depend on session status being "live", but there's a timing issue with when this status is set.

**Backend Flow ([live_conversation_websocket.cjs:2117-2125](server/live_conversation_websocket.cjs#L2117-L2125)):**
```javascript
if (session.status === "live" || session.transport?.connectionState === "connected") {
  console.log(`Session ${sessionId} is live, flushing buffer...`);
  const chunkPath = await this.flushAudioBuffer(sessionId);
  if (chunkPath && this.config.enableLiveTranscription) {
    await this.enqueueTranscription(sessionId, chunkPath);
  }
}
```

**Potential Blockers:**

1. **Environment Variable Check** ([line 69](server/live_conversation_websocket.cjs#L69)):
   ```javascript
   enableLiveTranscription: config.enableLiveTranscription ?? process.env.ENABLE_LIVE_TRANSCRIPTION === "true",
   ```
   If `ENABLE_LIVE_TRANSCRIPTION` is not set to "true", no transcription occurs.

2. **Session Status Not Set to "live":**
   - The backend only sets status to "live" in `handleBegin()` ([line 2195](server/live_conversation_websocket.cjs#L2195))
   - But the chunk flush interval is started in `ensureLiveProcessing()` which is called from `handleBegin()`
   - If `handleBegin()` is not called or fails, no transcription happens

3. **Connection State Check:**
   - The flush checks `session.transport?.connectionState === "connected"`
   - This is only set to "connected" in `handleConnection()` ([line 1014](server/live_conversation_websocket.cjs#L1014))
   - If the WebSocket connects but `handleBegin()` is never called, status stays "draft"

**WebSocket Message Handling Issue ([live_conversation_websocket.cjs:1080-1081](server/live_conversation_websocket.cjs#L1080-L1081)):**
```javascript
case "session.begin":
  await this.handleBegin(sessionId, message);
```
- The backend ONLY starts live processing when it receives "session.begin" message
- If this message is not sent or is lost, the session never transitions to "live" status

### Issue 3: No Extractions Happening

**Root Cause:** Draft extraction is tied to live session activity and requires meaningful transcripts.

**Flow ([live_conversation_websocket.cjs:2428-2448](server/live_conversation_websocket.cjs#L2428-L2448)):**
```javascript
async publishLiveDraftUpdate(sessionId, session = null, ws = null) {
  // ... checks ...
  if (!this.isSessionStreamingActive(currentSession) || !currentWs) return false;
  
  const transcript = String(...).trim();
  if (!transcript) return false;
  
  if (normalizedDraftSource.length < 20) return false;
  // ...
}
```

**Dependencies:**
1. `isSessionStreamingActive()` must return `true` ([line 132](server/live_conversation_websocket.cjs#L132)):
   ```javascript
   return Boolean(session && !session.endedAt && (session.status === "live" || session.transport?.connectionState === "connected"));
   ```

2. Transcript must exist and be > 20 characters ([line 2447](server/live_conversation_websocket.cjs#L2447))

3. Draft extraction timer only runs when `enableLiveDraftExtraction` is enabled ([line 245](server/live_conversation_websocket.cjs#L245))

**Cascading Failure:**
- No transcriptions → No transcript → No drafts
- Session not "live" → `isSessionStreamingActive()` returns false → No drafts

## Required Fixes

### Fix 1: Timer Race Condition
**Location:** [useLiveConversationAPI.ts:603-660](src/hooks/useLiveConversationAPI.ts#L603-L660)

Add a check for the recorder "stopping" state before returning "capturing":
```typescript
// Local recorder states - highest priority
if (captureState === "stopping") {
  return "ending_upload";  // Already exists, good
}

// Add this before the fallback "capturing" return:
if (sessionStatus === "live" && captureState === "idle") {
  // If we were recording but are now idle, we're transitioning
  // Only return "capturing" if transport is actively connected/reconnecting
  if (transportState === "connected" || transportState === "reconnecting") {
    return "transcribing";  // Changed from "capturing"
  }
}
```

### Fix 2: Ensure "session.begin" is Sent
**Location:** Frontend audio hook

Verify that "session.begin" is sent immediately after WebSocket connection is established. Currently the flow may have gaps.

### Fix 3: Add Better Logging
Add logging at key decision points:
1. When `deriveCanonicalEncounterPhase` returns "capturing"
2. When `flushAudioBuffer` skips due to status
3. When `publishLiveDraftUpdate` returns early

### Fix 4: Environment Configuration
Ensure these environment variables are set:
- `ENABLE_LIVE_TRANSCRIPTION=true`
- `ENABLE_LIVE_DRAFT_EXTRACTION=true` (if using draft extraction)

## Verification Steps

1. Check environment variables on backend:
   ```bash
   echo $ENABLE_LIVE_TRANSCRIPTION
   echo $ENABLE_LIVE_DRAFT_EXTRACTION
   ```

2. Monitor WebSocket messages in browser console to verify "session.begin" is sent

3. Add console logging in `deriveCanonicalEncounterPhase` to see phase transitions

4. Check backend logs for "Session X is live, flushing buffer..." message

5. Check if `handleBegin()` is actually being called (add logging)
