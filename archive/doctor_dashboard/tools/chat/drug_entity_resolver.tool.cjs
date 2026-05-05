const GemmaClientTool = require("../llm/gemma_client.tool.cjs");

class DrugEntityResolverTool {
  constructor(config = {}) {
    this.name = "Drug Entity Resolver";
    this.version = "1.0.0";
    this.config = config;
    this.gemmaClient = new GemmaClientTool(config.gemma || {});
    this.aliases = [
      { pattern: /\bpan\s*40\b/i, generic_name: "pantoprazole", normalized_display: "pantoprazole 40 mg", dosage_form: "tablet" },
      { pattern: /\bt\.?\s*pan\s*40\b/i, generic_name: "pantoprazole", normalized_display: "pantoprazole 40 mg", dosage_form: "tablet" },
      { pattern: /\bpantocid\b/i, generic_name: "pantoprazole", normalized_display: "pantoprazole", dosage_form: "tablet or injection" },
      { pattern: /\bpan\s*d\b/i, generic_name: "pantoprazole + domperidone", normalized_display: "pantoprazole + domperidone", dosage_form: "tablet" },
      { pattern: /\bthyronorm\b/i, generic_name: "levothyroxine", normalized_display: "levothyroxine", dosage_form: "tablet" },
      { pattern: /\bthyro-?norm\b/i, generic_name: "levothyroxine", normalized_display: "levothyroxine", dosage_form: "tablet" },
      { pattern: /\baugmentin\b/i, generic_name: "amoxicillin and clavulanate potassium", normalized_display: "amoxicillin/clavulanate", dosage_form: "tablet or injection" },
      { pattern: /\blasix\b/i, generic_name: "furosemide", normalized_display: "furosemide", dosage_form: "tablet or injection" },
      { pattern: /\bmannitol\b/i, generic_name: "mannitol", normalized_display: "mannitol", dosage_form: "injection or infusion" },
      { pattern: /\bstator\b/i, generic_name: "atorvastatin", normalized_display: "atorvastatin", dosage_form: "tablet" },
      { pattern: /\btelvas\s*beta\b/i, generic_name: "telmisartan + metoprolol", normalized_display: "telmisartan + metoprolol", dosage_form: "tablet" },
      { pattern: /\bzofer\b/i, generic_name: "ondansetron", normalized_display: "ondansetron", dosage_form: "tablet or injection" },
      { pattern: /\blevera\b|\blevipil\b/i, generic_name: "levetiracetam", normalized_display: "levetiracetam", dosage_form: "tablet or injection" },
      { pattern: /\bdecmax\b/i, generic_name: "dexamethasone", normalized_display: "dexamethasone", dosage_form: "injection" },
      { pattern: /\bmedi\s*set\b|\bmediset\b/i, generic_name: "ondansetron", normalized_display: "ondansetron", dosage_form: "injection" },
      { pattern: /\bactrapid\b/i, generic_name: "human insulin regular", normalized_display: "regular human insulin", dosage_form: "injection" },
      { pattern: /\bparacetamol\b/i, generic_name: "paracetamol", normalized_display: "paracetamol", dosage_form: "tablet or syrup or injection" },
      { pattern: /\boptineron\b|\boptineuron\b/i, generic_name: "", normalized_display: "Optineuron", dosage_form: "injection" },
      { pattern: /\bdapagliflozin\b|\bdapagliflozolin\b/i, generic_name: "dapagliflozin", normalized_display: "dapagliflozin", dosage_form: "tablet" },
      { pattern: /\bcilacar\s*m\b|\bt\.?\s*cilacar\s*m\b/i, generic_name: "", normalized_display: "CILACAR M", dosage_form: "tablet" },
    ];
  }

  extractStrength(text = "") {
    const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*(mcg|mg|ml|g)\b/i);
    return match ? `${match[1]} ${match[2].toLowerCase()}` : "";
  }

  medicationCandidates(internalEvidence = []) {
    return (Array.isArray(internalEvidence) ? internalEvidence : [])
      .filter((item) => String(item.section || "").toLowerCase() === "medications")
      .slice(0, 8)
      .map((item) => String(item.value || item.label || "").trim())
      .filter(Boolean);
  }

  aliasFallback(message = "", internalEvidence = []) {
    const text = `${String(message || "")}\n${this.medicationCandidates(internalEvidence).join("\n")}`;
    for (const alias of this.aliases) {
      if (alias.pattern.test(text)) {
        return {
          primary_mention: text.match(alias.pattern)?.[0] || "",
          normalized_display: alias.normalized_display,
          generic_name: alias.generic_name,
          ingredient_list: alias.generic_name ? alias.generic_name.split("+").map((v) => v.trim()).filter(Boolean) : [],
          dosage_form: alias.dosage_form || "",
          strength: this.extractStrength(text),
          matched_internal_value: this.medicationCandidates(internalEvidence).find((item) => alias.pattern.test(item)) || "",
          confidence: alias.generic_name ? 0.8 : 0.5,
        };
      }
    }
    return null;
  }

  normalizeText(value = "") {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  similarity(a = "", b = "") {
    const aTerms = new Set(this.normalizeText(a).split(/\s+/).filter(Boolean));
    const bTerms = new Set(this.normalizeText(b).split(/\s+/).filter(Boolean));
    if (!aTerms.size || !bTerms.size) return 0;
    let overlap = 0;
    for (const term of aTerms) {
      if (bTerms.has(term)) overlap += 1;
    }
    return overlap / Math.max(aTerms.size, bTerms.size);
  }

  buildMessages(message = "", internalEvidence = []) {
    const candidates = this.medicationCandidates(internalEvidence);
    const schema = `{
  "primary_mention": string,
  "normalized_display": string,
  "generic_name": string,
  "ingredient_list": string[],
  "dosage_form": string,
  "strength": string,
  "matched_internal_value": string,
  "confidence": number
}`;

    return [
      {
        role: "system",
        content: `You resolve medication entities for a doctor dashboard.

Return JSON only. No prose.

Use this schema:
${schema}

Rules:
- Resolve the drug mentioned in the user question.
- Use the internal medication list when possible.
- Prefer a generic/ingredient name if known.
- If the exact generic name is uncertain, keep normalized_display to the best product string and leave generic_name empty.
- Do not invent unsupported strengths or dosage forms.

Examples:
Question: "What does PAN 40 do?"
Medications: ["Tab Pan 40 mg SOS on empty stomach for gastritis"]
Output: {"primary_mention":"PAN 40","normalized_display":"pantoprazole 40 mg","generic_name":"pantoprazole","ingredient_list":["pantoprazole"],"dosage_form":"tablet","strength":"40 mg","matched_internal_value":"Tab Pan 40 mg SOS on empty stomach for gastritis","confidence":0.93}

Question: "augmentin 1.2gm is used for what purpose?"
Medications: ["inj augmentin 1.2gm"]
Output: {"primary_mention":"augmentin 1.2gm","normalized_display":"amoxicillin + clavulanate 1.2 g","generic_name":"amoxicillin + clavulanate","ingredient_list":["amoxicillin","clavulanate"],"dosage_form":"injection","strength":"1.2 g","matched_internal_value":"inj augmentin 1.2gm","confidence":0.93}

Question: "What is the composition for INJ LASIX?"
Medications: ["INJ LASIX (20MG) - IV TDS"]
Output: {"primary_mention":"INJ LASIX","normalized_display":"furosemide injection","generic_name":"furosemide","ingredient_list":["furosemide"],"dosage_form":"injection","strength":"20 mg","matched_internal_value":"INJ LASIX (20MG) - IV TDS","confidence":0.95}

Question: "What does Thyronorm do?"
Medications: ["THYRONORM 100MCG 1-0-0"]
Output: {"primary_mention":"Thyronorm","normalized_display":"levothyroxine 100 mcg","generic_name":"levothyroxine","ingredient_list":["levothyroxine"],"dosage_form":"tablet","strength":"100 mcg","matched_internal_value":"THYRONORM 100MCG 1-0-0","confidence":0.92}`,
      },
      {
        role: "user",
        content: `Question: ${String(message || "").trim()}
Medications: ${JSON.stringify(candidates)}`,
      },
    ];
  }

  extractJson(content = "") {
    const text = String(content || "").trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {}
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
    return null;
  }

  sanitize(raw = {}, fallback = null) {
    const base = fallback || {};
    return {
      primary_mention: String(raw.primary_mention || base.primary_mention || "").trim(),
      normalized_display: String(raw.normalized_display || base.normalized_display || "").trim(),
      generic_name: String(raw.generic_name || base.generic_name || "").trim(),
      ingredient_list: Array.isArray(raw.ingredient_list)
        ? raw.ingredient_list.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
        : Array.isArray(base.ingredient_list)
        ? base.ingredient_list
        : [],
      dosage_form: String(raw.dosage_form || base.dosage_form || "").trim(),
      strength: String(raw.strength || base.strength || "").trim(),
      matched_internal_value: String(raw.matched_internal_value || base.matched_internal_value || "").trim(),
      confidence: typeof raw.confidence === "number" ? raw.confidence : typeof base.confidence === "number" ? base.confidence : 0.5,
    };
  }

  async resolve(message = "", internalEvidence = []) {
    let fallback = this.aliasFallback(message, internalEvidence) || {
      primary_mention: "",
      normalized_display: "",
      generic_name: "",
      ingredient_list: [],
      dosage_form: "",
      strength: this.extractStrength(message),
      matched_internal_value: "",
      confidence: 0.3,
    };

    if (!fallback.generic_name) {
      const candidates = this.medicationCandidates(internalEvidence);
      let bestAlias = null;
      let bestScore = 0;
      for (const alias of this.aliases) {
        for (const candidate of candidates) {
          const score = this.similarity(candidate, alias.normalized_display || alias.generic_name || "");
          if (score > bestScore) {
            bestScore = score;
            bestAlias = { alias, candidate };
          }
        }
      }
      if (bestAlias && bestScore >= 0.5) {
        fallback = {
          primary_mention: bestAlias.candidate,
          normalized_display: bestAlias.alias.normalized_display,
          generic_name: bestAlias.alias.generic_name,
          ingredient_list: bestAlias.alias.generic_name ? bestAlias.alias.generic_name.split("+").map((v) => v.trim()).filter(Boolean) : [],
          dosage_form: bestAlias.alias.dosage_form || "",
          strength: this.extractStrength(bestAlias.candidate) || fallback.strength,
          matched_internal_value: bestAlias.candidate,
          confidence: Math.max(0.55, bestScore),
        };
      }
    }

    const result = await this.gemmaClient.executeChat(this.buildMessages(message, internalEvidence), {
      temperature: 0.0,
      maxTokens: 250,
    });

    if (!result.success) return this.sanitize({}, fallback);
    const parsed = this.extractJson(result.content);
    return parsed ? this.sanitize(parsed, fallback) : this.sanitize({}, fallback);
  }
}

module.exports = DrugEntityResolverTool;
