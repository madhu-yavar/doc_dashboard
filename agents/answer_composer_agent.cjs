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

  firstSentence(text = "", maxLength = 220) {
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    const sentence = cleaned.match(/.+?[.!?](?:\s|$)/)?.[0]?.trim() || cleaned;
    return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 1).trim()}…` : sentence;
  }

  bestExternalSummary(item = {}) {
    const preferred = [item.value, item.source_excerpt].map((value) => String(value || "").trim()).filter(Boolean);
    for (const candidate of preferred) {
      const sentence = this.firstSentence(candidate);
      if (sentence) return sentence;
    }
    return "";
  }

  extractIcdCode(externalEvidence = []) {
    const pattern = /\b[A-TV-Z][0-9][0-9AB](?:\.[0-9A-Z]{1,4})?\b/;
    for (const item of externalEvidence) {
      const match = `${item.label || ""} ${item.value || ""} ${item.source_excerpt || ""}`.match(pattern);
      if (match) return match[0];
    }
    return "";
  }

  buildClinicalExplanationAnswer(message, internalEvidence = [], externalEvidence = []) {
    const lower = String(message || "").toLowerCase();
    const topInternal = internalEvidence[0];
    const topExternal = externalEvidence[0];
    const internalLine = topInternal?.value ? `Patient Record: ${topInternal.value}.` : "Patient Record: No chart-based explanation is documented.";

    if (!topExternal) {
      return null;
    }

    if ((lower.includes("low") || lower.includes("less than") || lower.includes("below")) && /\b1[4-9]\d\b|\b160\b|\b170\b|\b180\b/.test(String(topInternal?.value || ""))) {
      return {
        answer: `${internalLine} The chart does not show low blood pressure in this record. External Reference: Common causes of hypotension in adults include dehydration, sepsis, blood loss, medication effects, and endocrine or cardiac causes.`,
        citations: this.citationAssembler.assemble([topInternal, ...externalEvidence], { max: 4 }),
        source_class: "mixed",
      };
    }

    const externalLine = this.bestExternalSummary(topExternal);
    if (!externalLine) return null;

    return {
      answer: `${internalLine}\n\nExternal Reference: ${externalLine}`,
      citations: this.citationAssembler.assemble([topInternal, ...externalEvidence].filter(Boolean), { max: 4 }),
      source_class: topInternal ? "mixed" : "external",
    };
  }

  buildDrugKnowledgeAnswer(message, internalEvidence = [], externalEvidence = []) {
    if (!externalEvidence.length) return null;

    const topInternal = internalEvidence[0];
    const topExternal = externalEvidence[0];
    const lower = String(message || "").toLowerCase();
    const internalLine = topInternal?.value ? `Patient Record: ${topInternal.value}.` : "";
    const externalLine = this.bestExternalSummary(topExternal);

    if (!externalLine) return null;

    let answer = "";
    if (/\b(composition|ingredient)\b/.test(lower)) {
      answer = `${internalLine ? `${internalLine}\n\n` : ""}External Reference: ${externalLine}`;
    } else if (/\b(come with|come in|strength|dose|dosage|syrup|tablet|injection|availability|market)\b/.test(lower)) {
      answer = `${internalLine ? `${internalLine}\n\n` : ""}External Reference: ${externalLine}`;
    } else if (/\b(what does|what is .* used for|why do we need|role)\b/.test(lower)) {
      answer = `${internalLine ? `${internalLine}\n\n` : ""}External Reference: ${externalLine}`;
    } else {
      answer = `${internalLine ? `${internalLine}\n\n` : ""}External Reference: ${externalLine}`;
    }

    return {
      answer,
      citations: this.citationAssembler.assemble([topInternal, ...externalEvidence].filter(Boolean), { max: 4 }),
      source_class: topInternal ? "mixed" : "external",
    };
  }

  buildCodingAnswer(message, externalEvidence = []) {
    if (!externalEvidence.length) return null;

    const code = this.extractIcdCode(externalEvidence);
    const top = externalEvidence[0];
    if (!code) return null;

    const title = this.firstSentence(top.value || top.source_excerpt || "").replace(/^[A-TV-Z][0-9][0-9AB](?:\.[0-9A-Z]{1,4})?\s*/, "").trim();
    const answer = title
      ? `External Reference: The ICD-10-CM code for ${title} is ${code}.`
      : `External Reference: The ICD-10-CM code is ${code}.`;

    return {
      answer,
      citations: this.citationAssembler.assemble(externalEvidence, { max: 3 }),
      source_class: "external",
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

    if (classification?.intent === "diagnosis_code" && externalEvidence.length) {
      const codingAnswer = this.buildCodingAnswer(message, externalEvidence);
      if (codingAnswer) {
        return {
          success: true,
          step: "answer_composer",
          data: codingAnswer,
        };
      }
    }

    if (classification?.intent === "clinical_explanation" && externalEvidence.length) {
      const explanationAnswer = this.buildClinicalExplanationAnswer(message, internalEvidence, externalEvidence);
      if (explanationAnswer) {
        return {
          success: true,
          step: "answer_composer",
          data: explanationAnswer,
        };
      }
    }

    if (classification?.intent === "drug_safety" && externalEvidence.length) {
      const drugAnswer = this.buildDrugKnowledgeAnswer(message, internalEvidence, externalEvidence);
      if (drugAnswer) {
        return {
          success: true,
          step: "answer_composer",
          data: drugAnswer,
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
