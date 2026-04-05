class ExternalSourceRankerTool {
  constructor(config = {}) {
    this.name = "External Source Ranker";
    this.version = "1.0.0";
    this.config = config;
  }

  score(item, query = "") {
    const text = `${item.title || ""} ${item.snippet || ""}`.toLowerCase();
    const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    let score = item.confidence || 0.6;

    for (const term of terms) {
      if (text.includes(term)) score += 0.08;
    }

    if (/pubmed|fda|clinicaltrials|icd|nlm/i.test(item.source_section || item.title || "")) score += 0.1;
    return score;
  }

  rank(results = [], query = "", limit = 5) {
    return (Array.isArray(results) ? results : [])
      .map((item) => ({ ...item, confidence: this.score(item, query) }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }
}

module.exports = ExternalSourceRankerTool;
