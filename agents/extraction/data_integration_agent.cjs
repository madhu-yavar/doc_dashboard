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
 * 4. Populate to database
 */

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
    // Stage 3 provides: medications, vitals, diagnosis, lab/radiology orders, visual selections

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
      lab_investigations: stage3.lab_investigations || { selected_tests: [] },
      radiology_selections: stage3.radiology_selections || { selected_studies: [] },
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
    // This format aligns with what DashboardMapperSkill expects
    return {
      // Patient card data
      patient: {
        name: mergedData.patient?.name || null,
        age: mergedData.patient?.age || null,
        gender: mergedData.patient?.gender || null,
        mrn: mergedData.patient?.mrn || null,
        contact: mergedData.patient?.contact || null
      },

      // Visit metadata
      meta: {
        rx_date: mergedData.visit?.date || null,
        visit_type: mergedData.visit?.visit_type || "unknown",
        episode_number: mergedData.visit?.episode_number || null,
        opd_number: mergedData.visit?.opd_number || null,
        ipd_number: mergedData.visit?.ipd_number || null,
        document_type: "prescription",
        extracted_at: new Date().toISOString()
      },

      // Hospital/Doctor info (for prescription-specific cards)
      hospital: mergedData.hospital || {},
      doctor: mergedData.doctor || {},

      // Medications card
      medications: mergedData.medications || [],
      medications_metadata: mergedData.medications_metadata || {},

      // Vitals card
      vitals: this.formatVitals(mergedData.vitals),

      // Diagnosis card
      diagnosis: {
        principal: mergedData.diagnosis?.principal || null,
        secondary: mergedData.diagnosis?.secondary || [],
        symptoms: mergedData.diagnosis?.symptoms || [],
        clinical_notes: mergedData.diagnosis?.clinical_notes || []
      },

      // Labs card (investigations selected)
      lab_results: [],
      investigations: this.formatInvestigations(mergedData.lab_investigations),

      // Radiology card
      radiology: this.formatRadiology(mergedData.radiology_selections),

      // Treatment card (minimal for prescriptions)
      treatment: {
        current_approach: "Prescription treatment",
        management_items: []
      },

      // Clinical notes
      clinical_notes: this.formatClinicalNotes(mergedData),

      // Risk scores (not applicable for prescriptions)
      risk_scores: {},

      // Procedures
      procedures: [],

      // Follow-up
      follow_up: {
        next_appointment: null,
        appointments: []
      },

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

  formatVitals(vitals) {
    // Format vitals for dashboard consumption
    const v = vitals || {};
    return {
      latest: {
        bp: {
          systolic: v.blood_pressure?.systolic || 0,
          diastolic: v.blood_pressure?.diastolic || 0
        },
        pulse: { value: v.pulse?.value || 0, unit: v.pulse?.unit || "bpm" },
        temperature: { value: v.temperature?.value || 0, unit: v.temperature?.unit || "°F" },
        weight: { value: v.weight?.value || 0, unit: v.weight?.unit || "kg" },
        spo2: { value: v.spo2?.value || 0, unit: v.spo2?.unit || "%" },
        resp_rate: { value: v.respiratory_rate?.value || 0, unit: v.respiratory_rate?.unit || "/min" }
      },
      has_vitals: vitals?.has_vitals || false
    };
  }

  formatInvestigations(labInvestigations) {
    // Format extracted lab orders for investigations list
    const selected = labInvestigations?.selected_tests || [];
    return selected.map(test => ({
      type: test.test_name,
      status: test.is_checked || test.source === "text_order" || test.source === "text+visual" ? "ordered" : "not_selected",
      priority: test.priority || "routine",
      source: test.source || "visual_selection",
      is_uncertain: Boolean(test.is_uncertain),
      confidence_reason: test.confidence_reason || ""
    }));
  }

  formatRadiology(radiologySelections) {
    // Format extracted radiology / study orders
    const selected = radiologySelections?.selected_studies || [];
    return selected.map(study => ({
      type: study.study_name,
      status: study.is_checked || study.source === "text_order" || study.source === "text+visual" ? "ordered" : "not_selected",
      source: study.source || "visual_selection",
      is_uncertain: Boolean(study.is_uncertain),
      confidence_reason: study.confidence_reason || ""
    }));
  }

  formatClinicalNotes(mergedData) {
    const notes = [];

    // Add doctor info as a clinical note
    if (mergedData.doctor?.name) {
      notes.push({
        type: "Prescribing Doctor",
        author: mergedData.doctor.name,
        date: mergedData.visit?.date || new Date().toISOString().split('T')[0],
        summary: `Prescription signed by ${mergedData.doctor.name}${mergedData.doctor.registration_number ? ` (Reg: ${mergedData.doctor.registration_number})` : ""}`,
        source_excerpt: []
      });
    }

    // Add diagnosis as clinical note if present
    if (mergedData.diagnosis?.principal) {
      notes.push({
        type: "Diagnosis",
        author: mergedData.doctor?.name || "Unknown",
        date: mergedData.visit?.date || new Date().toISOString().split('T')[0],
        summary: `Principal: ${mergedData.diagnosis.principal}`,
        assessment: mergedData.diagnosis.symptoms?.join(", ") || "",
        source_excerpt: []
      });
    }

    // Add clinical notes from Stage 3 if present
    if (mergedData.diagnosis?.clinical_notes && Array.isArray(mergedData.diagnosis.clinical_notes)) {
      mergedData.diagnosis.clinical_notes.forEach((noteText, index) => {
        if (noteText && noteText.trim()) {
          notes.push({
            type: "Clinical Note",
            author: mergedData.doctor?.name || "Unknown",
            date: mergedData.visit?.date || new Date().toISOString().split('T')[0],
            summary: noteText.trim(),
            source_excerpt: []
          });
        }
      });
    }

    return notes;
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
    if (sources.has("text_order")) return "text_order";
    if (sources.has("visual_selection")) return "visual_selection";
    return "unknown";
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
