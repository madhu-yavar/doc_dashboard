/**
 * Skills Registry
 * Central catalog of all prompt templates and extraction skills
 */

module.exports = {
  registryVersion: "1.0.0",
  lastUpdated: "2026-04-04",

  skills: {
    // Extraction Skills
    document_analyzer: {
      id: "document_analyzer",
      name: "Document Analyzer",
      version: "1.0.0",
      category: "extraction",
      handler: "../skills/extraction/document_analyzer.skill.cjs",
      description: "Analyzes PDF structure and identifies key sections",
      model: "gemma-4-26B",
      temperature: 0.3,
      maxTokens: 800,
      stepNumber: 1
    },

    demographics_extractor: {
      id: "demographics_extractor",
      name: "Demographics Extractor",
      version: "1.0.0",
      category: "extraction",
      handler: "../skills/extraction/demographics_extractor.skill.cjs",
      description: "Extracts patient demographics with verification",
      model: "gemma-4-26B",
      temperature: 0.1,
      maxTokens: 600,
      stepNumber: 2
    },

    risk_scores_extractor: {
      id: "risk_scores_extractor",
      name: "Risk Scores Extractor",
      version: "1.0.0",
      category: "extraction",
      handler: "../skills/extraction/risk_scores_extractor.skill.cjs",
      description: "Extracts and validates risk scores (Fall, DVT, Pressure, Aspiration)",
      model: "gemma-4-26B",
      temperature: 0.1,
      maxTokens: 1000,
      stepNumber: 3,
      critical: true
    },

    vitals_extractor: {
      id: "vitals_extractor",
      name: "Vitals Extractor",
      version: "1.0.0",
      category: "extraction",
      handler: "../skills/extraction/vitals_extractor.skill.cjs",
      description: "Extracts vitals with clinical interpretation (normal/abnormal flags)",
      model: "gemma-4-26B",
      temperature: 0.1,
      maxTokens: 800,
      stepNumber: 4
    },

    functional_status_extractor: {
      id: "functional_status_extractor",
      name: "Functional Status Extractor",
      version: "1.0.0",
      category: "extraction",
      handler: "../skills/extraction/functional_status_extractor.skill.cjs",
      description: "Extracts ADL (Activities of Daily Living) status",
      model: "gemma-4-26B",
      temperature: 0.1,
      maxTokens: 600,
      stepNumber: 5
    },

    clinical_data_extractor: {
      id: "clinical_data_extractor",
      name: "Clinical Data Extractor",
      version: "1.0.0",
      category: "extraction",
      handler: "../skills/extraction/clinical_data_extractor.skill.cjs",
      description: "Extracts diagnosis, allergies, medications, investigations",
      model: "gemma-4-26B",
      temperature: 0.1,
      maxTokens: 1000,
      stepNumber: 6
    },

    // Validation Skills
    cross_validator: {
      id: "cross_validator",
      name: "Cross Validator",
      version: "1.0.0",
      category: "validation",
      handler: "../skills/validation/cross_validator.skill.cjs",
      description: "Cross-references extracted data across sections",
      model: "gemma-4-26B",
      temperature: 0.1,
      maxTokens: 2000,
      stepNumber: 7
    },

    inconsistency_detector: {
      id: "inconsistency_detector",
      name: "Inconsistency Detector",
      version: "1.0.0",
      category: "validation",
      handler: "../skills/validation/inconsistency_detector.skill.cjs",
      description: "Detects discrepancies in source document",
      model: "gemma-4-26B",
      temperature: 0.2,
      maxTokens: 800
    },

    // Clinical Skills
    vitals_interpreter: {
      id: "vitals_interpreter",
      name: "Vitals Interpreter",
      version: "1.0.0",
      category: "clinical",
      handler: "../skills/clinical/vitals_interpreter.skill.cjs",
      description: "Compares vitals against normal ranges and flags abnormalities",
      model: "gemma-4-26B",
      temperature: 0.1,
      maxTokens: 600
    },

    risk_interpreter: {
      id: "risk_interpreter",
      name: "Risk Interpreter",
      version: "1.0.0",
      category: "clinical",
      handler: "../skills/clinical/risk_interpreter.skill.cjs",
      description: "Interprets risk scores and provides clinical context",
      model: "gemma-4-26B",
      temperature: 0.1,
      maxTokens: 600
    },

    summary_generator: {
      id: "summary_generator",
      name: "Clinical Summary Generator",
      version: "1.0.0",
      category: "clinical",
      handler: "../skills/clinical/summary_generator.skill.cjs",
      description: "Generates patient summary from extracted data",
      model: "gemma-4-26B",
      temperature: 0.3,
      maxTokens: 1000
    },

    dashboard_mapper: {
      id: "dashboard_mapper",
      name: "Dashboard Mapper",
      version: "1.0.0",
      category: "clinical",
      handler: "../skills/clinical/dashboard_mapper.skill.cjs",
      description: "Transforms extracted clinical data into dashboard card format",
      model: null,
      temperature: 0,
      maxTokens: 0,
      stepNumber: 8
    }
  },

  // Helper methods
  getSkill(id) {
    return this.skills[id] || null;
  },

  getSkillsByCategory(category) {
    return Object.values(this.skills)
      .filter(skill => skill.category === category);
  },

  getCriticalSkills() {
    return Object.values(this.skills)
      .filter(skill => skill.critical === true);
  },

  getSkillSequence() {
    return Object.values(this.skills)
      .filter(skill => skill.stepNumber)
      .sort((a, b) => a.stepNumber - b.stepNumber);
  },

  getAllSkillIds() {
    return Object.keys(this.skills);
  }
};
