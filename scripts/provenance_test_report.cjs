const fs = require("fs/promises");
const path = require("path");
const DischargeExtractorAgent = require("../agents/discharge_extractor_agent.cjs");

const GEMMA_URL = process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
const MODEL = process.env.GEMMA_MODEL || "google/gemma-4-31B-it";
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "../data");
const DEFAULT_FILES = [
  "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
  "Custom.MEXX.Report.ZEN.DischargeSummary9.cls.pdf",
  "Custom.MEXX.Report.ZEN.DischargeSummary5.cls.pdf",
];

const requestedFiles = process.argv.slice(2);
const files = requestedFiles.length ? requestedFiles : DEFAULT_FILES;

const fallbackPattern = /(generated|derived from|validate against|source document|not documented|unknown)$/i;

function isSafeItem(item, allowedTypes) {
  if (!item || typeof item !== "object") return false;
  const value = String(item.value || "").trim();
  const sourceExcerpt = String(item.source_excerpt || "").trim();
  const type = String(item.provenance_type || "").trim();
  if (!value || !sourceExcerpt) return false;
  if (!allowedTypes.includes(type)) return false;
  if (fallbackPattern.test(value) || fallbackPattern.test(sourceExcerpt)) return false;
  return true;
}

function summarizeItems(items, allowedTypes) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const safe = list.filter((item) => isSafeItem(item, allowedTypes));
  return {
    total: list.length,
    safe: safe.length,
    dropped: list.length - safe.length,
    sample: safe.slice(0, 2).map((item) => ({
      value: item.value,
      source_section: item.source_section,
      source_page: item.source_page,
      provenance_type: item.provenance_type,
    })),
  };
}

function summarizeSingle(item, allowedTypes) {
  if (!item) return { present: false, safe: false, item: null };
  return {
    present: true,
    safe: isSafeItem(item, allowedTypes),
    item: {
      value: item.value,
      source_section: item.source_section,
      source_page: item.source_page,
      provenance_type: item.provenance_type,
      has_excerpt: Boolean(String(item.source_excerpt || "").trim()),
    },
  };
}

async function testFile(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  await fs.access(filePath);
  const agent = new DischargeExtractorAgent({
    gemma: {
      baseUrl: GEMMA_URL,
      model: MODEL,
      timeout: 180000,
    },
  });
  const payload = await agent.process(filePath, { pdfName: fileName });
  const extracted = payload.data || {};
  const provenance = extracted.provenance || {};

  const summary = {
    file: fileName,
    success: Boolean(payload.success),
    validation: payload.validation?.confidence_level || null,
    sections: {
      vitals: {
        systolic: summarizeSingle(provenance.vitals?.systolic, ["quoted", "normalized"]),
        diastolic: summarizeSingle(provenance.vitals?.diastolic, ["quoted", "normalized"]),
        pulse: summarizeSingle(provenance.vitals?.pulse, ["quoted", "normalized"]),
        spo2: summarizeSingle(provenance.vitals?.spo2, ["quoted", "normalized"]),
        temperature: summarizeSingle(provenance.vitals?.temperature, ["quoted", "normalized"]),
        respiratory_rate: summarizeSingle(provenance.vitals?.respiratory_rate, ["quoted", "normalized"]),
      },
      diagnosis: {
        principal: summarizeSingle(provenance.diagnosis?.principal, ["quoted", "normalized"]),
        secondary: summarizeItems(provenance.diagnosis?.secondary, ["quoted", "normalized"]),
        comorbidities: summarizeItems(provenance.diagnosis?.comorbidities, ["quoted", "normalized"]),
      },
      medications: summarizeItems(provenance.medications, ["quoted", "normalized"]),
      labs: {
        results: summarizeItems(provenance.labs?.results, ["quoted", "normalized"]),
        investigations: summarizeItems(provenance.labs?.investigations, ["quoted", "normalized"]),
      },
      radiology: {
        findings: summarizeItems(provenance.radiology?.findings, ["quoted", "normalized"]),
        pending: summarizeItems(provenance.radiology?.pending, ["quoted", "normalized"]),
      },
      treatment: {
        current_approach: summarizeSingle(provenance.treatment?.current_approach, ["quoted", "normalized"]),
        management_items: summarizeItems(provenance.treatment?.management_items, ["quoted", "normalized"]),
        procedures: summarizeItems(provenance.treatment?.procedures, ["quoted", "normalized"]),
        response: summarizeSingle(provenance.treatment?.response, ["quoted", "normalized"]),
        complications: summarizeItems(provenance.treatment?.complications, ["quoted", "normalized"]),
      },
      handover: {
        overview: summarizeSingle(provenance.handover?.overview, ["derived"]),
        notes: summarizeItems(provenance.handover?.notes, ["quoted", "normalized"]),
      },
      follow_up: summarizeItems(provenance.follow_up?.items, ["quoted", "normalized"]),
      discharge: {
        dietary: summarizeItems(provenance.discharge?.dietary, ["quoted", "normalized"]),
        instructions: summarizeItems(provenance.discharge?.instructions, ["quoted", "normalized"]),
        red_flags: summarizeItems(provenance.discharge?.red_flags, ["quoted", "normalized"]),
      },
    },
  };

  return summary;
}

async function main() {
  const results = [];

  for (const file of files) {
    results.push(await testFile(file));
  }

  console.log(JSON.stringify({ gemma_url: GEMMA_URL, model: MODEL, files: results }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
