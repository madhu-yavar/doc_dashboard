/**
 * Voice Clinical Extractor Skill
 * Extracts clinical data (vitals, labs, radiology, procedures, follow-up) from voice transcript segments
 */

class VoiceClinicalExtractorSkill {
  constructor(config = {}) {
    this.name = "Voice Clinical Extractor";
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
    console.error("[VoiceClinicalExtractor] Failed to parse JSON. Content preview:", content.substring(0, 500));

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
      console.warn(`[VoiceClinicalExtractor] Initial JSON parse failed, retrying with stricter prompt: ${firstParseError.message}`);

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
      return { success: false, step: "voice_clinical_extractor", error: "Invalid transcript context" };
    }

    const transcriptText = this.buildTranscriptText(transcript.segments);

    const prompt = `You are a clinical data extractor specialized in processing physician dictation transcripts.

TRANSCRIPT:
${transcriptText}

INSTRUCTIONS:
Extract the following clinical information from the voice transcript:

1. VITALS - If mentioned:
   - Blood pressure (systolic/diastolic)
   - Pulse/heart rate
   - Temperature
   - SpO2
   - Respiratory rate
   - Weight
   - Blood glucose (random/fasting)
   - Pain score

2. LAB RESULTS - If mentioned:
   - Test name
   - Value with units
   - Abnormal flag if stated

3. RADIOLOGY/IMAGING - If mentioned:
   - Imaging type (X-ray, CT, MRI, Ultrasound, Echo)
   - Body part/region
   - Findings if described
   - Status: "ordered", "pending", "completed"

4. PROCEDURES - If mentioned:
   - Procedure name
   - Status: "planned", "ordered", "completed"
   - Urgency if stated

5. FOLLOW-UP - If mentioned:
   - Department/specialty
   - Timing (e.g., "2 weeks", "follow up in 1 month")
   - Reason if stated

6. ALLERGIES - If mentioned:
   - Allergen
   - Reaction type if stated

7. REVIEW OF SYSTEMS (ROS) - If mentioned:
   - Capture clinically relevant positive or explicitly denied symptoms by system
   - Preserve negatives such as "no chest pain" or "no syncope"

8. PHYSICAL EXAM - If mentioned:
   - Capture structured exam findings by system
   - Preserve both normal and abnormal findings

VOICE-SPECIFIC RULES:
- Spoken numbers: "One twenty over eighty" = 120/80 BP
- "Normal" vitals: don't invent specific values
- "Chest X-ray" = radiology, type: X-ray, body_part: Chest
- "CT brain" = radiology, type: CT, body_part: Brain
- Echo/Echocardiogram = radiology, type: Echocardiogram
- "Send for" or "Order" = status: ordered
- "Review in" or "Follow up" = follow-up item

PROVENANCE - For each item, include:
- segment_id: the transcript segment ID
- time_range: start and end timestamps
- quoted_text: exact spoken text
- speaker_role: doctor/patient/unknown

Return ONLY JSON:
{
  "vitals": {
    "bp_systolic": null,
    "bp_diastolic": null,
    "pulse": null,
    "temperature": null,
    "spo2": null,
    "resp_rate": null,
    "weight": {"value": null, "unit": ""},
    "blood_glucose": null,
    "pain_score": null,
    "provenance": {"segment_id": "", "quoted_text": "", "time_range": {"start_ms": 0, "end_ms": 0}}
  },
  "lab_results": [
    {
      "test_name": "",
      "value": "",
      "flag": "",
      "provenance": {"segment_id": "", "quoted_text": "", "time_range": {"start_ms": 0, "end_ms": 0}}
    }
  ],
  "radiology": [
    {
      "type": "",
      "body_part": "",
      "findings": "",
      "status": "ordered/pending/completed",
      "provenance": {"segment_id": "", "quoted_text": "", "time_range": {"start_ms": 0, "end_ms": 0}}
    }
  ],
  "procedures": [
    {
      "name": "",
      "status": "planned/ordered/completed",
      "urgency": "",
      "provenance": {"segment_id": "", "quoted_text": "", "time_range": {"start_ms": 0, "end_ms": 0}}
    }
  ],
  "follow_up": [
    {
      "specialty": "",
      "timing": "",
      "reason": "",
      "provenance": {"segment_id": "", "quoted_text": "", "time_range": {"start_ms": 0, "end_ms": 0}}
    }
  ],
  "allergies": [
    {
      "allergen": "",
      "reaction": "",
      "provenance": {"segment_id": "", "quoted_text": "", "time_range": {"start_ms": 0, "end_ms": 0}}
    }
  ],
  "review_of_systems": [
    {
      "system": "",
      "finding": "",
      "status": "present/denied/normal",
      "provenance": {"segment_id": "", "quoted_text": "", "time_range": {"start_ms": 0, "end_ms": 0}}
    }
  ],
  "physical_exam": [
    {
      "system": "",
      "finding": "",
      "status": "normal/abnormal",
      "provenance": {"segment_id": "", "quoted_text": "", "time_range": {"start_ms": 0, "end_ms": 0}}
    }
  ],
  "summary": {
    "total_items_extracted": 0,
    "needs_review_count": 0
  }
}`;

    const extractionResult = await this.executeGemmaJson(gemmaClient, prompt, { temperature: 0.1, maxTokens: 2000 });

    if (!extractionResult.success) {
      return { success: false, step: "voice_clinical_extractor", error: extractionResult.error };
    }

    try {
      const data = extractionResult.data;

      // Post-process to attach segment references and time ranges
      const attachProvenance = (items, segmentsById) => {
        if (!Array.isArray(items)) return [];
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

      const segmentsById = new Map(transcript.segments.map((s) => [s.id, s]));

      if (data.lab_results) {
        data.lab_results = attachProvenance(data.lab_results, segmentsById);
      }
      if (data.radiology) {
        data.radiology = attachProvenance(data.radiology, segmentsById);
      }
      if (data.procedures) {
        data.procedures = attachProvenance(data.procedures, segmentsById);
      }
      if (data.follow_up) {
        data.follow_up = attachProvenance(data.follow_up, segmentsById);
      }
      if (data.allergies) {
        data.allergies = attachProvenance(data.allergies, segmentsById);
      }
      if (data.review_of_systems) {
        data.review_of_systems = attachProvenance(data.review_of_systems, segmentsById);
      }
      if (data.physical_exam) {
        data.physical_exam = attachProvenance(data.physical_exam, segmentsById);
      }
      if (data.vitals?.provenance) {
        const prov = data.vitals.provenance;
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
      }

      return { success: true, step: "voice_clinical_extractor", data, usage: extractionResult.usage };
    } catch (e) {
      return { success: false, step: "voice_clinical_extractor", error: e.message };
    }
  }
}

module.exports = VoiceClinicalExtractorSkill;
