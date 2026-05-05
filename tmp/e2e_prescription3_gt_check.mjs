import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const UI_URL = "http://127.0.0.1:8081/";
const API_BASE = "http://127.0.0.1:8001/api";
const GT_CSV_PATH = path.resolve("ground_truth/manual_review/prescription_01_06_ground_truth.csv");
const JSON_REPORT_PATH = path.resolve("tmp/prescriptions_ui_gt_evaluation.json");
const MD_REPORT_PATH = path.resolve("tmp/prescriptions_ui_gt_evaluation.md");
const TARGET_FILES = [
  "Prescription_01.pdf",
  "Prescription_02.pdf",
  "Prescription_03.pdf",
  "Prescription_04.pdf",
  "Prescription_05.pdf",
  "Prescription_06.pdf",
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "were", "was", "are", "has", "had", "have",
  "not", "nil", "none", "page", "noted", "note", "form", "past", "days", "day", "year", "years",
  "patient", "visit", "review", "line", "present", "written", "clearly", "legible", "explicit", "page1",
  "page", "history", "appears", "reads", "should", "treated", "uncertain", "return", "noted", "only",
  "today", "other", "all", "to", "be", "as", "of", "on", "in", "or", "x"
]);

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

async function loadGroundTruth() {
  const csv = await fs.readFile(GT_CSV_PATH, "utf8");
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  }).filter((row) => TARGET_FILES.includes(row.file_name));
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
}

function splitWords(value) {
  return normalize(value)
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function textMatches(haystack, expected) {
  const hay = normalize(haystack);
  const exp = normalize(expected);
  if (!exp) return true;
  if (hay.includes(exp)) return true;

  const expectedWords = splitWords(expected);
  if (expectedWords.length === 0) return true;
  const hayWords = new Set(splitWords(haystack));
  const matchedWords = expectedWords.filter((word) => hayWords.has(word)).length;
  return matchedWords / expectedWords.length >= 0.7;
}

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).join(" | ");
  if (typeof value === "object") return Object.values(value).map(asText).join(" | ");
  return "";
}

function collectActual(document) {
  const result = document?.result || {};
  const extracted = result.extracted_data || {};
  const sample = result.sample_patient_data || {};
  const meta = result.meta || {};
  const dashboardCards = result.dashboard_cards || {};
  const presentation = result.presentation || {};

  return {
    status: document?.status || "",
    documentId: document?.id || "",
    patientName: sample.name || extracted.patient?.name || "",
    hospitalNo: sample.mrn || extracted.patient?.mrn || "",
    age: sample.age ?? extracted.patient?.age ?? "",
    gender: extracted.patient?.gender || "",
    department: extracted.doctor?.department || meta.department || "",
    consultantName: extracted.doctor?.name || "",
    registrationNo: extracted.doctor?.registration_number || extracted.doctor?.registration_no || "",
    visitDate: extracted.doctor?.date || meta.rx_date || "",
    vitals: extracted.vitals || {},
    medications: Array.isArray(extracted.medications) ? extracted.medications : [],
    diagnosis: extracted.diagnosis || {},
    labs: extracted.labs || extracted.lab_investigations || extracted.investigations || extracted.lab_results || [],
    radiology: extracted.radiology || extracted.radiology_selections || [],
    procedures: extracted.procedures || [],
    followUp: extracted.follow_up || {},
    notes: Array.isArray(extracted.notes) ? extracted.notes : Array.isArray(extracted.clinical_notes) ? extracted.clinical_notes : [],
    dashboardCards,
    presentation,
    fullResultText: JSON.stringify(result),
  };
}

function splitGtItems(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^no explicit/i.test(item))
    .filter((item) => !/^no clearly/i.test(item))
    .filter((item) => !/^none\b/i.test(item))
    .filter((item) => !/^page-?1/i.test(item))
    .filter((item) => !/^the handwritten/i.test(item));
}

function addCheck(checks, field, expected, sourceText, actualValue, source = "structured+ui") {
  checks.push({
    field,
    expected,
    matched: textMatches(sourceText, expected),
    actualValue,
    source,
  });
}

function buildChecks(gt, actual, dashboardText) {
  const checks = [];
  const fullText = [
    actual.patientName,
    actual.hospitalNo,
    actual.age,
    actual.gender,
    actual.department,
    actual.consultantName,
    actual.registrationNo,
    actual.visitDate,
    asText(actual.vitals),
    asText(actual.medications),
    asText(actual.diagnosis),
    asText(actual.labs),
    asText(actual.radiology),
    asText(actual.procedures),
    asText(actual.followUp),
    asText(actual.notes),
    actual.fullResultText,
    dashboardText,
  ].join(" \n ");

  addCheck(checks, "status", "processed", actual.status, actual.status, "backend");
  addCheck(checks, "patient_name", gt.patient_name, fullText, actual.patientName);
  addCheck(checks, "hospital_no", gt.hospital_no, fullText, actual.hospitalNo);
  addCheck(checks, "episode_no", gt.episode_no, fullText, actual.fullResultText, "structured");
  addCheck(checks, "age", gt.age, fullText, String(actual.age));
  addCheck(checks, "gender", gt.gender, fullText, actual.gender);
  addCheck(checks, "department", gt.department, fullText, actual.department);
  addCheck(checks, "consultant_name", gt.consultant_name, fullText, actual.consultantName);
  addCheck(checks, "registration_no", gt.registration_no, fullText, actual.registrationNo);

  if (gt.bp_mm_hg) addCheck(checks, "bp", gt.bp_mm_hg, fullText, asText(actual.vitals));
  if (gt.pulse_bpm) addCheck(checks, "pulse", gt.pulse_bpm, fullText, asText(actual.vitals));
  if (gt.temperature_f) addCheck(checks, "temperature", gt.temperature_f, fullText, asText(actual.vitals));
  if (gt.spo2_percent) addCheck(checks, "spo2", gt.spo2_percent, fullText, asText(actual.vitals));
  if (gt.height_cm) addCheck(checks, "height", gt.height_cm, fullText, asText(actual.vitals));
  if (gt.weight_kg) addCheck(checks, "weight", gt.weight_kg, fullText, asText(actual.vitals));
  if (gt.pain_score) addCheck(checks, "pain_score", gt.pain_score, fullText, dashboardText, "ui");

  for (const item of splitGtItems(gt.chief_complaints_or_reason_for_visit)) {
    addCheck(checks, `complaint:${item}`, item, fullText, asText(actual.diagnosis));
  }
  for (const item of splitGtItems(gt.key_findings_or_assessment)) {
    addCheck(checks, `finding:${item}`, item, fullText, asText(actual.notes));
  }
  for (const item of splitGtItems(gt.comorbidities_or_history)) {
    addCheck(checks, `history:${item}`, item, fullText, asText(actual.diagnosis));
  }
  for (const item of splitGtItems(gt.medications_prescribed)) {
    addCheck(checks, `medication:${item}`, item, fullText, asText(actual.medications));
  }
  for (const item of splitGtItems(gt.lab_investigations)) {
    addCheck(checks, `lab:${item}`, item, fullText, asText(actual.labs));
  }
  for (const item of splitGtItems(gt.radiology_investigations)) {
    addCheck(checks, `radiology:${item}`, item, fullText, asText(actual.radiology));
  }
  for (const item of splitGtItems(gt.procedures_or_orders)) {
    addCheck(checks, `procedure:${item}`, item, fullText, `${asText(actual.procedures)} | ${asText(actual.notes)}`);
  }
  for (const item of splitGtItems(gt.follow_up_or_cross_reference)) {
    addCheck(checks, `followup:${item}`, item, fullText, `${asText(actual.followUp)} | ${asText(actual.notes)}`);
  }

  const matched = checks.filter((item) => item.matched).length;
  return {
    checks,
    summary: {
      matched,
      total: checks.length,
      failed: checks.length - matched,
      passRate: checks.length > 0 ? Number(((matched / checks.length) * 100).toFixed(1)) : 0,
    },
  };
}

function detectUiIssues(gt, dashboardText) {
  const issues = [];
  const noVitalsExpected = !gt.bp_mm_hg && !gt.pulse_bpm && !gt.temperature_f && !gt.spo2_percent;

  if (noVitalsExpected && /0 bpm|0%|0°f|0f/i.test(dashboardText)) {
    issues.push("Dashboard shows zero-placeholder vitals even though GT has no documented vitals.");
  }
  if (noVitalsExpected && /admitted|ward|stay/i.test(dashboardText)) {
    issues.push("Dashboard shows inpatient header framing for an outpatient prescription.");
  }
  if (gt.lab_investigations && /Labs\s+0\s+tests ordered/i.test(dashboardText)) {
    issues.push("Dashboard shows no labs even though GT contains lab investigations.");
  }
  if (gt.radiology_investigations && /Radiology\s+0\s+findings/i.test(dashboardText)) {
    issues.push("Dashboard shows no radiology even though GT contains imaging orders.");
  }
  if (gt.procedures_or_orders && /Treatment\s+1\s+plan items|Not documented/i.test(dashboardText)) {
    issues.push("Dashboard treatment/procedure presentation is likely incomplete versus GT procedure orders.");
  }

  return issues;
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push("# Prescription UI vs GT Evaluation");
  lines.push("");
  lines.push(`Executed: ${report.executedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| File | Status | Matched | Total | Pass % | UI issues |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: |");
  for (const item of report.results) {
    lines.push(`| ${item.fileName} | ${item.status} | ${item.summary.matched} | ${item.summary.total} | ${item.summary.passRate}% | ${item.uiIssues.length} |`);
  }
  lines.push("");
  lines.push(`Overall: ${report.aggregate.matched}/${report.aggregate.total} matched (${report.aggregate.passRate}%).`);
  lines.push("");

  for (const item of report.results) {
    lines.push(`## ${item.fileName}`);
    lines.push("");
    lines.push(`- Document ID: \`${item.documentId}\``);
    lines.push(`- Status: \`${item.status}\``);
    lines.push(`- Score: ${item.summary.matched}/${item.summary.total} (${item.summary.passRate}%)`);
    if (item.uiIssues.length > 0) {
      lines.push("- UI issues:");
      for (const issue of item.uiIssues) {
        lines.push(`  - ${issue}`);
      }
    }
    const failed = item.checks.filter((check) => !check.matched);
    if (failed.length > 0) {
      lines.push("- Misses:");
      for (const miss of failed.slice(0, 12)) {
        lines.push(`  - ${miss.field}: expected "${miss.expected}"`);
      }
    } else {
      lines.push("- Misses: none");
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const gtRows = await loadGroundTruth();
  const gtByFile = new Map(gtRows.map((row) => [row.file_name, row]));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const browserConsole = [];
  page.on("console", (message) => {
    browserConsole.push(`[${message.type()}] ${message.text()}`);
  });

  const docsResponse = await fetch(`${API_BASE}/documents`);
  if (!docsResponse.ok) {
    throw new Error(`Failed to load documents: ${docsResponse.status}`);
  }
  const docsPayload = await docsResponse.json();
  const docsByName = new Map((docsPayload.documents || []).map((item) => [item.name, item]));

  await page.goto(UI_URL, { waitUntil: "networkidle" });

  const results = [];
  for (const fileName of TARGET_FILES) {
    const gt = gtByFile.get(fileName);
    const doc = docsByName.get(fileName);
    if (!gt || !doc) {
      results.push({
        fileName,
        documentId: doc?.id || "",
        status: doc?.status || "missing",
        summary: { matched: 0, total: 0, failed: 0, passRate: 0 },
        checks: [],
        uiIssues: ["Ground truth row or processed document missing."],
      });
      continue;
    }

    await page.goto(`${UI_URL}dashboard?documentId=${doc.id}`, { waitUntil: "networkidle" });
    const dashboardText = await page.locator("body").innerText();

    const detailResponse = await fetch(`${API_BASE}/documents/${doc.id}`);
    if (!detailResponse.ok) {
      throw new Error(`Failed to fetch processed document ${doc.id}: ${detailResponse.status}`);
    }
    const detailPayload = await detailResponse.json();
    const actual = collectActual(detailPayload.document);
    const comparison = buildChecks(gt, actual, dashboardText);
    const uiIssues = detectUiIssues(gt, dashboardText);

    results.push({
      fileName,
      documentId: doc.id,
      status: doc.status,
      summary: comparison.summary,
      checks: comparison.checks,
      uiIssues,
      actual: {
        patientName: actual.patientName,
        hospitalNo: actual.hospitalNo,
        age: actual.age,
        gender: actual.gender,
      },
    });
  }

  await browser.close();

  const aggregate = results.reduce((acc, item) => {
    acc.matched += item.summary.matched;
    acc.total += item.summary.total;
    acc.uiIssues += item.uiIssues.length;
    return acc;
  }, { matched: 0, total: 0, uiIssues: 0 });
  aggregate.passRate = aggregate.total > 0 ? Number(((aggregate.matched / aggregate.total) * 100).toFixed(1)) : 0;

  const report = {
    executedAt: new Date().toISOString(),
    uiUrl: UI_URL,
    apiBase: API_BASE,
    targetFiles: TARGET_FILES,
    aggregate,
    results,
    browserConsole,
  };

  await fs.writeFile(JSON_REPORT_PATH, JSON.stringify(report, null, 2));
  await fs.writeFile(MD_REPORT_PATH, buildMarkdownReport(report));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
