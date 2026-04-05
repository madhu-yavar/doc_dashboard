class MedicalWebSearchTool {
  constructor(config = {}) {
    this.name = "Medical Web Search";
    this.version = "1.0.0";
    this.config = { timeout: 15000, ...config };
  }

  async fetchJson(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`External search failed (${response.status})`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  encode(query) {
    return encodeURIComponent(String(query || "").trim());
  }

  extractMedicationSearchTerm(query = "") {
    const cleaned = String(query || "")
      .replace(/[^\w\s/%.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const stopwords = new Set([
      "does",
      "it",
      "this",
      "come",
      "in",
      "well",
      "as",
      "the",
      "market",
      "available",
      "availability",
      "what",
      "is",
      "are",
      "for",
      "of",
      "a",
      "an",
      "also",
      "ml",
      "mg",
      "vial",
      "tablet",
      "tablets",
      "syrup",
      "injection",
      "formulation",
      "strength",
      "pack",
      "size",
      "does",
      "drug",
      "medicine",
      "medication",
      "marketed",
      "with",
      "inj",
      "iv",
      "im",
      "po",
      "od",
      "bd",
      "tds",
      "sos",
      "amp",
      "ampoule",
      "capsule",
      "capsules",
      "tab",
      "tabs",
      "cap",
      "caps",
    ]);

    const tokens = cleaned
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => !/^\d+(\.\d+)?\s*(mg|ml|mcg|g)?$/i.test(token))
      .filter((token) => !/^\d+(\.\d+)?(mg|ml|mcg|g)$/i.test(token))
      .filter((token) => !stopwords.has(token.toLowerCase()))
      .slice(0, 4);

    return tokens.join(" ").trim() || cleaned;
  }

  buildDrugQueries(query = "") {
    const term = this.extractMedicationSearchTerm(query);
    if (!term) return [];

    const base = term.replace(/\bwith\b/gi, "").replace(/\s+/g, " ").trim();
    const variants = new Set([base]);

    const strengthMatch = String(query || "").match(/(\d+(?:\.\d+)?)\s*(mg|ml|mcg|g)\b/i);
    if (strengthMatch) {
      variants.add(`${base} ${strengthMatch[1]} ${strengthMatch[2]}`);
      variants.add(`${base} ${strengthMatch[1]}${strengthMatch[2]}`);
    }

    return Array.from(variants).filter(Boolean);
  }

  async searchIcd(query) {
    const url = `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?sf=code,name&terms=${this.encode(query)}&maxList=3`;
    const payload = await this.fetchJson(url);
    const results = Array.isArray(payload?.[3]) ? payload[3] : [];
    return results.map((row) => ({
      value: `${row[0]} ${row[1]}`,
      title: row[1],
      snippet: `ICD-10-CM code ${row[0]}: ${row[1]}`,
      source_section: "NLM ICD-10-CM",
      url: `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?terms=${this.encode(query)}`,
      retrieved_at: new Date().toISOString(),
      confidence: 0.82,
      label: `[NLM ICD-10-CM: ${row[0]}]`,
    }));
  }

  async searchOpenFda(query) {
    const queries = this.buildDrugQueries(query);
    const results = [];

    for (const drug of queries) {
      const searchExpr = [
        `openfda.brand_name:"${drug}"`,
        `openfda.generic_name:"${drug}"`,
        `openfda.substance_name:"${drug}"`,
      ].join("+OR+");
      const url = `https://api.fda.gov/drug/label.json?search=${searchExpr}&limit=2`;

      try {
        const payload = await this.fetchJson(url);
        results.push(
          ...(payload.results || []).map((item) => ({
            value: item.openfda?.generic_name?.[0] || drug,
            title: item.openfda?.brand_name?.[0] || item.openfda?.generic_name?.[0] || drug,
            snippet:
              item.description?.[0] ||
              item.dosage_and_administration?.[0] ||
              item.indications_and_usage?.[0] ||
              item.warnings?.[0] ||
              "FDA label data retrieved.",
            source_section: "FDA Drug Label",
            url:
              item.openfda?.spl_set_id?.[0]
                ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${item.openfda.spl_set_id[0]}`
                : url,
            raw_url: url,
            retrieved_at: new Date().toISOString(),
            confidence: 0.8,
            label: `[FDA: ${item.openfda?.brand_name?.[0] || drug}]`,
          }))
        );
        if (results.length) break;
      } catch (error) {
        if (queries.length === 1) throw error;
      }
    }

    return results;
  }

  async searchPubMed(query) {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=3&term=${this.encode(query)}`;
    const searchPayload = await this.fetchJson(searchUrl);
    const ids = searchPayload?.esearchresult?.idlist || [];
    if (!ids.length) return [];

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`;
    const summaryPayload = await this.fetchJson(summaryUrl);

    return ids
      .map((id) => {
        const item = summaryPayload?.result?.[id];
        if (!item) return null;
        return {
          value: item.title || `PMID ${id}`,
          title: item.title || `PMID ${id}`,
          snippet: `${item.fulljournalname || "PubMed"}${item.pubdate ? `, ${item.pubdate}` : ""}`,
          source_section: "PubMed",
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          retrieved_at: new Date().toISOString(),
          confidence: 0.78,
          label: `[PubMed: ${id}]`,
        };
      })
      .filter(Boolean);
  }

  async searchClinicalTrials(query) {
    const url = `https://clinicaltrials.gov/api/query/study_fields?expr=${this.encode(query)}&fields=NCTId,BriefTitle,Condition&min_rnk=1&max_rnk=3&fmt=json`;
    const payload = await this.fetchJson(url);
    const studies = payload?.StudyFieldsResponse?.StudyFields || [];
    return studies.map((item) => ({
      value: item.BriefTitle?.[0] || item.NCTId?.[0] || "Clinical trial",
      title: item.BriefTitle?.[0] || item.NCTId?.[0] || "Clinical trial",
      snippet: `${item.Condition?.[0] || ""}`.trim(),
      source_section: "ClinicalTrials.gov",
      url: item.NCTId?.[0] ? `https://clinicaltrials.gov/study/${item.NCTId[0]}` : "https://clinicaltrials.gov/",
      retrieved_at: new Date().toISOString(),
      confidence: 0.72,
      label: `[ClinicalTrials: ${item.NCTId?.[0] || "Study"}]`,
    }));
  }

  async search({ query, intent }) {
    if (!query) return [];

    if (intent === "diagnosis_code") return this.searchIcd(query);
    if (intent === "drug_safety") {
      const [fda, pubmed] = await Promise.allSettled([this.searchOpenFda(query), this.searchPubMed(query)]);
      return [
        ...(fda.status === "fulfilled" ? fda.value : []),
        ...(pubmed.status === "fulfilled" ? pubmed.value : []),
      ];
    }
    if (intent === "literature_query" || intent === "guideline_query") return this.searchPubMed(query);
    if (/trial/i.test(query)) return this.searchClinicalTrials(query);

    const [pubmed, fda] = await Promise.allSettled([this.searchPubMed(query), this.searchOpenFda(query)]);
    return [
      ...(pubmed.status === "fulfilled" ? pubmed.value : []),
      ...(fda.status === "fulfilled" ? fda.value : []),
    ];
  }
}

module.exports = MedicalWebSearchTool;
