/**
 * Voice Diagnosis Extractor Skill
 * Extracts diagnosis from voice transcript segments
 */

class VoiceDiagnosisExtractorSkill {
  constructor(config = {}) {
    this.name = "Voice Diagnosis Extractor";
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
    console.error("[VoiceDiagnosisExtractor] Failed to parse JSON. Content preview:", content.substring(0, 500));

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
      console.warn(`[VoiceDiagnosisExtractor] Initial JSON parse failed, retrying with stricter prompt: ${firstParseError.message}`);

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

  async execute(context) {
    const { transcript, gemmaClient } = context;

    if (!transcript || !Array.isArray(transcript.segments)) {
      return { success: false, step: "voice_diagnosis_extractor", error: "Invalid transcript context" };
    }

    const transcriptText = this.buildTranscriptText(transcript.segments);

    const prompt = `You are a clinical diagnosis extractor specialized in processing physician dictation transcripts.

TRANSCRIPT:
${transcriptText}

INSTRUCTIONS:
1. Extract diagnoses mentioned by the physician
2. Classify as:
   - principal: Primary diagnosis/main reason for care
   - secondary: Other active diagnoses or comorbidities
   - rule_out: Diagnoses being considered but not confirmed
   - historical: Past diagnoses no longer active

3. For each diagnosis, capture:
   - diagnosis name (use standard clinical terminology)
   - icd_code: if mentioned or inferable
   - status: "active", "controlled", "resolved", "chronic"
   - laterality if relevant (left/right/bilateral)
   - severity if mentioned (mild/moderate/severe)
   - needs_review: true if diagnosis is uncertain or ambiguous

4. PROVENANCE - For each diagnosis, include:
   - segment_id: the transcript segment ID
   - time_range: start and end timestamps
   - quoted_text: exact spoken text
   - speaker_role: doctor/patient/unknown

5. Extract symptom statements that are clinically relevant to the encounter:
   - Include both present symptoms and explicitly denied symptoms
   - Preserve clinically meaningful negatives such as "no chest pain" or "no dyspnea"
   - Normalize shorthand like "SOB" to "shortness of breath"

6. VOICE-SPECIFIC RULES:
   - Spoken diagnoses may be abbreviated - expand to full terms (e.g., "CHF" → "Congestive Heart Failure")
   - "Probable" or "Possible" diagnoses should go in rule_out
   - "History of" indicates historical diagnosis
   - If the diagnosis is spoken with uncertainty ("might be", "could be"), mark needs_review: true

Return ONLY JSON:
{
  "diagnosis": {
    "principal": {
      "name": "",
      "icd_code": "",
      "status": "active",
      "needs_review": false,
      "confidence_score": 0.0,
      "provenance": {
        "segment_id": "",
        "time_range": {"start_ms": 0, "end_ms": 0},
        "quoted_text": "",
        "speaker_role": "doctor"
      }
    },
    "secondary": [
      {
        "name": "",
        "icd_code": "",
        "status": "active/controlled/chronic",
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
    "rule_out": [
      {
        "name": "",
        "reason": "",
        "provenance": {
          "segment_id": "",
          "quoted_text": "",
          "speaker_role": "doctor"
        }
      }
    ]
  },
  "symptoms": [
    {
      "name": "",
      "status": "present/denied/uncertain",
      "severity": "",
      "duration": "",
      "provenance": {
        "segment_id": "",
        "time_range": {"start_ms": 0, "end_ms": 0},
        "quoted_text": "",
        "speaker_role": "doctor"
      }
    }
  },
  "summary": {
    "total_diagnoses": 0,
    "needs_review_count": 0,
    "symptom_count": 0
  }
}`;

    const extractionResult = await this.executeGemmaJson(gemmaClient, prompt, { temperature: 0.1, maxTokens: 1500 });

    if (!extractionResult.success) {
      return { success: false, step: "voice_diagnosis_extractor", error: extractionResult.error };
    }

    try {
      const data = extractionResult.data;

      // Post-process to attach segment references
      const attachProvenance = (items) => {
        if (!Array.isArray(items)) return [];
        const segmentsById = new Map(transcript.segments.map((s) => [s.id, s]));

        return items.map((item) => {
          const prov = item.provenance || {};
          const segment = prov.segment_id ? segmentsById.get(prov.segment_id) : null;

          if (segment && prov.time_range) {
            if (!prov.time_range.start_ms && segment.startMs) {
              prov.time_range.start_ms = segment.startMs;
            }
            if (!prov.time_range.end_ms && segment.endMs) {
              prov.time_range.end_ms = segment.endMs;
            }
          }

          if (segment && !prov.quoted_text) {
            prov.quoted_text = segment.text;
          }

          if (segment && !prov.speaker_role) {
            prov.speaker_role = segment.speakerRole || "unknown";
          }

          return { ...item, provenance: prov };
        });
      };

      if (data.diagnosis) {
        if (data.diagnosis.principal) {
          data.diagnosis.principal = attachProvenance([data.diagnosis.principal])[0] || data.diagnosis.principal;
        }
        if (data.diagnosis.secondary) {
          data.diagnosis.secondary = attachProvenance(data.diagnosis.secondary);
        }
        if (data.diagnosis.rule_out) {
          data.diagnosis.rule_out = attachProvenance(data.diagnosis.rule_out);
        }
      }
      if (data.symptoms) {
        data.symptoms = attachProvenance(data.symptoms);
      }

      return { success: true, step: "voice_diagnosis_extractor", data, usage: extractionResult.usage };
    } catch (e) {
      return { success: false, step: "voice_diagnosis_extractor", error: e.message };
    }
  }
}

module.exports = VoiceDiagnosisExtractorSkill;
