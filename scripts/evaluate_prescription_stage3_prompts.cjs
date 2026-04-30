#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PrescriptionTwoStageAgent = require("../agents/prescription_two_stage_agent.cjs");
const HandwritingMedicationsExtractorSkill = require("../skills/extraction/stage3/handwriting_medications_extractor.skill.cjs");
const HandwritingVitalsExtractorSkill = require("../skills/extraction/stage3/handwriting_vitals_extractor.skill.cjs");
const HandwritingDiagnosisExtractorSkill = require("../skills/extraction/stage3/handwriting_diagnosis_extractor.skill.cjs");
const HandwritingOrdersExtractorSkill = require("../skills/extraction/stage3/handwriting_orders_extractor.skill.cjs");
const VisualElementDetectorSkill = require("../skills/extraction/stage3/visual_element_detector.skill.cjs");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const RESULTS_DIR = path.join(ROOT, "scripts", "experiment_results");
const DOCS_DIR = path.join(ROOT, "docs", "testing");
const NOW = new Date().toISOString();
const DATE_STAMP = NOW.slice(0, 10);
const JSON_REPORT = path.join(RESULTS_DIR, `gemini_prescription_prompt_evaluation_${DATE_STAMP}.json`);
const MD_REPORT = path.join(DOCS_DIR, `gemini-prescription-prompt-evaluation-${DATE_STAMP}.md`);

const PROMPTS = [
  {
    key: "medications",
    label: "Medications",
    createSkill: () => new HandwritingMedicationsExtractorSkill({}),
    systemInstruction:
      "You are a medical document extraction expert specializing in handwritten prescriptions. You have excellent handwriting recognition skills.",
    maxTokens: 4096,
    temperature: 0.1,
    buildPrompt: (skill, context) => skill.buildPrompt(context.documentStructure || {}),
  },
  {
    key: "vitals",
    label: "Vitals",
    createSkill: () => new HandwritingVitalsExtractorSkill({}),
    systemInstruction:
      "You are a medical document extraction expert specializing in handwritten vital signs.",
    maxTokens: 2048,
    temperature: 0.1,
    buildPrompt: (skill) => skill.buildPrompt(),
  },
  {
    key: "diagnosis",
    label: "Diagnosis",
    createSkill: () => new HandwritingDiagnosisExtractorSkill({}),
    systemInstruction:
      "You are a medical document extraction expert specializing in handwritten diagnosis and clinical notes.",
    maxTokens: 2048,
    temperature: 0.1,
    thinkingBudget: 4096,
    buildPrompt: (skill) => skill.buildPrompt(),
  },
  {
    key: "orders",
    label: "Orders",
    createSkill: () => new HandwritingOrdersExtractorSkill({}),
    systemInstruction:
      "You are a medical document extraction expert specializing in handwritten investigation and radiology orders.",
    maxTokens: 2048,
    temperature: 0.1,
    thinkingBudget: 8192,
    buildPrompt: (skill) => skill.buildPrompt(),
  },
  {
    key: "visual",
    label: "Visual Elements",
    createSkill: () => new VisualElementDetectorSkill({}),
    systemInstruction:
      "You are a medical document analysis expert specializing in detecting visual selections like checkmarks and circles.",
    maxTokens: 3072,
    temperature: 0.1,
    buildPrompt: (skill) => skill.buildPrompt(),
  },
];

function readGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const envPath = path.join(ROOT, ".env");
  const envText = fs.readFileSync(envPath, "utf8");
  const match = envText.match(/^GEMINI_API_KEY=(.*)$/m);
  if (!match || !match[1]) {
    throw new Error("GEMINI_API_KEY is missing from environment and .env");
  }
  return match[1].trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripCodeFences(value) {
  return String(value || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonWithSkill(skill, content) {
  return skill.parseModelJson(content);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isNullableString(value) {
  return value === null || typeof value === "string";
}

function summarizeMedications(data) {
  const meds = asArray(data?.medications);
  const missingPerMedication = meds.map((med) =>
    ["name", "generic_name", "dosage", "form", "frequency", "duration", "route", "instructions", "confidence", "is_handwritten"].filter(
      (key) => !(key in med)
    )
  );
  const missingFieldCount = missingPerMedication.reduce((sum, arr) => sum + arr.length, 0);
  const schemaOk =
    Array.isArray(data?.medications) &&
    typeof data?.total_count === "number" &&
    typeof data?.has_unreadable === "boolean" &&
    typeof data?.unreadable_count === "number" &&
    missingFieldCount === 0;
  return {
    schemaOk,
    missingFieldCount,
    medicationCount: meds.length,
    totalCount: typeof data?.total_count === "number" ? data.total_count : null,
    hasUnreadable: typeof data?.has_unreadable === "boolean" ? data.has_unreadable : null,
    unreadableCount: typeof data?.unreadable_count === "number" ? data.unreadable_count : null,
    sample: meds.slice(0, 3).map((med) => med.name || "").filter(Boolean),
    contradictions:
      typeof data?.total_count === "number" && data.total_count !== meds.length
        ? [`total_count=${data.total_count} but medications.length=${meds.length}`]
        : [],
  };
}

function summarizeVitals(data) {
  const bp = data?.blood_pressure || {};
  const pulse = data?.pulse || {};
  const temperature = data?.temperature || {};
  const weight = data?.weight || {};
  const spo2 = data?.spo2 || {};
  const rr = data?.respiratory_rate || {};
  const populatedCount = [
    bp.systolic != null || bp.diastolic != null,
    pulse.value != null,
    temperature.value != null,
    weight.value != null,
    spo2.value != null,
    rr.value != null,
  ].filter(Boolean).length;
  const schemaOk =
    typeof data === "object" &&
    data !== null &&
    typeof data?.has_vitals === "boolean" &&
    typeof data?.confidence === "string" &&
    typeof bp === "object" &&
    typeof pulse === "object" &&
    typeof temperature === "object" &&
    typeof weight === "object" &&
    typeof spo2 === "object" &&
    typeof rr === "object";
  const contradictions = [];
  if (data?.has_vitals === true && populatedCount === 0) {
    contradictions.push("has_vitals=true but all values are null");
  }
  if (data?.has_vitals === false && populatedCount > 0) {
    contradictions.push("has_vitals=false but one or more values are populated");
  }
  return {
    schemaOk,
    populatedCount,
    hasVitals: typeof data?.has_vitals === "boolean" ? data.has_vitals : null,
    confidence: typeof data?.confidence === "string" ? data.confidence : null,
    sample: {
      bp:
        bp.systolic != null || bp.diastolic != null
          ? `${bp.systolic ?? ""}${bp.diastolic != null ? `/${bp.diastolic}` : ""}`
          : "",
      pulse: pulse.value ?? null,
      temperature: temperature.value ?? null,
    },
    contradictions,
  };
}

function summarizeDiagnosis(data) {
  const symptoms = asArray(data?.symptoms);
  const clinicalNotes = asArray(data?.clinical_notes);
  const secondaryDiagnoses = asArray(data?.secondary_diagnoses);
  const schemaOk =
    isNullableString(data?.principal_diagnosis) &&
    Array.isArray(data?.secondary_diagnoses) &&
    Array.isArray(data?.symptoms) &&
    Array.isArray(data?.clinical_notes) &&
    typeof data?.has_diagnosis === "boolean" &&
    typeof data?.confidence === "string";
  const contradictions = [];
  if (data?.has_diagnosis === true && !data?.principal_diagnosis && secondaryDiagnoses.length === 0) {
    contradictions.push("has_diagnosis=true but no primary or secondary diagnosis returned");
  }
  return {
    schemaOk,
    principalDiagnosis: data?.principal_diagnosis || null,
    secondaryCount: secondaryDiagnoses.length,
    symptomCount: symptoms.length,
    clinicalNoteCount: clinicalNotes.length,
    confidence: typeof data?.confidence === "string" ? data.confidence : null,
    sample: {
      notes: clinicalNotes.slice(0, 3).filter(Boolean),
    },
    contradictions,
  };
}

function summarizeVisual(data) {
  const lab = data?.lab_investigations || {};
  const radiology = data?.radiology || {};
  const selectedTests = asArray(lab.selected_tests);
  const selectedStudies = asArray(radiology.selected_studies);
  const schemaOk =
    typeof lab === "object" &&
    lab !== null &&
    Array.isArray(lab.selected_tests) &&
    typeof lab.total_available === "number" &&
    typeof lab.total_selected === "number" &&
    typeof radiology === "object" &&
    radiology !== null &&
    Array.isArray(radiology.selected_studies) &&
    typeof data?.has_selections === "boolean" &&
    typeof data?.confidence === "string";
  const contradictions = [];
  if (typeof lab.total_selected === "number" && lab.total_selected !== selectedTests.length) {
    contradictions.push(`total_selected=${lab.total_selected} but selected_tests.length=${selectedTests.length}`);
  }
  if (data?.has_selections === false && (selectedTests.length > 0 || selectedStudies.length > 0)) {
    contradictions.push("has_selections=false but selected tests/studies are present");
  }
  return {
    schemaOk,
    totalAvailable: typeof lab.total_available === "number" ? lab.total_available : null,
    totalSelected: typeof lab.total_selected === "number" ? lab.total_selected : null,
    radiologySelected: selectedStudies.length,
    hasSelections: typeof data?.has_selections === "boolean" ? data.has_selections : null,
    confidence: typeof data?.confidence === "string" ? data.confidence : null,
    sample: {
      labs: selectedTests.slice(0, 3).map((item) => item.test_name || "").filter(Boolean),
      radiology: selectedStudies.slice(0, 3).map((item) => item.study_name || "").filter(Boolean),
    },
    contradictions,
  };
}

function summarizeOrders(data) {
  const labInvestigations = asArray(data?.lab_investigations);
  const radiology = asArray(data?.radiology?.selected_studies);
  const uncertainCount =
    labInvestigations.filter((item) => item?.is_uncertain).length +
    radiology.filter((item) => item?.is_uncertain).length;
  const schemaOk =
    Array.isArray(data?.lab_investigations) &&
    typeof data?.radiology === "object" &&
    data?.radiology !== null &&
    Array.isArray(data?.radiology?.selected_studies) &&
    typeof data?.has_orders === "boolean" &&
    typeof data?.confidence === "string";
  const contradictions = [];
  if (data?.has_orders === false && (labInvestigations.length > 0 || radiology.length > 0)) {
    contradictions.push("has_orders=false but lab/study orders are present");
  }
  return {
    schemaOk,
    labCount: labInvestigations.length,
    radiologyCount: radiology.length,
    uncertainCount,
    confidence: typeof data?.confidence === "string" ? data.confidence : null,
    sample: {
      labs: labInvestigations.slice(0, 3).map((item) => item.test_name || "").filter(Boolean),
      radiology: radiology.slice(0, 3).map((item) => item.study_name || "").filter(Boolean),
    },
    contradictions,
  };
}

function summarizePromptResult(promptKey, parsed) {
  switch (promptKey) {
    case "medications":
      return summarizeMedications(parsed);
    case "vitals":
      return summarizeVitals(parsed);
    case "diagnosis":
      return summarizeDiagnosis(parsed);
    case "visual":
      return summarizeVisual(parsed);
    case "orders":
      return summarizeOrders(parsed);
    default:
      return { schemaOk: false, contradictions: ["Unknown prompt key"] };
  }
}

function normalizeComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildSemanticChecks(item) {
  const diagnosisResult = item.results.find((result) => result.promptKey === "diagnosis");
  const ordersResult = item.results.find((result) => result.promptKey === "orders");
  const visualResult = item.results.find((result) => result.promptKey === "visual");

  const flags = [];

  const diagnosisNotes = diagnosisResult?.success
    ? asArray(diagnosisResult.parsed?.clinical_notes).map((note) => String(note || "").trim()).filter(Boolean)
    : [];

  const textOrderNames = ordersResult?.success
    ? [
        ...asArray(ordersResult.parsed?.lab_investigations).map((item) => item?.test_name),
        ...asArray(ordersResult.parsed?.radiology?.selected_studies).map((item) => item?.study_name),
      ].map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  const visualOrderNames = visualResult?.success
    ? [
        ...asArray(visualResult.parsed?.lab_investigations?.selected_tests).map((item) => item?.test_name),
        ...asArray(visualResult.parsed?.radiology?.selected_studies).map((item) => item?.study_name),
      ].map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  const allOrderNames = uniqueStrings([...textOrderNames, ...visualOrderNames]);
  const normalizedOrderNames = allOrderNames
    .map((name) => ({ raw: name, normalized: normalizeComparableText(name) }))
    .filter((item) => item.normalized.length >= 3);

  const diagnosisOrderBleed = [];
  for (const note of diagnosisNotes) {
    const normalizedNote = normalizeComparableText(note);
    for (const order of normalizedOrderNames) {
      if (order.normalized.length >= 4 && normalizedNote.includes(order.normalized)) {
        diagnosisOrderBleed.push(`note "${note}" contains order "${order.raw}"`);
      }
    }
  }
  if (diagnosisOrderBleed.length > 0) {
    flags.push({
      type: "diagnosis_order_bleed",
      severity: "warning",
      details: uniqueStrings(diagnosisOrderBleed),
    });
  }

  const textVisualOverlap = [];
  const normalizedVisual = new Map(
    visualOrderNames.map((name) => [normalizeComparableText(name), name]).filter(([name]) => name.length >= 3)
  );
  for (const name of textOrderNames) {
    const normalized = normalizeComparableText(name);
    if (normalizedVisual.has(normalized)) {
      textVisualOverlap.push(`${name} [text+visual]`);
    }
  }
  if (textVisualOverlap.length > 0) {
    flags.push({
      type: "text_visual_overlap",
      severity: "info",
      details: uniqueStrings(textVisualOverlap),
    });
  }

  return flags;
}

async function retryOperation(fn, label, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      const retryable = /(503|UNAVAILABLE|429|RESOURCE_EXHAUSTED|fetch failed|ETIMEDOUT|ECONNRESET)/i.test(message);
      if (!retryable || attempt === maxAttempts) {
        throw lastError;
      }
      const backoffMs = attempt * 4000;
      console.warn(`[retry] ${label} failed on attempt ${attempt}/${maxAttempts}: ${message}`);
      console.warn(`[retry] waiting ${backoffMs}ms before retry`);
      await sleep(backoffMs);
    }
  }
  throw lastError;
}

async function prepareStage3Context(agent, pdfPath) {
  const pdfName = path.basename(pdfPath);
  const stage1Result = await retryOperation(
    () => agent.stage1Agent.process(pdfPath, { pdfName }),
    `stage1:${pdfName}`,
    2
  );
  if (!stage1Result.success) {
    throw new Error(`Stage 1 failed: ${stage1Result.error}`);
  }

  const firstPageBase64 = await agent.convertPdfToBase64(pdfPath);
  if (!firstPageBase64) {
    throw new Error("Failed to convert first page for masking");
  }

  const maskingResult = await retryOperation(
    () =>
      agent.phiMasker.execute(firstPageBase64, {
        pageNum: 1,
        keepHospitalName: agent.maskingConfig.keepHospitalName,
      }),
    `masking:${pdfName}`,
    2
  );

  if (!maskingResult.success || !maskingResult.maskedImage) {
    throw new Error(`Masking failed: ${maskingResult.error || "maskedImage missing"}`);
  }

  const allPages = await agent.convertPdfAllPagesToBase64(pdfPath);
  if (!allPages || allPages.length === 0) {
    throw new Error("Failed to convert PDF pages for Stage 3");
  }

  const maskedDataUrl = maskingResult.maskedImage.startsWith("data:")
    ? maskingResult.maskedImage
    : `data:image/png;base64,${maskingResult.maskedImage}`;

  const images = allPages.map((page, index) => ({
    pageNum: page.pageNum,
    imageData: index === 0 ? maskedDataUrl : page.dataUrl,
    isMasked: index === 0,
  }));

  return {
    pdfName,
    pdfPath,
    pageCount: allPages.length,
    documentStructure: stage1Result.data?.document_structure || {},
    stage1Data: stage1Result.data || {},
    masking: {
      success: true,
      maskedCount: maskingResult.masked_count || 0,
      maskedTypes: maskingResult.masked_types || [],
    },
    images,
  };
}

async function evaluatePrompt(promptConfig, apiKey, context) {
  const skill = promptConfig.createSkill();
  const prompt = promptConfig.buildPrompt(skill, context);
  const geminiClient = skill.getGeminiClient(apiKey);
  const imageDataUrls = context.images.map((item) => item.imageData);
  const startedAt = Date.now();

  try {
    const response = await retryOperation(
      () =>
        geminiClient.execute(prompt, {
          images: imageDataUrls,
          temperature: promptConfig.temperature,
          maxTokens: promptConfig.maxTokens,
          thinkingBudget: promptConfig.thinkingBudget,
          responseMimeType: "application/json",
          systemInstruction: promptConfig.systemInstruction,
        }),
      `${promptConfig.key}:${context.pdfName}`,
      3
    );
    const durationMs = Date.now() - startedAt;

    if (!response.success) {
      return {
        promptKey: promptConfig.key,
        promptLabel: promptConfig.label,
        success: false,
        durationMs,
        error: response.error,
        usage: response.usage || null,
        summary: null,
      };
    }

    const parsed = parseJsonWithSkill(skill, response.content);
    const summary = summarizePromptResult(promptConfig.key, parsed);

    return {
      promptKey: promptConfig.key,
      promptLabel: promptConfig.label,
      success: true,
      durationMs,
      usage: response.usage || null,
      rawContentPreview: stripCodeFences(response.content).slice(0, 400),
      parsed,
      summary,
    };
  } catch (error) {
    return {
      promptKey: promptConfig.key,
      promptLabel: promptConfig.label,
      success: false,
      durationMs: Date.now() - startedAt,
      error: error.message,
      usage: null,
      summary: null,
    };
  }
}

function buildMarkdownTableRows(evaluations) {
  const rows = [
    "| Prescription | Pages | Prompt | Success | Schema | Key Output | Confidence | Latency | Notes |",
    "|---|---:|---|---|---|---|---|---:|---|",
  ];

  for (const item of evaluations) {
    for (const result of item.results) {
      if (!result.success) {
        rows.push(
          `| ${item.pdfName} | ${item.pageCount} | ${result.promptLabel} | no | - | - | - | ${result.durationMs} ms | ${escapeMd(
            truncate(result.error, 120)
          )} |`
        );
        continue;
      }

      const summary = result.summary || {};
      let keyOutput = "-";
      if (result.promptKey === "medications") {
        keyOutput = `${summary.medicationCount} meds`;
      } else if (result.promptKey === "vitals") {
        keyOutput = `${summary.populatedCount} vitals`;
      } else if (result.promptKey === "diagnosis") {
        keyOutput = `${summary.principalDiagnosis ? "dx" : "no dx"} • ${summary.symptomCount ?? 0} sx • ${summary.clinicalNoteCount ?? 0} notes`;
      } else if (result.promptKey === "orders") {
        keyOutput = `${summary.labCount} labs • ${summary.radiologyCount} rad`;
      } else if (result.promptKey === "visual") {
        keyOutput = `${summary.totalSelected ?? 0} labs • ${summary.radiologySelected ?? 0} rad`;
      }

      const confidence =
        summary.confidence ??
        (result.promptKey === "medications" ? "-" : "-");

      const notes = [];
      if (summary.sample?.labs?.length) notes.push(`labs: ${summary.sample.labs.join(", ")}`);
      if (summary.sample?.radiology?.length) notes.push(`rad: ${summary.sample.radiology.join(", ")}`);
      if (summary.sample?.notes?.length) notes.push(`notes: ${summary.sample.notes.join(" / ")}`);
      if (typeof summary.uncertainCount === "number" && summary.uncertainCount > 0) notes.push(`uncertain items: ${summary.uncertainCount}`);
      if (summary.sample?.bp) notes.push(`BP ${summary.sample.bp}`);
      if (summary.sample?.pulse) notes.push(`P ${summary.sample.pulse}`);
      if (summary.sample?.length) notes.push(summary.sample.join(", "));
      if (summary.contradictions?.length) notes.push(...summary.contradictions);

      rows.push(
        `| ${item.pdfName} | ${item.pageCount} | ${result.promptLabel} | yes | ${
          summary.schemaOk ? "yes" : "no"
        } | ${escapeMd(keyOutput)} | ${escapeMd(String(confidence || "-"))} | ${result.durationMs} ms | ${escapeMd(
          truncate(notes.join(" ; ") || "-", 140)
        )} |`
      );
    }
  }

  return rows.join("\n");
}

function buildSemanticFlagsSection(evaluations) {
  const lines = [];
  for (const item of evaluations) {
    const flags = Array.isArray(item.semanticChecks) ? item.semanticChecks : [];
    if (flags.length === 0) continue;
    lines.push(`- ${item.pdfName}`);
    for (const flag of flags) {
      lines.push(`  - [${flag.severity}] ${flag.type}: ${truncate(flag.details.join(" ; "), 220)}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : "- None";
}

function buildStaticFindings() {
  return [
    "- This report evaluates the live prompt text, not clinical correctness against a gold standard. A prompt can be schema-compliant and still clinically weak.",
    "- Medication quality should be judged by recall and legibility, not just JSON validity. Short one-token outputs may still be poor extraction outcomes.",
    "- Visual selection detection is a narrower task than free-text clinical extraction, so it is expected to be more stable if the form contains checklist-style elements.",
    "- Diagnosis extraction is now narrower and should be judged separately from order capture.",
    "- Orders extraction should be judged primarily on recall for labs and radiology, with visual selection detection acting as a complementary source rather than the only source.",
  ].join("\n");
}

function buildSummaryByPrompt(evaluations) {
  const byPrompt = new Map();
  for (const item of evaluations) {
    for (const result of item.results) {
      if (!byPrompt.has(result.promptKey)) {
        byPrompt.set(result.promptKey, {
          label: result.promptLabel,
          total: 0,
          success: 0,
          schemaOk: 0,
          avgLatencyMs: 0,
          failures: [],
        });
      }
      const bucket = byPrompt.get(result.promptKey);
      bucket.total += 1;
      bucket.avgLatencyMs += result.durationMs || 0;
      if (result.success) {
        bucket.success += 1;
        if (result.summary?.schemaOk) bucket.schemaOk += 1;
      } else {
        bucket.failures.push(`${item.pdfName}: ${truncate(result.error || "error", 80)}`);
      }
    }
  }

  const rows = [
    "| Prompt | Success Rate | Schema OK | Avg Latency | Failures |",
    "|---|---:|---:|---:|---|",
  ];
  for (const bucket of byPrompt.values()) {
    rows.push(
      `| ${bucket.label} | ${bucket.success}/${bucket.total} | ${bucket.schemaOk}/${bucket.total} | ${Math.round(
        bucket.avgLatencyMs / Math.max(bucket.total, 1)
      )} ms | ${escapeMd(truncate(bucket.failures.join(" ; ") || "-", 160))} |`
    );
  }
  return rows.join("\n");
}

function truncate(value, maxLen) {
  const text = String(value || "");
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

function escapeMd(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function main() {
  const geminiApiKey = readGeminiApiKey();
  const prescriptionFiles = Array.from({ length: 6 }, (_, i) =>
    path.join(DATA_DIR, `Prescription_0${i + 1}.pdf`)
  );

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  const agent = new PrescriptionTwoStageAgent({});
  const evaluations = [];

  for (const pdfPath of prescriptionFiles) {
    const pdfName = path.basename(pdfPath);
    console.log(`\n=== Preparing Stage 3 context for ${pdfName} ===`);
    const item = {
      pdfName,
      pdfPath,
      prepared: false,
      pageCount: null,
      masking: null,
      preparationError: null,
      results: [],
    };

    try {
      const context = await prepareStage3Context(agent, pdfPath);
      item.prepared = true;
      item.pageCount = context.pageCount;
      item.masking = context.masking;

      for (const promptConfig of PROMPTS) {
        console.log(`--- ${pdfName}: ${promptConfig.label} prompt ---`);
        const result = await evaluatePrompt(promptConfig, geminiApiKey, context);
        item.results.push(result);
        await sleep(1200);
      }
      item.semanticChecks = buildSemanticChecks(item);
    } catch (error) {
      item.preparationError = error.message;
      console.error(`[evaluation] ${pdfName} preparation failed: ${error.message}`);
    }

    evaluations.push(item);
  }

  const report = {
    generatedAt: NOW,
    files: prescriptionFiles.map((file) => path.basename(file)),
    prompts: PROMPTS.map((prompt) => ({ key: prompt.key, label: prompt.label })),
    staticFindings: buildStaticFindings().split("\n"),
    evaluations,
  };

  fs.writeFileSync(JSON_REPORT, JSON.stringify(report, null, 2));

  const markdown = [
    `# Gemini Prescription Prompt Evaluation`,
    ``,
    `Generated: ${NOW}`,
    ``,
    `## Scope`,
    ``,
    `Evaluated the live Gemini stage-3 prompt implementations against \`Prescription_01.pdf\` through \`Prescription_06.pdf\`. Each run used the current pipeline-style image preparation: page 1 PHI masked, pages 2-N original.`,
    ``,
    `## Static Findings`,
    ``,
    buildStaticFindings(),
    ``,
    `## Summary By Prompt`,
    ``,
    buildSummaryByPrompt(evaluations),
    ``,
    `## Detailed Results`,
    ``,
    buildMarkdownTableRows(evaluations),
    ``,
    `## Semantic Flags`,
    ``,
    buildSemanticFlagsSection(evaluations),
    ``,
    `## Preparation Failures`,
    ``,
    ...evaluations
      .filter((item) => item.preparationError)
      .map((item) => `- ${item.pdfName}: ${item.preparationError}`),
    evaluations.some((item) => item.preparationError) ? `` : `- None`,
  ].join("\n");

  fs.writeFileSync(MD_REPORT, markdown);

  console.log(`\nSaved JSON report: ${JSON_REPORT}`);
  console.log(`Saved Markdown report: ${MD_REPORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
