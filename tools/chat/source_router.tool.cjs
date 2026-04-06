class SourceRouterTool {
  constructor(config = {}) {
    this.name = "Source Router";
    this.version = "1.0.0";
    this.config = config;
  }

  unique(values = []) {
    return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
  }

  route({ plan = {}, classification = {}, query = "" } = {}) {
    const hinted = this.unique(plan.source_preferences);
    if (hinted.length) return hinted;

    const intent = classification?.intent || "";
    const text = String(query || "").toLowerCase();

    if (intent === "diagnosis_code") return ["icd"];
    if (intent === "drug_safety") return ["openfda", "pubmed"];
    if (intent === "literature_query" || intent === "guideline_query") return ["pubmed"];
    if (intent === "clinical_explanation") return ["pubmed", "openfda"];
    if (/trial/.test(text)) return ["clinicaltrials", "pubmed"];

    return ["pubmed", "openfda"];
  }
}

module.exports = SourceRouterTool;
