const GemmaClientTool = require("../../tools/llm/gemma_client.tool.cjs");

class NoteUpdateSuggesterSkill {
  constructor(config = {}) {
    this.name = "Note Update Suggester";
    this.version = "1.0.0";
    this.gemmaClient = new GemmaClientTool(config.gemma || {});
  }

  async execute({ message, evidence = [], documentId = "", section = "Clinical Note" }) {
    const prompt = `Draft a concise clinician-facing note update suggestion.

Question:
${message}

Record evidence:
${evidence.map((item) => `- ${item.value} | ${item.source_section} | ${item.source_excerpt}`).join("\n")}

Rules:
- 2 to 4 sentences max
- Only use provided evidence
- No invented facts
- Plain clinical style

Return plain text only.`;

    const result = await this.gemmaClient.execute(prompt, { temperature: 0.1, maxTokens: 250 });
    return {
      success: true,
      step: "note_update_suggester",
      data: {
        documentId,
        section,
        suggested_text: result.success ? result.content.trim() : evidence.map((item) => item.value).slice(0, 3).join(". "),
      },
    };
  }
}

module.exports = NoteUpdateSuggesterSkill;
