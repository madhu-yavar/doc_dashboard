#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PrescriptionTwoStageAgent = require("../agents/prescription_two_stage_agent.cjs");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_JSON = path.join(ROOT, "tmp", "stage3_prescriptions_02_03_04_report.json");
const OUT_MD = path.join(ROOT, "tmp", "stage3_prescriptions_02_03_04_report.md");

const FILES = [
  "Prescription_02.pdf",
  "Prescription_03.pdf",
  "Prescription_04.pdf",
];

function readEnvFile() {
  const envPath = path.join(ROOT, ".env");
  const values = {};
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    values[key] = value;
  }
  return values;
}

function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const envValues = readEnvFile();
  if (envValues.GEMINI_API_KEY) return envValues.GEMINI_API_KEY.trim();
  throw new Error("GEMINI_API_KEY not found in environment or .env");
}

async function prepareStage3Context(agent, pdfPath) {
  const pdfName = path.basename(pdfPath);
  const stage1Result = await agent.stage1Agent.process(pdfPath, { pdfName });
  if (!stage1Result.success) {
    throw new Error(`Stage 1 failed for ${pdfName}: ${stage1Result.error}`);
  }

  const firstPageBase64 = await agent.convertPdfToBase64(pdfPath);
  if (!firstPageBase64) {
    throw new Error(`Failed to convert first page for ${pdfName}`);
  }

  const maskingResult = await agent.phiMasker.execute(firstPageBase64, {
    pageNum: 1,
    keepHospitalName: agent.maskingConfig.keepHospitalName,
  });
  if (!maskingResult.success || !maskingResult.maskedImage) {
    throw new Error(`Masking failed for ${pdfName}: ${maskingResult.error || "maskedImage missing"}`);
  }

  const allPages = await agent.convertPdfAllPagesToBase64(pdfPath);
  if (!allPages || allPages.length === 0) {
    throw new Error(`Failed to convert all PDF pages for ${pdfName}`);
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
    stage1: stage1Result.data || {},
    images,
    pageCount: allPages.length,
    masking: {
      maskedCount: maskingResult.masked_count || 0,
      maskedTypes: maskingResult.masked_types || [],
    },
  };
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function compactItems(items, key) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    name: String(item?.[key] || "").trim(),
    source: item?.source || "",
    uncertain: Boolean(item?.is_uncertain),
    reason: item?.confidence_reason || "",
  })).filter((item) => item.name);
}

function summarizeStage3(resultBundle) {
  const raw = resultBundle.rawResults || {};
  const compiled = resultBundle.compiled || {};
  const promoted = raw.structuredReconciliation?.data || {};

  return {
    pageCount: resultBundle.pageCount,
    masking: resultBundle.masking,
    diagnosis: {
      principal: compiled.diagnosis?.principal || "",
      secondary: compiled.diagnosis?.secondary || [],
      symptoms: compiled.diagnosis?.symptoms || [],
    },
    vitals: compiled.vitals || {},
    notes: (compiled.handwritten_notes || []).map((note) => ({
      text: note.text,
      category: note.category,
      page: note.page_number,
      confidence: note.confidence,
    })),
    final: {
      labs: compactItems(compiled.lab_investigations?.selected_tests, "test_name"),
      radiology: compactItems(compiled.radiology_selections?.selected_studies, "study_name"),
      nuclearMedicine: compactItems(compiled.nuclear_medicine?.selected_studies, "study_name"),
      procedures: compactItems(compiled.procedures, "name"),
    },
    promoted: {
      labs: compactItems(promoted.lab_investigations, "test_name"),
      radiology: compactItems(promoted.radiology?.selected_studies, "study_name"),
      nuclearMedicine: compactItems(promoted.nuclear_medicine?.selected_studies, "study_name"),
      procedures: compactItems(promoted.procedures, "name"),
    },
    counts: {
      notes: compiled.handwritten_notes?.length || 0,
      labs: compiled.lab_investigations?.selected_tests?.length || 0,
      radiology: compiled.radiology_selections?.selected_studies?.length || 0,
      nuclearMedicine: compiled.nuclear_medicine?.selected_studies?.length || 0,
      procedures: compiled.procedures?.length || 0,
      promotedLabs: promoted.lab_investigations?.length || 0,
      promotedRadiology: promoted.radiology?.selected_studies?.length || 0,
      promotedNuclearMedicine: promoted.nuclear_medicine?.selected_studies?.length || 0,
      promotedProcedures: promoted.procedures?.length || 0,
    },
    sources: {
      labSources: uniqueStrings((compiled.lab_investigations?.selected_tests || []).map((item) => item.source)),
      radiologySources: uniqueStrings((compiled.radiology_selections?.selected_studies || []).map((item) => item.source)),
      procedureSources: uniqueStrings((compiled.procedures || []).map((item) => item.source)),
    },
    usage: resultBundle.usage || {},
  };
}

function toMarkdown(report) {
  const lines = [];
  lines.push(`# Stage 3 Test Report`);
  lines.push(``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Model: ${report.model}`);
  lines.push(``);

  for (const item of report.documents) {
    lines.push(`## ${item.file}`);
    lines.push(``);
    lines.push(`- Pages: ${item.summary.pageCount}`);
    lines.push(`- Diagnosis: ${item.summary.diagnosis.principal || "None"}`);
    lines.push(`- Notes: ${item.summary.counts.notes}`);
    lines.push(`- Final labs: ${item.summary.counts.labs}`);
    lines.push(`- Final radiology: ${item.summary.counts.radiology}`);
    lines.push(`- Final nuclear medicine: ${item.summary.counts.nuclearMedicine}`);
    lines.push(`- Final procedures: ${item.summary.counts.procedures}`);
    lines.push(`- Promoted by reconciliation: labs ${item.summary.counts.promotedLabs}, radiology ${item.summary.counts.promotedRadiology}, nuclear ${item.summary.counts.promotedNuclearMedicine}, procedures ${item.summary.counts.promotedProcedures}`);
    lines.push(``);

    const sections = [
      ["Promoted Labs", item.summary.promoted.labs],
      ["Promoted Radiology", item.summary.promoted.radiology],
      ["Promoted Nuclear Medicine", item.summary.promoted.nuclearMedicine],
      ["Promoted Procedures", item.summary.promoted.procedures],
      ["Final Labs", item.summary.final.labs],
      ["Final Radiology", item.summary.final.radiology],
      ["Final Nuclear Medicine", item.summary.final.nuclearMedicine],
      ["Final Procedures", item.summary.final.procedures],
    ];

    for (const [title, entries] of sections) {
      lines.push(`### ${title}`);
      if (!entries.length) {
        lines.push(`- None`);
      } else {
        for (const entry of entries) {
          const parts = [entry.name, entry.source ? `[${entry.source}]` : ""].filter(Boolean);
          lines.push(`- ${parts.join(" ")}`);
        }
      }
      lines.push(``);
    }

    lines.push(`### Notes`);
    if (!item.summary.notes.length) {
      lines.push(`- None`);
    } else {
      for (const note of item.summary.notes) {
        lines.push(`- p${note.page}: ${note.text} (${note.category}, ${note.confidence})`);
      }
    }
    lines.push(``);
  }

  return lines.join("\n");
}

async function run() {
  const geminiApiKey = getGeminiApiKey();
  const envValues = readEnvFile();
  const agent = new PrescriptionTwoStageAgent({
    geminiModel: process.env.GEMINI_MODEL || envValues.GEMINI_MODEL || "gemini-2.5-flash",
  });

  const documents = [];

  for (const file of FILES) {
    const pdfPath = path.join(DATA_DIR, file);
    console.log(`\n=== Stage 3 test: ${file} ===`);
    const context = await prepareStage3Context(agent, pdfPath);
    const rawResults = await agent.stage3Agent.executeStage3Extractions({
      images: context.images,
      apiKey: geminiApiKey,
      documentStructure: context.stage1.document_structure,
      onProgress: null,
    });
    const compiled = agent.stage3Agent.compileStage3Data(rawResults);
    const usage = agent.stage3Agent.summarizeUsage(rawResults);
    documents.push({
      file,
      summary: summarizeStage3({
        pageCount: context.pageCount,
        masking: context.masking,
        rawResults,
        compiled,
        usage,
      }),
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    model: process.env.GEMINI_MODEL || readEnvFile().GEMINI_MODEL || "gemini-2.5-flash",
    documents,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_MD, toMarkdown(report));

  console.log(`\nSaved JSON report to ${OUT_JSON}`);
  console.log(`Saved Markdown report to ${OUT_MD}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
