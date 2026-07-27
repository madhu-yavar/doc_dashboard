/**
 * Inpatient Journey Page - Phase 6: Frontend Components
 *
 * Main page for inpatient journey management.
 * Provides comprehensive view of patient journey from admission to discharge.
 *
 * Features:
 * - Journey overview and status tracking
 * - Daily notes timeline with multiple input methods
 * - Department integration status
 * - Real-time updates and notifications
 * - Mobile-responsive design
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './InpatientJourney.css';

// Components (to be implemented)
import { JourneyHeader } from '../components/journey/JourneyHeader';
import { DailyNotesTimeline } from '../components/journey/DailyNotesTimeline';
import { PaperNoteCapture } from '../components/journey/PaperNoteCapture';
import { VoiceNoteCapture } from '../components/journey/VoiceNoteCapture';
import { DepartmentIntegrations } from '../components/journey/DepartmentIntegrations';
import { JourneyAnalytics } from '../components/journey/JourneyAnalytics';
import { DischargeSummary } from '../components/journey/DischargeSummary';

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
  metadata?: Record<string, any>;
}

interface InpatientJourneyProps {
  apiBaseUrl?: string;
}

export const InpatientJourney: React.FC<InpatientJourneyProps> = ({
  apiBaseUrl = 'http://localhost:3000'
}) => {
  const { journeyId } = useParams<{ journeyId: string }>();
  const navigate = useNavigate();

  // State management
  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'notes' | 'integrations' | 'analytics' | 'discharge'>('overview');

  // Modal states
  const [showPaperCapture, setShowPaperCapture] = useState(false);
  const [showVoiceCapture, setShowVoiceCapture] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // Fetch journey data
  useEffect(() => {
    fetchJourneyData();
  }, [journeyId]);

  const fetchJourneyData = async () => {
    if (!journeyId) return;

    setLoading(true);
    setError(null);

    try {
      // For new journeys, create a blank journey structure
      if (isNewJourney) {
        const newJourney: JourneyData = {
          id: journeyId,
          patientId: 'new_patient',
          patientName: 'New Patient Journey',
          status: 'admitting',
          admissionDate: new Date().toISOString(),
          currentLocation: 'TBD',
          department: 'TBD',
          attendingPhysician: 'TBD',
          diagnosis: 'Pending admission assessment'
        };
        setJourney(newJourney);
        setLoading(false);
        return;
      }

      const response = await fetch(`${apiBaseUrl}/api/journeys/${journeyId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch journey data');
      }

      const data = await response.json();
      setJourney(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load journey');
      console.error('Error fetching journey:', err);
    } finally {
      setLoading(false);
    }
  };

  // Tab handlers
  const handleTabChange = (tab: 'overview' | 'notes' | 'integrations' | 'analytics' | 'discharge') => {
    setActiveTab(tab);
  };

  // Check if this is a new journey
  const isNewJourney = journeyId?.startsWith('journey_');

  // Action handlers
  const handlePaperCapture = () => {
    setShowPaperCapture(true);
  };

  const handleVoiceCapture = () => {
    setShowVoiceCapture(true);
  };

  const handleCloseModals = () => {
    setShowPaperCapture(false);
    setShowVoiceCapture(false);
    setSelectedNoteId(null);
  };

  const handleNoteCreated = () => {
    // Refresh journey data after note creation
    fetchJourneyData();
    handleCloseModals();
  };

  const handleJourneyUpdate = () => {
    fetchJourneyData();
  };

  // Loading state
  if (loading) {
    return (
      <div className="inpatient-journey-loading">
        <div className="loading-spinner"></div>
        <p>Loading journey data...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="inpatient-journey-error">
        <h2>Unable to Load Journey</h2>
        <p>{error}</p>
        <button onClick={() => navigate('/upload')} className="btn-back">
          Back to Upload Center
        </button>
      </div>
    );
  }

  // No journey found
  if (!journey) {
    return (
      <div className="inpatient-journey-not-found">
        <h2>Journey Not Found</h2>
        <p>No journey found with ID: {journeyId}</p>
        <button onClick={() => navigate('/upload')} className="btn-back">
          Back to Upload Center
        </button>
      </div>
    );
  }

  return (
    <div className="inpatient-journey-page">
      {/* Back Button Header */}
      <div className="journey-page-header">
        <div className="container">
          <button onClick={() => navigate('/upload')} className="back-button">
            ← Back to Upload Center
          </button>
        </div>
      </div>

      {/* Journey Header */}
      <JourneyHeader
        journey={journey}
        onUpdate={handleJourneyUpdate}
        onPaperCapture={handlePaperCapture}
        onVoiceCapture={handleVoiceCapture}
      />

      {/* Navigation Tabs */}
      <div className="journey-tabs">
        <button
          className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => handleTabChange('overview')}
        >
          📊 Overview
        </button>
        <button
          className={`tab-button ${activeTab === 'notes' ? 'active' : ''}`}
          onClick={() => handleTabChange('notes')}
        >
          📝 Daily Notes
        </button>
        <button
          className={`tab-button ${activeTab === 'integrations' ? 'active' : ''}`}
          onClick={() => handleTabChange('integrations')}
        >
          🔗 Integrations
        </button>
        <button
          className={`tab-button ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => handleTabChange('analytics')}
        >
          📈 Analytics
        </button>
        <button
          className={`tab-button ${activeTab === 'discharge' ? 'active' : ''}`}
          onClick={() => handleTabChange('discharge')}
        >
          📋 Discharge Summary
        </button>
      </div>

      {/* Tab Content */}
      <div className="journey-content">
        {activeTab === 'overview' && (
          <div className="overview-tab">
            <JourneyAnalytics journeyId={journey.id} />
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="notes-tab">
            <DailyNotesTimeline
              journeyId={journey.id}
              onNoteClick={setSelectedNoteId}
              onPaperCapture={handlePaperCapture}
              onVoiceCapture={handleVoiceCapture}
            />
          </div>
        )}

        {activeTab === 'integrations' && (
          <div className="integrations-tab">
            <DepartmentIntegrations journeyId={journey.id} />
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="analytics-tab">
            <JourneyAnalytics journeyId={journey.id} detailed />
          </div>
        )}

        {activeTab === 'discharge' && (
          <div className="discharge-tab">
            <DischargeSummary
              journeyId={journey.id}
              patientId={journey.patientId}
              journeyData={journey}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {showPaperCapture && (
        <PaperNoteCapture
          journeyId={journey.id}
          patientId={journey.patientId}
          onClose={handleCloseModals}
          onComplete={handleNoteCreated}
        />
      )}

      {showVoiceCapture && (
        <VoiceNoteCapture
          journeyId={journey.id}
          patientId={journey.patientId}
          onClose={handleCloseModals}
          onComplete={handleNoteCreated}
        />
      )}
    </div>
  );
};

export default InpatientJourney;