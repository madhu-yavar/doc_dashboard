/**
 * Agents Registry
 * Central catalog of all agents with their tool/skill bindings
 */

module.exports = {
  registryVersion: "1.0.0",
  lastUpdated: "2026-04-04",

  agents: {
    // Option B: Thinking/ReAct Agent
    discharge_extractor_agent: {
      id: "discharge_extractor_agent",
      name: "Discharge Summary Extractor (Option B - Thinking/ReAct)",
      version: "2.0.0",
      type: "thinking_agent",
      description: "Multi-step extraction with validation for discharge summaries",
      handler: "../agents/discharge_extractor_agent.cjs",

      // Tools this agent can use
      tools: [
        "pdf_reader",
        "gemma_client",
        "prompt_builder"
      ],

      // Skills this agent uses (in sequence)
      skills: [
        "document_analyzer",
        "demographics_extractor",
        "risk_scores_extractor",
        "vitals_extractor",
        "functional_status_extractor",
        "clinical_data_extractor",
        "cross_validator"
      ],

      // Agent configuration
      config: {
        maxRetries: 2,
        timeoutPerStep: 60000,
        totalTimeout: 300000,
        requireAllSteps: false, // Continue even if some steps fail
        logSteps: true,
        saveIntermediates: true
      }
    },

    // Lightweight Option A Agent (for quick pre-processing)
    quick_extractor_agent: {
      id: "quick_extractor_agent",
      name: "Quick Extractor (Option A - Single-Shot)",
      version: "1.0.0",
      type: "single_shot_agent",
      description: "Fast single-shot extraction for simple cases",
      handler: "../agents/quick_extractor_agent.cjs",

      tools: [
        "pdf_reader",
        "gemma_client"
      ],

      skills: [], // No multi-step skills

      config: {
        maxRetries: 1,
        timeout: 60000,
        singlePrompt: true
      }
    },

    // Risk Validation Agent (specialized)
    risk_validator_agent: {
      id: "risk_validator_agent",
      name: "Risk Score Validator",
      version: "1.0.0",
      type: "validation_agent",
      description: "Specialized agent for validating risk scores",
      handler: "../agents/risk_validator_agent.cjs",

      tools: [
        "fall_risk_calculator",
        "dvt_risk_calculator",
        "pressure_ulcer_calculator",
        "aspiration_risk_calculator",
        "gemma_client"
      ],

      skills: [
        "inconsistency_detector",
        "risk_interpreter"
      ],

      config: {
        validateScores: ["fall", "dvt", "pressure_ulcer", "aspiration"],
        crossReferenceSections: true
      }
    },

    // Clinical Interpretation Agent
    clinical_reasoner_agent: {
      id: "clinical_reasoner_agent",
      name: "Clinical Reasoner",
      version: "1.0.0",
      type: "reasoning_agent",
      description: "Provides clinical interpretation of extracted data",
      handler: "../agents/clinical_reasoner_agent.cjs",

      tools: [
        "vitals_interpreter",
        "ews_calculator",
        "gcs_calculator",
        "gemma_client"
      ],

      skills: [
        "vitals_interpreter",
        "risk_interpreter"
      ],

      config: {
        addClinicalFlags: true,
        generateSummary: true
      }
    }
  },

  // Helper methods
  getAgent(id) {
    return this.agents[id] || null;
  },

  getAgentsByType(type) {
    return Object.values(this.agents)
      .filter(agent => agent.type === type);
  },

  getAllAgentIds() {
    return Object.keys(this.agents);
  },

  // Validate agent configuration
  validateAgent(agentConfig) {
    const errors = [];

    if (!agentConfig.tools || !Array.isArray(agentConfig.tools)) {
      errors.push("Agent must have a tools array");
    }

    if (!agentConfig.skills || !Array.isArray(agentConfig.skills)) {
      errors.push("Agent must have a skills array");
    }

    // Validate tool references exist
    const toolsRegistry = require("./tools_registry.cjs");
    agentConfig.tools?.forEach(toolId => {
      if (!toolsRegistry.getTool(toolId)) {
        errors.push(`Tool not found: ${toolId}`);
      }
    });

    // Validate skill references exist
    const skillsRegistry = require("./skills_registry.cjs");
    agentConfig.skills?.forEach(skillId => {
      if (!skillsRegistry.getSkill(skillId)) {
        errors.push(`Skill not found: ${skillId}`);
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }
};
