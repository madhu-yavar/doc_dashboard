# Pyannote Diarization Integration Guide

## Overview
Your pyannote speaker diarization service is working excellently with your medical consultation audio. Here's how to integrate it into your existing live conversation system.

## Integration Steps

### 1. Add Dependency Import

**File**: `server/live_conversation_websocket.cjs`

Add this line at the top of the file (after line 13):

```javascript
const PyannoteDiarizationService = require("./pyannote_diarization_service.cjs");
```

### 2. Initialize Service in Constructor

**File**: `server/live_conversation_websocket.cjs`

In the `constructor` method (around line 23), add:

```javascript
this.diarizationService = new PyannoteDiarizationService({
  apiUrl: "http://206.1.62.28:8009/diarize",
  apiKey: "test123",
  debug: config.debug || false,
});
```

### 3. Add Diarization to Post-Processing

**File**: `server/live_conversation_websocket.cjs`

Modify the `backfillFinalTranscriptAndDraft` method (around line 462) to include diarization:

```javascript
async backfillFinalTranscriptAndDraft(sessionId, combinedAudioPath) {
  if (!combinedAudioPath) return;

  let session = await this.store.get(sessionId);
  if (!session) return;

  if (this.shouldBackfillTranscript(session)) {
    try {
      const result = await this.sttAgent.execute({
        audioPath: combinedAudioPath,
        options: {
          mode: "fixed_window_no_vad",
          windowSeconds: 15,
          enableSpeakerDiarization: false, // Keep false for STT
          skipValidation: true,
          mimeType: session?.audio?.mimeType,
        },
      });

      const transcriptData = result?.data && (
        String(result.data.normalizedText || result.data.rawText || "").trim()
      )
        ? result.data
        : null;

      if (transcriptData) {
        // ADD THIS: Apply speaker diarization
        let finalTranscript = transcriptData;
        try {
          this.log("Running speaker diarization", { sessionId, audioPath: combinedAudioPath });
          finalTranscript = await this.diarizationService.processWithDiarization(
            combinedAudioPath,
            transcriptData
          );
          this.log("Speaker diarization completed", {
            sessionId,
            numSpeakers: finalTranscript.speakers?.length || 0
          });
        } catch (diarizationError) {
          this.log("Speaker diarization failed, using transcript without speakers", {
            sessionId,
            error: diarizationError.message
          });
          // Continue with original transcript without diarization
        }

        await this.store.replaceTranscript(sessionId, finalTranscript);
        await this.store.logEvent(sessionId, "final_transcript_backfilled", {
          backend: result.backend || result?.data?.metadata?.backend || null,
          segmentCount: finalTranscript.segments?.length || 0,
          speakerCount: finalTranscript.speakers?.length || 0, // ADD THIS
          hasDiarization: finalTranscript.metadata?.diiarization?.serviceName === "pyannote", // ADD THIS
        });
        session = await this.store.get(sessionId);
      }
    } catch (error) {
      this.log("Final transcript backfill error", { sessionId, error: error.message });
    }
  }

  // ... rest of the method remains unchanged
}
```

### 4. Update Package Dependencies

**File**: `package.json`

Add the `form-data` package if not already present:

```bash
npm install form-data
```

Or add to `package.json`:

```json
{
  "dependencies": {
    "form-data": "^4.0.0"
  }
}
```

## Expected Results

### Before Diarization
```json
{
  "segments": [
    {
      "speakerId": "spk_0",
      "speakerLabel": "Unknown",
      "text": "Hello, how can I help you today?"
    }
  ]
}
```

### After Diarization
```json
{
  "segments": [
    {
      "speakerId": "SPEAKER_00",
      "speakerLabel": "Speaker 1",
      "speakerRole": "doctor",
      "text": "Hello, how can I help you today?"
    },
    {
      "speakerId": "SPEAKER_01", 
      "speakerLabel": "Speaker 2",
      "speakerRole": "patient",
      "text": "I've been having chest pain."
    }
  ],
  "speakers": [
    {
      "id": "SPEAKER_00",
      "label": "Speaker 1", 
      "role": "doctor"
    },
    {
      "id": "SPEAKER_01",
      "label": "Speaker 2",
      "role": "patient"
    }
  ]
}
```

## Testing

### Test with Existing Files

The service has been tested with your existing audio files:

1. **ESL-Cardio-sample.wav** - Single speaker detection ✓
2. **MSK0001.mp3** - Doctor-patient conversation separation ✓  
3. **EKA Medical samples** - Multi-speaker detection ✓

### Manual Testing

```bash
# Test with any audio file
curl --location 'http://206.1.62.28:8009/diarize' \
--header 'X-API-Key: test123' \
--form 'file=@"path/to/your/audio.mp3"'
```

## Performance Considerations

- **Processing Time**: ~2-6 seconds per minute of audio
- **Recommended**: Use for post-processing (after session ends)
- **File Size**: No significant file size limitations
- **Concurrent Requests**: GPU service handles multiple requests

## Configuration Options

The service can be configured in `server/live_conversation_websocket.cjs`:

```javascript
this.diarizationService = new PyannoteDiarizationService({
  apiUrl: "http://206.1.62.28:8009/diarize", // Your GPU server endpoint
  apiKey: "test123",                        // API authentication
  timeout: 120000,                          // 2 minute timeout
  debug: true,                              // Enable debug logging
});
```

## Benefits

1. **Speaker Attribution**: Identify doctor vs patient in conversations
2. **Better Transcripts**: Labeled speaker turns improve readability
3. **Clinical Analysis**: Enable speaker-specific medical insights
4. **Quality Metrics**: Track conversation balance and engagement

## Troubleshooting

### Service Unavailable
```javascript
// The integration gracefully falls back to transcript without diarization
catch (diarizationError) {
  this.log("Speaker diarization failed, using transcript without speakers", {
    sessionId,
    error: diarizationError.message
  });
  // Continue with original transcript
}
```

### Timeout Issues
Increase timeout in configuration:
```javascript
timeout: 180000, // 3 minutes for longer recordings
```

### API Authentication
Verify your API key and endpoint:
```bash
curl --location 'http://206.1.62.28:8009/diarize' \
--header 'X-API-Key: test123' \
--form 'file=@"test.wav"'
```

## Next Steps

1. Test the integration with a live conversation session
2. Review speaker attribution accuracy in generated prescriptions
3. Consider real-time diarization for live feedback (advanced)