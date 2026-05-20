/**
 * Voice Medications Extractor Skill
 * Extracts medications from voice transcript segments
 */

class VoiceMedicationsExtractorSkill {
  constructor(config = {}) {
    this.name = "Voice Medications Extractor";
    this.version = "1.0.0";
    this.config = config;
  }

  parseModelJson(content) {
    const normalized = String(content || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const candidates = [];
    candidates.push(normalized);

    const firstBrace = normalized.indexOf("{");
    const lastBrace = normalized.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(normalized.slice(firstBrace, lastBrace + 1));
    }

    let lastError = null;
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (error) {
        lastError = error;
        const repaired = this.repairJson(candidate);
        try {
          return JSON.parse(repaired);
        } catch (repairError) {
          lastError = repairError;
          continue;
        }
      }
    }

    // Log the actual content for debugging
    console.error("[VoiceMedicationsExtractor] Failed to parse JSON. Content preview:", content.substring(0, 500));

    throw new Error(`Unable to parse model JSON response. Last error: ${lastError?.message || "Unknown error"}`);
  }

  repairJson(content) {
    let repaired = "";
    let inString = false;
    let escaped = false;

    for (const char of String(content || "")) {
      // Replace newlines/tabs in strings with spaces
      if (inString && (char === "\n" || char === "\r" || char === "\t")) {
        repaired += " ";
        escaped = false;
        continue;
      }

      repaired += char;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
      }
    }

    // Remove trailing commas
    repaired = repaired.replace(/,\s*([}\]])/g, "$1");

    // Try to extract JSON from markdown code blocks if present
    if (repaired.includes("```json")) {
      const match = repaired.match(/```json\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        return match[1].trim();
      }
    } else if (repaired.includes("```")) {
      const match = repaired.match(/```\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return repaired;
  }

  normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  buildJsonRetryPrompt(originalPrompt, invalidContent) {
    return `${originalPrompt}

IMPORTANT:
- Your previous response was not valid JSON.
- Return ONLY one valid JSON object.
- Do not wrap the JSON in markdown fences.
- Do not add commentary.

PREVIOUS INVALID RESPONSE:
${String(invalidContent || "").slice(0, 6000)}`;
  }

  async executeGemmaJson(gemmaClient, prompt, options = {}) {
    const firstResult = await gemmaClient.execute(prompt, options);
    if (!firstResult.success) {
      return { success: false, error: firstResult.error };
    }

    try {
      return {
        success: true,
        data: this.parseModelJson(firstResult.content),
        usage: firstResult.usage,
      };
    } catch (firstParseError) {
      console.warn(`[VoiceMedicationsExtractor] Initial JSON parse failed, retrying with stricter prompt: ${firstParseError.message}`);

      const retryResult = await gemmaClient.execute(
        this.buildJsonRetryPrompt(prompt, firstResult.content),
        { ...options, temperature: 0 }
      );

      if (!retryResult.success) {
        return {
          success: false,
          error: `${firstParseError.message}; retry failed: ${retryResult.error}`,
        };
      }

      try {
        return {
          success: true,
          data: this.parseModelJson(retryResult.content),
          usage: retryResult.usage || firstResult.usage,
        };
      } catch (retryParseError) {
        return {
          success: false,
          error: `${retryParseError.message}. Retry content preview: ${String(retryResult.content || "").slice(0, 240)}`,
        };
      }
    }
  }

  /**
   * Build transcript text from segments
   * Groups segments by speaker and includes timestamps
   */
  buildTranscriptText(segments) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return "";
    }

    return segments
      .map((seg) => {
        const speaker = seg.speakerLabel || seg.speakerRole || "Unknown";
        const time = seg.startLabel && seg.endLabel
          ? ` [${seg.startLabel} - ${seg.endLabel}]`
          : "";
        const confidence = seg.confidence !== null && seg.confidence !== undefined
          ? ` (confidence: ${Math.round(seg.confidence * 100)}%)`
          : "";
        return `${speaker}:${time} ${seg.text}${confidence}`;
      })
      .join("\n");
  }

  /**
   * Extract medications from transcript
   */
  async execute(context) {
    const { transcript, gemmaClient } = context;

    if (!transcript || !Array.isArray(transcript.segments)) {
      return { success: false, step: "voice_medications_extractor", error: "Invalid transcript context" };
    }

    const transcriptText = this.buildTranscriptText(transcript.segments);

    // Build prompt for voice medication extraction
    const prompt = `You are a clinical medications extractor specialized in processing physician dictation transcripts.

TRANSCRIPT:
${transcriptText}

INSTRUCTIONS:
1. Extract ALL medications mentioned by the physician
2. For each medication, identify:
   - Generic or brand name
   - Dose (e.g., 5mg, 20mg, 100ml)
   - Frequency (e.g., OD, BD, TDS, QID, "once daily", "twice daily", "SOS", "PRN")
   - Route (e.g., IV, Oral, IM, SC, "Injection", "Tablet", "Syrup", "Inhalation")
   - Indication/reason if stated
   - Duration if mentioned
   - Status: "continue", "start", "stop", "change" if explicitly stated

3. IMPORTANT VOICE-SPECIFIC RULES:
   - Spoken medication names may be phonetic - capture the most likely generic name
   - "Five milligrams" = 5mg, "Twenty milligrams" = 20mg
   - "One tablet" = 1 tablet, "Two tablets" = 2 tablets
   - "In the morning" = OD/morning dose, "Twice a day" = BD
   - "For blood pressure" = indication for hypertension
   - If dose is unclear, mark needs_review: true
   - If medication name is phonetically ambiguous, mark needs_review: true

4. PROVENANCE - For each medication, include:
   - segment_id: the transcript segment ID
   - time_range: start and end timestamps
   - quoted_text: exact spoken text
   - speaker_role: doctor/patient/unknown

5. DO NOT extract:
   - Non-medication items (vitamins, supplements only if clearly prescribed)
   - Casual mentions without prescribing intent
   - Historical medications that were stopped

Return ONLY JSON:
{
  "medications": [
    {
      "name": "generic or brand name",
      "dose": "",
      "frequency": "",
      "route": "",
      "indication": "",
      "duration": "",
      "status": "continue/start/stop/change",
      "needs_review": false,
      "confidence_score": 0.0,
      "provenance": {
        "segment_id": "",
        "time_range": {"start_ms": 0, "end_ms": 0},
        "quoted_text": "",
        "speaker_role": "doctor"
      }
    }
  ],
  "summary": {
    "total_medications": 0,
    "needs_review_count": 0,
    "high_confidence_count": 0
  }
}`;

    const maxOutputTokens = 2000;
    const extractionResult = await this.executeGemmaJson(gemmaClient, prompt, { temperature: 0.1, maxTokens: maxOutputTokens });

    if (!extractionResult.success) {
      return { success: false, step: "voice_medications_extractor", error: extractionResult.error };
    }

    try {
      const data = extractionResult.data;

      // Post-process to attach segment references
      if (Array.isArray(data.medications)) {
        const segmentsById = new Map(
          transcript.segments.map((s) => [s.id, s])
        );

        data.medications = data.medications.map((med) => {
          const prov = med.provenance || {};
          const segment = prov.segment_id ? segmentsById.get(prov.segment_id) : null;

          // Fill in time range from segment if not provided
          if (segment && prov.time_range) {
            if (!prov.time_range.start_ms && segment.startMs) {
              prov.time_range.start_ms = segment.startMs;
            }
            if (!prov.time_range.end_ms && segment.endMs) {
              prov.time_range.end_ms = segment.endMs;
            }
          }

          // Fill quoted text from segment if not provided
          if (segment && !prov.quoted_text) {
            prov.quoted_text = segment.text;
          }

          // Fill speaker role from segment if not provided
          if (segment && !prov.speaker_role) {
            prov.speaker_role = segment.speakerRole || "unknown";
          }

          return { ...med, provenance: prov };
        });
      }

      return { success: true, step: "voice_medications_extractor", data, usage: extractionResult.usage };
    } catch (e) {
      return { success: false, step: "voice_medications_extractor", error: e.message };
    }
  }
}

module.exports = VoiceMedicationsExtractorSkill;
