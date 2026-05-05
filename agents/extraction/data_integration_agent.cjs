/**
 * Data Integration Agent (Stage 4)
 * Merges Stage 1 (header/PHI) and Stage 3 (handwriting/clinical) data
 * Validates and transforms to dashboard-compatible format
 * Part of two-stage prescription extraction pipeline
 *
 * Stage 4 Responsibilities:
 * 1. Merge Stage 1 + Stage 3 data
 * 2. Validate consistency
 * 3. Transform to dashboard schema
 * 4. Generate comprehensive clinical summary
 * 5. Populate to database
 */

const PrescriptionSummaryGeneratorSkill = require("../../skills/presentation/prescription_summary_generator.skill.cjs");

class DataIntegrationAgent {
  constructor(config = {}) {
    this.name = "Data Integration Agent (Stage 4)";
    this.version = "1.0.0";
    this.type = "stage4_integration";

    this.config = {
      requireAllSteps: false,
      logSteps: true,
      ...config
    };

    this.summaryGenerator = new PrescriptionSummaryGeneratorSkill(config);
  }

  /**
   * Process and merge Stage 1 and Stage 3 data
   * @param {object} stage1Data - Header/PHI data from Stage 1
   * @param {object} stage3Data - Handwriting/clinical data from Stage 3
   * @param {object} options - Processing options
   * @returns {Promise<object>}
   */
  async process(stage1Data, stage3Data, options = {}) {
    const startTime = Date.now();
    const { onProgress } = options;

    try {
      console.log(`      📋 Stage 4 Configuration:`);
      console.log(`         ├─ Stage 1 data: ${stage1Data ? '✓ Present' : '✗ Missing'}`);
      console.log(`         └─ Stage 3 data: ${stage3Data ? '✓ Present' : '✗ Missing'}`);

      if (onProgress) {
        onProgress({ type: 'start', stage: 'stage4' });
      }

      // Merge data
      console.log(`      🔄 Step 4.1.1: Merging Stage 1 + Stage 3 data...`);
      const mergeStart = Date.now();
      const mergedData = this.mergeStageData(stage1Data, stage3Data);
      console.log(`         ✅ Data merged (${Date.now() - mergeStart}ms)`);

      // Validate
      console.log(`      🔄 Step 4.1.2: Validating merged data...`);
      const validation = this.validateMergedData(mergedData, stage1Data, stage3Data);
      const validationStatus = validation.passed ? '✓ PASSED' : `⚠️ ${validation.warnings.length} WARNINGS`;
      console.log(`         ✅ Validation: ${validationStatus}`);
      if (validation.warnings.length > 0) {
        console.log(`         └─ Warnings:`);
        validation.warnings.forEach((w, i) => {
          console.log(`            ${i + 1}. [${w.code}] ${w.message}`);
        });
      }

      // Transform to dashboard format
      console.log(`      🔄 Step 4.1.3: Transforming to dashboard format...`);
      const transformStart = Date.now();
      const dashboardFormat = this.transformToDashboardFormat(mergedData);
      console.log(`         ✅ Transform complete (${Date.now() - transformStart}ms)`);

      // Generate comprehensive clinical summary
      console.log(`      🔄 Step 4.1.4: Generating clinical summary...`);
      const summaryStart = Date.now();
      const summaryResult = await this.summaryGenerator.execute({ dashboardData: dashboardFormat });
      if (summaryResult.success) {
        dashboardFormat.clinical_summary = summaryResult.data.summary;
        dashboardFormat.summary_sections = summaryResult.data.summary_sections;

        // Add the comprehensive summary as the first clinical note for display
        const summaryNote = {
          type: "Clinical Summary",
          author: this.cleanAuthorName(dashboardFormat.doctor?.name) || "System",
          date: dashboardFormat.meta?.rx_date || new Date().toISOString().split('T')[0],
          summary: summaryResult.data.summary,
          assessment: "Comprehensive summary of prescription data",
          source_excerpt: [],
          is_comprehensive_summary: true,
          source_type: "synthetic",
          is_synthetic: true,
          page_number: null,
          confidence: "medium",
          confidence_reason: "",
          is_inferred: true
        };
        dashboardFormat.clinical_notes.unshift(summaryNote);
      }
      console.log(`         ✅ Summary generated (${Date.now() - summaryStart}ms)`);

      const endTime = Date.now();
      const latency = endTime - startTime;

      if (onProgress) {
        onProgress({
          type: 'stage_complete',
          stage: 'stage4',
          status: 'complete',
          validation,
          latency
        });
      }

      return {
        success: true,
        stage: "stage4_data_integration",
        data: {
          merged: mergedData,
          dashboard_format: dashboardFormat
        },
        validation,
        metadata: {
          stage: "stage4",
          processing_time: latency,
          integrated_at: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error(`      ❌ Stage 4 failed: ${error.message}`);

      return {
        success: false,
        stage: "stage4_data_integration",
        error: error.message,
        data: null
      };
    }
  }

  /**
   * Merge Stage 1 and Stage 3 data
   */
  mergeStageData(stage1Data, stage3Data) {
    // Stage 1 provides: patient, hospital, doctor, visit, document_structure
    // Stage 3 provides: medications, vitals, diagnosis, lab/radiology orders, visual selections, nuclear medicine, procedures

    const stage1 = stage1Data || {};
    const stage3 = stage3Data || {};

    return {
      // From Stage 1 (PHI)
      patient: stage1.patient || {},
      hospital: stage1.hospital || {},
      doctor: stage1.doctor || {},
      visit: stage1.visit || {},
      document_structure: stage1.document_structure || {},
      handwriting_detection: stage1.handwriting_detection || {},
      phi_regions: stage1.phi_regions || [],

      // From Stage 3 (Clinical)
      medications: stage3.medications || [],
      medications_metadata: stage3.medications_metadata || {},
      vitals: stage3.vitals || {},
      vitals_metadata: stage3.vitals_metadata || {},
      diagnosis: stage3.diagnosis || {},
      diagnosis_metadata: stage3.diagnosis_metadata || {},
      handwritten_notes: stage3.handwritten_notes || [],
      notes_metadata: stage3.notes_metadata || {},
      lab_investigations: stage3.lab_investigations || { selected_tests: [] },
      radiology_selections: stage3.radiology_selections || { selected_studies: [] },
      nuclear_medicine: stage3.nuclear_medicine || { selected_studies: [] },
      procedures: stage3.procedures || [],
      visual_metadata: stage3.visual_metadata || {},
      orders_metadata: stage3.orders_metadata || {},
      extraction_quality: stage3.extraction_quality || {}
    };
  }

  /**
   * Validate merged data for consistency
   */
  validateMergedData(mergedData, stage1Data, stage3Data) {
    const issues = [];
    const warnings = [];

    // Check if Stage 3 data exists
    const hasStage3 = stage3Data && Object.keys(stage3Data).length > 0;

    if (!hasStage3) {
      warnings.push({
        code: "STAGE3_MISSING",
        message: "Stage 3 handwriting data not available - only Stage 1 header data present",
        user_action_required: true
      });
    }

    // Check patient info completeness (from Stage 1)
    if (!mergedData.patient?.name) {
      warnings.push({
        code: "PATIENT_NAME_MISSING",
        message: "Patient name could not be extracted"
      });
    }

    // Check medications (from Stage 3)
    if (!mergedData.medications || mergedData.medications.length === 0) {
      if (hasStage3) {
        issues.push({
          code: "NO_MEDICATIONS",
          message: "No medications were extracted from handwriting"
        });
      } else {
        warnings.push({
          code: "NO_MEDICATIONS",
          message: "Medications not available - Stage 3 required for handwriting extraction"
        });
      }
    }

    // Check diagnosis consistency
    if (mergedData.diagnosis?.principal && mergedData.medications?.length > 0) {
      // Basic check: do medications make sense for diagnosis?
      // This is a simplified validation
      const diagnosisLower = (mergedData.diagnosis.principal || "").toLowerCase();
      const hasDiabetesMeds = mergedData.medications.some(m =>
        (m.name || "").toLowerCase().includes('insulin') ||
        (m.name || "").toLowerCase().includes('metformin')
      );
      const hasHypertensionMeds = mergedData.medications.some(m =>
        (m.name || "").toLowerCase().includes('amlodipine') ||
        (m.name || "").toLowerCase().includes('metoprolol')
      );

      // Informational notes, not failures
      if (diagnosisLower.includes('diabetes') && !hasDiabetesMeds) {
        warnings.push({
          code: "MEDICATION_MISMATCH",
          message: "Diabetes diagnosed but no diabetes medications found"
        });
      }
      if (diagnosisLower.includes('hypertension') && !hasHypertensionMeds) {
        warnings.push({
          code: "MEDICATION_MISMATCH",
          message: "Hypertension diagnosed but no antihypertensive medications found"
        });
      }
    }

    // Check extraction quality
    const quality = mergedData.extraction_quality?.overall_confidence || "medium";
    if (quality === "low") {
      issues.push({
        code: "LOW_EXTRACTION_QUALITY",
        message: "Overall extraction quality is low - manual review recommended"
      });
    }

    return {
      passed: issues.length === 0,
      issues,
      warnings,
      confidence_score: mergedData.extraction_quality?.score || 0.5
    };
  }

  /**
   * Transform merged data to dashboard-compatible format
   */
  transformToDashboardFormat(mergedData) {
    const resolvedMrn = this.resolveHospitalNumber(mergedData);
    const resolvedDepartment = this.resolveDepartment(mergedData);
    const resolvedVisitType = this.resolveVisitType(mergedData.visit);

    // This format aligns with what DashboardMapperSkill expects
    return {
      // Patient card data
      patient: {
        name: mergedData.patient?.name || null,
        age: mergedData.patient?.age || null,
        gender: mergedData.patient?.gender || null,
        mrn: resolvedMrn,
        contact: mergedData.patient?.contact || null
      },

      // Visit metadata
      meta: {
        rx_date: mergedData.visit?.date || mergedData.patient?.date || mergedData.doctor?.date || null,
        visit_type: resolvedVisitType,
        episode_number: mergedData.visit?.episode_number || mergedData.visit?.episode_no || null,
        opd_number: mergedData.visit?.opd_number || null,
        ipd_number: mergedData.visit?.ipd_number || null,
        department_type: resolvedDepartment,
        document_type: "prescription",
        extracted_at: new Date().toISOString()
      },

      // Hospital/Doctor info (for prescription-specific cards)
      hospital: mergedData.hospital || {},
      doctor: mergedData.doctor || {},

      // Medications card - normalize dosage to dose field
      medications: this.formatMedications(mergedData.medications || []),
      medications_metadata: mergedData.medications_metadata || {},

      // Vitals card
      vitals: this.formatVitals(mergedData.vitals),

      // Diagnosis card
      diagnosis: {
        principal: mergedData.diagnosis?.principal || null,
        secondary: mergedData.diagnosis?.secondary || [],
        symptoms: mergedData.diagnosis?.symptoms || [],
        clinical_notes: this.getHandwrittenNoteTexts(mergedData)
      },

      // Labs card (investigations selected)
      lab_results: [],
      investigations: this.formatInvestigations(mergedData.lab_investigations),

      // Radiology card
      radiology: this.formatRadiology(mergedData.radiology_selections),

      // Nuclear medicine card
      nuclear_medicine: this.formatNuclearMedicine(mergedData.nuclear_medicine),

      // Treatment card (minimal for prescriptions)
      treatment: {
        current_approach: this.buildTreatmentApproach(mergedData),
        management_items: this.buildTreatmentManagementItems(mergedData)
      },

      // Clinical notes
      clinical_notes: this.formatClinicalNotes(mergedData),

      // Risk scores (not applicable for prescriptions)
      risk_scores: {},

      // Procedures - use extracted procedures from Stage 3, or extract from diagnosis notes
      procedures: (mergedData.procedures && mergedData.procedures.length > 0)
        ? mergedData.procedures
        : this.extractProcedures(mergedData),

      // Follow-up - extract from clinical notes
      follow_up: this.extractFollowUp(mergedData),

      // Allergies (not in prescription)
      allergies: [],

      // Provenance for dashboard display
      provenance: {
        medications: this.buildProvenance("medications", mergedData),
        vitals: this.buildProvenance("vitals", mergedData),
        diagnosis: this.buildProvenance("diagnosis", mergedData),
        labs: this.buildProvenance("labs", mergedData),
        radiology: this.buildProvenance("radiology", mergedData)
      }
    };
  }

  normalizeIdentifier(value) {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    return normalized || null;
  }

  isVisitIdentifier(value) {
    const normalized = this.normalizeIdentifier(value);
    if (!normalized) return false;

    return /^(?:O\d{5,}|OPD?\s*[-:]?\s*[A-Z0-9-]+|OP\s*[-:]?\s*[A-Z0-9-]+|I\d{5,}|IPD?\s*[-:]?\s*[A-Z0-9-]+|IP\s*[-:]?\s*[A-Z0-9-]+|EP(?:ISODE)?\s*[-:]?\s*[A-Z0-9-]+|VISIT\s*[-:]?\s*[A-Z0-9-]+)/i.test(
      normalized
    );
  }

  normalizeComparisonKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  resolveHospitalNumber(mergedData) {
    const visit = mergedData.visit || {};
    const patient = mergedData.patient || {};
    const blockedKeys = new Set(
      [
        visit.episode_number,
        visit.episode_no,
        visit.opd_number,
        visit.ipd_number,
        patient.opd_number,
        patient.ipd_number,
      ]
        .map((value) => this.normalizeComparisonKey(value))
        .filter(Boolean)
    );

    const candidates = [
      patient.mrn,
      patient.hospital_no,
      mergedData?.stage1?.phi?.hospital_no,
      mergedData?.phi?.hospital_no,
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeIdentifier(candidate);
      if (!normalized) continue;
      const comparisonKey = this.normalizeComparisonKey(normalized);
      if (!comparisonKey || blockedKeys.has(comparisonKey) || this.isVisitIdentifier(normalized)) continue;
      return normalized;
    }

    return null;
  }

  resolveVisitType(visit = {}) {
    const explicit = String(visit?.visit_type || "").trim().toUpperCase();
    if (explicit === "OPD" || explicit === "IPD") return explicit;
    if (visit?.ipd_number) return "IPD";
    if (visit?.opd_number || visit?.episode_number || visit?.episode_no) return "OPD";
    return "unknown";
  }

  resolveDepartment(mergedData) {
    return (
      mergedData.visit?.department ||
      mergedData.hospital?.department ||
      mergedData.doctor?.department ||
      mergedData.doctor?.specialty ||
      mergedData.document_structure?.department ||
      null
    );
  }

  formatMedications(medications) {
    // Normalize medication data - ensure dose field is populated from dosage
    return medications.map(med => ({
      ...med,
      // Normalize: use dosage if dose is not present
      dose: med.dose || med.dosage || "As prescribed",
      // Keep dosage for backward compatibility
      dosage: med.dosage || med.dose || "As prescribed"
    }));
  }

  formatVitals(vitals) {
    // Format vitals for dashboard consumption
    const v = vitals || {};
    return {
      latest: {
        bp: {
          systolic: typeof v.blood_pressure?.systolic === "number" ? v.blood_pressure.systolic : null,
          diastolic: typeof v.blood_pressure?.diastolic === "number" ? v.blood_pressure.diastolic : null
        },
        pulse: { value: typeof v.pulse?.value === "number" ? v.pulse.value : null, unit: v.pulse?.unit || "bpm" },
        temperature: { value: typeof v.temperature?.value === "number" ? v.temperature.value : null, unit: v.temperature?.unit || "°F" },
        weight: { value: typeof v.weight?.value === "number" ? v.weight.value : null, unit: v.weight?.unit || "kg" },
        spo2: { value: typeof v.spo2?.value === "number" ? v.spo2.value : null, unit: v.spo2?.unit || "%" },
        resp_rate: { value: typeof v.respiratory_rate?.value === "number" ? v.respiratory_rate.value : null, unit: v.respiratory_rate?.unit || "/min" }
      },
      has_vitals: vitals?.has_vitals || false
    };
  }

  formatInvestigations(labInvestigations) {
    // Format extracted lab orders for investigations list
    const selected = labInvestigations?.selected_tests || [];
    return this.dedupeClinicalOrders(
      selected.map(test => ({
        type: test.test_name,
        status: test.is_checked || test.source === "text_order" || test.source === "text+visual" || test.source === "note_reconciliation" ? "ordered" : "not_selected",
        priority: test.priority || "routine",
        source: test.source || "visual_selection",
        is_uncertain: Boolean(test.is_uncertain),
        confidence_reason: test.confidence_reason || ""
      }))
    );
  }

  formatRadiology(radiologySelections) {
    // Format extracted radiology / study orders
    const selected = radiologySelections?.selected_studies || [];
    return this.dedupeClinicalOrders(
      selected.map(study => ({
        type: study.study_name,
        status: study.is_checked || study.source === "text_order" || study.source === "text+visual" || study.source === "note_reconciliation" ? "ordered" : "not_selected",
        source: study.source || "visual_selection",
        is_uncertain: Boolean(study.is_uncertain),
        confidence_reason: study.confidence_reason || ""
      }))
    );
  }

  formatNuclearMedicine(nuclearMedicineSelections) {
    // Format extracted nuclear medicine studies
    const selected = nuclearMedicineSelections?.selected_studies || [];
    return this.dedupeClinicalOrders(
      selected.map(study => ({
        type: study.study_name,
        status: "ordered",
        source: "text_order",
        is_uncertain: Boolean(study.is_uncertain),
        confidence_reason: study.confidence_reason || ""
      }))
    );
  }

  normalizeOrderKey(value) {
    const normalized = String(value || "")
      .toLowerCase()
      .replace(/\bc\/s\b/g, "culture sensitivity")
      .replace(/\busg\b/g, "ultrasound")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    return normalized;
  }

  dedupeClinicalOrders(items) {
    const deduped = new Map();

    for (const item of Array.isArray(items) ? items : []) {
      const label = String(item?.type || "").trim();
      if (!label) continue;

      const key = this.normalizeOrderKey(label);
      const existing = deduped.get(key);
      const score = [
        item?.status === "ordered" ? 4 : 0,
        item?.source === "text+visual" ? 3 : 0,
        item?.source === "text_order" ? 2 : 0,
        item?.source === "note_reconciliation" ? 2 : 0,
        item?.source === "visual_selection" ? 1 : 0,
      ].reduce((sum, value) => sum + value, 0);

      if (!existing || score > existing.score || (score === existing.score && label.length > existing.item.type.length)) {
        deduped.set(key, { item, score });
      }
    }

    return Array.from(deduped.values()).map((entry) => entry.item);
  }

  buildTreatmentManagementItems(mergedData) {
    const explicitItems = Array.isArray(mergedData?.treatment?.management_items)
      ? mergedData.treatment.management_items
      : [];
    if (explicitItems.length > 0) return explicitItems;

    const procedures = Array.isArray(mergedData?.procedures) ? mergedData.procedures : [];
    return procedures
      .map((procedure) => typeof procedure === "string" ? procedure : procedure?.name)
      .filter(Boolean);
  }

  buildTreatmentApproach(mergedData) {
    if (mergedData?.treatment?.current_approach) return mergedData.treatment.current_approach;

    const procedureNames = this.buildTreatmentManagementItems(mergedData);
    if (procedureNames.length > 0) {
      return `Ordered procedures: ${procedureNames.slice(0, 3).join(", ")}`;
    }

    return "";
  }

  formatClinicalNotes(mergedData) {
    const notes = [];

    // Add doctor info as a clinical note (more concise)
    if (mergedData.doctor?.name) {
      const doctorName = this.cleanAuthorName(mergedData.doctor.name);
      notes.push({
        type: "Prescribing Doctor",
        author: doctorName,
        date: mergedData.visit?.date || new Date().toISOString().split('T')[0],
        summary: `Signed by ${doctorName}`,
        source_excerpt: [],
        source_type: "synthetic",
        is_synthetic: true,
        page_number: null,
        confidence: "high",
        confidence_reason: "",
        is_inferred: false
      });
    }

    // Add diagnosis as clinical note if present (more concise)
    if (mergedData.diagnosis?.principal) {
      notes.push({
        type: "Diagnosis",
        author: this.cleanAuthorName(mergedData.doctor?.name || "Unknown"),
        date: mergedData.visit?.date || new Date().toISOString().split('T')[0],
        summary: mergedData.diagnosis.principal,
        assessment: mergedData.diagnosis.symptoms?.join(", ") || "",
        source_excerpt: [],
        source_type: "synthetic",
        is_synthetic: true,
        page_number: null,
        confidence: "medium",
        confidence_reason: "",
        is_inferred: true
      });
    }

    // Add handwritten notes from Stage 3 as first-class note items
    if (Array.isArray(mergedData.handwritten_notes) && mergedData.handwritten_notes.length > 0) {
      mergedData.handwritten_notes.forEach((note) => {
        const noteText = String(note?.text || "").trim();
        if (noteText) {
          notes.push({
            type: this.mapHandwrittenNoteCategory(note.category),
            author: this.cleanAuthorName(mergedData.doctor?.name || "Unknown"),
            date: mergedData.visit?.date || new Date().toISOString().split('T')[0],
            summary: noteText,
            source_excerpt: note.source_excerpt ? [note.source_excerpt] : [noteText],
            source_type: "handwritten",
            is_synthetic: false,
            page_number: note.page_number || null,
            confidence: note.confidence || "medium",
            confidence_reason: note.confidence_reason || "",
            is_inferred: Boolean(note.is_inferred)
          });
        }
      });
    } else if (mergedData.diagnosis?.clinical_notes && Array.isArray(mergedData.diagnosis.clinical_notes)) {
      // Legacy fallback for older records
      mergedData.diagnosis.clinical_notes.forEach((noteText) => {
        if (noteText && noteText.trim()) {
          notes.push({
            type: "Clinical Note",
            author: this.cleanAuthorName(mergedData.doctor?.name || "Unknown"),
            date: mergedData.visit?.date || new Date().toISOString().split('T')[0],
            summary: noteText.trim(),
            source_excerpt: [noteText.trim()],
            source_type: "handwritten",
            is_synthetic: false,
            page_number: null,
            confidence: "medium",
            confidence_reason: "",
            is_inferred: false
          });
        }
      });
    }

    return notes;
  }

  mapHandwrittenNoteCategory(category) {
    const normalized = String(category || "").toLowerCase();
    if (normalized === "follow_up") return "Follow-up";
    if (normalized === "advice") return "Advice";
    if (normalized === "finding") return "Finding";
    if (normalized === "unclear_note") return "Unclear Note";
    return "Clinical Note";
  }

  getHandwrittenNoteTexts(mergedData) {
    if (Array.isArray(mergedData.handwritten_notes) && mergedData.handwritten_notes.length > 0) {
      return mergedData.handwritten_notes
        .map((note) => String(note?.text || "").trim())
        .filter(Boolean);
    }

    if (Array.isArray(mergedData.diagnosis?.clinical_notes)) {
      return mergedData.diagnosis.clinical_notes.filter(Boolean);
    }

    return [];
  }

  /**
   * Clean up author name by removing long credential lists
   */
  cleanAuthorName(author) {
    if (!author) return "Unknown";

    // If author has parenthesized credentials, extract just the name before it
    // Handles: "Dr. NAME (CREDENTIALS)" or "NAME (CREDENTIALS)"
    const match = author.match(/^([A-Za-z][A-Za-z\s\.]+?)\s*\(.*?\)/);
    if (match) {
      return match[1].trim();
    }

    // If author is very long (probably with credentials), truncate after first 2-3 words
    if (author.length > 50) {
      const words = author.split(/\s+/);
      // Keep "Dr." title if present, plus first name
      if (words.length > 2) {
        const hasDr = words[0]?.match(/^Dr\.?$/i);
        if (hasDr) {
          return `${words[0]} ${words[1]}`;
        }
        return words.slice(0, 2).join(" ");
      }
    }

    return author;
  }

  buildProvenance(section, mergedData) {
    // Build provenance info for dashboard
    const metadata = {
      section,
      has_data: false,
      source: "unknown",
      confidence: "medium"
    };

    switch (section) {
      case "medications":
        metadata.has_data = (mergedData.medications?.length || 0) > 0;
        metadata.source = mergedData.medications?.[0]?.is_handwritten ? "handwriting" : "printed";
        metadata.confidence = mergedData.medications_metadata?.unreadable_count === 0 ? "high" : "medium";
        break;
      case "vitals":
        metadata.has_data = mergedData.vitals_metadata?.has_vitals || false;
        metadata.source = "handwriting";
        metadata.confidence = mergedData.vitals_metadata?.confidence || "medium";
        break;
      case "diagnosis":
        metadata.has_data = mergedData.diagnosis_metadata?.has_diagnosis || false;
        metadata.source = "handwriting";
        metadata.confidence = mergedData.diagnosis_metadata?.confidence || "medium";
        break;
      case "labs":
        metadata.has_data = (mergedData.lab_investigations?.total_selected || 0) > 0;
        metadata.source = this.detectOrderSource(mergedData.lab_investigations?.selected_tests || []);
        metadata.confidence = mergedData.orders_metadata?.confidence || mergedData.visual_metadata?.confidence || "medium";
        break;
      case "radiology":
        metadata.has_data = (mergedData.radiology_selections?.selected_studies?.length || 0) > 0;
        metadata.source = this.detectOrderSource(mergedData.radiology_selections?.selected_studies || []);
        metadata.confidence = mergedData.orders_metadata?.confidence || mergedData.visual_metadata?.confidence || "medium";
        break;
    }

    return metadata;
  }

  detectOrderSource(items) {
    const sources = new Set(
      (Array.isArray(items) ? items : [])
        .map((item) => item?.source)
        .filter(Boolean)
    );

    if (sources.has("text+visual")) return "text_order+visual_selection";
    if (sources.has("text_order") && sources.has("visual_selection")) return "text_order+visual_selection";
    if (sources.has("note_reconciliation") && sources.has("visual_selection")) return "text_order+visual_selection";
    if (sources.has("text_order") && sources.has("note_reconciliation")) return "text_order";
    if (sources.has("text_order")) return "text_order";
    if (sources.has("note_reconciliation")) return "text_order";
    if (sources.has("visual_selection")) return "visual_selection";
    return "unknown";
  }

  /**
   * Extract follow-up information from clinical notes
   * Looks for review, revisit, follow-up instructions
   */
  extractFollowUp(mergedData) {
    const followUp = {
      next_appointment: null,
      appointments: []
    };

    // Collect all text sources that might contain follow-up info
    const textSources = [];

    // From diagnosis clinical notes
    textSources.push(...this.getHandwrittenNoteTexts(mergedData));

    // From medications metadata (notes field)
    if (mergedData.medications_metadata?.notes) {
      textSources.push(mergedData.medications_metadata.notes);
    }

    // Combine all text and search for follow-up patterns
    const allText = textSources.join(' ').toLowerCase();

    // Follow-up keyword patterns
    const followUpPatterns = [
      /follow[- ]?up\s*(?:after|in|within|on)?\s*(\d+)?\s*(days?|weeks?|months?)?/i,
      /review\s*(?:after|in|within)?\s*(\d+)?\s*(days?|weeks?|months?)?/i,
      /revisit\s*(?:after|in|within)?\s*(\d+)?\s*(days?|weeks?|months?)?/i,
      /report\s+(?:back|again)\s*(?:after|in)?\s*(\d+)?\s*(days?|weeks?|months?)?/i,
      /come\s+(?:back|again)\s*(?:after|in)?\s*(\d+)?\s*(days?|weeks?|months?)?/i
    ];

    let foundFollowUp = null;
    for (const pattern of followUpPatterns) {
      const match = allText.match(pattern);
      if (match) {
        const number = match[1] ? parseInt(match[1]) : 1;
        const unit = match[2] || 'days';

        // Normalize unit
        let normalizedUnit = unit.toLowerCase();
        if (normalizedUnit.endsWith('s')) {
          // Keep plural
        }

        foundFollowUp = {
          text: match[0],
          number,
          unit: normalizedUnit,
          source: "extracted_from_notes"
        };
        break;
      }
    }

    // If we found follow-up info, create structured appointments
    if (foundFollowUp) {
      const appointmentDate = new Date();
      const unitToDays = {
        'day': 1, 'days': 1,
        'week': 7, 'weeks': 7,
        'month': 30, 'months': 30
      };
      const daysToAdd = (foundFollowUp.number || 1) * (unitToDays[foundFollowUp.unit] || 1);
      appointmentDate.setDate(appointmentDate.getDate() + daysToAdd);

      followUp.next_appointment = appointmentDate.toISOString().split('T')[0];
      followUp.appointments = [{
        date: followUp.next_appointment,
        type: "Follow-up",
        notes: foundFollowUp.text,
        status: "scheduled"
      }];
    }

    return followUp;
  }

  /**
   * Extract procedures from multiple sources:
   * 1. Procedures array from Stage 3 (explicitly extracted)
   * 2. Radiology studies with category "procedure" (LLM sometimes classifies them here)
   * 3. Clinical notes mentioning procedure keywords
   */
  extractProcedures(mergedData) {
    const procedures = [];
    const seen = new Set(); // Deduplicate by name

    // 1. Check for explicit procedures array
    const explicitProcedures = mergedData.procedures || [];
    for (const proc of explicitProcedures) {
      const name = typeof proc === 'string' ? proc : (proc.name || '');
      if (name && !seen.has(name)) {
        seen.add(name);
        procedures.push({
          name: name.trim(),
          category: typeof proc === 'object' ? (proc.category || '') : '',
          is_uncertain: typeof proc === 'object' ? Boolean(proc.is_uncertain) : false,
          confidence_reason: typeof proc === 'object' ? (proc.confidence_reason || '') : '',
          source: "explicit_extraction",
          status: "ordered"
        });
      }
    }

    // 2. Extract from radiology studies with category "procedure"
    const radiologySelections = mergedData.radiology_selections || mergedData.radiology || {};
    const radiologyStudies = radiologySelections.selected_studies || [];
    for (const study of radiologyStudies) {
      const category = (study.category || '').toLowerCase();
      if (category === 'procedure' || category === 'procedures' || category === 'interventional') {
        const name = study.study_name || study.name || '';
        if (name && !seen.has(name)) {
          seen.add(name);
          procedures.push({
            name: name.trim(),
            category: study.category || 'procedure',
            is_uncertain: Boolean(study.is_uncertain),
            confidence_reason: study.confidence_reason || '',
            source: study.source || "radiology_order",
            status: study.is_checked ? "ordered" : "mentioned"
          });
        }
      }
    }

    // 3. Collect from clinical notes (only if we haven't found enough procedures yet)
    if (procedures.length === 0) {
      const clinicalNotes = this.getHandwrittenNoteTexts(mergedData);

      // Procedure-related keywords
      const procedureKeywords = [
        'procedure', 'surgery', 'operation', 'incision', 'drainage',
        'intubation', 'extubation', 'catheter', 'paracentesis', 'thoracentesis',
        'lumbar puncture', 'lp', 'biopsy', 'endoscopy', 'colonoscopy',
        'bronchoscopy', 'laparotomy', 'laparoscopy', 'tracheostomy',
        'reduction', 'fixation', 'arthrocentesis', ' aspirations',
        'uroflowmetry', 'urodynamics', 'cystoscopy', 'ncs', 'emg', 'pft', 'spirometry'
      ];

      for (const note of clinicalNotes) {
        if (!note || typeof note !== 'string') continue;

        const lowerNote = note.toLowerCase().trim();

        // Check if note contains procedure keywords
        const hasProcedureKeyword = procedureKeywords.some(keyword =>
          lowerNote.includes(keyword)
        );

        if (hasProcedureKeyword) {
          // Extract the procedure description
          // Avoid adding generic clinical notes that just happen to contain keywords
          const words = note.split(/\s+/);
          if (words.length >= 1 && words.length <= 15) {
            // Reasonable length for a procedure description
            if (!seen.has(note)) {
              seen.add(note);
              procedures.push({
                name: note.trim(),
                source: "clinical_notes",
                status: "mentioned"
              });
            }
          }
        }
      }
    }

    return procedures;
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      name: this.name,
      version: this.version,
      type: this.type,
      stage: "stage4"
    };
  }
}

module.exports = DataIntegrationAgent;
