class NoteSelectorTool {
  constructor(config = {}) {
    this.name = "Note Selector";
    this.version = "1.0.0";
    this.config = config;
  }

  normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  isLowValue(note = {}) {
    const type = this.normalizeWhitespace(note.type).toLowerCase();
    const summary = this.normalizeWhitespace(note.summary).toLowerCase();
    const assessment = this.normalizeWhitespace(note.assessment).toLowerCase();
    const recommendations = this.normalizeWhitespace(note.recommendations).toLowerCase();
    const body = [summary, assessment, recommendations].join(" ");

    if (!body) return true;
    if (/diet:\s*(npo|nbm|nil per mouth)\b/.test(body)) return true;
    if (/^diet[:\s]/.test(summary)) return true;
    if (/discharge planning/.test(type) && body.length < 60) return true;
    if (/medication orders?|nursing care plan status|patient measurable goal/.test(body)) return true;

    return false;
  }

  score(note = {}) {
    const type = this.normalizeWhitespace(note.type).toLowerCase();
    const author = this.normalizeWhitespace(note.author || note.handed_over_by);
    const summary = this.normalizeWhitespace(note.summary);
    const assessment = this.normalizeWhitespace(note.assessment);
    let score = 0;

    if (/doctor|handover|resident/.test(type)) score += 4;
    if (/nurse|endorsement/.test(type)) score += 3;
    if (Array.isArray(note.risk_flags) && note.risk_flags.length) score += 3;
    if (Array.isArray(note.pending_items) && note.pending_items.length) score += 2;
    if (summary) score += 2;
    if (assessment) score += 2;
    if (this.normalizeWhitespace(note.recommendations)) score += 1;
    if (author) score += 1;
    if (!/^unknown author$/i.test(author) && author) score += 2;
    if (summary.length > 50 || assessment.length > 50) score += 1;
    if (this.isLowValue(note)) score -= 6;

    return score;
  }

  dedupe(notes = []) {
    const seen = new Set();
    return notes.filter((note) => {
      const key = `${this.normalizeWhitespace(note.type)}|${this.normalizeWhitespace(note.summary)}`.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  select(notes = [], limit = 4) {
    return this.dedupe(Array.isArray(notes) ? notes : [])
      .filter((note) => !this.isLowValue(note))
      .sort((a, b) => this.score(b) - this.score(a))
      .slice(0, limit);
  }
}

module.exports = NoteSelectorTool;
