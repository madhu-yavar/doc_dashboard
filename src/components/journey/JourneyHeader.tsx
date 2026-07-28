/**
 * Journey Header Component - Phase 6: Frontend Components
 *
 * Displays journey overview and patient information.
 * Provides quick actions and status updates.
 *
 * Features:
 * - Patient information display
 * - Journey status tracking
 * - Quick action buttons
 * - Progress indicators
 * - Mobile-responsive design
 */

import React, { useState } from 'react';
import './JourneyHeader.css';

interface PatientInfo {
  id: string;
  name: string;
  age?: number;
  gender?: string;
  bloodType?: string;
  allergies?: string[];
}

interface JourneyData {
  id: string;
  patientId: string;
  patientName: string;
  status: 'admitting' | 'active' | 'discharged' | 'transferred';
  admissionDate: string;
  dischargeDate?: string;
  currentLocation: string;
  department: string;
  attendingPhysician: string;
  diagnosis?: string;
  lengthOfStay?: number;
  metadata?: Record<string, any>;
}

interface JourneyHeaderProps {
  journey: JourneyData;
  onUpdate?: () => void;
  onPaperCapture?: () => void;
  onVoiceCapture?: () => void;
}

export const JourneyHeader: React.FC<JourneyHeaderProps> = ({
  journey,
  onUpdate,
  onPaperCapture,
  onVoiceCapture
}) => {
  const [showActions, setShowActions] = useState(false);

  const calculateLengthOfStay = () => {
    const admission = new Date(journey.admissionDate);
    const discharge = journey.dischargeDate ? new Date(journey.dischargeDate) : new Date();
    const days = Math.ceil((discharge.getTime() - admission.getTime()) / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
  };

  const getStatusColor = () => {
    switch (journey.status) {
      case 'active': return 'green';
      case 'admitting': return 'blue';
      case 'discharged': return 'gray';
      case 'transferred': return 'orange';
      default: return 'gray';
    }
  };

  const handleStatusUpdate = async (newStatus: string) => {
    try {
      const response = await fetch(`/api/journeys/${journey.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        onUpdate && onUpdate();
      }
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const handleDischarge = async () => {
    if (!confirm('Are you sure you want to discharge this patient?')) return;

    try {
      const response = await fetch(`/api/journeys/${journey.id}/discharge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dischargeReason: 'Treatment completed',
          dischargeDate: new Date().toISOString()
        })
      });

      if (response.ok) {
        onUpdate && onUpdate();
      }
    } catch (error) {
      console.error('Failed to discharge patient:', error);
    }
  };

  const lengthOfStay = journey.lengthOfStay || calculateLengthOfStay();

  return (
    <div className="journey-header">
      <div className="journey-header-back">
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
      </div>
      <div className="journey-header-main">
        {/* Patient Information */}
        <div className="patient-info">
          <div className="patient-avatar">
            <div className="avatar-placeholder">
              {journey.patientName.charAt(0).toUpperCase()}
            </div>
          </div>
          <div className="patient-details">
            <h1 className="patient-name">{journey.patientName}</h1>
            <p className="patient-id">Patient ID: {journey.patientId}</p>
            <div className="patient-meta">
              <span className="meta-item">
                📍 {journey.currentLocation}
              </span>
              <span className="meta-item">
                🏥 {journey.department}
              </span>
              <span className="meta-item">
                👨‍⚕️ {journey.attendingPhysician}
              </span>
            </div>
          </div>
        </div>

        {/* Status Information */}
        <div className="journey-status">
          <div className={`status-indicator status-${getStatusColor()}`}>
            <span className="status-dot"></span>
            <span className="status-text">{journey.status}</span>
          </div>
          <div className="length-of-stay">
            <span className="los-number">{lengthOfStay}</span>
            <span className="los-label">days</span>
          </div>
        </div>
      </div>

      {/* Journey Details */}
      <div className="journey-details">
        <div className="detail-row">
          <span className="detail-label">Admitted:</span>
          <span className="detail-value">
            {new Date(journey.admissionDate).toLocaleDateString()}
          </span>
        </div>
        {journey.dischargeDate && (
          <div className="detail-row">
            <span className="detail-label">Discharged:</span>
            <span className="detail-value">
              {new Date(journey.dischargeDate).toLocaleDateString()}
            </span>
          </div>
        )}
        {journey.diagnosis && (
          <div className="detail-row">
            <span className="detail-label">Diagnosis:</span>
            <span className="detail-value">{journey.diagnosis}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="journey-actions">
        <div className="actions-primary">
          <button
            className="action-btn action-paper"
            onClick={onPaperCapture}
            disabled={journey.status === 'discharged'}
          >
            📄 Capture Paper Note
          </button>
          <button
            className="action-btn action-voice"
            onClick={onVoiceCapture}
            disabled={journey.status === 'discharged'}
          >
            🎤 Voice Note
          </button>
        </div>

        <div className="actions-secondary">
          <button
            className="action-btn action-refresh"
            onClick={onUpdate}
          >
            🔄 Refresh
          </button>
          <button
            className="action-btn action-menu"
            onClick={() => setShowActions(!showActions)}
          >
            ⋯
          </button>
        </div>

        {showActions && (
          <div className="dropdown-menu">
            <button
              className="dropdown-item"
              onClick={() => handleStatusUpdate('active')}
              disabled={journey.status === 'active'}
            >
              ✓ Mark as Active
            </button>
            <button
              className="dropdown-item"
              onClick={() => handleStatusUpdate('transferred')}
              disabled={journey.status === 'transferred'}
            >
              ⇄ Transfer Patient
            </button>
            <button
              className="dropdown-item"
              onClick={handleDischarge}
              disabled={journey.status === 'discharged'}
            >
              🏠 Discharge Patient
            </button>
          </div>
        )}
      </div>

      {/* Progress Bar */}
      <div className="journey-progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.min(lengthOfStay / 14 * 100, 100)}%` }}></div>
        </div>
        <div className="progress-labels">
          <span>Admission</span>
          <span>Day {lengthOfStay}</span>
          <span>Discharge</span>
        </div>
      </div>
    </div>
  );
};

export default JourneyHeader;