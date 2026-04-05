/**
 * Document Analyzer Skill
 * Analyzes PDF structure and identifies sections
 */

class DocumentAnalyzerSkill {
  constructor(config = {}) {
    this.name = "Document Analyzer";
    this.version = "1.0.0";
    this.config = config;
  }

  async execute(context) {
    const { pdfText, gemmaClient, promptBuilder } = context;

    const prompt = promptBuilder.build("document_analyzer", { pdfText });
    const result = await gemmaClient.execute(prompt, { temperature: 0.3, maxTokens: 800 });

    if (!result.success) {
      return { success: false, step: "document_analyzer", error: result.error };
    }

    try {
      const data = JSON.parse(result.content);
      return { success: true, step: "document_analyzer", data, usage: result.usage };
    } catch (e) {
      return { success: false, step: "document_analyzer", error: e.message, rawContent: result.content };
    }
  }
}

module.exports = DocumentAnalyzerSkill;