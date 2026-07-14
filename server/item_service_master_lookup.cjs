const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_DATABASE_PATH = path.join(__dirname, "storage", "item_service_master.sqlite");

const DOMAIN_FILTERS = Object.freeze({
  medication: {
    bgDesc: ["Pharmacy"],
  },
  lab: {
    bgDesc: ["Lab Diagnostic Services", "Diagnostic Tests"],
  },
  radiology: {
    bgDesc: ["Radiology Diagnostic Services"],
  },
  nuclear_medicine: {
    bgDesc: ["Radiology Diagnostic Services", "Procedure"],
    bsgIncludes: ["NUCLEAR", "ONCOLOGY RADIATION"],
  },
  procedure: {
    bgDesc: [
      "Procedure",
      "Surgery",
      "Package",
      "Inpatient Services",
      "Emergency",
      "Physiotherapy",
      "Administration",
      "OP Package",
      "Health Check",
    ],
  },
  service: {
    category: ["Service"],
  },
  item: {
    category: ["Item"],
  },
  any: {},
});

const STOPWORDS = new Set([
  "A",
  "AN",
  "AND",
  "AS",
  "BY",
  "FOR",
  "IN",
  "OF",
  "ON",
  "OR",
  "THE",
  "TO",
  "WITH",
  "WITHOUT",
  "AFTER",
  "BEFORE",
  "DAILY",
  "DAYS",
  "DAY",
  "DOSE",
  "DURATION",
  "FREQUENCY",
  "NAME",
  "ORDERED",
  "PRESCRIBED",
  "ROUTINE",
  "STATUS",
  "STUDY",
  "TEST",
  "UNSPECIFIED",
  "UNKNOWN",
  "VALIDATE",
]);

const UNIT_STOPWORDS = new Set([
  "CAP",
  "CAPSULE",
  "GM",
  "GMS",
  "HR",
  "HRS",
  "INJ",
  "MCG",
  "MG",
  "MIN",
  "ML",
  "MM",
  "OD",
  "ORAL",
  "S",
  "SYP",
  "TAB",
  "TABLET",
  "TABLETS",
]);

const GENERIC_UNMAPPABLE = new Set([
  "ANTIBIOTIC",
  "DRUG",
  "MEDICINE",
  "MEDICATION",
  "STEROID",
]);

const ABBREVIATION_EXPANSIONS = Object.freeze({
  A1C: ["HBA1C", "GLYCATED", "HEMOGLOBIN"],
  CBC: ["COMPLETE", "BLOOD", "COUNT"],
  CXR: ["CHEST", "XRAY"],
  ECG: ["ELECTROCARDIOGRAM"],
  ECHO: ["ECHOCARDIOGRAPHY"],
  ESR: ["ERYTHROCYTE", "SEDIMENTATION"],
  FBS: ["FASTING", "BLOOD", "SUGAR"],
  HBA1C: ["A1C", "GLYCATED", "HEMOGLOBIN"],
  HRCT: ["HIGH", "RESOLUTION", "CT"],
  KFT: ["KIDNEY", "FUNCTION", "RENAL"],
  LFT: ["LIVER", "FUNCTION"],
  MRI: ["MAGNETIC", "RESONANCE"],
  PSA: ["PROSTATE", "SPECIFIC", "ANTIGEN"],
  RFT: ["RENAL", "FUNCTION"],
  RBS: ["RANDOM", "BLOOD", "SUGAR"],
  USG: ["ULTRASOUND"],
  XRAY: ["X", "RAY"],
  "2DECHO": ["ECHO", "ECHOCARDIOGRAPHY"],
});

function normalizeText(value) {
  let text = String(value || "").toUpperCase();
  text = text.replace(/&/g, " AND ");
  text = text.replace(/X[\s-]*RAY/g, "XRAY");
  text = text.replace(/2\s*D\s*ECHO/g, "2DECHO");
  text = text.replace(/\b(\d+)\s*K\b/g, (_match, amount) => String(Number(amount) * 1000));
  text = text.replace(/([A-Z])(\d)/g, "$1 $2");
  text = text.replace(/(\d)([A-Z])/g, "$1 $2");
  text = text.replace(/[^A-Z0-9]+/g, " ");
  text = text.replace(/\bHBA\s+1\s+C\b/g, "HBA1C");
  text = text.replace(/\bA\s+1\s+C\b/g, "A1C");
  text = text.replace(/\b2\s+DECHO\b/g, "2DECHO");
  return text.replace(/\s+/g, " ").trim();
}

function tokenize(value, options = {}) {
  const normalized = normalizeText(value);
  const keepUnits = Boolean(options.keepUnits);
  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length > 1 || /\d/.test(token))
    .filter((token) => !STOPWORDS.has(token))
    .filter((token) => keepUnits || !UNIT_STOPWORDS.has(token));
}

function tokenMatchesCandidate(token, candidateTokens, candidateNorm) {
  if (candidateTokens.has(token)) return true;
  return token.length >= 4 && candidateNorm.includes(token);
}

function extractNumberUnitPhrases(normalizedText) {
  const doseUnits = new Set(["MG", "MCG", "GM", "G", "ML", "IU", "UNIT", "UNITS", "MEQ"]);
  const tokens = String(normalizedText || "").split(" ").filter(Boolean);
  const phrases = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (/^\d+$/.test(tokens[index]) && doseUnits.has(tokens[index + 1])) {
      phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
    }
  }
  return phrases;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeFtsToken(token) {
  return String(token || "").replace(/[^A-Z0-9]/g, "");
}

function resolveConfidence(score) {
  if (score >= 0.85) return "high";
  if (score >= 0.7) return "medium";
  if (score >= 0.55) return "low";
  return "unmatched";
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function getTextFromValue(value, preferredFields = []) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (!value || typeof value !== "object") return "";

  const fields = [
    ...preferredFields,
    "name",
    "test_name",
    "study_name",
    "type",
    "label",
    "description",
    "text",
    "value",
    "summary",
  ];
  for (const field of unique(fields)) {
    const candidate = value[field];
    if (typeof candidate === "string" || typeof candidate === "number") {
      const text = String(candidate).trim();
      if (text) return text;
    }
  }
  return "";
}

function addCandidate(candidates, seen, domain, sourcePath, value, preferredFields = [], overrideText = null) {
  const sourceText = overrideText || getTextFromValue(value, preferredFields);
  if (!sourceText) return;
  const normalized = normalizeText(sourceText);
  if (!normalized) return;
  const key = `${domain}:${normalized}`;
  if (seen.has(key)) {
    const existing = candidates[seen.get(key)];
    existing.sourcePaths.push(sourcePath);
    return;
  }
  seen.set(key, candidates.length);
  candidates.push({
    domain,
    sourceText,
    normalizedSourceText: normalized,
    sourcePaths: [sourcePath],
    sourceValue: value,
  });
}

function buildMedicationMappingText(value) {
  const name = getTextFromValue(value, ["name", "generic_name", "drug_name", "brand_name"]);
  if (!name || !value || typeof value !== "object") return name;

  const dose = getTextFromValue(value, ["dose", "dosage", "strength"]);
  if (!dose || /^as prescribed$/i.test(dose)) return name;

  const normalizedName = normalizeText(name);
  const normalizedDose = normalizeText(dose);
  if (!normalizedDose || normalizedName.includes(normalizedDose)) return name;
  if (/^\d+\s+(TAB|TABLET|TABLETS|CAP|CAPSULE|CAPSULES|ML|DROPS?)$/.test(normalizedDose)) {
    return name;
  }
  return `${name} ${dose}`.trim();
}

function inferDiagnosticDomain(sourceText, fallbackDomain) {
  const normalized = normalizeText(sourceText);
  if (/\b(CT|HRCT|MRI|XRAY|USG|ULTRASOUND)\b/.test(normalized)) {
    return "radiology";
  }
  if (/\b(ECG|ECHO|2DECHO|ECHOCARDIOGRAPHY)\b/.test(normalized)) {
    return "procedure";
  }
  return fallbackDomain;
}

function prepareSourceTextForMapping(sourceText, domain) {
  let text = String(sourceText || "").replace(/\s+/g, " ").trim();
  if (!text || domain === "medication") return text;

  text = text.replace(/\s+\d+$/g, (match) => {
    const number = Number(match.trim());
    return Number.isInteger(number) && number >= 1 && number <= 10 ? "" : match;
  });

  return text.trim();
}

function collectExtractedItems(document) {
  const candidates = [];
  const seen = new Map();
  const result = document?.result || {};
  const cards = result.dashboard_cards || {};
  const extracted = result.extracted_data || document?.extractedData || {};

  toArray(cards.medications_card?.medication_list).forEach((item, index) => {
    const sourceText = buildMedicationMappingText(item);
    addCandidate(
      candidates,
      seen,
      "medication",
      `result.dashboard_cards.medications_card.medication_list.${index}`,
      item,
      ["name", "generic_name", "drug_name", "brand_name"],
      sourceText
    );
  });

  toArray(extracted.medications).forEach((item, index) => {
    const sourceText = buildMedicationMappingText(item);
    addCandidate(
      candidates,
      seen,
      "medication",
      `result.extracted_data.medications.${index}`,
      item,
      ["name", "generic_name", "drug_name", "brand_name"],
      sourceText
    );
  });

  const labSources = [
    ["result.dashboard_cards.labs_card.lab_results", cards.labs_card?.lab_results],
    ["result.dashboard_cards.labs_card.investigations_list", cards.labs_card?.investigations_list],
    ["result.extracted_data.lab_results", extracted.lab_results],
    ["result.extracted_data.investigations", extracted.investigations],
  ];
  for (const [basePath, items] of labSources) {
    toArray(items).forEach((item, index) => {
      const preferredFields = [
        "test_name",
        "test",
        "type",
        "name",
        "label",
      ];
      const sourceText = getTextFromValue(item, preferredFields);
      addCandidate(candidates, seen, inferDiagnosticDomain(sourceText, "lab"), `${basePath}.${index}`, item, preferredFields);
    });
  }

  const radiologySources = [
    ["result.dashboard_cards.radiology_card.radiology_list", cards.radiology_card?.radiology_list],
    ["result.extracted_data.radiology", extracted.radiology],
  ];
  for (const [basePath, items] of radiologySources) {
    toArray(items).forEach((item, index) => {
      addCandidate(candidates, seen, "radiology", `${basePath}.${index}`, item, [
        "study_name",
        "name",
        "type",
        "label",
      ]);
    });
  }

  const nuclearSources = [
    ["result.dashboard_cards.labs_card.nuclear_medicine_list", cards.labs_card?.nuclear_medicine_list],
    ["result.extracted_data.nuclear_medicine", extracted.nuclear_medicine],
    ["result.extracted_data.nuclear_medicine.selected_studies", extracted.nuclear_medicine?.selected_studies],
  ];
  for (const [basePath, items] of nuclearSources) {
    toArray(items).forEach((item, index) => {
      addCandidate(candidates, seen, "nuclear_medicine", `${basePath}.${index}`, item, [
        "study_name",
        "name",
        "type",
        "label",
      ]);
    });
  }

  const procedureSources = [
    ["result.dashboard_cards.treatment_card.management_items", cards.treatment_card?.management_items],
    ["result.extracted_data.procedures", extracted.procedures],
    ["result.extracted_data.treatment.management_items", extracted.treatment?.management_items],
  ];
  for (const [basePath, items] of procedureSources) {
    toArray(items).forEach((item, index) => {
      addCandidate(candidates, seen, "procedure", `${basePath}.${index}`, item, [
        "name",
        "type",
        "label",
        "description",
      ]);
    });
  }

  return candidates;
}

class ItemServiceMasterLookup {
  constructor(config = {}) {
    this.databasePath = config.databasePath || process.env.ITEM_SERVICE_MASTER_DB || DEFAULT_DATABASE_PATH;
    this.defaultLimit = config.defaultLimit || 8;
    this.candidateLimit = config.candidateLimit || 250;
    this.minScore = config.minScore ?? 0.55;
    this.db = null;
  }

  isAvailable() {
    return fs.existsSync(this.databasePath);
  }

  open() {
    if (this.db) return this.db;
    if (!this.isAvailable()) {
      throw new Error(
        `Item/service master DB not found at ${this.databasePath}. Run scripts/import_item_service_master.py first.`
      );
    }
    this.db = new Database(this.databasePath, { readonly: true, fileMustExist: true });
    return this.db;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  getMetadata() {
    const db = this.open();
    const rows = db.prepare("SELECT key, value FROM catalog_meta").all();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  search(sourceText, options = {}) {
    const domain = DOMAIN_FILTERS[options.domain] ? options.domain : "any";
    const limit = Math.max(1, options.limit || this.defaultLimit);
    const minScore = options.minScore ?? this.minScore;
    const mappingText = prepareSourceTextForMapping(sourceText, domain);
    const tokens = tokenize(mappingText);
    const expandedTokens = this.expandTokens(tokens);
    if (!tokens.length && !expandedTokens.length) return [];

    const candidates = this.fetchCandidates({
      tokens,
      expandedTokens,
      domain,
      candidateLimit: options.candidateLimit || this.candidateLimit,
    });

    return candidates
      .map((candidate) => ({
        ...candidate,
        score: this.scoreCandidate(mappingText, candidate, domain),
      }))
      .filter((candidate) => candidate.score >= minScore)
      .sort((a, b) =>
        b.score - a.score ||
        String(a.normalized_desc || "").length - String(b.normalized_desc || "").length ||
        String(a.item_desc).localeCompare(String(b.item_desc))
      )
      .slice(0, limit)
      .map((candidate) => this.formatMatch(candidate));
  }

  mapValue(sourceText, options = {}) {
    const domain = DOMAIN_FILTERS[options.domain] ? options.domain : "any";
    const mappingText = prepareSourceTextForMapping(sourceText, domain);
    const matches = this.search(sourceText, {
      ...options,
      limit: options.limit || 1,
    });
    const bestMatch = matches[0] || null;
    return {
      sourceText: String(sourceText || "").trim(),
      mappingText,
      normalizedSourceText: normalizeText(mappingText),
      domain,
      matched: Boolean(bestMatch),
      matchConfidence: bestMatch?.confidence || "unmatched",
      matchScore: bestMatch?.score || 0,
      match: bestMatch,
    };
  }

  mapDocument(document, options = {}) {
    const candidates = collectExtractedItems(document);
    return candidates.map((candidate) => ({
      ...candidate,
      mapping: this.mapValue(candidate.sourceText, {
        domain: candidate.domain,
        minScore: options.minScore,
      }),
    }));
  }

  expandTokens(tokens) {
    const expanded = [];
    for (const token of tokens) {
      expanded.push(token);
      if (ABBREVIATION_EXPANSIONS[token]) {
        expanded.push(...ABBREVIATION_EXPANSIONS[token]);
      }
    }
    return unique(expanded);
  }

  fetchCandidates({ tokens, expandedTokens, domain, candidateLimit }) {
    const byCode = new Map();
    const sourceNorm = tokens.join(" ");
    for (const candidate of this.fetchExactCandidates({ sourceNorm, domain, candidateLimit })) {
      byCode.set(this.candidateKey(candidate), candidate);
    }

    for (const candidate of this.fetchFtsCandidates({ tokens, domain, candidateLimit })) {
      byCode.set(this.candidateKey(candidate), candidate);
    }

    if (byCode.size < Math.min(25, candidateLimit)) {
      for (const candidate of this.fetchLikeCandidates({
        tokens: unique([...tokens, ...expandedTokens]),
        domain,
        candidateLimit,
      })) {
        byCode.set(this.candidateKey(candidate), candidate);
      }
    }

    return [...byCode.values()];
  }

  fetchExactCandidates({ sourceNorm, domain, candidateLimit }) {
    if (!sourceNorm) return [];
    const db = this.open();
    const domainWhere = this.buildDomainWhere(domain, "m");
    const sql = `
      SELECT
        m.item_code,
        m.item_desc,
        m.bg_code,
        m.bg_desc,
        m.bsg_code,
        m.bsg_desc,
        m.active_date_to,
        m.category,
        m.normalized_desc
      FROM item_service_master m
      WHERE (
        m.normalized_desc = ?
        OR m.normalized_desc LIKE ?
        OR m.normalized_desc LIKE ?
      )
      ${domainWhere.sql}
      ORDER BY
        CASE
          WHEN m.normalized_desc = ? THEN 0
          WHEN m.normalized_desc LIKE ? THEN 1
          ELSE 2
        END,
        LENGTH(m.normalized_desc) ASC
      LIMIT ?
    `;
    return db.prepare(sql).all(
      sourceNorm,
      `${sourceNorm} %`,
      `% ${sourceNorm} %`,
      ...domainWhere.params,
      sourceNorm,
      `${sourceNorm} %`,
      Math.min(candidateLimit, 100)
    );
  }

  fetchFtsCandidates({ tokens, domain, candidateLimit }) {
    const db = this.open();
    const ftsTokens = unique(tokens.map(escapeFtsToken)).filter((token) => token.length > 1 || /\d/.test(token));
    if (!ftsTokens.length) return [];

    const ftsQuery = ftsTokens.slice(0, 5).map((token) => `${token}*`).join(" ");
    const domainWhere = this.buildDomainWhere(domain, "item_service_master_fts");
    const sql = `
      SELECT
        item_service_master_fts.item_code,
        item_service_master_fts.item_desc,
        item_service_master_fts.bg_code,
        item_service_master_fts.bg_desc,
        item_service_master_fts.bsg_code,
        item_service_master_fts.bsg_desc,
        item_service_master_fts.active_date_to,
        item_service_master_fts.category,
        item_service_master_fts.normalized_desc
      FROM item_service_master_fts
      WHERE item_service_master_fts MATCH ?
      ${domainWhere.sql}
      ORDER BY bm25(item_service_master_fts)
      LIMIT ?
    `;

    try {
      return db.prepare(sql).all(ftsQuery, ...domainWhere.params, candidateLimit);
    } catch (_error) {
      return [];
    }
  }

  candidateKey(candidate) {
    return [
      candidate.item_code,
      candidate.item_desc,
      candidate.bg_code,
      candidate.bsg_code,
      candidate.category,
    ].map((value) => String(value || "")).join("|");
  }

  fetchLikeCandidates({ tokens, domain, candidateLimit }) {
    const db = this.open();
    const anchorTokens = unique(tokens)
      .filter((token) => token.length > 1 || /\d/.test(token))
      .sort((a, b) => b.length - a.length)
      .slice(0, 6);
    if (!anchorTokens.length) return [];

    const likeWhere = anchorTokens.map(() => "m.normalized_desc LIKE ?").join(" OR ");
    const domainWhere = this.buildDomainWhere(domain, "m");
    const sql = `
      SELECT
        m.item_code,
        m.item_desc,
        m.bg_code,
        m.bg_desc,
        m.bsg_code,
        m.bsg_desc,
        m.active_date_to,
        m.category,
        m.normalized_desc
      FROM item_service_master m
      WHERE (${likeWhere})
      ${domainWhere.sql}
      LIMIT ?
    `;
    const params = [
      ...anchorTokens.map((token) => `%${token}%`),
      ...domainWhere.params,
      candidateLimit,
    ];
    return db.prepare(sql).all(...params);
  }

  buildDomainWhere(domain, alias) {
    const filter = DOMAIN_FILTERS[domain] || DOMAIN_FILTERS.any;
    const conditions = [];
    const params = [];

    if (filter.bgDesc?.length) {
      conditions.push(`${alias}.bg_desc IN (${filter.bgDesc.map(() => "?").join(", ")})`);
      params.push(...filter.bgDesc);
    }
    if (filter.category?.length) {
      conditions.push(`${alias}.category IN (${filter.category.map(() => "?").join(", ")})`);
      params.push(...filter.category);
    }
    if (filter.bsgIncludes?.length) {
      conditions.push(`(${filter.bsgIncludes.map(() => `UPPER(${alias}.bsg_desc) LIKE ?`).join(" OR ")})`);
      params.push(...filter.bsgIncludes.map((value) => `%${value}%`));
    }

    return {
      sql: conditions.length ? `AND ${conditions.join(" AND ")}` : "",
      params,
    };
  }

  scoreCandidate(sourceText, candidate, domain) {
    const sourceNorm = normalizeText(sourceText);
    const candidateNorm = candidate.normalized_desc || normalizeText(candidate.item_desc);
    const sourceTokens = tokenize(sourceNorm);
    const expandedTokens = this.expandTokens(sourceTokens);
    if (!sourceTokens.length) return 0;

    const candidateTokens = new Set(tokenize(candidateNorm, { keepUnits: true }));
    const directMatches = sourceTokens.filter((token) => tokenMatchesCandidate(token, candidateTokens, candidateNorm));
    const expansionSourceMatches = sourceTokens.filter((token) =>
      (ABBREVIATION_EXPANSIONS[token] || []).some(
        (expandedToken) => tokenMatchesCandidate(expandedToken, candidateTokens, candidateNorm)
      )
    );
    const prefixMatches = sourceTokens.filter((token) =>
      [...candidateTokens].some((candidateToken) => candidateToken.startsWith(token) || token.startsWith(candidateToken))
    );
    const expandedMatches = expandedTokens.filter((token) => tokenMatchesCandidate(token, candidateTokens, candidateNorm));

    const coverage = directMatches.length / sourceTokens.length;
    const expansionSourceCoverage = expansionSourceMatches.length / sourceTokens.length;
    const effectiveCoverage = Math.max(coverage, expansionSourceCoverage * 0.9);
    const prefixCoverage = prefixMatches.length / sourceTokens.length;
    const expansionCoverage = Math.min(expandedMatches.length / Math.max(expandedTokens.length, 1), 1);
    const phraseBonus = candidateNorm.includes(sourceNorm) ? 0.18 : 0;
    const startsWithBonus = candidateNorm.startsWith(sourceNorm) ? 0.08 : 0;
    const domainBonus = this.domainFits(domain, candidate) ? 0.08 : 0;

    let score = effectiveCoverage * 0.62 + prefixCoverage * 0.16 + expansionCoverage * 0.08 + phraseBonus + startsWithBonus + domainBonus;
    if (expansionSourceCoverage === 1 && coverage < 1) {
      score += 0.08;
    }

    if (candidateNorm === sourceNorm) score = 1;
    if (candidateNorm.startsWith(sourceNorm)) score = Math.max(score, 0.9);
    if (candidateNorm.includes(sourceNorm)) score = Math.max(score, 0.84);

    const sourceNumbers = sourceTokens.filter((token) => /^\d+$/.test(token));
    if (sourceNumbers.length) {
      const matchedNumbers = sourceNumbers.filter((token) => candidateTokens.has(token));
      if (matchedNumbers.length === sourceNumbers.length) {
        score += 0.06;
      } else {
        score -= 0.22;
      }
    }

    const sourceDosePhrases = extractNumberUnitPhrases(sourceNorm);
    if (sourceDosePhrases.length) {
      const matchedDosePhrases = sourceDosePhrases.filter((phrase) => candidateNorm.includes(phrase));
      if (matchedDosePhrases.length === sourceDosePhrases.length) {
        score += 0.1;
      } else {
        score -= 0.35;
      }
    }

    if (sourceTokens.some((token) => GENERIC_UNMAPPABLE.has(token)) && sourceTokens.length <= 3) {
      score = Math.min(score, 0.42);
    }

    const sourceAlphaTokens = sourceTokens.filter((token) => /[A-Z]/.test(token));
    const alphaMatches = sourceAlphaTokens.filter((token) =>
      tokenMatchesCandidate(token, candidateTokens, candidateNorm) ||
      (ABBREVIATION_EXPANSIONS[token] || []).some((expandedToken) =>
        tokenMatchesCandidate(expandedToken, candidateTokens, candidateNorm)
      )
    );
    if (sourceAlphaTokens.length && alphaMatches.length === 0) {
      score = Math.min(score, 0.45);
    }

    if (
      sourceTokens.length === 1 &&
      /^[A-Z]+$/.test(sourceTokens[0]) &&
      candidateNorm !== sourceNorm &&
      !candidateTokens.has(sourceTokens[0])
    ) {
      score = Math.min(score, 0.68);
    }

    return Number(Math.max(0, Math.min(score, 0.99)).toFixed(3));
  }

  domainFits(domain, candidate) {
    const filter = DOMAIN_FILTERS[domain] || DOMAIN_FILTERS.any;
    if (filter.bgDesc?.length && !filter.bgDesc.includes(candidate.bg_desc)) return false;
    if (filter.category?.length && !filter.category.includes(candidate.category)) return false;
    if (filter.bsgIncludes?.length) {
      const bsg = String(candidate.bsg_desc || "").toUpperCase();
      return filter.bsgIncludes.some((value) => bsg.includes(value));
    }
    return true;
  }

  formatMatch(candidate) {
    return {
      itemCode: String(candidate.item_code),
      itemDesc: candidate.item_desc,
      bgCode: candidate.bg_code,
      bgDesc: candidate.bg_desc,
      bsgCode: candidate.bsg_code,
      bsgDesc: candidate.bsg_desc,
      activeDateTo: candidate.active_date_to,
      category: candidate.category,
      score: candidate.score,
      confidence: resolveConfidence(candidate.score),
    };
  }
}

module.exports = {
  DEFAULT_DATABASE_PATH,
  DOMAIN_FILTERS,
  ItemServiceMasterLookup,
  buildMedicationMappingText,
  collectExtractedItems,
  normalizeText,
  tokenize,
};
