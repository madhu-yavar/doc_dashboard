class ChatExportBuilderSkill {
  constructor(config = {}) {
    this.name = "Chat Export Builder";
    this.version = "1.0.0";
    this.config = config;
  }

  execute({ session = {}, document = {} }) {
    const assistantMessages = (session.messages || []).filter((item) => item.role === "assistant");
    const confirmedActions = session.confirmedActions || [];
    const lines = [];

    lines.push(`AI Assistant Summary for ${document.name || document.id || "record"}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");

    if (assistantMessages.length) {
      lines.push("Clinical Q&A");
      lines.push(...assistantMessages.slice(-5).map((message, index) => `${index + 1}. ${message.answer || message.content || ""}`));
      lines.push("");
    }

    if (confirmedActions.length) {
      lines.push("Confirmed Actions");
      lines.push(...confirmedActions.map((action, index) => `${index + 1}. ${action.title}: ${action.rationale || ""}`));
      lines.push("");
    }

    return {
      success: true,
      step: "chat_export_builder",
      data: {
        chart_note_appendix: lines.join("\n"),
      },
    };
  }
}

module.exports = ChatExportBuilderSkill;
