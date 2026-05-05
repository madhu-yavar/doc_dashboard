/**
 * Chart Note Composer Skill
 * Generates professional clinical chart notes from extracted discharge data
 */

class ChartNoteComposerSkill {
  constructor(config = {}) {
    this.name = "Chart Note Composer";
    this.version = "1.0.0";
    this.config = config;
  }

  /**
   * Execute the skill - generate chart note from extracted data
   * @param {object} context - { extractedData, gemmaClient, promptBuilder }
   * @returns {Promise<object>}
   */
  async execute(context) {
    const { extractedData, gemmaClient, promptBuilder } = context;

    if (!extractedData) {
      return {
        success: false,
        step: "chart_note_composer",
        error: "No extracted data provided"
      };
    }

    // Format extracted data for the prompt
    const formattedData = this.formatExtractedData(extractedData);

    const prompt = promptBuilder.build("chart_note_composer", {
      extractedData: formattedData
    });

    const result = await gemmaClient.execute(prompt, {
      temperature: 0.3,
      maxTokens: 2000
    });

    if (!result.success) {
      return {
        success: false,
        step: "chart_note_composer",
        error: result.error
      };
    }

    // Parse the chart note text
    const chartNoteText = result.content.trim();

    return {
      success: true,
      step: "chart_note_composer",
      data: {
        chart_note: chartNoteText,
        generated_at: new Date().toISOString()
      },
      usage: result.usage
    };
  }

  /**
   * Format extracted data into a readable text format for the LLM
   */
  formatExtractedData(data) {
    const lines = [];

    // Patient Information
    lines.push("=== PATIENT INFORMATION ===");
    if (data.patient) {
      lines.push(`Name: ${data.patient.name || "Not documented"}`);
      lines.push(`MRN: ${data.patient.mrn || "Not documented"}`);
      lines.push(`Age: ${data.patient.age || "Not documented"}`);
      lines.push(`Gender: ${data.patient.gender || "Not documented"}`);
      lines.push(`Admission Date: ${data.patient.admission_date || "Not documented"}`);
      lines.push(`Discharge Date: ${data.patient.discharge_date || "Not documented"}`);
    }

    // Diagnosis
    lines.push("\n=== DIAGNOSIS ===");
    if (data.diagnosis) {
      lines.push(`Principal Diagnosis: ${data.diagnosis.principal || "Not documented"}`);
      if (data.diagnosis.icd_code) {
        lines.push(`ICD Code: ${data.diagnosis.icd_code}`);
      }
      if (data.diagnosis.secondary && data.diagnosis.secondary.length > 0) {
        lines.push(`Secondary Diagnoses: ${data.diagnosis.secondary.join(", ")}`);
      }
    }

    // Vitals
    lines.push("\n=== VITALS ===");
    if (data.vitals) {
      if (data.vitals.bp) {
        lines.push(`Blood Pressure: ${data.vitals.bp.systolic || data.vitals.latest?.bp?.systolic}/${data.vitals.bp.diastolic || data.vitals.latest?.bp?.diastolic} mmHg`);
      }
      if (data.vitals.pulse) {
        lines.push(`Pulse: ${data.vitals.pulse.value || data.vitals.latest?.pulse} bpm`);
      }
      if (data.vitals.spo2) {
        lines.push(`SpO2: ${data.vitals.spo2.value || data.vitals.latest?.spo2}%`);
      }
      if (data.vitals.temperature) {
        lines.push(`Temperature: ${data.vitals.temperature.value || data.vitals.latest?.temp}°F`);
      }
      if (data.vitals.resp_rate) {
        lines.push(`Respiratory Rate: ${data.vitals.resp_rate} /min`);
      }
    }

    // Risk Scores
    if (data.risk_scores) {
      lines.push("\n=== RISK ASSESSMENT ===");
      if (data.risk_scores.fall_risk) {
        lines.push(`Fall Risk: Score ${data.risk_scores.fall_risk.score} (${data.risk_scores.fall_risk.level})`);
      }
      if (data.risk_scores.pressure_ulcer_risk) {
        lines.push(`Pressure Ulcer Risk: Score ${data.risk_scores.pressure_ulcer_risk.score} (${data.risk_scores.pressure_ulcer_risk.level})`);
      }
      if (data.risk_scores.ews_score !== null && data.risk_scores.ews_score !== undefined) {
        lines.push(`EWS Score: ${data.risk_scores.ews_score}`);
      }
      if (data.risk_scores.gcs) {
        lines.push(`GCS: E${data.risk_scores.gcs.eyes} V${data.risk_scores.gcs.verbal} M${data.risk_scores.gcs.motor} (Total: ${data.risk_scores.gcs.total})`);
      }
    }

    // Functional Status
    if (data.functional_status) {
      lines.push("\n=== FUNCTIONAL STATUS ===");
      if (data.functional_status.functional_status) {
        const fs = data.functional_status.functional_status;
        lines.push(`ADL Status:`);
        lines.push(`  - Bathing: ${fs.bathing || "Not documented"}`);
        lines.push(`  - Dressing: ${fs.dressing || "Not documented"}`);
        lines.push(`  - Eating: ${fs.eating || "Not documented"}`);
        lines.push(`  - Walking: ${fs.walking || "Not documented"}`);
        lines.push(`  - Toilet Use: ${fs.toilet_use || "Not documented"}`);
      }
      if (data.functional_status.mobility_notes) {
        lines.push(`Mobility Notes: ${data.functional_status.mobility_notes}`);
      }
      if (data.functional_status.overall_assistance_needs) {
        lines.push(`Assistance Needs: ${data.functional_status.overall_assistance_needs}`);
      }
    }

    // Medications
    lines.push("\n=== MEDICATIONS ===");
    if (data.medications && data.medications.length > 0) {
      data.medications.slice(0, 15).forEach(med => {
        const dose = med.dose || "";
        const freq = med.frequency || "";
        const route = med.route || "";
        lines.push(`- ${med.name} ${dose} ${freq} ${route}`.trim());
      });
      if (data.medications.length > 15) {
        lines.push(`... and ${data.medications.length - 15} more medications`);
      }
    } else {
      lines.push("No medications documented");
    }

    // Allergies
    lines.push("\n=== ALLERGIES ===");
    if (data.allergies && data.allergies.length > 0) {
      const knownAllergies = data.allergies.filter(a =>
        !a.toLowerCase().includes("nkf&da") &&
        !a.toLowerCase().includes("not known") &&
        !a.toLowerCase().includes("no known")
      );
      if (knownAllergies.length > 0) {
        lines.push(`Known Allergies: ${knownAllergies.join(", ")}`);
      } else {
        lines.push("No Known Allergies");
      }
    } else {
      lines.push("No Known Allergies");
    }

    // Lab Results (if available)
    if (data.lab_results && data.lab_results.length > 0) {
      lines.push("\n=== LAB RESULTS ===");
      data.lab_results.slice(0, 10).forEach(lab => {
        const flag = lab.flag ? ` [${lab.flag}]` : "";
        lines.push(`- ${lab.test_name || lab.test}: ${lab.value}${flag} (Ref: ${lab.reference || lab.ref || "N/A"})`);
      });
    }

    // Investigations
    if (data.investigations && data.investigations.length > 0) {
      lines.push("\n=== INVESTIGATIONS ORDERED ===");
      lines.push(data.investigations.slice(0, 20).join(", "));
    }

    // Treatment/Procedures
    if (data.treatment) {
      lines.push("\n=== TREATMENT ===");
      if (data.treatment.current_approach) {
        lines.push(`Management Approach: ${data.treatment.current_approach}`);
      }
      if (data.treatment.procedures && data.treatment.procedures.length > 0) {
        lines.push("Procedures Performed:");
        data.treatment.procedures.forEach(proc => {
          lines.push(`  - ${proc.name || proc}`);
        });
      }
      if (data.treatment.response) {
        lines.push(`Response to Treatment: ${data.treatment.response}`);
      }
      if (data.treatment.complications && data.treatment.complications.length > 0) {
        lines.push(`Complications: ${data.treatment.complications.join(", ")}`);
      }
    }

    // Nursing Needs
    if (data.nursing_needs && data.nursing_needs.length > 0) {
      lines.push("\n=== NURSING NEEDS ===");
      lines.push(data.nursing_needs.join(", "));
    }

    // Clinical Notes excerpts (if available)
    if (data.clinical_notes && data.clinical_notes.length > 0) {
      lines.push("\n=== CLINICAL NOTES ===");
      data.clinical_notes.slice(0, 5).forEach(note => {
        const noteType = note.type || "Note";
        const noteDate = note.date || "";
        const noteSummary = note.summary || "";
        lines.push(`[${noteType}] ${noteDate}: ${noteSummary.substring(0, 100)}...`);
      });
    }

    return lines.join("\n");
  }
}

module.exports = ChartNoteComposerSkill;
