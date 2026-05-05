/**
 * Skill Registry
 * Central registry for all extraction skills
 * Makes it easy to add new document types without changing agent code
 *
 * Adding a new document type:
 * 1. Create skills in skills/[category]/[doc_type]_*.skill.cjs
 * 2. Register mapping here
 * 3. No agent code changes needed!
 */

// Import all skills
const DemographicsExtractorSkill = require("../../skills/extraction/demographics_extractor.skill.cjs");
const RiskScoresExtractorSkill = require("../../skills/extraction/risk_scores_extractor.skill.cjs");
const VitalsExtractorSkill = require("../../skills/extraction/vitals_extractor.skill.cjs");
const FunctionalStatusExtractorSkill = require("../../skills/extraction/functional_status_extractor.skill.cjs");
const ClinicalDataExtractorSkill = require("../../skills/extraction/clinical_data_extractor.skill.cjs");
const PendingItemsExtractorSkill = require("../../skills/extraction/pending_items_extractor.skill.cjs");
const CrossValidatorSkill = require("../../skills/validation/cross_validator.skill.cjs");

// Prescription skills
const PrescriptionPatientExtractorSkill = require("../../skills/extraction/prescription_patient_extractor.skill.cjs");
const PrescriptionMedicationsExtractorSkill = require("../../skills/extraction/prescription_medications_extractor.skill.cjs");
const PrescriptionDiagnosisExtractorSkill = require("../../skills/extraction/prescription_diagnosis_extractor.skill.cjs");
const PrescriptionDoctorExtractorSkill = require("../../skills/extraction/prescription_doctor_extractor.skill.cjs");
const PrescriptionCrossValidatorSkill = require("../../skills/validation/prescription_cross_validator.skill.cjs");

// Lab skills (future)
// const LabResultsExtractorSkill = require("../../skills/extraction/lab_results_extractor.skill.cjs");

/**
 * Document Type → Skills Mapping
 *
 * For each document type, define:
 * - required: Skills that MUST run
 * - optional: Skills that run IF content is detected
 * - validation: Skills that validate the results
 */
const DOCUMENT_TYPE_SKILLS = {
  // Discharge Summary - Inpatient discharge documents
  discharge_summary: {
    category: "clinical",
    description: "Inpatient discharge summary with risk assessments",
    required: [
      { skill: DemographicsExtractorSkill, name: "demographics" },
      { skill: ClinicalDataExtractorSkill, name: "clinical_data" },
    ],
    optional: [
      { skill: RiskScoresExtractorSkill, name: "risk_scores", condition: "has_risk_scores" },
      { skill: VitalsExtractorSkill, name: "vitals", condition: "has_vitals" },
      { skill: FunctionalStatusExtractorSkill, name: "functional_status", condition: "has_functional_status" },
      { skill: PendingItemsExtractorSkill, name: "pending_items", condition: "has_pending_items" },
    ],
    validation: [
      { skill: CrossValidatorSkill, name: "cross_validation" },
    ],
    config: {
      enableDocumentAnalyzer: true,
      enablePendingItemsExtraction: true,
    }
  },

  // Outpatient Record - OPD visit records
  outpatient_record: {
    category: "clinical",
    description: "Outpatient department visit record",
    required: [
      { skill: DemographicsExtractorSkill, name: "demographics" },
      { skill: ClinicalDataExtractorSkill, name: "clinical_data" },
    ],
    optional: [
      { skill: VitalsExtractorSkill, name: "vitals", condition: "has_vitals" },
    ],
    validation: [
      { skill: CrossValidatorSkill, name: "cross_validation" },
    ],
    config: {
      enableDocumentAnalyzer: false,
      enablePendingItemsExtraction: false,
    }
  },

  // Prescription - Prescription capture (OPD forms with handwriting OR Rx pads)
  prescription: {
    category: "prescription",
    description: "Prescription with medications and doctor notes",
    required: [
      { skill: PrescriptionPatientExtractorSkill, name: "patient" },
      { skill: PrescriptionMedicationsExtractorSkill, name: "medications" },
    ],
    optional: [
      { skill: PrescriptionDiagnosisExtractorSkill, name: "diagnosis", condition: "has_diagnosis" },
      { skill: PrescriptionDoctorExtractorSkill, name: "doctor", condition: "has_doctor_info" },
    ],
    validation: [
      { skill: PrescriptionCrossValidatorSkill, name: "prescription_validation" },
    ],
    config: {
      useVisionModel: true,  // Use Qwen/Gemma Vision
      extractHandwriting: true,
    }
  },

  // Lab Report - Laboratory test results
  lab_report: {
    category: "lab",
    description: "Laboratory test results with reference ranges",
    required: [
      { skill: DemographicsExtractorSkill, name: "demographics" },
      // { skill: LabResultsExtractorSkill, name: "lab_results" },
    ],
    optional: [],
    validation: [
      { skill: CrossValidatorSkill, name: "cross_validation" },
    ],
    config: {}
  },

  // Chart Note - Progress notes, SOAP notes
  chart_note: {
    category: "clinical",
    description: "Progress notes, SOAP notes, nursing notes",
    required: [
      { skill: DemographicsExtractorSkill, name: "demographics" },
      { skill: ClinicalDataExtractorSkill, name: "clinical_data" },
    ],
    optional: [
      { skill: VitalsExtractorSkill, name: "vitals", condition: "has_vitals" },
    ],
    validation: [
      { skill: CrossValidatorSkill, name: "cross_validation" },
    ],
    config: {}
  },

  // Inpatient Record - IPD case paper (not yet discharged)
  inpatient_record: {
    category: "clinical",
    description: "Inpatient case paper during admission",
    required: [
      { skill: DemographicsExtractorSkill, name: "demographics" },
      { skill: ClinicalDataExtractorSkill, name: "clinical_data" },
    ],
    optional: [
      { skill: VitalsExtractorSkill, name: "vitals", condition: "has_vitals" },
      { skill: RiskScoresExtractorSkill, name: "risk_scores", condition: "has_risk_scores" },
    ],
    validation: [
      { skill: CrossValidatorSkill, name: "cross_validation" },
    ],
    config: {
      enableDocumentAnalyzer: false,
    }
  },
};

/**
 * Get skills for a document type
 */
function getSkillsForDocumentType(documentType) {
  return DOCUMENT_TYPE_SKILLS[documentType] || DOCUMENT_TYPE_SKILLS.discharge_summary;
}

/**
 * Get all supported document types
 */
function getSupportedDocumentTypes() {
  return Object.keys(DOCUMENT_TYPE_SKILLS);
}

/**
 * Register a new document type with its skills
 * Call this to add new document types at runtime!
 */
function registerDocumentType(documentType, config) {
  DOCUMENT_TYPE_SKILLS[documentType] = config;
}

/**
 * Register a new skill for an existing document type
 */
function addSkillToDocumentType(documentType, skillConfig, category = "optional") {
  if (!DOCUMENT_TYPE_SKILLS[documentType]) {
    DOCUMENT_TYPE_SKILLS[documentType] = {
      category: "custom",
      description: `${documentType} extraction`,
      required: [],
      optional: [],
      validation: [],
      config: {}
    };
  }

  if (!DOCUMENT_TYPE_SKILLS[documentType][category]) {
    DOCUMENT_TYPE_SKILLS[documentType][category] = [];
  }

  DOCUMENT_TYPE_SKILLS[documentType][category].push(skillConfig);
}

/**
 * Initialize skill instances with config
 */
function initializeSkill(SkillClass, config = {}) {
  return new SkillClass(config);
}

/**
 * Get skill categories for a document type
 */
function getSkillCategories(documentType) {
  const docConfig = DOCUMENT_TYPE_SKILLS[documentType];
  if (!docConfig) return { required: [], optional: [], validation: [] };

  return {
    required: docConfig.required || [],
    optional: docConfig.optional || [],
    validation: docConfig.validation || [],
    config: docConfig.config || {}
  };
}

module.exports = {
  DOCUMENT_TYPE_SKILLS,
  getSkillsForDocumentType,
  getSupportedDocumentTypes,
  registerDocumentType,
  addSkillToDocumentType,
  initializeSkill,
  getSkillCategories
};
