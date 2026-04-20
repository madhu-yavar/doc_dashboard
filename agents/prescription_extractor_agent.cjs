/**
 * Prescription Extractor Agent
 * Extracts structured data from prescription documents
 * Uses Qwen 30B for optimal handwriting and printed text extraction
 * Integrates with the dashboard system for UI display
 */

const PDFReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");
const PrescriptionExtractorSkill = require("../skills/extraction/prescription_extractor.skill.cjs");
const HandwritingDetectorSkill = require("../skills/detection/handwriting_detector.skill.cjs");

class PrescriptionExtractorAgent {
  constructor(config = {}) {
    this.name = "Prescription Extractor Agent";
    this.version = "2.0.0";
    this.type = "prescription_extractor";
    this.documentType = "Prescription Document";
    this.config = config;

    // Initialize tools
    this.pdfReader = new PDFReaderTool(config);
    this.handwritingDetector = new HandwritingDetectorSkill(config);

    // Qwen 30B for all prescription extraction (handles both handwriting and printed text)
    this.qwenModel = config.qwenModel || process.env.QWEN_MODEL || "cyankiwi/Qwen3-VL-30B-A3B-Instruct-AWQ-4bit";
    this.qwenUrl = config.qwenUrl || process.env.QWEN_URL || "http://206.1.62.28:8001/v1/chat/completions";
  }

  parseModelJson(content) {
    const normalized = String(content || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const candidates = [];
    candidates.push(normalized);

    const firstBrace = normalized.indexOf("{");
    const lastBrace = normalized.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(normalized.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (_error) {
        continue;
      }
    }

    throw new Error("Unable to parse model JSON response");
  }

  /**
   * Process a prescription document
   */
  async process(pdfPath, options = {}) {
    const { pdfName, onProgress } = options;
    const startTime = Date.now();
    const steps = [];

    try {
      // Step 1: Read PDF text for context
      if (onProgress) {
        onProgress({
          type: "step",
          step: "Reading PDF",
          stepNumber: 1,
          totalSteps: 4,
          status: "processing"
        });
      }

      const pdfResult = await this.pdfReader.execute(pdfPath, 8000);
      const pdfText = pdfResult.success ? pdfResult.text : "";

      steps.push({
        success: true,
        step: "pdf_reader",
        tokens: 0,
        latency: Date.now() - startTime,
        dataKeys: ["text_length"],
        validationIssues: 0
      });

      // Step 2: Detect handwriting
      if (onProgress) {
        onProgress({
          type: "step",
          step: "Detecting Handwriting",
          stepNumber: 2,
          totalSteps: 4,
          status: "processing"
        });
      }

      const handwritingResult = await this.handwritingDetector.execute({
        filePath: pdfPath,
        onProgress
      });

      const hasHandwriting = handwritingResult.data?.has_handwriting || false;
      const handwritingPercentage = handwritingResult.data?.handwriting_percentage || 0;

      steps.push({
        success: true,
        step: "handwriting_detection",
        tokens: handwritingResult.usage?.totalTokens || 0,
        latency: handwritingResult.data?.meta?.latency_ms || 0,
        dataKeys: ["has_handwriting", "handwriting_percentage"],
        validationIssues: 0
      });

      // Step 3: Extract with Qwen 30B
      if (onProgress) {
        onProgress({
          type: "step",
          step: "Extracting with Qwen 30B",
          stepNumber: 3,
          totalSteps: 4,
          status: "processing"
        });
      }

      // Use Qwen 30B for all prescription extraction
      const qwenConfig = {
        qwenBaseUrl: this.qwenUrl,
        qwenModel: this.qwenModel,
        timeout: 180000 // 3 minutes
      };

      const extractor = new PrescriptionExtractorSkill(qwenConfig);
      const extractionResult = await extractor.execute({
        filePath: pdfPath,
        pdfText,
        onProgress
      });

      if (!extractionResult.success) {
        throw new Error(extractionResult.error);
      }

      steps.push({
        success: true,
        step: "prescription_extraction",
        tokens: extractionResult.usage?.totalTokens || 0,
        latency: extractionResult.data?.meta?.latency_ms || 0,
        dataKeys: ["patient", "doctor", "medications", "diagnosis"],
        validationIssues: 0
      });

      // Step 4: Transform to dashboard format
      if (onProgress) {
        onProgress({
          type: "step",
          step: "Formatting for Dashboard",
          stepNumber: 4,
          totalSteps: 4,
          status: "processing"
        });
      }

      const transformedData = this.transformToDashboardFormat(
        extractionResult.data,
        {
          pdfName,
          model: this.qwenModel,
          hasHandwriting,
          handwritingPercentage
        }
      );

      steps.push({
        success: true,
        step: "dashboard_transform",
        tokens: 0,
        latency: 0,
        dataKeys: ["dashboard_cards", "extracted_data"],
        validationIssues: 0
      });

      const endTime = Date.now();
      const totalTokens = steps.reduce((sum, step) => sum + (step.tokens || 0), 0);

      return {
        success: true,
        agent: this.name,
        data: {
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
          ...transformedData
        },
        latency: endTime - startTime,
        tokensUsed: totalTokens,
        steps
      };

    } catch (error) {
      return {
        success: false,
        agent: this.name,
        error: error.message,
        latency: Date.now() - startTime,
        tokensUsed: 0,
        steps
      };
    }
  }

  /**
   * Transform prescription extraction result to dashboard format
   * This ensures compatibility with the existing UI
   */
  transformToDashboardFormat(extractionData, metadata) {
    const { pdfName, model, hasHandwriting, handwritingPercentage } = metadata;

    // Build patient info from prescription data
    const patient = extractionData.patient || {};
    const extractedPatient = {
      name: patient.name || null,
      age: patient.age ? parseInt(patient.age) || 0 : 0,
      gender: patient.gender || null,
      mrn: patient.id || null,
      admission_date: patient.date || null,
      discharge_date: null, // Prescriptions don't typically have discharge
      los_days: 0
    };

    // Build diagnosis from prescription
    const diagnosis = extractionData.diagnosis || {};
    const extractedDiagnosis = {
      principal: diagnosis.primary || "Prescription Document",
      icd_code: null,
      secondary: [],
      comorbidities: []
    };

    // Build medications list
    const medications = extractionData.medications || [];
    const extractedMedications = medications.map(med => ({
      name: med.name || "",
      dose: med.dosage || med.dose || "",
      frequency: med.frequency || "",
      route: med.route || ""
    }));

    // Build allergies from prescription
    const allergies = [];
    if (extractionData.notes?.warnings) {
      allergies.push(...extractionData.notes.warnings.filter(w =>
        w.toLowerCase().includes("allergy") || w.toLowerCase().includes("allerg")
      ));
    }

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
        principal_diagnosis: diagnosis.primary || "Prescription",
        icd_code: "",
        secondary_count: 0,
        secondary_diagnoses: [],
        procedures_count: 0
      },
      medications_card: {
        active_count: medications.length,
        allergy_count: allergies.length,
        allergies: allergies,
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
        current_approach: `Prescription extracted with ${hasHandwriting ? "Qwen 30B" : "Qwen 8B"} model`,
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
        instruction_count: extractionData.notes?.follow_up ? 1 : 0,
        red_flags: extractionData.notes?.warnings?.length || 0
      },
      follow_up_card: {
        next_appointment: extractionData.notes?.follow_up || "",
        appointment_count: extractionData.notes?.follow_up ? 1 : 0
      }
    };

    // Build sample patient data
    const samplePatientData = {
      name: patient.name || "Patient from Prescription",
      age: patient.age ? parseInt(patient.age) || 0 : 0,
      mrn: patient.id || "",
      admission_date: patient.date || new Date().toISOString().split('T')[0],
      discharge_date: null,
      los_days: 0,
      summary: `Prescription document processed with Qwen 30B. ${medications.length} medications extracted.`
    };

    // Build presentation layer
    const presentation = {
      summary_cards: {
        medications: {
          section: "medications",
          title: "Medications Prescribed",
          headline_metric: String(medications.length),
          secondary_line: medications.length === 1 ? "medication" : "medications",
          supporting_points: extractedMedications.slice(0, 2).map(m => m.name),
          status: "normal",
          provenance_status: hasHandwriting ? "source_backed" : "insufficient_evidence"
        },
        diagnosis: {
          section: "diagnosis",
          title: "Prescription Purpose",
          headline_metric: diagnosis.primary || "Not specified",
          secondary_line: diagnosis.symptoms?.length ? `${diagnosis.symptoms.length} symptoms noted` : "",
          supporting_points: diagnosis.symptoms?.slice(0, 2) || [],
          status: "neutral",
          provenance_status: "insufficient_evidence"
        },
        care_gaps: {
          section: "pending",
          title: "Prescription Notes",
          headline_metric: String(extractionData.notes?.warnings?.length || 0),
          secondary_line: "warnings/special notes",
          supporting_points: extractionData.notes?.warnings?.slice(0, 2) || [],
          status: extractionData.notes?.warnings?.length > 0 ? "warning" : "normal",
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
        timestamp: patient.date || new Date().toISOString(),
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
        allergies: allergies,
        treatment: {
          current_approach: `Prescription extracted using ${hasHandwriting ? "Qwen 30B" : "Qwen 8B"} model`,
          management_items: extractedMedications.map(m => `${m.name} ${m.dose}`.trim())
        },
        clinical_notes: [{
          type: "Prescription",
          author: extractionData.doctor?.name || "Unknown",
          date: patient.date || new Date().toISOString(),
          summary: `Prescription with ${medications.length} medications. Model: ${model}. Handwriting detected: ${hasHandwriting} (${handwritingPercentage}%).`,
          source_excerpt: []
        }]
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
    return {
      name: this.name,
      version: this.version,
      type: this.type,
      config: {
        qwenModel: this.qwenModel,
        qwenUrl: this.qwenUrl
      }
    };
  }
}

module.exports = PrescriptionExtractorAgent;
