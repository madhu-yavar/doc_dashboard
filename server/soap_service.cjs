const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");
const {
  buildLiveConversationDocument,
  hydrateLiveConversationDocument,
  isLiveConversationDocument,
} = require("./live_conversation_document.cjs");

const OUTPUT_DIR = path.join(__dirname, "storage", "soap_exports");

const DEFAULT_HOSPITAL = {
  name: "Manipal Hospitals",
  tagline: "Care • Safety • Trust",
  department: "GENERAL MEDICINE",
  branch: "Main Branch",
  address: "Manipal Hospitals",
};

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

function normalizeListItem(item) {
  if (typeof item === "string") return item.trim();
  if (typeof item === "number" || typeof item === "boolean") return String(item);
  if (!item || typeof item !== "object") return "";

  return firstText(
    item.name,
    item.label,
    item.value,
    item.text,
    item.summary,
    item.reason,
    item.description,
    item.finding,
    item.test_name,
    item.study_name,
    item.instructions,
    item.instruction,
    item.type,
  );
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeListItem(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const groupedEntries = [
    ["positive", value.positive],
    ["positives", value.positives],
    ["negative", value.negative],
    ["negatives", value.negatives],
    ["items", value.items],
    ["list", value.list],
    ["history", value.history],
  ];

  const grouped = groupedEntries.flatMap(([label, entry]) => {
    return normalizeTextList(entry).map((item) => {
      if (label === "positive" || label === "positives") return `Positive: ${item}`;
      if (label === "negative" || label === "negatives") return `Negative: ${item}`;
      return item;
    });
  });

  if (grouped.length > 0) {
    return grouped;
  }

  return Object.values(value).flatMap((entry) => normalizeTextList(entry));
}

function dedupe(items) {
  return Array.from(new Set(items.map((item) => asText(item)).filter(Boolean)));
}

function normalizeGenderLabel(value) {
  const normalized = asText(value).toLowerCase();
  if (!normalized) return "";
  if (["m", "male", "man", "boy", "ma"].includes(normalized) || normalized.startsWith("mal")) return "Male";
  if (["f", "female", "woman", "girl", "fe"].includes(normalized) || normalized.startsWith("fem")) return "Female";
  if (["other", "non-binary", "nonbinary"].includes(normalized)) return "Other";
  return asText(value);
}

function formatAgeSex(age, gender) {
  const ageLabel = Number.isFinite(age) ? `${age} Yrs` : asText(age);
  return [ageLabel, normalizeGenderLabel(gender)].filter(Boolean).join(" / ");
}

function formatDisplayDateTime(value) {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMedicationLine(medication) {
  if (typeof medication === "string") {
    return asText(medication);
  }

  if (!medication || typeof medication !== "object") {
    return "";
  }

  const name = firstText(medication.name, medication.label, medication.medicine);
  if (!name) return "";

  const detail = [
    firstText(medication.dose, medication.dosage),
    firstText(medication.frequency),
    firstText(medication.instruction, medication.instructions, medication.remarks),
  ].filter(Boolean);

  return detail.length > 0 ? `${name}: ${detail.join(" | ")}` : name;
}

function formatVitalEntries(extracted = {}, dashboardCards = {}) {
  const vitals = extracted.vitals || {};
  const latest = vitals.latest && typeof vitals.latest === "object" ? vitals.latest : {};
  const bp = latest.bp && typeof latest.bp === "object" ? latest.bp : vitals.bp || {};
  const pulse = latest.pulse && typeof latest.pulse === "object" ? latest.pulse : vitals.pulse || {};
  const temperature = latest.temperature && typeof latest.temperature === "object" ? latest.temperature : vitals.temperature || {};
  const spo2 = latest.spo2 && typeof latest.spo2 === "object" ? latest.spo2 : vitals.spo2 || {};
  const weight = latest.weight && typeof latest.weight === "object" ? latest.weight : vitals.weight || {};
  const summary = dashboardCards.vitals_card?.summary || {};

  const bloodPressure = summary.latest_bp
    || (
      Number.isFinite(bp?.systolic) && Number.isFinite(bp?.diastolic)
        ? `${bp.systolic}/${bp.diastolic}`
        : ""
    );

  const pulseValue = Number.isFinite(pulse?.value) ? `${pulse.value} ${pulse.unit || "bpm"}` : "";
  const temperatureValue = Number.isFinite(temperature?.value) ? `${temperature.value} ${temperature.unit || "F"}` : "";
  const spo2Value = Number.isFinite(spo2?.value) ? `${spo2.value}${spo2.unit ? ` ${spo2.unit}` : "%"}` : "";
  const weightValue = Number.isFinite(weight?.value) ? `${weight.value} ${weight.unit || "kg"}` : firstText(summary.weight);

  return dedupe([
    bloodPressure ? `Blood pressure: ${bloodPressure}` : "",
    pulseValue ? `Pulse: ${pulseValue}` : "",
    temperatureValue ? `Temperature: ${temperatureValue}` : "",
    spo2Value ? `SpO2: ${spo2Value}` : "",
    weightValue ? `Weight: ${weightValue}` : "",
  ]);
}

function principalDiagnosisText(diagnosis = {}, dashboardCards = {}) {
  return firstText(
    typeof diagnosis.principal === "string" ? diagnosis.principal : "",
    diagnosis.principal?.name,
    diagnosis.principal?.description,
    dashboardCards.diagnosis_card?.principal_diagnosis,
  );
}

function secondaryDiagnosisItems(diagnosis = {}, dashboardCards = {}) {
  return dedupe([
    ...normalizeTextList(diagnosis.secondary),
    ...normalizeTextList(dashboardCards.diagnosis_card?.secondary_diagnoses),
  ]);
}

function followUpItems(extracted = {}, dashboardCards = {}) {
  return dedupe([
    ...normalizeTextList(extracted.follow_up?.items),
    ...normalizeTextList(extracted.follow_up),
    ...normalizeTextList(dashboardCards.follow_up_card?.appointments),
    asText(dashboardCards.follow_up_card?.next_appointment)
      ? `Next appointment: ${dashboardCards.follow_up_card.next_appointment}`
      : "",
  ]);
}

function buildStandardHospital(extracted = {}, document = {}) {
  const hospitalInfo = extracted.hospital || extracted.stage1?.hospital || {};
  return {
    name: hospitalInfo.name || DEFAULT_HOSPITAL.name,
    tagline: hospitalInfo.tagline || DEFAULT_HOSPITAL.tagline,
    department: hospitalInfo.department || extracted.department || document.department || DEFAULT_HOSPITAL.department,
    branch: hospitalInfo.branch || DEFAULT_HOSPITAL.branch,
    address: hospitalInfo.address || DEFAULT_HOSPITAL.address,
  };
}

function buildVoiceHospital(extracted = {}, document = {}) {
  const hospitalInfo = extracted.hospital || extracted.stage1?.hospital || {};
  return {
    name: hospitalInfo.name || DEFAULT_HOSPITAL.name,
    tagline: hospitalInfo.tagline || DEFAULT_HOSPITAL.tagline,
    department: hospitalInfo.department || document.department || DEFAULT_HOSPITAL.department,
    branch: hospitalInfo.branch || DEFAULT_HOSPITAL.branch,
    address: hospitalInfo.address || DEFAULT_HOSPITAL.address,
  };
}

class SOAPService {
  constructor(config = {}) {
    this.name = "SOAPService";
    this.documentsRepository = config.documentsRepository || null;
    this.liveSessionsRepository = config.liveSessionsRepository || null;
  }

  async initialize() {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
  }

  async loadDocument(docId) {
    if (!this.documentsRepository) {
      throw new Error("SOAPService requires documentsRepository to be configured");
    }

    await this.documentsRepository.initialize();
    const document = await this.documentsRepository.findDocumentById(docId);

    if (document) {
      const legacyDocument = await this.transformPostgresDocumentToLegacy(document);
      if (isLiveConversationDocument(legacyDocument)) {
        hydrateLiveConversationDocument(legacyDocument);
      }
      return legacyDocument;
    }

    return this.loadLiveConversationDocument(docId);
  }

  async loadLiveConversationDocument(docId) {
    if (!this.liveSessionsRepository) {
      throw new Error("SOAPService requires liveSessionsRepository to be configured");
    }

    try {
      await this.liveSessionsRepository.initialize();
      const session = await this.liveSessionsRepository.query(`
        SELECT * FROM ${this.liveSessionsRepository.sessionsTableName}
        WHERE document_id = $1 OR id = $1
        LIMIT 1
      `, [docId.replace("voice-live-", "")]);

      if (!session || session.length === 0) return null;

      const sessionData = session[0];
      return buildLiveConversationDocument(sessionData, {
        documentId: sessionData.document_id || docId,
        createdAt: sessionData.ended_at || sessionData.updated_at || new Date().toISOString(),
        sttBackend: sessionData.stt_backend,
      });
    } catch (error) {
      console.error("Failed to load live conversation document:", error.message);
      return null;
    }
  }

  async transformPostgresDocumentToLegacy(pgDocument) {
    const [assets, extraction, chartNotes] = await Promise.all([
      this.documentsRepository.findAssetsByDocumentId(pgDocument.id).catch(() => []),
      this.documentsRepository.findCurrentExtraction(pgDocument.id).catch(() => null),
      this.documentsRepository.findChartNotesByDocumentId(pgDocument.id).catch(() => []),
    ]);

    let filePath = null;
    if (assets && assets.length > 0) {
      const primaryAsset = assets.find((asset) => asset.asset_role === "source_pdf" || asset.asset_role === "source_audio") || assets[0];
      if (primaryAsset?.path_or_uri) {
        filePath = primaryAsset.path_or_uri;
      }
    }

    let result = null;
    if (extraction) {
      result = {
        extracted_data: extraction.extracted_data_jsonb || {},
        meta: extraction.meta_jsonb || {},
        processedAt: extraction.created_at,
      };
    }

    let chartNote = null;
    if (chartNotes && chartNotes.length > 0) {
      const currentChartNote = chartNotes[0];
      chartNote = {
        content: currentChartNote.content || "",
        format: "text",
        createdAt: currentChartNote.created_at,
        createdBy: currentChartNote.created_by_user_id || "system",
      };
    }

    return {
      id: pgDocument.id,
      status: pgDocument.status === "completed" ? "processed" : pgDocument.status,
      name: pgDocument.name,
      size: pgDocument.size_bytes,
      uploadedAt: pgDocument.uploaded_at,
      processedAt: pgDocument.processed_at,
      department: pgDocument.department,
      filePath,
      hash: pgDocument.sha256_hash,
      error: pgDocument.error_message,
      documentType: pgDocument.document_type,
      documentSubtype: pgDocument.document_subtype,
      mimeType: pgDocument.mime_type,
      fileName: pgDocument.original_filename,
      linkedPatient: pgDocument.linked_patient_label,
      encounterLabel: pgDocument.encounter_label,
      result,
      chartNote,
    };
  }

  mapDocumentToSOAP(document) {
    const extracted = document?.result?.extracted_data || {};
    const meta = document?.result?.meta || {};

    if (document?.documentType === "voice" || meta?.sessionType === "live_conversation") {
      return this.mapVoiceToSOAP(document);
    }

    return this.mapStandardToSOAP(document);
  }

  mapStandardToSOAP(document) {
    const extracted = document?.result?.extracted_data || {};
    const dashboardCards = document?.result?.dashboard_cards || {};
    const meta = document?.result?.meta || {};
    const patient = extracted.patient || {};
    const doctor = extracted.doctor || {};
    const diagnosis = extracted.diagnosis || {};
    const treatment = extracted.treatment || {};
    const physicalExam = extracted.physical_exam || {};
    const investigations = dedupe([
      ...normalizeTextList(extracted.investigations),
      ...normalizeTextList(extracted.lab_investigations?.selected_tests),
      ...normalizeTextList(extracted.stage3?.lab_investigations?.selected_tests),
    ]);
    const imaging = dedupe([
      ...normalizeTextList(extracted.radiology),
      ...normalizeTextList(extracted.radiology_selections?.selected_studies),
      ...normalizeTextList(extracted.stage3?.radiology_selections?.selected_studies),
    ]);
    const medications = dedupe(
      asArray(extracted.medications || extracted.merged?.medications || dashboardCards.medications_card?.medication_list)
        .map((item) => formatMedicationLine(item))
        .filter(Boolean)
    );
    const allergies = normalizeTextList(extracted.allergies);
    const symptoms = dedupe([
      ...normalizeTextList(diagnosis.symptoms),
      ...normalizeTextList(extracted.symptoms),
    ]);
    const comorbidities = dedupe(normalizeTextList(diagnosis.comorbidities));
    const reviewOfSystems = normalizeTextList(extracted.review_of_systems);
    const referrals = dedupe([
      ...normalizeTextList(extracted.referrals),
      ...normalizeTextList(treatment.referrals),
      ...normalizeTextList(dashboardCards.follow_up_card?.referrals),
    ]);
    const differentialDiagnoses = dedupe([
      ...normalizeTextList(diagnosis.differential),
      ...normalizeTextList(extracted.differential_diagnosis),
    ]);
    const hospital = buildStandardHospital(extracted, document);
    const subjective = dedupe([
      asText(extracted.chief_complaint) ? `Chief complaint: ${extracted.chief_complaint}` : "",
      asText(extracted.hpi) ? `HPI: ${extracted.hpi}` : "",
      symptoms.length > 0 ? `Symptoms: ${symptoms.join(", ")}` : "",
      reviewOfSystems.length > 0
        ? `Review of systems: ${reviewOfSystems.join(", ")}`
        : "",
      allergies.length > 0 ? `Allergies: ${allergies.join(", ")}` : "",
      comorbidities.length > 0 ? `Past history: ${comorbidities.join(", ")}` : "",
    ]);
    const objective = dedupe([
      ...formatVitalEntries(extracted, dashboardCards),
      ...normalizeTextList(physicalExam.abnormal_findings).map((item) => `Physical exam: ${item}`),
      ...normalizeTextList(physicalExam.normal_findings).map((item) => `Normal exam: ${item}`),
      investigations.length > 0 ? `Labs / investigations: ${investigations.join(", ")}` : "",
      imaging.length > 0 ? `Imaging / radiology: ${imaging.join(", ")}` : "",
      ...normalizeTextList(treatment.procedures).map((item) => `Procedure: ${item}`),
    ]);
    const primaryDiagnosis = principalDiagnosisText(diagnosis, dashboardCards);
    const secondaryDiagnoses = secondaryDiagnosisItems(diagnosis, dashboardCards);
    const assessment = dedupe([
      primaryDiagnosis ? `Primary diagnosis: ${primaryDiagnosis}` : "",
      secondaryDiagnoses.length > 0 ? `Secondary diagnoses: ${secondaryDiagnoses.join(", ")}` : "",
      differentialDiagnoses.length > 0 ? `Differential diagnosis: ${differentialDiagnoses.join(", ")}` : "",
      comorbidities.length > 0 ? `Risk factors / comorbidities: ${comorbidities.join(", ")}` : "",
      asText(treatment.response) ? `Clinical response: ${treatment.response}` : "",
      asText(document.chartNote?.content) ? "Chart note available for clinician review." : "",
    ]);
    const plan = dedupe([
      medications.length > 0 ? `Medications: ${medications.join("; ")}` : "",
      asText(treatment.current_approach) ? `Management approach: ${treatment.current_approach}` : "",
      ...normalizeTextList(treatment.management_items).map((item) => `Plan item: ${item}`),
      ...normalizeTextList(treatment.procedures).map((item) => `Procedure plan: ${item}`),
      ...referrals.map((item) => `Referral: ${item}`),
      ...followUpItems(extracted, dashboardCards).map((item) => `Follow-up: ${item}`),
      ...normalizeTextList(extracted.pending_items?.pending_discharge_items).map((item) => `Pending item: ${item}`),
      ...normalizeTextList(extracted.discharge?.instructions).map((item) => `Instruction: ${item}`),
      ...normalizeTextList(extracted.discharge?.red_flags).map((item) => `Red flag: ${item}`),
    ]);

    return {
      hospital,
      patient: {
        name: patient.name || "Patient Name",
        ageSex: formatAgeSex(patient.age, patient.gender) || "N/A",
        hospitalNo: patient.mrn || patient.hospital_number || "",
        mobile: patient.mobile || "",
        email: patient.email || "",
      },
      visit: {
        episodeNo: meta.episode_number || extracted.patient?.episode_number || "",
        dateTime: meta.rx_date || extracted.visit?.date || document.processedAt || document.uploadedAt || new Date().toISOString(),
      },
      consultant: {
        name: doctor.name || "Doctor Name",
        regNo: doctor.registration_number || doctor.reg_no || "",
        department: hospital.department,
      },
      soap: {
        subjective: subjective.length > 0 ? subjective : ["Subjective history requires clinician review."],
        objective: objective.length > 0 ? objective : ["Objective findings are limited in the extracted record."],
        assessment: assessment.length > 0 ? assessment : ["Assessment pending clinician review."],
        plan: plan.length > 0 ? plan : ["Plan pending clinician review."],
      },
      _metadata: {
        sourceDocument: document.name,
        sourceDocumentId: document.id,
        generatedAt: new Date().toISOString(),
        department: document.department || "",
        noteType: "SOAP",
      },
    };
  }

  mapVoiceToSOAP(document) {
    const extracted = document?.result?.extracted_data || {};
    const meta = document?.result?.meta || {};
    const dashboardCards = document?.result?.dashboard_cards || {};
    const patient = extracted.patient_info || extracted.patient || {};
    const hospital = buildVoiceHospital(extracted, document);
    const diagnosis = extracted.diagnosis || {};
    const diagnosisText = firstText(
      typeof diagnosis === "string" ? diagnosis : "",
      diagnosis.principal?.name,
      diagnosis.principal?.description,
      dashboardCards.diagnosis_card?.principal_diagnosis,
    );
    const symptoms = dedupe([
      ...normalizeTextList(extracted.symptoms),
      ...normalizeTextList(diagnosis.symptoms),
    ]);
    const ros = dedupe([
      ...normalizeTextList(extracted.ros),
      ...normalizeTextList(extracted.review_of_systems),
    ]);
    const pastHistory = dedupe([
      ...normalizeTextList(extracted.pastHistory),
      ...normalizeTextList(extracted.past_history),
      ...normalizeTextList(diagnosis.comorbidities),
    ]);
    const labs = dedupe([
      ...normalizeTextList(extracted.labs),
      ...normalizeTextList(extracted.investigations),
    ]);
    const radiology = dedupe(normalizeTextList(extracted.radiology));
    const medications = dedupe(asArray(extracted.medications).map((item) => formatMedicationLine(item)).filter(Boolean));
    const allergies = dedupe(normalizeTextList(extracted.allergies));
    const planItems = dedupe([
      ...normalizeTextList(extracted.plan),
      ...normalizeTextList(extracted.treatment?.management_items),
    ]);
    const followUp = dedupe([
      ...normalizeTextList(extracted.followUp),
      ...normalizeTextList(extracted.follow_up?.items),
      ...normalizeTextList(extracted.follow_up),
    ]);
    const procedures = dedupe(normalizeTextList(extracted.procedures));
    const referrals = dedupe([
      ...normalizeTextList(extracted.referrals),
      ...normalizeTextList(extracted.follow_up?.referrals),
    ]);

    const subjective = dedupe([
      asText(extracted.chief_complaint || extracted.chiefComplaint)
        ? `Chief complaint: ${firstText(extracted.chief_complaint, extracted.chiefComplaint)}`
        : "",
      asText(extracted.hpi) ? `HPI: ${extracted.hpi}` : "",
      ros.length > 0 ? `Review of systems: ${ros.join(", ")}` : "",
      symptoms.length > 0 ? `Symptoms: ${symptoms.join(", ")}` : "",
      pastHistory.length > 0 ? `Past history: ${pastHistory.join(", ")}` : "",
      allergies.length > 0 ? `Allergies: ${allergies.join(", ")}` : "",
    ]);
    const objective = dedupe([
      ...formatVitalEntries(extracted, dashboardCards),
      labs.length > 0 ? `Labs / investigations: ${labs.join(", ")}` : "",
      radiology.length > 0 ? `Imaging / radiology: ${radiology.join(", ")}` : "",
      procedures.length > 0 ? `Procedures: ${procedures.join(", ")}` : "",
    ]);
    const assessment = dedupe([
      diagnosisText ? `Primary diagnosis: ${diagnosisText}` : "",
      pastHistory.length > 0 ? `Comorbidities: ${pastHistory.join(", ")}` : "",
    ]);
    const plan = dedupe([
      medications.length > 0 ? `Medications: ${medications.join("; ")}` : "",
      planItems.length > 0 ? `Management plan: ${planItems.join("; ")}` : "",
      ...referrals.map((item) => `Referral: ${item}`),
      followUp.length > 0 ? `Follow-up: ${followUp.join("; ")}` : "",
    ]);

    return {
      hospital,
      patient: {
        name: patient.name || meta.patientName || document.linkedPatient || "Voice Patient",
        ageSex: formatAgeSex(patient.age, patient.gender) || "N/A",
        hospitalNo: patient.mrn || patient.hospital_no || patient.hospitalNo || document.encounterLabel || "",
        mobile: "",
        email: "",
      },
      visit: {
        episodeNo: meta.sessionId || document.id,
        dateTime: document.processedAt || document.uploadedAt || new Date().toISOString(),
      },
      consultant: {
        name: document.createdBy?.username || "Doctor",
        regNo: "",
        department: hospital.department,
      },
      soap: {
        subjective: subjective.length > 0 ? subjective : ["Subjective history was not captured clearly in the live session."],
        objective: objective.length > 0 ? objective : ["Objective findings are limited in the live draft."],
        assessment: assessment.length > 0 ? assessment : ["Assessment pending clinician review."],
        plan: plan.length > 0 ? plan : ["Plan pending clinician review."],
      },
      _metadata: {
        sourceDocument: document.fileName || document.name || "Conversation - Live",
        sourceDocumentId: document.id,
        generatedAt: new Date().toISOString(),
        department: hospital.department,
        noteType: "SOAP",
        sessionType: "live_conversation",
      },
    };
  }

  async readLogoDataUri(fileName) {
    const filePath = path.join(__dirname, "..", "public", fileName);
    try {
      const bytes = await fs.readFile(filePath);
      return `data:image/png;base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  }

  renderSection(letter, title, items) {
    const renderedItems = items.length > 0
      ? `<ul class="soap-row__list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p class="soap-row__empty">No structured ${escapeHtml(title.toLowerCase())} details were available.</p>`;

    return `
      <section class="soap-row soap-row--${escapeHtml(letter.toLowerCase())}">
        <div class="soap-row__label">
          <div class="soap-row__letter">${escapeHtml(letter)}</div>
          <div class="soap-row__title">${escapeHtml(title)}</div>
        </div>
        <div class="soap-row__body">
          ${renderedItems}
        </div>
      </section>
    `;
  }

  async renderSOAPHTML(data) {
    const manipalLogo = await this.readLogoDataUri("manipal-logo.png");
    const yavarLogo = await this.readLogoDataUri("yavar-logo.png");
    const departmentLabel = [data.hospital.department, data.hospital.branch].filter(Boolean).join(" • ");
    const patientMetaRows = [
      ["Patient Name", data.patient.name || "N/A", "Age / Sex", data.patient.ageSex || "N/A"],
      ["Hospital No", data.patient.hospitalNo || "N/A", "Visit / Episode", data.visit.episodeNo || "N/A"],
      ["Consultant", data.consultant.name || "N/A", "Department", data.consultant.department || data.hospital.department || "N/A"],
      ["Date / Time", formatDisplayDateTime(data.visit.dateTime), "Source", data._metadata?.sessionType === "live_conversation" ? "Live Conversation" : "Processed Document"],
    ];
    const generatedAtLabel = formatDisplayDateTime(data._metadata?.generatedAt || new Date().toISOString());

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SOAP Note - ${escapeHtml(data.patient.name || data._metadata?.sourceDocumentId || "Document")}</title>
    <style>
      :root {
        --brand: #0f766e;
        --brand-deep: #115e59;
        --ink: #111827;
        --muted: #6b7280;
        --line: #cbd5e1;
        --paper: #ffffff;
        --panel: #f8fafc;
        --soft: #eff6ff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 18px;
        font-family: "Aptos", "Segoe UI", Arial, sans-serif;
        color: var(--ink);
        background: #f3f4f6;
      }
      .template-14 {
        max-width: 840px;
        margin: 0 auto;
        border: 1px solid var(--line);
        background: var(--paper);
        box-shadow: 0 12px 24px rgba(15, 23, 42, 0.05);
      }
      .form-header {
        padding: 14px 18px 10px;
        border-bottom: 2px solid var(--brand-deep);
      }
      .form-header__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
      }
      .form-header__brand,
      .form-header__partner {
        display: flex;
        align-items: center;
      }
      .form-header__brand img {
        display: block;
        max-height: 26px;
        width: auto;
      }
      .form-header__center {
        flex: 1;
        text-align: center;
        padding: 0 12px;
      }
      .form-header__title {
        margin: 0;
        font-size: 17px;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: var(--brand-deep);
      }
      .form-header__partner {
        justify-content: flex-end;
        min-width: 72px;
      }
      .form-header__partner img {
        display: block;
        max-height: 14px;
        width: auto;
      }
      .meta-table-wrap {
        padding: 0 18px;
      }
      .meta-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        margin-top: 8px;
      }
      .meta-table td {
        border: 1px solid var(--line);
        padding: 7px 8px;
        vertical-align: top;
      }
      .meta-table__label {
        width: 17%;
        background: var(--panel);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .meta-table__value {
        width: 33%;
        font-size: 11px;
        font-weight: 600;
      }
      .soap-body {
        padding: 12px 18px 18px;
      }
      .soap-body__title {
        margin: 0 0 10px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--brand-deep);
      }
      .soap-stack {
        display: grid;
        gap: 8px;
      }
      .soap-row {
        display: grid;
        grid-template-columns: 118px minmax(0, 1fr);
        border: 1px solid var(--line);
      }
      .soap-row__label {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 2px;
        padding: 10px 10px 10px 12px;
        border-right: 1px solid var(--line);
        background: var(--panel);
      }
      .soap-row__letter {
        font-size: 13px;
        font-weight: 700;
        color: var(--brand-deep);
      }
      .soap-row__title {
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .soap-row__body {
        padding: 10px 12px;
      }
      .soap-row__list {
        margin: 0;
        padding: 0 0 0 16px;
      }
      .soap-row__list li {
        margin: 0 0 5px;
        font-size: 11px;
        line-height: 1.45;
      }
      .soap-row__empty {
        margin: 0;
        font-size: 11px;
        color: var(--muted);
      }
      .form-footer {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        border-top: 1px solid var(--line);
        padding: 9px 18px 12px;
        font-size: 9px;
        color: var(--muted);
      }
      @media print {
        body { background: white; padding: 0; }
        .template-14 { box-shadow: none; border: 0; }
      }
    </style>
  </head>
  <body>
    <div class="template-14">
      <header class="form-header">
        <div class="form-header__top">
          <div class="form-header__brand">
            ${manipalLogo ? `<img src="${manipalLogo}" alt="Manipal Hospitals" />` : ""}
          </div>
          <div class="form-header__center">
            <h1 class="form-header__title">SOAP Clinical Note</h1>
          </div>
          <div class="form-header__partner">
            ${yavarLogo ? `<img src="${yavarLogo}" alt="Yavar" />` : ""}
          </div>
        </div>
      </header>
      <div class="meta-table-wrap">
        <table class="meta-table" aria-label="Patient and visit details">
          <tbody>
            ${patientMetaRows.map(([labelA, valueA, labelB, valueB]) => `
              <tr>
                <td class="meta-table__label">${escapeHtml(labelA)}</td>
                <td class="meta-table__value">${escapeHtml(valueA)}</td>
                <td class="meta-table__label">${escapeHtml(labelB)}</td>
                <td class="meta-table__value">${escapeHtml(valueB)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <main class="soap-body">
        <h2 class="soap-body__title">SOAP Note</h2>
        <div class="soap-stack">
          ${this.renderSection("S", "Subjective", data.soap.subjective || [])}
          ${this.renderSection("O", "Objective", data.soap.objective || [])}
          ${this.renderSection("A", "Assessment", data.soap.assessment || [])}
          ${this.renderSection("P", "Plan", data.soap.plan || [])}
        </div>
      </main>
      <footer class="form-footer">
        <span>Clinician review and signature required before clinical use.</span>
        <span>Generated ${escapeHtml(generatedAtLabel)}</span>
      </footer>
    </div>
  </body>
</html>`;
  }

  async generatePDF(html, outputPath) {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.pdf({
        path: outputPath,
        format: "A4",
        printBackground: true,
        margin: {
          top: "10mm",
          right: "10mm",
          bottom: "10mm",
          left: "10mm",
        },
      });
      await browser.close();
      return outputPath;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  async generateSOAP(docId, options = {}) {
    const { format = "pdf" } = options;
    const document = await this.loadDocument(docId);
    if (!document) {
      throw new Error(`Document not found: ${docId}`);
    }

    const soapData = this.mapDocumentToSOAP(document);
    const html = await this.renderSOAPHTML(soapData);
    const baseName = (document.name || document.fileName || docId).replace(/\.(pdf|png|jpg|jpeg|webm|mp4)$/i, "");
    const timestamp = Date.now();
    const htmlFileName = `${baseName}_soap_${timestamp}.html`;
    const pdfFileName = `${baseName}_soap_${timestamp}.pdf`;
    const htmlPath = path.join(OUTPUT_DIR, htmlFileName);
    const pdfPath = path.join(OUTPUT_DIR, pdfFileName);

    const result = {
      success: true,
      documentId: docId,
      documentName: document.name,
      data: soapData,
      urls: {},
      paths: {},
    };

    if (format === "html" || format === "both") {
      await fs.writeFile(htmlPath, html);
      result.urls.html = `/soap-exports/${htmlFileName}`;
      result.paths.html = htmlPath;
    }

    if (format === "pdf" || format === "both") {
      await this.generatePDF(html, pdfPath);
      result.urls.pdf = `/soap-exports/${pdfFileName}`;
      result.paths.pdf = pdfPath;
    }

    return result;
  }

  async getSOAPData(docId) {
    const document = await this.loadDocument(docId);
    if (!document) {
      throw new Error(`Document not found: ${docId}`);
    }
    return this.mapDocumentToSOAP(document);
  }
}

module.exports = { SOAPService };
