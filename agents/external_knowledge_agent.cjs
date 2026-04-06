const MedicalWebSearchTool = require("../tools/chat/medical_web_search.tool.cjs");
const SourcePolicyTool = require("../tools/chat/source_policy.tool.cjs");
const ExternalSourceRankerTool = require("../tools/chat/external_source_ranker.tool.cjs");
const ExternalCitationNormalizerTool = require("../tools/chat/external_citation_normalizer.tool.cjs");
const ExternalQueryPlannerTool = require("../tools/chat/external_query_planner.tool.cjs");
const SourceRouterTool = require("../tools/chat/source_router.tool.cjs");

class ExternalKnowledgeAgent {
  constructor(config = {}) {
    this.name = "External Knowledge Agent";
    this.version = "1.0.0";
    this.searchTool = new MedicalWebSearchTool(config);
    this.sourcePolicy = new SourcePolicyTool(config);
    this.ranker = new ExternalSourceRankerTool(config);
    this.normalizer = new ExternalCitationNormalizerTool(config);
    this.queryPlanner = new ExternalQueryPlannerTool(config);
    this.sourceRouter = new SourceRouterTool(config);
  }

  extractTerms(text = "") {
    const stopwords = new Set([
      "what",
      "why",
      "how",
      "does",
      "do",
      "is",
      "the",
      "for",
      "with",
      "and",
      "or",
      "of",
      "to",
      "in",
      "patient",
      "patients",
      "code",
      "icd",
      "cm",
      "mg",
      "ml",
      "tab",
      "inj",
    ]);

    return String(text || "")
      .toLowerCase()
      .replace(/[^\w\s.-]/g, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 2 && !stopwords.has(item));
  }

  filterRelevantResults(results = [], plan = {}) {
    const knowledgeType = String(plan.knowledge_type || "").toLowerCase();
    if (knowledgeType === "coding_reference") return results;

    const terms = this.extractTerms(plan.entity || plan.search_queries?.[0] || "");
    if (!terms.length) return results;

    return results.filter((item) => {
      const source = `${item.source_section || ""} ${item.url || ""}`.toLowerCase();
      if (/fda|dailymed|clinicaltables/.test(source)) return true;

      const haystack = `${item.title || ""} ${item.value || ""} ${item.snippet || ""}`.toLowerCase();
      return terms.some((term) => haystack.includes(term));
    });
  }

  async execute({ query, classification }) {
    try {
      const plan = await this.queryPlanner.plan(query, classification);
      if (plan.needs_clarification) {
        return {
          success: true,
          step: "external_knowledge",
          data: {
            evidence: [],
            source_class: "external",
            error: plan.clarification_prompt || "External clarification needed.",
            error_type: "clarification_needed",
            plan,
            sources: [],
          },
        };
      }

      const sources = this.sourceRouter.route({ plan, classification, query });
      const rawResults = [];

      for (const searchQuery of plan.search_queries) {
        const chunk = await this.searchTool.search({
          query: searchQuery,
          intent: classification?.intent,
          sources,
        });
        rawResults.push(...chunk);
        if (rawResults.length >= 8) break;
      }

      const allowed = this.sourcePolicy.filter(rawResults);
      const relevant = this.filterRelevantResults(allowed, plan);
      let ranked = this.ranker.rank(relevant, plan.search_queries[0] || query, 5, {
        knowledgeType: plan.knowledge_type,
        intent: classification?.intent,
        entity: plan.entity,
      });

      if (
        plan.knowledge_type === "drug_knowledge" &&
        /\b(composition|ingredient|formulation|strength|dose|dosage|syrup|tablet|injection|come with|come in|availability|market)\b/i.test(String(query || ""))
      ) {
        const structural = ranked.filter((item) => /fda|dailymed/i.test(`${item.source_section || ""} ${item.url || ""}`));
        ranked = structural.length ? structural : [];
      }

      return {
        success: true,
        step: "external_knowledge",
        data: {
          evidence: this.normalizer.normalizeMany(ranked),
          source_class: "external",
          error: ranked.length ? null : "No reliable external results found.",
          error_type: ranked.length ? null : "no_results",
          plan,
          sources,
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
          plan: null,
          sources: [],
        },
      };
    }
  }
}

module.exports = ExternalKnowledgeAgent;
