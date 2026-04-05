class ProvenanceGateTool {
  constructor(config = {}) {
    this.name = "Provenance Gate";
    this.version = "1.0.0";
    this.config = config;
  }

  isFallbackLike(value) {
    return /(generated|derived from uploaded report|unknown|not documented)$/i.test(String(value || "").trim());
  }

  normalize(item = {}, sourceClass = "internal") {
    const value = String(item.value || item.label || "").trim();
    const sourceExcerpt = String(item.source_excerpt || item.sourceExcerpt || "").trim();
    const sourceSection = String(item.source_section || item.sourceSection || "").trim();
    const sourcePage = typeof item.source_page === "number" ? item.source_page : (typeof item.sourcePage === "number" ? item.sourcePage : null);
    const provenanceType = item.provenance_type || item.provenanceType || "normalized";
    const confidence = typeof item.confidence === "number" ? item.confidence : 0.7;

    return {
      value,
      source_class: sourceClass,
      source_section: sourceSection,
      source_excerpt: sourceExcerpt,
      source_page: sourcePage,
      provenance_type: provenanceType,
      confidence,
      url: item.url || "",
      retrieved_at: item.retrieved_at || item.retrievedAt || "",
      label: item.label || "",
    };
  }

  filter(items = [], options = {}) {
    const allowedTypes = options.allowedTypes || ["quoted", "normalized", "derived"];
    const requireExcerpt = options.requireExcerpt ?? true;

    return (Array.isArray(items) ? items : [])
      .map((item) => this.normalize(item, options.sourceClass || "internal"))
      .filter((item) => item.value)
      .filter((item) => !this.isFallbackLike(item.value))
      .filter((item) => !requireExcerpt || item.source_excerpt || item.url)
      .filter((item) => allowedTypes.includes(item.provenance_type));
  }
}

module.exports = ProvenanceGateTool;
