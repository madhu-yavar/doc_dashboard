class AbnormalFlagActionSkill {
  constructor(config = {}) {
    this.name = "Abnormal Flag Action";
    this.version = "1.0.0";
    this.config = config;
  }

  execute({ message, evidence = [], documentId = "" }) {
    const target = evidence[0];
    return {
      success: true,
      step: "abnormal_flag_action",
      data: {
        documentId,
        target_section: target?.section || target?.source_section || "clinical_review",
        target_label: target?.value || "Clinical item for review",
        reason: `Flagged from assistant request: ${message}`,
      },
    };
  }
}

module.exports = AbnormalFlagActionSkill;
