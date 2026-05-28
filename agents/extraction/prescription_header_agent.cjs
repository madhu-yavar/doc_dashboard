/**
 * Prescription Header Extraction Agent (Stage 1)
 * Extracts all printed/structured text content from prescription documents
 * Part of two-stage prescription extraction pipeline
 *
 * Stage 1 Output (PHI data):
 * - Patient demographics
 * - Hospital/clinic information
 * - Doctor information
 * - Visit metadata
 * - Document structure analysis
 *
 * This data is saved before PHI masking and used for database storage.
 */

const PDFReaderTool = require("../../tools/pdf/pdf_reader.tool.cjs");

// Stage 1 Skills
const DocumentStructureAnalyzerSkill = require("../../skills/extraction/stage1/document_structure_analyzer.skill.cjs");
const HospitalInfoExtractorSkill = require("../../skills/extraction/stage1/hospital_info_extractor.skill.cjs");
const VisitMetadataExtractorSkill = require("../../skills/extraction/stage1/visit_metadata_extractor.skill.cjs");

// Reuse existing skills for patient and doctor
const PrescriptionPatientExtractorSkill = require("../../skills/extraction/prescription_patient_extractor.skill.cjs");
const PrescriptionDoctorExtractorSkill = require("../../skills/extraction/prescription_doctor_extractor.skill.cjs");

// Handwriting detection
const GemmaHandwritingDetectorSkill = require("../../skills/detection/gemma_handwriting_detector.skill.cjs");

class PrescriptionHeaderAgent {
  constructor(config = {}) {
    this.name = "Prescription Header Extractor (Stage 1)";
    this.version = "1.0.0";
    this.type = "stage1_extraction";

    // Initialize tools
    this.pdfReader = new PDFReaderTool(config);

    // Gemma configuration
    this.gemmaConfig = {
      gemmaBaseUrl: config.gemmaBaseUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions",
      gemmaModel: config.gemmaModel || "google/gemma-4-26B-A4B-it",
      timeout: config.timeout || 120000,
      handwritingThreshold: config.handwritingThreshold || 15
    };

    // Initialize Stage 1 skills
    this.documentStructureSkill = new DocumentStructureAnalyzerSkill(this.gemmaConfig);
    this.hospitalInfoSkill = new HospitalInfoExtractorSkill(this.gemmaConfig);
    this.visitMetadataSkill = new VisitMetadataExtractorSkill(this.gemmaConfig);
    this.patientExtractorSkill = new PrescriptionPatientExtractorSkill(this.gemmaConfig);
    this.doctorExtractorSkill = new PrescriptionDoctorExtractorSkill(this.gemmaConfig);
    this.handwritingDetectorSkill = new GemmaHandwritingDetectorSkill(this.gemmaConfig);

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

  /**
   * Process prescription document for Stage 1 extraction
   * @param {string} pdfPath - Path to PDF file
   * @param {object} options - Processing options
   * @returns {Promise<object>}
   */
  async process(pdfPath, options = {}) {
    const startTime = Date.now();
    const pdfName = options.pdfName || pdfPath.split("/").pop();
    const onProgress = options.onProgress || null;

    try {
      console.log(`\n📋 Stage 1: Processing prescription headers: ${pdfName}`);

      if (onProgress) {
        onProgress({ type: 'start', stage: 'stage1', pdfName, totalSteps: 7 });
      }

      // Step 1: Read PDF
      const pdfResult = await this.pdfReader.execute(pdfPath, 50000);
      if (!pdfResult.success) {
        throw new Error(`Failed to read PDF: ${pdfResult.error}`);
      }

      const pdfText = pdfResult.text;
      const images = pdfResult.images || [];
      console.log(`   📖 PDF read: ${pdfText.length} chars, ${pdfResult.pages} pages`);

      if (onProgress) {
        onProgress({ type: 'step', step: 'pdf_read', stepNumber: 1, totalSteps: 7, status: 'complete' });
      }

      // Use first page image for vision-based extraction
      const firstPageImage = images[0] || pdfPath;

      // Execute all Stage 1 extractions in parallel where possible
      const results = await this.executeStage1Extractions({
        filePath: firstPageImage,
        pdfText,
        images,
        onProgress
      });
      const usage = this.summarizeUsage(results);

      // Compile Stage 1 data
      const stage1Data = this.compileStage1Data(results);

      // Check if Stage 3 (Gemini) is needed
      const needsStage3 = this.handwritingDetectorSkill.shouldTriggerStage3(
        results.handwritingDetection?.data
      );

      const endTime = Date.now();
      const latency = endTime - startTime;

      console.log(`   ✅ Stage 1 complete in ${latency}ms`);
      console.log(`   ${needsStage3 ? '📝 Handwriting detected - Stage 3 needed' : '✓ No significant handwriting - Stage 3 optional'}`);

      if (onProgress) {
        onProgress({
          type: 'stage_complete',
          stage: 'stage1',
          status: 'complete',
          needsStage3,
          handwriting: results.handwritingDetection?.data,
          latency
        });
      }

      return {
        success: true,
        stage: "stage1_header_extraction",
        data: stage1Data,
        usage,
        metadata: {
          stage: "stage1",
          needs_stage3: needsStage3,
          handwriting_detection: results.handwritingDetection?.data,
          processing_time: latency,
          extracted_at: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error(`   ❌ Stage 1 failed: ${error.message}`);

      if (onProgress) {
        onProgress({
          type: 'error',
          stage: 'stage1',
          error: error.message
        });
      }

      return {
        success: false,
        stage: "stage1_header_extraction",
        error: error.message,
        data: null
      };
    }
  }

  /**
   * Execute all Stage 1 extraction skills
   */
  async executeStage1Extractions(context) {
    const { filePath, pdfText, images, onProgress } = context;

    // Step 2: Handwriting Detection (do first to decide pipeline)
    let stepNumber = 2;
    console.log(`   🔄 Step 1.${stepNumber}: Handwriting Detection...`);
    const handwritingDetection = await this.handwritingDetectorSkill.execute({
      pdfPath: filePath,
      images,
      pdfText
    });
    if (handwritingDetection.success) {
      const hwPercent = handwritingDetection.data?.handwriting_percentage || 0;
      console.log(`      ✅ Complete: ${hwPercent}% handwriting detected`);
    } else {
      console.log(`      ⚠️ Failed: ${handwritingDetection.error}`);
    }

    if (onProgress) {
      onProgress({
        type: 'step',
        step: 'handwriting_detection',
        stepNumber,
        totalSteps: 7,
        status: handwritingDetection.success ? 'complete' : 'failed',
        data: {
          ...handwritingDetection.data,
          tokens: handwritingDetection.usage?.totalTokens || 0
        }
      });
    }
    stepNumber++;

    // Steps 3-7: Run remaining extractions
    console.log(`   🔄 Step 1.${stepNumber}-1.${stepNumber + 4}: Parallel extraction (Document Structure, Hospital, Visit, Patient, Doctor)...`);
    const extractStart = Date.now();
    const [
      documentStructure,
      hospitalInfo,
      visitMetadata,
      patientInfo,
      doctorInfo
    ] = await Promise.all([
      this.documentStructureSkill.execute({ filePath, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) }),
      this.hospitalInfoSkill.execute({ filePath, pdfText, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) }),
      this.visitMetadataSkill.execute({ filePath, pdfText, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) }),
      this.patientExtractorSkill.execute({ filePath, pdfText, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) }),
      this.doctorExtractorSkill.execute({ filePath, pdfText, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) })
    ]);
    const extractTime = Date.now() - extractStart;
    console.log(`      ✅ All 5 extractions complete (${extractTime}ms)`);
    console.log(`         ├─ Document Structure: ${documentStructure.success ? '✓' : '✗'}`);
    console.log(`         ├─ Hospital Info: ${hospitalInfo.success ? '✓' : '✗'}`);
    console.log(`         ├─ Visit Metadata: ${visitMetadata.success ? '✓' : '✗'}`);
    console.log(`         ├─ Patient Info: ${patientInfo.success ? '✓' : '✗'}`);
    console.log(`         └─ Doctor Info: ${doctorInfo.success ? '✓' : '✗'}`);

    return {
      handwritingDetection,
      documentStructure,
      hospitalInfo,
      visitMetadata,
      patientInfo,
      doctorInfo
    };
  }

  /**
   * Compile Stage 1 data from all extraction results
   * Returns separated PHI and Clinical data structures
   */
  compileStage1Data(results) {
    // Extract patient info
    const patient = results.patientInfo?.data?.patient || {};
    const hospital = results.hospitalInfo?.data?.hospital || {};
    const doctor = results.doctorInfo?.data?.doctor || {};
    const visit = results.visitMetadata?.data?.visit || {};
    const documentStructure = results.documentStructure?.data?.document_structure || {};

    // PHI: Fields that directly identify the patient (to be masked before Gemini)
    const phi = {
      // Direct identifiers
      patient_name: patient.name || null,
      // hospital_no should only contain true MRN/Hospital Number, NOT OPD/Episode numbers
      hospital_no: patient.hospital_no || null,
      mob_no: patient.mobile || patient.phone || patient.contact || null,
      email: patient.email || null,
      kmc_reg_no: patient.kmc_reg_no || patient.registration_number || null,
      // Episode number from visit metadata first, fallback to patient extraction
      episode_no: visit.episode_no || visit.episode_number || patient.episode_number || null,

      // OPD/IPD numbers are separate identifiers
      opd_number: patient.opd_number || visit.opd_number || null,
      ipd_number: patient.ip_no || patient.ip_number || visit.ipd_number || null,

      // Additional identifiers found in hospital/visit data
      registration_number: hospital.registration_number || patient.registration_number || null,

      // Date of visit (specific enough to be PHI when combined with other fields)
      visit_date: visit.date || visit.visit_date || null,

      // Hospital name (context for masking)
      hospital_name: hospital.name || null,

      // Department (kept for context but tracked)
      department: visit.department || hospital.department || null
    };

    // Clinical: Non-identifying medical information (NOT masked)
    const clinical = {
      // Basic demographics (less identifying)
      age_sex: `${patient.age || ''} / ${patient.gender || ''}`.trim() || null,
      age: patient.age || null,
      gender: patient.gender || null,

      // Medical context (needed for Gemini)
      consultant_name: doctor.name || null,
      department: visit.department || hospital.department || null,

      // Diagnosis (printed)
      diagnosis: documentStructure.diagnosis || patient.diagnosis || null,

      // Vitals (if printed)
      vitals: documentStructure.vitals || patient.vitals || null,

      // Printed medications (from header)
      medications: documentStructure.medications || patient.medications || [],

      // Lab tests selected (ticks/circles)
      lab_tests_selected: documentStructure.lab_tests || [],

      // Any other clinical notes
      clinical_notes: documentStructure.notes || []
    };

    const data = {
      // Separated data structures
      phi,
      clinical,

      // Combined for backward compatibility
      patient,
      hospital,
      doctor,
      visit,
      document_structure: documentStructure,

      // Handwriting Detection
      handwriting_detection: results.handwritingDetection?.data || {},

      // All PHI fields that should be masked (for reference)
      phi_fields_to_mask: [
        'patient_name',
        'hospital_no',
        'mob_no',
        'email',
        'kmc_reg_no',
        'episode_no',
        'opd_number',
        'ipd_number',
        'registration_number',
        'visit_date',
        'hospital_name',
        'consultant_name' // Mask doctor name too per your request
      ].filter(field => phi[field] || (field === 'consultant_name' && clinical.consultant_name))
    };

    return data;
  }

  summarizeUsage(results) {
    return Object.values(results).reduce((acc, result) => {
      const usage = result?.usage || {};
      acc.promptTokens += usage.promptTokens || 0;
      acc.completionTokens += usage.completionTokens || 0;
      acc.totalTokens += usage.totalTokens || 0;
      return acc;
    }, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      name: this.name,
      version: this.version,
      type: this.type,
      stage: "stage1",
      config: {
        handwritingThreshold: this.gemmaConfig.handwritingThreshold,
        timeout: this.gemmaConfig.timeout
      }
    };
  }
}

module.exports = PrescriptionHeaderAgent;
