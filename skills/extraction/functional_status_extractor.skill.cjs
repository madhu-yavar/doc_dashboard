/**
 * Functional Status Extractor Skill
 */

class FunctionalStatusExtractorSkill {
  constructor(config = {}) {
    this.name = "Functional Status Extractor";
    this.version = "1.0.0";
    this.config = config;
  }

  async execute(context) {
    const { pdfText, gemmaClient, promptBuilder } = context;

    const prompt = promptBuilder.build("functional_status_extractor", { pdfText });
    const result = await gemmaClient.execute(prompt, { temperature: 0.1, maxTokens: 600 });

    if (!result.success) {
      return { success: false, step: "functional_status_extractor", error: result.error };
    }

    try {
      const data = JSON.parse(result.content);
      return { success: true, step: "functional_status_extractor", data, usage: result.usage };
    } catch (e) {
      return { success: false, step: "functional_status_extractor", error: e.message };
    }
  }
}

module.exports = FunctionalStatusExtractorSkill;