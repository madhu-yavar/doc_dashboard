/**
 * Alert Formatter Tool
 * Formats prescription data into pharmacy alert content
 * Used by EmailNotifier and WhatsAppNotifier
 */

class AlertFormatter {
  constructor(config = {}) {
    this.config = {
      dashboardBaseUrl: process.env.DASHBOARD_BASE_URL || 'http://localhost:8001',
      ...config
    };
  }

  /**
   * Format alert content from dashboard data
   * @param {object} dashboardData - Processed prescription data
   * @returns {object} Formatted alert content
   */
  formatAlert(dashboardData) {
    const patient = this.extractPatientInfo(dashboardData);
    const doctor = this.extractDoctorInfo(dashboardData);
    const medications = this.extractMedications(dashboardData);
    const diagnosis = this.extractDiagnosis(dashboardData);
    const rxDate = this.extractRxDate(dashboardData);
    const dashboardLink = this.buildDashboardLink(dashboardData);
    const instructions = this.extractInstructions(dashboardData);
    const urgency = this.determineUrgency(dashboardData);

    return {
      patient,
      doctor,
      medications,
      diagnosis,
      rxDate,
      dashboardLink,
      instructions,
      urgency
    };
  }

  /**
   * Extract patient information
   */
  extractPatientInfo(data) {
    const patient = data?.patient || {};
    return {
      name: this.cleanText(patient.name),
      age: patient.age || null,
      gender: patient.gender || null,
      mrn: patient.mrn || patient.hospital_no || null,
      contact: patient.contact || null
    };
  }

  /**
   * Extract doctor information
   */
  extractDoctorInfo(data) {
    const doctor = data?.doctor || {};
    return {
      name: this.cleanText(doctor.name),
      department: doctor.department || doctor.specialty || null
    };
  }

  /**
   * Extract medications list
   */
  extractMedications(data) {
    const medications = data?.medications || [];

    return medications
      .filter(med => med && med.name)
      .map(med => ({
        name: this.cleanText(med.name),
        dose: med.dose || med.dosage || null,
        frequency: med.frequency || null,
        duration: med.duration || null,
        instructions: med.instructions || null
      }));
  }

  /**
   * Extract diagnosis
   */
  extractDiagnosis(data) {
    const diagnosis = data?.diagnosis || {};

    // Primary diagnosis
    const principal = this.cleanText(diagnosis.principal);

    // If no principal, try to build from symptoms
    if (!principal && diagnosis.symptoms && diagnosis.symptoms.length > 0) {
      return diagnosis.symptoms.slice(0, 3).join(', ');
    }

    return principal;
  }

  /**
   * Extract prescription date
   */
  extractRxDate(data) {
    const meta = data?.meta || {};
    const visit = data?.visit || data?.patient || {};

    return meta.rx_date || visit.date || null;
  }

  /**
   * Build dashboard link for the prescription
   */
  buildDashboardLink(data) {
    const documentId = data?.documentId || data?.id;
    const patientMrn = data?.patient?.mrn;

    if (!documentId && !patientMrn) {
      return null;
    }

    // In production, you would build a real link to your dashboard
    // For now, return a placeholder
    if (documentId) {
      return `${this.config.dashboardBaseUrl}/document/${documentId}`;
    }
    return `${this.config.dashboardBaseUrl}/patient/${patientMrn}`;
  }

  /**
   * Extract additional instructions
   */
  extractInstructions(data) {
    const instructions = [];

    // Check clinical notes for instructions
    const notes = data?.clinical_notes || [];
    const instructionNotes = notes.filter(note =>
      note.type &&
      (note.type.toLowerCase().includes('advice') ||
       note.type.toLowerCase().includes('instruction') ||
       note.type.toLowerCase().includes('follow-up'))
    );

    for (const note of instructionNotes.slice(0, 3)) {
      const text = this.cleanText(note.summary);
      if (text && !instructions.includes(text)) {
        instructions.push(text);
      }
    }

    return instructions.length > 0 ? instructions.join('. ') : null;
  }

  /**
   * Determine urgency level based on medications/diagnosis
   * Returns: 'high', 'normal', or null
   */
  determineUrgency(data) {
    const medications = data?.medications || [];
    const diagnosis = (data?.diagnosis?.principal || '').toLowerCase();

    // High urgency keywords
    const urgentKeywords = [
      'emergency', 'urgent', 'stat', 'immediately',
      'critical', 'severe', 'acute'
    ];

    // Check diagnosis for urgency
    if (urgentKeywords.some(kw => diagnosis.includes(kw))) {
      return 'high';
    }

    // Check for certain medication types that might be urgent
    const urgentMeds = [
      'epinephrine', 'adrenaline', 'nitroglycerin',
      'insulin', 'glucose', 'dextrose'
    ];

    const hasUrgentMeds = medications.some(med =>
      urgentMeds.some(um => (med.name || '').toLowerCase().includes(um))
    );

    if (hasUrgentMeds) {
      return 'high';
    }

    return 'normal';
  }

  /**
   * Clean text by removing extra whitespace
   */
  cleanText(text) {
    if (!text || typeof text !== 'string') return null;
    return text.trim().replace(/\s+/g, ' ') || null;
  }
}

module.exports = AlertFormatter;
