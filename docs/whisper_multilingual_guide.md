# Whisper Multilingual Language Support Guide

## Current Configuration

Your Whisper STT is currently configured with:
- **Language**: `auto` (auto-detection)
- **Endpoint**: `http://202.88.209.11/whisper/transcribe`
- **Temperature**: `0`

## Issues with Multilingual Support

The problem you're experiencing with Tamil, Hindi, and other local languages could be due to:

1. **Wrong Whisper Model**: Using English-only models instead of multilingual models
2. **Language Parameter**: Not properly specifying language codes
3. **Model Size**: Smaller models have reduced multilingual accuracy
4. **Audio Quality**: Low-quality audio affects language detection

## Solutions

### 1. Check Your Whisper Model

Make sure your self-hosted Whisper is using a **multilingual model**, not an English-only one:

**✅ Use these models:**
- `whisper-tiny` (multilingual)
- `whisper-base` (multilingual) 
- `whisper-small` (multilingual)
- `whisper-medium` (multilingual)
- `whisper-large-v2` (multilingual)
- `whisper-large-v3` (best multilingual support)

**❌ Avoid these models:**
- `whisper-tiny.en` (English only)
- `whisper-base.en` (English only)
- `whisper-small.en` (English only)
- `whisper-medium.en` (English only)

### 2. Language Codes

Use proper ISO 639-1 language codes:

```bash
# Indian Languages
ta  # Tamil
hi  # Hindi
te  # Telugu
mr  # Marathi
bn  # Bengali
kn  # Kannada
ml  # Malayalam
pa  # Punjabi
gu  # Gujarati
or  # Oriya
as  # Assamese

# Other Common Languages
en  # English
es  # Spanish
fr  # French
de  # German
zh  # Chinese
ja  # Japanese
ko  # Korean
ar  # Arabic
```

### 3. Test Your Current Setup

Test with specific languages:

```bash
# Test Tamil
curl -X POST "http://202.88.209.11/whisper/transcribe" \
  -F "language=ta" \
  -F "file=@/path/to/tamil-audio.mp3"

# Test Hindi  
curl -X POST "http://202.88.209.11/whisper/transcribe" \
  -F "language=hi" \
  -F "file=@/path/to/hindi-audio.mp3"
```

### 4. Configuration Updates

Update your Whisper configuration if needed:

**Option A: Environment Variables**
```bash
export WHISPER_LANGUAGE="auto"  # For auto-detection
# or specific language
export WHISPER_LANGUAGE="ta"     # For Tamil
```

**Option B: Code Configuration**
Update `skills/stt/whisper_stt_skill.cjs`:
```javascript
this.language = config.language || "auto";  // auto-detection
// or force specific language
this.language = config.language || "ta";  // Tamil
```

### 5. Backend Model Check

Check what model your Whisper backend is actually using. You might need to:

1. **Update the Whisper model on your server**
2. **Check if it's configured for multilingual support**
3. **Verify the model isn't hard-coded to English**

### 6. Use Larger Models

For better multilingual accuracy, use larger models:
- `whisper-large-v3` has the best multilingual support
- `whisper-medium` is a good balance of speed/accuracy
- `whisper-small` may struggle with some languages

## Quick Test

Test your current setup:

```bash
# Create a simple Tamil audio test
echo "வணகதம்" | espeak -v ta -w test.wav

# Test with Tamil
curl -X POST "http://202.88.209.11/whisper/transcribe" \
  -F "language=ta" \
  -F "file=@test.wav"
```

## Recommended Setup

For your medical consultation use case, I recommend:

1. **Use `whisper-medium` or `whisper-large-v3`** for best multilingual support
2. **Set `WHISPER_LANGUAGE="auto"`** to detect multiple languages in one conversation
3. **Add fallback to language-specific models** if auto-detection fails
4. **Test with your specific audio samples** to verify accuracy

Let me know what model your backend is currently using and I can help you configure it properly!