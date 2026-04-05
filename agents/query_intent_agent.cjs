const QueryClassifierTool = require("../tools/chat/query_classifier.tool.cjs");
const SectionHintResolverTool = require("../tools/chat/section_hint_resolver.tool.cjs");

class QueryIntentAgent {
  constructor(config = {}) {
    this.name = "Query Intent Agent";
    this.version = "1.0.0";
    this.classifier = new QueryClassifierTool(config);
    this.sectionResolver = new SectionHintResolverTool(config);
  }

  async execute({ message, sectionContext }) {
    const classification = await this.classifier.classify(message, sectionContext);
    return {
      success: true,
      step: "query_intent",
      data: {
        ...classification,
        sectionHints: this.sectionResolver.resolve(classification, sectionContext),
      },
    };
  }
}

module.exports = QueryIntentAgent;
