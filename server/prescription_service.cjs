/**
 * Prescription Generation Service
 * Generates HTML and PDF prescriptions from processed document data
 */

const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");
const {
  buildLiveConversationDocument,
  hydrateLiveConversationDocument,
  isLiveConversationDocument,
} = require("./live_conversation_document.cjs");

const TEMPLATE_DIR = path.join(__dirname, "..", "prescription_template_dev");
const OUTPUT_DIR = path.join(__dirname, "storage", "prescriptions");

// Default hospital configuration (fallback)
const DEFAULT_HOSPITAL = {
  name: "Manipal Hospitals",
  tagline: "Care • Safety • Trust",
  department: "INTERNAL MEDICINE",
  branch: "Main Branch",
  address: "Manipal Hospitals | Phone: 1800 123 4567"
};

class PrescriptionService {
  constructor(config = {}) {
    this.name = "PrescriptionService";
    // Phase 6: Inject repositories for Postgres-only access
    this.documentsRepository = config.documentsRepository || null;
    this.liveSessionsRepository = config.liveSessionsRepository || null;
  }

  /**
   * Initialize the service - ensure output directory exists
   */
  async initialize() {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
  }

  /**
   * Load document data from Postgres (Phase 6: no filesystem reads)
   */
  async loadDocument(docId) {
    // Phase 6: Use repository instead of direct file reads
    if (!this.documentsRepository) {
      throw new Error('PrescriptionService requires documentsRepository to be configured');
    }

    await this.documentsRepository.initialize();
    const document = await this.documentsRepository.findDocumentById(docId);

    if (document) {
      // Transform Postgres document to legacy format for compatibility
      const legacyDoc = await this.transformPostgresDocumentToLegacy(document);
      if (isLiveConversationDocument(legacyDoc)) {
        hydrateLiveConversationDocument(legacyDoc);
      }
      return legacyDoc;
    }

    return this.loadLiveConversationDocument(docId);
  }

  async loadLiveConversationDocument(docId) {
    // Phase 6: Use repository instead of direct file reads
    if (!this.liveSessionsRepository) {
      throw new Error('PrescriptionService requires liveSessionsRepository to be configured');
    }

    try {
      await this.liveSessionsRepository.initialize();

      // Try to find by document_id first
      const session = await this.liveSessionsRepository.query(`
        SELECT * FROM ${this.liveSessionsRepository.sessionsTableName}
        WHERE document_id = $1 OR id = $1
        LIMIT 1
      `, [docId.replace('voice-live-', '')]);

      if (!session || session.length === 0) return null;

      const sessionData = session[0];

      // Build legacy document format
      return buildLiveConversationDocument(sessionData, {
        documentId: sessionData.document_id || docId,
        createdAt: sessionData.ended_at || sessionData.updated_at || new Date().toISOString(),
        sttBackend: sessionData.stt_backend,
      });
    } catch (error) {
      console.error('Failed to load live conversation document:', error.message);
      return null;
    }
  }

  /**
   * Transform Postgres document to legacy format for compatibility
   */
  async transformPostgresDocumentToLegacy(pgDocument) {
    // Fetch related data
    const [assets, extraction, chartNotes] = await Promise.all([
      this.documentsRepository.findAssetsByDocumentId(pgDocument.id).catch(() => []),
      this.documentsRepository.findCurrentExtraction(pgDocument.id).catch(() => null),
      this.documentsRepository.findChartNotesByDocumentId(pgDocument.id).catch(() => [])
    ]);

    // Reconstruct filePath from assets
    let filePath = null;
    if (assets && assets.length > 0) {
      const primaryAsset = assets.find(a => a.asset_role === 'source_pdf' || a.asset_role === 'source_audio') || assets[0];
      if (primaryAsset && primaryAsset.path_or_uri) {
        filePath = primaryAsset.path_or_uri;
      }
    }

    // Reconstruct result from extraction
    let result = null;
    if (extraction) {
      result = {
        extracted_data: extraction.extracted_data_jsonb || {},
        meta: extraction.meta_jsonb || {},
        processedAt: extraction.created_at
      };
    }

    // Reconstruct chartNote
    let chartNote = null;
    if (chartNotes && chartNotes.length > 0) {
      const currentChartNote = chartNotes[0];
      chartNote = {
        content: currentChartNote.content || '',
        format: 'text',
        createdAt: currentChartNote.created_at,
        createdBy: currentChartNote.created_by_user_id || 'system'
      };
    }

    return {
      id: pgDocument.id,
      status: pgDocument.status === 'completed' ? 'processed' : pgDocument.status,
      name: pgDocument.name,
      size: pgDocument.size_bytes,
      uploadedAt: pgDocument.uploaded_at,
      processedAt: pgDocument.processed_at,
      department: pgDocument.department,
      filePath: filePath,
      hash: pgDocument.sha256_hash,
      error: pgDocument.error_message,
      documentType: pgDocument.document_type,
      documentSubtype: pgDocument.document_subtype,
      mimeType: pgDocument.mime_type,
      fileName: pgDocument.original_filename,
      linkedPatient: pgDocument.linked_patient_label,
      encounterLabel: pgDocument.encounter_label,
      result: result,
      chartNote: chartNote
    };
  }

  /**
   * Map dashboard prescription data to template format
   */
  mapDashboardToPrescription(document) {
    const extracted = document.result.extracted_data || {};
    const meta = document.result.meta || {};
    const dashboardCards = document.result.dashboard_cards || {};

    // Check if this is a voice document and handle differently
    if (document.documentType === "voice" || meta?.sessionType === "live_conversation") {
      return this.mapVoiceToPrescription(document);
    }

    // Patient info
    const patient = extracted.patient || {};
    const age = patient.age || "";
    const gender = patient.gender || "";

    // Doctor info
    const doctor = extracted.doctor || {};

    // Diagnosis
    const diagnosis = extracted.diagnosis || {};
    const principalDiagnosis = diagnosis.principal || dashboardCards.diagnosis_card?.principal_diagnosis || "";
    const secondaryDiagnoses = diagnosis.secondary || dashboardCards.diagnosis_card?.secondary_diagnoses || [];

    // Medications - map to template format
    const medsList = extracted.medications || extracted.merged?.medications || dashboardCards.medications_card?.medication_list || [];
    const medications = medsList.map((med, idx) => {
      const name = med.name?.toUpperCase() || "";
      const dose = med.dose || med.dosage || "";
      const frequency = med.frequency?.toLowerCase() || "";
      const instruction = (med.instruction || med.instructions || "").toLowerCase();

      // Parse timing from both frequency and instruction
      const timingText = `${frequency} ${instruction}`;

      // Check for specific timing words
      const hasMorning = /morning/i.test(timingText);
      const hasNoon = /noon|afternoon/i.test(timingText);
      const hasNight = /night|bed|evening|at night|hs/i.test(timingText);

      // Check for frequency abbreviations
      const tds = /\btds\b|tid|3\s*times|thrice/i.test(timingText);
      const bd = /\bbd\b|bis.*die|2\s*times|twice/i.test(timingText);
      const qid = /\bqid\b|4\s*times|four\s*times/i.test(timingText);
      const od = /\bod\b|daily|once.*daily|omne.*die/i.test(timingText);

      // Determine timing based on frequency
      let morning = hasMorning;
      let noon = hasNoon;
      let night = hasNight;

      if (tds) {
        morning = true;
        noon = true;
        night = true;
      } else if (bd) {
        morning = true;
        night = true;
      } else if (qid) {
        morning = true;
        noon = true;
        night = true;
      } else if (od) {
        if (!morning && !noon && !night) {
          morning = true;
        }
      }

      // Extract days from instruction
      const daysMatch = instruction.match(/(\d+)\s*days?/i);
      const days = daysMatch ? daysMatch[1] : "";

      return {
        srNo: idx + 1,
        name: name,
        dose: dose,
        morning: morning,
        noon: noon,
        night: night,
        days: days,
        remarks: (med.instruction || med.instructions || frequency).replace(dose, "").trim() || frequency
      };
    }).filter(m => m.name);

    // Ensure minimum 8 rows
    while (medications.length < 8) {
      medications.push({
        srNo: "",
        name: "",
        dose: "",
        morning: false,
        noon: false,
        night: false,
        days: "",
        remarks: ""
      });
    }

    // Labs - map to checkboxes
    const labListRaw = extracted.lab_investigations?.selected_tests || extracted.merged?.lab_investigations?.selected_tests || extracted.stage3?.lab_investigations?.selected_tests || [];
    const labList = labListRaw.map(lab => typeof lab === 'string' ? lab : lab.test_name || lab.name || '');

    const labKeywords = {
      cbc: ["cbc", "complete blood", "hemogram", "complete blood count"],
      glucoseRandom: ["glucose random", "blood sugar random", "rbs", "random blood sugar"],
      srCreat: ["s.creat", "creatinine", "serum creatinine", "s. creat"],
      denguePanel: ["dengue", "ns1", "dengue panel"],
      thyroidProfile: ["thyroid", "tsh", "t3", "t4", "thyroid profile"],
      dDimer: ["d-dimer", "d dimer", "d dimer assay"],
      sgpt: ["sgpt", "alt", "sgpt/alt"],
      esr: ["esr", "erythrocyte sedimentation"],
      bun: ["bun", "blood urea", "blood urea nitrogen"],
      electrolytes: ["electrolyte", "sodium", "potassium", "electrolytes"],
      hba1c: ["hba1c", "glycated hemoglobin", "glycosylated hemoglobin", "hba 1c"],
      lipidProfile: ["lipid profile", "cholesterol", "tg", "hdl", "ldl", "triglycerides"],
      urineRoutine: ["urine routine", "urine microscopy", "routine and microscopy", "routine microscopy"],
      lft: ["lft", "liver function", "liver function test"]
    };

    const labs = { other: "" };
    Object.keys(labKeywords).forEach(key => {
      labs[key] = labList.some(lab =>
        labKeywords[key].some(kw => lab.toLowerCase().includes(kw))
      );
    });

    const otherLabs = labList.filter(lab =>
      !Object.values(labKeywords).flat().some(kw => lab.toLowerCase().includes(kw))
    );
    labs.other = otherLabs.join(", ");

    // Radiology
    const radioListRaw = extracted.merged?.radiology_selections?.selected_studies || extracted.radiology_selections?.selected_studies || extracted.radiology || extracted.stage3?.radiology_selections?.selected_studies || [];
    const radioList = radioListRaw.map(radio => typeof radio === 'string' ? radio : radio.study_name || radio.name || '');

    const radioKeywords = {
      xrayChestPa: ["xray", "chest", "x-ray", "cxr"],
      usgAbdPelvis: ["usg", "ultrasound", "abdomen", "pelvis", "kub"],
      mriBrain: ["mri", "brain"],
      ctThoraxHrct: ["ct", "chest", "hrct"]
    };

    const radiology = { other: "" };
    Object.keys(radioKeywords).forEach(key => {
      radiology[key] = radioList.some(radio =>
        radioKeywords[key].some(kw => radio.toLowerCase().includes(kw))
      );
    });

    const otherRadio = radioList.filter(radio =>
      !Object.values(radioKeywords).flat().some(kw => radio.toLowerCase().includes(kw))
    );
    radiology.other = otherRadio.join(", ");

    // Build doctor notes
    const notesParts = [];
    if (principalDiagnosis) {
      notesParts.push(`Diagnosis: ${principalDiagnosis}`);
    }
    if (secondaryDiagnoses && secondaryDiagnoses.length > 0) {
      notesParts.push(`Comorbidities: ${secondaryDiagnoses.join(", ")}`);
    }

    const doctorNotes = {
      freeText: notesParts.length > 0 ? notesParts.join("\n\n") : "Doctor's notes"
    };

    // Vitals
    const vitalsCard = dashboardCards.vitals_card || {};
    const summary = vitalsCard.summary || {};
    const vitals = {
      height: extracted.vitals?.height || "",
      bp: summary.latest_bp || extracted.vitals?.bp || extracted.vitals?.bloodPressure || "",
      weight: extracted.vitals?.weight || ""
    };

    // Get actual hospital info
    const hospitalInfo = extracted.hospital || extracted.stage1?.hospital || {};
    const hospital = {
      name: hospitalInfo.name || DEFAULT_HOSPITAL.name,
      tagline: hospitalInfo.tagline || DEFAULT_HOSPITAL.tagline,
      department: hospitalInfo.department || extracted.department || DEFAULT_HOSPITAL.department,
      branch: hospitalInfo.branch || DEFAULT_HOSPITAL.branch,
      address: hospitalInfo.address || DEFAULT_HOSPITAL.address
    };

    return {
      hospital: hospital,
      patient: {
        name: patient.name || "Patient Name",
        ageSex: `${age} Yrs / ${gender === "Male" ? "Male" : gender === "Female" ? "Female" : gender || ""}`,
        hospitalNo: patient.mrn || patient.hospital_number || "",
        mobile: patient.mobile || "",
        email: patient.email || ""
      },
      visit: {
        episodeNo: meta.episode_number || extracted.patient?.episode_number || extracted.stage1?.patient?.episode_number || "",
        dateTime: meta.rx_date || extracted.visit?.date || new Date().toISOString().split("T")[0] + " 10:00"
      },
      consultant: {
        name: doctor.name || "Doctor Name",
        regNo: doctor.registration_number || doctor.reg_no || "",
        department: hospitalInfo.department || extracted.department || doctor.specialty || "Internal Medicine"
      },
      vitals: vitals,
      clinical: {
        allergies: extracted.allergies?.[0] || "No known drug allergy",
        diet: extracted.diet || "Normal",
        vulnerable: false,
        knownHealthConditions: (secondaryDiagnoses || []).join(", ") || ""
      },
      doctorNotes: doctorNotes,
      procedures: {
        ecg: false, eeg: false, holter: false, ncv: false,
        tmt: false, echo: false, enmg: false, cag: false, physiotherapy: false
      },
      labs: labs,
      radiology: radiology,
      admission: {
        admissionDate: "",
        dayCareProcedure: false,
        procedureDate: "",
        details: "",
        procedureNotes: ""
      },
      prescription: {
        medicines: medications
      },
      crossReference: "",
      nextVisitDate: extracted.follow_up?.[0] || "",
      doctor: {
        signatureText: doctor.name?.split(" ")[0] || "Doctor"
      },
      // Metadata for tracking
      _metadata: {
        sourceDocument: document.name,
        sourceDocumentId: document.id,
        generatedAt: new Date().toISOString(),
        department: document.department || ""
      }
    };
  }

  /**
   * Render HTML template with data
   */
  async renderPrescriptionHTML(data) {
    try {
      // Check if template directory exists
      try {
        await fs.access(TEMPLATE_DIR);
      } catch (error) {
        throw new Error(`Prescription template directory not found: ${TEMPLATE_DIR}. Please ensure prescription_template_dev is properly deployed.`);
      }

      // Check if template files exist
      const templateFile = path.join(TEMPLATE_DIR, "prescription-template.html");
      const cssFile = path.join(TEMPLATE_DIR, "prescription-template.css");
      const jsFile = path.join(TEMPLATE_DIR, "prescription-template.js");

      for (const file of [templateFile, cssFile, jsFile]) {
        try {
          await fs.access(file);
        } catch (error) {
          throw new Error(`Prescription template file not found: ${file}. Please ensure all template files are deployed.`);
        }
      }

      let html = await fs.readFile(templateFile, "utf8");
      const css = await fs.readFile(cssFile, "utf8");
      const js = await fs.readFile(jsFile, "utf8");

      html = html.replace('<link rel="stylesheet" href="prescription-template.css" />', `<style>${css}</style>`);
      html = html.replace('<script src="prescription-template.js"></script>', `<script>${js}</script>`);
      html = html.replace(/<script>\s*\/\/ Demo binding[\s\S]*?renderPrescription\(samplePrescriptionData\);\s*<\/script>\s*/g, '');

      const dataScript = `<script>
window.prescriptionData = ${JSON.stringify(data, null, 2)};
renderPrescription(window.prescriptionData);
    </script>`;
      html = html.replace('</body>', dataScript + '</body>');

      return html;
    } catch (error) {
      console.error('Error rendering prescription HTML:', error.message);
      throw new Error(`Failed to render prescription: ${error.message}`);
    }
  }

  /**
   * Convert HTML to PDF using Playwright
   */
  async generatePDF(html, outputPath) {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });

      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm'
        }
      });

      await browser.close();
      return outputPath;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  /**
   * Generate prescription for a document
   */
  async generatePrescription(docId, options = {}) {
    const { format = 'both', updateData = null } = options;

    // Load document
    const document = await this.loadDocument(docId);
    if (!document) {
      throw new Error(`Document not found: ${docId}`);
    }

    // Map to prescription format
    let prescriptionData = this.mapDashboardToPrescription(document);

    // Apply updates if provided (from review/edit UI)
    if (updateData) {
      prescriptionData = this.applyUpdates(prescriptionData, updateData);
    }

    // Render HTML
    const html = await this.renderPrescriptionHTML(prescriptionData);

    // Generate filenames
    const baseName = (document.name || document.fileName || docId).replace(/\.(pdf|png|jpg|jpeg)$/i, "");
    const timestamp = Date.now();
    const htmlFileName = `${baseName}_prescription_${timestamp}.html`;
    const pdfFileName = `${baseName}_prescription_${timestamp}.pdf`;

    const htmlPath = path.join(OUTPUT_DIR, htmlFileName);
    const pdfPath = path.join(OUTPUT_DIR, pdfFileName);

    let result = {
      success: true,
      documentId: docId,
      documentName: document.name,
      data: prescriptionData,
      urls: {},
      paths: {}
    };

    // Save HTML
    if (format === 'html' || format === 'both') {
      await fs.writeFile(htmlPath, html);
      result.urls.html = `/prescriptions/${htmlFileName}`;
      result.paths.html = htmlPath;
    }

    // Generate PDF
    if (format === 'pdf' || format === 'both') {
      await this.generatePDF(html, pdfPath);
      result.urls.pdf = `/prescriptions/${pdfFileName}`;
      result.paths.pdf = pdfPath;
    }

    return result;
  }

  /**
   * Apply updates from review/edit UI
   */
  applyUpdates(originalData, updates) {
    const updated = JSON.parse(JSON.stringify(originalData));

    const medications = updates.medications || updates.prescription?.medicines;
    if (medications) {
      updated.prescription.medicines = medications;
    }
    if (updates.labs) {
      Object.assign(updated.labs, updates.labs);
    }
    if (updates.radiology) {
      Object.assign(updated.radiology, updates.radiology);
    }
    if (updates.doctorNotes) {
      updated.doctorNotes = updates.doctorNotes;
    }
    if (updates.vitals) {
      Object.assign(updated.vitals, updates.vitals);
    }
    if (updates.nextVisitDate) {
      updated.nextVisitDate = updates.nextVisitDate;
    }

    return updated;
  }

  /**
   * Get prescription data only (for review/edit UI)
   */
  async getPrescriptionData(docId) {
    const document = await this.loadDocument(docId);
    if (!document) {
      throw new Error(`Document not found: ${docId}`);
    }

    return this.mapDashboardToPrescription(document);
  }

  /**
   * Map voice-extracted data to prescription format
   * Handles the different data structure from voice dictation
   */
  mapVoiceToPrescription(document) {
    const extracted = document.result?.extracted_data || {};
    const meta = document.result?.meta || {};
    const dashboardCards = document.result?.dashboard_cards || {};

    // Voice data has simpler structure - transform it
    const voiceMedications = extracted.medications || [];
    const voiceLabs = extracted.labs || extracted.investigations || [];
    const voiceRadiology = extracted.radiology || [];
    const patientInfo = extracted.patient_info || extracted.patient || {};
    const diagnosisText = typeof extracted.diagnosis === "string"
      ? extracted.diagnosis
      : extracted.diagnosis?.principal?.name
        || extracted.diagnosis?.principal?.description
        || dashboardCards.diagnosis_card?.principal_diagnosis
        || "";
    const symptoms = Array.isArray(extracted.symptoms)
      ? extracted.symptoms
      : Array.isArray(extracted.diagnosis?.symptoms)
        ? extracted.diagnosis.symptoms
        : [];
    const chiefComplaint = extracted.chief_complaint || extracted.chiefComplaint || "";
    const hpi = extracted.hpi || "";
    const ros = Array.isArray(extracted.ros) ? extracted.ros : [];
    const planItems = Array.isArray(extracted.plan)
      ? extracted.plan
      : Array.isArray(extracted.treatment?.management_items)
        ? extracted.treatment.management_items
        : [];
    const followUpItemsRaw = Array.isArray(extracted.follow_up)
      ? extracted.follow_up
      : Array.isArray(extracted.follow_up?.items)
        ? extracted.follow_up.items
        : [];
    const followUpItems = followUpItemsRaw
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (!item || typeof item !== "object") return "";
        return item.reason || item.timing || item.label || item.name || "";
      })
      .filter(Boolean);
    const dashboardVitals = dashboardCards.vitals_card?.summary || {};
    const extractedVitals = extracted.vitals?.latest || extracted.vitals || {};
    const extractedBp = extractedVitals.bp || {};

    // Parse medications from voice instructions
    const medications = voiceMedications.map((med, idx) => {
      const name = med.name || "";
      const instruction = med.instruction || "";

      // Parse medication instruction: "500mg twice daily for 5 days"
      const parsed = this.parseMedicationInstruction(instruction);

      return {
        srNo: idx + 1,
        name: name.toUpperCase(),
        dose: parsed.dose || "As prescribed",
        morning: parsed.morning,
        noon: parsed.noon,
        night: parsed.night,
        days: parsed.duration || "",
        remarks: parsed.frequency || instruction || "As prescribed"
      };
    }).filter(m => m.name);

    // Ensure minimum 8 rows
    while (medications.length < 8) {
      medications.push({
        srNo: "",
        name: "",
        dose: "",
        morning: false,
        noon: false,
        night: false,
        days: "",
        remarks: ""
      });
    }

    // Transform labs from array of strings to objects
    const labList = voiceLabs.map(lab =>
      typeof lab === "string"
        ? { test_name: lab, category: this.categorizeLab(lab), is_checked: true, is_uncertain: false }
        : { test_name: lab.test_name || lab.name, category: lab.category || "general", is_checked: true, is_uncertain: false }
    );

    const labKeywords = {
      cbc: ["cbc", "complete blood", "hemogram", "complete blood count"],
      glucoseRandom: ["glucose random", "blood sugar random", "rbs", "random blood sugar"],
      srCreat: ["s.creat", "creatinine", "serum creatinine", "s. creat", "creatinine"],
      denguePanel: ["dengue", "ns1", "dengue panel"],
      thyroidProfile: ["thyroid", "tsh", "t3", "t4", "thyroid profile"],
      dDimer: ["d-dimer", "d dimer", "d dimer assay"],
      sgpt: ["sgpt", "alt", "sgpt/alt"],
      esr: ["esr", "erythrocyte sedimentation"],
      bun: ["bun", "blood urea", "blood urea nitrogen"],
      electrolytes: ["electrolyte", "sodium", "potassium", "electrolytes"],
      hba1c: ["hba1c", "glycated hemoglobin", "glycosylated hemoglobin", "hba 1c", "hba1c"],
      lipidProfile: ["lipid profile", "cholesterol", "tg", "hdl", "ldl", "triglycerides", "lipid"],
      urineRoutine: ["urine routine", "urine microscopy", "routine and microscopy", "routine microscopy", "urine"],
      lft: ["lft", "liver function", "liver function test"]
    };

    const labs = { other: "" };
    Object.keys(labKeywords).forEach(key => {
      labs[key] = labList.some(lab =>
        labKeywords[key].some((kw) => String(lab.test_name || "").toLowerCase().includes(kw))
      );
    });

    const otherLabs = labList.filter(lab =>
      !Object.values(labKeywords).flat().some((kw) => String(lab.test_name || "").toLowerCase().includes(kw))
    );
    labs.other = otherLabs.map(l => l.test_name).join(", ");

    // Transform radiology from array of strings to objects
    const radioList = voiceRadiology.map(rad =>
      typeof rad === "string"
        ? { study_name: rad, category: this.categorizeRadiology(rad), is_checked: true, is_uncertain: false }
        : { study_name: rad.study_name || rad.name, category: rad.category || "imaging", is_checked: true, is_uncertain: false }
    );

    const radioKeywords = {
      xrayChestPa: ["xray", "chest", "x-ray", "cxr"],
      usgAbdPelvis: ["usg", "ultrasound", "abdomen", "pelvis", "kub"],
      mriBrain: ["mri", "brain"],
      ctThoraxHrct: ["ct", "chest", "hrct"]
    };

    const radiology = { other: "" };
    Object.keys(radioKeywords).forEach(key => {
      radiology[key] = radioList.some(radio =>
        radioKeywords[key].some((kw) => String(radio.study_name || "").toLowerCase().includes(kw))
      );
    });

    const otherRadio = radioList.filter(radio =>
      !Object.values(radioKeywords).flat().some((kw) => String(radio.study_name || "").toLowerCase().includes(kw))
    );
    radiology.other = otherRadio.map(r => r.study_name).join(", ");

    // Build doctor notes from voice data
    const notesParts = [];
    if (chiefComplaint) {
      notesParts.push(`Chief complaint: ${chiefComplaint}`);
    }
    if (hpi) {
      notesParts.push(`HPI: ${hpi}`);
    }
    if (ros.length > 0) {
      notesParts.push(`ROS: ${ros.join(", ")}`);
    }
    if (diagnosisText) {
      notesParts.push(`Diagnosis: ${diagnosisText}`);
    }
    if (symptoms.length > 0) {
      notesParts.push(`Symptoms: ${symptoms.join(", ")}`);
    }
    if (planItems.length > 0) {
      notesParts.push(`Plan: ${planItems.join(", ")}`);
    }
    if (followUpItems.length > 0) {
      notesParts.push(`Follow-up: ${followUpItems.join(", ")}`);
    }

    const age = patientInfo.age ? `${patientInfo.age} Yrs` : "";
    const gender = patientInfo.gender || "";
    const ageSex = [age, gender].filter(Boolean).join(" / ");

    const doctorNotes = {
      freeText: notesParts.length > 0 ? notesParts.join("\n\n") : "Doctor's notes from voice dictation"
    };

    return {
      hospital: {
        name: "Manipal Hospitals",
        tagline: "Care • Safety • Trust",
        department: "Voice Dictation",
        branch: "Main Branch",
        address: "Generated from Live Voice Session"
      },
      patient: {
        name: patientInfo.name || meta.patientName || "Voice Patient",
        ageSex: ageSex || "N/A",
        hospitalNo: patientInfo.mrn || patientInfo.hospital_no || patientInfo.hospitalNo || `VOICE-${meta.sessionId?.substring(0, 8) || "TEMP"}`,
        mobile: "",
        email: ""
      },
      visit: {
        episodeNo: meta.sessionId?.substring(0, 12) || "VOICE-EP",
        dateTime: new Date().toISOString().split("T")[0]
      },
      consultant: {
        name: document.createdBy?.username || "Doctor",
        regNo: "",
        department: "Voice Dictation"
      },
      vitals: {
        height: "",
        bp: dashboardVitals.latest_bp
          || (
            Number.isFinite(extractedBp?.systolic) && Number.isFinite(extractedBp?.diastolic)
              ? `${extractedBp.systolic}/${extractedBp.diastolic}`
              : ""
          ),
        weight: extractedVitals.weight?.value ? `${extractedVitals.weight.value}` : dashboardVitals.weight ? `${dashboardVitals.weight}` : ""
      },
      clinical: {
        allergies: "No known drug allergy",
        diet: "Normal",
        vulnerable: false,
        knownHealthConditions: diagnosisText || ""
      },
      doctorNotes: doctorNotes,
      procedures: {
        ecg: false, eeg: false, holter: false, ncv: false,
        tmt: false, echo: false, enmg: false, cag: false, physiotherapy: false
      },
      labs: labs,
      radiology: radiology,
      admission: {
        admissionDate: "",
        dayCareProcedure: false,
        procedureDate: "",
        details: "",
        procedureNotes: ""
      },
      prescription: {
        medicines: medications
      },
      crossReference: "",
      nextVisitDate: followUpItems.join(", "),
      doctor: {
        signatureText: "Voice"
      },
      _metadata: {
        sourceDocument: document.fileName || "Voice Session",
        sourceDocumentId: document.id,
        generatedAt: new Date().toISOString(),
        department: "Voice Dictation",
        sessionType: "live_conversation"
      }
    };
  }

  /**
   * Parse medication instruction from voice dictation
   * Examples: "500mg twice daily for 5 days", "10ml at night"
   */
  parseMedicationInstruction(instruction) {
    if (!instruction || typeof instruction !== "string") {
      return { dose: "", frequency: "", duration: "", morning: false, noon: false, night: false };
    }

    const lower = instruction.toLowerCase();

    // Extract dose (numbers followed by mg, ml, g, mcg, etc.)
    const doseMatch = lower.match(/(\d+(?:\.\d+)?)\s*(mg|ml|g|mcg|units?|tabs?|tablets?|teaspoon?|tablespoon?)/i);
    const dose = doseMatch ? `${doseMatch[1]}${doseMatch[2]}` : "";

    // Extract duration (X days, X weeks, etc.)
    const durationMatch = lower.match(/(\d+)\s*(days?|weeks?|months?)/i);
    const duration = durationMatch ? `${durationMatch[1]} ${durationMatch[2]}` : "";

    // Parse timing
    const morning = /morning|am|before breakfast/i.test(lower);
    const noon = /noon|afternoon|after lunch|midday/i.test(lower);
    const night = /night|bed|evening|at night|hs|before bed|pm/i.test(lower);

    // Parse frequency abbreviations
    const tds = /\btds\b|tid|3\s*times|thrice/i.test(lower);
    const bd = /\bbd\b|bis.*die|2\s*times|twice/i.test(lower);
    const qid = /\bqid\b|4\s*times|four\s*times/i.test(lower);
    const od = /\bod\b|daily|once.*daily|omne.*die|once a day/i.test(lower);

    let frequency = "";
    if (tds) frequency = "3 times daily";
    else if (bd) frequency = "2 times daily";
    else if (qid) frequency = "4 times daily";
    else if (od) frequency = "once daily";
    else if (morning && noon && night) frequency = "3 times daily";
    else if (morning && night) frequency = "2 times daily";
    else if (morning) frequency = "morning";
    else if (noon) frequency = "noon";
    else if (night) frequency = "night";

    return {
      dose,
      frequency,
      duration,
      morning: tds || morning || (od && !night),
      noon: tds || qid || noon,
      night: tds || bd || night || qid
    };
  }

  /**
   * Categorize lab test
   */
  categorizeLab(testName) {
    const name = (testName || "").toLowerCase();
    if (name.includes("cbc") || name.includes("hemogram") || name.includes("blood")) return "hematology";
    if (name.includes("hba1c") || name.includes("glucose") || name.includes("sugar")) return "biochemistry";
    if (name.includes("lft") || name.includes("liver") || name.includes("sgpt")) return "biochemistry";
    if (name.includes("kft") || name.includes("kidney") || name.includes("creatinine")) return "biochemistry";
    if (name.includes("thyroid") || name.includes("tsh")) return "endocrinology";
    if (name.includes("lipid") || name.includes("cholesterol")) return "biochemistry";
    if (name.includes("urine")) return "clinical pathology";
    if (name.includes("xray") || name.includes("x-ray")) return "radiology";
    return "general";
  }

  /**
   * Categorize radiology study
   */
  categorizeRadiology(studyName) {
    const name = (studyName || "").toLowerCase();
    if (name.includes("xray") || name.includes("x-ray") || name.includes("chest")) return "imaging";
    if (name.includes("usg") || name.includes("ultrasound")) return "imaging";
    if (name.includes("ct") || name.includes("cat")) return "imaging";
    if (name.includes("mri")) return "imaging";
    if (name.includes("echo")) return "cardiac";
    return "imaging";
  }
}

module.exports = { PrescriptionService };
