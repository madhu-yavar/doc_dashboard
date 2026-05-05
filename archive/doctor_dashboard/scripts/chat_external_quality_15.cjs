const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DOCS_PATH = path.join(ROOT, "server/storage/documents.json");
const REPORT_PATH = path.join(ROOT, "server/storage/chat_external_quality_15_report.json");
const API_BASE = "http://localhost:8001";

const documents = JSON.parse(fs.readFileSync(DOCS_PATH, "utf8")).documents || [];
const idByName = new Map(documents.map((doc) => [doc.name, doc.id]));

function docId(name) {
  const id = idByName.get(name);
  if (!id) throw new Error(`Missing document for ${name}`);
  return id;
}

const cases = [
  {
    category: "icd",
    label: "ICD-01 multiple myeloma",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary9.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the ICD-10-CM code for multiple myeloma?"],
  },
  {
    category: "icd",
    label: "ICD-02 ganglion cyst",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the ICD-10-CM code for ganglion cyst?"],
  },
  {
    category: "icd",
    label: "ICD-03 newborn",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary5.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the ICD-10-CM code for newborn?"],
  },
  {
    category: "icd",
    label: "ICD-04 intracerebral hemorrhage",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the ICD-10-CM code for intracerebral hemorrhage?"],
  },
  {
    category: "icd",
    label: "ICD-05 hypertension",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the ICD-10-CM code for hypertension?"],
  },
  {
    category: "clinical",
    label: "CLIN-01 low BP contradiction",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "vitals",
    turns: ["Why is the patient's blood pressure low?"],
  },
  {
    category: "clinical",
    label: "CLIN-02 high BP explanation",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "vitals",
    turns: ["Why is the patient's blood pressure high?"],
  },
  {
    category: "clinical",
    label: "CLIN-03 multiple myeloma fatigue",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary9.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["Why do patients with multiple myeloma get tired?"],
  },
  {
    category: "clinical",
    label: "CLIN-04 ganglion cyst swelling",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["Why do patients with ganglion cyst get finger swelling?"],
  },
  {
    category: "clinical",
    label: "CLIN-05 intracerebral bleed concern",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["Why is intracerebral bleed concerning?"],
  },
  {
    category: "drug",
    label: "DRUG-01 mannitol use",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "medications",
    turns: ["What does mannitol do?"],
  },
  {
    category: "drug",
    label: "DRUG-02 augmentin use",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary1.cls.pdf",
    sectionContext: "medications",
    turns: ["What is Augmentin used for?"],
  },
  {
    category: "drug",
    label: "DRUG-03 pantoprazole role",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary9.cls.pdf",
    sectionContext: "medications",
    turns: ["What does PAN 40 mg do?"],
  },
  {
    category: "drug",
    label: "DRUG-04 stator purpose",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "medications",
    turns: ["Why do we need STATOR? What does it do?"],
  },
  {
    category: "drug",
    label: "DRUG-05 cilacar composition",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary6.cls.pdf",
    sectionContext: "medications",
    turns: ["What is the composition for: T.CILACAR M?", "yes"],
  },
];

async function post(body) {
  const res = await fetch(`${API_BASE}/api/chat/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { ok: res.ok, json };
}

function hasExternalCitations(turn) {
  return (turn.citations || []).some((c) => c.source_class === "external");
}

function codeRegexMatch(text = "") {
  return /\b[A-TV-Z][0-9][0-9AB](?:\.[0-9A-Z]{1,4})?\b/.test(String(text || ""));
}

function scoreCase(test, turns) {
  const last = turns[turns.length - 1];
  const answer = last.answer || "";
  const externalCitations = (last.citations || []).filter((c) => c.source_class === "external");

  if (test.category === "icd") {
    const passed = codeRegexMatch(answer) && externalCitations.length > 0;
    return {
      passed,
      note: passed
        ? `code returned with ${externalCitations.length} external citation(s)`
        : `expected ICD code + external citation, got: ${answer}`,
    };
  }

  if (test.category === "clinical") {
    const contradictionHandled =
      /does not show low blood pressure|does not show low bp|160 mmhg|chart does not show low/i.test(answer);
    const structured = /Patient Record:/i.test(answer) || /External Reference:/i.test(answer);
    const passed =
      (externalCitations.length > 0 && structured) ||
      contradictionHandled ||
      /searched approved external medical sources|external search is unavailable/i.test(answer);

    return {
      passed,
      note: passed
        ? `clinical explanation returned; external citations=${externalCitations.length}`
        : `clinical explanation quality weak: ${answer}`,
    };
  }

  const noConsentLeak = !/Do you want me to do that\?/i.test(answer);
  const noAwkwardLeak = !/No external medical information was provided/i.test(answer);
  const passed =
    noConsentLeak &&
    noAwkwardLeak &&
    (externalCitations.length > 0 || /searched approved external medical sources|external search is unavailable/i.test(answer));

  return {
    passed,
    note: passed
      ? `drug answer returned; external citations=${externalCitations.length}`
      : `drug answer quality weak: ${answer}`,
  };
}

async function runCase(test) {
  const documentId = docId(test.docName);
  let chatId = crypto.randomUUID();
  const turns = [];

  for (let index = 0; index < test.turns.length; index += 1) {
    const message = test.turns[index];
    if (String(message).toLowerCase() === "yes" && turns.length) {
      const prior = turns[turns.length - 1];
      if (prior.decision_prompt !== "Yes/No") continue;
    }

    const { ok, json } = await post({
      documentId,
      chatId,
      message,
      sectionContext: test.sectionContext,
    });

    const response = json.response || json.data || {};
    chatId = response.chatId || chatId;
    turns.push({
      user: message,
      ok,
      answer: response.answer || "",
      source_class: response.source_class || "",
      confidence_label: response.confidence_label || "",
      decision_prompt: response.decision_prompt ? response.decision_prompt.options.map((o) => o.label).join("/") : "",
      citations: (response.citations || []).map((c) => ({
        label: c.label || "",
        source_class: c.source_class || "",
        url: c.url || "",
      })),
    });
  }

  const score = scoreCase(test, turns);
  return {
    category: test.category,
    label: test.label,
    document: test.docName,
    documentId,
    passed: score.passed,
    note: score.note,
    turns,
  };
}

(async () => {
  const results = [];

  for (const test of cases) {
    const result = await runCase(test);
    results.push(result);
    console.log(`[${results.length}/15] ${result.passed ? "PASS" : "FAIL"} ${result.label}`);
  }

  const summarize = (category) => ({
    total: results.filter((r) => r.category === category).length,
    passed: results.filter((r) => r.category === category && r.passed).length,
    failed: results.filter((r) => r.category === category && !r.passed).length,
  });

  const summary = {
    total: results.length,
    icd: summarize("icd"),
    clinical: summarize("clinical"),
    drug: summarize("drug"),
    with_external_citations: results.filter((r) => hasExternalCitations(r.turns[r.turns.length - 1])).length,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify({ summary, results }, null, 2));
})();
