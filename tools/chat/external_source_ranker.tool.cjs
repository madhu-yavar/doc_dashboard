class ExternalSourceRankerTool {
  constructor(config = {}) {
    this.name = "External Source Ranker";
    this.version = "1.0.0";
    this.config = config;
  }

  score(item, query = "", context = {}) {
    const text = `${item.title || ""} ${item.snippet || ""}`.toLowerCase();
    const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    let score = item.confidence || 0.6;
    const knowledgeType = String(context.knowledgeType || "").toLowerCase();
    const section = String(item.source_section || item.title || "").toLowerCase();

    for (const term of terms) {
      if (text.includes(term)) score += 0.08;
    }

    if (/pubmed|fda|clinicaltrials|icd|nlm/i.test(section)) score += 0.1;
    if (knowledgeType === "coding_reference" && /icd|nlm/.test(section)) score += 0.3;
    if (knowledgeType === "drug_knowledge" && /fda|dailymed/.test(`${section} ${item.url || ""}`.toLowerCase())) score += 0.25;
    if (knowledgeType === "clinical_explanation" && /pubmed/.test(section)) score += 0.22;
    if (knowledgeType === "clinical_explanation" && /fda|dailymed/.test(`${section} ${item.url || ""}`.toLowerCase())) score -= 0.1;
    return score;
  }

  rank(results = [], query = "", limit = 5, context = {}) {
    return (Array.isArray(results) ? results : [])
      .map((item) => ({ ...item, confidence: this.score(item, query, context) }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }
}

module.exports = ExternalSourceRankerTool;
