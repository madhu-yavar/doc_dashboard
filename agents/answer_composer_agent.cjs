const GemmaClientTool = require("../tools/llm/gemma_client.tool.cjs");
const ChatPromptBuilderTool = require("../tools/chat/chat_prompt_builder.tool.cjs");
const CitationAssemblerTool = require("../tools/chat/citation_assembler.tool.cjs");

class AnswerComposerAgent {
  constructor(config = {}) {
    this.name = "Answer Composer Agent";
    this.version = "1.0.0";
    this.gemmaClient = new GemmaClientTool(config.gemma || {});
    this.promptBuilder = new ChatPromptBuilderTool(config);
    this.citationAssembler = new CitationAssemblerTool(config);
  }

  buildFactAnswer(classification, internalEvidence = []) {
    const field = classification?.factField;
    if (!field || !internalEvidence.length) return null;

    const matchesField = (item) => {
      const label = String(item?.label || "").toLowerCase();
      const section = String(item?.section || "").toLowerCase();
      const sourceSection = String(item?.source_section || "").toLowerCase();

      if (field === "patient_name") return label.includes("patient name") || section === "patient";
      if (field === "mrn") return label.includes("medical record number") || label.includes("mrn");
      if (field === "age") return label.includes("age");
      if (field === "gender") return label.includes("gender");
      if (field === "admission_date") return label.includes("admission date");
      if (field === "discharge_date") return label.includes("discharge date");
      if (field === "principal_diagnosis") return section === "diagnosis" || sourceSection.includes("diagnosis");
      return false;
    };

    const evidence = internalEvidence.find(matchesField) || internalEvidence[0];
    const value = String(evidence?.value || "").trim();
    if (!value) return null;

    const answerByField = {
      patient_name: value,
      mrn: value,
      age: value,
      gender: value,
      admission_date: value,
      discharge_date: value,
      principal_diagnosis: value,
    };

    const answer = answerByField[field] || value;
    return {
      answer,
      citations: this.citationAssembler.assemble([evidence], { max: 1 }),
      source_class: "internal",
    };
  }

  async execute({ message, classification, internalEvidence = [], externalEvidence = [], chatHistory = [] }) {
    if (classification?.responseStyle === "factoid" && internalEvidence.length && !externalEvidence.length) {
      const factAnswer = this.buildFactAnswer(classification, internalEvidence);
      if (factAnswer) {
        return {
          success: true,
          step: "answer_composer",
          data: factAnswer,
        };
      }
    }

    const prompt = this.promptBuilder.build({
      message,
      classification,
      internalEvidence,
      externalEvidence,
      chatHistory,
    });

    const result = await this.gemmaClient.execute(prompt, { temperature: 0.1, maxTokens: 600 });
    const sourceClass =
      internalEvidence.length && externalEvidence.length
        ? "mixed"
        : externalEvidence.length
        ? "external"
        : "internal";
    const citationItems =
      sourceClass === "mixed"
        ? [internalEvidence[0]].filter(Boolean).concat(externalEvidence, internalEvidence.slice(1))
        : [...internalEvidence, ...externalEvidence];

    return {
      success: true,
      step: "answer_composer",
      data: {
        answer: result.success
          ? result.content.trim()
          : internalEvidence.length
          ? `Based on the available patient record, the most relevant findings are: ${internalEvidence
              .slice(0, 3)
              .map((item) => item.value)
              .join("; ")}.`
          : "I could not compose a safe answer from the available evidence.",
        citations: this.citationAssembler.assemble(citationItems, {
          max: classification?.responseStyle === "factoid" ? 1 : 4,
        }),
        source_class: sourceClass,
      },
    };
  }
}

module.exports = AnswerComposerAgent;
