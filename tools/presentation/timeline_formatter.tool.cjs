class TimelineFormatterTool {
  constructor(config = {}) {
    this.name = "Timeline Formatter";
    this.version = "1.0.0";
    this.config = config;
  }

  normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  classifyPriority(note = {}) {
    const text = [
      note.summary,
      note.assessment,
      ...(Array.isArray(note.risk_flags) ? note.risk_flags : []),
      ...(Array.isArray(note.pending_items) ? note.pending_items : []),
    ]
      .map((item) => this.normalizeWhitespace(item))
      .join(" ")
      .toLowerCase();

    if (/(critical|bleed|hemorrhage|haemorrhage|unstable|worsening|aspiration|fall risk|pressure ulcer)/.test(text)) {
      return "critical";
    }
    if (/(pending|review|follow-up|monitor|elevated|risk)/.test(text)) {
      return "warning";
    }
    return "normal";
  }

  classifyCategory(note = {}) {
    const type = this.normalizeWhitespace(note.type).toLowerCase();
    if (/doctor|resident|consult/.test(type)) return "doctor";
    if (/nurse|endorsement/.test(type)) return "nurse";
    if (/handover/.test(type)) return "handover";
    if (/lab|result/.test(type)) return "result";
    return "treatment";
  }

  buildBody(note = {}) {
    return (
      this.normalizeWhitespace(note.summary) ||
      this.normalizeWhitespace(note.assessment) ||
      this.normalizeWhitespace(note.recommendations) ||
      this.normalizeWhitespace(note.situation) ||
      this.normalizeWhitespace(note.background)
    );
  }

  format(note = {}, provenance = []) {
    const author =
      this.normalizeWhitespace(note.author) ||
      this.normalizeWhitespace(note.handed_over_by) ||
      this.normalizeWhitespace(note.handed_over_to) ||
      "Unknown author";

    return {
      title: this.normalizeWhitespace(note.type) || "Clinical Note",
      author,
      timestamp: this.normalizeWhitespace(note.date) || "",
      body: this.buildBody(note),
      priority: this.classifyPriority(note),
      category: this.classifyCategory(note),
      provenance: Array.isArray(provenance) ? provenance.filter(Boolean) : [],
    };
  }
}

module.exports = TimelineFormatterTool;
