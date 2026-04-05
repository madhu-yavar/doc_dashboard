const ConfidenceScorerTool = require("../tools/chat/confidence_scorer.tool.cjs");
const RefusalPolicyTool = require("../tools/chat/refusal_policy.tool.cjs");

class SafetyGuardAgent {
  constructor(config = {}) {
    this.name = "Safety Guard Agent";
    this.version = "1.0.0";
    this.confidenceScorer = new ConfidenceScorerTool(config);
    this.refusalPolicy = new RefusalPolicyTool(config);
  }

  async execute({ classification, internalEvidence = [], externalEvidence = [] }) {
    const confidence = this.confidenceScorer.score({
      internalEvidence,
      externalEvidence,
      queryIntent: classification?.intent,
    });
    const refusal = this.refusalPolicy.evaluate({
      classification,
      confidence,
      internalEvidence,
      externalEvidence,
    });

    return {
      success: true,
      step: "safety_guard",
      data: {
        confidence,
        refusal,
      },
    };
  }
}

module.exports = SafetyGuardAgent;
