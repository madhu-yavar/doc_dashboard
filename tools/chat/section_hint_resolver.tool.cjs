class SectionHintResolverTool {
  constructor(config = {}) {
    this.name = "Section Hint Resolver";
    this.version = "1.0.0";
    this.config = config;
  }

  resolve(classification, sectionContext = "") {
    const hints = new Set(Array.isArray(classification?.sectionHints) ? classification.sectionHints : []);
    if (sectionContext) hints.add(String(sectionContext).toLowerCase());

    if (classification?.intent === "drug_safety") hints.add("medications");
    if (classification?.intent === "diagnosis_code") hints.add("diagnosis");
    if (classification?.intent === "patient_trend") hints.add("vitals");
    if (classification?.intent === "guideline_query") hints.add("diagnosis");

    return Array.from(hints);
  }
}

module.exports = SectionHintResolverTool;
