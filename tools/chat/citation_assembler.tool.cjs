class CitationAssemblerTool {
  constructor(config = {}) {
    this.name = "Citation Assembler";
    this.version = "1.0.0";
    this.config = config;
  }

  assemble(items = [], options = {}) {
    const { max = 4 } = options;
    const seen = new Set();

    return (Array.isArray(items) ? items : [])
      .filter(Boolean)
      .filter((item) => {
        const key = [item.source_class || "internal", item.source_section || "", item.source_excerpt || "", item.label || item.value || ""].join("::");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((item) => ({
        label:
          item.label ||
          (item.source_class === "external"
            ? `[External: ${item.source_section || "Medical Source"}]`
            : `[Patient: ${item.source_section || "Record"}${typeof item.source_page === "number" ? `, p.${item.source_page}` : ""}]`),
        source_class: item.source_class || "internal",
        source_section: item.source_section || "",
        source_excerpt: item.source_excerpt || "",
        source_page: typeof item.source_page === "number" ? item.source_page : null,
        url: item.url || "",
        retrieved_at: item.retrieved_at || "",
        provenance_type: item.provenance_type || "normalized",
      }))
      .slice(0, max);
  }
}

module.exports = CitationAssemblerTool;
