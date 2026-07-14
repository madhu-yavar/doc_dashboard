# Live Conversation RCA - Root Cause Analysis

**Date:** 2026-06-16
**Session ID:** live-1781604146750-8d76c818
**Issue:** Live transcription produces gibberish, requires multiple end button clicks, incomplete transcription, no extraction

## Issues Observed

1. **Gibberish Transcription:** Live transcription produced "pain. [intellig onusea knee pain.ne." vs the correct 729-word transcription
2. **End Button Issues:** Had to click end button 3 times
3. **Incomplete Transcription:** Session timed out without completing transcription
4. **No Extraction:** Final extraction didn't trigger or produced poor results

## Root Causes Identified

### 1. CRITICAL: Exponential Chunk Growth Bug (FIXED)

**Problem:** The WebM chunk fix was causing exponential file growth
- Chunk 1: current chunks (small)
- Chunk 2: Chunk 1 data + current chunks
- Chunk 3: Chunk 1 + Chunk 2 + current chunks (1.7GB!)
- Chunk 4+: Even larger

**Evidence:**
```
-rw-r--r--@  1 yavar  staff   2294577 Jun 16 15:35 live-1781604146750-8d76c818.webm
-rw-r--r--@  1 yavar  staff  1746177071 Jun 16 15:41 live-1781604146750-8d76c818-1781604214351.webm  # 1.7GB!
-rw-r--r--@  1 yavar  staff  1746177792 Jun 16 15:41 live-1781604146750-8d76c818-1781604217427.webm  # 1.7GB!
```

**Root Cause:** In `flushAudioBuffer()`, the code was reading all previous chunk files and combining them with current chunks, then writing the combined data. This caused each new chunk to contain ALL previous audio.

**Fix:** Changed to write only current chunks without combining with previous chunks. The combination now happens only in `createStreamingAudioSnapshot()` when needed for transcription.

**Status:** ✅ FIXED - Deployed in working tree

### 2. WebM Chunk Header Issue (ORIGINAL BUG - STILL NEEDS VERIFICATION)

**Problem:** Individual WebM chunks without headers are invalid for transcription

**Evidence:** Post-facto transcription of the complete audio file produces perfect results (729 clear words), but live chunks produced gibberish.

**Analysis:** The original bug was that `flushAudioBuffer()` was writing only current chunks without the WebM EBML header. The fix attempted to solve this by combining previous chunks, but introduced the exponential growth bug.

**Current Status:** The fix in the working tree should now correctly:
1. Write incremental chunks without exponential growth
2. Combine all chunks in `createStreamingAudioSnapshot()` for transcription

**Needs:** Testing after server restart to verify both issues are resolved.

### 3. Session Status Not Updating (INVESTIGATING)

**Problem:** Session status remains "active" after ending

**Evidence:**
```sql
SELECT status, ended_at FROM live_conversation_sessions WHERE id = 'live-1781604146750-8d76c818';
-- status: active
-- ended_at: 2026-06-16 15:34:58.872+05:30 (exists!)
-- workflow_status: "review_required"
```

**Analysis:** The session has `ended_at` set but status is still "active". The `setEndedState()` method exists and should set status to "review_required".

**Possible Causes:**
1. Mutation queue not processing
2. Database update failing silently
3. Race condition between status update and session end
4. Multiple end calls overwriting each other

**Needs:** Further investigation of mutation queue and database update logic.

### 4. End Button Multiple Clicks (INVESTIGATING)

**Problem:** Had to click end button 3 times

**Analysis:** Could be related to:
1. WebSocket connection issues
2. Session state not updating properly
3. Frontend waiting for response that never comes
4. Exponential chunk growth causing server slowdown

**Needs:** Frontend logs and WebSocket message trace to diagnose.

### 5. Extraction Not Triggering (INVESTIGATING)

**Problem:** No extraction or poor extraction results

**Evidence:** The session has some extraction data but it's poor quality due to poor transcription.

**Analysis:** The `backfillFinalTranscriptAndDraft()` function does call `generateDraftExtraction()`, so extraction should be triggered. However, if the transcription is gibberish, the extraction will also be poor.

**Root Cause:** This is likely a symptom of the transcription issues, not a separate bug.

## Next Steps

1. ✅ **DONE:** Fix exponential chunk growth bug
2. 🔄 **IN PROGRESS:** Restart server with fix
3. ⏳ **TODO:** Test live transcription with same recording
4. ⏳ **TODO:** Investigate session status update issue
5. ⏳ **TODO:** Check frontend logs for end button issues
6. ⏳ **TODO:** Verify extraction triggers properly after transcription fix

## Files Modified

- `/server/live_conversation_websocket.cjs` - Fixed `flushAudioBuffer()` to prevent exponential growth

## Testing Plan

1. Test with same audio recording that produced gibberish before
2. Verify live transcription matches post-facto transcription quality
3. Verify single click on end button works properly
4. Verify session status updates to "review_required"
5. Verify extraction triggers and produces good results

## Notes

- The exponential chunk growth was likely causing the server to slow down, which explains the end button issues
- Poor transcription leads to poor extraction - fix the root cause (transcription) first
- The WebM format requires proper headers for valid files - chunk combination must happen at snapshot time, not at flush time
