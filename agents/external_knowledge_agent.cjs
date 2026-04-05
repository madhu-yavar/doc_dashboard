const MedicalWebSearchTool = require("../tools/chat/medical_web_search.tool.cjs");
const SourcePolicyTool = require("../tools/chat/source_policy.tool.cjs");
const ExternalSourceRankerTool = require("../tools/chat/external_source_ranker.tool.cjs");
const ExternalCitationNormalizerTool = require("../tools/chat/external_citation_normalizer.tool.cjs");

class ExternalKnowledgeAgent {
  constructor(config = {}) {
    this.name = "External Knowledge Agent";
    this.version = "1.0.0";
    this.searchTool = new MedicalWebSearchTool(config);
    this.sourcePolicy = new SourcePolicyTool(config);
    this.ranker = new ExternalSourceRankerTool(config);
    this.normalizer = new ExternalCitationNormalizerTool(config);
  }

  buildSearchQuery(query = "", classification = {}) {
    const text = String(query || "").trim();
    const lower = text.toLowerCase();

    if (classification?.intent === "clinical_explanation") {
      if ((lower.includes("bp") || lower.includes("blood pressure")) && (lower.includes("low") || lower.includes("less than") || lower.includes("below"))) {
        return "common causes of low blood pressure hypotension adults";
      }
      if ((lower.includes("bp") || lower.includes("blood pressure")) && (lower.includes("high") || lower.includes("above") || lower.includes("elevated"))) {
        return "common causes of high blood pressure hypertension adults";
      }
      if (lower.includes("pulse") || lower.includes("heart rate")) {
        if (lower.includes("high") || lower.includes("elevated")) return "common causes of tachycardia adults";
        if (lower.includes("low") || lower.includes("below")) return "common causes of bradycardia adults";
      }
      if (lower.includes("spo2") || lower.includes("oxygen")) return "common causes of low oxygen saturation hypoxemia adults";
      if (lower.includes("temperature") || lower.includes("fever")) return "common causes of fever adults";
      if (lower.includes("creatinine")) return "common causes of elevated creatinine adults";
      if (lower.includes("sodium")) return "common causes of abnormal sodium adults";
      if (lower.includes("potassium")) return "common causes of abnormal potassium adults";
      return `general medical explanation for: ${text}`;
    }

    return text;
  }

  async execute({ query, classification }) {
    try {
      const searchQuery = this.buildSearchQuery(query, classification);
      const rawResults = await this.searchTool.search({ query: searchQuery, intent: classification?.intent });
      const allowed = this.sourcePolicy.filter(rawResults);
      const ranked = this.ranker.rank(allowed, searchQuery, 5);
      return {
        success: true,
        step: "external_knowledge",
        data: {
          evidence: this.normalizer.normalizeMany(ranked),
          source_class: ranked.length ? "external" : "external",
          error: ranked.length ? null : "No reliable external results found.",
          error_type: ranked.length ? null : "no_results",
        },
      };
    } catch (error) {
      return {
        success: true,
        step: "external_knowledge",
        data: {
          evidence: [],
          source_class: "external",
          error: error.message,
          error_type: "search_failed",
        },
      };
    }
  }
}

module.exports = ExternalKnowledgeAgent;
