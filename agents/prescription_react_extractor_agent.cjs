/**
 * Prescription Extractor Agent (ReAct-Style)
 * Multi-step extraction with validation for prescription documents
 * Uses Qwen 30B Vision model for optimal handwriting and printed text extraction
 */

const PDFReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");
const HandwritingDetectorSkill = require("../skills/detection/handwriting_detector.skill.cjs");

// Prescription-specific extraction skills
const PrescriptionPatientExtractorSkill = require("../skills/extraction/prescription_patient_extractor.skill.cjs");
const PrescriptionMedicationsExtractorSkill = require("../skills/extraction/prescription_medications_extractor.skill.cjs");
const PrescriptionDiagnosisExtractorSkill = require("../skills/extraction/prescription_diagnosis_extractor.skill.cjs");
const PrescriptionDoctorExtractorSkill = require("../skills/extraction/prescription_doctor_extractor.skill.cjs");

// Validation
const PrescriptionCrossValidatorSkill = require("../skills/validation/prescription_cross_validator.skill.cjs");

class PrescriptionReactExtractorAgent {
  constructor(config = {}) {
    this.name = "Prescription Extractor (ReAct)";
    this.version = "2.0.0";
    this.type = "thinking_agent";

    // Initialize tools
    this.pdfReader = new PDFReaderTool(config);
    this.handwritingDetector = new HandwritingDetectorSkill(config.qwen || {});

    // Initialize extraction skills
    this.patientExtractorSkill = new PrescriptionPatientExtractorSkill(config.qwen || {});
    this.medicationsExtractorSkill = new PrescriptionMedicationsExtractorSkill(config.qwen || {});
    this.diagnosisExtractorSkill = new PrescriptionDiagnosisExtractorSkill(config.qwen || {});
    this.doctorExtractorSkill = new PrescriptionDoctorExtractorSkill(config.qwen || {});

    // Initialize validation skill
    this.crossValidatorSkill = new PrescriptionCrossValidatorSkill();

    this.config = {
      maxRetries: 2,
      timeoutPerStep: 180000,
      totalTimeout: 600000,
      requireAllSteps: false,
      logSteps: true,
      saveIntermediates: true,
      ...config
    };

    // Qwen 30B configuration
    this.qwenModel = config.qwen?.qwenModel || process.env.QWEN_MODEL || "cyankiwi/Qwen3-VL-30B-A3B-Instruct-AWQ-4bit";
    this.qwenUrl = config.qwen?.qwenUrl || process.env.QWEN_URL || "http://206.1.62.28:8001/v1/chat/completions";
  }

  /**
   * Build the execution plan for prescription extraction
   */
  buildExecutionPlan() {
    const extraction = [];
    const validation = [];
    let stepNumber = 1;

    // Step 1: Patient Information
    extraction.push({ skill: this.patientExtractorSkill, stepNumber, category: "extraction", name: "Patient Information" });
    stepNumber++;

    // Step 2: Medications (most important - do second)
    extraction.push({ skill: this.medicationsExtractorSkill, stepNumber, category: "extraction", name: "Medications" });
    stepNumber++;

    // Step 3: Diagnosis
    extraction.push({ skill: this.diagnosisExtractorSkill, stepNumber, category: "extraction", name: "Diagnosis" });
    stepNumber++;

    // Step 4: Doctor Information
    extraction.push({ skill: this.doctorExtractorSkill, stepNumber, category: "extraction", name: "Doctor Information" });
    stepNumber++;

    // Step 5: Cross-validation
    validation.push({ skill: this.crossValidatorSkill, stepNumber, category: "validation", name: "Cross-Validation" });

    return {
      extraction,
      validation,
      totalSteps: [...extraction, ...validation].length,
    };
  }

  /**
   * Execute a single step in the extraction pipeline
   */
  async executeStep(stepDef, context, totalSteps, onProgress) {
    const { skill, stepNumber, name } = stepDef;
    const stepName = name || skill.name;
    console.log(`\n   🔄 ${stepName}...`);

    if (onProgress) {
      onProgress({
        type: "step",
        step: stepName,
        stepNumber,
        totalSteps,
        status: "running",
      });
    }

    let stepResult;
    const startTime = Date.now();

    try {
      stepResult = await skill.execute(context);
    } catch (error) {
      stepResult = {
        success: false,
        step: this.toStepId(stepName),
        error: error instanceof Error ? error.message : String(error),
        data: null,
      };
    }

    const endTime = Date.now();
    const latencyMs = endTime - startTime;

    const normalizedResult = {
      ...stepResult,
      step: stepResult.step || this.toStepId(stepName),
      stepNumber,
      name: stepName,
      category: stepDef.category,
      usage: {
        ...(stepResult.usage || {}),
        latencyMs,
        latency: latencyMs,
        startedAt: new Date(startTime).toISOString(),
        endedAt: new Date(endTime).toISOString(),
      },
    };

    if (normalizedResult.success) {
      console.log(`      ✅ Completed (${normalizedResult.usage?.totalTokens || 0} tokens)`);

      if (onProgress) {
        onProgress({
          type: "step",
          step: stepName,
          stepNumber,
          totalSteps,
          status: "complete",
          data: {
            tokens: normalizedResult.usage?.totalTokens || 0,
            latency: latencyMs,
            dataKeys: normalizedResult.data ? Object.keys(normalizedResult.data) : [],
          }
        });
      }
    } else {
      console.log(`      ❌ Failed: ${normalizedResult.error}`);
      if (!this.config.requireAllSteps) {
        console.log(`      ⚠️  Continuing despite failure...`);
      }

      if (onProgress) {
        onProgress({
          type: "step",
          step: stepName,
          stepNumber,
          totalSteps,
          status: "error",
          error: normalizedResult.error
        });
      }
    }

    return normalizedResult;
  }

  toStepId(stepName) {
    return String(stepName || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  /**
   * Process a prescription document through the ReAct pipeline
   */
  async process(pdfPath, options = {}) {
    const startTime = Date.now();
    const pdfName = options.pdfName || pdfPath.split("/").pop();
    const onProgress = options.onProgress || null;
    const executionPlan = this.buildExecutionPlan();

    try {
      console.log(`\n📄 Processing: ${pdfName}`);
      console.log(`📋 Method: ReAct-Style Prescription Extraction with Qwen 30B`);

      // Emit starting event
      if (onProgress) {
        onProgress({ type: 'start', pdfName, totalSteps: executionPlan.totalSteps });
      }

      // Step 0: Read PDF
      console.log(`\n   📖 Reading PDF...`);
      const pdfResult = await this.pdfReader.execute(pdfPath, 12000);
      if (!pdfResult.success) {
        throw new Error(`Failed to read PDF: ${pdfResult.error}`);
      }

      const pdfText = pdfResult.text || "";
      console.log(`   📖 PDF read: ${pdfText.length} chars, ${pdfResult.pages} page(s)`);

      if (onProgress) {
        onProgress({
          type: 'step',
          step: 'pdf_read',
          stepNumber: 0,
          totalSteps: executionPlan.totalSteps,
          status: 'complete',
          data: {
            chars: pdfText.length,
            pages: pdfResult.pages
          }
        });
      }

      // Detect handwriting
      console.log(`\n   🔍 Detecting handwriting...`);
      const handwritingResult = await this.handwritingDetector.execute({
        filePath: pdfPath,
        onProgress
      });
      const hasHandwriting = handwritingResult.data?.has_handwriting || false;
      const handwritingPercentage = handwritingResult.data?.handwriting_percentage || 0;
      console.log(`   ✍️  Handwriting detected: ${hasHandwriting} (${handwritingPercentage}%)`);

      // Shared context for all extraction steps
      const sharedContext = {
        filePath: pdfPath,
        pdfText,
        hasHandwriting,
        handwritingPercentage
      };

      // Execute extraction steps sequentially (to avoid overwhelming Qwen)
      const extractionSteps = [];
      for (const stepDef of executionPlan.extraction) {
        const step = await this.executeStep(
          stepDef,
          sharedContext,
          executionPlan.totalSteps,
          onProgress
        );
        extractionSteps.push(step);
      }

      // Execute validation steps
      const validationSteps = [];
      for (const stepDef of executionPlan.validation) {
        const validationStep = await this.executeStep(
          stepDef,
          {
            ...sharedContext,
            steps: extractionSteps,
            previousSteps: extractionSteps,
            pdfText
          },
          executionPlan.totalSteps,
          onProgress
        );
        validationSteps.push(validationStep);
      }

      const steps = [...extractionSteps, ...validationSteps].sort(
        (left, right) => left.stepNumber - right.stepNumber
      );
      const totalTokens = steps.reduce((sum, step) => sum + (step.usage?.totalTokens || 0), 0);

      // Assemble final result
      const finalResult = this.assembleFinalResult(steps, pdfName, {
        hasHandwriting,
        handwritingPercentage
      });

      const endTime = Date.now();

      // Emit complete event
      if (onProgress) {
        onProgress({
          type: 'complete',
          pdfName,
          latency: endTime - startTime,
          tokensUsed: totalTokens,
          confidence: finalResult.validation.confidence_level
        });
      }

      // Transform to dashboard format for UI compatibility
      const dashboardData = this.transformToDashboardFormat(finalResult.data, {
        pdfName,
        hasHandwriting,
        handwritingPercentage
      });

      return {
        success: true,
        agent: this.name,
        pdfName: pdfName,
        pdfPath: pdfPath,
        latency: endTime - startTime,
        tokensUsed: totalTokens,
        steps: steps.map((step) => this.serializeStepSummary(step)),
        detailedSteps: steps.map((step) => this.serializeDetailedStep(step)),
        data: {
          ...finalResult.data,
          ...dashboardData
        },
        validation: finalResult.validation
      };

    } catch (error) {
      return {
        success: false,
        agent: this.name,
        error: error.message,
        pdfName: pdfName
      };
    }
  }

  /**
   * Assemble final validated result from all steps
   */
  assembleFinalResult(steps, pdfName, metadata = {}) {
    const { hasHandwriting, handwritingPercentage } = metadata;

    const data = {
      meta: {
        pdf_file: pdfName,
        document_type: "prescription",
        extraction_focus: "handwriting_optimized",
        router: {
          detected_type: "prescription",
          router_version: "2.0.0",
          confidence: "auto-detected",
          filename_used: pdfName,
          has_handwriting: hasHandwriting,
          handwriting_percentage: handwritingPercentage,
          model_used: "Qwen 30B"
        },
        agent_version: this.version
      },
      patient: {},
      doctor: {},
      medications: [],
      diagnosis: {},
      allergies: [],
      clinical_notes: [],
      treatment: {
        current_approach: "",
        management_items: []
      }
    };

    const validation = {
      confidence_level: "high",
      inconsistencies_found: [],
      missing_critical_fields: [],
      data_quality_notes: ""
    };

    // Merge data from all successful steps
    steps.forEach(step => {
      if (!step.success || !step.data) return;

      const stepData = step.data;

      // Merge patient information
      if (stepData.patient) {
        Object.assign(data.patient, {
          name: stepData.patient.name || data.patient.name,
          age: stepData.patient.age || data.patient.age,
          gender: stepData.patient.gender || data.patient.gender,
          mrn: stepData.patient.mrn || data.patient.mrn,
          admission_date: stepData.patient.date || data.patient.admission_date
        });
      }

      // Merge doctor information
      if (stepData.doctor) {
        Object.assign(data.doctor, {
          name: stepData.doctor.name || data.doctor.name,
          registration_number: stepData.doctor.registration_number || data.doctor.registration_number,
          specialty: stepData.doctor.specialty || data.doctor.specialty
        });
      }

      // Merge medications
      if (Array.isArray(stepData.medications)) {
        data.medications = [...data.medications, ...stepData.medications];
      }

      // Merge diagnosis
      if (stepData.diagnosis) {
        Object.assign(data.diagnosis, {
          principal: stepData.diagnosis.principal || data.diagnosis.principal,
          secondary: stepData.diagnosis.secondary || data.diagnosis.secondary,
          symptoms: stepData.diagnosis.symptoms || data.diagnosis.symptoms
        });
      }
    });

    // Build treatment info from medications
    data.treatment = {
      current_approach: `Prescription extracted using ReAct-style agent with Qwen 30B Vision model`,
      management_items: data.medications.map(m => `${m.name} ${m.dose}`.trim()).filter(Boolean)
    };

    // Build clinical notes
    if (data.doctor.name) {
      data.clinical_notes.push({
        type: "Prescription",
        author: data.doctor.name,
        date: data.patient.admission_date || new Date().toISOString().split('T')[0],
        summary: `Prescription with ${data.medications.length} medications. Model: ${this.qwenModel}. Handwriting detected: ${hasHandwriting} (${handwritingPercentage}%).`,
        source_excerpt: []
      });
    }

    // Collect validation information
    steps.forEach(step => {
      if (step.validation) {
        if (step.validation.inconsistencies) {
          validation.inconsistencies_found.push(...step.validation.inconsistencies);
        }
        if (step.validation.missing) {
          validation.missing_critical_fields.push(...step.validation.missing);
        }
        if (step.validation.flags) {
          validation.inconsistencies_found.push(...step.validation.flags);
        }
      }
    });

    // Clean up validation
    validation.inconsistencies_found = [...new Set(validation.inconsistencies_found)];
    validation.missing_critical_fields = [...new Set(validation.missing_critical_fields)];

    // Set confidence level
    if (validation.inconsistencies_found.length > 2) {
      validation.confidence_level = "low";
    } else if (validation.inconsistencies_found.length > 0) {
      validation.confidence_level = "medium";
    }

    // Generate data quality notes
    if (validation.confidence_level === "high") {
      validation.data_quality_notes = "All data successfully extracted and validated.";
    } else {
      validation.data_quality_notes = `Found ${validation.inconsistencies_found.length} inconsistencies. Review recommended.`;
    }

    // Add handwriting info to meta
    data.meta.handwriting_detected = hasHandwriting;
    data.meta.handwriting_percentage = handwritingPercentage;

    return { data, validation };
  }

  serializeStepSummary(step) {
    return {
      step: step.step,
      stepNumber: step.stepNumber,
      name: step.name,
      category: step.category,
      success: step.success,
      tokens: step.usage?.totalTokens || 0,
      latency: step.usage?.latencyMs || step.usage?.latency || 0,
      dataKeys: step.data ? Object.keys(step.data) : [],
      error: step.error || null
    };
  }

  serializeDetailedStep(step) {
    return {
      step: step.step,
      stepNumber: step.stepNumber,
      name: step.name,
      category: step.category,
      success: step.success,
      data: step.data || null,
      error: step.error || null,
      tokens: step.usage?.totalTokens || 0,
      latencyMs: step.usage?.latencyMs || step.usage?.latency || 0,
    };
  }

  /**
   * Transform prescription extraction result to dashboard format
   * This ensures compatibility with the existing UI
   */
  transformToDashboardFormat(extractionData, metadata = {}) {
    const { pdfName, hasHandwriting, handwritingPercentage } = metadata;

    // Build patient info from prescription data
    const patient = extractionData.patient || {};
    const extractedPatient = {
      name: patient.name || null,
      age: patient.age ? parseInt(patient.age) || 0 : 0,
      gender: patient.gender || null,
      mrn: patient.mrn || null,
      admission_date: patient.admission_date || null,
      discharge_date: null,
      los_days: 0
    };

    // Build diagnosis from prescription
    const diagnosis = extractionData.diagnosis || {};
    const extractedDiagnosis = {
      principal: diagnosis.principal || "Prescription Document",
      icd_code: null,
      secondary: diagnosis.secondary || [],
      comorbidities: [],
      symptoms: diagnosis.symptoms || []
    };

    // Build medications list
    const medications = extractionData.medications || [];
    const extractedMedications = medications.map(med => ({
      name: med.name || "",
      dose: med.dosage || med.dose || "",
      frequency: med.frequency || "",
      route: med.route || "Oral"
    }));

    // Build dashboard cards in the expected format
    const dashboardCards = {
      vitals_card: {
        status: "stable",
        summary: { latest_bp: "", pulse: "", temp: "", spo2: "" },
        trend: "stable",
        data_points: 0,
        has_alerts: false
      },
      diagnosis_card: {
        principal_diagnosis: diagnosis.principal || "Prescription",
        icd_code: "",
        secondary_count: diagnosis.secondary?.length || 0,
        secondary_diagnoses: diagnosis.secondary || [],
        procedures_count: 0
      },
      medications_card: {
        active_count: medications.length,
        allergy_count: 0,
        allergies: [],
        categories: [],
        medication_list: extractedMedications
      },
      labs_card: {
        total_tests: 0,
        abnormal_count: 0,
        critical_count: 0,
        pending_count: 0,
        top_abnormal: ""
      },
      radiology_card: {
        studies_completed: 0,
        critical_findings: 0,
        key_finding: ""
      },
      treatment_card: {
        procedures_performed: 0,
        surgeries: 0,
        response: "Not applicable for prescriptions",
        current_approach: `Prescription extracted with ReAct-style agent using Qwen 30B Vision model`,
        management_items: [],
        complications_count: 0
      },
      clinical_notes_card: {
        total_notes: 0,
        last_update: new Date().toISOString(),
        notes: []
      },
      discharge_plan_card: {
        condition: "Not applicable",
        instruction_count: 0,
        red_flags: 0
      },
      follow_up_card: {
        next_appointment: "",
        appointment_count: 0
      }
    };

    // Build sample patient data
    const samplePatientData = {
      name: patient.name || "Patient from Prescription",
      age: patient.age ? parseInt(patient.age) || 0 : 0,
      mrn: patient.mrn || "",
      admission_date: patient.admission_date || new Date().toISOString().split('T')[0],
      discharge_date: null,
      los_days: 0,
      summary: `Prescription document processed with ReAct-style agent. ${medications.length} medications extracted.`
    };

    // Build presentation layer
    const presentation = {
      summary_cards: {
        medications: {
          section: "medications",
          title: "Medications Prescribed",
          headline_metric: String(medications.length),
          secondary_line: medications.length === 1 ? "medication" : "medications",
          supporting_points: extractedMedications.slice(0, 2).map(m => m.name).filter(Boolean),
          status: "normal",
          provenance_status: hasHandwriting ? "source_backed" : "insufficient_evidence"
        },
        diagnosis: {
          section: "diagnosis",
          title: "Prescription Purpose",
          headline_metric: diagnosis.principal || "Not specified",
          secondary_line: diagnosis.symptoms?.length ? `${diagnosis.symptoms.length} symptoms noted` : "",
          supporting_points: diagnosis.symptoms?.slice(0, 2) || [],
          status: "neutral",
          provenance_status: "insufficient_evidence"
        },
        care_gaps: {
          section: "pending",
          title: "Extraction Notes",
          headline_metric: hasHandwriting ? "Handwriting" : "Printed",
          secondary_line: `${handwritingPercentage || 0}% handwriting detected`,
          supporting_points: [
            `Extracted with ReAct-style agent`,
            `Validated with cross-validator`
          ],
          status: "normal",
          provenance_status: "insufficient_evidence"
        }
      },
      notes_rail: []
    };

    // Add notes about the extraction
    if (extractionData.doctor?.name) {
      presentation.notes_rail.push({
        title: "Prescribing Doctor",
        author: extractionData.doctor.name,
        timestamp: patient.admission_date || new Date().toISOString(),
        body: `Prescription signed by ${extractionData.doctor.name}${extractionData.doctor.registration_number ? ` (Reg: ${extractionData.doctor.registration_number})` : ""}`,
        priority: "normal",
        category: "doctor"
      });
    }

    return {
      extracted_data: {
        patient: extractedPatient,
        diagnosis: extractedDiagnosis,
        medications: extractedMedications,
        allergies: [],
        treatment: {
          current_approach: `Prescription extracted using ReAct-style agent with Qwen 30B Vision model`,
          management_items: extractedMedications.map(m => `${m.name} ${m.dose}`.trim())
        },
        clinical_notes: extractionData.clinical_notes || []
      },
      dashboard_cards: dashboardCards,
      sample_patient_data: samplePatientData,
      presentation: presentation
    };
  }

  /**
   * Get agent status
   */
  getStatus() {
    const executionPlan = this.buildExecutionPlan();
    return {
      name: this.name,
      version: this.version,
      type: this.type,
      skillsCount: executionPlan.totalSteps,
      config: this.config,
      qwenModel: this.qwenModel,
      qwenUrl: this.qwenUrl
    };
  }
}

module.exports = PrescriptionReactExtractorAgent;
