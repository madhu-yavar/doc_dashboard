/**
 * Discharge Extractor Agent (Option B - Thinking/ReAct)
 * Multi-step extraction with validation for discharge summaries
 */

const PDFReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");
const GemmaClientTool = require("../tools/llm/gemma_client.tool.cjs");
const PromptBuilderTool = require("../tools/llm/prompt_builder.tool.cjs");
const ProvenanceBuilderTool = require("../tools/clinical/provenance_builder.tool.cjs");

// Skills
const DocumentAnalyzerSkill = require("../skills/extraction/document_analyzer.skill.cjs");
const DemographicsExtractorSkill = require("../skills/extraction/demographics_extractor.skill.cjs");
const RiskScoresExtractorSkill = require("../skills/extraction/risk_scores_extractor.skill.cjs");
const VitalsExtractorSkill = require("../skills/extraction/vitals_extractor.skill.cjs");
const FunctionalStatusExtractorSkill = require("../skills/extraction/functional_status_extractor.skill.cjs");
const ClinicalDataExtractorSkill = require("../skills/extraction/clinical_data_extractor.skill.cjs");
const PendingItemsExtractorSkill = require("../skills/extraction/pending_items_extractor.skill.cjs");
const CrossValidatorSkill = require("../skills/validation/cross_validator.skill.cjs");

class DischargeExtractorAgent {
  constructor(config = {}) {
    this.name = "Discharge Summary Extractor";
    this.version = "2.0.0";
    this.type = "thinking_agent";

    // Initialize tools
    this.pdfReader = new PDFReaderTool(config);
    this.gemmaClient = new GemmaClientTool(config.gemma || {});
    this.promptBuilder = new PromptBuilderTool(config);
    this.provenanceBuilder = new ProvenanceBuilderTool(config);

    // Initialize skills
    this.documentAnalyzerSkill = new DocumentAnalyzerSkill();
    this.demographicsExtractorSkill = new DemographicsExtractorSkill();
    this.riskScoresExtractorSkill = new RiskScoresExtractorSkill();
    this.vitalsExtractorSkill = new VitalsExtractorSkill();
    this.functionalStatusExtractorSkill = new FunctionalStatusExtractorSkill();
    this.clinicalDataExtractorSkill = new ClinicalDataExtractorSkill();
    this.pendingItemsExtractorSkill = new PendingItemsExtractorSkill();
    this.crossValidatorSkill = new CrossValidatorSkill();

    this.config = {
      maxRetries: 2,
      timeoutPerStep: 180000,
      totalTimeout: 600000,
      requireAllSteps: false,
      logSteps: true,
      saveIntermediates: true,
      extractionTextBudget: this.parsePositiveInt(
        config.extractionTextBudget || process.env.EXTRACTION_TEXT_BUDGET,
        40000
      ),
      extractionPerDocumentConcurrency: this.parsePositiveInt(
        config.extractionPerDocumentConcurrency || process.env.EXTRACTION_PER_DOCUMENT_CONCURRENCY,
        3
      ),
      enablePendingItemsExtraction: config.enablePendingItemsExtraction ?? process.env.ENABLE_PENDING_ITEMS_EXTRACTION !== "false",
      enableDocumentAnalyzer: config.enableDocumentAnalyzer ?? process.env.ENABLE_DOCUMENT_ANALYZER === "true",
      ...config
    };
  }

  parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  isModelConnectivityError(message = "") {
    return /(fetch failed|request timeout|econnrefused|enotfound|ehostunreach|network|socket|gemma request failed)/i.test(
      String(message || "")
    );
  }

  detectModelOutage(steps = [], totalTokens = 0) {
    const llmSteps = steps.filter(
      (step) => step?.step !== "cross_validator" && step?.step !== "document_analyzer"
    );
    if (llmSteps.length === 0) return false;

    const failedConnectivitySteps = llmSteps.filter(
      (step) => !step?.success && this.isModelConnectivityError(step?.error)
    );

    return totalTokens === 0 && failedConnectivitySteps.length === llmSteps.length;
  }

  buildExecutionPlan() {
    const metadata = [];
    const extraction = [];
    const validation = [];
    let stepNumber = 1;

    if (this.config.enableDocumentAnalyzer) {
      metadata.push({ skill: this.documentAnalyzerSkill, stepNumber, category: "metadata" });
      stepNumber += 1;
    }

    extraction.push({ skill: this.demographicsExtractorSkill, stepNumber, category: "extraction" });
    stepNumber += 1;
    extraction.push({ skill: this.riskScoresExtractorSkill, stepNumber, category: "extraction" });
    stepNumber += 1;
    extraction.push({ skill: this.vitalsExtractorSkill, stepNumber, category: "extraction" });
    stepNumber += 1;
    extraction.push({ skill: this.functionalStatusExtractorSkill, stepNumber, category: "extraction" });
    stepNumber += 1;
    extraction.push({ skill: this.clinicalDataExtractorSkill, stepNumber, category: "extraction" });
    stepNumber += 1;

    if (this.config.enablePendingItemsExtraction) {
      extraction.push({ skill: this.pendingItemsExtractorSkill, stepNumber, category: "extraction" });
      stepNumber += 1;
    }

    validation.push({ skill: this.crossValidatorSkill, stepNumber, category: "validation" });

    return {
      metadata,
      extraction,
      validation,
      totalSteps: [...metadata, ...extraction, ...validation].length,
    };
  }

  async runWithConcurrency(stepDefs, concurrency, runner) {
    if (!Array.isArray(stepDefs) || stepDefs.length === 0) return [];

    const results = new Array(stepDefs.length);
    const workerCount = Math.min(Math.max(1, concurrency || 1), stepDefs.length);
    let index = 0;

    const workers = Array.from({ length: workerCount }, async () => {
      while (index < stepDefs.length) {
        const currentIndex = index;
        index += 1;
        results[currentIndex] = await runner(stepDefs[currentIndex]);
      }
    });

    await Promise.all(workers);
    return results;
  }

  async executeStep(stepDef, context, totalSteps, onProgress) {
    const { skill, stepNumber } = stepDef;
    const stepName = skill.name;
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
      if (normalizedResult.validation?.issues?.length > 0) {
        console.log(`      ⚠️  Validation issues: ${normalizedResult.validation?.issues.join(", ")}`);
      }

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
            latencyMs,
            startedAt: normalizedResult.usage?.startedAt,
            endedAt: normalizedResult.usage?.endedAt,
            dataKeys: normalizedResult.data ? Object.keys(normalizedResult.data) : [],
            validationIssues: normalizedResult.validation?.issues?.length || 0
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

  buildExtractionText(text, maxChars) {
    if (!text) return "";
    if (!Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) {
      return text;
    }

    const marker = "\n\n[... middle document content omitted for extraction budget ...]\n\n";
    const availableChars = Math.max(0, maxChars - marker.length);
    const headChars = Math.ceil(availableChars * 0.6);
    const tailChars = Math.max(0, availableChars - headChars);

    return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`;
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
      latencyMs: step.usage?.latencyMs || step.usage?.latency || 0,
      startedAt: step.usage?.startedAt || null,
      endedAt: step.usage?.endedAt || null,
      dataKeys: step.data ? Object.keys(step.data) : [],
      hasValidation: !!step.validation,
      validationIssues: step.validation?.issues?.length || 0,
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
      validation: step.validation || null,
      error: step.error || null,
      tokens: step.usage?.totalTokens || 0,
      latencyMs: step.usage?.latencyMs || step.usage?.latency || 0,
      startedAt: step.usage?.startedAt || null,
      endedAt: step.usage?.endedAt || null,
    };
  }

  /**
   * Process a PDF document through the thinking agent pipeline
   * @param {string} pdfPath - Path to the PDF file
   * @param {object} options - Processing options
   * @param {function} options.onProgress - Callback for progress updates {step, current, total, status, data}
   * @returns {Promise<object>}
   */
  async process(pdfPath, options = {}) {
    const startTime = Date.now();
    const pdfName = options.pdfName || pdfPath.split("/").pop();
    const onProgress = options.onProgress || null;
    const executionPlan = this.buildExecutionPlan();

    try {
      console.log(`\n📄 Processing: ${pdfName}`);
      console.log(`📋 Method: Option B (Thinking/ReAct-Style Extraction)`);

      // Emit starting event
      if (onProgress) {
        onProgress({ type: 'start', pdfName, totalSteps: executionPlan.totalSteps });
      }

      // Step 1: Read PDF
      const pdfResult = await this.pdfReader.executeFull(pdfPath);
      if (!pdfResult.success) {
        throw new Error(`Failed to read PDF: ${pdfResult.error}`);
      }

      const originalPdfText = pdfResult.text || "";
      const pdfText = this.buildExtractionText(originalPdfText, this.config.extractionTextBudget);
      const wasCondensed = originalPdfText.length > pdfText.length;
      console.log(
        `   📖 PDF read: ${pdfText.length}/${originalPdfText.length} chars, ${pdfResult.pages} pages${wasCondensed ? " (budgeted)" : ""}`
      );

      // Emit PDF read event
      if (onProgress) {
        onProgress({
          type: 'step',
          step: 'pdf_read',
          stepNumber: 0,
          totalSteps: executionPlan.totalSteps,
          status: 'complete',
          data: {
            chars: pdfText.length,
            originalChars: originalPdfText.length,
            pages: pdfResult.pages,
            budgeted: wasCondensed
          }
        });
      }

      const sharedContext = {
        pdfText,
        gemmaClient: this.gemmaClient,
        promptBuilder: this.promptBuilder,
        provenanceBuilder: this.provenanceBuilder,
      };

      const metadataPromise = executionPlan.metadata.length
        ? this.runWithConcurrency(
            executionPlan.metadata,
            executionPlan.metadata.length,
            (stepDef) => this.executeStep(stepDef, { ...sharedContext, previousSteps: [] }, executionPlan.totalSteps, onProgress)
          )
        : Promise.resolve([]);

      const extractionSteps = await this.runWithConcurrency(
        executionPlan.extraction,
        this.config.extractionPerDocumentConcurrency,
        (stepDef) => this.executeStep(stepDef, { ...sharedContext, previousSteps: [] }, executionPlan.totalSteps, onProgress)
      );

      const metadataSteps = await metadataPromise;
      const validationSteps = [];

      for (const stepDef of executionPlan.validation) {
        const validationStep = await this.executeStep(
          stepDef,
          {
            ...sharedContext,
            steps: extractionSteps,
            previousSteps: extractionSteps,
          },
          executionPlan.totalSteps,
          onProgress
        );
        validationSteps.push(validationStep);
      }

      const steps = [...metadataSteps, ...extractionSteps, ...validationSteps].sort(
        (left, right) => left.stepNumber - right.stepNumber
      );
      const totalTokens = steps.reduce((sum, step) => sum + (step.usage?.totalTokens || 0), 0);

      // Assemble final result
      const finalResult = this.assembleFinalResult(steps, pdfName);

      const endTime = Date.now();

      if (this.detectModelOutage(steps, totalTokens)) {
        const modelError =
          `Model service unavailable. Could not reach Gemma at ${this.gemmaClient.baseUrl}. ` +
          `Check GEMMA_URL or model server health, then retry processing.`;

        if (onProgress) {
          onProgress({
            type: 'error',
            pdfName,
            error: modelError,
            error_type: 'model_unreachable',
          });
        }

        return {
          success: false,
          agent: this.name,
          pdfName,
          error: modelError,
          error_type: "model_unreachable",
          latency: endTime - startTime,
          tokensUsed: totalTokens,
          steps: steps.map((step) => this.serializeStepSummary(step)),
          detailedSteps: steps.map((step) => this.serializeDetailedStep(step)),
        };
      }

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

      return {
        success: true,
        agent: this.name,
        pdfName: pdfName,
        pdfPath: pdfPath,
        latency: endTime - startTime,
        tokensUsed: totalTokens,
        steps: steps.map((step) => this.serializeStepSummary(step)),
        detailedSteps: steps.map((step) => this.serializeDetailedStep(step)),
        data: finalResult.data,
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
  assembleFinalResult(steps, pdfName) {
    // Collect all data from successful steps
    const data = {
      meta: {
        pdf_file: pdfName,
        processed_at: new Date().toISOString(),
        agent_version: this.version
      },
      patient: {},
      vitals: {},
      risk_scores: {},
      functional_status: {},
      diagnosis: {},
      allergies: [],
      medications: [],
      investigations: [],
      nursing_needs: [],
      clinical_notes: [],
      treatment: {
        current_approach: "",
        management_items: [],
        procedures: [],
        response: "",
        complications: []
      },
      provenance: {},
      failed_steps: {}  // Track failed steps explicitly
    };

    const validation = {
      confidence_level: "high",
      inconsistencies_found: [],
      missing_critical_fields: [],
      data_quality_notes: ""
    };

    // Merge data from all successful steps
    steps.forEach(step => {
      // Track failed steps explicitly - don't merge their data
      if (!step.success) {
        data.failed_steps[step.step] = {
          error: step.error || "Unknown error",
          stepName: step.name,
          category: step.category
        };
        // Skip merging data from failed steps
        return;
      }

      if (step.data) {
        const stepData = step.data;

        // Smart merge based on data structure
        // If stepData has known top-level patient fields, merge into patient object
        if (stepData.name || stepData.mrn || stepData.age || stepData.gender) {
          Object.assign(data.patient, {
            name: stepData.name || data.patient.name,
            mrn: stepData.mrn || data.patient.mrn,
            age: stepData.age || data.patient.age,
            gender: stepData.gender || data.patient.gender,
            admission_date: stepData.admission_date || data.patient.admission_date,
            discharge_date: stepData.discharge_date || data.patient.discharge_date,
            los_days: stepData.los_days || data.patient.los_days
          });
        }

        // Merge vitals data
        if (
          stepData.latest ||
          Array.isArray(stepData.readings) ||
          stepData.reference_ranges ||
          stepData.abnormal_flags ||
          stepData.bp ||
          stepData.pulse ||
          stepData.spo2 ||
          stepData.temperature
        ) {
          data.vitals = {
            ...data.vitals,
            ...stepData,
            latest: stepData.latest || data.vitals.latest || {},
            readings: Array.isArray(stepData.readings) ? stepData.readings : (data.vitals.readings || []),
            reference_ranges: stepData.reference_ranges || data.vitals.reference_ranges || {},
            abnormal_flags: stepData.abnormal_flags || data.vitals.abnormal_flags || [],
          };
        }

        // Merge risk scores
        if (stepData.fall_risk || stepData.dvt_risk || stepData.ews_score || stepData.gcs) {
          Object.assign(data.risk_scores, stepData);
        }

        // Merge functional status
        if (stepData.functional_status || stepData.overall_assistance_needs) {
          Object.assign(data.functional_status, stepData);
        }

        // Merge diagnosis
        if (stepData.diagnosis) {
          Object.assign(data.diagnosis, stepData.diagnosis);
        }

        // Merge arrays
        if (Array.isArray(stepData.allergies)) {
          data.allergies = [...data.allergies, ...stepData.allergies];
        }
        if (Array.isArray(stepData.medications)) {
          data.medications = [...data.medications, ...stepData.medications];
        }
        if (Array.isArray(stepData.investigations)) {
          data.investigations = [...data.investigations, ...stepData.investigations];
        }
        if (Array.isArray(stepData.nursing_needs)) {
          data.nursing_needs = [...data.nursing_needs, ...stepData.nursing_needs];
        }
        if (Array.isArray(stepData.clinical_notes)) {
          data.clinical_notes = [...data.clinical_notes, ...stepData.clinical_notes];
        }
        if (stepData.treatment) {
          data.treatment = {
            current_approach: stepData.treatment.current_approach || data.treatment.current_approach,
            management_items: [
              ...data.treatment.management_items,
              ...(Array.isArray(stepData.treatment.management_items) ? stepData.treatment.management_items : [])
            ],
            procedures: [
              ...data.treatment.procedures,
              ...(Array.isArray(stepData.treatment.procedures) ? stepData.treatment.procedures : [])
            ],
            response: stepData.treatment.response || data.treatment.response,
            complications: [
              ...data.treatment.complications,
              ...(Array.isArray(stepData.treatment.complications) ? stepData.treatment.complications : [])
            ]
          };
        }
        if (stepData.provenance && typeof stepData.provenance === "object") {
          data.provenance = {
            ...data.provenance,
            ...stepData.provenance,
          };
        }

        // Merge pending_items (new LLM-based extraction) - only if step truly succeeded
        if (step.step === "pending_items_extractor" && step.success) {
          data.pending_items = stepData;
        } else if (stepData.pending_items) {
          data.pending_items = stepData.pending_items;
        }

        // Any remaining fields at top level
        Object.keys(stepData).forEach(key => {
          if (!['name', 'mrn', 'age', 'gender', 'admission_date', 'discharge_date', 'los_days',
               'bp', 'pulse', 'spo2', 'temperature', 'resp_rate', 'pain_score', 'grbs', 'abnormal_flags',
               'fall_risk', 'dvt_risk', 'pressure_ulcer_risk', 'aspiration_risk', 'ews_score', 'gcs',
               'functional_status', 'overall_assistance_needs', 'mobility_notes',
               'diagnosis', 'allergies', 'medications', 'investigations', 'nursing_needs', 'clinical_notes', 'treatment', 'provenance',
               'pending_items',
               'document_type', 'sections_identified', 'confidence', 'extraction_strategy',
               'confidence_notes', 'sources', 'validation_notes'].includes(key)) {
            data[key] = stepData[key];
          }
        });

        // Collect validation information
        if (step.validation) {
          if (step.validation.inconsistencies) {
            validation.inconsistencies_found.push(...step.validation.inconsistencies);
          }
          if (step.validation.missing) {
            validation.missing_critical_fields.push(...step.validation.missing);
          }
        }

        // Collect self-validation info
        if (step.selfValidation) {
          if (step.selfValidation.inconsistencies) {
            validation.inconsistencies_found.push(...step.selfValidation.inconsistencies);
          }
          if (step.selfValidation.missing) {
            validation.missing_critical_fields.push(...step.selfValidation.missing);
          }
        }
      }
    });

    // Clean up validation (remove duplicates)
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

    return { data, validation };
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
      toolsCount: 4, // pdf_reader, gemma_client, prompt_builder, provenance_builder
      config: this.config
    };
  }
}

module.exports = DischargeExtractorAgent;
