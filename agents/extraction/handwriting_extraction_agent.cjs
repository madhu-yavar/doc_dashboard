/**
 * Handwriting Extraction Agent (Stage 3)
 * Extracts handwritten content from masked prescription images
 * Uses Gemini 2.5 Flash for superior handwriting recognition
 * Part of two-stage prescription extraction pipeline
 *
 * Stage 3 Output (Clinical data):
 * - Medications (handwritten)
 * - Vitals
 * - Diagnosis
 * - Clinical notes
 * - Lab investigation selections (visual ticks/circles)
 *
 * Requires: User-provided Gemini API key
 * Input: Masked image from Stage 2 (PHI removed)
 */

// Stage 3 Skills
const HandwritingMedicationsExtractorSkill = require("../../skills/extraction/stage3/handwriting_medications_extractor.skill.cjs");
const HandwritingVitalsExtractorSkill = require("../../skills/extraction/stage3/handwriting_vitals_extractor.skill.cjs");
const HandwritingDiagnosisExtractorSkill = require("../../skills/extraction/stage3/handwriting_diagnosis_extractor.skill.cjs");
const HandwritingOrdersExtractorSkill = require("../../skills/extraction/stage3/handwriting_orders_extractor.skill.cjs");
const VisualElementDetectorSkill = require("../../skills/extraction/stage3/visual_element_detector.skill.cjs");

class HandwritingExtractionAgent {
  constructor(config = {}) {
    this.name = "Handwriting Extraction Agent (Stage 3)";
    this.version = "1.0.0";
    this.type = "stage3_extraction";

    // Gemini configuration
    this.geminiConfig = {
      geminiBaseUrl: config.geminiBaseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models",
      geminiModel: config.geminiModel || "gemini-2.5-flash",
      timeout: config.timeout || 180000
    };

    // Initialize Stage 3 skills
    this.medicationsExtractorSkill = new HandwritingMedicationsExtractorSkill(this.geminiConfig);
    this.vitalsExtractorSkill = new HandwritingVitalsExtractorSkill(this.geminiConfig);
    this.diagnosisExtractorSkill = new HandwritingDiagnosisExtractorSkill(this.geminiConfig);
    this.ordersExtractorSkill = new HandwritingOrdersExtractorSkill(this.geminiConfig);
    this.visualElementDetectorSkill = new VisualElementDetectorSkill(this.geminiConfig);

    this.config = {
      maxRetries: 2,
      timeoutPerStep: 180000,
      totalTimeout: 600000,
      requireAllSteps: false,
      logSteps: true,
      saveIntermediates: true,
      ...config
    };
  }

  /**
   * Process masked prescription image(s) for Stage 3 extraction
   * @param {string|Array} maskedImage - Base64 encoded masked image(s) or array of {pageNum, imageData, isMasked}
   * @param {object} options - Processing options
   * @param {string} options.apiKey - User's Gemini API key (required)
   * @param {object} options.documentStructure - From Stage 1
   * @returns {Promise<object>}
   */
  async process(maskedImage, options = {}) {
    const startTime = Date.now();
    const { apiKey, documentStructure, onProgress } = options;

    if (!apiKey) {
      const error = "Gemini API key is required for Stage 3 handwriting extraction";
      console.error(`   ❌ ${error}`);

      if (onProgress) {
        onProgress({
          type: 'error',
          stage: 'stage3',
          error: error,
          user_action_required: true,
          error_code: "GEMINI_API_KEY_MISSING"
        });
      }

      return {
        success: false,
        stage: "stage3_handwriting_extraction",
        error: error,
        error_code: "GEMINI_API_KEY_MISSING",
        user_action_required: true,
        data: null
      };
    }

    try {
      // Normalize input: handle both single image and multi-page array
      let imagesForExtraction;
      if (Array.isArray(maskedImage)) {
        imagesForExtraction = maskedImage;
        console.log(`\n📝 Stage 3: Processing ${maskedImage.length} pages with Gemini`);
        if (onProgress) {
          onProgress({ type: 'start', stage: 'stage3', totalSteps: 5, pageCount: maskedImage.length });
        }
      } else {
        imagesForExtraction = [{ pageNum: 1, imageData: maskedImage, isMasked: true }];
        console.log(`\n📝 Stage 3: Processing handwriting extraction with Gemini`);
        if (onProgress) {
          onProgress({ type: 'start', stage: 'stage3', totalSteps: 5 });
        }
      }

      // Execute all Stage 3 extractions
      const results = await this.executeStage3Extractions({
        images: imagesForExtraction,
        apiKey,
        documentStructure,
        onProgress
      });

      // Check if all extractions failed (e.g., 429 quota error)
      const allFailed = !results.medications?.success &&
                       !results.vitals?.success &&
                       !results.diagnosis?.success &&
                       !results.orders?.success &&
                       !results.visualElements?.success;

      if (allFailed) {
        // Extract first error for reporting
        const firstError = results.medications?.error ||
                          results.vitals?.error ||
                          results.diagnosis?.error ||
                          results.visualElements?.error ||
                          "Stage 3 extraction failed";

        console.error(`   ❌ Stage 3 failed: ${firstError}`);

        return {
          success: false,
          stage: "stage3_handwriting_extraction",
          error: firstError,
          error_code: "STAGE3_ALL_EXTRACTIONS_FAILED",
          data: null
        };
      }

      // Compile Stage 3 data
      const stage3Data = this.compileStage3Data(results);

      const endTime = Date.now();
      const latency = endTime - startTime;

      console.log(`   ✅ Stage 3 complete in ${latency}ms`);
      console.log(`   ┌─ Stage 3 Extraction Summary ───────────────────────────┐`);
      const medCount = stage3Data.medications?.length || 0;
      console.log(`   │ 💊 Medications: ${medCount} extracted`);
      if (medCount > 0) {
        stage3Data.medications.slice(0, 3).forEach((med, i) => {
          console.log(`   │    ${i + 1}. ${med.name} - ${med.dosage || 'N/A'} ${med.frequency || ''}`);
        });
        if (medCount > 3) {
          console.log(`   │    ... and ${medCount - 3} more`);
        }
      }
      if (stage3Data.vitals?.has_vitals) {
        const v = stage3Data.vitals;
        console.log(`   │ 🩺 Vitals: BP=${v.blood_pressure?.systolic || 'N/A'}/${v.blood_pressure?.diastolic || 'N/A'}, P=${v.pulse?.value || 'N/A'}, T=${v.temperature?.value || 'N/A'}`);
      }
      if (stage3Data.diagnosis?.principal) {
        console.log(`   │ 📋 Diagnosis: ${stage3Data.diagnosis.principal.substring(0, 50)}...`);
      }
      const labCount = stage3Data.lab_investigations?.total_selected || 0;
      console.log(`   │ 🔬 Labs: ${labCount} investigations selected`);
      console.log(`   └─────────────────────────────────────────────────────┘`);

      if (onProgress) {
        onProgress({
          type: 'stage_complete',
          stage: 'stage3',
          status: 'complete',
          summary: {
            medications_count: stage3Data.medications?.length || 0,
            lab_selections_count: stage3Data.lab_investigations?.total_selected || 0,
            has_diagnosis: !!stage3Data.diagnosis?.principal,
            has_vitals: stage3Data.vitals?.has_vitals || false
          },
          latency
        });
      }

      return {
        success: true,
        stage: "stage3_handwriting_extraction",
        data: stage3Data,
        metadata: {
          stage: "stage3",
          model: this.geminiConfig.geminiModel,
          processing_time: latency,
          extracted_at: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error(`   ❌ Stage 3 failed: ${error.message}`);

      if (onProgress) {
        onProgress({
          type: 'error',
          stage: 'stage3',
          error: error.message,
          error_code: "STAGE3_EXTRACTION_FAILED"
        });
      }

      return {
        success: false,
        stage: "stage3_handwriting_extraction",
        error: error.message,
        error_code: "STAGE3_EXTRACTION_FAILED",
        data: null
      };
    }
  }

  /**
   * Execute all Stage 3 extraction skills
   */
  async executeStage3Extractions(context) {
    const { images, apiKey, documentStructure, onProgress } = context;

    // Combine all images into a single Gemini request
    // For multi-page PDFs, we'll send all pages to Gemini
    const allImageDataUrls = images.map(img => {
      if (typeof img === 'string') {
        return img;
      }
      return img.imageData;
    });

    console.log(`      📋 Stage 3 Extraction Configuration:`);
    console.log(`         ├─ Images: ${allImageDataUrls.length} page(s)`);
    console.log(`         ├─ Total size: ${allImageDataUrls.reduce((sum, url) => sum + url.length, 0)} chars`);
    console.log(`         ├─ API Key provided: ✓ (${apiKey.substring(0, 10)}...)`);
    console.log(`         └─ Model: ${this.geminiConfig.geminiModel}`);

    let stepNumber = 1;

    // Step 1: Medications (most important)
    console.log(`      🔄 Step 3.1: Extracting medications...`);
    const medStart = Date.now();
    const medications = await this.medicationsExtractorSkill.execute({
      images: allImageDataUrls,
      documentStructure,
      apiKey,
      onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ })
    });
    const medTime = Date.now() - medStart;
    if (medications.success) {
      const medCount = medications.data?.medications?.length || 0;
      console.log(`         ✅ Complete: ${medCount} medications extracted (${medTime}ms)`);
    } else {
      console.log(`         ❌ Failed: ${medications.error} (${medTime}ms)`);
    }

    // Steps 2-5: Run remaining extractions
    console.log(`      🔄 Step 3.2-3.5: Parallel extraction (Vitals, Diagnosis, Orders, Visual Elements)...`);
    const parallelStart = Date.now();
    const [
      vitals,
      diagnosis,
      orders,
      visualElements
    ] = await Promise.all([
      this.vitalsExtractorSkill.execute({ images: allImageDataUrls, apiKey, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) }),
      this.diagnosisExtractorSkill.execute({ images: allImageDataUrls, apiKey, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) }),
      this.ordersExtractorSkill.execute({ images: allImageDataUrls, apiKey, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) }),
      this.visualElementDetectorSkill.execute({ images: allImageDataUrls, apiKey, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) })
    ]);
    const parallelTime = Date.now() - parallelStart;
    console.log(`         ✅ Parallel extraction complete (${parallelTime}ms)`);
    console.log(`            ├─ Vitals: ${vitals.success ? '✓' : '✗'}`);
    console.log(`            ├─ Diagnosis: ${diagnosis.success ? '✓' : '✗'}`);
    console.log(`            ├─ Orders: ${orders.success ? '✓' : '✗'}`);
    console.log(`            └─ Visual Elements: ${visualElements.success ? '✓' : '✗'}`);

    return {
      medications,
      vitals,
      diagnosis,
      orders,
      visualElements
    };
  }

  /**
   * Compile Stage 3 data from all extraction results
   */
  compileStage3Data(results) {
    const diagnosisData = results.diagnosis?.data?.diagnosis || {};
    const ordersData = results.orders?.data || {};
    const mergedLabInvestigations = this.mergeLabInvestigations(
      ordersData.lab_investigations,
      results.visualElements?.data?.lab_investigations
    );
    const mergedRadiologySelections = this.mergeRadiologySelections(
      ordersData.radiology,
      results.visualElements?.data?.radiology
    );

    const data = {
      // Medications (handwritten)
      medications: results.medications?.data?.medications || [],
      medications_metadata: {
        total_count: results.medications?.data?.total_count || 0,
        has_unreadable: results.medications?.data?.has_unreadable || false,
        unreadable_count: results.medications?.data?.unreadable_count || 0
      },

      // Vitals
      vitals: results.vitals?.data?.vitals || {},
      vitals_metadata: {
        has_vitals: results.vitals?.data?.has_vitals || false,
        confidence: results.vitals?.data?.confidence || "medium"
      },

      // Diagnosis
      diagnosis: diagnosisData,
      diagnosis_metadata: {
        has_diagnosis: results.diagnosis?.data?.has_diagnosis || false,
        confidence: results.diagnosis?.data?.confidence || "medium"
      },

      // Legacy lab_results is kept for older dashboard consumers that expect the key.
      lab_results: [],

      // Lab investigations and radiology are fused from text orders + visual selections
      lab_investigations: mergedLabInvestigations,

      radiology: mergedRadiologySelections,
      radiology_selections: mergedRadiologySelections,

      // Visual element metadata
      visual_metadata: {
        has_selections: results.visualElements?.data?.has_selections || false,
        confidence: results.visualElements?.data?.confidence || "medium"
      },
      orders_metadata: {
        has_orders: results.orders?.data?.has_orders || false,
        confidence: results.orders?.data?.confidence || "medium"
      },

      // Extraction quality indicator
      extraction_quality: this.calculateExtractionQuality(results)
    };

    return data;
  }

  /**
   * Calculate overall extraction quality
   */
  calculateExtractionQuality(results) {
    const scores = [];

    // Medications quality
    if (results.medications?.success) {
      const unreadableRatio = (results.medications.data?.unreadable_count || 0) /
                             Math.max(1, results.medications.data?.total_count || 1);
      scores.push(1 - unreadableRatio);
    }

    // Vitals quality
    if (results.vitals?.data?.has_vitals) {
      scores.push(results.vitals.data?.confidence === "high" ? 1 : 0.7);
    }

    // Diagnosis quality
    if (results.diagnosis?.data?.has_diagnosis) {
      scores.push(results.diagnosis.data?.confidence === "high" ? 1 : 0.7);
    }

    // Orders quality
    if (results.orders?.data?.has_orders) {
      scores.push(results.orders.data?.confidence === "high" ? 1 : 0.7);
    }

    // Visual elements quality
    if (results.visualElements?.data?.has_selections) {
      scores.push(results.visualElements.data?.confidence === "high" ? 1 : 0.7);
    }

    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0.5;

    let overall_confidence = "medium";
    if (avgScore >= 0.8) overall_confidence = "high";
    else if (avgScore < 0.5) overall_confidence = "low";

    return {
      overall_confidence,
      score: avgScore,
      unclear_regions: []
    };
  }

  mergeLabInvestigations(textOrders, visualInvestigations) {
    const mergedByName = new Map();

    for (const item of Array.isArray(textOrders) ? textOrders : []) {
      const name = String(item?.test_name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      mergedByName.set(key, {
        test_name: name,
        category: item?.category || "unknown",
        is_checked: true,
        is_circled: false,
        is_underlined: false,
        priority: "routine",
        source: "text_order",
        is_uncertain: Boolean(item?.is_uncertain),
        confidence_reason: String(item?.confidence_reason || "")
      });
    }

    const visualSelectedTests = Array.isArray(visualInvestigations?.selected_tests)
      ? visualInvestigations.selected_tests
      : [];

    for (const item of visualSelectedTests) {
      const name = String(item?.test_name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = mergedByName.get(key);
      mergedByName.set(key, {
        test_name: name,
        category: existing?.category || "unknown",
        is_checked: item?.is_checked ?? existing?.is_checked ?? true,
        is_circled: item?.is_circled ?? existing?.is_circled ?? false,
        is_underlined: item?.is_underlined ?? existing?.is_underlined ?? false,
        priority: item?.priority || existing?.priority || "routine",
        source: existing ? "text+visual" : "visual_selection",
        is_uncertain: existing?.is_uncertain ?? false,
        confidence_reason: existing?.confidence_reason || ""
      });
    }

    const selected_tests = Array.from(mergedByName.values());
    return {
      selected_tests,
      total_available: Math.max(visualInvestigations?.total_available || 0, selected_tests.length),
      total_selected: selected_tests.length
    };
  }

  mergeRadiologySelections(textRadiology, visualRadiology) {
    const mergedByName = new Map();

    for (const item of Array.isArray(textRadiology?.selected_studies) ? textRadiology.selected_studies : []) {
      const name = String(item?.study_name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      mergedByName.set(key, {
        study_name: name,
        category: item?.category || "imaging",
        is_checked: true,
        source: "text_order",
        is_uncertain: Boolean(item?.is_uncertain),
        confidence_reason: String(item?.confidence_reason || "")
      });
    }

    for (const item of Array.isArray(visualRadiology?.selected_studies) ? visualRadiology.selected_studies : []) {
      const name = String(item?.study_name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = mergedByName.get(key);
      mergedByName.set(key, {
        study_name: name,
        category: existing?.category || item?.category || "imaging",
        is_checked: item?.is_checked ?? existing?.is_checked ?? true,
        source: existing ? "text+visual" : "visual_selection",
        is_uncertain: existing?.is_uncertain ?? false,
        confidence_reason: existing?.confidence_reason || ""
      });
    }

    return {
      selected_studies: Array.from(mergedByName.values())
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
      stage: "stage3",
      config: {
        model: this.geminiConfig.geminiModel,
        timeout: this.geminiConfig.timeout,
        requires_api_key: true
      }
    };
  }
}

module.exports = HandwritingExtractionAgent;
