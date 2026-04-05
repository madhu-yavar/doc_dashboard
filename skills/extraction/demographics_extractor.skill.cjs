/**
 * Demographics Extractor Skill
 */

class DemographicsExtractorSkill {
  constructor(config = {}) {
    this.name = "Demographics Extractor";
    this.version = "1.0.0";
    this.config = config;
  }

  async execute(context) {
    const { pdfText, gemmaClient, promptBuilder } = context;

    const prompt = promptBuilder.build("demographics_extractor", { pdfText });
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