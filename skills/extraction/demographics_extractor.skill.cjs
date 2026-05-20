/**
 * Demographics Extractor Skill
 */

class DemographicsExtractorSkill {
  constructor(config = {}) {
    this.name = "Demographics Extractor";
    this.version = "1.0.0";
    this.config = config;
  }

  buildTranscriptText(transcript) {
    if (!transcript) return "";

    if (typeof transcript === "string") {
      return transcript.trim();
    }

    if (Array.isArray(transcript.segments) && transcript.segments.length > 0) {
      return transcript.segments
        .map((segment) => String(segment?.text || "").trim())
        .filter(Boolean)
        .join("\n");
    }

    return String(transcript.rawText || transcript.normalizedText || "").trim();
  }

  async execute(context) {
    const { pdfText, transcript, gemmaClient, promptBuilder } = context;
    const transcriptText = this.buildTranscriptText(transcript);
    const sourceText = transcriptText || String(pdfText || "").trim();

    if (!sourceText) {
      return { success: false, step: "demographics_extractor", error: "No source text provided" };
    }

    const prompt = transcriptText
      ? promptBuilder.build("voice_demographics_extractor", { transcriptText })
      : promptBuilder.build("demographics_extractor", { pdfText: sourceText });
    const result = await gemmaClient.execute(prompt, { temperature: 0.1, maxTokens: 600 });

    if (!result.success) {
      return { success: false, step: "demographics_extractor", error: result.error };
    }

    try {
      const data = JSON.parse(result.content);
      return { success: true, step: "demographics_extractor", data, usage: result.usage };
    } catch (e) {
      return { success: false, step: "demographics_extractor", error: e.message };
    }
  }
}

module.exports = DemographicsExtractorSkill;
