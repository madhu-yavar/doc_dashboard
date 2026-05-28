const fs = require("fs/promises");
const path = require("path");

class GeminiAudioTranscriptionTool {
  constructor(config = {}) {
    this.name = "Gemini Audio Transcription Tool";
    this.version = "1.0.0";
    this.baseUrl = config.baseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models";
    this.model = config.model || process.env.VOICE_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-pro";
    this.timeout = config.timeout || 300000;
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || "";
    this.apiKeyFallback = config.apiKeyFallback || process.env.GEMINI_API_KEY_FALLBACK || "";
    this.apiKeys = [this.apiKey, this.apiKeyFallback].filter(Boolean);
    this.uploadBaseUrl = this.deriveUploadBaseUrl(this.baseUrl);
  }

  deriveUploadBaseUrl(baseUrl) {
    const marker = "/v1beta/models";
    const index = String(baseUrl || "").indexOf(marker);
    if (index !== -1) {
      return String(baseUrl).slice(0, index);
    }
    return "https://generativelanguage.googleapis.com";
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  formatError(error) {
    const base = String(error?.message || error || "Unknown Gemini audio transcription error");
    const causeCode = error?.cause?.code;
    const causeMessage = error?.cause?.message;

    if (causeCode) {
      return `${base} (${causeCode})`;
    }
    if (causeMessage && causeMessage !== base) {
      return `${base} (${causeMessage})`;
    }
    return base;
  }

  isRetryableStatus(status) {
    return [408, 429, 500, 502, 503, 504].includes(Number(status));
  }

  isRetryableError(error) {
    const message = String(error?.message || error || "");
    return (
      error?.name === "AbortError" ||
      message.includes("fetch failed") ||
      message.includes("ECONNRESET") ||
      message.includes("ETIMEDOUT") ||
      message.includes("ENOTFOUND")
    );
  }

  normalizeUsage(usage = {}) {
    const promptTokens = Number(
      usage.promptTokens ??
      usage.promptTokenCount ??
      0
    ) || 0;

    const completionTokens = Number(
      usage.completionTokens ??
      usage.candidatesTokenCount ??
      0
    ) || 0;

    const totalTokens = Number(
      usage.totalTokens ??
      usage.totalTokenCount ??
      (promptTokens + completionTokens)
    ) || 0;

    return {
      ...usage,
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  extractText(payload = {}) {
    const candidate = payload.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts
      .map((part) => String(part?.text || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  extractJson(payload = {}) {
    const parts = payload.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;

    const text = parts
      .map((part) => {
        if (typeof part?.text === "string" && part.text.trim()) {
          return part.text.trim();
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();

    if (!text) return null;

    const parseCandidate = (value) => {
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    };

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      const parsedFenced = parseCandidate(fenced[1].trim());
      if (parsedFenced) return parsedFenced;
    }

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const parsedSlice = parseCandidate(text.slice(firstBrace, lastBrace + 1).trim());
      if (parsedSlice) return parsedSlice;
    }

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async uploadAudioFile(filePath, mimeType, apiKey) {
    const buffer = await fs.readFile(filePath);
    const numBytes = buffer.byteLength;
    const displayName = path.basename(filePath);

    const startResponse = await fetch(`${this.uploadBaseUrl}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(numBytes),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: {
          display_name: displayName,
        },
      }),
    });

    if (!startResponse.ok) {
      const text = await startResponse.text();
      throw new Error(`Gemini file upload start failed (${startResponse.status}): ${text}`);
    }

    const uploadUrl = startResponse.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      throw new Error("Gemini file upload URL missing from response headers.");
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(numBytes),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: buffer,
    });

    if (!uploadResponse.ok) {
      const text = await uploadResponse.text();
      throw new Error(`Gemini file upload finalize failed (${uploadResponse.status}): ${text}`);
    }

    const payload = await uploadResponse.json();
    const file = payload?.file;
    if (!file?.uri) {
      throw new Error("Gemini file upload succeeded but no file URI was returned.");
    }

    return {
      uri: file.uri,
      mimeType: file.mimeType || mimeType,
      name: file.name || null,
      sizeBytes: numBytes,
    };
  }

  buildPrompt() {
    return [
      "Transcribe this clinical dictation audio into structured JSON.",
      "The audio may contain physician dictation for a clinical dashboard workflow.",
      "Return valid JSON only with this exact top-level shape:",
      "{",
      '  "language": string | null,',
      '  "rawText": string,',
      '  "normalizedText": string,',
      '  "speakers": [{ "id": string, "label": string, "role": "doctor" | "patient" | "unknown" }],',
      '  "segments": [{',
      '    "segmentId": string,',
      '    "speakerId": string | null,',
      '    "speakerRole": "doctor" | "patient" | "unknown",',
      '    "speakerLabel": string,',
      '    "startLabel": string,',
      '    "endLabel": string,',
      '    "text": string,',
      '    "normalizedText": string,',
      '    "confidence": number | null,',
      '    "flags": string[]',
      "  }],",
      '  "quality": {',
      '    "overallConfidence": number | null,',
      '    "lowConfidenceSegmentCount": number,',
      '    "missingAudioSuspected": boolean,',
      '    "overlappingSpeechSuspected": boolean,',
      '    "medicationRisk": "low" | "medium" | "high"',
      "  }",
      "}",
      "Requirements:",
      "- Preserve medical meaning faithfully.",
      "- Use concise transcript segments instead of one giant block.",
      "- If timestamps are uncertain, still provide startLabel and endLabel estimates such as 00:00, 00:12.",
      "- If only one dominant speaker is present, use a single doctor speaker.",
      "- Set flags like low_confidence, medication, labs, follow_up, dosage when applicable.",
      "- Do not summarize instead of transcribing.",
      "- If something is unclear, keep the spoken wording and lower confidence.",
    ].join("\n");
  }

  recoverJsonString(text, fieldName) {
    const source = String(text || "");
    const fieldIndex = source.indexOf(`"${fieldName}"`);
    if (fieldIndex === -1) {
      return "";
    }

    const colonIndex = source.indexOf(":", fieldIndex);
    if (colonIndex === -1) {
      return "";
    }

    const startQuoteIndex = source.indexOf("\"", colonIndex);
    if (startQuoteIndex === -1) {
      return "";
    }

    let value = "";
    let escaped = false;

    for (let index = startQuoteIndex + 1; index < source.length; index += 1) {
      const char = source[index];

      if (escaped) {
        value += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        value += char;
        escaped = true;
        continue;
      }

      if (char === "\"") {
        break;
      }

      value += char;
    }

    try {
      return JSON.parse(`"${value}"`);
    } catch {
      return String(value)
        .replace(/\\"/g, "\"")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, "\t")
        .trim();
    }
  }

  recoverTranscriptFromMalformedJson(text, fileLabel = "") {
    const language = this.recoverJsonString(text, "language") || "en";
    const rawText = this.recoverJsonString(text, "rawText");
    const normalizedText = this.recoverJsonString(text, "normalizedText") || rawText;

    if (!rawText && !normalizedText) {
      return null;
    }

    const safeText = rawText || normalizedText || `Transcript unavailable for ${fileLabel}`;

    return {
      language,
      rawText: safeText,
      normalizedText: normalizedText || safeText,
      speakers: [{ id: "spk_1", label: "Speaker 1", role: "unknown" }],
      segments: [
        {
          segmentId: "seg_1",
          speakerId: "spk_1",
          speakerRole: "unknown",
          speakerLabel: "Speaker 1",
          startLabel: "00:00",
          endLabel: "00:30",
          text: safeText,
          normalizedText: normalizedText || safeText,
          confidence: null,
          flags: ["partial_json_recovery"],
        },
      ],
      quality: {
        overallConfidence: null,
        lowConfidenceSegmentCount: 1,
        missingAudioSuspected: false,
        overlappingSpeechSuspected: false,
        medicationRisk: "medium",
      },
    };
  }

  buildFallbackTranscript(payload = {}, fileLabel = "") {
    const text = this.extractText(payload);
    const recovered = this.recoverTranscriptFromMalformedJson(text, fileLabel);
    if (recovered) {
      return recovered;
    }

    const rawText = text || `Transcript unavailable for ${fileLabel}`;
    return {
      language: "en",
      rawText,
      normalizedText: rawText,
      speakers: [{ id: "spk_1", label: "Speaker 1", role: "unknown" }],
      segments: [
        {
          segmentId: "seg_1",
          speakerId: "spk_1",
          speakerRole: "unknown",
          speakerLabel: "Speaker 1",
          startLabel: "00:00",
          endLabel: "00:30",
          text: rawText,
          normalizedText: rawText,
          confidence: null,
          flags: ["fallback_transcript"],
        },
      ],
      quality: {
        overallConfidence: null,
        lowConfidenceSegmentCount: 1,
        missingAudioSuspected: false,
        overlappingSpeechSuspected: false,
        medicationRisk: "medium",
      },
    };
  }

  async execute(filePath, options = {}) {
    // Get available API keys - use provided key, then primary, then fallback
    const availableKeys = this.apiKeys.length > 0 ? this.apiKeys : [this.apiKey].filter(Boolean);
    if (availableKeys.length === 0) {
      return {
        success: false,
        error: "Gemini API key is required.",
      };
    }

    const mimeType = String(options.mimeType || "").trim() || "audio/mpeg";
    const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : 2;
    const prompt = options.prompt || this.buildPrompt();

    // Try each API key with retries before moving to the next key
    for (let keyIndex = 0; keyIndex < availableKeys.length; keyIndex++) {
      const apiKey = availableKeys[keyIndex];
      const isFallback = keyIndex > 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          const uploadedFile = await this.uploadAudioFile(filePath, mimeType, apiKey);

          const response = await fetch(`${this.baseUrl}/${this.model}:generateContent`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      file_data: {
                        mime_type: uploadedFile.mimeType,
                        file_uri: uploadedFile.uri,
                      },
                    },
                    { text: prompt },
                  ],
                },
              ],
              generationConfig: {
                temperature: options.temperature ?? 0.1,
                maxOutputTokens: options.maxTokens ?? 4096,
                responseMimeType: "application/json",
              },
            }),
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const text = await response.text();
            const isRetryable = this.isRetryableStatus(response.status);

            if (!isRetryable || attempt >= maxRetries) {
              if (keyIndex < availableKeys.length - 1) {
                console.warn(`[GeminiAudio] API key ${keyIndex + 1} failed with HTTP ${response.status}. Trying fallback key...`);
                break;
              }
              return {
                success: false,
                error: `Gemini audio transcription failed (${response.status}): ${text}`,
              };
            }

            const delayMs = 1500 * (attempt + 1);
            await this.sleep(delayMs);
            continue;
          }

          const payload = await response.json();
          const parsed = this.extractJson(payload) || this.buildFallbackTranscript(payload, path.basename(filePath));
          const usage = this.normalizeUsage(payload.usageMetadata || {});

          if (isFallback) {
            console.log(`[GeminiAudio] Transcription succeeded with fallback API key`);
          }

          return {
            success: true,
            data: parsed,
            usage,
            model: this.model,
            uploadedFile,
            rawResponse: payload,
          };
        } catch (error) {
          clearTimeout(timeoutId);

          const isRetryable = this.isRetryableError(error) || this.isRetryableStatus(error?.status);
          const formattedError = this.formatError(error);

          if (!isRetryable || attempt >= maxRetries) {
            if (keyIndex < availableKeys.length - 1 && error?.name !== "AbortError") {
              console.warn(`[GeminiAudio] API key ${keyIndex + 1} failed: ${formattedError}. Trying fallback key...`);
              break;
            }
            return {
              success: false,
              error: error?.name === "AbortError"
                ? `Gemini audio transcription timeout after ${this.timeout}ms`
                : formattedError,
            };
          }

          const delayMs = 1500 * (attempt + 1);
          await this.sleep(delayMs);
          continue;
        }
      }
    }

    return {
      success: false,
      error: "Gemini audio transcription failed with all available API keys.",
    };
  }
}

module.exports = GeminiAudioTranscriptionTool;
