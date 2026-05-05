/**
 * Outpatient Record Extractor Agent
 * Optimized for outpatient/OPD records - focuses on chief complaints, diagnosis, medications
 * Skips Risk Assessment (not typically in OPD) and Treatment (usually minimal)
 */

const PDFReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");
const GemmaClientTool = require("../tools/llm/gemma_client.tool.cjs");
const PromptBuilderTool = require("../tools/llm/prompt_builder.tool.cjs");
const ProvenanceBuilderTool = require("../tools/clinical/provenance_builder.tool.cjs");

// Skills - selective for outpatient records
const DocumentAnalyzerSkill = require("../skills/extraction/document_analyzer.skill.cjs");
const DemographicsExtractorSkill = require("../skills/extraction/demographics_extractor.skill.cjs");
const VitalsExtractorSkill = require("../skills/extraction/vitals_extractor.skill.cjs");
const ClinicalDataExtractorSkill = require("../skills/extraction/clinical_data_extractor.skill.cjs");
const CrossValidatorSkill = require("../skills/validation/cross_validator.skill.cjs");

class OutpatientExtractorAgent {
  constructor(config = {}) {
    this.name = "Outpatient Record Extractor";
    this.version = "1.0.0";
    this.type = "outpatient_extractor";
    this.documentType = "outpatient_record";

    // Initialize tools
    this.pdfReader = new PDFReaderTool(config);
    this.gemmaClient = new GemmaClientTool(config.gemma || {});
    this.promptBuilder = new PromptBuilderTool(config);
    this.provenanceBuilder = new ProvenanceBuilderTool(config);

    // Initialize skills - OUTPATIENT SPECIFIC (no Risk Assessment)
    this.skills = [
      new DocumentAnalyzerSkill(),
      new DemographicsExtractorSkill(),
      new VitalsExtractorSkill(),
      new ClinicalDataExtractorSkill(),
      new CrossValidatorSkill()
    ];

    this.config = {
      maxRetries: 2,
      timeoutPerStep: 120000,
      totalTimeout: 300000,
      requireAllSteps: false,
      logSteps: true,
      saveIntermediates: true,
      ...config
    };
  }

  normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  isMeaningfulNumber(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
  }

  isRadiologyOrder(value) {
    return /\b(?:xray|x-ray|ct|mri|usg|ultrasound|echo|echocardiogram|doppler|mammography|fluoroscopy|scan)\b/i.test(
      this.normalizeText(value)
    );
  }

  isNuclearMedicineOrder(value) {
    return /\b(?:pet|dtpa|dmsa|mibi|thallium|v\/q|vq|bone scan|thyroid scan|renal scan|hida|nuclear)\b/i.test(
      this.normalizeText(value)
    );
  }

  isProcedureOrder(value) {
    return /\b(?:uroflowmetry|pvr|cystoscopy|catheteri[sz]ation|ncs|emg|pft|ecg|echo|stress test|holter|biopsy|endoscopy|colonoscopy|bronchoscopy|angiography|arthroscopy)\b/i.test(
      this.normalizeText(value)
    );
  }

  hasMeaningfulBp(bp) {
    return Boolean(bp && (this.isMeaningfulNumber(bp.systolic) || this.isMeaningfulNumber(bp.diastolic)));
  }

  dedupeStrings(items = []) {
    const seen = new Set();
    const output = [];

    for (const item of items) {
      const normalized = this.normalizeText(item);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(normalized);
    }

    return output;
  }

  normalizeOrderKey(value) {
    return this.normalizeText(value)
      .toLowerCase()
      .replace(/\bc\/s\b/g, "culture sensitivity")
      .replace(/\busg\b/g, "ultrasound")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  buildStructuredOrder(input, fallbackType = "lab") {
    if (!input) return null;

    const label = this.normalizeText(
      typeof input === "string"
        ? input
        : input.test_name || input.study_name || input.type || input.name || ""
    );
    if (!label) return null;

    const normalizedType = this.isNuclearMedicineOrder(label)
      ? "nuclear_medicine"
      : this.isProcedureOrder(label)
        ? "procedure"
        : this.isRadiologyOrder(label)
          ? "radiology"
          : fallbackType;

    if (normalizedType === "procedure") {
      return {
        orderType: "procedure",
        item: {
          name: label,
          category: typeof input === "object" && input?.category ? input.category : "general",
          status: typeof input === "object" && input?.status ? String(input.status).toLowerCase() : "ordered",
          source: typeof input === "object" && input?.source ? input.source : "clinical_extractor",
          is_uncertain: Boolean(typeof input === "object" && input?.is_uncertain),
          confidence_reason: typeof input === "object" ? (input.confidence_reason || "") : "",
        },
      };
    }

    return {
      orderType: normalizedType,
      item: {
        type: label,
        status: typeof input === "object" && input?.status ? String(input.status).toLowerCase() : "ordered",
        priority: typeof input === "object" && input?.priority ? input.priority : "routine",
        source: typeof input === "object" && input?.source ? input.source : "clinical_extractor",
        is_uncertain: Boolean(typeof input === "object" && input?.is_uncertain),
        confidence_reason: typeof input === "object" ? (input.confidence_reason || "") : "",
      },
    };
  }

  dedupeStructuredOrders(items = [], labelKey) {
    const deduped = new Map();

    for (const item of Array.isArray(items) ? items : []) {
      const label = this.normalizeText(item?.[labelKey]);
      if (!label) continue;

      const key = this.normalizeOrderKey(label);
      const status = String(item?.status || "").toLowerCase();
      const score = [
        status === "ordered" ? 4 : 0,
        status === "mentioned" ? 3 : 0,
        item?.source === "text+visual" ? 3 : 0,
        item?.source === "text_order" ? 2 : 0,
        item?.source === "note_reconciliation" ? 2 : 0,
        item?.source === "clinical_extractor" ? 1 : 0,
      ].reduce((sum, value) => sum + value, 0);

      const existing = deduped.get(key);
      if (!existing || score > existing.score || (score === existing.score && label.length > existing.label.length)) {
        deduped.set(key, { item: { ...item, [labelKey]: label }, score, label });
      }
    }

    return Array.from(deduped.values()).map((entry) => entry.item);
  }

  normalizeClinicalOrders(investigations = [], radiology = [], nuclearMedicine = [], procedures = []) {
    const buckets = {
      investigations: [],
      radiology: [],
      nuclear_medicine: [],
      procedures: [],
    };

    for (const item of investigations) {
      const normalized = this.buildStructuredOrder(item, "lab");
      if (!normalized) continue;

      if (normalized.orderType === "radiology") buckets.radiology.push(normalized.item);
      else if (normalized.orderType === "nuclear_medicine") buckets.nuclear_medicine.push(normalized.item);
      else if (normalized.orderType === "procedure") buckets.procedures.push(normalized.item);
      else buckets.investigations.push(normalized.item);
    }

    for (const item of radiology) {
      const normalized = this.buildStructuredOrder(item, "radiology");
      if (!normalized) continue;
      if (normalized.orderType === "nuclear_medicine") buckets.nuclear_medicine.push(normalized.item);
      else if (normalized.orderType === "procedure") buckets.procedures.push(normalized.item);
      else buckets.radiology.push(normalized.item);
    }

    for (const item of nuclearMedicine) {
      const normalized = this.buildStructuredOrder(item, "nuclear_medicine");
      if (!normalized) continue;
      buckets.nuclear_medicine.push(normalized.item);
    }

    for (const item of procedures) {
      const normalized = this.buildStructuredOrder(item, "procedure");
      if (!normalized) continue;
      buckets.procedures.push(normalized.item);
    }

    return {
      investigations: this.dedupeStructuredOrders(buckets.investigations, "type"),
      radiology: this.dedupeStructuredOrders(buckets.radiology, "type"),
      nuclear_medicine: this.dedupeStructuredOrders(buckets.nuclear_medicine, "type"),
      procedures: this.dedupeStructuredOrders(buckets.procedures, "name"),
    };
  }

  mergeClinicalNotes(existingNotes = [], incomingNotes = []) {
    const seen = new Set(
      existingNotes.map((note) => `${this.normalizeText(note?.type).toLowerCase()}::${this.normalizeText(note?.summary).toLowerCase()}`)
    );
    const merged = [...existingNotes];

    for (const note of incomingNotes) {
      const key = `${this.normalizeText(note?.type).toLowerCase()}::${this.normalizeText(note?.summary).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(note);
    }

    return merged;
  }

  extractVisitMetadata(pdfText) {
    const text = String(pdfText || "");
    const dateMatch = text.match(/\bDate\s*:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})(?:\s+([0-9]{1,2}:[0-9]{2}\s*(?:AM|PM)?))?/i);
    const visitNumberMatch = text.match(/\bVisit No\s*:\s*([A-Z0-9]+)/i);
    const hospitalNumberMatch = text.match(/\bHospital No\s*:\s*([A-Z0-9]+)/i);
    const doctorMatch = text.match(/Doctor Name\s*:\s*([^\n]+?)(?:\s+Specialty\s*:|$)/i);
    const specialtyMatch = text.match(/\bSpecialty\s*:\s*([^\n]+)/i);
    const isOutpatient = /\bOUTPATIENT RECORD\b/i.test(text);
    const isOpd = /\bOPD\b/i.test(text);

    const visitNumber = this.normalizeText(visitNumberMatch?.[1] || "");
    const specialty = this.normalizeText(specialtyMatch?.[1] || "");

    return {
      date: this.normalizeText(dateMatch?.[1] || ""),
      time: this.normalizeText(dateMatch?.[2] || ""),
      hospital_number: this.normalizeText(hospitalNumberMatch?.[1] || ""),
      visit_number: visitNumber,
      episode_number: visitNumber,
      doctor_name: this.normalizeText(doctorMatch?.[1] || ""),
      specialty,
      department: specialty,
      visit_type: isOutpatient || isOpd ? "OPD" : "unknown",
    };
  }

  mergeVitals(resultVitals, stepData) {
    const hasStructuredVitals =
      stepData.latest ||
      Array.isArray(stepData.readings) ||
      stepData.reference_ranges ||
      stepData.abnormal_flags ||
      stepData.has_vitals !== undefined;

    if (!hasStructuredVitals) return;

    const latest = stepData.latest || {};
    resultVitals.latest = resultVitals.latest || {};
    resultVitals.readings = Array.isArray(stepData.readings) ? stepData.readings : (resultVitals.readings || []);
    resultVitals.reference_ranges = stepData.reference_ranges || resultVitals.reference_ranges || {};
    resultVitals.abnormal_flags = Array.isArray(stepData.abnormal_flags) ? stepData.abnormal_flags : (resultVitals.abnormal_flags || []);

    if (this.hasMeaningfulBp(latest.bp)) {
      resultVitals.latest.bp = latest.bp;
      resultVitals.bp = latest.bp;
    }
    if (this.isMeaningfulNumber(latest.pulse?.value)) {
      resultVitals.latest.pulse = latest.pulse;
      resultVitals.pulse = latest.pulse;
    }
    if (this.isMeaningfulNumber(latest.temperature?.value)) {
      resultVitals.latest.temperature = latest.temperature;
      resultVitals.temperature = latest.temperature;
    }
    if (this.isMeaningfulNumber(latest.resp_rate)) {
      resultVitals.latest.resp_rate = latest.resp_rate;
      resultVitals.resp_rate = latest.resp_rate;
    }
    if (this.isMeaningfulNumber(latest.spo2?.value)) {
      resultVitals.latest.spo2 = latest.spo2;
      resultVitals.spo2 = latest.spo2;
    }
    if (this.isMeaningfulNumber(latest.pain_score?.value)) {
      resultVitals.latest.pain_score = latest.pain_score;
      resultVitals.pain_score = latest.pain_score;
    }
    if (this.isMeaningfulNumber(latest.grbs?.value)) {
      resultVitals.latest.grbs = latest.grbs;
      resultVitals.grbs = latest.grbs;
    }

    resultVitals.has_vitals = Boolean(
      resultVitals.has_vitals ||
      stepData.has_vitals ||
      Object.keys(resultVitals.latest || {}).length > 0 ||
      (Array.isArray(resultVitals.readings) && resultVitals.readings.length > 0)
    );
  }

  mergeTreatment(existingTreatment = {}, incomingTreatment = {}) {
    return {
      current_approach: incomingTreatment.current_approach || existingTreatment.current_approach || "",
      management_items: this.dedupeStrings([
        ...(Array.isArray(existingTreatment.management_items) ? existingTreatment.management_items : []),
        ...(Array.isArray(incomingTreatment.management_items) ? incomingTreatment.management_items : []),
      ]),
      procedures: this.dedupeStrings([
        ...(Array.isArray(existingTreatment.procedures) ? existingTreatment.procedures : []),
        ...(Array.isArray(incomingTreatment.procedures) ? incomingTreatment.procedures : []),
      ]),
      response: incomingTreatment.response || existingTreatment.response || "",
      complications: this.dedupeStrings([
        ...(Array.isArray(existingTreatment.complications) ? existingTreatment.complications : []),
        ...(Array.isArray(incomingTreatment.complications) ? incomingTreatment.complications : []),
      ]),
    };
  }

  extractChiefComplaints(clinicalNotes = []) {
    const explicitComplaintNotes = clinicalNotes.filter((note) =>
      /chief complaints?|presenting complaints?/i.test(String(note?.type || ""))
    );
    const fallbackNotes = explicitComplaintNotes.length > 0
      ? explicitComplaintNotes
      : clinicalNotes.filter((note) => /nursing initial assessment/i.test(String(note?.type || "")));

    return this.dedupeStrings(fallbackNotes.map((note) => note?.summary));
  }

  normalizeValidationSummary(validationStep) {
    const summary = validationStep?.data?.validation_summary;
    const selfValidation = validationStep?.selfValidation;
    const isPlaceholderSummary =
      !summary ||
      summary.confidence_level === "high/medium/low" ||
      summary.data_quality_notes === "..." ||
      (!Array.isArray(summary.inconsistencies_found) && !Array.isArray(summary.missing_critical_fields));

    if (!isPlaceholderSummary) {
      return summary;
    }

    if (!selfValidation) {
      return summary || null;
    }

    return {
      confidence_level: selfValidation.confidence_level || "medium",
      inconsistencies_found: Array.isArray(selfValidation.inconsistencies) ? selfValidation.inconsistencies : [],
      missing_critical_fields: Array.isArray(selfValidation.missing) ? selfValidation.missing : [],
      data_quality_notes: selfValidation.data_quality_notes || "",
    };
  }

  async process(pdfPath, options = {}) {
    const startTime = Date.now();
    const pdfName = options.pdfName || pdfPath.split("/").pop();
    const onProgress = options.onProgress || null;

    try {
      console.log(`\n🏥 Processing OUTPATIENT record: ${pdfName}`);

      // Emit starting event
      if (onProgress) {
        onProgress({ type: 'start', pdfName, totalSteps: this.skills.length, documentType: this.documentType });
      }

      // Step 1: Read PDF
      const pdfResult = await this.pdfReader.execute(pdfPath, 50000);
      if (!pdfResult.success) {
        throw new Error(`Failed to read PDF: ${pdfResult.error}`);
      }

      const pdfText = pdfResult.text;
      console.log(`   📖 PDF read: ${pdfText.length} chars, ${pdfResult.pages} pages`);

      // Emit PDF read event
      if (onProgress) {
        onProgress({
          type: 'step',
          step: 'pdf_read',
          stepNumber: 0,
          totalSteps: this.skills.length,
          status: 'complete',
          data: { chars: pdfText.length, pages: pdfResult.pages }
        });
      }

      // Execute each skill in sequence
      const steps = [];
      let totalTokens = 0;
      let stepNumber = 0;

      for (const skill of this.skills) {
        stepNumber++;
        const stepName = skill.name;
        console.log(`\n   🔄 ${stepName}...`);

        const stepResult = await skill.execute({
          pdfText: pdfText,
          gemmaClient: this.gemmaClient,
          promptBuilder: this.promptBuilder,
          provenanceBuilder: this.provenanceBuilder,
          steps: steps,
          previousSteps: steps,
          documentType: this.documentType  // Pass document type to skills
        });

        steps.push(stepResult);

        if (stepResult.usage) {
          totalTokens += stepResult.usage.totalTokens || 0;
        }

        if (stepResult.success) {
          console.log(`      ✅ Completed (${stepResult.usage?.totalTokens || 0} tokens)`);
        } else {
          console.log(`      ❌ Failed: ${stepResult.error}`);
          if (!this.config.requireAllSteps) {
            console.log(`      ⚠️  Continuing despite failure...`);
          }
        }
      }

      // Assemble final result
      const finalResult = this.assembleFinalResult(steps, pdfName, pdfText);

      const endTime = Date.now();

      // Emit complete event
      if (onProgress) {
        onProgress({
          type: 'complete',
          pdfName,
          latency: endTime - startTime,
          tokensUsed: totalTokens,
          confidence: finalResult.validation?.confidence_level || 'medium'
        });
      }

      return {
        success: true,
        agent: this.name,
        agentType: this.type,
        documentType: this.documentType,
        pdfName: pdfName,
        pdfPath: pdfPath,
        latency: endTime - startTime,
        tokensUsed: totalTokens,
        steps: steps.map(s => ({
          step: s.step,
          success: s.success,
          tokens: s.usage?.totalTokens || 0,
          latency: s.usage?.latency || 0,
          dataKeys: s.data ? Object.keys(s.data) : [],
          hasValidation: !!s.validation,
          validationIssues: s.validation?.issues?.length || 0,
          error: s.error || null
        })),
        data: finalResult
      };

    } catch (error) {
      console.error(`❌ Outpatient extractor failed: ${error.message}`);
      return {
        success: false,
        agent: this.name,
        agentType: this.type,
        documentType: this.documentType,
        pdfName: pdfName,
        pdfPath: pdfPath,
        error: error.message,
        data: null
      };
    }
  }

  assembleFinalResult(steps, pdfName, pdfText = "") {
    const visitMetadata = this.extractVisitMetadata(pdfText);
    const result = {
      meta: {
        pdf_file: pdfName,
        processed_at: new Date().toISOString(),
        agent_version: this.version,
        document_type: this.documentType,
        extraction_focus: "Outpatient visit data - chief complaints, diagnosis, medications, vitals",
        visit_type: visitMetadata.visit_type || "unknown",
        department_type: visitMetadata.department || ""
      },
      patient: {},
      vitals: {},
      diagnosis: {},
      medications: [],
      allergies: [],
      lab_results: [],
      investigations: [],
      radiology: [],
      nuclear_medicine: [],
      procedures: [],
      treatment: {
        current_approach: "",
        management_items: [],
        procedures: [],
        response: "",
        complications: []
      },
      clinical_notes: [],
      chief_complaints: [],
      visit: {},
      visit_details: {},
      nursing_needs: [],
      provenance: {}
    };

    // Merge data from each step
    for (const step of steps) {
      if (!step.success || !step.data) continue;

      const data = step.data;

      // Patient demographics
      if (data.name) result.patient.name = data.name;
      if (data.mrn) result.patient.mrn = data.mrn;
      if (data.age) result.patient.age = data.age;
      if (data.gender) result.patient.gender = data.gender;
      if (data.admission_date) result.patient.admission_date = data.admission_date;
      if (data.discharge_date) result.patient.discharge_date = data.discharge_date;

      this.mergeVitals(result.vitals, data);

      // Diagnosis
      if (data.diagnosis) {
        if (data.diagnosis.principal) result.diagnosis.principal = data.diagnosis.principal;
        if (data.diagnosis.icd_code) result.diagnosis.icd_code = data.diagnosis.icd_code;
        if (data.diagnosis.secondary) result.diagnosis.secondary = data.diagnosis.secondary;
        if (data.diagnosis.comorbidities) result.diagnosis.comorbidities = data.diagnosis.comorbidities;
      }

      // Medications
      if (data.medications && Array.isArray(data.medications)) {
        result.medications = [...result.medications, ...data.medications];
      }

      // Allergies
      if (data.allergies && Array.isArray(data.allergies)) {
        result.allergies = [...result.allergies, ...data.allergies];
      }

      if (data.lab_results && Array.isArray(data.lab_results)) {
        result.lab_results = [...result.lab_results, ...data.lab_results];
      }

      // Investigations
      if (data.investigations && Array.isArray(data.investigations)) {
        result.investigations = [...result.investigations, ...data.investigations];
      }

      if (data.treatment) {
        result.treatment = this.mergeTreatment(result.treatment, data.treatment);
      }

      if (data.clinical_notes && Array.isArray(data.clinical_notes)) {
        result.clinical_notes = this.mergeClinicalNotes(result.clinical_notes, data.clinical_notes);
      }

      if (data.chief_complaints) {
        const incomingComplaints = Array.isArray(data.chief_complaints) ? data.chief_complaints : [data.chief_complaints];
        result.chief_complaints = this.dedupeStrings([...result.chief_complaints, ...incomingComplaints]);
      }

      // Visit details
      if (data.visit?.visit_type) result.visit.visit_type = data.visit.visit_type;
      if (data.visit?.department) result.visit.department = data.visit.department;
      if (data.visit_type) result.visit.visit_type = data.visit_type;
      if (data.department) result.visit.department = data.department;

      // Nursing needs
      if (data.nursing_needs && Array.isArray(data.nursing_needs)) {
        result.nursing_needs = [...result.nursing_needs, ...data.nursing_needs];
      }

      // Provenance/Audit Trail - IMPORTANT for data traceability
      if (data.provenance) {
        result.provenance = result.provenance || {};
        result.provenance = { ...result.provenance, ...data.provenance };
      }
    }

    result.chief_complaints = this.dedupeStrings([
      ...result.chief_complaints,
      ...this.extractChiefComplaints(result.clinical_notes),
    ]);

    result.visit = {
      visit_type: result.visit.visit_type || visitMetadata.visit_type || "unknown",
      department: result.visit.department || visitMetadata.department || "",
      date: visitMetadata.date || "",
      time: visitMetadata.time || "",
      visit_number: visitMetadata.visit_number || "",
      episode_number: result.visit.episode_number || visitMetadata.episode_number || "",
      doctor_name: visitMetadata.doctor_name || "",
      specialty: visitMetadata.specialty || "",
    };
    result.visit_details = { ...result.visit };

    if (!result.patient.mrn && visitMetadata.hospital_number) {
      result.patient.mrn = visitMetadata.hospital_number;
    }

    result.meta.visit_type = result.visit.visit_type || result.meta.visit_type || "unknown";
    result.meta.department_type = result.visit.department || result.meta.department_type || "";
    result.vitals.has_vitals = Boolean(
      result.vitals.has_vitals ||
      Object.keys(result.vitals.latest || {}).length > 0 ||
      (Array.isArray(result.vitals.readings) && result.vitals.readings.length > 0)
    );

    const normalizedOrders = this.normalizeClinicalOrders(
      result.investigations,
      result.radiology,
      result.nuclear_medicine,
      result.treatment?.procedures
    );
    result.investigations = normalizedOrders.investigations;
    result.radiology = normalizedOrders.radiology;
    result.nuclear_medicine = normalizedOrders.nuclear_medicine;
    result.procedures = normalizedOrders.procedures;

    // Get validation summary
    const validationStep = steps.find(s => s.step === 'cross_validator');
    if (validationStep) {
      result.validation = this.normalizeValidationSummary(validationStep);
    }

    return result;
  }
}

module.exports = OutpatientExtractorAgent;
