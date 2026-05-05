class ConfidenceScorerTool {
  constructor(config = {}) {
    this.name = "Confidence Scorer";
    this.version = "1.0.0";
    this.config = config;
  }

  score({ internalEvidence = [], externalEvidence = [], queryIntent = "" } = {}) {
    const internalCount = internalEvidence.length;
    const externalCount = externalEvidence.length;
    const avgInternal =
      internalCount > 0 ? internalEvidence.reduce((sum, item) => sum + (item.confidence || 0.7), 0) / internalCount : 0;
    const avgExternal =
      externalCount > 0 ? externalEvidence.reduce((sum, item) => sum + (item.confidence || 0.7), 0) / externalCount : 0;

    let score = 0;
    if (internalCount > 0) score += 55 + avgInternal * 25;
    if (externalCount > 0) score += 25 + avgExternal * 15;
    if (queryIntent === "mixed_context") score -= 5;
    if (queryIntent === "clinical_explanation") score -= 5;
    if (queryIntent === "literature_query" && externalCount === 0) score = 0;

    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      score,
      label: score > 90 ? "high" : score >= 70 ? "medium" : score >= 50 ? "low" : "refuse",
    };
  }
}

module.exports = ConfidenceScorerTool;
