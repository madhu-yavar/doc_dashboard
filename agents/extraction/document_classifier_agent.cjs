/**
 * Document Classifier Agent - Enhanced Version
 * Properly distinguishes prescription from outpatient based on:
 * - OPD forms WITH handwriting → prescription
 * - OPD forms WITHOUT handwriting → outpatient_record
 * - IPD forms → inpatient/discharge
 * - Prescription pads → prescription
 */

const BaseAgent = require("../core/base_agent.cjs");
const AgentState = require("../core/agent_state.cjs");
const { TOOL_REGISTRY } = require("../core/tool_registry.cjs");
const GemmaVisionClient = require("../../tools/llm/gemma_vision_client.tool.cjs");

class DocumentClassifierAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      name: "DocumentClassifier",
      version: "3.0.0",
      maxIterations: 6,
      debug: config.debug || false,
      ...config
    });

    this.registerTools();
    this.visionClient = new GemmaVisionClient({
      baseUrl: config.gemmaUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions",
      model: config.gemmaModel || process.env.GEMMA_MODEL || "google/gemma-4-31B-it"
    });
  }

  registerTools() {
    for (const [name, tool] of Object.entries(TOOL_REGISTRY)) {
      this.registerTool(name, tool);
    }
  }

  /**
   * Enhanced classification prompt that understands the nuance
   */
  buildClassificationPrompt(imagePath, ocrText, handwritingResult) {
    const handwritingContext = handwritingResult?.hasHandwriting
      ? "HANDWRITING DETECTED: This document contains handwritten content."
      : "NO HANDWRITING DETECTED.";

    return `You are a medical document classification expert. Classify based PRIMARILY on the document header/form type.

DOCUMENT TYPES:

1. **prescription** - Choose this if:
   - Header says "OUTPATIENT RECORD" or "OPD" AND the document contains HANDWRITTEN text
   - OR Header explicitly says "PRESCRIPTION", "Rx", or "MEDICATION"
   - Key: OPD form WITH handwriting = prescription (doctor handwritten inputs)

2. **outpatient_record** - Choose this if:
   - Header says "OUTPATIENT RECORD" or "OPD" AND the document has NO handwriting
   - Clean, printed or typed outpatient visit record
   - Key: OPD form WITHOUT handwriting = outpatient record

3. **inpatient_record** - Choose this if:
   - Header says "INPATIENT RECORD", "IPD", "Inpatient Case Paper"
   - May contain "IPD No." in header
   - Key: The header indicates inpatient admission

4. **discharge_summary** - Choose if:
   - Header says "DISCHARGE SUMMARY" or "DISCHARGE REPORT"
   - Document is a formal discharge document from inpatient stay
   - Often contains discharge planning, discharge medications

5. **lab_report** - Choose if:
   - Laboratory test results document
   - Contains values with reference ranges

6. **chart_note** - Choose if:
   - Progress notes, SOAP notes, nursing notes
   - Subjective/Objective/Assessment/Plan structure

${handwritingContext}

OCR TEXT (if available):
${ocrText?.substring(0, 1000) || "No OCR text available"}

ANALYSIS INSTRUCTIONS:
1. Check the HEADER first for form type (OPD, IPD, PRESCRIPTION, etc.)
2. For OPD forms: Check handwriting status
   - OPD + HANDWRITING → prescription
   - OPD + NO HANDWRITING → outpatient_record
3. For other headers: Use header to determine type
4. Content (medications, advice, labs) does NOT override header+handwriting rule

Return JSON only:
{
  "type": "one_of: prescription, outpatient_record, inpatient_record, discharge_summary, lab_report, chart_note",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation based on header and handwriting",
  "indicators": ["key1", "key2"],
  "has_handwriting": boolean,
  "form_type": "OPD/IPD/Prescription/Discharge/Lab/Other"
}`;
  }

  /**
   * Fixed workflow with enhanced logic
   */
  async think(state) {
    const s = state.state;
    const used = s.toolsUsed;

    // Step 1: Convert first page to image
    if (!used.includes("convert_first_page")) {
      return {
        reasoning: "Step 1: Convert first page to image for visual analysis",
        action: { tool: "convert_first_page", params: { pdfPath: s.documentPath } },
        shouldContinue: true
      };
    }

    // Step 2: Extract text
    if (!used.includes("extract_text")) {
      return {
        reasoning: "Step 2: Extract text content for header/keyword analysis",
        action: { tool: "extract_text", params: { pdfPath: s.documentPath, maxLength: 5000 } },
        shouldContinue: true
      };
    }

    // Step 3: Classify with LLM (handwriting detection moved to two-stage agent)
    if (!used.includes("classify_with_llm")) {
      const imagePath = s.toolResults.convert_first_page?.result?.imagePath;
      const text = s.toolResults.extract_text?.result?.text || "";
      // Handwriting detection removed - handled by two-stage prescription agent
      const handwriting = null;

      if (!imagePath) {
        return {
          reasoning: "Image conversion failed, using text-based fallback",
          action: null,
          shouldContinue: false,
          provisionalType: this.classifyByText(text),
          provisionalConfidence: 0.6
        };
      }

      return {
        reasoning: "Step 3: Classify with LLM considering document structure",
        action: {
          tool: "classify_with_llm",
          params: { imagePath, ocrText: text }
        },
        shouldContinue: true
      };
    }

    // Step 4: Have classification result
    const llmResult = s.toolResults.classify_with_llm;
    if (llmResult && llmResult.success) {
      const classification = llmResult.result;
      const conf = classification?.confidence || 0;

      // Post-processing: Override if we detect IPD
      const text = s.toolResults.extract_text?.result?.text || "";
      if (/ipd no\.|inpatient case paper|inpatient record/i.test(text)) {
        if (classification?.type !== "inpatient_record" && classification?.type !== "discharge_summary") {
          return {
            reasoning: "Overriding: Document has IPD header, classifying as inpatient_record",
            action: null,
            shouldContinue: false,
            provisionalType: "inpatient_record",
            provisionalConfidence: 0.95
          };
        }
      }

      if (conf >= 0.7) {
        return {
          reasoning: classification?.reasoning || `High confidence: ${classification?.type}`,
          action: null,
          shouldContinue: false,
          provisionalType: classification?.type,
          provisionalConfidence: conf
        };
      }
    }

    // Default: return best available
    const defaultClassification = llmResult?.result || {};
    return {
      reasoning: "Classification complete",
      action: null,
      shouldContinue: false,
      provisionalType: defaultClassification?.type || this.classifyByText(s.toolResults.extract_text?.result?.text || ""),
      provisionalConfidence: defaultClassification?.confidence || 0.5
    };
  }

  /**
   * Override executeTool to handle our custom classification
   */
  async executeTool(toolName, params = {}) {
    if (toolName === "classify_with_llm") {
      this.log(`Executing enhanced LLM classification`);

      const prompt = this.buildClassificationPrompt(
        params.imagePath,
        params.ocrText,
        params.handwriting
      );

      const startTime = Date.now();
      try {
        const result = await this.visionClient.executeJSON(prompt, {
          images: [params.imagePath],
          temperature: 0.1,
          maxTokens: 500
        });

        const duration = Date.now() - startTime;

        // Map the result
        const classification = {
          type: result.data?.type || "unknown",
          confidence: result.data?.confidence || 0.5,
          reasoning: result.data?.reasoning || "",
          indicators: result.data?.indicators || [],
          hasHandwriting: result.data?.has_handwriting || false,
          formType: result.data?.form_type || ""
        };

        return {
          success: true,
          result: classification,
          duration,
          tool: toolName
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          duration: Date.now() - startTime,
          tool: toolName
        };
      }
    }

    // Use default tool execution for other tools
    return await super.executeTool(toolName, params);
  }

  /**
   * Enhanced text-only classification
   */
  classifyByText(text) {
    const t = text.toLowerCase();

    // Check for IPD first
    if (/ipd no\.|inpatient case paper|inpatient record/i.test(t)) {
      return "inpatient_record";
    }

    // Check for discharge summary keywords
    if (/discharge summary|discharge planning|fall risk|dvt risk|braden scale/i.test(t)) {
      return "discharge_summary";
    }

    // Check for lab report
    if (/lab result|hemoglobin|wbc.*count|platelet.*count|reference range|normal range/i.test(t)) {
      return "lab_report";
    }

    // Check for chart note
    if (/progress note|soap note|subjective:|objective:|assessment:|plan:/i.test(t)) {
      return "chart_note";
    }

    // Check for prescription indicators
    if (/rx\s*|prescription|medication|dosage|tab\.|syrup|injection\./i.test(t)) {
      return "prescription";
    }

    // Default to outpatient_record for OPD forms
    if (/opd|outpatient|out patient/i.test(t)) {
      return "outpatient_record";
    }

    return "discharge_summary"; // Default
  }

  async shouldContinue(state) {
    const s = state.state;

    if (s.errors.length >= s.maxRetries) {
      return {
        continue: false,
        result: {
          documentType: "unknown",
          confidence: 0,
          error: "Max retries exceeded",
          classificationReason: "error"
        }
      };
    }

    return { continue: true };
  }

  async execute(initialState) {
    const state = new AgentState(initialState);

    this.log(`Starting ${this.name} execution`, {
      document: state.state.documentName
    });

    let iteration = 0;

    while (iteration < this.maxIterations && !state.state.isComplete) {
      iteration++;
      this.log(`Iteration ${iteration}/${this.maxIterations}`);

      const thought = await this.think(state);
      state.addThought(thought.reasoning);
      this.log("Thought:", thought.reasoning);

      if (thought.action && thought.action.tool) {
        state.addAction(thought.action.tool, thought.action.params);
        const params = this.normalizeParams(thought.action.tool, thought.action.params, state);
        const toolResult = await this.executeTool(thought.action.tool, params);
        state.addObservation(`Result of ${thought.action.tool}`, toolResult);
        state.setToolResult(thought.action.tool, toolResult);
      }

      if (!thought.shouldContinue) {
        state.complete({
          documentType: thought.provisionalType,
          confidence: thought.provisionalConfidence,
          reasoning: thought.reasoning,
          classificationReason: "agent_workflow_v3"
        });
        break;
      }

      if (iteration >= this.maxIterations) {
        state.addError(new Error("Max iterations reached"), { iterations: iteration });
      }
    }

    const summary = state.getSummary();
    this.log(`Execution complete`, summary);

    return state.toJSON();
  }

  async classify(documentPath, documentName) {
    const path = require("path");
    const name = documentName || path.basename(documentPath);
    const initialState = {
      documentPath,
      documentName: name,
      currentStep: "initialize",
      firstPageOnly: true
    };
    return await this.execute(initialState);
  }
}

module.exports = DocumentClassifierAgent;
