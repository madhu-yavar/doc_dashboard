const NoteUpdateSuggesterSkill = require("../skills/chat/note_update_suggester.skill.cjs");
const AbnormalFlagActionSkill = require("../skills/chat/abnormal_flag_action.skill.cjs");

class ActionRouterAgent {
  constructor(config = {}) {
    this.name = "Action Router Agent";
    this.version = "1.0.0";
    this.noteSuggester = new NoteUpdateSuggesterSkill(config);
    this.abnormalFlagger = new AbnormalFlagActionSkill(config);
  }

  async execute({ classification, message, evidence = [], documentId = "" }) {
    if (!classification?.isActionRequest) {
      return { success: true, step: "action_router", data: { proposals: [] } };
    }

    const proposals = [];
    const lower = String(message || "").toLowerCase();

    if (/suggest|update|document|note/.test(lower)) {
      const noteResult = await this.noteSuggester.execute({ message, evidence, documentId });
      proposals.push({
        id: crypto.randomUUID(),
        type: "suggest_note_update",
        title: "Suggest note update",
        payload: noteResult.data,
        rationale: "Requested note/documentation suggestion based on current evidence.",
        citations: evidence.slice(0, 5),
        requires_confirmation: true,
      });
    }

    if (/flag|abnormal|review/.test(lower)) {
      const flagResult = await this.abnormalFlagger.execute({ message, evidence, documentId });
      proposals.push({
        id: crypto.randomUUID(),
        type: "flag_abnormal_value",
        title: "Flag abnormal value",
        payload: flagResult.data,
        rationale: "Requested abnormal value review based on the current clinical question.",
        citations: evidence.slice(0, 5),
        requires_confirmation: true,
      });
    }

    if (/export/.test(lower)) {
      proposals.push({
        id: crypto.randomUUID(),
        type: "export_chat_summary",
        title: "Export chat summary",
        payload: { documentId },
        rationale: "Requested export of the assistant discussion into chart-note workflow.",
        citations: [],
        requires_confirmation: true,
      });
    }

    return {
      success: true,
      step: "action_router",
      data: { proposals },
    };
  }
}

module.exports = ActionRouterAgent;
