/**
 * Prescription Two-Stage Agent
 * Orchestrates the complete two-stage prescription extraction pipeline
 * Stage 1: Gemma header extraction (PHI data)
 * Stage 2: PHI masking (black out sensitive regions)
 * Stage 3: Gemini handwriting extraction (clinical data) - optional, requires API key
 * Stage 4: Data integration and dashboard formatting
 *
 * This is the main entry point for prescription processing in the Document Router.
 */

const PrescriptionHeaderAgent = require("./extraction/prescription_header_agent.cjs");
const HandwritingExtractionAgent = require("./extraction/handwriting_extraction_agent.cjs");
const DataIntegrationAgent = require("./extraction/data_integration_agent.cjs");
const DashboardMapperSkill = require("../skills/clinical/dashboard_mapper.skill.cjs");

// NEW: Alert Agents
const PharmacyAlertAgent = require("./pharmacy/pharmacy_alert_agent.cjs");
const DepartmentAlertAgent = require("./departments/department_alert_agent.cjs");

const PDFReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");
const PhiMaskerTool = require("../tools/image/phi_masker.tool.cjs");

// For saving masked images for verification
const fs = require("fs");
const path = require("path");

class PrescriptionTwoStageAgent {
  constructor(config = {}) {
    this.name = "Prescription Two-Stage Extractor";
    this.version = "2.1.0"; // Bumped for policy-based Stage 3
    this.type = "two_stage_prescription";

    // Gemma configuration (Stage 1)
    this.gemmaConfig = {
      gemmaBaseUrl: config.gemma?.baseUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions",
      gemmaModel: config.gemma?.model || process.env.GEMMA_MODEL || "google/gemma-4-31B-it",
      timeout: config.gemma?.timeout || 120000,
      handwritingThreshold: config.handwritingThreshold || 15
    };

    // Gemini configuration (Stage 3)
    this.geminiConfig = {
      geminiBaseUrl: config.gemini?.baseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models",
      geminiModel: config.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash",
      timeout: config.timeout || 180000
    };

    // Stage 3 Policy: "always" | "detected" | "never"
    // For prescriptions: always use Gemini after masking (bypass unstable handwriting detector)
    this.stage3Policy = config.stage3Policy || "always";

    // Masking configuration
    this.maskingConfig = {
      enabled: config.enableMasking ?? true,
      keepHospitalName: config.keepHospitalName ?? false,
      saveMaskedImages: true,  // Always save masked images for verification
      maskedImagesDir:
        config.maskedImagesDir ||
        process.env.MASKED_IMAGES_DIR ||
        path.join(__dirname, "..", "server", "storage", "masked_images")
    };

    // Initialize agents
    this.stage1Agent = new PrescriptionHeaderAgent(this.gemmaConfig);
    this.stage3Agent = new HandwritingExtractionAgent(this.geminiConfig);
    this.stage4Agent = new DataIntegrationAgent({});
    this.dashboardMapper = new DashboardMapperSkill();
    this.pharmacyAlertAgent = new PharmacyAlertAgent();
    this.departmentAlertAgent = new DepartmentAlertAgent();

    // Initialize PHI masker
    this.phiMasker = new PhiMaskerTool({
      gemmaUrl: this.gemmaConfig.gemmaBaseUrl,
      gemmaModel: this.gemmaConfig.gemmaModel,
      tempDir: path.join(this.maskingConfig.maskedImagesDir, "temp")
    });

    this.pdfReader = new PDFReaderTool(config);

    this.config = {
      maxRetries: 2,
      requireAllSteps: false,
      logSteps: true,
      ...config
    };

    // Ensure masked images directory exists
    if (this.maskingConfig.saveMaskedImages) {
      fs.mkdirSync(this.maskingConfig.maskedImagesDir, { recursive: true });
    }
  }

  /**
   * Process prescription document through two-stage pipeline
   * @param {string} pdfPath - Path to PDF file
   * @param {object} options - Processing options
   * @param {string} options.geminiApiKey - User's Gemini API key (optional, for Stage 3)
   * @param {boolean} options.skipStage3 - Skip Stage 3 even if handwriting detected
   * @param {boolean} options.skipStage1 - Skip Stage 1 and use provided stage1Data (for retry scenarios)
   * @param {object} options.stage1Data - Pre-computed Stage 1 data (required when skipStage1=true)
   * @param {Function} options.onProgress - Progress callback
   * @returns {Promise<object>}
   */
  async process(pdfPath, options = {}) {
    const startTime = Date.now();
    const pdfName = options.pdfName || pdfPath.split("/").pop();
    const { geminiApiKey, skipStage3, skipStage1, stage1Data: providedStage1Data, forceHandwritingPercentage, onProgress } = options;

    // ============================================
    // PIPELINE START BANNER
    // ============================================
    console.log(`\n${'='.repeat(65)}`);
    console.log(`📋 PRESCRIPTION EXTRACTION PIPELINE v${this.version}`);
    console.log(`📄 Document: ${pdfName}`);
    console.log(`🔑 Gemini API Key: ${geminiApiKey ? '✓ Provided' : '✗ Not provided'}`);
    console.log(`🎯 Stage 3 Policy: ${this.stage3Policy.toUpperCase()}`);
    console.log(`${'='.repeat(65)}\n`);

    try {
      let stage1Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let stage1Latency = 0;
      let stage2Tokens = 0;
      let stage3Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let stage3Latency = 0;
      let stage4Latency = 0;
      let dashboardLatency = 0;
      let reviewPages = [];

      if (onProgress) {
        onProgress({
          type: 'start',
          stage: 'start',
          pipeline: 'two_stage_prescription',
          documentName: pdfName,
          hasGeminiKey: !!geminiApiKey,
          totalSteps: skipStage1 ? 3 : 4  // Stage 1, 2, 3, 4 (skip Stage 1 = 3 steps)
        });
      }

      // ============================================
      // STAGE 1: HEADER EXTRACTION (GEMMA)
      // ============================================
      console.log(`┌──────────────────────────────────────────────────────────┐`);
      console.log(`│ 🏥 STAGE 1: HEADER EXTRACTION (Gemma 4-31B)                │`);
      console.log(`└──────────────────────────────────────────────────────────┘`);

      let stage1Data;
      if (skipStage1 && providedStage1Data) {
        console.log(`   ♻️  Skipping Stage 1 - using cached data`);
        stage1Data = providedStage1Data;
      } else {
        console.log(`   🔄 Starting Gemma extraction...`);
        console.log(`      ├─ Reading PDF: ${pdfPath}`);
        console.log(`      ├─ Model: ${this.gemmaConfig.gemmaModel}`);
        console.log(`      └─ Timeout: ${this.gemmaConfig.timeout}ms`);

        const stage1StartTime = Date.now();
        const stage1Result = await this.stage1Agent.process(pdfPath, {
          pdfName,
          onProgress: this.wrapProgress(onProgress, 'stage1')
        });
        stage1Latency = Date.now() - stage1StartTime;
        console.log(`      └─ API call completed in ${stage1Latency}ms`);

        if (!stage1Result.success) {
          throw new Error(`Stage 1 failed: ${stage1Result.error}`);
        }

        stage1Data = stage1Result.data;
        stage1Usage = stage1Result.usage || stage1Usage;
        console.log(`   ✅ Stage 1 complete (${stage1Latency}ms)`);
      }

      // Display Stage 1 results summary
      console.log(`   ┌─ Extracted Data ──────────────────────────────────┐`);
      if (stage1Data.patient?.name) {
        console.log(`   │ 👤 Patient: ${stage1Data.patient.name} (MRN: ${stage1Data.patient.mrn || 'N/A'})`);
      }
      if (stage1Data.doctor?.name) {
        console.log(`   │ 👨‍⚕️  Doctor: ${stage1Data.doctor.name}`);
      }
      if (stage1Data.diagnosis?.principal) {
        const diag = stage1Data.diagnosis.principal.substring(0, 45);
        console.log(`   │ 🩺 Diagnosis: ${diag}...`);
      }
      const medCount = stage1Data.medications?.length || 0;
      console.log(`   │ 💊 Medications: ${medCount} found`);
      console.log(`   └───────────────────────────────────────────────┘`);

      // When skipStage1 is true, check if we have a forced handwriting percentage
      // The cached stage1Data.handwriting_detection might have fallback values (0%)
      const handwritingPercentage = forceHandwritingPercentage !== undefined
        ? forceHandwritingPercentage
        : (stage1Data.handwriting_detection?.handwriting_percentage || 0);

      console.log(`   📊 Handwriting Detected: ${handwritingPercentage}%`);

      // ============================================
      // STAGE 3 POLICY DECISION
      // ============================================
      console.log(`\n┌──────────────────────────────────────────────────────────┐`);
      console.log(`│ 🎯 STAGE 3 POLICY DECISION                                 │`);
      console.log(`└──────────────────────────────────────────────────────────┘`);

      let stage3TriggerReason = null;
      let needsStage3 = false;
      let handwritingDetectionUsedForGating = false;

      if (skipStage3) {
        // Explicit skip takes precedence
        needsStage3 = false;
        stage3TriggerReason = "explicitly_skipped";
        console.log(`   🚫 Stage 3: Explicitly skipped via flag`);
      } else if (stage1Data.metadata?.stage3_complete) {
        // Already completed
        needsStage3 = false;
        stage3TriggerReason = "already_complete";
        console.log(`   ✅ Stage 3: Already completed in previous run`);
      } else if (this.stage3Policy === "always") {
        // Policy: Always run Stage 3 for prescriptions (bypass handwriting detector)
        needsStage3 = true;
        stage3TriggerReason = "prescription_fallback";
        console.log(`   📋 Policy: ALWAYS`);
        console.log(`   📝 Trigger: prescription_fallback (bypasses handwriting detector)`);
      } else if (this.stage3Policy === "detected") {
        // Policy: Use handwriting detector
        const threshold = this.gemmaConfig.handwritingThreshold;
        needsStage3 = handwritingPercentage >= threshold;
        stage3TriggerReason = needsStage3 ? "handwriting_detected" : "no_handwriting";
        handwritingDetectionUsedForGating = true;
        console.log(`   📋 Policy: DETECTED (threshold: ${threshold}%)`);
        console.log(`   📊 Detected: ${handwritingPercentage}% → ${needsStage3 ? 'REQUIRED' : 'NOT REQUIRED'}`);
      } else {
        // Policy: "never"
        needsStage3 = false;
        stage3TriggerReason = "policy_never";
        console.log(`   📋 Policy: NEVER`);
      }

      console.log(`   ┌─ Decision ─────────────────────────────────────────┐`);
      console.log(`   │ Stage 3 Required: ${needsStage3 ? 'YES ✓' : 'NO ✗'}`);
      console.log(`   │ Reason: ${stage3TriggerReason}`);
      console.log(`   └───────────────────────────────────────────────┘`);

      // Initialize Stage 3 variables
      let stage3Data = null;
      let stage3SkippedReason = null;
      let maskingResult = null;
      let originalImage = null;  // Store for Stage 3 fallback
      let imagesForStage3 = null;

      // ============================================
      // STAGE 2: PHI Masking (before Stage 3)
      // Runs when Stage 3 is needed (handwriting detected)
      // Generates masked image for demo/verification purposes
      // ============================================
      if (needsStage3 && this.maskingConfig.enabled) {
        console.log(`\n┌──────────────────────────────────────────────────────────┐`);
        console.log(`│ 🎭 STAGE 2: PHI MASKING                                     │`);
        console.log(`└──────────────────────────────────────────────────────────┘`);
        console.log(`   📋 Masking Configuration:`);
        console.log(`      ├─ Keep Hospital Name: ${this.maskingConfig.keepHospitalName ? 'YES' : 'NO'}`);
        console.log(`      ├─ Save Masked Images: ${this.maskingConfig.saveMaskedImages ? 'YES' : 'NO'}`);
        console.log(`      └─ Output Directory: ${this.maskingConfig.maskedImagesDir}`);
        console.log(`   🔄 Step 2.1: Converting PDF to base64 image...`);
        console.log(`      └─ Input: ${pdfPath}`);

        // Convert PDF first page to base64 image for masking
        originalImage = await this.convertPdfToBase64(pdfPath);
        console.log(`      ✅ Conversion complete. Base64 length: ${originalImage?.length || 0} chars`);

        if (originalImage) {
          console.log(`   🔄 Step 2.2: Detecting and masking PHI regions...`);
          console.log(`      ├─ Model: ${this.gemmaConfig.gemmaModel}`);
          console.log(`      └─ Keep Hospital: ${this.maskingConfig.keepHospitalName ? 'YES' : 'NO'}`);
          // Use PhiMaskerTool to detect and mask PHI
          const masking = await this.phiMasker.execute(originalImage, {
            pageNum: 1,
            keepHospital: this.maskingConfig.keepHospitalName,
            documentType: "prescription"
          });
          console.log(`      ✅ PHI detection completed`);

          if (masking.success) {
            maskingResult = {
              masked_count: masking.masked_count || 0,
              masked_types: masking.masked_types || [],
              masked_fields: masking.masked_fields || [],
              phi_regions: masking.phiData?.phi_regions || [],
              maskedImage: masking.maskedImage, // Store masked image for Stage 3
              duration: masking.duration,
              masking_strategy: masking.masking_strategy || "gemma_fallback",
              template_detected: masking.template_detected ?? false,
              template_confidence: masking.template_confidence ?? 0,
              fallback_reason: masking.fallback_reason || null,
              anchor_lines: masking.anchor_lines || null,
              anchor_boxes: masking.anchor_boxes || null
            };
            stage2Tokens = masking.tokens || 0;

            console.log(`   ┌─ PHI Detection Results ─────────────────────────────┐`);
            console.log(`   │ Regions Detected: ${maskingResult.masked_count}`);
            console.log(`   │ Types: ${(maskingResult.masked_types || []).join(", ") || "None"}`);
            console.log(`   │ Strategy: ${maskingResult.masking_strategy}`);
            console.log(`   │ Template Detected: ${maskingResult.template_detected ? "YES" : "NO"}`);
            console.log(`   │ Masked Image Size: ${maskingResult.maskedImage?.length || 0} chars`);
            console.log(`   │ Duration: ${maskingResult.duration || "N/A"}ms`);
            console.log(`   └────────────────────────────────────────────────────┘`);

            // Save masked image for verification (if enabled)
            if (this.maskingConfig.saveMaskedImages && masking.maskedImage) {
              console.log(`   🔄 Step 2.3: Saving masked image for verification...`);
              const maskedFilename = `masked_${pdfName}_${Date.now()}.png`;
              const maskedPath = path.join(this.maskingConfig.maskedImagesDir, maskedFilename);
              const buffer = Buffer.from(masking.maskedImage, 'base64');
              fs.writeFileSync(maskedPath, buffer);
              console.log(`      ✅ Saved: ${maskedFilename}`);
              maskingResult.masked_image_path = maskedFilename;
            } else {
              console.log(`   ⏭️  Skipping image save (disabled)`);
            }
            console.log(`   ✅ Stage 2 Complete - PHI successfully masked`);
          } else {
            console.log(`   ❌ Stage 2 Failed: ${masking.error}`);
            maskingResult = { error: masking.error };
          }
        }
      } else {
        console.log(`\n⏭️  Stage 2: Skipped (Stage 3 not required or masking disabled)`);
      }

      // ============================================
      // STAGE 3: Handwriting Extraction (Gemini)
      // PRIVACY REQUIREMENT: Stage 3 ONLY runs with successfully masked images
      // If masking fails, Stage 3 is BLOCKED - no fallback to original image
      // ============================================

      console.log(`\n┌──────────────────────────────────────────────────────────┐`);
      console.log(`│ 📝 STAGE 3: HANDWRITING EXTRACTION (Gemini)                │`);
      console.log(`└──────────────────────────────────────────────────────────┘`);

      if (needsStage3) {
        // PRIVACY CHECK: Must have a successfully masked image
        if (!maskingResult?.maskedImage) {
          // Hard block: Do NOT proceed without masked image
          const maskingError = maskingResult?.error || "Unknown masking error";
          stage3SkippedReason = `PHI masking required but failed: ${maskingError}. Stage 3 blocked for privacy protection.`;
          console.log(`   ┌─ PRIVACY BLOCK ─────────────────────────────────────┐`);
          console.log(`   │ ❌ Stage 3 CANNOT proceed without successful PHI masking`);
          console.log(`   │ 🚫 Masking error: ${maskingError}`);
          console.log(`   │ 🔒 Original image will NOT be sent to external services`);
          console.log(`   └─────────────────────────────────────────────────────┘`);
        } else {
          console.log(`   🔄 Step 3.1: Converting all pages for Stage 3...`);
          const allPages = await this.convertPdfAllPagesToBase64(pdfPath);

          if (!allPages || allPages.length === 0) {
            stage3SkippedReason = "Failed to convert PDF pages";
            console.log(`   ❌ Stage 3 Preparation Failed: ${stage3SkippedReason}`);
          } else {
            console.log(`   🔄 Step 3.2: Preparing multi-page input...`);
            console.log(`      ├─ Total pages: ${allPages.length}`);
            console.log(`      ├─ Page 1: MASKED (PHI protected)`);
            console.log(`      ├─ Pages 2-${allPages.length}: Original (no PHI expected)`);

            imagesForStage3 = allPages.map((page, index) => {
              if (index === 0) {
                const maskedImage = maskingResult.maskedImage.startsWith('data:')
                  ? maskingResult.maskedImage
                  : `data:image/png;base64,${maskingResult.maskedImage}`;
                return {
                  pageNum: page.pageNum,
                  imageData: maskedImage,
                  isMasked: true
                };
              }

              return {
                pageNum: page.pageNum,
                imageData: page.dataUrl,
                isMasked: false
              };
            });

            if (this.maskingConfig.saveMaskedImages) {
              reviewPages = this.saveStage3ReviewPages(imagesForStage3, pdfName);
            }
          }
        }

        if (geminiApiKey) {
          console.log(`   🔑 API Key: ✓ Provided (${geminiApiKey.substring(0, 10)}...)`);
          if (imagesForStage3 && imagesForStage3.length > 0) {
            console.log(`   🔄 Step 3.3: Calling Gemini API for handwriting extraction...`);
              console.log(`      ├─ Model: ${this.geminiConfig.geminiModel}`);
              console.log(`      ├─ Images: ${imagesForStage3.length} page(s)`);
              console.log(`      └─ Timeout: ${this.geminiConfig.timeout}ms`);

              const stage3StartTime = Date.now();
              const stage3Result = await this.stage3Agent.process(imagesForStage3, {
                apiKey: geminiApiKey,
                documentStructure: stage1Data.document_structure,
                pdfText: stage1Data.pdf_text || stage1Data.rawText || '',
                onProgress: this.wrapProgress(onProgress, 'stage3')
              });
              stage3Latency = Date.now() - stage3StartTime;
              console.log(`      └─ API call completed in ${stage3Latency}ms`);

              if (stage3Result.success) {
                stage3Data = stage3Result.data;
                stage3Usage = stage3Result.usage || stage3Usage;
                console.log(`   ┌─ Stage 3 Results ───────────────────────────────────┐`);
                console.log(`   │ ✅ Extraction successful`);
                if (stage3Data.medications?.length) {
                  console.log(`   │ 💊 Medications: ${stage3Data.medications.length}`);
                }
                if (stage3Data.vitals?.blood_pressure?.systolic) {
                  console.log(`   │ 🩺 BP: ${stage3Data.vitals.blood_pressure.systolic}/${stage3Data.vitals.blood_pressure.diastolic || 'N/A'}`);
                }
                if (stage3Data.handwritten_notes?.length) {
                  console.log(`   │ 📝 Handwritten Notes: ${stage3Data.handwritten_notes.length}`);
                }
                console.log(`   └─────────────────────────────────────────────────────┘`);
                console.log(`   ✅ Stage 3 Complete`);
              } else {
                stage3SkippedReason = stage3Result.error;
                console.log(`   ❌ Stage 3 Failed: ${stage3SkippedReason}`);
              }
          } else if (!stage3SkippedReason) {
            stage3SkippedReason = "Stage 3 image bundle unavailable";
            console.log(`   ❌ Stage 3 Failed: ${stage3SkippedReason}`);
          }
        } else {
          stage3SkippedReason = "No Gemini API key provided";
          console.log(`   🔑 API Key: ✗ Not provided`);
          console.log(`   ⏭️  Stage 3 Skipped: ${stage3SkippedReason}`);
        }
      } else {
        stage3SkippedReason = skipStage3 ? "Explicitly skipped" : "No significant handwriting detected";
        console.log(`   ⏭️  Stage 3 Skipped: ${stage3SkippedReason}`);
      }

      // ============================================
      // STAGE 4: Data Integration
      // Merges Stage 1 and Stage 3 data, validates, formats for dashboard
      // ============================================
      console.log(`\n┌──────────────────────────────────────────────────────────┐`);
      console.log(`│ 🔗 STAGE 4: DATA INTEGRATION                               │`);
      console.log(`└──────────────────────────────────────────────────────────┘`);
      console.log(`   🔄 Step 4.1: Merging Stage 1 and Stage 3 data...`);
      console.log(`      ├─ Stage 1 (PHI): ${stage1Data ? '✓ Present' : '✗ Missing'}`);
      console.log(`      └─ Stage 3 (Handwriting): ${stage3Data ? '✓ Present' : '✗ Not available'}`);

      const stage4StartTime = Date.now();
      const stage4Result = await this.stage4Agent.process(stage1Data, stage3Data, {
        onProgress: this.wrapProgress(onProgress, 'stage4')
      });
      stage4Latency = Date.now() - stage4StartTime;
      console.log(`      └─ Merge completed in ${stage4Latency}ms`);

      if (!stage4Result.success) {
        console.log(`   ❌ Stage 4 Failed: ${stage4Result.error}`);
        throw new Error(`Stage 4 failed: ${stage4Result.error}`);
      }

      const mergedData = stage4Result.data.merged;
      const dashboardFormat = stage4Result.data.dashboard_format;
      console.log(`   ✅ Data merged and validated`);

      // ============================================
      // DASHBOARD MAPPING
      // Transform to dashboard cards
      // ============================================
      console.log(`   🔄 Step 4.2: Mapping to dashboard cards...`);
      console.log(`      └─ Transforming data to UI format...`);

      const dashboardStartTime = Date.now();
      const dashboardResult = await this.dashboardMapper.execute({
        agentResult: {
          success: true,
          data: dashboardFormat,
          validation: stage4Result.validation
        }
      });
      dashboardLatency = Date.now() - dashboardStartTime;
      console.log(`      └─ Mapping completed in ${dashboardLatency}ms`);

      if (dashboardResult.success) {
        const cardCount = Object.keys(dashboardResult.data.dashboard_cards || {}).length;
        console.log(`   ┌─ Dashboard Output ────────────────────────────────────┐`);
        console.log(`   │ ✅ Cards generated: ${cardCount}`);
        console.log(`   │ 📊 Sample patient data: ${dashboardResult.data.sample_patient_data ? 'Yes' : 'No'}`);
        const noteCount = dashboardResult.data.presentation?.notes_rail?.length || 0;
        console.log(`   │ 📝 Notes rail items: ${noteCount}`);
        console.log(`   └─────────────────────────────────────────────────────┘`);
      } else {
        console.log(`   ⚠️ Dashboard mapping had issues`);
      }
      console.log(`   ✅ Stage 4 Complete`);

      // ============================================
      // PHARMACY ALERT (Automatic Trigger)
      // Send alerts if medications are prescribed
      // ============================================
      let pharmacyAlertResult = null;
      const medicationsCount = dashboardFormat?.medications?.length || 0;

      if (medicationsCount > 0 && !skipStage3) {
        console.log(`\n┌──────────────────────────────────────────────────────────┐`);
        console.log(`│ 💊 PHARMACY ALERT                                         │`);
        console.log(`└──────────────────────────────────────────────────────────┘`);
        console.log(`   📋 Medications detected: ${medicationsCount}`);
        console.log(`   🔄 Sending alert to pharmacy team...`);

        try {
          pharmacyAlertResult = await this.pharmacyAlertAgent.sendAlert(dashboardFormat, {
            documentId: pdfName,
            manualTrigger: false
          });

          if (pharmacyAlertResult.success) {
            console.log(`   ✅ Pharmacy alert sent successfully`);
          } else if (pharmacyAlertResult.skipped) {
            console.log(`   ⊘ Pharmacy alert skipped: ${pharmacyAlertResult.reason}`);
          } else {
            console.log(`   ⚠️ Pharmacy alert failed: ${pharmacyAlertResult.error || 'Unknown error'}`);
          }
        } catch (alertError) {
          console.log(`   ⚠️ Pharmacy alert error: ${alertError.message}`);
          pharmacyAlertResult = { error: alertError.message, success: false };
        }
      } else {
        console.log(`\n⊘ Pharmacy Alert: Skipped (no medications found)`);
      }

      // ============================================
      // DEPARTMENT ALERTS (Automatic Trigger)
      // Send alerts to Lab, Radiology, Nuclear Medicine, Procedures
      // ============================================
      let departmentAlertResult = null;

      console.log(`\n┌──────────────────────────────────────────────────────────┐`);
      console.log(`│ 🏥 DEPARTMENT ALERTS                                      │`);
      console.log(`└──────────────────────────────────────────────────────────┘`);

      try {
        departmentAlertResult = await this.departmentAlertAgent.sendAlerts(dashboardFormat, {
          documentId: pdfName
        });

        if (departmentAlertResult.success) {
          const deptCount = Object.keys(departmentAlertResult.departments || {}).length;
          console.log(`   ✅ Department alerts sent: ${deptCount} department(s) notified`);
        } else if (departmentAlertResult.skipped) {
          console.log(`   ⊘ Department alerts skipped: ${departmentAlertResult.reason}`);
        } else {
          console.log(`   ⚠️ Department alerts had errors`);
        }
      } catch (alertError) {
        console.log(`   ⚠️ Department alert error: ${alertError.message}`);
        departmentAlertResult = { error: alertError.message, success: false };
      }

      const endTime = Date.now();
      const totalLatency = endTime - startTime;
      const providerTokens = {
        gemma: stage1Usage.totalTokens + stage2Tokens,
        gemini: stage3Usage.totalTokens,
      };
      const tokensUsed = providerTokens.gemma + providerTokens.gemini;
      const steps = [
        {
          success: true,
          step: "stage1_header_extraction",
          tokens: stage1Usage.totalTokens,
          latency: stage1Latency,
          dataKeys: ["patient", "hospital", "doctor", "visit", "document_structure"],
          validationIssues: 0,
          provider: "gemma",
          model: this.gemmaConfig.gemmaModel,
        },
        {
          success: !needsStage3 || Boolean(maskingResult?.maskedImage),
          step: "stage2_phi_masking",
          tokens: stage2Tokens,
          latency: maskingResult?.duration || 0,
          dataKeys: ["masked_count", "masked_types"],
          validationIssues: maskingResult?.error ? 1 : 0,
          provider: "gemma",
          model: this.gemmaConfig.gemmaModel,
        },
        {
          success: Boolean(stage3Data),
          step: "stage3_handwriting_extraction",
          tokens: stage3Usage.totalTokens,
          latency: stage3Latency,
          dataKeys: ["medications", "vitals", "diagnosis", "handwritten_notes"],
          validationIssues: stage3Data || !needsStage3 ? 0 : 1,
          provider: "gemini",
          model: this.geminiConfig.geminiModel,
          skipped: !stage3Data,
          reason: !stage3Data ? stage3SkippedReason : undefined,
        },
        {
          success: true,
          step: "stage4_data_integration",
          tokens: 0,
          latency: stage4Latency + dashboardLatency,
          dataKeys: ["merged", "dashboard_cards", "sample_patient_data", "presentation"],
          validationIssues: stage4Result.validation?.inconsistencies_found?.length || 0,
          provider: "system",
          model: "local",
        },
      ];

      console.log(`\n${'='.repeat(65)}`);
      console.log(`✅ PIPELINE COMPLETE - Total time: ${totalLatency}ms (${(totalLatency/1000).toFixed(2)}s)`);
      console.log(`${'='.repeat(65)}`);

      // Save a summary log file for later review
      try {
        const fs = require('fs');
        const path = require('path');
        const logDir = './server/logs/summaries';
        fs.mkdirSync(logDir, { recursive: true });
        const logFile = path.join(logDir, `pipeline_${pdfName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`);
        fs.writeFileSync(logFile, JSON.stringify({
          timestamp: new Date().toISOString(),
          document: pdfName,
          totalLatency,
          stage1: {
            patient: stage1Data.patient?.name,
            doctor: stage1Data.doctor?.name,
            medications_count: stage1Data.medications?.length || 0
          },
          stage2: {
            masked_count: maskingResult?.masked_count || 0,
            masked_types: maskingResult?.masked_types || []
          },
          stage3: stage3SkippedReason ? {
            skipped: true,
            reason: stage3SkippedReason
          } : {
            skipped: false,
            medications_count: stage3Data?.medications?.length || 0,
            has_vitals: !!stage3Data?.vitals?.has_vitals,
            diagnosis_found: !!stage3Data?.diagnosis?.principal
          }
        }, null, 2));
        console.log(`   📁 Summary saved to: ${logFile}`);
      } catch (logError) {
        console.log(`   ⚠️ Could not save summary log: ${logError.message}`);
      }

      // Build final response
      const response = {
        success: true,
        agent: this.name,
        latency: totalLatency,
        tokensUsed,
        providerTokens,
        steps,
        data: {
          // Stage 1 data (PHI)
          stage1: stage1Data,

          // Stage 3 data (handwriting) - may be null
          stage3: stage3Data,

          // Merged data
          merged: mergedData,

          // Dashboard format
          ...dashboardFormat,

          // Dashboard cards (for UI)
          dashboard_cards: dashboardResult.success ? dashboardResult.data.dashboard_cards : {},
          sample_patient_data: dashboardResult.success ? dashboardResult.data.sample_patient_data : {},
          presentation: dashboardResult.success ? dashboardResult.data.presentation : { summary_cards: {}, notes_rail: [] },
          meta: {
            ...(dashboardFormat.meta || {}),
            agent_version: this.version,
          }
        },
        validation: stage4Result.validation,
        metadata: {
          pipeline: "two_stage_prescription",
          pipeline_version: "2.1.0", // Updated for policy-based Stage 3
          document_type: "prescription",
          stage1_complete: true,
          stage2_masking: maskingResult ? {
            enabled: this.maskingConfig.enabled,
            masked_count: maskingResult.masked_count || 0,
            masked_types: maskingResult.masked_types || [],
            masked_fields: maskingResult.masked_fields || [],
            masked_image_path: maskingResult.masked_image_path || null,
            review_pages: reviewPages,
            success: !maskingResult.error,
            masking_strategy: maskingResult.masking_strategy || null,
            template_detected: maskingResult.template_detected ?? false,
            template_confidence: maskingResult.template_confidence ?? 0,
            fallback_reason: maskingResult.fallback_reason || null,
            anchor_lines: maskingResult.anchor_lines || null,
            anchor_boxes: maskingResult.anchor_boxes || null
          } : { enabled: false, masked_count: 0 },
          // Stage 3 is only complete if it has meaningful data (not just empty arrays/objects)
          stage3_complete: stage3Data && this.hasMeaningfulStage3Data(stage3Data),
          stage3_skipped_reason: stage3SkippedReason,
          stage3_required: needsStage3,
          stage3_used_masked_image: !!maskingResult?.maskedImage,
          // NEW: Policy-based metadata
          stage3_policy: this.stage3Policy,
          stage3_trigger_reason: stage3TriggerReason,
          handwriting_detection_used_for_gating: handwritingDetectionUsedForGating,
          // NEW: Privacy enforcement metadata
          stage3_blocked_for_privacy: needsStage3 && !maskingResult?.maskedImage && !!geminiApiKey,
          stage3_privacy_block_reason: needsStage3 && !maskingResult?.maskedImage && !!geminiApiKey
            ? maskingResult?.error || "PHI masking failed"
            : null,
          // NEW: Pharmacy Alert metadata
          pharmacy_alert: pharmacyAlertResult ? {
            sent: pharmacyAlertResult.sent || false,
            email_sent: pharmacyAlertResult.emailSent || false,
            whatsapp_sent: pharmacyAlertResult.whatsappSent || false,
            skipped: pharmacyAlertResult.skipped || false,
            skip_reason: pharmacyAlertResult.reason || null,
            error: pharmacyAlertResult.error || null,
            medications_count: medicationsCount
          } : {
            sent: false,
            skipped: true,
            skip_reason: medicationsCount === 0 ? 'no_medications' : 'not_triggered',
            medications_count: medicationsCount
          },
          // NEW: Department Alerts metadata
          department_alerts: departmentAlertResult ? {
            sent: departmentAlertResult.sent || false,
            skipped: departmentAlertResult.skipped || false,
            skip_reason: departmentAlertResult.reason || null,
            error: departmentAlertResult.error || null,
            departments: departmentAlertResult.departments || {}
          } : {
            sent: false,
            skipped: true,
            skip_reason: 'no_department_orders',
            departments: {}
          },
          handwriting_percentage: stage1Data.handwriting_detection?.handwriting_percentage || 0,
          processing_time: totalLatency,
          extracted_at: new Date().toISOString()
        },
        agentInfo: {
          name: this.name,
          version: this.version,
          latency: totalLatency,
          stages: [
            { name: "Stage 1: Header Extraction", status: "complete", model: this.gemmaConfig.gemmaModel },
            stage3Data ? { name: "Stage 3: Handwriting Extraction", status: "complete", model: this.geminiConfig.geminiModel }
                      : { name: "Stage 3: Handwriting Extraction", status: "skipped", reason: stage3SkippedReason },
            { name: "Stage 4: Data Integration", status: "complete" }
          ]
        }
      };

      // Add user action prompt if Stage 3 was needed but not completed
      if (needsStage3 && !stage3Data && !skipStage3) {
        response.metadata.user_action_required = true;

        // Different messages based on policy and why Stage 3 failed
        const isPrescriptionFallback = stage3TriggerReason === "prescription_fallback";
        const isQuotaError = stage3SkippedReason?.includes('429') || stage3SkippedReason?.includes('quota');
        const isPrivacyBlock = stage3SkippedReason?.includes('PHI masking required') || stage3SkippedReason?.includes('masking failed');

        if (!geminiApiKey) {
          response.metadata.user_action_prompt = {
            title: isPrescriptionFallback
              ? "Prescription Enhancement Requires Gemini"
              : "Handwriting Extraction Unavailable",
            message: isPrescriptionFallback
              ? "Basic header information was extracted successfully. Prescription enhancement (medications, vitals, clinical notes) requires Gemini extraction after PHI masking. Please provide your Gemini API key to complete the analysis."
              : "Basic header information was extracted successfully. To extract handwritten medications, vitals, and clinical notes, please provide your Gemini API key.",
            show_api_key_input: true,
            retry_allowed: true,
            error_type: "no_api_key",
            policy: this.stage3Policy
          };
          console.log(`   🔔 User action required: Stage 3 needed but no API key provided (policy: ${this.stage3Policy})`);
        } else if (isPrivacyBlock) {
          // Privacy block: masking failed, cannot proceed
          response.metadata.user_action_prompt = {
            title: "PHI Masking Failed - Privacy Protection Active",
            message: `Prescription enhancement cannot proceed because PHI masking failed: ${maskingResult?.error || 'Unknown error'}. For your privacy, documents cannot be sent to external services without successful PHI masking. Please check that the Gemma backend is running for PHI detection.`,
            show_api_key_input: false,
            retry_allowed: true,
            error_type: "privacy_block",
            error_details: stage3SkippedReason,
            policy: this.stage3Policy
          };
          console.log(`   🔒 User action required: Stage 3 blocked for privacy - masking failed`);
        } else {
          // Stage 3 failed despite having API key (e.g., quota exceeded, network error)
          response.metadata.user_action_prompt = {
            title: isQuotaError ? "Gemini API Quota Exceeded" : "Prescription Enhancement Failed",
            message: isQuotaError
              ? `Stage 3 extraction failed due to API quota limits. ${stage3SkippedReason || ''}`
              : `Stage 3 extraction failed: ${stage3SkippedReason || 'Unknown error'}`,
            show_api_key_input: !isQuotaError, // Don't show API key input for quota errors
            retry_allowed: true,
            error_type: isQuotaError ? "quota_exceeded" : "extraction_failed",
            error_details: stage3SkippedReason,
            policy: this.stage3Policy
          };
          console.log(`   🔔 User action required: Stage 3 failed with API key present - ${stage3SkippedReason} (policy: ${this.stage3Policy})`);
        }
      } else {
        console.log(`   ℹ️ User action NOT required - needs_stage3: ${needsStage3}, stage3Data: ${!!stage3Data}, geminiApiKey: ${!!geminiApiKey}`);
      }

      if (onProgress) {
        onProgress({
          type: 'complete',
          pipeline: 'two_stage_prescription',
          status: stage3Data ? 'complete' : 'partial',
          metadata: response.metadata
        });
      }

      return response;

    } catch (error) {
      console.error(`   ❌ Two-Stage Pipeline failed: ${error.message}`);

      if (onProgress) {
        onProgress({
          type: 'error',
          pipeline: 'two_stage_prescription',
          error: error.message
        });
      }

      return {
        success: false,
        error: error.message,
        data: null,
        metadata: {
          pipeline: "two_stage_prescription",
          error: error.message
        }
      };
    }
  }

  /**
   * Wrap progress callback with stage prefix
   */
  wrapProgress(onProgress, stage) {
    if (!onProgress) return null;
    return (event) => onProgress({ ...event, stage });
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      name: this.name,
      version: this.version,
      type: this.type,
      pipeline: "two_stage_prescription",
      stages: {
        stage1: {
          name: "Header Extraction",
          model: this.gemmaConfig.gemmaModel,
          required: true
        },
        stage3: {
          name: "Prescription Enhancement",
          model: this.geminiConfig.geminiModel,
          required: false,
          requires_api_key: true,
          policy: this.stage3Policy,
          description: this.stage3Policy === "always"
            ? "Always runs for prescriptions after PHI masking (bypasses handwriting detector)"
            : `Runs when handwriting >= ${this.gemmaConfig.handwritingThreshold}%`
        },
        stage4: {
          name: "Data Integration",
          required: true
        }
      },
      config: {
        handwritingThreshold: this.gemmaConfig.handwritingThreshold,
        stage3Policy: this.stage3Policy
      }
    };
  }

  /**
   * Convert PDF first page to base64 image
   */
  async convertPdfToBase64(pdfPath) {
    console.log(`      ┌─ PDF to Image Conversion ──────────────────────────────┐`);
    console.log(`      │ 📄 Input: ${pdfPath}`);
    console.log(`      │ 🔧 Tool: pdftoppm (poppler-utils)`);
    console.log(`      │ 📐 Resolution: 250 DPI`);
    console.log(`      │ 📃 Page: 1 (first page only)`);
    console.log(`      └────────────────────────────────────────────────────────┘`);

    const { execSync } = require('child_process');
    const crypto = require('crypto');
    const fs = require('fs');

    const tempDir = '/tmp/prescription_masking_temp';
    await fs.promises.mkdir(tempDir, { recursive: true });
    console.log(`      ✓ Temp dir created: ${tempDir}`);

    const fileId = crypto.randomBytes(8).toString('hex');
    const outputPath = `${tempDir}/${fileId}_page1.png`;
    console.log(`      ✓ Output file: ${outputPath}`);

    try {
      const baseCmd = outputPath.replace('.png', '');
      const cmd = `pdftoppm -png -singlefile -r 250 -f 1 "${pdfPath}" "${baseCmd}"`;
      console.log(`      🔄 Executing pdftoppm...`);

      const conversionStart = Date.now();
      // Convert PDF first page to PNG
      execSync(cmd, {
        stdio: 'pipe',  // Changed to 'pipe' to suppress pdftoppm output
        timeout: 30000
      });
      const conversionTime = Date.now() - conversionStart;
      console.log(`      ✅ pdftoppm completed in ${conversionTime}ms`);

      // Check for the actual output file (pdftoppm might add -1 suffix)
      const possiblePaths = [outputPath, outputPath.replace('.png', '-1.png')];
      let actualPath = null;

      for (const p of possiblePaths) {
        try {
          await fs.promises.access(p);
          actualPath = p;
          break;
        } catch { continue; }
      }

      if (!actualPath) {
        throw new Error('PDF conversion failed - no output created');
      }
      console.log(`      ✓ Output file found: ${actualPath}`);

      // Read and convert to base64
      console.log(`      🔄 Converting to base64...`);
      const buffer = await fs.promises.readFile(actualPath);
      const base64 = buffer.toString('base64');
      console.log(`      ✅ Base64 conversion complete (${base64.length} chars)`);

      // Clean up temp file
      await fs.promises.unlink(actualPath).catch(() => {});
      console.log(`      ✓ Temp file cleaned up`);

      // Return raw base64 (phi_masker will add the data URI prefix)
      return base64;
    } catch (error) {
      console.error(`      ❌ Conversion failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Convert all pages of PDF to base64 array
   * Returns array of { pageNum, base64 } objects
   * @param {string} pdfPath - Path to PDF file
   * @param {object} options - Conversion options
   * @param {number} options.dpi - Resolution in DPI (default: 150)
   * @param {number[]} options.highDpiPages - Array of page numbers to convert at higher DPI (200)
   */
  async convertPdfAllPagesToBase64(pdfPath, options = {}) {
    const { dpi = 250, highDpiPages = [] } = options;

    console.log(`      ┌─ Multi-Page PDF Conversion ────────────────────────────┐`);
    console.log(`      │ 📄 Input: ${pdfPath}`);
    console.log(`      │ 🔧 Tool: pdftoppm (poppler-utils)`);
    console.log(`      │ 📐 Base Resolution: ${dpi} DPI`);
    if (highDpiPages.length > 0) {
      console.log(`      │ 📐 High DPI Pages: ${highDpiPages.join(', ')} @ 200 DPI`);
    }
    console.log(`      │ 📃 Pages: ALL`);
    console.log(`      └────────────────────────────────────────────────────────┘`);

    const { execSync } = require('child_process');
    const crypto = require('crypto');
    const fs = require('fs');
    const path = require('path');

    const tempDir = '/tmp/prescription_masking_temp';
    await fs.promises.mkdir(tempDir, { recursive: true });
    console.log(`      ✓ Temp dir created: ${tempDir}`);

    const fileId = crypto.randomBytes(8).toString('hex');
    const baseOutputPath = path.join(tempDir, fileId);

    try {
      // First, get page count
      const pageCountCmd = `pdfinfo "${pdfPath}" | grep Pages | awk '{print $2}'`;
      const pageCount = parseInt(execSync(pageCountCmd, { encoding: 'utf-8' }).trim()) || 1;
      console.log(`      📃 Total pages: ${pageCount}`);

      const pages = [];

      if (highDpiPages.length === 0) {
        // Standard conversion: all pages at same DPI
        const cmd = `pdftoppm -png -r ${dpi} "${pdfPath}" "${baseOutputPath}"`;
        execSync(cmd, {
          stdio: 'pipe',
          timeout: 60000  // Higher timeout for multi-page
        });

        // Process all generated files
        const tempFiles = fs.readdirSync(tempDir)
          .filter(f => f.startsWith(fileId) && f.endsWith('.png'))
          .sort((a, b) => {
            const aNum = parseInt(a.match(/-(\d+)\.png$/)?.[1] || '0');
            const bNum = parseInt(b.match(/-(\d+)\.png$/)?.[1] || '0');
            return aNum - bNum;
          });

        console.log(`      ✓ Found ${tempFiles.length} page files`);

        for (const filename of tempFiles) {
          const fullPath = path.join(tempDir, filename);
          const pageNum = parseInt(filename.match(/-(\d+)\.png$/)?.[1] || '0');

          if (pageNum > 0) {
            const base64 = fs.readFileSync(fullPath, 'base64');
            pages.push({
              pageNum,
              base64,
              dataUrl: `data:image/png;base64,${base64}`
            });
            console.log(`      ✓ Page ${pageNum}/${pageCount} converted @ ${dpi} DPI (${base64.length} chars)`);

            fs.unlinkSync(fullPath);
          }
        }
      } else {
        // Hybrid conversion: some pages at higher DPI
        // First convert normal pages
        const normalPages = [];
        for (let i = 1; i <= pageCount; i++) {
          if (!highDpiPages.includes(i)) {
            normalPages.push(i);
          }
        }

        // Convert normal pages at base DPI
        if (normalPages.length > 0) {
          const pageRanges = this.buildPageRanges(normalPages);
          for (const range of pageRanges) {
            const cmd = `pdftoppm -png -r ${dpi} -f ${range.start} -l ${range.end} "${pdfPath}" "${baseOutputPath}_normal"`;
            execSync(cmd, { stdio: 'pipe', timeout: 60000 });
          }
        }

        // Convert high DPI pages at 200 DPI
        for (const pageNum of highDpiPages) {
          const cmd = `pdftoppm -png -singlefile -r 200 -f ${pageNum} "${pdfPath}" "${baseOutputPath}_high_p${pageNum}"`;
          execSync(cmd, { stdio: 'pipe', timeout: 30000 });
        }

        // Process normal pages
        for (let i = 1; i <= pageCount; i++) {
          if (!highDpiPages.includes(i)) {
            const possiblePaths = [
              path.join(tempDir, `${fileId}_normal-${i}.png`),
              path.join(tempDir, `${fileId}_normal-1.png`) // fallback
            ];
            for (const p of possiblePaths) {
              try {
                fs.accessSync(p);
                const base64 = fs.readFileSync(p, 'base64');
                pages.push({
                  pageNum: i,
                  base64,
                  dataUrl: `data:image/png;base64,${base64}`
                });
                console.log(`      ✓ Page ${i}/${pageCount} converted @ ${dpi} DPI (${base64.length} chars)`);
                fs.unlinkSync(p);
                break;
              } catch { continue; }
            }
          }
        }

        // Process high DPI pages
        for (const pageNum of highDpiPages) {
          const possiblePaths = [
            path.join(tempDir, `${fileId}_high_p${pageNum}.png`),
            path.join(tempDir, `${fileId}_high_p${pageNum}-1.png`)
          ];
          for (const p of possiblePaths) {
            try {
              fs.accessSync(p);
              const base64 = fs.readFileSync(p, 'base64');
              pages.push({
                pageNum,
                base64,
                dataUrl: `data:image/png;base64,${base64}`
              });
              console.log(`      ✓ Page ${pageNum}/${pageCount} converted @ 200 DPI HIGH RES (${base64.length} chars)`);
              fs.unlinkSync(p);
              break;
            } catch { continue; }
          }
        }

        // Sort pages by page number
        pages.sort((a, b) => a.pageNum - b.pageNum);
      }

      console.log(`      ✅ All ${pages.length} pages converted`);
      return pages;
    } catch (error) {
      console.error(`      ❌ Multi-page conversion failed: ${error.message}`);
      return null;
    }
  }

  saveStage3ReviewPages(imagesForStage3, pdfName) {
    const timestamp = Date.now();

    return imagesForStage3.map((page) => {
      const imageData = String(page.imageData || "");
      const base64 = imageData.startsWith("data:")
        ? imageData.split(",")[1] || ""
        : imageData;
      const suffix = page.isMasked ? "masked" : "original";
      const filename = `review_${pdfName.replace(/[^a-zA-Z0-9]/g, "_")}_${timestamp}_p${page.pageNum}_${suffix}.png`;
      const filePath = path.join(this.maskingConfig.maskedImagesDir, filename);

      fs.writeFileSync(filePath, Buffer.from(base64, "base64"));

      return {
        page_number: page.pageNum,
        image_path: filename,
        image_role: page.isMasked ? "masked" : "original",
        sent_to_external: true,
      };
    });
  }

  /**
   * Check if Stage 3 data has meaningful content (not just empty arrays/objects)
   */
  hasMeaningfulStage3Data(stage3Data) {
    if (!stage3Data) return false;

    // Check medications
    if (stage3Data.medications && stage3Data.medications.length > 0) return true;

    // Check vitals - need at least one actual value
    if (stage3Data.vitals) {
      const v = stage3Data.vitals;
      if (v.blood_pressure?.systolic && v.blood_pressure.systolic > 0) return true;
      if (v.pulse?.value && v.pulse.value > 0) return true;
      if (v.temperature?.value && v.temperature.value > 0) return true;
      if (v.weight?.value && v.weight.value > 0) return true;
      if (v.spo2?.value && v.spo2.value > 0) return true;
    }

    // Check diagnosis
    if (stage3Data.diagnosis?.principal) return true;
    if (stage3Data.handwritten_notes && stage3Data.handwritten_notes.length > 0) return true;
    if (stage3Data.diagnosis?.symptoms && stage3Data.diagnosis.symptoms.length > 0) return true;

    // Check lab investigations
    if (stage3Data.lab_investigations?.selected_tests && stage3Data.lab_investigations.selected_tests.length > 0) return true;

    // Check radiology
    if (stage3Data.radiology_selections?.selected_studies && stage3Data.radiology_selections.selected_studies.length > 0) return true;

    return false;
  }
}

module.exports = PrescriptionTwoStageAgent;
