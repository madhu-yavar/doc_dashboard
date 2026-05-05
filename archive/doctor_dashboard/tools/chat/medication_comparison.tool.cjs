class MedicationComparisonTool {
  constructor(config = {}) {
    this.name = "Medication Comparison";
    this.version = "1.0.0";
    this.config = config;
    this.aliases = [
      {
        aliases: ["PAN 40", "PAN40", "PANTOPRAZOLE 40", "TAB PAN 40"],
        canonical: "Pan 40",
        generic: ["pantoprazole"],
        strength: "40 mg",
        notes: "Pantoprazole 40 mg",
      },
      {
        aliases: ["PAN D", "PAND", "PAN-D"],
        canonical: "Pan D",
        generic: ["pantoprazole", "domperidone"],
        strength: "",
        notes: "Pantoprazole with domperidone",
      },
      {
        aliases: ["STATOR", "TAB STATOR 10", "STATOR 10"],
        canonical: "Stator",
        generic: ["atorvastatin"],
        strength: "10 mg",
        notes: "Atorvastatin",
      },
      {
        aliases: ["AUGMENTIN", "INJ AUGMENTIN 1.2GM", "AUGMENTIN 1.2"],
        canonical: "Augmentin",
        generic: ["amoxicillin", "clavulanate"],
        strength: "",
        notes: "Amoxicillin-clavulanate",
      },
      {
        aliases: ["LASIX", "INJ LASIX", "LASIX 20"],
        canonical: "Lasix",
        generic: ["furosemide"],
        strength: "",
        notes: "Furosemide",
      },
    ];
  }

  normalizeText(value = "") {
    return String(value || "")
      .toUpperCase()
      .replace(/[^\w\s.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  findMedicationByText(text = "") {
    const normalized = this.normalizeText(text);
    if (!normalized) return null;

    for (const item of this.aliases) {
      if (item.aliases.some((alias) => normalized.includes(this.normalizeText(alias)))) {
        return item;
      }
    }

    return null;
  }

  findMedicationMentions(text = "") {
    const normalized = this.normalizeText(text);
    const mentions = [];

    for (const item of this.aliases) {
      const positions = item.aliases
        .map((alias) => normalized.indexOf(this.normalizeText(alias)))
        .filter((index) => index >= 0);
      if (positions.length) {
        mentions.push({
          item,
          index: Math.min(...positions),
        });
      }
    }

    return mentions.sort((a, b) => a.index - b.index);
  }

  extractInternalMedicationNames(internalEvidence = []) {
    return (Array.isArray(internalEvidence) ? internalEvidence : [])
      .filter((item) => item.section === "medications" || item.source_section?.toLowerCase().includes("medication"))
      .map((item) => item.value || item.label || "")
      .filter(Boolean);
  }

  compareKnownMeds(primary, alternative) {
    if (!primary || !alternative) return null;

    const primaryGenerics = new Set(primary.generic);
    const alternativeGenerics = new Set(alternative.generic);
    const shared = [...primaryGenerics].filter((item) => alternativeGenerics.has(item));

    if (shared.length === 0) {
      return {
        answer: `${alternative.canonical} is not the same medication as ${primary.canonical}. They do not share the same active ingredient, so it should not be treated as a direct substitute without reviewing the clinical indication.`,
        confidence: "medium",
      };
    }

    if (alternative.generic.length > primary.generic.length) {
      return {
        answer: `${alternative.canonical} is not a one-to-one substitute for ${primary.canonical}. Both include ${shared.join(", ")}, but ${alternative.canonical} also adds ${alternative.generic.filter((item) => !primaryGenerics.has(item)).join(", ")}. That means the products are not the same and substitution depends on the indication.`,
        confidence: "medium",
      };
    }

    if (primary.generic.length > alternative.generic.length) {
      return {
        answer: `${alternative.canonical} is related to ${primary.canonical}, but it does not contain the full same active-ingredient profile. It should not be assumed to be a direct substitute without reviewing the treatment goal.`,
        confidence: "medium",
      };
    }

    return {
      answer: `${alternative.canonical} and ${primary.canonical} share the same active ingredient profile. They may be therapeutic equivalents, but dose, formulation, and clinical intent still need review before substitution.`,
      confidence: "medium",
    };
  }

  isBroadAlternativeQuery(text = "", primary = null, alternative = null) {
    if (!primary || alternative) return false;
    const normalized = String(text || "").toLowerCase();
    return /\b(what\s+is\s+the\s+alternate\s+for|what\s+are\s+the\s+alternatives?\s+for|alternative\s+for|alternate\s+for)\b/i.test(normalized);
  }

  resolve(message = "", internalEvidence = []) {
    const text = String(message || "");
    const lower = text.toLowerCase();
    const internalMeds = this.extractInternalMedicationNames(internalEvidence);
    const mentions = this.findMedicationMentions(text);
    const knownFromMessage = mentions.map((entry) => entry.item);

    const comparisonLike = /\b(alternative|alternate|substitute|replacement|replace|equivalent|same as|instead of|alternative for)\b/i.test(text);
    if (!comparisonLike) return null;

    let primary = knownFromMessage[0] || null;
    let alternative = knownFromMessage[1] || null;

    if (knownFromMessage.length >= 2) {
      alternative = mentions[0].item;
      primary = mentions[1].item;
    }

    if (/clarification:/i.test(text) && knownFromMessage.length >= 2) {
      const clarificationText = text.split(/clarification:/i)[1] || "";
      primary = this.findMedicationByText(clarificationText) || primary;
      const preClarificationText = text.split(/clarification:/i)[0] || "";
      alternative = this.findMedicationByText(preClarificationText) || alternative;
    }

    if (!primary && internalMeds.length === 1) {
      primary = this.findMedicationByText(internalMeds[0]);
    }

    if (this.isBroadAlternativeQuery(text, primary, alternative)) {
      return null;
    }

    if (!primary || !alternative) {
      return {
        needsClarification: true,
        clarificationPrompt: "Which current medication are you comparing it with? Please name both medicines, for example `Is PAN D an alternative to PAN 40?`",
      };
    }

    const comparison = this.compareKnownMeds(primary, alternative);
    if (!comparison) return null;

    const matchingInternal = (Array.isArray(internalEvidence) ? internalEvidence : []).find((item) => {
      const haystack = this.normalizeText(`${item.value || ""} ${item.source_excerpt || ""} ${item.label || ""}`);
      return primary.aliases.some((alias) => haystack.includes(this.normalizeText(alias)));
    });

    return {
      needsClarification: false,
      answer: comparison.answer,
      citations: matchingInternal ? [matchingInternal] : [],
      source_class: matchingInternal ? "internal" : "internal",
    };
  }
}

module.exports = MedicationComparisonTool;
