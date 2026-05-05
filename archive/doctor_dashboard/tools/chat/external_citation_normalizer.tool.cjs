class ExternalCitationNormalizerTool {
  constructor(config = {}) {
    this.name = "External Citation Normalizer";
    this.version = "1.0.0";
    this.config = config;
  }

  normalize(item = {}) {
    return {
      value: item.value || item.title || "",
      source_class: "external",
      source_section: item.source_section || item.sourceSection || item.source || "External Medical Source",
      source_excerpt: item.source_excerpt || item.sourceExcerpt || item.snippet || "",
      source_page: null,
      url: item.display_url || item.displayUrl || item.url || "",
      retrieved_at: item.retrieved_at || new Date().toISOString(),
      provenance_type: "quoted",
      confidence: typeof item.confidence === "number" ? item.confidence : 0.7,
      label: item.label || `[External: ${item.source_section || item.source || "Medical Source"}]`,
    };
  }

  normalizeMany(items = []) {
    return (Array.isArray(items) ? items : []).map((item) => this.normalize(item));
  }
}

module.exports = ExternalCitationNormalizerTool;
