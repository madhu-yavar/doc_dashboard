/**
 * Handwriting Notes Extractor Skill (Stage 3)
 * Extracts handwritten clinical narrative from prescription pages.
 * Keeps wording close to the source and avoids polished summarization.
 */

class HandwritingNotesExtractorSkill {
  constructor(config = {}) {
    this.name = "Handwriting Notes Extractor";
    this.version = "1.1.0";
    this.config = config;
    this.geminiClient = null;
    this.currentApiKey = null;
  }

  getGeminiClient(apiKey) {
    const effectiveKey = apiKey || this.config.apiKey || "";
    if (!this.geminiClient || this.currentApiKey !== effectiveKey) {
      const GeminiClientTool = require("../../../tools/llm/gemini_client.tool.cjs");
      this.geminiClient = new GeminiClientTool({
        baseUrl: this.config.geminiBaseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models",
        model: this.config.geminiModel || "gemini-2.5-flash",
        timeout: this.config.timeout || 180000,
        apiKey: effectiveKey
      });
      this.currentApiKey = effectiveKey;
    }
    return this.geminiClient;
  }

  parseModelJson(content) {
    const normalized = String(content || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const candidates = [normalized];
    const firstBrace = normalized.indexOf("{");
    const lastBrace = normalized.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(normalized.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (_error) {
        continue;
      }
    }

    throw new Error("Unable to parse model JSON response");
  }

  buildPrompt(pageNum = null, compactMode = false) {
    return `You are an expert at reading handwritten medical prescriptions and handwritten doctor notes.

Your task is to extract ONLY handwritten clinical narrative from the provided prescription page${pageNum ? ` (page ${pageNum})` : ""}.

FOCUS ON:
- brief doctor notes
- findings
- follow-up or review instructions
- advice to the patient
- short clinical observations
- unclear but clinically relevant handwritten note fragments

DO NOT EXTRACT:
- medicines or dosage lines
- vital signs
- patient/doctor/hospital/date/header PHI
- lab orders, imaging orders, or procedure orders
- printed labels or form headings
- standalone continuation markers or setup fragments unless they can be merged into a meaningful note

IMPORTANT BEHAVIOR:
- Stay close to the handwritten wording.
- Do NOT turn fragments into polished clinical summaries.
- Do NOT infer a diagnosis if it is not explicitly written.
- If a line is partly readable, keep the readable wording and mark it uncertain.
- Return short note units, one line/idea per item.
- If two adjacent handwritten lines clearly form one sentence, combine them into one note.
- Drop orphan fragments like "Pl. add:" or "Advice:" if they have no meaningful continuation on this page.
- Return at most ${compactMode ? 2 : 3} notes for this page.
- Keep each "text" and "source_excerpt" under ${compactMode ? 100 : 160} characters.
- Keep "confidence_reason" short, max 12 words.
- If there are no handwritten clinical notes on this page, return an empty array.

Allowed categories:
- "clinical_note"
- "finding"
- "follow_up"
- "advice"
- "unclear_note"

STRICT JSON RULES:
- Return exactly one JSON object.
- Use double quotes for all keys and string values.
- No markdown, no code fences, no prose, no comments, no trailing commas.

Return ONLY valid JSON in this format:
{
  "notes": [
    {
      "text": "literal or near-literal handwritten note",
      "category": "clinical_note|finding|follow_up|advice|unclear_note",
      "confidence": "high|medium|low",
      "is_inferred": false,
      "confidence_reason": "",
      "source_excerpt": "same text or the closest readable source snippet"
    }
  ],
  "has_notes": false,
  "confidence": "high|medium|low"
}

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  shouldRetryCompactMode(error) {
    const message = String(error || "");
    return /MAX_TOKENS|Unable to parse model JSON response/i.test(message);
  }

  async executeAttempt(geminiClient, imagesForExtraction, pageNum, compactMode) {
    const result = await geminiClient.execute(this.buildPrompt(pageNum, compactMode), {
      images: imagesForExtraction,
      temperature: 0.05,
      maxTokens: compactMode ? 700 : 1200,
      thinkingBudget: compactMode ? 256 : (this.config.thinkingBudget ?? 1024),
      responseMimeType: "application/json",
      systemInstruction: "You are a medical document extraction expert specializing in literal handwritten prescription notes."
    });

    if (!result.success) {
      throw new Error(result.error || "Notes extraction failed");
    }

    const data = this.parseModelJson(result.content);
    return {
      data,
      usage: result.usage
    };
  }

  async execute(context) {
    const { images, maskedImage, apiKey, onProgress, pageNum } = context;
    const imagesForExtraction = images || (maskedImage ? [maskedImage] : null);

    if (!imagesForExtraction || imagesForExtraction.length === 0) {
      return {
        success: false,
        step: "handwriting_notes_extractor",
        error: "Images are required for handwriting extraction"
      };
    }

    if (!apiKey) {
      return {
        success: false,
        step: "handwriting_notes_extractor",
        error: "Gemini API key is required for handwriting extraction"
      };
    }

    try {
      const geminiClient = this.getGeminiClient(apiKey);

      if (onProgress) {
        onProgress({
          type: "info",
          step: "handwriting_notes_extractor",
          status: "processing",
          message: `Extracting handwritten notes${pageNum ? ` from page ${pageNum}` : ""}...`
        });
      }

      let data;
      let usage;
      try {
        const attempt = await this.executeAttempt(geminiClient, imagesForExtraction, pageNum, false);
        data = attempt.data;
        usage = attempt.usage;
      } catch (error) {
        if (!this.shouldRetryCompactMode(error.message)) {
          return {
            success: false,
            step: "handwriting_notes_extractor",
            error: error.message
          };
        }

        const compactAttempt = await this.executeAttempt(geminiClient, imagesForExtraction, pageNum, true);
        data = compactAttempt.data;
        usage = compactAttempt.usage;
      }

      const notes = Array.isArray(data.notes)
        ? data.notes
            .map((note) => ({
              text: String(note?.text || "").trim(),
              category: String(note?.category || "clinical_note").trim() || "clinical_note",
              confidence: String(note?.confidence || "medium").trim() || "medium",
              is_inferred: Boolean(note?.is_inferred),
              confidence_reason: String(note?.confidence_reason || "").trim(),
              source_excerpt: String(note?.source_excerpt || note?.text || "").trim(),
              page_number: pageNum || 1
            }))
            .filter((note) => note.text)
        : [];

      if (onProgress) {
        onProgress({
          type: "success",
          step: "handwriting_notes_extractor",
          status: "complete",
          message: notes.length > 0
            ? `${notes.length} handwritten note${notes.length > 1 ? "s" : ""} extracted`
            : "No handwritten notes found"
        });
      }

      return {
        success: true,
        step: "handwriting_notes_extractor",
        data: {
          notes,
          has_notes: Boolean(data.has_notes) || notes.length > 0,
          confidence: data.confidence || "medium"
        },
        usage
      };
    } catch (error) {
      return {
        success: false,
        step: "handwriting_notes_extractor",
        error: error.message
      };
    }
  }
}

module.exports = HandwritingNotesExtractorSkill;
