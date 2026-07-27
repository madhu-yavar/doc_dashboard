/**
 * Discharge Summary Service - Phase 5 & 6 Enhancement
 *
 * Service for generating comprehensive discharge summaries
 * from inpatient journey data and daily notes.
 *
 * Responsibilities:
 * - Compile journey data into discharge summary format
 * - Generate clinical course summaries
 * - Extract medication reconciliation data
 * - Create follow-up care plans
 * - Export to PDF/Word formats
 */

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

class DischargeSummaryService {
  constructor(config = {}) {
    this.name = 'DischargeSummaryService';
    this.storageDir = config.storageDir || '/tmp/discharge_summaries';
    this.templateDir = config.templateDir || path.join(__dirname, '../templates');

    this.ensureStorageDir();
  }

  /**
   * Ensure storage directory exists
   */
  ensureStorageDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Generate discharge summary from journey data
   * @param {Object} journeyData - Complete journey information
   * @param {Object} options - Generation options
   * @returns {Object} Generated discharge summary
   */
  async generateDischargeSummary(journeyData, options = {}) {
    try {
      this.log('Generating discharge summary', { journeyId: journeyData.id });

      // Fetch journey daily notes
      const dailyNotes = await this.fetchJourneyNotes(journeyData.id);

      // Compile discharge summary data
      const dischargeSummary = {
        id: uuidv4(),
        journeyId: journeyData.id,
        patientInfo: this.compilePatientInfo(journeyData),
        diagnosis: this.compileDiagnosis(journeyData, dailyNotes),
        procedures: this.compileProcedures(journeyData, dailyNotes),
        medications: await this.compileMedications(journeyData, dailyNotes),
        clinicalCourse: this.compileClinicalCourse(journeyData, dailyNotes),
        dischargeStatus: this.compileDischargeStatus(journeyData, dailyNotes),
        followUp: this.compileFollowUpCare(journeyData, dailyNotes),
        metadata: {
          generatedAt: new Date().toISOString(),
          generatedBy: options.userId || 'system',
          reviewed: false,
          approved: false,
          version: '1.0'
        }
      };

      this.log('Discharge summary generated successfully', {
        summaryId: dischargeSummary.id
      });

      return dischargeSummary;

    } catch (error) {
      this.log('Discharge summary generation failed', { error: error.message });
      throw new Error(`Failed to generate discharge summary: ${error.message}`);
    }
  }

  /**
   * Compile patient information
   */
  compilePatientInfo(journeyData) {
    const admission = new Date(journeyData.admissionDate);
    const discharge = journeyData.dischargeDate ? new Date(journeyData.dischargeDate) : new Date();
    const lengthOfStay = Math.ceil((discharge.getTime() - admission.getTime()) / (1000 * 60 * 60 * 24));

    return {
      name: journeyData.patientName || 'Unknown',
      mrn: journeyData.patientId || 'Unknown',
      age: journeyData.metadata?.age || 0,
      gender: journeyData.metadata?.gender || 'Unknown',
      admissionDate: journeyData.admissionDate,
      dischargeDate: journeyData.dischargeDate || new Date().toISOString(),
      lengthOfStay: lengthOfStay
    };
  }

  /**
   * Compile diagnosis information
   */
  compileDiagnosis(journeyData, dailyNotes) {
    const diagnoses = {
      admission: journeyData.diagnosis || 'Pending admission assessment',
      final: journeyData.diagnosis || 'To be determined',
      secondary: []
    };

    // Extract secondary diagnoses from daily notes
    dailyNotes.forEach(note => {
      if (note.assessment && !diagnoses.secondary.includes(note.assessment)) {
        // Check if it's a different diagnosis
        if (note.assessment !== diagnoses.admission && note.assessment !== diagnoses.final) {
          diagnoses.secondary.push(note.assessment);
        }
      }
    });

    return diagnoses;
  }

  /**
   * Compile procedures from journey data
   */
  compileProcedures(journeyData, dailyNotes) {
    const procedures = [];

    dailyNotes.forEach(note => {
      if (note.procedures && Array.isArray(note.procedures)) {
        note.procedures.forEach(procedure => {
          const existing = procedures.find(p => p.name === procedure.name);
          if (!existing) {
            procedures.push({
              name: procedure.name,
              date: note.noteDate,
              complications: procedure.complications || null
            });
          }
        });
      }
    });

    return procedures;
  }

  /**
   * Compile medication reconciliation data
   */
  async compileMedications(journeyData, dailyNotes) {
    const admissionMedications = [];
    const dischargeMedications = [];

    // Extract admission medications from early notes
    const earlyNotes = dailyNotes.slice(0, 3);
    earlyNotes.forEach(note => {
      if (note.medications && Array.isArray(note.medications)) {
        note.medications.forEach(medication => {
          const existing = admissionMedications.find(m => m.name === medication.name);
          if (!existing) {
            admissionMedications.push({
              name: medication.name,
              dosage: medication.dosage || 'TBD',
              frequency: medication.frequency || 'TBD'
            });
          }
        });
      }
    });

    // Extract discharge medications from recent notes
    const recentNotes = dailyNotes.slice(-3);
    recentNotes.forEach(note => {
      if (note.medications && Array.isArray(note.medications)) {
        note.medications.forEach(medication => {
          const existing = dischargeMedications.find(m => m.name === medication.name);
          if (!existing) {
            dischargeMedications.push({
              name: medication.name,
              dosage: medication.dosage || 'TBD',
              frequency: medication.frequency || 'TBD',
              instructions: medication.instructions || 'Continue as prescribed'
            });
          }
        });
      }
    });

    return {
      admission: admissionMedications,
      discharge: dischargeMedications,
      reconciled: admissionMedications.length > 0 && dischargeMedications.length > 0
    };
  }

  /**
   * Compile clinical course narrative
   */
  compileClinicalCourse(journeyData, dailyNotes) {
    if (dailyNotes.length === 0) {
      return {
        chiefComplaint: 'Not documented',
        history: 'Not documented',
        findings: 'Not documented',
        treatment: 'Not documented',
        progress: 'Not documented'
      };
    }

    const firstNote = dailyNotes[0];
    const lastNote = dailyNotes[dailyNotes.length - 1];

    // Extract subjective complaints from first note
    const chiefComplaint = firstNote.subjective ||
                          journeyData.metadata?.chiefComplaint ||
                          'Patient presented for evaluation and management';

    // Build clinical history from notes
    const historyParts = [];
    dailyNotes.forEach(note => {
      if (note.subjective) {
        historyParts.push(note.subjective);
      }
    });
    const history = historyParts.slice(0, 3).join('. ') || 'History of present illness not detailed';

    // Compile findings from objective sections
    const findingsParts = [];
    dailyNotes.forEach(note => {
      if (note.objective) {
        findingsParts.push(note.objective);
      }
    });
    const findings = findingsParts.join('. ') || 'Physical examination findings documented in daily notes';

    // Compile treatment provided
    const treatmentParts = [];
    dailyNotes.forEach(note => {
      if (note.plan) {
        treatmentParts.push(note.plan);
      }
    });
    const treatment = treatmentParts.slice(0, 3).join('. ') || 'Treatment plan documented in daily notes';

    // Compile hospital course
    const progressParts = [];
    dailyNotes.forEach((note, index) => {
      if (note.assessment) {
        progressParts.push(`Day ${index + 1}: ${note.assessment}`);
      }
    });
    const progress = progressParts.join('. ') || 'Clinical progress documented in daily notes';

    return {
      chiefComplaint,
      history,
      findings,
      treatment,
      progress
    };
  }

  /**
   * Compile discharge status
   */
  compileDischargeStatus(journeyData, dailyNotes) {
    const lastNote = dailyNotes[dailyNotes.length - 1];

    // Determine condition at discharge based on last assessment
    let condition = 'stable';
    if (lastNote && lastNote.assessment) {
      const assessment = lastNote.assessment.toLowerCase();
      if (assessment.includes('improved') || assessment.includes('better')) {
        condition = 'improved';
      } else if (assessment.includes('stable') || assessment.includes('maintained')) {
        condition = 'stable';
      } else if (assessment.includes('worse') || assessment.includes('deteriorated')) {
        condition = 'deteriorated';
      }
    }

    return {
      condition,
      instructions: [
        'Continue all medications as prescribed',
        'Follow up with primary care provider within 1 week',
        'Call if any worsening symptoms or concerns',
        'Keep discharge summary accessible for all healthcare providers'
      ],
      restrictions: [
        'No driving until cleared by treating physician',
        'No heavy lifting for 2 weeks',
        'Limit alcohol consumption',
        'Follow dietary recommendations provided'
      ]
    };
  }

  /**
   * Compile follow-up care plan
   */
  compileFollowUpCare(journeyData, dailyNotes) {
    return {
      appointments: [
        {
          type: 'Primary Care Follow-up',
          date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          provider: journeyData.attendingPhysician || 'Primary Care Physician'
        },
        {
          type: 'Specialist Follow-up',
          date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          provider: journeyData.department || 'Relevant Specialist'
        }
      ],
      medications: [
        {
          name: 'All prescribed medications',
          instructions: 'Take exactly as directed, do not stop without consulting physician'
        }
      ],
      monitoring: [
        'Monitor vital signs daily for first week',
        'Watch for medication side effects',
        'Report any new or worsening symptoms',
        'Keep follow-up appointments'
      ]
    };
  }

  /**
   * Fetch journey notes from database
   */
  async fetchJourneyNotes(journeyId) {
    try {
      // This would integrate with your daily notes repository
      // For now, return empty array
      return [];
    } catch (error) {
      this.log('Failed to fetch journey notes', { error: error.message });
      return [];
    }
  }

  /**
   * Export discharge summary to PDF
   */
  async exportToPDF(dischargeSummary) {
    try {
      this.log('Exporting discharge summary to PDF', { summaryId: dischargeSummary.id });

      // This would integrate with a PDF generation library
      // For now, return placeholder
      return {
        format: 'pdf',
        filename: `discharge-summary-${dischargeSummary.journeyId}.pdf`,
        generatedAt: new Date().toISOString()
      };

    } catch (error) {
      this.log('PDF export failed', { error: error.message });
      throw new Error(`Failed to export PDF: ${error.message}`);
    }
  }

  /**
   * Export discharge summary to Word
   */
  async exportToWord(dischargeSummary) {
    try {
      this.log('Exporting discharge summary to Word', { summaryId: dischargeSummary.id });

      // This would integrate with a Word document generation library
      // For now, return placeholder
      return {
        format: 'word',
        filename: `discharge-summary-${dischargeSummary.journeyId}.docx`,
        generatedAt: new Date().toISOString()
      };

    } catch (error) {
      this.log('Word export failed', { error: error.message });
      throw new Error(`Failed to export Word: ${error.message}`);
    }
  }

  /**
   * Logging utility
   */
  log(message, data = {}) {
    console.log(`[${this.name}] ${message}`, data);
  }

  /**
   * Get service version
   */
  get version() {
    return '1.0.0';
  }
}

module.exports = DischargeSummaryService;