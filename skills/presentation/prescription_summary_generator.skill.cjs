/**
 * Prescription Summary Generator Skill
 * Generates a comprehensive clinical narrative summary from prescription extraction data
 */

class PrescriptionSummaryGeneratorSkill {
  constructor(config = {}) {
    this.name = "Prescription Summary Generator";
    this.version = "1.0.0";
    this.config = config;
  }

  /**
   * Execute the skill - generate comprehensive summary
   * @param {object} context - { dashboardData }
   * @returns {Promise<object>}
   */
  async execute(context) {
    const { dashboardData } = context;

    if (!dashboardData) {
      return {
        success: false,
        error: "No dashboard data provided"
      };
    }

    const summary = this.generateComprehensiveSummary(dashboardData);

    return {
      success: true,
      step: "prescription_summary_generator",
      data: {
        summary: summary,
        summary_sections: this.extractSummarySections(dashboardData)
      }
    };
  }

  /**
   * Generate a comprehensive narrative summary
   */
  generateComprehensiveSummary(data) {
    const parts = [];

    // Patient Context
    const patient = this.buildPatientContext(data);
    if (patient) parts.push(patient);

    // Chief Complaint / Visit Reason
    const visitContext = this.buildVisitContext(data);
    if (visitContext) parts.push(visitContext);

    // Vitals
    const vitals = this.buildVitalsSummary(data);
    if (vitals) parts.push(vitals);

    // Diagnosis
    const diagnosis = this.buildDiagnosisSummary(data);
    if (diagnosis) parts.push(diagnosis);

    // Medications
    const medications = this.buildMedicationsSummary(data);
    if (medications) parts.push(medications);

    // Investigations Ordered
    const investigations = this.buildInvestigationsSummary(data);
    if (investigations) parts.push(investigations);

    // Clinical Notes
    const clinicalNotes = this.buildClinicalNotesSummary(data);
    if (clinicalNotes) parts.push(clinicalNotes);

    // Doctor & Visit Details
    const visitDetails = this.buildVisitDetails(data);
    if (visitDetails) parts.push(visitDetails);

    return parts.join("\n\n");
  }

  buildPatientContext(data) {
    const patient = data.patient || {};
    const age = patient.age || "";
    const gender = patient.gender || "";

    if (!age && !gender) return null;

    const parts = [];
    if (age) parts.push(`${age}-year-old`);
    if (gender) parts.push(gender);

    return parts.length ? `**Patient:** ${parts.join(" ")}` : null;
  }

  buildVisitContext(data) {
    const diagnosis = data.diagnosis || {};
    const symptoms = Array.isArray(diagnosis.symptoms) ? diagnosis.symptoms : [];

    if (symptoms.length === 0) return null;

    const symptomText = symptoms.slice(0, 3).join(", ");
    return `**Presentation:** Patient presented with ${symptomText}${symptoms.length > 3 ? ", among other symptoms" : ""}.`;
  }

  buildVitalsSummary(data) {
    const vitals = data.vitals || {};
    const latest = vitals.latest || vitals;

    const readings = [];

    if (latest.bp?.systolic || latest.bp?.diastolic) {
      const sys = latest.bp.systolic || 0;
      const dia = latest.bp.diastolic || 0;
      readings.push(`BP ${sys}/${dia} mmHg`);
    }

    if (latest.pulse?.value) {
      readings.push(`Pulse ${latest.pulse.value} ${latest.pulse.unit || "bpm"}`);
    }

    if (latest.temperature?.value) {
      readings.push(`Temp ${latest.temperature.value}°${latest.temperature.unit || "F"}`);
    }

    if (latest.spo2?.value) {
      readings.push(`SpO2 ${latest.spo2.value}%`);
    }

    if (readings.length === 0) return null;

    return `**Vitals:** ${readings.join(", ")}.`;
  }

  buildDiagnosisSummary(data) {
    const diagnosis = data.diagnosis || {};

    const parts = [];

    if (diagnosis.principal) {
      parts.push(`Principal diagnosis: ${diagnosis.principal}`);
    }

    if (Array.isArray(diagnosis.secondary) && diagnosis.secondary.length > 0) {
      const secondary = diagnosis.secondary.slice(0, 2).join(", ");
      parts.push(`Secondary: ${secondary}${diagnosis.secondary.length > 2 ? " (+ others)" : ""}`);
    }

    if (parts.length === 0) return null;

    return `**Diagnosis:** ${parts.join(". ")}.`;
  }

  buildMedicationsSummary(data) {
    const medications = data.medications || [];
    const medicationsMetadata = data.medications_metadata || {};

    if (!Array.isArray(medications) || medications.length === 0) {
      return null;
    }

    const medList = medications.slice(0, 5).map(med => {
      const name = med.name || "Unknown medication";
      const dose = med.dose || "";
      const freq = med.frequency || "";

      if (dose && freq) {
        return `${name} (${dose}, ${freq})`;
      } else if (dose) {
        return `${name} (${dose})`;
      }
      return name;
    }).join("; ");

    const moreText = medications.length > 5 ? ` (+ ${medications.length - 5} more)` : "";
    const uncertainText = medicationsMetadata.has_unreadable ? " [some entries unreadable]" : "";

    return `**Medications prescribed:** ${medList}${moreText}${uncertainText}.`;
  }

  buildInvestigationsSummary(data) {
    const investigations = data.investigations || [];
    const radiology = data.radiology || [];
    const provenance = data.provenance || {};

    const labs = Array.isArray(investigations)
      ? investigations.filter(inv => inv.status === "ordered" || inv.status === "pending")
      : [];

    const studies = Array.isArray(radiology)
      ? radiology.filter(study => study.status === "ordered" || study.status === "pending")
      : [];

    const parts = [];

    if (labs.length > 0) {
      const labNames = labs.slice(0, 4).map(l => l.type).join(", ");
      const moreLabs = labs.length > 4 ? ` (+${labs.length - 4} more)` : "";
      const uncertainLabs = labs.some(l => l.is_uncertain) ? " [some uncertain]" : "";
      parts.push(`Lab investigations: ${labNames}${moreLabs}${uncertainLabs}`);
    }

    if (studies.length > 0) {
      const studyNames = studies.slice(0, 3).map(s => s.type).join(", ");
      const moreStudies = studies.length > 3 ? ` (+${studies.length - 3} more)` : "";
      const uncertainStudies = studies.some(s => s.is_uncertain) ? " [some uncertain]" : "";
      parts.push(`Imaging/studies: ${studyNames}${moreStudies}${uncertainStudies}`);
    }

    if (parts.length === 0) return null;

    return `**Investigations ordered:** ${parts.join(". ")}.`;
  }

  buildClinicalNotesSummary(data) {
    const notes = data.clinical_notes || [];

    if (!Array.isArray(notes) || notes.length === 0) {
      return null;
    }

    // Prefer genuine handwritten notes over synthetic system notes
    const generalNotes = notes.filter((n) =>
      !n.is_synthetic &&
      (n.source_type === "handwritten" || n.type === "Clinical Note" || n.type === "General" || n.type === "Finding" || n.type === "Advice" || n.type === "Follow-up")
    );

    if (generalNotes.length === 0) {
      return null;
    }

    const noteTexts = generalNotes
      .slice(0, 3)
      .map(n => n.summary || "")
      .filter(Boolean)
      .join("; ");

    if (!noteTexts) return null;

    const moreText = generalNotes.length > 3 ? ` (+ ${generalNotes.length - 3} more notes)` : "";

    return `**Clinical notes:** ${noteTexts}${moreText}.`;
  }

  buildVisitDetails(data) {
    const doctor = data.doctor || {};
    const hospital = data.hospital || {};
    const meta = data.meta || {};

    const parts = [];

    if (doctor.name) {
      parts.push(`Prescribing doctor: ${doctor.name}`);
      if (doctor.registration_number) {
        parts[0] += ` (Reg: ${doctor.registration_number})`;
      }
    }

    if (hospital.name) {
      parts.push(`Facility: ${hospital.name}`);
    }

    if (meta.rx_date) {
      parts.push(`Date: ${meta.rx_date}`);
    }

    if (parts.length === 0) return null;

    return `**Visit details:** ${parts.join(", ")}.`;
  }

  /**
   * Extract structured sections for display
   */
  extractSummarySections(data) {
    return {
      patient: this.buildPatientContext(data),
      presentation: this.buildVisitContext(data),
      vitals: this.buildVitalsSummary(data),
      diagnosis: this.buildDiagnosisSummary(data),
      medications: this.buildMedicationsSummary(data),
      investigations: this.buildInvestigationsSummary(data),
      clinical_notes: this.buildClinicalNotesSummary(data),
      visit_details: this.buildVisitDetails(data)
    };
  }
}

module.exports = PrescriptionSummaryGeneratorSkill;
