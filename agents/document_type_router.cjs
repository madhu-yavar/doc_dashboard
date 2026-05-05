/**
 * Document Type Router
 * Automatically detects document type and routes to the appropriate extractor agent
 *
 * ENHANCED: Now supports agentic classification option
 */

const DischargeExtractorAgent = require("./discharge_extractor_agent.cjs");
const OutpatientExtractorAgent = require("./outpatient_extractor_agent.cjs");
const LabReportExtractorAgent = require("./lab_report_extractor_agent.cjs");
const ChartNoteExtractorAgent = require("./chart_note_agent.cjs");
const PrescriptionReactExtractorAgent = require("./prescription_react_extractor_agent.cjs");

// NEW: Two-Stage Prescription Agent (Gemma + Gemini)
const PrescriptionTwoStageAgent = require("./prescription_two_stage_agent.cjs");

// NEW: Agentic classifier and extraction
const DocumentClassifierAgent = require("./extraction/document_classifier_agent.cjs");
const ReActExtractionAgent = require("./extraction/react_extraction_agent.cjs");

const PDFReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");
const path = require("path");

class DocumentTypeRouter {
  constructor(config = {}) {
    this.config = {
      maxRetries: 1,
      timeoutPerStep: 30000,
      // DEFAULT to agentic classification - it's more accurate!
      useAgenticClassification: config.useAgenticClassification ?? true,
      useAgenticExtraction: config.useAgenticExtraction ?? process.env.USE_AGENTIC_EXTRACTION === "true",
      ...config
    };

    // Initialize all available agents (existing)
    this.agents = {
      discharge_summary: new DischargeExtractorAgent(config),
      inpatient_record: new DischargeExtractorAgent({
        ...config,
        enableDocumentAnalyzer: false,
        enablePendingItemsExtraction: false,
      }),
      outpatient_record: new OutpatientExtractorAgent(config),
      lab_report: new LabReportExtractorAgent(config),
      chart_note: new ChartNoteExtractorAgent(config),
      prescription: new PrescriptionReactExtractorAgent(config)
    };

    // Initialize two-stage prescription agent (new)
    this.prescriptionTwoStageAgent = new PrescriptionTwoStageAgent({
      gemma: config.gemma || {},
      geminiModel: config.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash",
      handwritingThreshold: config.handwritingThreshold || 15
    });

    // Initialize agentic classifier - pass config correctly
    this.agenticClassifier = new DocumentClassifierAgent({
      debug: config.debug || false,
      // Map from router's config to classifier's expected parameter names
      gemmaUrl: config.gemma?.baseUrl || process.env.GEMMA_URL,
      gemmaModel: config.gemma?.model || process.env.GEMMA_MODEL,
      timeout: config.gemma?.timeout
    });

    this.pdfReader = new PDFReaderTool(config);
  }

  /**
   * Get classification reason for debugging
   */
  getClassificationReason(detectedType, scores) {
    const { labScore, noteScore, opdScore, dischargeScore, prescriptionScore, hasInpatientRiskSignals, hasChartNoteStructure, hasHandwriting } = scores;
    const reasons = {
      lab_report: labScore >= 2 ? `lab_score_${labScore}` : "filename",
      chart_note: noteScore >= 2 ? `note_score_${noteScore}` : (hasChartNoteStructure ? "chart_note_structure" : "filename"),
      outpatient_record: opdScore >= 2 ? `opd_score_${opdScore}` : "filename",
      discharge_summary: dischargeScore >= 2 ? `discharge_score_${dischargeScore}` : (hasInpatientRiskSignals ? "inpatient_risk_signals" : "filename_or_default"),
      prescription: prescriptionScore >= 2 ? `prescription_score_${prescriptionScore}` : (hasHandwriting ? "handwriting_detected" : "filename")
    };
    return reasons[detectedType] || "unknown";
  }

  /**
   * Detect document type from filename or content
   *
   * ENHANCED: Supports agentic classification (more accurate, slower)
   *
   * @param {string} pdfPath - Path to PDF file
   * @param {object} options - Options
   * @param {string} options.pdfName - Document name
   * @param {boolean} options.useAgentic - Override to use agentic classification
   * @param {string} options.pdfText - Pre-extracted text (skip OCR)
   * @returns {Promise<string>} Document type
   */
  async detectDocumentType(pdfPath, options = {}) {
    const { pdfName, useAgentic, pdfText: providedText } = options;
    let pdfText = providedText;

    // NEW: Use agentic classifier if enabled
    const shouldUseAgentic = useAgentic ?? this.config.useAgenticClassification;

    if (shouldUseAgentic) {
      console.log("\n🤖 Using Agentic Classifier...");
      const result = await this.agenticClassifier.classify(pdfPath, pdfName);

      if (result.documentType && result.confidence > 0.7) {
        console.log(`   ✓ Classified as: ${result.documentType} (${(result.confidence * 100).toFixed(0)}% confidence)`);
        console.log(`   Reasoning: ${result.reasoning?.substring(0, 100)}...`);
        return result.documentType;
      }

      console.log(`   ⚠ Low confidence (${(result.confidence * 100).toFixed(0)}%), falling back to rule-based...`);
    }

    // FALLBACK: Rule-based classification
    // This serves as a backup when:
    // 1. Agentic classification is disabled
    // 2. Agentic classification has low confidence
    // 3. Gemma LLM is unavailable
    // Note: This intentionally duplicates some logic from the agentic classifier for resilience
    const fileName = (pdfName || pdfPath.split("/").pop()).toLowerCase();

    // Filename-based HINTS (not absolute - content can override)
    const filenameHints = {
      prescription: fileName.includes("prescription") || fileName.includes("rx") || fileName.includes("medication") || fileName.includes("doxper"),
      lab_report: fileName.includes("lab") || fileName.includes("investigation") || (fileName.includes("report") && fileName.includes("lab")),
      chart_note: fileName.includes("chart") || fileName.includes("note") || fileName.includes("progress"),
      outpatient_record: fileName.includes("opd") || fileName.includes("outpatient") || fileName.includes("clinic"),
      discharge_summary: fileName.includes("discharge") || fileName.includes("inpatient")
    };

    // Content-based detection - read PDF content
    if (!pdfText) {
      // FIX 3: Increased from 3000 to 12000 chars for better content analysis
      const pdfResult = await this.pdfReader.execute(pdfPath, 12000);
      if (pdfResult.success) {
        pdfText = pdfResult.text;
      }
    }

    if (!pdfText || pdfText.length < 200) {
      // No content available, fall back to filename hints
      if (filenameHints.prescription) return "prescription";
      if (filenameHints.lab_report) return "lab_report";
      if (filenameHints.chart_note) return "chart_note";
      if (filenameHints.outpatient_record) return "outpatient_record";
      if (filenameHints.discharge_summary) return "discharge_summary";
      return "discharge_summary"; // Default
    }

    const textLower = pdfText.toLowerCase();

    // Prescription indicators
    const prescriptionIndicators = [
      "prescription", "rx", "medication", "dosage", "frequency", "sig:",
      "tab.", "cap.", "inj.", "syrup", "od", "bd", "tds", "qid", "sos",
      "take", "after meal", "before meal", "at bedtime", "three times", "twice daily"
    ];
    const prescriptionScore = prescriptionIndicators.filter(indicator => textLower.includes(indicator)).length;

    // Lab report indicators
    const labIndicators = [
      "lab results", "laboratory report", "test result", "cbc", "hemoglobin",
      "wbc count", "platelet count", "serum", "reference range", "normal range"
    ];
    const labScore = labIndicators.filter(indicator => textLower.includes(indicator)).length;

    // Chart note indicators
    const noteIndicators = [
      "progress note", "resident note", "consultation note", "nursing note",
      "subjective:", "objective:", "assessment:", "plan:", "soap note",
      "chart note"
    ];
    const noteScore = noteIndicators.filter(indicator => textLower.includes(indicator)).length;

    // Outpatient indicators
    const opdIndicators = [
      "opd", "outpatient", "clinic visit", "consultation", "walk-in",
      "chief complaint", "presenting complaint"
    ];
    const opdScore = opdIndicators.filter(indicator => textLower.includes(indicator)).length;

    // Discharge summary indicators
    const dischargeIndicators = [
      "discharge summary", "discharge planning", "discharge medication",
      "fall risk", "pressure ulcer", "braden scale", "dvt risk", "ews score"
    ];
    const dischargeScore = dischargeIndicators.filter(indicator => textLower.includes(indicator)).length;

    // FIX 4: Add negative/override rules - check BEFORE score comparisons
    const hasInpatientRiskSignals = /fall risk|dvt risk|pressure ulcer|braden scale|ews score|early warning/i.test(pdfText);
    const hasChartNoteStructure = /progress note|resident note|consultation note|nursing note|chart note/i.test(pdfText);
    const hasDischargeKeywords = /discharge summary|discharge planning|discharge medication/i.test(pdfText);
    const hasExplicitChartNote = /\bchart note\b/i.test(pdfText); // Exact "chart note" phrase

    // Quick handwriting detection for prescription routing
    // NOTE: Using filename-based detection since Qwen handwriting detector removed
    // Future: Use Gemini or Gemma-based handwriting detection
    let hasHandwriting = filenameHints.prescription || filenameHints.doxper;

    // Filename hint for "prescription" or "doxper" is very strong
    if (filenameHints.prescription) {
      return "prescription";
    }

    // Filename hint for "chart-note" or "chart note" is very strong - prioritize it
    if (filenameHints.chart_note || hasExplicitChartNote) {
      return "chart_note";
    }

    // Explicit discharge keywords always win (highest specificity)
    if (hasDischargeKeywords) {
      return "discharge_summary";
    }

    // Inpatient risk signals usually indicate discharge summary (not standalone chart note)
    if (hasInpatientRiskSignals) {
      return "discharge_summary";
    }

    // FIX 2: Reordered decision rules - prescription and discharge before OPD
    // Determine winner based on scores
    if (prescriptionScore >= 2) return "prescription";  // Highest priority for medications
    if (labScore >= 2) return "lab_report";
    if (noteScore >= 2) return "chart_note";
    if (dischargeScore >= 2) return "discharge_summary";  // Higher priority now
    if (opdScore >= 2) return "outpatient_record";       // Require >= 2 instead of >= 1

    // Count structured form elements (legacy check, kept for safety)
    const hasRiskScores = /fall risk|dvt risk|pressure ulcer|braden|ews/i.test(pdfText);
    const hasRiskTables = /score\s*[:]\s*\d+/i.test(pdfText);
    const hasMultipleVitals = (pdfText.match(/bp\s*[:]/gi) || []).length > 2;

    if (hasRiskScores && hasRiskTables) {
      return "discharge_summary";
    }

    // If scores are tied/low, use filename hints as tiebreaker
    // But give priority to prescription/discharge/chart over outpatient if filename is ambiguous
    if (filenameHints.prescription) return "prescription";
    if (filenameHints.discharge_summary && !filenameHints.outpatient_record) return "discharge_summary";
    if (filenameHints.chart_note && !filenameHints.outpatient_record) return "chart_note";
    if (filenameHints.lab_report && !filenameHints.outpatient_record) return "lab_report";
    if (filenameHints.outpatient_record && opdScore >= 1) return "outpatient_record";

    // Default to discharge summary (most comprehensive agent)
    return "discharge_summary";
  }

  /**
   * Route document to appropriate agent based on type detection
   *
   * ENHANCED: Supports agentic extraction option
   *
   * @param {string} pdfPath - Path to PDF file
   * @param {object} options - Options
   * @param {boolean} options.useAgenticExtraction - Use ReAct extraction agent
   * @param {string} options.forceAgent - Force specific agent
   * @returns {Promise<object>} Extraction result
   */
  async process(pdfPath, options = {}) {
    const startTime = Date.now();
    const pdfName = options.pdfName || path.basename(pdfPath);
    const forceAgent = options.forceAgent;
    const useAgenticExtraction = options.useAgenticExtraction ?? this.config.useAgenticExtraction;

    try {
      // Detect document type
      let detectedType;
      if (forceAgent) {
        detectedType = forceAgent;
        console.log(`\n🔀 Forced agent type: ${detectedType}`);
      } else {
        detectedType = await this.detectDocumentType(pdfPath, { pdfName, ...options });
        console.log(`\n🔀 Detected document type: ${detectedType}`);
      }

      // NEW: Use agentic extraction if enabled
      if (useAgenticExtraction) {
        console.log(`🤖 Using ReAct Extraction Agent for ${detectedType}...`);

        const reactAgent = new ReActExtractionAgent({
          documentType: detectedType,
          debug: options.debug || false,
          ...options.config
        });

        const result = await reactAgent.extract(pdfPath, pdfName, options);

        // Add routing metadata
        if (result) {
          result.meta = result.meta || {};
          result.meta.router = {
            detected_type: detectedType,
            router_version: "2.0.0-agentic",
            confidence: "high",
            filename_used: pdfName,
            extraction_method: "react_agent"
          };
        }

        return result;
      }

      // Use existing agents (backwards compatible)
      // SPECIAL CASE: Use two-stage agent for prescriptions
      let agent;
      if (detectedType === "prescription" && !useAgenticExtraction) {
        console.log(`📋 Routing to Two-Stage Prescription Agent...`);
        agent = this.prescriptionTwoStageAgent;
      } else {
        console.log(`📋 Routing to existing agent: ${this.agents[detectedType]?.name || detectedType}`);
        agent = this.agents[detectedType];
      }

      if (!agent) {
        throw new Error(`No agent found for document type: ${detectedType}`);
      }

      // Process with the selected agent
      const result = await agent.process(pdfPath, {
        ...options,
        pdfName,
        detectedType
      });

      // Add routing metadata
      if (result.success && result.data) {
        result.data.meta = result.data.meta || {};
        result.data.meta.router = {
          detected_type: detectedType,
          router_version: "1.0.0",
          confidence: forceAgent ? "forced" : "auto-detected",
          filename_used: pdfName
        };
      }

      return result;

    } catch (error) {
      console.error(`❌ Document routing failed: ${error.message}`);

      // Fallback to discharge summary agent
      console.log(`🔄 Falling back to discharge summary agent...`);
      try {
        const fallbackResult = await this.agents.discharge_summary.process(pdfPath, options);
        if (fallbackResult.success && fallbackResult.data) {
          fallbackResult.data.meta = fallbackResult.data.meta || {};
          fallbackResult.data.meta.router = {
            detected_type: "discharge_summary",
            router_version: "1.0.0",
            confidence: "fallback",
            filename_used: pdfName,
            original_error: error.message
          };
        }
        return fallbackResult;
      } catch (fallbackError) {
        return {
          success: false,
          error: `Routing failed: ${error.message}. Fallback also failed: ${fallbackError.message}`,
          data: null
        };
      }
    }
  }

  /**
   * Get available agent types
   */
  getAvailableTypes() {
    return Object.keys(this.agents).map(key => ({
      type: key,
      agent: this.agents[key].name,
      description: this.agents[key].documentType || "Standard extraction"
    }));
  }

  /**
   * Get router status (for compatibility with discharge extractor interface)
   */
  getStatus() {
    return {
      name: this.name,
      version: this.version,
      type: this.type,
      routerType: "DocumentTypeRouter",
      availableAgents: Object.keys(this.agents),
      config: this.config
    };
  }
}

module.exports = DocumentTypeRouter;
