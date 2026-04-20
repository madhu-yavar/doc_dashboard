/**
 * Document Type Router
 * Automatically detects document type and routes to the appropriate extractor agent
 */

const DischargeExtractorAgent = require("./discharge_extractor_agent.cjs");
const OutpatientExtractorAgent = require("./outpatient_extractor_agent.cjs");
const LabReportExtractorAgent = require("./lab_report_extractor_agent.cjs");
const ChartNoteExtractorAgent = require("./chart_note_extractor_agent.cjs");
const PrescriptionReactExtractorAgent = require("./prescription_react_extractor_agent.cjs");

const PDFReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");
const HandwritingDetectorSkill = require("../skills/detection/handwriting_detector.skill.cjs");
const path = require("path");

class DocumentTypeRouter {
  constructor(config = {}) {
    this.config = {
      maxRetries: 1,
      timeoutPerStep: 30000,
      ...config
    };

    // Initialize all available agents
    this.agents = {
      discharge_summary: new DischargeExtractorAgent(config.gemma || {}),
      outpatient_record: new OutpatientExtractorAgent(config.gemma || {}),
      lab_report: new LabReportExtractorAgent(config.gemma || {}),
      chart_note: new ChartNoteExtractorAgent(config.gemma || {}),
      prescription: new PrescriptionReactExtractorAgent(config.qwen || {})
    };

    this.pdfReader = new PDFReaderTool(config);
    this.handwritingDetector = new HandwritingDetectorSkill(config.qwen || {});
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
   * FIX 1: Now accepts options object with pdfName parameter
   * FIX 3: Increased text window from 3000 to 12000 chars
   */
  async detectDocumentType(pdfPath, options = {}) {
    const { pdfName } = options;
    let pdfText = options.pdfText; // Use let so we can reassign
    // FIX 1: Use provided pdfName first, fall back to path extraction
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

    // Quick handwriting detection for prescription routing (skip if filename strongly suggests prescription)
    let hasHandwriting = false;
    if (filenameHints.prescription || prescriptionScore >= 2) {
      try {
        const handwritingCheck = await this.handwritingDetector.quickDetect(pdfPath);
        hasHandwriting = handwritingCheck.hasHandwriting;
      } catch (e) {
        // If handwriting detection fails, continue without it
        console.log("Handwriting detection failed, continuing with text analysis");
      }
    }

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
   * FIX 5: Added routing metadata for debugging
   */
  async process(pdfPath, options = {}) {
    const startTime = Date.now();
    const pdfName = options.pdfName || path.basename(pdfPath);
    const forceAgent = options.forceAgent; // Allow manual override

    // Track scores for debugging
    let debugScores = {};

    try {
      // Detect document type
      let detectedType;
      if (forceAgent) {
        detectedType = forceAgent;
        console.log(`\n🔀 Forced agent type: ${detectedType}`);
      } else {
        // FIX 1: Pass pdfName to detectDocumentType
        detectedType = await this.detectDocumentType(pdfPath, { pdfName });
        console.log(`\n🔀 Detected document type: ${detectedType}`);
      }

      // Get the appropriate agent
      const agent = this.agents[detectedType];
      if (!agent) {
        throw new Error(`No agent found for document type: ${detectedType}`);
      }

      console.log(`📋 Routing to: ${agent.name}`);

      // Process with the selected agent
      const result = await agent.process(pdfPath, {
        ...options,
        pdfName,
        detectedType
      });

      // FIX 5: Enhanced routing metadata for debugging
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
