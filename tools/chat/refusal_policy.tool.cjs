class RefusalPolicyTool {
  constructor(config = {}) {
    this.name = "Refusal Policy";
    this.version = "1.0.0";
    this.config = config;
  }

  evaluate({ classification, confidence, internalEvidence = [], externalEvidence = [] }) {
    if (classification?.outOfScope) {
      return {
        refused: true,
        reason: "I can only assist with medical questions and patient care.",
      };
    }

    if (confidence?.score < 50) {
      return {
        refused: true,
        reason: "I don't have sufficient information to answer this safely from the patient record or approved medical sources.",
      };
    }

    if (!internalEvidence.length && !externalEvidence.length) {
      return {
        refused: true,
        reason: "I could not find safe supporting evidence for this question.",
      };
    }

    return { refused: false, reason: "" };
  }
}

module.exports = RefusalPolicyTool;
