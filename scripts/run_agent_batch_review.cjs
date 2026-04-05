#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");

const ROOT = "/Users/yavar/Documents/CoE/Manipal";
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_DIR = path.join(ROOT, "agent_extraction_review");
const RAW_DIR = path.join(OUTPUT_DIR, "raw_results");
const AGENT_API_URL = process.env.AGENT_API_URL || "http://localhost:8001/api/agent/test-pdf";
const execFileAsync = promisify(execFile);

function sortPdfNames(a, b) {
  const aMatch = a.match(/DischargeSummary(\d+)/i);
  const bMatch = b.match(/DischargeSummary(\d+)/i);
  const aNum = aMatch ? Number(aMatch[1]) : Number.MAX_SAFE_INTEGER;
  const bNum = bMatch ? Number(bMatch[1]) : Number.MAX_SAFE_INTEGER;
  return aNum - bNum || a.localeCompare(b);
}

function csvEscape(value) {
  const stringValue = value == null ? "" : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

function joinArray(value, separator = " | ") {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => {
      if (item == null) {
        return "";
      }
      if (typeof item === "string") {
        return item.trim();
      }
      if (typeof item === "object") {
        return JSON.stringify(item);
      }
      return String(item);
    })
    .filter(Boolean)
    .join(separator);
}

function formatMedications(medications) {
  if (!Array.isArray(medications)) {
    return "";
  }

  return medications
    .map((medication) => {
      if (!medication || typeof medication !== "object") {
        return String(medication || "");
      }

      return [
        medication.name || "",
        medication.dose || "",
        medication.frequency || "",
      ]
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean)
    .join(" | ");
}

function formatFunctionalStatus(functionalStatus) {
  if (!functionalStatus || typeof functionalStatus !== "object") {
    return "";
  }

  return Object.entries(functionalStatus)
    .map(([key, value]) => `${key}:${value}`)
    .join(" | ");
}

function flattenResult(fileName, payload) {
  const summary = payload.summary || {};
  const extracted = payload.extractedData || {};
  const patient = extracted.patient || {};
  const vitals = extracted.vitals || {};
  const riskScores = extracted.risk_scores || {};
  const diagnosis = extracted.diagnosis || {};
  const functionalStatus = extracted.functional_status || {};
  const validation = payload.validation || {};
  const stepErrors = (payload.steps || [])
    .filter((step) => step && step.success === false)
    .map((step) => `${step.step || "unknown"}: ${step.error || "Unknown error"}`);

  return {
    file_name: fileName,
    success: payload.success === true ? "true" : "false",
    total_latency_ms: summary.totalLatency || "",
    tokens_used: summary.tokensUsed || "",
    steps_count: summary.stepsCount || "",
    successful_steps: (payload.steps || []).filter((step) => step && step.success).length,
    failed_steps: (payload.steps || []).filter((step) => step && step.success === false).length,
    confidence_level: validation.confidence_level || "",
    missing_critical_fields: joinArray(validation.missing_critical_fields),
    inconsistencies_found: joinArray(validation.inconsistencies_found),
    parser_note: extracted.parser_note || "",
    patient_name: patient.name || "",
    mrn: patient.mrn || "",
    age: patient.age ?? "",
    gender: patient.gender || "",
    admission_date: patient.admission_date || "",
    discharge_date: patient.discharge_date || "",
    principal_diagnosis: diagnosis.principal || "",
    secondary_diagnoses: joinArray(diagnosis.secondary),
    allergies: joinArray(extracted.allergies),
    medications: formatMedications(extracted.medications),
    investigations: joinArray(extracted.investigations),
    nursing_needs: joinArray(extracted.nursing_needs),
    bp_systolic: vitals.bp?.systolic ?? "",
    bp_diastolic: vitals.bp?.diastolic ?? "",
    bp_status: vitals.bp?.status || "",
    pulse: vitals.pulse?.value ?? "",
    pulse_status: vitals.pulse?.status || "",
    temperature_f: vitals.temperature?.value ?? "",
    temperature_unit: vitals.temperature?.unit || "",
    resp_rate: vitals.resp_rate ?? "",
    spo2: vitals.spo2?.value ?? "",
    spo2_status: vitals.spo2?.status || "",
    pain_score: vitals.pain_score?.value ?? "",
    grbs: vitals.grbs?.value ?? "",
    ews_score: riskScores.ews_score ?? "",
    gcs_total: riskScores.gcs?.total ?? "",
    fall_score: riskScores.fall_risk?.score ?? "",
    fall_level: riskScores.fall_risk?.level || "",
    pressure_score: riskScores.pressure_ulcer_risk?.score ?? "",
    pressure_level: riskScores.pressure_ulcer_risk?.level || "",
    dvt_score: riskScores.dvt_risk?.score ?? "",
    dvt_level: riskScores.dvt_risk?.level || "",
    aspiration_score: riskScores.aspiration_risk?.score ?? "",
    aspiration_level: riskScores.aspiration_risk?.level || "",
    overall_assistance_needs: functionalStatus.overall_assistance_needs || "",
    functional_status: formatFunctionalStatus(functionalStatus.functional_status),
    mobility_notes: functionalStatus.mobility_notes || "",
    abnormal_flags: joinArray(vitals.abnormal_flags),
    step_errors: stepErrors.join(" | "),
  };
}

function extractStepRows(fileName, payload) {
  return (payload.steps || []).map((step) => ({
    file_name: fileName,
    step_name: step.step || "",
    success: step.success === true ? "true" : "false",
    tokens: step.tokens || "",
    latency_ms: step.latency || "",
    data_keys: joinArray(step.dataKeys),
    validation_issues: step.validationIssues || 0,
    error: step.error || "",
  }));
}

async function writeCsv(filePath, rows) {
  if (!rows.length) {
    await fs.writeFile(filePath, "", "utf8");
    return;
  }

  const columns = Object.keys(rows[0]);
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ];

  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function postPdfToAgent(pdfPath) {
  const { stdout, stderr } = await execFileAsync(
    "curl",
    [
      "-s",
      "-X",
      "POST",
      "-F",
      `file=@${pdfPath}`,
      AGENT_API_URL,
    ],
    { maxBuffer: 20 * 1024 * 1024 },
  );

  if (stderr && stderr.trim()) {
    throw new Error(stderr.trim());
  }

  return JSON.parse(stdout);
}

async function ensureOutputDirs() {
  await fs.mkdir(RAW_DIR, { recursive: true });
}

async function buildReadme(summary) {
  const readme = [
    "# Agent Extraction Review",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Agent endpoint: ${AGENT_API_URL}`,
    `Files processed: ${summary.totalFiles}`,
    `Successful files: ${summary.successfulFiles}`,
    `Failed files: ${summary.failedFiles}`,
    `Total tokens used: ${summary.totalTokens}`,
    `Average latency (ms): ${summary.averageLatencyMs}`,
    "",
    "Contents:",
    "- `agent_extraction_table.csv`: flattened extraction output per PDF",
    "- `agent_step_metrics.csv`: step-level success, latency, and token usage per PDF",
    "- `raw_results/`: full JSON response from the agent test endpoint for each PDF",
  ].join("\n");

  await fs.writeFile(path.join(OUTPUT_DIR, "README.md"), `${readme}\n`, "utf8");
}

async function main() {
  await ensureOutputDirs();

  const entries = await fs.readdir(DATA_DIR);
  const pdfNames = entries
    .filter((entry) => entry.toLowerCase().endsWith(".pdf"))
    .sort(sortPdfNames);

  const extractionRows = [];
  const stepRows = [];
  const failures = [];
  let totalTokens = 0;
  let totalLatencyMs = 0;

  for (let index = 0; index < pdfNames.length; index += 1) {
    const fileName = pdfNames[index];
    const pdfPath = path.join(DATA_DIR, fileName);
    const label = `[${index + 1}/${pdfNames.length}]`;
    console.log(`${label} Processing ${fileName}`);

    try {
      const payload = await postPdfToAgent(pdfPath);
      await fs.writeFile(
        path.join(RAW_DIR, `${fileName}.json`),
        JSON.stringify(payload, null, 2),
        "utf8",
      );

      extractionRows.push(flattenResult(fileName, payload));
      stepRows.push(...extractStepRows(fileName, payload));

      totalTokens += Number(payload.summary?.tokensUsed || 0);
      totalLatencyMs += Number(payload.summary?.totalLatency || 0);

      console.log(
        `${label} Completed ${fileName} in ${payload.summary?.totalLatency || 0} ms using ${payload.summary?.tokensUsed || 0} tokens`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ file_name: fileName, error: message });
      extractionRows.push({
        file_name: fileName,
        success: "false",
        total_latency_ms: "",
        tokens_used: "",
        steps_count: "",
        successful_steps: 0,
        failed_steps: "",
        confidence_level: "",
        missing_critical_fields: "",
        inconsistencies_found: "",
        parser_note: "",
        patient_name: "",
        mrn: "",
        age: "",
        gender: "",
        admission_date: "",
        discharge_date: "",
        principal_diagnosis: "",
        secondary_diagnoses: "",
        allergies: "",
        medications: "",
        investigations: "",
        nursing_needs: "",
        bp_systolic: "",
        bp_diastolic: "",
        bp_status: "",
        pulse: "",
        pulse_status: "",
        temperature_f: "",
        temperature_unit: "",
        resp_rate: "",
        spo2: "",
        spo2_status: "",
        pain_score: "",
        grbs: "",
        ews_score: "",
        gcs_total: "",
        fall_score: "",
        fall_level: "",
        pressure_score: "",
        pressure_level: "",
        dvt_score: "",
        dvt_level: "",
        aspiration_score: "",
        aspiration_level: "",
        overall_assistance_needs: "",
        functional_status: "",
        mobility_notes: "",
        abnormal_flags: "",
        step_errors: message,
      });
      console.error(`${label} Failed ${fileName}: ${message}`);
    }
  }

  await writeCsv(path.join(OUTPUT_DIR, "agent_extraction_table.csv"), extractionRows);
  await writeCsv(path.join(OUTPUT_DIR, "agent_step_metrics.csv"), stepRows);
  await fs.writeFile(
    path.join(OUTPUT_DIR, "failures.json"),
    JSON.stringify({ failures }, null, 2),
    "utf8",
  );

  await buildReadme({
    totalFiles: pdfNames.length,
    successfulFiles: pdfNames.length - failures.length,
    failedFiles: failures.length,
    totalTokens,
    averageLatencyMs: pdfNames.length ? Math.round(totalLatencyMs / pdfNames.length) : 0,
  });

  console.log(`Finished. Output written to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
