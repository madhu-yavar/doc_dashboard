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
    const { steps, previousSteps, gemmaClient, promptBuilder } = context;

    // Ensure steps is an array
    const stepsArray = Array.isArray(steps) ? steps : Array.isArray(previousSteps) ? previousSteps : [];

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
        data: null,
        usage: result.usage
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

    // Collect all data from steps
    const allData = {};
    stepsArray.forEach(step => {
      if (step.data) {
        Object.assign(allData, step.data);
      }
    });

    // Check for demographics consistency
    const ages = [];
    stepsArray.forEach(step => {
      if (step.data?.patient?.age) {
        ages.push(step.data.patient.age);
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
      if (step.data?.risk_scores?.fall_risk?.score || step.data?.fall_risk_score) {
        fallScores.push(step.data.risk_scores?.fall_risk?.score || step.data.fall_risk_score);
      }
    });
    if (fallScores.length > 1) {
      const uniqueScores = [...new Set(fallScores)];
      if (uniqueScores.length > 1) {
        inconsistencies.push(`Fall score has multiple values: ${uniqueScores.join(", ")}`);
      }
    }

    // Check for missing critical fields
    const required = ["patient.name", "patient.mrn", "vitals.bp"];
    required.forEach(field => {
      const parts = field.split(".");
      let obj = allData;
      for (const part of parts) {
        obj = obj?.[part];
      }
      if (!obj) {
        missing.push(field);
      }
    });

    return {
      inconsistencies: inconsistencies,
      missing: missing,
      confidence_level: inconsistencies.length === 0 ? "high" : "medium",
      data_quality_notes: inconsistencies.length > 0 ?
        `Found ${inconsistencies.length} inconsistencies, ${missing.length} missing fields` :
        "All data consistent"
    };
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
