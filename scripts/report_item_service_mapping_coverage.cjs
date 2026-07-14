const fs = require("fs");
const path = require("path");
const {
  DEFAULT_DATABASE_PATH,
  ItemServiceMasterLookup,
} = require("../server/item_service_master_lookup.cjs");

const repoRoot = path.join(__dirname, "..");
const defaultDocumentsPath = path.join(repoRoot, "server", "storage", "documents.json");

function parseArgs(argv) {
  const args = {
    db: DEFAULT_DATABASE_PATH,
    documents: defaultDocumentsPath,
    minScore: 0.55,
    out: null,
    includeDetails: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") args.db = argv[++index];
    else if (arg === "--documents") args.documents = argv[++index];
    else if (arg === "--min-score") args.minScore = Number(argv[++index]);
    else if (arg === "--out") args.out = argv[++index];
    else if (arg === "--details") args.includeDetails = true;
    else if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: node scripts/report_item_service_mapping_coverage.cjs [options]",
        "",
        "Options:",
        "  --db <path>          SQLite DB created by scripts/import_item_service_master.py",
        "  --documents <path>   documents.json to scan",
        "  --min-score <num>    minimum score to count as matched, default 0.55",
        "  --out <path>         write full JSON report to a file",
        "  --details            include all item-level mappings in stdout",
      ].join("\n"));
      process.exit(0);
    }
  }

  return args;
}

function emptyDomainSummary() {
  return {
    total: 0,
    matched: 0,
    unmatched: 0,
    high: 0,
    medium: 0,
    low: 0,
    coverage: 0,
  };
}

function ensureDomain(summary, domain) {
  if (!summary.byDomain[domain]) {
    summary.byDomain[domain] = emptyDomainSummary();
  }
  return summary.byDomain[domain];
}

function updateSummary(summary, mapping) {
  const domainSummary = ensureDomain(summary, mapping.domain);
  summary.total += 1;
  domainSummary.total += 1;

  if (mapping.mapping.matched) {
    summary.matched += 1;
    domainSummary.matched += 1;
    const confidence = mapping.mapping.matchConfidence;
    if (confidence === "high") {
      summary.high += 1;
      domainSummary.high += 1;
    } else if (confidence === "medium") {
      summary.medium += 1;
      domainSummary.medium += 1;
    } else {
      summary.low += 1;
      domainSummary.low += 1;
    }
    return;
  }

  summary.unmatched += 1;
  domainSummary.unmatched += 1;
}

function finalizeCoverage(summary) {
  summary.coverage = summary.total ? Number((summary.matched / summary.total).toFixed(3)) : 0;
  for (const domainSummary of Object.values(summary.byDomain)) {
    domainSummary.coverage = domainSummary.total
      ? Number((domainSummary.matched / domainSummary.total).toFixed(3))
      : 0;
  }
}

function buildExamples(results) {
  const unmatched = [];
  const lowConfidence = [];
  const highConfidence = [];

  for (const result of results) {
    const item = {
      documentId: result.documentId,
      documentName: result.documentName,
      domain: result.domain,
      sourceText: result.sourceText,
      score: result.mapping.matchScore,
      itemCode: result.mapping.match?.itemCode || null,
      itemDesc: result.mapping.match?.itemDesc || null,
      bgDesc: result.mapping.match?.bgDesc || null,
      bsgDesc: result.mapping.match?.bsgDesc || null,
    };

    if (!result.mapping.matched && unmatched.length < 20) {
      unmatched.push(item);
    } else if (result.mapping.matchConfidence === "low" && lowConfidence.length < 20) {
      lowConfidence.push(item);
    } else if (result.mapping.matchConfidence === "high" && highConfidence.length < 20) {
      highConfidence.push(item);
    }
  }

  return { highConfidence, lowConfidence, unmatched };
}

function readDocuments(documentsPath) {
  const payload = JSON.parse(fs.readFileSync(documentsPath, "utf8"));
  return Array.isArray(payload.documents) ? payload.documents : [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const lookup = new ItemServiceMasterLookup({
    databasePath: path.resolve(args.db),
    minScore: args.minScore,
  });

  if (!lookup.isAvailable()) {
    console.error(
      [
        `Item/service master DB not found at ${lookup.databasePath}.`,
        "Create it with:",
        "python3 scripts/import_item_service_master.py --source /path/to/item_service_master_active_20260702.xlsx",
      ].join("\n")
    );
    process.exit(1);
  }

  const docs = readDocuments(path.resolve(args.documents));
  const results = [];
  const summary = {
    documentsScanned: docs.length,
    total: 0,
    matched: 0,
    unmatched: 0,
    high: 0,
    medium: 0,
    low: 0,
    coverage: 0,
    byDomain: {},
  };

  for (const document of docs) {
    const documentMappings = lookup.mapDocument(document, { minScore: args.minScore });
    for (const mapping of documentMappings) {
      const result = {
        documentId: document.id || null,
        documentName: document.name || document.fileName || null,
        domain: mapping.domain,
        sourceText: mapping.sourceText,
        sourcePaths: mapping.sourcePaths,
        mapping: mapping.mapping,
      };
      updateSummary(summary, result);
      results.push(result);
    }
  }

  finalizeCoverage(summary);
  const report = {
    generatedAt: new Date().toISOString(),
    databasePath: lookup.databasePath,
    catalog: lookup.getMetadata(),
    documentsPath: path.resolve(args.documents),
    minScore: args.minScore,
    summary,
    examples: buildExamples(results),
    results,
  };

  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  }

  const stdoutReport = args.includeDetails
    ? report
    : {
        generatedAt: report.generatedAt,
        catalog: report.catalog,
        documentsPath: report.documentsPath,
        minScore: report.minScore,
        summary: report.summary,
        examples: report.examples,
        fullReportPath: args.out ? path.resolve(args.out) : null,
      };
  console.log(JSON.stringify(stdoutReport, null, 2));
  lookup.close();
}

main();
