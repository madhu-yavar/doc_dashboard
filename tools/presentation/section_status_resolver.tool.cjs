class SectionStatusResolverTool {
  constructor(config = {}) {
    this.name = "Section Status Resolver";
    this.version = "1.0.0";
    this.config = config;
  }

  normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  isFallbackLikeValue(value) {
    return /(generated|derived from|validate against|source document|not documented|unknown)$/i.test(
      this.normalizeWhitespace(value)
    );
  }

  normalizeItem(item) {
    if (!item || typeof item !== "object") return null;
    const value = this.normalizeWhitespace(item.value);
    const sourceExcerpt = this.normalizeWhitespace(item.source_excerpt);
    if (!value) return null;

    return {
      value,
      source_section: this.normalizeWhitespace(item.source_section),
      source_excerpt: sourceExcerpt,
      source_page: typeof item.source_page === "number" ? item.source_page : null,
      confidence: typeof item.confidence === "number" ? item.confidence : 0,
      provenance_type: item.provenance_type || "normalized",
    };
  }

  isSafe(item, allowedTypes = ["quoted", "normalized", "derived"]) {
    const normalized = this.normalizeItem(item);
    if (!normalized) return false;

    return Boolean(
      normalized.value &&
        normalized.source_excerpt &&
        allowedTypes.includes(normalized.provenance_type) &&
        !this.isFallbackLikeValue(normalized.value) &&
        !this.isFallbackLikeValue(normalized.source_excerpt)
    );
  }

  build(rawItems = [], allowedTypes = ["quoted", "normalized", "derived"]) {
    const normalized = (Array.isArray(rawItems) ? rawItems : [rawItems])
      .map((item) => this.normalizeItem(item))
      .filter(Boolean);
    const safe = normalized.filter((item) => this.isSafe(item, allowedTypes));

    let status = "insufficient_evidence";
    if (safe.length > 0 && safe.length === normalized.length) status = "source_backed";
    else if (safe.length > 0) status = "mixed";
    else if (normalized.some((item) => item.provenance_type === "derived")) status = "derived_only";

    return {
      status,
      items: safe,
      hasRaw: normalized.length > 0,
    };
  }
}

module.exports = SectionStatusResolverTool;
