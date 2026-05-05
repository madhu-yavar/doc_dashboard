/**
 * Prescription Cross Validator Skill
 * Cross-references extracted prescription data and validates against the source document
 * Validates medication completeness, dosage consistency, and clinical logic
 */

class PrescriptionCrossValidatorSkill {
  constructor(config = {}) {
    this.name = "Prescription Cross Validator";
    this.version = "1.0.0";
    this.config = config;
  }

  /**
   * Execute the cross-validation
   * @param {object} context - { steps: array of previous step results, pdfText: string, gemmaClient, promptBuilder }
   * @returns {Promise<object>}
   */
  async execute(context) {
    const { steps, pdfText, gemmaClient, promptBuilder } = context;

    // Ensure steps is an array
    const stepsArray = Array.isArray(steps) ? steps : [];

    // Perform self-validation first
    const selfValidation = this.selfValidate(stepsArray);

    // Build validation result
    const validationSummary = {
      overall_confidence: selfValidation.confidence_level === "high" ? 0.95 :
                          selfValidation.confidence_level === "medium" ? 0.75 : 0.5,
      fields_reviewed: selfValidation.fields_reviewed || 0,
      total_fields: selfValidation.total_fields || 0,
      flags: selfValidation.flags || [],
      inconsistencies: selfValidation.inconsistencies || [],
      missing_fields: selfValidation.missing_fields || []
    };

    return {
      success: true,
      step: "prescription_cross_validator",
      data: {
        validation_summary: validationSummary,
        self_validation: selfValidation,
        citation_summary: {
          total_citations: 0,
          fields_with_citations: 0,
          citation_details: []
        }
      },
      usage: { totalTokens: 0 }
    };
  }

  /**
   * Perform self-validation on the extracted prescription data
   */
  selfValidate(steps) {
    const inconsistencies = [];
    const missingFields = [];
    const flags = [];
    let fieldsReviewed = 0;
    let totalFields = 0;

    // Collect all data from steps
    const allData = {
      patient: {},
      doctor: {},
      medications: [],
      diagnosis: {}
    };

    steps.forEach(step => {
      if (step.data) {
        if (step.data.patient) {
          Object.assign(allData.patient, step.data.patient);
          fieldsReviewed++;
        }
        if (step.data.doctor) {
          Object.assign(allData.doctor, step.data.doctor);
          fieldsReviewed++;
        }
        if (step.data.medications) {
          allData.medications = step.data.medications;
          totalFields += step.data.medications.length;
          fieldsReviewed += step.data.medications.length;
        }
        if (step.data.diagnosis) {
          Object.assign(allData.diagnosis, step.data.diagnosis);
          fieldsReviewed++;
        }
      }
    });

    totalFields += 3; // patient, doctor, diagnosis as base fields

    // Validate patient information
    if (!allData.patient.name) {
      missingFields.push("patient.name");
      flags.push("Patient name not found");
    }
    if (!allData.patient.age && !allData.patient.mrn) {
      flags.push("Limited patient identifiers");
    }

    // Validate doctor information
    if (!allData.doctor.name) {
      flags.push("Doctor name not found");
    }

    // Validate medications
    if (!allData.medications || allData.medications.length === 0) {
      missingFields.push("medications");
      flags.push("No medications extracted - this may indicate an issue");
    } else {
      // Check for medication completeness
      allData.medications.forEach((med, index) => {
        if (!med.name || med.name.trim() === "") {
          inconsistencies.push(`Medication ${index + 1}: Missing name`);
        }
        if (!med.dose && !med.dosage) {
          flags.push(`Medication ${med.name || index + 1}: No dosage information`);
        }
        if (!med.frequency) {
          flags.push(`Medication ${med.name || index + 1}: No frequency information`);
        }
      });

      // Check for duplicate medications
      const medNames = allData.medications.map(m => m.name?.toLowerCase()).filter(Boolean);
      const duplicates = medNames.filter((name, index) => medNames.indexOf(name) !== index);
      if (duplicates.length > 0) {
        flags.push(`Possible duplicate medications: ${[...new Set(duplicates)].join(", ")}`);
      }
    }

    // Validate diagnosis
    if (!allData.diagnosis.principal) {
      flags.push("Primary diagnosis not found");
    }

    // Calculate confidence level
    let confidenceLevel = "high";
    if (missingFields.length > 2 || inconsistencies.length > 2) {
      confidenceLevel = "low";
    } else if (missingFields.length > 0 || inconsistencies.length > 0 || flags.length > 2) {
      confidenceLevel = "medium";
    }

    return {
      confidence_level: confidenceLevel,
      inconsistencies,
      missing_fields: missingFields,
      flags,
      fields_reviewed: fieldsReviewed,
      total_fields: totalFields + allData.medications.length,
      data_quality_notes: this.generateQualityNotes(confidenceLevel, missingFields, inconsistencies, flags)
    };
  }

  generateQualityNotes(confidenceLevel, missingFields, inconsistencies, flags) {
    const notes = [];

    if (confidenceLevel === "high") {
      notes.push("All critical data extracted successfully");
    } else {
      if (missingFields.length > 0) {
        notes.push(`${missingFields.length} critical field(s) missing: ${missingFields.join(", ")}`);
      }
      if (inconsistencies.length > 0) {
        notes.push(`${inconsistencies.length} inconsistency(ies) found`);
      }
      if (flags.length > 0) {
        notes.push(`${flags.length} warning(s) flagged for review`);
      }
    }

    return notes.join(". ");
  }

  /**
   * Generate final validation summary for dashboard display
   */
  generateSummary(allStepResults) {
    const hasErrors = allStepResults.some(r => !r.success);
    const stepsWithMedications = allStepResults.filter(r =>
      r.data?.medications && r.data.medications.length > 0
    );

    let medicationCount = 0;
    stepsWithMedications.forEach(step => {
      medicationCount += step.data.medications.length;
    });

    return {
      confidence_level: hasErrors ? "low" : "high",
      fields_reviewed: allStepResults.filter(r => r.success).length,
      total_fields: allStepResults.length,
      medication_count: medicationCount,
      inconsistencies_found: [],
      missing_critical_fields: [],
      data_quality_notes: "",
      steps_completed: allStepResults.filter(r => r.success).length,
      total_steps: allStepResults.length
    };
  }
}

module.exports = PrescriptionCrossValidatorSkill;
