/**
 * Discharge Summary Component - Phase 6 Enhancement
 *
 * Component for generating and managing discharge summaries.
 * Integrates with daily notes, journey data, and clinical information.
 *
 * Features:
 * - Automatic discharge summary generation
 * - Clinical data compilation
 * - Medication reconciliation
 * - Follow-up care planning
 * - Export and printing capabilities
 */

import React, { useState, useEffect } from 'react';
import { FileText, Download, Printer, Send, Plus, CheckCircle, AlertCircle } from 'lucide-react';
import './DischargeSummary.css';

interface DischargeSummaryProps {
  journeyId: string;
  patientId: string;
  journeyData: any;
  apiBaseUrl?: string;
}

interface DischargeData {
  patientInfo: {
    name: string;
    mrn: string;
    age: number;
    gender: string;
    admissionDate: string;
    dischargeDate: string;
    lengthOfStay: number;
  };
  diagnosis: {
    admission: string;
    final: string;
    secondary: string[];
  };
  procedures: Array<{
    name: string;
    date: string;
    complications?: string;
  }>;
  medications: {
    admission: Array<{ name: string; dosage: string; frequency: string }>;
    discharge: Array<{ name: string; dosage: string; frequency: string; instructions: string }>;
    reconciled: boolean;
  };
  clinicalCourse: {
    chiefComplaint: string;
    history: string;
    findings: string;
    treatment: string;
    progress: string;
  };
  dischargeStatus: {
    condition: 'stable' | 'improved' | 'unchanged' | 'deteriorated';
    instructions: string[];
    restrictions: string[];
  };
  followUp: {
    appointments: Array<{ type: string; date: string; provider: string }>;
    medications: Array<{ name: string; instructions: string }>;
    monitoring: string[];
  };
  metadata: {
    generatedAt: string;
    generatedBy: string;
    reviewed: boolean;
    approved: boolean;
  };
}

export const DischargeSummary: React.FC<DischargeSummaryProps> = ({
  journeyId,
  patientId,
  journeyData,
  apiBaseUrl = 'http://localhost:8001'
}) => {
  const [dischargeData, setDischargeData] = useState<DischargeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [activeSection, setActiveSection] = useState<'summary' | 'medications' | 'followup' | 'export'>('summary');

  useEffect(() => {
    fetchDischargeSummary();
  }, [journeyId]);

  const fetchDischargeSummary = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/journeys/${journeyId}/discharge-summary`);
      if (response.ok) {
        const data = await response.json();
        setDischargeData(data);
      } else {
        // If no discharge summary exists, create a template from journey data
        createTemplateSummary();
      }
    } catch (error) {
      console.error('Error fetching discharge summary:', error);
      createTemplateSummary();
    } finally {
      setLoading(false);
    }
  };

  const createTemplateSummary = () => {
    const template: DischargeData = {
      patientInfo: {
        name: journeyData?.patientName || 'Patient Name',
        mrn: journeyData?.patientId || 'MRN',
        age: 0,
        gender: 'Unknown',
        admissionDate: journeyData?.admissionDate || new Date().toISOString(),
        dischargeDate: new Date().toISOString(),
        lengthOfStay: 0
      },
      diagnosis: {
        admission: journeyData?.diagnosis || 'Pending admission assessment',
        final: journeyData?.diagnosis || 'To be determined',
        secondary: []
      },
      procedures: [],
      medications: {
        admission: [],
        discharge: [],
        reconciled: false
      },
      clinicalCourse: {
        chiefComplaint: 'To be documented',
        history: 'To be documented',
        findings: 'To be documented',
        treatment: 'To be documented',
        progress: 'To be documented'
      },
      dischargeStatus: {
        condition: 'stable',
        instructions: ['Continue medications as prescribed', 'Follow up as scheduled'],
        restrictions: ['No driving until cleared by physician', 'Limited physical activity']
      },
      followUp: {
        appointments: [],
        medications: [],
        monitoring: ['Blood pressure monitoring', 'Medication adherence']
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        generatedBy: 'System',
        reviewed: false,
        approved: false
      }
    };

    setDischargeData(template);
  };

  const generateDischargeSummary = async () => {
    setGenerating(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/journeys/${journeyId}/generate-discharge-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          journeyData
        })
      });

      if (response.ok) {
        const data = await response.json();
        setDischargeData(data);
      }
    } catch (error) {
      console.error('Error generating discharge summary:', error);
    } finally {
      setGenerating(false);
    }
  };

  const exportDischargeSummary = async (format: 'pdf' | 'word') => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/journeys/${journeyId}/export-discharge-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format })
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `discharge-summary-${journeyId}.${format === 'pdf' ? 'pdf' : 'docx'}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Error exporting discharge summary:', error);
    }
  };

  if (loading) {
    return (
      <div className="discharge-summary-loading">
        <div className="loading-spinner"></div>
        <p>Loading discharge summary...</p>
      </div>
    );
  }

  if (!dischargeData) {
    return (
      <div className="discharge-summary-empty">
        <FileText className="empty-icon" />
        <h3>No Discharge Summary Available</h3>
        <p>Generate a comprehensive discharge summary from journey data.</p>
        <button
          className="generate-btn"
          onClick={generateDischargeSummary}
          disabled={generating}
        >
          {generating ? 'Generating...' : 'Generate Discharge Summary'}
        </button>
      </div>
    );
  }

  const getStatusColor = (condition: string) => {
    switch (condition) {
      case 'stable': return '#10B981';
      case 'improved': return '#3B82F6';
      case 'unchanged': return '#F59E0B';
      case 'deteriorated': return '#EF4444';
      default: return '#6B7280';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const calculateLOS = (admission: string, discharge: string) => {
    const admit = new Date(admission);
    const disch = new Date(discharge);
    return Math.ceil((disch.getTime() - admit.getTime()) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="discharge-summary">
      {/* Header */}
      <div className="discharge-header">
        <div className="header-left">
          <button
            className="back-nav-btn"
            onClick={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                window.location.href = '/upload';
              }
            }}
          >
            ← Back
          </button>
          <div className="header-title">
            <h2>📋 Discharge Summary</h2>
            <p>Patient: {dischargeData.patientInfo.name} | MRN: {dischargeData.patientInfo.mrn}</p>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="action-btn generate-btn"
            onClick={generateDischargeSummary}
            disabled={generating}
          >
            <Plus className="btn-icon" />
            {generating ? 'Regenerating...' : 'Regenerate'}
          </button>
          <button
            className="action-btn export-btn"
            onClick={() => exportDischargeSummary('pdf')}
          >
            <Download className="btn-icon" />
            Export PDF
          </button>
          <button
            className="action-btn print-btn"
            onClick={() => window.print()}
          >
            <Printer className="btn-icon" />
            Print
          </button>
        </div>
      </div>

      {/* Status Indicators */}
      <div className="status-indicators">
        <div className="status-item">
          {dischargeData.metadata.reviewed ? (
            <CheckCircle className="status-icon reviewed" />
          ) : (
            <AlertCircle className="status-icon pending" />
          )}
          <span>{dischargeData.metadata.reviewed ? 'Reviewed' : 'Pending Review'}</span>
        </div>
        <div className="status-item">
          {dischargeData.metadata.approved ? (
            <CheckCircle className="status-icon approved" />
          ) : (
            <AlertCircle className="status-icon pending" />
          )}
          <span>{dischargeData.metadata.approved ? 'Approved' : 'Pending Approval'}</span>
        </div>
      </div>

      {/* Content Tabs */}
      <div className="discharge-tabs">
        <button
          className={`discharge-tab-btn ${activeSection === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveSection('summary')}
        >
          Summary
        </button>
        <button
          className={`discharge-tab-btn ${activeSection === 'medications' ? 'active' : ''}`}
          onClick={() => setActiveSection('medications')}
        >
          Medications
        </button>
        <button
          className={`discharge-tab-btn ${activeSection === 'followup' ? 'active' : ''}`}
          onClick={() => setActiveSection('followup')}
        >
          Follow-up
        </button>
      </div>

      {/* Content Sections */}
      <div className="discharge-content">
        {activeSection === 'summary' && (
          <div className="summary-section">
            {/* Patient Information */}
            <div className="info-card">
              <h3>Patient Information</h3>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">Name:</span>
                  <span className="info-value">{dischargeData.patientInfo.name}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">MRN:</span>
                  <span className="info-value">{dischargeData.patientInfo.mrn}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Admission Date:</span>
                  <span className="info-value">{formatDate(dischargeData.patientInfo.admissionDate)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Discharge Date:</span>
                  <span className="info-value">{formatDate(dischargeData.patientInfo.dischargeDate)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Length of Stay:</span>
                  <span className="info-value">{calculateLOS(dischargeData.patientInfo.admissionDate, dischargeData.patientInfo.dischargeDate)} days</span>
                </div>
              </div>
            </div>

            {/* Diagnosis */}
            <div className="info-card">
              <h3>Diagnosis</h3>
              <div className="diagnosis-section">
                <div className="diagnosis-item">
                  <span className="diagnosis-label">Admission:</span>
                  <span className="diagnosis-value">{dischargeData.diagnosis.admission}</span>
                </div>
                <div className="diagnosis-item">
                  <span className="diagnosis-label">Final:</span>
                  <span className="diagnosis-value">{dischargeData.diagnosis.final}</span>
                </div>
                {dischargeData.diagnosis.secondary.length > 0 && (
                  <div className="diagnosis-item">
                    <span className="diagnosis-label">Secondary:</span>
                    <div className="diagnosis-list">
                      {dischargeData.diagnosis.secondary.map((dx, index) => (
                        <span key={index} className="diagnosis-value">{dx}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Clinical Course */}
            <div className="info-card">
              <h3>Clinical Course</h3>
              <div className="clinical-course">
                <div className="course-section">
                  <h4>Chief Complaint:</h4>
                  <p>{dischargeData.clinicalCourse.chiefComplaint}</p>
                </div>
                <div className="course-section">
                  <h4>History of Present Illness:</h4>
                  <p>{dischargeData.clinicalCourse.history}</p>
                </div>
                <div className="course-section">
                  <h4>Key Findings:</h4>
                  <p>{dischargeData.clinicalCourse.findings}</p>
                </div>
                <div className="course-section">
                  <h4>Treatment Provided:</h4>
                  <p>{dischargeData.clinicalCourse.treatment}</p>
                </div>
                <div className="course-section">
                  <h4>Hospital Course:</h4>
                  <p>{dischargeData.clinicalCourse.progress}</p>
                </div>
              </div>
            </div>

            {/* Discharge Status */}
            <div className="info-card">
              <h3>Discharge Status</h3>
              <div className="discharge-status">
                <div className="status-condition">
                  <span className="condition-label">Condition at Discharge:</span>
                  <div
                    className="condition-badge"
                    style={{ backgroundColor: getStatusColor(dischargeData.dischargeStatus.condition) }}
                  >
                    {dischargeData.dischargeStatus.condition.charAt(0).toUpperCase() +
                     dischargeData.dischargeStatus.condition.slice(1)}
                  </div>
                </div>
                <div className="instructions-section">
                  <h4>Discharge Instructions:</h4>
                  <ul>
                    {dischargeData.dischargeStatus.instructions.map((instruction, index) => (
                      <li key={index}>{instruction}</li>
                    ))}
                  </ul>
                </div>
                {dischargeData.dischargeStatus.restrictions.length > 0 && (
                  <div className="restrictions-section">
                    <h4>Activity Restrictions:</h4>
                    <ul>
                      {dischargeData.dischargeStatus.restrictions.map((restriction, index) => (
                        <li key={index}>{restriction}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeSection === 'medications' && (
          <div className="medications-section">
            <h3>Medication Reconciliation</h3>
            <div className="medication-reconciliation">
              <div className="med-category">
                <h4>Admission Medications</h4>
                {dischargeData.medications.admission.length > 0 ? (
                  <ul>
                    {dischargeData.medications.admission.map((med, index) => (
                      <li key={index}>
                        <strong>{med.name}</strong> - {med.dosage}, {med.frequency}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="no-medications">No admission medications documented</p>
                )}
              </div>

              <div className="med-category">
                <h4>Discharge Medications</h4>
                {dischargeData.medications.discharge.length > 0 ? (
                  <ul>
                    {dischargeData.medications.discharge.map((med, index) => (
                      <li key={index}>
                        <strong>{med.name}</strong> - {med.dosage}, {med.frequency}
                        {med.instructions && <span className="med-instructions"> ({med.instructions})</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="no-medications">No discharge medications prescribed</p>
                )}
              </div>
            </div>

            <div className="reconciliation-status">
              {dischargeData.medications.reconciled ? (
                <div className="status-success">
                  <CheckCircle className="status-icon" />
                  <span>Medication reconciliation completed</span>
                </div>
              ) : (
                <div className="status-warning">
                  <AlertCircle className="status-icon" />
                  <span>Medication reconciliation pending</span>
                </div>
              )}
            </div>
          </div>
        )}

        {activeSection === 'followup' && (
          <div className="followup-section">
            <h3>Follow-up Care Plan</h3>

            {dischargeData.followUp.appointments.length > 0 && (
              <div className="followup-category">
                <h4>Scheduled Appointments</h4>
                <div className="appointments-list">
                  {dischargeData.followUp.appointments.map((appointment, index) => (
                    <div key={index} className="appointment-card">
                      <div className="appointment-type">{appointment.type}</div>
                      <div className="appointment-details">
                        <div>Date: {formatDate(appointment.date)}</div>
                        <div>Provider: {appointment.provider}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {dischargeData.followUp.medications.length > 0 && (
              <div className="followup-category">
                <h4>Medication Follow-up</h4>
                <ul>
                  {dischargeData.followUp.medications.map((med, index) => (
                    <li key={index}>
                      <strong>{med.name}</strong> - {med.instructions}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {dischargeData.followUp.monitoring.length > 0 && (
              <div className="followup-category">
                <h4>Home Monitoring</h4>
                <ul>
                  {dischargeData.followUp.monitoring.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="followup-actions">
              <button className="action-btn primary-btn">
                <Send className="btn-icon" />
                Send to Patient
              </button>
              <button className="action-btn secondary-btn">
                <Plus className="btn-icon" />
                Add Follow-up
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DischargeSummary;