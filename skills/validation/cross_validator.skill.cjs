/**
 * Cross Validator Skill
 * Cross-references extracted data across sections and validates
 */

class CrossValidatorSkill {
  constructor(config = {}) {
    this.name = "Cross Validator";
    this.version = "1.0.0";
    this.config = config;
  }

  /**
   * Execute the cross-validation
   * @param {object} context - { steps: array of previous step results, gemmaClient, promptBuilder }
   * @returns {Promise<object>}
   */
  async execute(context) {
    const { steps, gemmaClient, promptBuilder } = context;

    // Ensure steps is an array
    const stepsArray = Array.isArray(steps) ? steps : [];

    // Build a summary of all previous steps
    const stepsSummary = stepsArray.map(step => {
      const stepData = step.data || {};
      const summary = {
        step: step.step,
        extracted: Object.keys(stepData).filter(k => k !== "raw_thinking")
      };
      return `${step.step}: ${JSON.stringify(summary)}`;
    }).join("\n\n");

    const prompt = promptBuilder.build("cross_validator", {
      steps: stepsSummary
    });

    const result = await gemmaClient.execute(prompt, {
      temperature: 0.1,
      maxTokens: 2000
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        step: "cross_validator",
        data: null
      };
    }

    // Parse the response - if JSON parsing fails, create a basic validation result
    let data;
    try {
      data = JSON.parse(result.content);
    } catch (e) {
      // If JSON parsing fails, just use self-validation and continue
      const selfValidation = this.selfValidate(stepsArray);
      return {
        success: true,
        step: "cross_validator",
        data: {
          validation_summary: selfValidation,
          parser_note: "LLM response was not valid JSON, using self-validation only"
        },
        selfValidation: selfValidation,
        usage: result.usage
      };
    }

    // Perform our own validation as well
    const selfValidation = this.selfValidate(stepsArray);

    return {
      success: true,
      step: "cross_validator",
      data: data,
      selfValidation: selfValidation,
      usage: result.usage
    };
  }

  /**
   * Perform self-validation on the extracted data
   */
  selfValidate(steps) {
    const inconsistencies = [];
    const missing = [];

    // Ensure steps is an array
    const stepsArray = Array.isArray(steps) ? steps : [];

    // Collect all data from steps using the same schema the rest of the app expects
    const allData = {
      patient: {},
      vitals: {},
      risk_scores: {},
    };
    stepsArray.forEach(step => {
      if (step.data) {
        const stepData = step.data;

        Object.assign(allData, stepData);

        if (stepData.name || stepData.mrn || stepData.age || stepData.gender) {
          Object.assign(allData.patient, {
            name: stepData.name || allData.patient.name,
            mrn: stepData.mrn || allData.patient.mrn,
            age: stepData.age || allData.patient.age,
            gender: stepData.gender || allData.patient.gender,
            admission_date: stepData.admission_date || allData.patient.admission_date,
            discharge_date: stepData.discharge_date || allData.patient.discharge_date,
          });
        }

        if (stepData.patient && typeof stepData.patient === "object") {
          Object.assign(allData.patient, stepData.patient);
        }

        if (
          stepData.latest ||
          Array.isArray(stepData.readings) ||
          stepData.reference_ranges ||
          stepData.bp ||
          stepData.pulse ||
          stepData.spo2 ||
          stepData.temperature
        ) {
          allData.vitals = {
            ...allData.vitals,
            ...stepData,
            latest: stepData.latest || allData.vitals.latest || {},
            readings: Array.isArray(stepData.readings) ? stepData.readings : (allData.vitals.readings || []),
            reference_ranges: stepData.reference_ranges || allData.vitals.reference_ranges || {},
          };
        }

        if (stepData.vitals && typeof stepData.vitals === "object") {
          allData.vitals = {
            ...allData.vitals,
            ...stepData.vitals,
            latest: stepData.vitals.latest || allData.vitals.latest || {},
            readings: Array.isArray(stepData.vitals.readings)
              ? stepData.vitals.readings
              : (allData.vitals.readings || []),
            reference_ranges: stepData.vitals.reference_ranges || allData.vitals.reference_ranges || {},
          };
        }
      }
    });

    // Check for demographics consistency
    const ages = [];
    stepsArray.forEach(step => {
      if (step.data?.patient?.age) {
        ages.push(step.data.patient.age);
      } else if (step.data?.age) {
        ages.push(step.data.age);
      }
    });
    if (ages.length > 1) {
      const uniqueAges = [...new Set(ages)];
      if (uniqueAges.length > 1) {
        inconsistencies.push(`Multiple age values found: ${uniqueAges.join(", ")}`);
      }
    }

    // Check for risk score consistency
    const fallScores = [];
    stepsArray.forEach(step => {
      if (step.data?.risk_scores?.fall_risk?.score || step.data?.fall_risk?.score || step.data?.fall_risk_score) {
        fallScores.push(step.data.risk_scores?.fall_risk?.score || step.data.fall_risk?.score || step.data.fall_risk_score);
      }
    });
    if (fallScores.length > 1) {
      const uniqueScores = [...new Set(fallScores)];
      if (uniqueScores.length > 1) {
        inconsistencies.push(`Fall score has multiple values: ${uniqueScores.join(", ")}`);
      }
    }

    // Check for missing critical fields
    if (!this.hasValue(allData.patient?.name)) {
      missing.push("patient.name");
    }
    if (!this.hasValue(allData.patient?.mrn)) {
      missing.push("patient.mrn");
    }
    if (!this.hasVitalsBp(allData.vitals)) {
      missing.push("vitals.bp");
    }

    return {
      inconsistencies: inconsistencies,
      missing: missing,
      confidence_level: inconsistencies.length === 0 ? "high" : "medium",
      data_quality_notes: inconsistencies.length > 0 ?
        `Found ${inconsistencies.length} inconsistencies, ${missing.length} missing fields` :
        "All data consistent"
    };
  }

  hasValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  }

  hasVitalsBp(vitals = {}) {
    if (!vitals || typeof vitals !== "object") return false;

    const latestBp = vitals.latest?.bp;
    if (latestBp && (this.hasValue(latestBp.systolic) || this.hasValue(latestBp.diastolic))) {
      return true;
    }

    const directBp = vitals.bp;
    if (directBp && (this.hasValue(directBp.systolic) || this.hasValue(directBp.diastolic))) {
      return true;
    }

    if (Array.isArray(vitals.readings)) {
      return vitals.readings.some(
        (reading) => this.hasValue(reading?.bp_systolic) || this.hasValue(reading?.bp_diastolic)
      );
    }

    return false;
  }

  /**
   * Generate final validation summary
   */
  generateSummary(allStepResults) {
    const hasErrors = allStepResults.some(r => !r.success);

    return {
      confidence_level: hasErrors ? "low" : "high",
      inconsistencies_found: [],
      missing_critical_fields: [],
      data_quality_notes: "",
      steps_completed: allStepResults.filter(r => r.success).length,
      total_steps: allStepResults.length
    };
  }
}

module.exports = CrossValidatorSkill;
