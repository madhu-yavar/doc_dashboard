/**
 * Department Alert Formatter Tool
 * Formats prescription data into department-specific alert content
 * Supports: Lab, Radiology, Nuclear Medicine, Procedures
 */

class DepartmentAlertFormatter {
  constructor(config = {}) {
    this.config = {
      dashboardBaseUrl: process.env.DASHBOARD_BASE_URL || 'http://localhost:8001',
      ...config
    };
  }

  /**
   * Format alert content for a specific department
   * @param {string} department - 'lab' | 'radiology' | 'nuclear_medicine' | 'procedures'
   * @param {object} dashboardData - Processed prescription data
   * @returns {object} Formatted alert content
   */
  formatAlert(department, dashboardData) {
    const baseInfo = {
      patient: this.extractPatientInfo(dashboardData),
      doctor: this.extractDoctorInfo(dashboardData),
      rxDate: this.extractRxDate(dashboardData),
      diagnosis: this.extractDiagnosis(dashboardData),
      dashboardLink: this.buildDashboardLink(dashboardData),
      department: this.getDepartmentLabel(department),
      urgency: this.determineUrgency(dashboardData)
    };

    switch (department) {
      case 'lab':
        return {
          ...baseInfo,
          department: 'Laboratory',
          departmentType: 'lab',
          items: this.extractLabTests(dashboardData),
          itemCount: this.extractLabTests(dashboardData).length
        };

      case 'radiology':
        return {
          ...baseInfo,
          department: 'Radiology',
          departmentType: 'radiology',
          items: this.extractRadiologyStudies(dashboardData),
          itemCount: this.extractRadiologyStudies(dashboardData).length
        };

      case 'nuclear_medicine':
        return {
          ...baseInfo,
          department: 'Nuclear Medicine',
          departmentType: 'nuclear_medicine',
          items: this.extractNuclearStudies(dashboardData),
          itemCount: this.extractNuclearStudies(dashboardData).length
        };

      case 'procedures':
        return {
          ...baseInfo,
          department: 'Procedures / Interventional',
          departmentType: 'procedures',
          items: this.extractProcedures(dashboardData),
          itemCount: this.extractProcedures(dashboardData).length
        };

      default:
        throw new Error(`Unknown department: ${department}`);
    }
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
   * Extract lab tests
   */
  extractLabTests(data) {
    const investigations = data?.investigations || [];
    return investigations
      .filter(item => item.status === 'ordered')
      .map(item => ({
        name: this.textFromValue(item.test_name || item.name || item.type || item.label),
        priority: item.priority || 'routine',
        isUncertain: item.is_uncertain || false
      }))
      .filter(item => item.name);
  }

  /**
   * Extract radiology studies
   */
  extractRadiologyStudies(data) {
    const radiology = data?.radiology || [];
    return radiology
      .filter(item => item.status === 'ordered')
      .map(item => ({
        name: this.textFromValue(item.study_name || item.name || item.type || item.label),
        isUncertain: item.is_uncertain || false
      }))
      .filter(item => item.name);
  }

  /**
   * Extract nuclear medicine studies
   */
  extractNuclearStudies(data) {
    const nuclear = data?.nuclear_medicine || [];
    return nuclear
      .filter(item => item.status === 'ordered')
      .map(item => ({
        name: this.textFromValue(item.study_name || item.name || item.type || item.label),
        isUncertain: item.is_uncertain || false
      }))
      .filter(item => item.name);
  }

  /**
   * Extract procedures
   */
  extractProcedures(data) {
    const procedures = data?.procedures || [];
    return procedures
      .filter(item => item.status === 'ordered' || item.status === 'mentioned')
      .map(item => ({
        name: typeof item === 'string' ? item : (item.name || ''),
        category: typeof item === 'object' ? (item.category || '') : '',
        isUncertain: typeof item === 'object' ? (item.is_uncertain || false) : false
      }))
      .filter(p => p.name);
  }

  /**
   * Extract diagnosis
   */
  extractDiagnosis(data) {
    const diagnosis = data?.diagnosis || {};
    return this.cleanText(this.textFromValue(diagnosis.principal)) || null;
  }

  /**
   * Extract prescription date
   */
  extractRxDate(data) {
    const meta = data?.meta || {};
    return meta.rx_date || meta.visit_date || null;
  }

  /**
   * Build dashboard link
   */
  buildDashboardLink(data) {
    const documentId = data?.documentId || data?.id;
    const patientMrn = data?.patient?.mrn;

    if (!documentId && !patientMrn) return null;

    if (documentId) {
      return `${this.config.dashboardBaseUrl}/document/${documentId}`;
    }
    return `${this.config.dashboardBaseUrl}/patient/${patientMrn}`;
  }

  /**
   * Get department display label
   */
  getDepartmentLabel(department) {
    const labels = {
      lab: 'Laboratory',
      radiology: 'Radiology / Imaging',
      nuclear_medicine: 'Nuclear Medicine',
      procedures: 'Procedures / Interventional Radiology'
    };
    return labels[department] || department;
  }

  /**
   * Determine urgency level
   */
  determineUrgency(data) {
    const diagnosis = this.textFromValue(data?.diagnosis?.principal).toLowerCase();
    const urgentKeywords = ['emergency', 'urgent', 'stat', 'immediately', 'critical', 'severe'];

    if (urgentKeywords.some(kw => diagnosis.includes(kw))) {
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

  textFromValue(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (!value || typeof value !== 'object') return '';

    return this.cleanText(
      value.name ||
      value.description ||
      value.label ||
      value.text ||
      value.value ||
      value.summary ||
      ''
    ) || '';
  }
}

module.exports = DepartmentAlertFormatter;
