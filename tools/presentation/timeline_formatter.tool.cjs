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
    const summary = this.normalizeWhitespace(note.summary) || "";
    const assessment = this.normalizeWhitespace(note.assessment) || "";
    const recommendations = this.normalizeWhitespace(note.recommendations) || "";
    const situation = this.normalizeWhitespace(note.situation) || "";
    const background = this.normalizeWhitespace(note.background) || "";

    // For comprehensive clinical summaries, extract just the key info
    if (note.is_comprehensive_summary && summary) {
      console.log(`[TimelineFormatter] Processing comprehensive summary, length: ${summary.length}`);
      const summarized = this.summarizeClinicalNote(summary);
      console.log(`[TimelineFormatter] Summarized to: ${summarized?.substring(0, 100)}...`);
      return summarized;
    }

    // For long summaries that look like comprehensive ones (have ** markers)
    if (summary.includes("**") && summary.length > 200) {
      console.log(`[TimelineFormatter] Auto-detecting comprehensive summary by content, length: ${summary.length}`);
      const summarized = this.summarizeClinicalNote(summary);
      console.log(`[TimelineFormatter] Summarized to: ${summarized?.substring(0, 100)}...`);
      return summarized;
    }

    return summary || assessment || recommendations || situation || background;
  }

  /**
   * Extract key info from comprehensive clinical summary for compact display
   * Takes the full narrative and returns a focused 1-2 sentence summary
   */
  summarizeClinicalNote(fullSummary) {
    if (!fullSummary || fullSummary.length < 100) {
      return fullSummary;
    }

    // Split by markdown headers
    const sections = fullSummary.split(/\*\*[^:]+:\*\*/);

    // Prioritize key sections for notes rail display
    const keyPhrases = [];

    for (const section of sections) {
      const trimmed = section.trim();
      if (trimmed.length < 20) continue;

      // Extract diagnosis
      if (trimmed.toLowerCase().includes("principal diagnosis:") ||
          trimmed.toLowerCase().includes("meatal") ||
          trimmed.toLowerCase().includes("stenosis") ||
          trimmed.toLowerCase().includes("uti") ||
          trimmed.match(/principal:.{10,100}/i)) {
        const diagnosis = trimmed.replace(/Principal diagnosis:\s*/i, "").split(".")[0].trim();
        if (diagnosis) keyPhrases.push(`Diagnosis: ${diagnosis}`);
      }

      // Extract medications (but keep it brief)
      if (trimmed.toLowerCase().includes("medications prescribed:") &&
          !keyPhrases.some(p => p.includes("Medications"))) {
        const medSection = trimmed.split("Medications prescribed:")[1]?.split("**")[0]?.split(".")[0] || "";
        const meds = medSection.trim().substring(0, 60);
        if (meds) keyPhrases.push(`Meds: ${meds}${medSection.length > 60 ? "..." : ""}`);
      }

      // Stop once we have enough info
      if (keyPhrases.length >= 2) break;
    }

    // If we couldn't extract structured info, return first meaningful sentence
    if (keyPhrases.length === 0) {
      const firstSentence = fullSummary.split(".")[0];
      if (firstSentence && firstSentence.length > 20 && firstSentence.length < 200) {
        return firstSentence + ".";
      }
      // Fallback to first 150 chars
      return fullSummary.substring(0, 150) + (fullSummary.length > 150 ? "..." : "");
    }

    return keyPhrases.join(" • ");
  }

  format(note = {}, provenance = []) {
    const rawAuthor =
      this.normalizeWhitespace(note.author) ||
      this.normalizeWhitespace(note.handed_over_by) ||
      this.normalizeWhitespace(note.handed_over_to) ||
      "Unknown author";

    return {
      title: this.normalizeWhitespace(note.type) || "Clinical Note",
      author: this.cleanAuthorName(rawAuthor),
      timestamp: this.normalizeWhitespace(note.date) || "",
      body: this.buildBody(note),
      priority: this.classifyPriority(note),
      category: this.classifyCategory(note),
      sourceType: this.normalizeWhitespace(note.source_type) || "",
      isSynthetic: Boolean(note.is_synthetic),
      confidence: this.normalizeWhitespace(note.confidence) || "",
      provenance: Array.isArray(provenance) ? provenance.filter(Boolean) : [],
    };
  }

  /**
   * Clean up author name by removing long credential lists
   * Keeps "Dr. NAME" but strips "(M.B.B.S, M.S., ...)"
   */
  cleanAuthorName(author) {
    if (!author) return "Unknown";

    // If author has parenthesized credentials, extract just the name before it
    // Handles: "Dr. NAME (CREDENTIALS)" or "NAME (CREDENTIALS)"
    const match = author.match(/^([A-Za-z][A-Za-z\s\.]+?)\s*\(.*?\)/);
    if (match) {
      return match[1].trim();
    }

    // If author is very long (probably with credentials), truncate after first 2-3 words
    if (author.length > 50) {
      const words = author.split(/\s+/);
      // Keep "Dr." title if present, plus first name
      if (words.length > 2) {
        const hasDr = words[0]?.match(/^Dr\.?$/i);
        if (hasDr) {
          return `${words[0]} ${words[1]}`;
        }
        return words.slice(0, 2).join(" ");
      }
    }

    return author;
  }
}

module.exports = TimelineFormatterTool;
