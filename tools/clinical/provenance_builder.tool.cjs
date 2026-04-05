/**
 * Provenance Builder Tool
 * Creates evidence metadata for extracted clinical values.
 */

class ProvenanceBuilderTool {
  constructor(config = {}) {
    this.name = "Provenance Builder";
    this.version = "1.0.0";
    this.config = config;
    this.allowedTypes = new Set(["quoted", "normalized", "derived"]);
  }

  normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  findExcerpt(pdfText, candidates = []) {
    const lines = String(pdfText || "")
      .split("\n")
      .map((line) => this.normalizeWhitespace(line))
      .filter(Boolean);

    for (const candidate of candidates) {
      const normalized = this.normalizeWhitespace(candidate);
      if (!normalized) continue;

      const exact = lines.find((line) => line.toLowerCase().includes(normalized.toLowerCase()));
      if (exact) return exact;

      const words = normalized.split(" ").filter(Boolean).slice(0, 6);
      if (!words.length) continue;
      const pattern = new RegExp(words.map((word) => this.escapeRegex(word)).join(".*"), "i");
      const fuzzy = lines.find((line) => pattern.test(line));
      if (fuzzy) return fuzzy;
    }

    return "";
  }

  createItem({
    value,
    source_section = "",
    source_excerpt = "",
    source_page = null,
    confidence = 0.7,
    provenance_type = "normalized",
  }) {
    return {
      value: this.normalizeWhitespace(value),
      source_section: this.normalizeWhitespace(source_section),
      source_excerpt: this.normalizeWhitespace(source_excerpt),
      source_page,
      confidence: typeof confidence === "number" ? confidence : 0.7,
      provenance_type: this.allowedTypes.has(provenance_type) ? provenance_type : "normalized",
    };
  }

  sanitizeItem(item, overrides = {}) {
    if (!item || typeof item !== "object") return null;

    const value = this.normalizeWhitespace(overrides.value ?? item.value ?? "");
    if (!value) return null;

    return this.createItem({
      value,
      source_section: overrides.source_section ?? item.source_section ?? "",
      source_excerpt: overrides.source_excerpt ?? item.source_excerpt ?? "",
      source_page:
        typeof (overrides.source_page ?? item.source_page) === "number"
          ? (overrides.source_page ?? item.source_page)
          : null,
      confidence:
        typeof (overrides.confidence ?? item.confidence) === "number"
          ? (overrides.confidence ?? item.confidence)
          : 0.7,
      provenance_type: overrides.provenance_type ?? item.provenance_type ?? "normalized",
    });
  }

  sanitizeList(items = [], overrides = {}) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => this.sanitizeItem(item, overrides)).filter(Boolean);
  }

  mergeItem(preferred, fallback) {
    const safePreferred = this.sanitizeItem(preferred);
    const safeFallback = this.sanitizeItem(fallback);

    if (safePreferred && safePreferred.source_excerpt) return safePreferred;
    if (safeFallback && safeFallback.source_excerpt) return safeFallback;
    return safePreferred || safeFallback || null;
  }

  mergeLists(preferred = [], fallback = []) {
    const map = new Map();

    for (const item of this.sanitizeList(fallback)) {
      map.set(item.value.toLowerCase(), item);
    }

    for (const item of this.sanitizeList(preferred)) {
      const key = item.value.toLowerCase();
      const existing = map.get(key);
      if (!existing || item.source_excerpt || !existing.source_excerpt) {
        map.set(key, item);
      }
    }

    return Array.from(map.values());
  }

  createFromCandidates({ value, source_section = "", candidates = [], pdfText = "", confidence = 0.7, provenance_type = "normalized" }) {
    const excerpt = this.findExcerpt(pdfText, [value, ...candidates]);
    return this.createItem({
      value,
      source_section,
      source_excerpt: excerpt,
      source_page: null,
      confidence: excerpt ? confidence : 0.4,
      provenance_type,
    });
  }
}

module.exports = ProvenanceBuilderTool;
