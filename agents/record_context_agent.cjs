const RecordContextSearchTool = require("../tools/chat/record_context_search.tool.cjs");
const SectionContextFetchTool = require("../tools/chat/section_context_fetch.tool.cjs");
const ProvenanceGateTool = require("../tools/chat/provenance_gate.tool.cjs");

class RecordContextAgent {
  constructor(config = {}) {
    this.name = "Record Context Agent";
    this.version = "1.0.0";
    this.searchTool = new RecordContextSearchTool(config);
    this.sectionFetchTool = new SectionContextFetchTool(config);
    this.provenanceGate = new ProvenanceGateTool(config);
  }

  async execute({ document, message, sectionHints = [], classification }) {
    const searchResults = this.searchTool.search(document, message, sectionHints, 10, classification?.factField || null);
    const safeResults = this.provenanceGate.filter(searchResults, {
      sourceClass: "internal",
      allowedTypes: ["quoted", "normalized", "derived"],
    });

    const sections = Object.fromEntries(
      sectionHints.map((section) => [section, this.sectionFetchTool.getSection(document, section)])
    );

    return {
      success: true,
      step: "record_context",
      data: {
        evidence: safeResults,
        sections,
        source_class: classification?.needsExternal ? "mixed" : "internal",
      },
    };
  }
}

module.exports = RecordContextAgent;
