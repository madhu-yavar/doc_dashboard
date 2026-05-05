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
const HandwritingNotesExtractorSkill = require("../../skills/extraction/stage3/handwriting_notes_extractor.skill.cjs");
const HandwritingOrdersExtractorSkill = require("../../skills/extraction/stage3/handwriting_orders_extractor.skill.cjs");
const HandwritingStructuredReconcilerSkill = require("../../skills/extraction/stage3/handwriting_structured_reconciler.skill.cjs");
const VisualElementDetectorSkill = require("../../skills/extraction/stage3/visual_element_detector.skill.cjs");

class HandwritingExtractionAgent {
  constructor(config = {}) {
    this.name = "Handwriting Extraction Agent (Stage 3)";
    this.version = "1.1.0";
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
    this.notesExtractorSkill = new HandwritingNotesExtractorSkill(this.geminiConfig);
    this.ordersExtractorSkill = new HandwritingOrdersExtractorSkill(this.geminiConfig);
    this.structuredReconcilerSkill = new HandwritingStructuredReconcilerSkill(this.geminiConfig);
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
   * @param {string} options.pdfText - Full PDF text content for page selection
   * @returns {Promise<object>}
   */
  async process(maskedImage, options = {}) {
    const startTime = Date.now();
    const { apiKey, documentStructure, pdfText, onProgress } = options;

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
          onProgress({ type: 'start', stage: 'stage3', totalSteps: 7, pageCount: maskedImage.length });
        }
      } else {
        imagesForExtraction = [{ pageNum: 1, imageData: maskedImage, isMasked: true }];
        console.log(`\n📝 Stage 3: Processing handwriting extraction with Gemini`);
        if (onProgress) {
          onProgress({ type: 'start', stage: 'stage3', totalSteps: 7 });
        }
      }

      // Execute all Stage 3 extractions
      const results = await this.executeStage3Extractions({
        images: imagesForExtraction,
        apiKey,
        documentStructure,
        pdfText,
        onProgress
      });
      const usage = this.summarizeUsage(results);

      // Check if all extractions failed (e.g., 429 quota error)
      const allFailed = !results.medications?.success &&
                       !results.notes?.success &&
                       !results.vitals?.success &&
                       !results.diagnosis?.success &&
                       !results.orders?.success &&
                       !results.visualElements?.success;

      if (allFailed) {
        // Extract first error for reporting
        const firstError = results.medications?.error ||
                          results.notes?.error ||
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
      if (stage3Data.handwritten_notes?.length) {
        console.log(`   │ 📝 Notes: ${stage3Data.handwritten_notes.length} extracted`);
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
            notes_count: stage3Data.handwritten_notes?.length || 0,
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
        usage,
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

    // Normalize images to objects with pageNum and imageData
    const normalizedImages = images.map(img => {
      if (typeof img === 'string') {
        return { pageNum: 1, imageData: img };
      }
      return img;
    });

    console.log(`      📋 Stage 3 Extraction Configuration:`);
    console.log(`         ├─ Total pages: ${normalizedImages.length}`);
    console.log(`         ├─ API Key provided: ✓ (${apiKey.substring(0, 10)}...)`);
    console.log(`         └─ Model: ${this.geminiConfig.geminiModel}`);

    const allImages = normalizedImages.map(img => img.imageData);

    let stepNumber = 1;

    // Step 1: Medications - PER-PAGE extraction to avoid context contamination
    console.log(`      🔄 Step 3.1: Extracting medications (per-page, then merge)...`);
    const medStart = Date.now();
    const medications = await this.extractMedicationsPerPage(normalizedImages, {
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

      // Step 2: Notes - PER-PAGE extraction to reduce cross-page hallucination
      console.log(`      🔄 Step 3.2: Extracting handwritten notes (per-page, then merge)...`);
      const notesStart = Date.now();
      const notes = await this.extractNotesPerPage(normalizedImages, {
        apiKey,
        onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ })
      });
      const notesTime = Date.now() - notesStart;
      if (notes.success) {
        const noteCount = notes.data?.notes?.length || 0;
        console.log(`         ✅ Complete: ${noteCount} notes extracted (${notesTime}ms)`);
      } else {
        console.log(`         ❌ Failed: ${notes.error} (${notesTime}ms)`);
      }

      // Steps 3-6: Run remaining extractions with all pages
      console.log(`      🔄 Step 3.3-3.6: Parallel extraction (Vitals, Diagnosis, Orders, Visual Elements)...`);
      const parallelStart = Date.now();
      const [
        vitals,
        diagnosis,
        orders,
      visualElements
    ] = await Promise.all([
      this.vitalsExtractorSkill.execute({ images: allImages, apiKey, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) }),
      this.diagnosisExtractorSkill.execute({ images: allImages, apiKey, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) }),
      this.ordersExtractorSkill.execute({ images: allImages, apiKey, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) }),
      this.visualElementDetectorSkill.execute({ images: allImages, apiKey, onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ }) })
    ]);
    const parallelTime = Date.now() - parallelStart;
    console.log(`         ✅ Parallel extraction complete (${parallelTime}ms)`);
    console.log(`            ├─ Vitals: ${vitals.success ? '✓' : '✗'}`);
    console.log(`            ├─ Diagnosis: ${diagnosis.success ? '✓' : '✗'}`);
    console.log(`            ├─ Orders: ${orders.success ? '✓' : '✗'}`);
    console.log(`            └─ Visual Elements: ${visualElements.success ? '✓' : '✗'}`);

    let structuredReconciliation = {
      success: true,
      step: "handwriting_structured_reconciler",
      data: {
        lab_investigations: [],
        radiology: { selected_studies: [] },
        nuclear_medicine: { selected_studies: [] },
        procedures: [],
        has_additions: false,
        confidence: "medium"
      }
    };

    if (this.config.enableStructuredReconciliation !== false) {
      console.log(`      🔄 Step 3.7: Gemini structured reconciliation from notes/findings...`);
      const reconciliationStart = Date.now();

      structuredReconciliation = await this.structuredReconcilerSkill.execute({
        images: allImages,
        apiKey,
        notes: notes.data?.notes || [],
        diagnosis: diagnosis.data?.diagnosis || {},
        orders: orders.data || {},
        visualElements: visualElements.data || {},
        onProgress: (s) => onProgress?.({ ...s, stepNumber: stepNumber++ })
      });

      const reconciliationTime = Date.now() - reconciliationStart;
      if (structuredReconciliation.success) {
        const reconciliationData = structuredReconciliation.data || {};
        console.log(`         ✅ Reconciliation complete (${reconciliationTime}ms)`);
        console.log(`            ├─ Promoted labs: ${reconciliationData.lab_investigations?.length || 0}`);
        console.log(`            ├─ Promoted imaging: ${reconciliationData.radiology?.selected_studies?.length || 0}`);
        console.log(`            ├─ Promoted nuclear: ${reconciliationData.nuclear_medicine?.selected_studies?.length || 0}`);
        console.log(`            └─ Promoted procedures: ${reconciliationData.procedures?.length || 0}`);
      } else {
        console.log(`         ❌ Reconciliation failed: ${structuredReconciliation.error} (${reconciliationTime}ms)`);
      }
    }

    return {
      medications,
      notes,
      vitals,
      diagnosis,
      orders,
      visualElements,
      structuredReconciliation
    };
  }

  /**
   * Extract handwritten notes per-page, then merge and deduplicate.
   */
  async extractNotesPerPage(pages, options) {
    const { apiKey, onProgress } = options;
    const pageResults = [];

    console.log(`         📄 Processing ${pages.length} page(s) independently for notes...`);

    for (const page of pages) {
      console.log(`         └─ Page ${page.pageNum}: extracting notes...`);
      const pageStart = Date.now();

      const result = await this.notesExtractorSkill.execute({
        images: [page.imageData],
        apiKey,
        pageNum: page.pageNum
      });

      const pageTime = Date.now() - pageStart;
      const noteCount = result.data?.notes?.length || 0;
      console.log(`            └─ Page ${page.pageNum}: ${noteCount} notes (${pageTime}ms) ${result.success ? '✓' : '✗'}`);

      if (result.success && result.data?.notes?.length > 0) {
        pageResults.push({
          pageNum: page.pageNum,
          notes: result.data.notes
        });
      }
    }

    const mergedNotes = this.sanitizeMergedNotes(this.mergeNotesFromPages(pageResults));
    console.log(`         📋 Merged ${mergedNotes.length} unique notes from ${pageResults.length} page(s)`);

    if (onProgress) {
      onProgress({
        type: "success",
        step: "handwriting_notes_extractor",
        status: "complete",
        message: mergedNotes.length > 0
          ? `${mergedNotes.length} handwritten note${mergedNotes.length > 1 ? "s" : ""} merged`
          : "No handwritten notes found"
      });
    }

    return {
      success: true,
      step: "handwriting_notes_extractor",
      data: {
        notes: mergedNotes,
        has_notes: mergedNotes.length > 0,
        confidence: mergedNotes.some((note) => note.confidence === "low")
          ? "medium"
          : (mergedNotes.length > 0 ? "high" : "medium")
      }
    };
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
   * Extract medications per-page, then merge and deduplicate
   * This prevents context contamination from mixing header/clinical info with medication lists
   */
  async extractMedicationsPerPage(pages, options) {
    const { documentStructure, apiKey, onProgress } = options;
    const pageResults = [];

    console.log(`         📄 Processing ${pages.length} page(s) independently...`);

    for (const page of pages) {
      console.log(`         └─ Page ${page.pageNum}: extracting...`);
      const pageStart = Date.now();

      const result = await this.medicationsExtractorSkill.execute({
        images: [page.imageData],
        documentStructure,
        apiKey,
        pageNum: page.pageNum
      });

      const pageTime = Date.now() - pageStart;
      const medCount = result.data?.medications?.length || 0;
      console.log(`            └─ Page ${page.pageNum}: ${medCount} medications (${pageTime}ms) ${result.success ? '✓' : '✗'}`);

      if (result.success && result.data?.medications?.length > 0) {
        pageResults.push({
          pageNum: page.pageNum,
          medications: result.data.medications
        });
      }
    }

    // Merge and deduplicate
    const mergedMedications = this.mergeMedicationsFromPages(pageResults);
    console.log(`         📋 Merged ${mergedMedications.length} unique medications from ${pageResults.length} page(s)`);

    return {
      success: true,
      step: "handwriting_medications_extractor",
      data: {
        medications: mergedMedications,
        total_count: mergedMedications.length,
        has_unreadable: false,
        unreadable_count: 0
      }
    };
  }

  /**
   * Merge medications from multiple pages, deduplicating by normalized name
   */
  mergeMedicationsFromPages(pageResults) {
    const merged = new Map();

    for (const pageResult of pageResults) {
      for (const med of pageResult.medications) {
        // Normalize name for deduplication
        const normalizedName = (med.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

        if (!normalizedName) continue;

        const existing = merged.get(normalizedName);

        if (!existing) {
          // First time seeing this medication
          merged.set(normalizedName, { ...med, _sourcePages: [pageResult.pageNum] });
        } else {
          // Duplicate - keep the better version
          merged.set(normalizedName, this.selectBetterMedication(existing, med, pageResult.pageNum));
        }
      }
    }

    // Clean up internal fields and return
    return Array.from(merged.values()).map(med => {
      const { _sourcePages, ...cleanMed } = med;
      return cleanMed;
    });
  }

  /**
   * Select the better medication when duplicates are found
   */
  selectBetterMedication(existing, newMed, newPageNum) {
    // Prefer higher confidence
    const confidenceScore = { high: 3, medium: 2, low: 1 };
    const existingScore = confidenceScore[existing.confidence] || 0;
    const newScore = confidenceScore[newMed.confidence] || 0;

    if (newScore > existingScore) {
      return { ...newMed, _sourcePages: [...(existing._sourcePages || []), newPageNum] };
    }

    // Prefer fuller dosage/frequency/duration
    const existingCompleteness = this.completenessScore(existing);
    const newCompleteness = this.completenessScore(newMed);

    if (newCompleteness > existingCompleteness) {
      return { ...newMed, _sourcePages: [...(existing._sourcePages || []), newPageNum] };
    }

    // Keep existing
    return { ...existing, _sourcePages: [...(existing._sourcePages || []), newPageNum] };
  }

  /**
   * Calculate completeness score for medication
   */
  completenessScore(med) {
    let score = 0;
    if (med.dosage) score++;
    if (med.frequency) score++;
    if (med.duration) score++;
    if (med.generic_name) score++;
    return score;
  }

  normalizeNoteText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  cleanNoteText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\s+([,:;.!?])/g, "$1")
      .trim();
  }

  isFragmentaryNoteText(value) {
    const text = this.cleanNoteText(value).toLowerCase();
    if (!text) return true;
    if (text.length < 6) return true;
    return /^(pl\.?\s*add|adv(?:ice)?|review|f\/u|follow up)\s*:?\s*$/i.test(text);
  }

  isLowValueNote(note = {}) {
    const text = this.cleanNoteText(note.text || note.source_excerpt || "");
    if (!text) return true;
    if (this.isFragmentaryNoteText(text)) return true;
    if (/^(same|continue same|as advised|as before)$/i.test(text)) return true;
    return false;
  }

  mergeFragmentWithNextNote(notes) {
    const merged = [];

    for (let index = 0; index < notes.length; index += 1) {
      const current = notes[index];
      const currentText = this.cleanNoteText(current?.text || "");
      const next = notes[index + 1];

      if (
        next &&
        this.isFragmentaryNoteText(currentText) &&
        !this.isLowValueNote(next)
      ) {
        const nextText = this.cleanNoteText(next.text || "");
        const combinedText = this.cleanNoteText(
          currentText.endsWith(":")
            ? `${currentText} ${nextText}`
            : `${currentText}: ${nextText}`
        );

        merged.push({
          ...next,
          text: combinedText,
          source_excerpt: this.cleanNoteText(next.source_excerpt || combinedText),
          confidence_reason: next.confidence_reason || current.confidence_reason || "",
          confidence: this.noteConfidenceScore(next) >= this.noteConfidenceScore(current)
            ? next.confidence
            : current.confidence
        });
        index += 1;
        continue;
      }

      merged.push(current);
    }

    return merged;
  }

  sanitizeMergedNotes(notes) {
    const merged = this.mergeFragmentWithNextNote(Array.isArray(notes) ? notes : []);

    return merged
      .map((note) => {
        const text = this.cleanNoteText(note.text || "");
        const sourceExcerpt = this.cleanNoteText(note.source_excerpt || text);
        return {
          ...note,
          text,
          source_excerpt: sourceExcerpt,
          confidence_reason: this.cleanNoteText(note.confidence_reason || "")
        };
      })
      .filter((note) => !this.isLowValueNote(note))
      .slice(0, 6);
  }

  noteConfidenceScore(note) {
    const confidenceScore = { high: 3, medium: 2, low: 1 };
    return confidenceScore[note?.confidence] || 0;
  }

  mergeNotesFromPages(pageResults) {
    const merged = new Map();

    for (const pageResult of pageResults) {
      for (const note of pageResult.notes) {
        const normalizedText = this.normalizeNoteText(note.text);
        if (!normalizedText) continue;

        const existing = merged.get(normalizedText);
        const candidate = {
          ...note,
          source_excerpt: note.source_excerpt || note.text,
          page_number: note.page_number || pageResult.pageNum,
          source_type: "handwritten",
          is_synthetic: false
        };

        if (!existing) {
          merged.set(normalizedText, candidate);
          continue;
        }

        const existingScore = this.noteConfidenceScore(existing);
        const candidateScore = this.noteConfidenceScore(candidate);
        const existingLength = String(existing.source_excerpt || existing.text || "").length;
        const candidateLength = String(candidate.source_excerpt || candidate.text || "").length;

        if (candidateScore > existingScore || (candidateScore === existingScore && candidateLength > existingLength)) {
          merged.set(normalizedText, {
            ...candidate,
            page_number: existing.page_number || candidate.page_number
          });
        }
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Compile Stage 3 data from all extraction results
   */
  compileStage3Data(results) {
    const diagnosisData = results.diagnosis?.data?.diagnosis || {};
    const notesData = results.notes?.data || {};
    const ordersData = results.orders?.data || {};
    const reconciliationData = results.structuredReconciliation?.data || {};
    const mergedLabInvestigations = this.mergeLabInvestigations(
      [
        ...(Array.isArray(ordersData.lab_investigations) ? ordersData.lab_investigations : []),
        ...(Array.isArray(reconciliationData.lab_investigations) ? reconciliationData.lab_investigations : [])
      ],
      results.visualElements?.data?.lab_investigations
    );
    const mergedRadiologySelections = this.mergeRadiologySelections(
      {
        selected_studies: [
          ...(Array.isArray(ordersData.radiology?.selected_studies) ? ordersData.radiology.selected_studies : []),
          ...(Array.isArray(reconciliationData.radiology?.selected_studies) ? reconciliationData.radiology.selected_studies : [])
        ]
      },
      results.visualElements?.data?.radiology
    );
    const mergedNuclearMedicineSelections = this.mergeNuclearMedicineSelections(
      ordersData.nuclear_medicine,
      reconciliationData.nuclear_medicine
    );
    const mergedProcedures = this.mergeProcedures(
      ordersData.procedures,
      reconciliationData.procedures
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

      handwritten_notes: Array.isArray(notesData.notes) ? notesData.notes : [],
      notes_metadata: {
        has_notes: notesData.has_notes || false,
        confidence: notesData.confidence || "medium",
        total_notes: Array.isArray(notesData.notes) ? notesData.notes.length : 0
      },

      // Legacy lab_results is kept for older dashboard consumers that expect the key.
      lab_results: [],

      // Lab investigations and radiology are fused from text orders + visual selections
      lab_investigations: mergedLabInvestigations,

      radiology: mergedRadiologySelections,
      radiology_selections: mergedRadiologySelections,

      // Nuclear medicine studies
      nuclear_medicine: mergedNuclearMedicineSelections,

      // Procedures
      procedures: mergedProcedures,

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

    if (results.notes?.data?.has_notes) {
      scores.push(results.notes.data?.confidence === "high" ? 1 : 0.75);
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
      const key = this.normalizeStructuredKey(name);
      const existing = mergedByName.get(key);
      const candidate = {
        test_name: name,
        category: item?.category || "unknown",
        is_checked: true,
        is_circled: false,
        is_underlined: false,
        priority: "routine",
        source: item?.source || "text_order",
        is_uncertain: Boolean(item?.is_uncertain),
        confidence_reason: String(item?.confidence_reason || "")
      };
      mergedByName.set(key, existing ? this.mergeStructuredEntries(existing, candidate, "test_name") : candidate);
    }

    const visualSelectedTests = Array.isArray(visualInvestigations?.selected_tests)
      ? visualInvestigations.selected_tests
      : [];

    for (const item of visualSelectedTests) {
      const name = String(item?.test_name || "").trim();
      if (!name) continue;
      const key = this.normalizeStructuredKey(name);
      const existing = mergedByName.get(key);
      const candidate = {
        test_name: name,
        category: existing?.category || "unknown",
        is_checked: item?.is_checked ?? existing?.is_checked ?? true,
        is_circled: item?.is_circled ?? existing?.is_circled ?? false,
        is_underlined: item?.is_underlined ?? existing?.is_underlined ?? false,
        priority: item?.priority || existing?.priority || "routine",
        source: this.combineStructuredSource(existing?.source, "visual_selection"),
        is_uncertain: existing?.is_uncertain ?? Boolean(item?.is_uncertain),
        confidence_reason: existing?.confidence_reason || String(item?.confidence_reason || "")
      };
      mergedByName.set(key, existing ? this.mergeStructuredEntries(existing, candidate, "test_name") : candidate);
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
      const key = this.normalizeStructuredKey(name);
      const existing = mergedByName.get(key);
      const candidate = {
        study_name: name,
        category: item?.category || "imaging",
        is_checked: true,
        source: item?.source || "text_order",
        is_uncertain: Boolean(item?.is_uncertain),
        confidence_reason: String(item?.confidence_reason || "")
      };
      mergedByName.set(key, existing ? this.mergeStructuredEntries(existing, candidate, "study_name") : candidate);
    }

    for (const item of Array.isArray(visualRadiology?.selected_studies) ? visualRadiology.selected_studies : []) {
      const name = String(item?.study_name || "").trim();
      if (!name) continue;
      const key = this.normalizeStructuredKey(name);
      const existing = mergedByName.get(key);
      const candidate = {
        study_name: name,
        category: existing?.category || item?.category || "imaging",
        is_checked: item?.is_checked ?? existing?.is_checked ?? true,
        source: this.combineStructuredSource(existing?.source, "visual_selection"),
        is_uncertain: existing?.is_uncertain ?? Boolean(item?.is_uncertain),
        confidence_reason: existing?.confidence_reason || String(item?.confidence_reason || "")
      };
      mergedByName.set(key, existing ? this.mergeStructuredEntries(existing, candidate, "study_name") : candidate);
    }

    return {
      selected_studies: Array.from(mergedByName.values())
    };
  }

  mergeNuclearMedicineSelections(textNuclearMedicine, reconciledNuclearMedicine) {
    const mergedByName = new Map();
    const allItems = [
      ...(Array.isArray(textNuclearMedicine?.selected_studies) ? textNuclearMedicine.selected_studies : []),
      ...(Array.isArray(reconciledNuclearMedicine?.selected_studies) ? reconciledNuclearMedicine.selected_studies : [])
    ];

    for (const item of allItems) {
      const name = String(item?.study_name || "").trim();
      if (!name) continue;
      const key = this.normalizeStructuredKey(name);
      const existing = mergedByName.get(key);
      const candidate = {
        study_name: name,
        category: item?.category || "nuclear",
        is_checked: true,
        source: item?.source || "text_order",
        is_uncertain: Boolean(item?.is_uncertain),
        confidence_reason: String(item?.confidence_reason || "")
      };
      mergedByName.set(key, existing ? this.mergeStructuredEntries(existing, candidate, "study_name") : candidate);
    }

    return {
      selected_studies: Array.from(mergedByName.values())
    };
  }

  mergeProcedures(textProcedures, reconciledProcedures) {
    const mergedByName = new Map();
    const allItems = [
      ...(Array.isArray(textProcedures) ? textProcedures : []),
      ...(Array.isArray(reconciledProcedures) ? reconciledProcedures : [])
    ];

    for (const item of allItems) {
      const name = String(item?.name || "").trim();
      if (!name) continue;
      const key = this.normalizeStructuredKey(name);
      const existing = mergedByName.get(key);
      const candidate = {
        name,
        category: item?.category || "procedure",
        is_uncertain: Boolean(item?.is_uncertain),
        confidence_reason: String(item?.confidence_reason || ""),
        source: item?.source || "text_order"
      };
      mergedByName.set(key, existing ? this.mergeStructuredEntries(existing, candidate, "name") : candidate);
    }

    return Array.from(mergedByName.values());
  }

  normalizeStructuredKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\bc\/s\b/g, "culture sensitivity")
      .replace(/\busg\b/g, "ultrasound")
      .replace(/\bx[\s-]?ray\b/g, "xray")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  combineStructuredSource(existingSource, incomingSource) {
    const sources = new Set([existingSource, incomingSource].filter(Boolean));
    const sourceList = Array.from(sources);
    const hasVisual = sourceList.some((source) => /visual/.test(String(source || "")));
    const hasTextLike = sourceList.some((source) => !/^visual_selection$/i.test(String(source || "")));

    if (hasVisual && hasTextLike) return "text+visual";
    if (hasVisual) return "visual_selection";
    return existingSource || incomingSource || "text_order";
  }

  mergeStructuredEntries(existing, candidate, labelKey) {
    const currentLabel = String(existing?.[labelKey] || "");
    const candidateLabel = String(candidate?.[labelKey] || "");
    const currentScore = this.structuredEntryScore(existing, currentLabel);
    const candidateScore = this.structuredEntryScore(candidate, candidateLabel);
    const preferred = candidateScore > currentScore ? candidate : existing;
    const alternate = preferred === candidate ? existing : candidate;

    return {
      ...preferred,
      [labelKey]: candidateLabel.length > currentLabel.length ? candidateLabel : currentLabel,
      category: preferred.category || alternate.category || "unknown",
      source: this.combineStructuredSource(existing?.source, candidate?.source),
      is_checked: Boolean(existing?.is_checked || candidate?.is_checked),
      is_circled: Boolean(existing?.is_circled || candidate?.is_circled),
      is_underlined: Boolean(existing?.is_underlined || candidate?.is_underlined),
      is_uncertain: Boolean(existing?.is_uncertain && candidate?.is_uncertain),
      confidence_reason: String(preferred.confidence_reason || alternate.confidence_reason || "")
    };
  }

  structuredEntryScore(item, label) {
    return [
      label.length,
      item?.source === "text+visual" ? 6 : 0,
      item?.source === "text_order" ? 5 : 0,
      item?.source === "note_reconciliation" ? 4 : 0,
      item?.source === "visual_selection" ? 3 : 0,
      item?.is_uncertain ? 0 : 2
    ].reduce((sum, value) => sum + value, 0);
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
