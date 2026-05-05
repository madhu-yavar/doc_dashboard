class SectionContextFetchTool {
  constructor(config = {}) {
    this.name = "Section Context Fetch";
    this.version = "1.0.0";
    this.config = config;
  }

  getSection(document = {}, section = "") {
    const result = document.result || {};
    const extracted = result.extracted_data || {};
    const cards = result.dashboard_cards || {};
    const presentation = result.presentation || {};
    const normalized = String(section || "").toLowerCase();

    return {
      section: normalized,
      extracted: extracted[normalized] || extracted,
      card: cards[`${normalized}_card`] || null,
      presentation: presentation.summary_cards?.[normalized] || null,
      provenance:
        extracted.provenance?.[normalized] ||
        (normalized === "followup" ? extracted.provenance?.follow_up || null : null),
      chartNote: document.chartNote || null,
    };
  }
}

module.exports = SectionContextFetchTool;
