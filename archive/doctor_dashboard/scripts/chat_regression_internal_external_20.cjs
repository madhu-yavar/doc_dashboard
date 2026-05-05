const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DOCS_PATH = path.join(ROOT, "server/storage/documents.json");
const REPORT_PATH = path.join(ROOT, "server/storage/chat_regression_internal_external_20_report.json");
const API_BASE = "http://localhost:8001";

const documents = JSON.parse(fs.readFileSync(DOCS_PATH, "utf8")).documents || [];
const idByName = new Map(documents.map((doc) => [doc.name, doc.id]));

function docId(name) {
  const id = idByName.get(name);
  if (!id) throw new Error(`Missing document for ${name}`);
  return id;
}

const internalCases = [
  {
    label: "INT-01 DS12 patient name",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "patient",
    turns: ["What is the patient name?"],
    expect: /Amit/i,
  },
  {
    label: "INT-02 DS12 patient age",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "patient",
    turns: ["How old is the patient?"],
    expect: /\b51\b/,
  },
  {
    label: "INT-03 DS12 diagnosis",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the principal diagnosis?"],
    expect: /thalamo capsular bleed/i,
  },
  {
    label: "INT-04 DS12 medications",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "medications",
    turns: ["List the medicines prescribed."],
    expect: /MANNITOL|LASIX|LEVERA/i,
  },
  {
    label: "INT-05 DS12 investigations",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "labs",
    turns: ["Which investigations were ordered?"],
    expect: /CBC|CRP|SODIUM|POTASSIUM/i,
  },
  {
    label: "INT-06 DS13 patient name",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "patient",
    turns: ["Who is the patient?"],
    expect: /Prakriti/i,
  },
  {
    label: "INT-07 DS13 comorbidities",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What comorbidities are documented?"],
    expect: /HTN|DM/i,
  },
  {
    label: "INT-08 DS9 diagnosis",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary9.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What cancer diagnosis is documented?"],
    expect: /Multiple myeloma/i,
  },
  {
    label: "INT-09 DS6 patient name",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary6.cls.pdf",
    sectionContext: "patient",
    turns: ["What is the patient's name?"],
    expect: /Preetham/i,
  },
  {
    label: "INT-10 DS5 diagnosis",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary5.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the diagnosis?"],
    expect: /Newborn/i,
  },
];

const externalCases = [
  {
    label: "EXT-01 DS12 LASIX strength",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "medications",
    turns: ["Does INJ LASIX come with 10MG?", "yes"],
  },
  {
    label: "EXT-02 DS6 T.CILACAR M composition",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary6.cls.pdf",
    sectionContext: "medications",
    turns: ["What is the composition for: T.CILACAR M?", "yes"],
  },
  {
    label: "EXT-03 DS13 DAPAGLIFOZOLIN syrup",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "medications",
    turns: ["Does TAB DAPAGLIFOZOLIN 10 come in syrup?", "yes"],
  },
  {
    label: "EXT-04 DS13 STATOR purpose",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "medications",
    turns: ["Why do we need STATOR? What does it do?"],
  },
  {
    label: "EXT-05 DS13 STATOR reflux",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary13.cls.pdf",
    sectionContext: "medications",
    turns: ["Can STATOR cause acid reflux?", "yes"],
  },
  {
    label: "EXT-06 DS12 mannitol use",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "medications",
    turns: ["What does mannitol do?", "yes"],
  },
  {
    label: "EXT-07 DS1 augmentin use",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary1.cls.pdf",
    sectionContext: "medications",
    turns: ["What is Augmentin used for?", "yes"],
  },
  {
    label: "EXT-08 DS9 pan role",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary9.cls.pdf",
    sectionContext: "medications",
    turns: ["What does PAN 40 mg do?", "yes"],
  },
  {
    label: "EXT-09 DS9 ICD code",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary9.cls.pdf",
    sectionContext: "diagnosis",
    turns: ["What is the ICD code for multiple myeloma?"],
  },
  {
    label: "EXT-10 DS12 low BP explanation",
    docName: "Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf",
    sectionContext: "vitals",
    turns: ["Why is the patient's blood pressure low?"],
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

async function runCase(test, kind) {
  const documentId = docId(test.docName);
  let chatId = crypto.randomUUID();
  const turns = [];

  for (let index = 0; index < test.turns.length; index += 1) {
    const message = test.turns[index];
    if (String(message).toLowerCase() === "yes" && turns.length) {
      const prior = turns[turns.length - 1];
      if (prior.decision_prompt !== "Yes/No") {
        continue;
      }
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

  let passed = true;
  let note = "";

  if (kind === "internal") {
    passed = test.expect.test(turns[0].answer);
    note = passed ? "matched expected answer pattern" : `expected ${String(test.expect)}, got: ${turns[0].answer}`;
  } else {
    const first = turns[0];
    const last = turns[turns.length - 1];
    const askedConsent = first.decision_prompt === "Yes/No";
    const externalCitations = last.citations.filter((c) => c.source_class === "external");
    const usedExternal = last.source_class === "external" || last.source_class === "mixed";

    if (turns.length > 1) {
      passed = askedConsent && usedExternal;
    } else {
      passed = usedExternal;
    }

    if (externalCitations.length) {
      note = `external evidence present (${externalCitations.length} citations)`;
    } else if (/searched approved external medical sources/i.test(last.answer)) {
      note = "external search attempted but no reliable external result";
    } else {
      note = `unexpected final behavior: ${last.answer}`;
    }
  }

  return {
    kind,
    label: test.label,
    documentId,
    document: test.docName,
    passed,
    note,
    turns,
  };
}

(async () => {
  const results = [];

  for (const test of internalCases) {
    const result = await runCase(test, "internal");
    results.push(result);
    console.log(`[${results.length}/20] ${result.passed ? "PASS" : "FAIL"} ${result.label}`);
  }

  for (const test of externalCases) {
    const result = await runCase(test, "external");
    results.push(result);
    console.log(`[${results.length}/20] ${result.passed ? "PASS" : "FAIL"} ${result.label}`);
  }

  const summary = {
    total: results.length,
    internal: {
      total: results.filter((r) => r.kind === "internal").length,
      passed: results.filter((r) => r.kind === "internal" && r.passed).length,
      failed: results.filter((r) => r.kind === "internal" && !r.passed).length,
    },
    external: {
      total: results.filter((r) => r.kind === "external").length,
      passed: results.filter((r) => r.kind === "external" && r.passed).length,
      failed: results.filter((r) => r.kind === "external" && !r.passed).length,
      with_external_citations: results.filter(
        (r) => r.kind === "external" && r.turns[r.turns.length - 1].citations.some((c) => c.source_class === "external")
      ).length,
      attempted_without_external_result: results.filter(
        (r) => r.kind === "external" && /searched approved external medical sources/i.test(r.turns[r.turns.length - 1].answer)
      ).length,
    },
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify({ summary, results }, null, 2));
})();
