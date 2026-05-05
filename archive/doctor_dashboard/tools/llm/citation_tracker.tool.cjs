/**
 * Citation Tracker Tool
 * Tracks source citations for each extracted data point with location references
 * Enables verification by linking back to specific locations in source documents
 */

class CitationTrackerTool {
  constructor(config = {}) {
    this.name = "Citation Tracker";
    this.version = "1.0.0";
    this.citations = new Map();
    this.config = config;
  }

  /**
   * Add a citation for a data field
   * @param {string} field - Field name (e.g., "patient.name", "vitals.bp")
   * @param {object} citation - Citation details
   * @returns {string} Citation ID
   */
  addCitation(field, citation) {
    const citationId = this.generateId();

    const citationRecord = {
      id: citationId,
      field: field,
      snippet: citation.snippet || "",
      pageNumber: citation.pageNumber || null,
      sectionName: citation.sectionName || "",
      boundingBox: citation.boundingBox || null, // For PDF highlighting
      confidence: citation.confidence || 0,
      extractedAt: new Date().toISOString(),
      verified: false
    };

    // Initialize array for field if not exists
    if (!this.citations.has(field)) {
      this.citations.set(field, []);
    }

    this.citations.get(field).push(citationRecord);
    return citationId;
  }

  /**
   * Get all citations for a field
   * @param {string} field - Field name
   * @returns {Array} Citations for this field
   */
  getCitations(field) {
    return this.citations.get(field) || [];
  }

  /**
   * Get all citations grouped by field
   * @returns {object} All citations
   */
  getAllCitations() {
    const result = {};
    for (const [field, citations] of this.citations.entries()) {
      result[field] = citations;
    }
    return result;
  }

  /**
   * Verify a citation by cross-checking with source
   * @param {string} citationId - Citation ID to verify
   * @param {boolean} verified - Verification status
   */
  verifyCitation(citationId, verified = true) {
    for (const citations of this.citations.values()) {
      const citation = citations.find(c => c.id === citationId);
      if (citation) {
        citation.verified = verified;
        citation.verifiedAt = new Date().toISOString();
        return true;
      }
    }
    return false;
  }

  /**
   * Get fields that need review (confidence < threshold)
   * @param {number} threshold - Confidence threshold (default 0.9)
   * @returns {Array} Fields needing review
   */
  getFieldsNeedingReview(threshold = 0.9) {
    const needsReview = [];

    for (const [field, citations] of this.citations.entries()) {
      const maxConfidence = Math.max(...citations.map(c => c.confidence));
      const hasUnverified = citations.some(c => !c.verified);

      if (maxConfidence < threshold || hasUnverified) {
        needsReview.push({
          field: field,
          citations: citations,
          maxConfidence: maxConfidence,
          hasUnverified: hasUnverified
        });
      }
    }

    return needsReview;
  }

  /**
   * Generate citation hyperlink for frontend
   * @param {string} field - Field name
   * @returns {object} Hyperlink data
   */
  generateHyperlink(field) {
    const citations = this.getCitations(field);

    if (citations.length === 0) {
      return {
        field: field,
        hasCitation: false,
        warning: "No citation found - data may be hallucinated"
      };
    }

    const bestCitation = citations.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );

    return {
      field: field,
      hasCitation: true,
      citationId: bestCitation.id,
      snippet: bestCitation.snippet,
      pageNumber: bestCitation.pageNumber,
      sectionName: bestCitation.sectionName,
      boundingBox: bestCitation.boundingBox,
      confidence: bestCitation.confidence,
      verified: bestCitation.verified,
      // For frontend hyperlink generation
      link: {
        href: `#citation-${bestCitation.id}`,
        onClick: `highlightCitation('${bestCitation.id}')`,
        title: `View source: ${bestCitation.sectionName || 'Page ' + bestCitation.pageNumber}`
      },
      multipleSources: citations.length > 1 ? citations.length : null
    };
  }

  /**
   * Generate all hyperlinks for export
   * @returns {object} All hyperlinks by field
   */
  generateAllHyperlinks() {
    const hyperlinks = {};
    for (const field of this.citations.keys()) {
      hyperlinks[field] = this.generateHyperlink(field);
    }
    return hyperlinks;
  }

  /**
   * Merge citations from another extraction
   * @param {object} otherCitations - Citations to merge
   */
  mergeCitations(otherCitations) {
    for (const [field, citations] of Object.entries(otherCitations)) {
      for (const citation of citations) {
        this.addCitation(field, citation);
      }
    }
  }

  /**
   * Export citations for chart note
   * @returns {object} Formatted for chart note
   */
  exportForChartNote() {
    return {
      totalCitations: Array.from(this.citations.values()).reduce((sum, arr) => sum + arr.length, 0),
      totalFields: this.citations.size,
      fieldsNeedingReview: this.getFieldsNeedingReview(0.9).length,
      citations: this.generateAllHyperlinks(),
      summary: this.generateSummary()
    };
  }

  /**
   * Generate validation summary
   * @returns {object} Summary report
   */
  generateSummary() {
    const fieldsNeedingReview = this.getFieldsNeedingReview(0.9);
    const totalFields = this.citations.size;

    return {
      overallConfidence: this.calculateOverallConfidence(),
      fieldsReviewed: totalFields - fieldsNeedingReview.length,
      fieldsNeedingReview: fieldsNeedingReview.length,
      totalFields: totalFields,
      status: fieldsNeedingReview.length === 0 ? "PASSED" : "NEEDS_REVIEW",
      flags: fieldsNeedingReview.map(f => ({
        field: f.field,
        reason: f.maxConfidence < 0.9 ? "Low confidence" : "Unverified citation",
        confidence: f.maxConfidence
      }))
    };
  }

  /**
   * Calculate overall confidence score
   * @returns {number} Overall confidence (0-1)
   */
  calculateOverallConfidence() {
    if (this.citations.size === 0) return 0;

    let totalConfidence = 0;
    let count = 0;

    for (const citations of this.citations.values()) {
      const maxConfidence = Math.max(...citations.map(c => c.confidence));
      totalConfidence += maxConfidence;
      count++;
    }

    return count > 0 ? totalConfidence / count : 0;
  }

  /**
   * Generate unique citation ID
   * @returns {string} Unique ID
   */
  generateId() {
    return `cit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear all citations
   */
  clear() {
    this.citations.clear();
  }

  /**
   * Get citation by ID
   * @param {string} citationId - Citation ID
   * @returns {object|null} Citation object
   */
  getCitationById(citationId) {
    for (const citations of this.citations.values()) {
      const found = citations.find(c => c.id === citationId);
      if (found) return found;
    }
    return null;
  }
}

module.exports = CitationTrackerTool;
