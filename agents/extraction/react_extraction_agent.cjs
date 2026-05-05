/**
 * ReAct-Based Extraction Agent
 *
 * This agent:
 * 1. THINKs about what to extract based on document content
 * 2. ACTs by dynamically selecting and executing skills
 * 3. OBSERVEs results and decides next actions
 * 4. Scalable - new document types just need skill registration
 */

const BaseAgent = require("../core/base_agent.cjs");
const AgentState = require("../core/agent_state.cjs");
const { getSkillCategories, initializeSkill } = require("../core/skill_registry.cjs");
const { extractPDFText } = require("../core/tool_registry.cjs");
const pdfReader = require("../../tools/pdf/pdf_reader.tool.cjs");

class ReActExtractionAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      name: "ReActExtractionAgent",
      version: "1.0.0",
      maxIterations: 15,  // More iterations for multi-step extraction
      debug: config.debug || false,
      ...config
    });

    this.documentType = config.documentType || "discharge_summary";
    this.skillCategories = getSkillCategories(this.documentType);
    this.pdfReader = pdfReader;
  }

  /**
   * Initialize extraction state
   */
  async initialize(documentPath, documentName, options = {}) {
    const path = require("path");
    const name = documentName || path.basename(documentPath);

    // Pre-analyze document to understand what content exists
    const documentAnalysis = await this.analyzeDocumentContent(documentPath);

    return {
      documentPath,
      documentName: name,
      documentType: this.documentType,
      currentStep: "initialize",
      documentAnalysis,  // Used for skill selection
      extractedData: {},
      validationResults: {},
      skillsCompleted: [],
      skillsSkipped: [],
      config: { ...this.skillCategories.config, ...options }
    };
  }

  /**
   * Quick document analysis to determine which skills are needed
   */
  async analyzeDocumentContent(documentPath) {
    const textResult = await extractPDFText(documentPath, 3000);
    const text = textResult.text || "";
    const textLower = text.toLowerCase();

    return {
      hasDemographics: /\b(age|sex|gender|patient|mrn|name)\b/i.test(text),
      hasVitals: /\b(bp|blood pressure|pulse|temperature|temp|spo2|weight|height)\b/i.test(text),
      hasRiskScores: /\b(fall risk|dvt risk|braden|pressure ulcer|ews)\b/i.test(text),
      hasFunctionalStatus: /\b(mobility|ambulation|adl|activities of daily living)\b/i.test(text),
      hasDiagnosis: /\b(diagnosis|assessment|provisional)\b/i.test(text),
      hasMedications: /\b(rx|medication|tab|cap|syrup|injection|od|bd|tds)\b/i.test(text),
      hasDoctorInfo: /\b(dr\.|doctor|consultant)\b/i.test(text),
      hasPendingItems: /\b(pending|recommended|suggested|advised)\b/i.test(text),
      textLength: text.length,
      textSample: text.substring(0, 500)
    };
  }

  /**
   * THINK: Decide which skill to execute next
   *
   * This is where the ReAct magic happens - the agent reasons about:
   * - What skills are required vs optional
   * - Which optional skills should run based on document content
   * - What order to run skills in
   * - When to move to validation
   */
  async think(state) {
    const s = state.state;
    const analysis = s.documentAnalysis || {};
    const completed = s.skillsCompleted || [];
    const skipped = s.skillsSkipped || [];
    const processed = [...completed, ...skipped];  // Skills that are either completed or skipped
    const extracted = s.extractedData || {};

    // Ensure arrays exist
    s.skillsCompleted = s.skillsCompleted || [];
    s.skillsSkipped = s.skillsSkipped || [];

    // Phase 1: Run required skills first
    for (const skillConfig of this.skillCategories.required) {
      const skillName = skillConfig.name;
      if (!processed.includes(skillName)) {
        return {
          reasoning: `Running required skill: ${skillName}`,
          action: {
            tool: "execute_skill",
            params: { skillConfig, phase: "required" }
          },
          shouldContinue: true
        };
      }
    }

    // Phase 2: Run optional skills based on document content
    for (const skillConfig of this.skillCategories.optional) {
      const skillName = skillConfig.name;
      if (!processed.includes(skillName)) {
        // Check if condition is met
        const condition = skillConfig.condition;
        if (this.shouldRunSkill(condition, analysis, extracted)) {
          return {
            reasoning: `Running optional skill ${skillName} (condition met: ${condition})`,
            action: {
              tool: "execute_skill",
              params: { skillConfig, phase: "optional" }
            },
            shouldContinue: true
          };
        } else {
          // Skip this skill
          s.skillsSkipped.push(skillName);

          return {
            reasoning: `Skipping optional skill ${skillName} (condition not met: ${condition})`,
            action: null,
            shouldContinue: true
          };
        }
      }
    }

    // Phase 3: Validation
    for (const skillConfig of this.skillCategories.validation) {
      const skillName = skillConfig.name;
      if (!processed.includes(skillName)) {
        return {
          reasoning: `Running validation: ${skillName}`,
          action: {
            tool: "execute_skill",
            params: { skillConfig, phase: "validation" }
          },
          shouldContinue: true
        };
      }
    }

    // All skills complete
    return {
      reasoning: `Extraction complete. Ran ${completed.length} skills, skipped ${s.skillsSkipped?.length || 0}.`,
      action: null,
      shouldContinue: false,
      provisionalType: "extraction_complete"
    };
  }

  /**
   * Check if a skill should run based on conditions
   */
  shouldRunSkill(condition, analysis, extracted) {
    if (!condition) return true;

    const conditions = condition.split("|").map(c => c.trim());

    for (const cond of conditions) {
      switch (cond) {
        case "has_vitals":
          if (analysis.hasVitals) return true;
          break;
        case "has_risk_scores":
          if (analysis.hasRiskScores) return true;
          break;
        case "has_functional_status":
          if (analysis.hasFunctionalStatus) return true;
          break;
        case "has_diagnosis":
          if (analysis.hasDiagnosis) return true;
          break;
        case "has_medications":
          if (analysis.hasMedications) return true;
          break;
        case "has_doctor_info":
          if (analysis.hasDoctorInfo) return true;
          break;
        case "has_pending_items":
          if (analysis.hasPendingItems) return true;
          break;
        default:
          // Unknown condition - run the skill anyway
          return true;
      }
    }

    return false;
  }

  /**
   * Override executeTool to handle skill execution
   */
  async executeTool(toolName, params = {}) {
    if (toolName === "execute_skill") {
      const { skillConfig, phase } = params;
      const skillName = skillConfig.name;
      const SkillClass = skillConfig.skill;

      this.log(`Executing ${phase} skill: ${skillName}`);

      const startTime = Date.now();
      try {
        // Initialize skill
        const skill = initializeSkill(SkillClass, this.config);

        // Build context
        const context = this.buildContext(params, skillName);

        // Execute skill
        const result = await skill.execute(context);
        const duration = Date.now() - startTime;

        // Mark progress
        if (context.onProgress) {
          context.onProgress({
            type: "step_complete",
            step: skillName,
            phase,
            duration,
            success: result.success,
            data: {
              tokens: result.usage?.totalTokens || 0,
              dataKeys: result.data ? Object.keys(result.data) : []
            }
          });
        }

        return {
          success: true,
          result: {
            skillName,
            phase,
            data: result.data || result,
            success: result.success,
            usage: result.usage
          },
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

    return await super.executeTool(toolName, params);
  }

  /**
   * Build execution context for a skill
   */
  buildContext(params, skillName) {
    const state = this.state || {};
    const s = state.state || {};

    return {
      filePath: s.documentPath,
      pdfText: s.documentAnalysis?.textSample || "",
      extractedData: s.extractedData || {},
      onProgress: (progress) => {
        this.log(`[${skillName}]`, progress);
      }
    };
  }

  /**
   * Override execute to handle skill results properly
   */
  async execute(initialState) {
    const state = new AgentState(initialState);
    this.state = state;  // Store reference for buildContext

    this.log(`Starting ${this.name} for ${this.documentType}`, {
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
        const toolName = thought.action.tool;
        state.addAction(toolName, thought.action.params);

        // Check if this is just a skip action
        if (thought.action.tool === "execute_skill") {
          const params = this.normalizeParams(toolName, thought.action.params, state);
          const toolResult = await this.executeTool(toolName, params);
          state.addObservation(`Result of ${toolName}`, toolResult);

          // Merge extracted data
          if (toolResult.success && toolResult.result?.data) {
            state.state.extractedData = {
              ...state.state.extractedData,
              ...toolResult.result.data
            };
            state.setToolResult(toolName, toolResult);
          }

          // Track completed skills
          if (toolResult.result?.skillName) {
            state.state.skillsCompleted = state.state.skillsCompleted || [];
            state.state.skillsCompleted.push(toolResult.result.skillName);
          }
        } else {
          // Skip action - no tool execution
          state.addObservation("Skipped", { reason: thought.reasoning });
        }
      }

      if (!thought.shouldContinue) {
        // Finalize results
        const finalResult = this.mergeResults(state);
        state.complete({
          documentType: this.documentType,
          confidence: 1.0,
          reasoning: thought.reasoning,
          classificationReason: "react_extraction",
          ...finalResult
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

  /**
   * Merge all skill results into final output
   */
  mergeResults(state) {
    const s = state.state;
    const extracted = s.extractedData || {};
    const validation = s.validationResults || {};

    // Build dashboard format from extracted data
    const dashboardFormat = this.buildDashboardFormat(extracted, s.documentType);

    return {
      data: extracted,
      dashboard: dashboardFormat,
      metadata: {
        skillsCompleted: s.skillsCompleted || [],
        skillsSkipped: s.skillsSkipped || [],
        documentType: this.documentType,
        extractionMethod: "react_agent"
      }
    };
  }

  /**
   * Build dashboard format from extracted data
   */
  buildDashboardFormat(extracted, documentType) {
    // Common transformations
    const format = {
      patient: extracted.patient || extracted.demographics || {},
      diagnosis: extracted.diagnosis || extracted.clinical_data?.diagnosis || {},
      medications: extracted.medications || [],
      doctor: extracted.doctor || {},
      visit: extracted.visit || extracted.clinical_data?.visit || {},
      vitals: extracted.vitals || {},
      notes: extracted.notes || {}
    };

    // Document-type specific formatting
    if (documentType === "discharge_summary" || documentType === "inpatient_record") {
      format.riskScores = extracted.risk_scores || [];
      format.functionalStatus = extracted.functional_status || {};
    }

    if (documentType === "prescription") {
      // Prescription-specific formatting
      format.prescription = {
        patient: extracted.patient || {},
        medications: extracted.medications || [],
        diagnosis: extracted.diagnosis || {},
        doctor: extracted.doctor || {}
      };
    }

    return format;
  }

  /**
   * Main extraction entry point
   */
  async extract(documentPath, documentName, options = {}) {
    const initialState = await this.initialize(documentPath, documentName, options);
    return await this.execute(initialState);
  }
}

module.exports = ReActExtractionAgent;
