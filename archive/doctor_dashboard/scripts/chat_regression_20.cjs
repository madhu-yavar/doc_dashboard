const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DOCS_PATH = path.join(ROOT, "server/storage/documents.json");
const REPORT_PATH = path.join(ROOT, "server/storage/chat_regression_20_report.json");
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
    label: "DS11 age",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary11.cls.pdf",
    sectionContext: "patient",
    turns: ["Age of the patient?"],
    checks: [{ turn: 0, kind: "answer", test: /36\b/i }],
  },
  {
    label: "DS11 patient name",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary11.cls.pdf",
    sectionContext: "patient",
    turns: ["Name of the patient?"],
    checks: [{ turn: 0, kind: "answer", test: /Reshma/i }],
  },
  {
    label: "DS11 principal diagnosis",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary11.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the diagnosis?"],
    checks: [{ turn: 0, kind: "answer", test: /G2P1L1/i }],
  },
  {
    label: "DS11 blood pressure",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary11.cls.pdf",
    sectionContext: "vitals",
    turns: ["What is the blood pressure?"],
    checks: [{ turn: 0, kind: "answer", test: /100\/60|120\/80|mmhg/i }],
  },
  {
    label: "DS11 pulse",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary11.cls.pdf",
    sectionContext: "vitals",
    turns: ["What is the pulse?"],
    checks: [{ turn: 0, kind: "answer", test: /\b86\b|\bbpm\b/i }],
  },
  {
    label: "DS12 diagnosis",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the diagnosis?"],
    checks: [{ turn: 0, kind: "answer", test: /thalamo capsular bleed/i }],
  },
  {
    label: "DS12 medicines prescribed",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "medications",
    turns: ["Medicines prescribed for the patient?"],
    checks: [{ turn: 0, kind: "answer", test: /MANNITOL|LASIX|LEVERA/i }],
  },
  {
    label: "DS12 investigations ordered",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "labs",
    turns: ["What investigations were ordered?"],
    checks: [{ turn: 0, kind: "answer", test: /CBC|CRP|SODIUM|POTASSIUM/i }],
  },
  {
    label: "DS12 LASIX external consent",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "medications",
    turns: ["Does INJ LASIX come with 10MG?", "yes"],
    checks: [
      { turn: 0, kind: "prompt", test: /Yes\/No/ },
      { turn: 1, kind: "answer", test: /20, 40 and 80mg|80 mg|did not find a reliable answer/i },
    ],
  },
  {
    label: "DS12 why BP low",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "vitals",
    turns: ["The patient's BP is less than reference, why?"],
    checks: [{ turn: 0, kind: "answer", test: /Patient Record|External Reference/i }],
  },
  {
    label: "DS13 patient name",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "patient",
    turns: ["Name of the patient?"],
    checks: [{ turn: 0, kind: "answer", test: /Prakriti/i }],
  },
  {
    label: "DS13 comorbidities",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What are the comorbidities?"],
    checks: [{ turn: 0, kind: "answer", test: /HTN|DM/i }],
  },
  {
    label: "DS13 STATOR purpose",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "medications",
    turns: ["why do we need STATOR? what does it do?"],
    checks: [{ turn: 0, kind: "answer", test: /STATOR/i }],
  },
  {
    label: "DS13 DAPAGLIFOZOLIN syrup",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "medications",
    turns: ["does TAB DAPAGLIFOZOLIN 10 come in syrup?", "yes"],
    checks: [
      { turn: 0, kind: "prompt", test: /Yes\/No/ },
      { turn: 1, kind: "answer", test: /DAPAGLIFOZOLIN|reliable answer/i },
    ],
  },
  {
    label: "DS9 diagnosis",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary9.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the diagnosis?"],
    checks: [{ turn: 0, kind: "answer", test: /Multiple myeloma/i }],
  },
  {
    label: "DS9 comorbidities",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary9.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What are the comorbidities?"],
    checks: [{ turn: 0, kind: "answer", test: /Diabetes|Hypertension/i }],
  },
  {
    label: "DS6 patient name",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary6.cls.pdf",
    sectionContext: "patient",
    turns: ["Name of the patient?"],
    checks: [{ turn: 0, kind: "answer", test: /Preetham/i }],
  },
  {
    label: "DS6 T.CILACAR M composition",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary6.cls.pdf",
    sectionContext: "medications",
    turns: ["What is the composition for: T.CILACAR M?", "yes"],
    checks: [
      { turn: 0, kind: "prompt", test: /Yes\/No/ },
      { turn: 1, kind: "answer", test: /CILACAR|reliable answer|medical sources/i },
    ],
  },
  {
    label: "DS5 diagnosis",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary5.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the diagnosis?"],
    checks: [{ turn: 0, kind: "answer", test: /Newborn/i }],
  },
  {
    label: "DS1 diagnosis",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary1.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the diagnosis?"],
    checks: [{ turn: 0, kind: "answer", test: /EAR PAIN/i }],
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

function evaluate(turns, checks) {
  const failures = [];
  for (const check of checks) {
    const turn = turns[check.turn];
    const value = check.kind === "prompt" ? turn.decision_prompt || "" : turn.answer || "";
    if (!check.test.test(value)) {
      failures.push({ turn: check.turn, kind: check.kind, expected: String(check.test), actual: value });
    }
  }
  return { passed: failures.length === 0, failures };
}

async function runCase(test) {
  const documentId = docId(test.docName);
  let chatId = crypto.randomUUID();
  const turns = [];

  for (const message of test.turns) {
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

  const verdict = evaluate(turns, test.checks);
  return {
    label: test.label,
    documentId,
    document: test.docName,
    passed: verdict.passed,
    failures: verdict.failures,
    turns,
  };
}

(async () => {
  const results = [];
  for (const test of cases) {
    const result = await runCase(test);
    results.push(result);
    fs.writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        {
          summary: {
            total: cases.length,
            completed: results.length,
            passed: results.filter((r) => r.passed).length,
            failed: results.filter((r) => !r.passed).length,
          },
          results,
        },
        null,
        2
      )
    );
    console.log(`[${results.length}/${cases.length}] ${result.passed ? "PASS" : "FAIL"} ${result.label}`);
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify({ summary, results }, null, 2));
})();
