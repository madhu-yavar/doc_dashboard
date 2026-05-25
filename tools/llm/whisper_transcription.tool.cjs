const fs = require("fs/promises");
const path = require("path");
const { createReadStream, readFileSync } = require("fs");
const crypto = require("crypto");

/**
 * WhisperTranscriptionTool
 * Transcribes audio files using a self-hosted Whisper HTTP endpoint.
 *
 * API Contract (based on provided reference implementation):
 * POST {WHISPER_STT_URL}
 * Content-Type: multipart/form-data
 * Form fields:
 *   - file: WAV audio bytes
 *   - language: "auto" or language code (e.g., "en")
 *   - temperature: "0"
 *
 * Response (JSON):
 *   { "text": "transcribed text..." }
 */
class WhisperTranscriptionTool {
  constructor(config = {}) {
    this.name = "Whisper Transcription Tool";
    this.version = "1.0.0";
    this.url = config.url || process.env.WHISPER_STT_URL || "http://202.88.209.11/whisper/transcribe";
    this.language = config.language || process.env.WHISPER_LANGUAGE || "auto";
    this.temperature = config.temperature || process.env.WHISPER_TEMPERATURE || "0";
    this.timeout = config.timeout || 60000; // 60 seconds default
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create multipart/form-data body manually
   */
  createMultipartFormData(filePath, mimeType, language, temperature) {
    const fileBuffer = readFileSync(filePath);
    const fileName = path.basename(filePath);
    const boundary = `----FormBoundary${crypto.randomBytes(16).toString("hex")}`;

    let body = "";

    // Add file field
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`;
    body += `Content-Type: ${mimeType}\r\n\r\n`;

    // Convert body to buffer
    const bodyBuffer = Buffer.from(body, "utf8");

    // Final boundary
    const finalBoundary = `\r\n--${boundary}--\r\n`;

    // Language field
    const languagePart = `\r\n--${boundary}\r\n`;
    const languageDisposition = `Content-Disposition: form-data; name="language"\r\n\r\n`;
    const languageValue = `${language}\r\n`;

    // Temperature field
    const temperaturePart = `--${boundary}\r\n`;
    const temperatureDisposition = `Content-Disposition: form-data; name="temperature"\r\n\r\n`;
    const temperatureValue = `${temperature}\r\n`;

    // Combine all parts
    const fullBuffer = Buffer.concat([
      bodyBuffer,
      fileBuffer,
      Buffer.from(finalBoundary, "utf8"),
    ]);

    // Actually, let's do it differently - put all string fields first, then file
    let fullBody = "";

    // Language field
    fullBody += `--${boundary}\r\n`;
    fullBody += `Content-Disposition: form-data; name="language"\r\n\r\n`;
    fullBody += `${language}\r\n`;

    // Temperature field
    fullBody += `--${boundary}\r\n`;
    fullBody += `Content-Disposition: form-data; name="temperature"\r\n\r\n`;
    fullBody += `${temperature}\r\n`;

    // File field
    fullBody += `--${boundary}\r\n`;
    fullBody += `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`;
    fullBody += `Content-Type: ${mimeType}\r\n\r\n`;

    const prefixBuffer = Buffer.from(fullBody, "utf8");
    const suffixBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

    return {
      body: Buffer.concat([prefixBuffer, fileBuffer, suffixBuffer]),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  /**
   * Normalize transcript output to match Gemini format for compatibility
   */
  buildTranscriptResponse(rawText, language = "en", audioDuration = null) {
    const normalizedText = (rawText || "").trim();
    const segments = [];

    // Create a single segment from the full text
    if (normalizedText) {
      const segment = {
        segmentId: "seg_1",
        speakerId: "spk_1",
        speakerRole: "unknown",
        speakerLabel: "Speaker 1",
        startLabel: "00:00",
        endLabel: audioDuration ? this.formatTime(audioDuration) : "00:30",
        text: normalizedText,
        normalizedText: normalizedText,
        confidence: null, // Whisper doesn't provide per-segment confidence
        flags: [],
      };
      segments.push(segment);
    }

    return {
      language,
      rawText: normalizedText,
      normalizedText: normalizedText,
      speakers: [{ id: "spk_1", label: "Speaker 1", role: "unknown" }],
      segments,
      quality: {
        overallConfidence: null,
        lowConfidenceSegmentCount: 0,
        missingAudioSuspected: false,
        overlappingSpeechSuspected: false,
        medicationRisk: "medium",
      },
    };
  }

  /**
   * Format seconds to MM:SS or HH:MM:SS
   */
  formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  /**
   * Detect language from text (simple heuristic)
   */
  detectLanguage(text) {
    if (!text) return "en";

    // Simple detection based on character ranges
    const indicPattern = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF\u0E00-\u0E7F\u0E80-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u10A0-\u10FF\u1100-\u11FF\u1200-\u137F\u1380-\u139F\u13A0-\u13FF\u1400-\u167F\u1680-\u169F\u16A0-\u16FF\u1700-\u177F\u1780-\u17FF\u1800-\u18AF\u1900-\u194F\u1950-\u197F\u1980-\u19DF\u19E0-\u19FF\u1A00-\u1A1F\u1A20-\u1AAF\u1AB0-\u1AFF\u1B00-\u1B7F\u1B80-\u1BBF\u1BC0-\u1BFF\u1C00-\u1C4F\u1C50-\u1C7F\u1C80-\u1C8F\u1C90-\u1CBF\u1CC0-\u1CCF\u1CD0-\u1CFF\u1D00-\u1D7F\u1D80-\u1DBF\u1DC0-\u1DFF\u1E00-\u1EFF\u1F00-\u1FFF\u2000-\u206F\u2070-\u209F\u20A0-\u20CF\u20D0-\u20FF\u2100-\u214F\u2150-\u218F\u2C00-\u2C5F\u2C60-\u2C7F\u2C80-\u2CFF\u2D00-\u2D2F\u2D30-\u2D7F\u2D80-\u2DDF\u2DE0-\u2DFF\u2E00-\u2E7F]/;

    if (indicPattern.test(text)) {
      return "hi"; // Default to Hindi for Indic scripts (can be refined)
    }

    return "en";
  }

  /**
   * Main execution method - transcribe audio file
   */
  async execute(filePath, options = {}) {
    const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : 2;
    const language = options.language || this.language;
    const temperature = options.temperature ?? this.temperature;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const mimeType = options.mimeType || "audio/wav";
        const { body, contentType } = this.createMultipartFormData(
          filePath,
          mimeType,
          language,
          temperature
        );

        // Make request
        const response = await fetch(this.url, {
          method: "POST",
          headers: {
            "Content-Type": contentType,
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const text = await response.text();
          const isRetryable = [408, 429, 500, 502, 503, 504].includes(response.status);

          if (!isRetryable || attempt >= maxRetries) {
            return {
              success: false,
              error: `Whisper transcription failed (${response.status}): ${text}`,
            };
          }

          const delayMs = 1000 * (attempt + 1);
          await this.sleep(delayMs);
          continue;
        }

        const data = await response.json();
        const rawText = data.text || "";

        if (!rawText && attempt < maxRetries) {
          // Empty response - retry
          const delayMs = 1000 * (attempt + 1);
          await this.sleep(delayMs);
          continue;
        }

        // Detect language from text if auto was used
        const detectedLanguage = language === "auto" ? this.detectLanguage(rawText) : language;

        // Build standardized response
        const transcript = this.buildTranscriptResponse(rawText, detectedLanguage);

        return {
          success: true,
          data: transcript,
          usage: null, // Whisper endpoint doesn't return token usage
          model: "whisper-self-hosted",
          rawResponse: data,
        };

      } catch (error) {
        clearTimeout(timeoutId);

        const isRetryable =
          error.name === "AbortError" ||
          [408, 429, 500, 502, 503, 504].includes(error?.status) ||
          /(fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND)/i.test(error?.message);

        if (!isRetryable || attempt >= maxRetries) {
          return {
            success: false,
            error: error.name === "AbortError"
              ? `Whisper transcription timeout after ${this.timeout}ms`
              : `Whisper transcription failed: ${error.message}`,
          };
        }

        const delayMs = 1000 * (attempt + 1);
        await this.sleep(delayMs);
      }
    }

    return {
      success: false,
      error: "Whisper transcription failed after all retries.",
    };
  }
}

module.exports = WhisperTranscriptionTool;
