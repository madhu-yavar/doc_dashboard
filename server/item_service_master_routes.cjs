const crypto = require("crypto");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const {
  DEFAULT_DATABASE_PATH,
  ItemServiceMasterLookup,
} = require("./item_service_master_lookup.cjs");

const ALLOWED_EXTENSIONS = new Set([".xlsx"]);
const STATUS_FILE_NAME = "item_service_master_import_status.json";
const REPORT_FILE_NAME = "item_service_mapping_report.json";

function sanitizeFileName(value) {
  return String(value || "item_service_master.xlsx")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "item_service_master.xlsx";
}

function nowIso() {
  return new Date().toISOString();
}

async function readJsonFile(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (_error) {
    return fallback;
  }
}

async function writeJsonFile(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function getCatalogMetadata(databasePath) {
  const lookup = new ItemServiceMasterLookup({ databasePath });
  if (!lookup.isAvailable()) {
    return {
      available: false,
      databasePath,
      metadata: null,
    };
  }

  try {
    const metadata = lookup.getMetadata();
    return {
      available: true,
      databasePath,
      metadata,
    };
  } finally {
    lookup.close();
  }
}

function buildCoverageReport(documents, databasePath, minScore = 0.55) {
  const lookup = new ItemServiceMasterLookup({ databasePath, minScore });
  const report = {
    generatedAt: nowIso(),
    catalog: lookup.getMetadata(),
    minScore,
    summary: {
      documentsScanned: documents.length,
      total: 0,
      matched: 0,
      unmatched: 0,
      high: 0,
      medium: 0,
      low: 0,
      coverage: 0,
      byDomain: {},
    },
    examples: {
      highConfidence: [],
      lowConfidence: [],
      unmatched: [],
    },
  };

  const ensureDomain = (domain) => {
    if (!report.summary.byDomain[domain]) {
      report.summary.byDomain[domain] = {
        total: 0,
        matched: 0,
        unmatched: 0,
        high: 0,
        medium: 0,
        low: 0,
        coverage: 0,
      };
    }
    return report.summary.byDomain[domain];
  };

  const recordExample = (bucket, result) => {
    if (report.examples[bucket].length >= 20) return;
    report.examples[bucket].push({
      documentId: result.documentId,
      documentName: result.documentName,
      domain: result.domain,
      sourceText: result.sourceText,
      score: result.mapping.matchScore,
      itemCode: result.mapping.match?.itemCode || null,
      itemDesc: result.mapping.match?.itemDesc || null,
      bgDesc: result.mapping.match?.bgDesc || null,
      bsgDesc: result.mapping.match?.bsgDesc || null,
    });
  };

  try {
    for (const document of documents) {
      const mappings = lookup.mapDocument(document, { minScore });
      for (const mapping of mappings) {
        const domainSummary = ensureDomain(mapping.domain);
        const result = {
          documentId: document.id || null,
          documentName: document.name || document.fileName || null,
          domain: mapping.domain,
          sourceText: mapping.sourceText,
          mapping: mapping.mapping,
        };

        report.summary.total += 1;
        domainSummary.total += 1;

        if (mapping.mapping.matched) {
          report.summary.matched += 1;
          domainSummary.matched += 1;
          const confidence = mapping.mapping.matchConfidence;
          if (confidence === "high") {
            report.summary.high += 1;
            domainSummary.high += 1;
            recordExample("highConfidence", result);
          } else if (confidence === "medium") {
            report.summary.medium += 1;
            domainSummary.medium += 1;
          } else {
            report.summary.low += 1;
            domainSummary.low += 1;
            recordExample("lowConfidence", result);
          }
        } else {
          report.summary.unmatched += 1;
          domainSummary.unmatched += 1;
          recordExample("unmatched", result);
        }
      }
    }
  } finally {
    lookup.close();
  }

  report.summary.coverage = report.summary.total
    ? Number((report.summary.matched / report.summary.total).toFixed(3))
    : 0;
  for (const domainSummary of Object.values(report.summary.byDomain)) {
    domainSummary.coverage = domainSummary.total
      ? Number((domainSummary.matched / domainSummary.total).toFixed(3))
      : 0;
  }

  return report;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: stderr || error.message,
      });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function registerItemServiceMasterRoutes(app, config = {}) {
  const upload = config.upload;
  if (!upload) {
    throw new Error("registerItemServiceMasterRoutes requires multer upload middleware");
  }

  const repoRoot = config.repoRoot || path.join(__dirname, "..");
  const storageDir = config.storageDir || path.join(__dirname, "storage");
  const databasePath = config.databasePath || DEFAULT_DATABASE_PATH;
  const uploadDir = path.join(storageDir, "item_service_master_uploads");
  const statusPath = path.join(storageDir, STATUS_FILE_NAME);
  const reportPath = path.join(storageDir, REPORT_FILE_NAME);
  const importerPath = path.join(repoRoot, "scripts", "import_item_service_master.py");
  const pythonCommand = process.env.PYTHON || "python3";
  const readDocuments = config.readDocuments;

  if (typeof readDocuments !== "function") {
    throw new Error("registerItemServiceMasterRoutes requires readDocuments");
  }

  let activeJob = null;

  const updateStatus = async (patch) => {
    const previous = await readJsonFile(statusPath, null);
    const next = {
      ...(previous || {}),
      ...patch,
      updatedAt: nowIso(),
    };
    await writeJsonFile(statusPath, next);
    return next;
  };

  const startImportJob = async ({ filePath, originalName, uploadedBy }) => {
    const job = {
      id: crypto.randomUUID(),
      status: "importing",
      phase: "importing_catalog",
      originalName,
      sourcePath: filePath,
      uploadedBy,
      startedAt: nowIso(),
      updatedAt: nowIso(),
    };
    activeJob = job;
    await writeJsonFile(statusPath, job);

    setImmediate(async () => {
      const importResult = await runCommand(
        pythonCommand,
        [importerPath, "--source", filePath, "--db", databasePath],
        { cwd: repoRoot },
      );

      if (importResult.exitCode !== 0) {
        activeJob = null;
        await updateStatus({
          id: job.id,
          status: "failed",
          phase: "import_failed",
          completedAt: nowIso(),
          stdout: importResult.stdout.slice(-4000),
          error: importResult.stderr.slice(-4000) || "Catalog import failed",
        });
        return;
      }

      await updateStatus({
        id: job.id,
        status: "mapping",
        phase: "building_coverage_report",
        stdout: importResult.stdout.slice(-4000),
        error: null,
      });

      try {
        const documents = await readDocuments();
        const report = buildCoverageReport(documents, databasePath);
        await writeJsonFile(reportPath, report);
        activeJob = null;
        await updateStatus({
          id: job.id,
          status: "completed",
          phase: "ready",
          completedAt: nowIso(),
          catalog: getCatalogMetadata(databasePath),
          coverageSummary: report.summary,
        });
      } catch (error) {
        activeJob = null;
        await updateStatus({
          id: job.id,
          status: "failed",
          phase: "coverage_failed",
          completedAt: nowIso(),
          error: error instanceof Error ? error.message : String(error),
          catalog: getCatalogMetadata(databasePath),
        });
      }
    });

    return job;
  };

  app.get("/api/item-service-master/status", async (_req, res) => {
    const status = await readJsonFile(statusPath, null);
    const report = await readJsonFile(reportPath, null);
    res.json({
      catalog: getCatalogMetadata(databasePath),
      importJob: activeJob || status,
      coverageSummary: report?.summary || status?.coverageSummary || null,
      reportGeneratedAt: report?.generatedAt || null,
    });
  });

  app.post("/api/item-service-master/upload", upload.single("file"), async (req, res) => {
    if (activeJob) {
      return res.status(409).json({ error: "An item/service master import is already running." });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "Upload an .xlsx item/service master file." });
    }

    const extension = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return res.status(400).json({ error: "Only .xlsx item/service master files are supported." });
    }

    await fs.mkdir(uploadDir, { recursive: true });
    const savedName = `${Date.now()}-${sanitizeFileName(file.originalname)}`;
    const savedPath = path.join(uploadDir, savedName);
    await fs.writeFile(savedPath, file.buffer);

    const job = await startImportJob({
      filePath: savedPath,
      originalName: file.originalname,
      uploadedBy: {
        id: req.user?.id || null,
        username: req.user?.username || null,
        role: req.user?.role || null,
      },
    });

    return res.status(202).json({ job });
  });

  app.get("/api/item-service-master/search", async (req, res) => {
    const q = String(req.query.q || "").trim();
    const domain = String(req.query.domain || "any").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 25);

    if (!q) {
      return res.status(400).json({ error: "Query parameter q is required." });
    }

    const lookup = new ItemServiceMasterLookup({ databasePath });
    if (!lookup.isAvailable()) {
      return res.status(404).json({ error: "Item/service master has not been imported yet." });
    }

    try {
      const matches = lookup.search(q, { domain, limit });
      return res.json({ query: q, domain, matches });
    } finally {
      lookup.close();
    }
  });

  app.get("/api/item-service-master/coverage", async (_req, res) => {
    if (!fsSync.existsSync(databasePath)) {
      return res.status(404).json({ error: "Item/service master has not been imported yet." });
    }

    const documents = await readDocuments();
    const report = buildCoverageReport(documents, databasePath);
    await writeJsonFile(reportPath, report);
    return res.json(report);
  });
}

module.exports = {
  buildCoverageReport,
  registerItemServiceMasterRoutes,
};
