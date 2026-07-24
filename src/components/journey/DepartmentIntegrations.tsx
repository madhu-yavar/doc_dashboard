/**
 * Department Integrations Component - Phase 6: Frontend Components
 *
 * Component for displaying and managing department integrations
 * for inpatient journeys.
 *
 * Features:
 * - Integration status dashboard
 * - Department-specific data synchronization
 * - Real-time sync status
 * - Error handling and retry mechanisms
 * - Integration health monitoring
 */

import React, { useState, useEffect } from 'react';
import './DepartmentIntegrations.css';

interface DepartmentIntegration {
  id: string;
  departmentName: string;
  integrationType: 'electronic_health_record' | 'laboratory' | 'radiology' | 'pharmacy' | 'billing';
  status: 'active' | 'inactive' | 'error' | 'syncing';
  lastSync?: string;
  nextSync?: string;
  syncFrequency: string;
  errorMessage?: string;
  configuration: Record<string, any>;
  metadata?: Record<string, any>;
}

interface DepartmentIntegrationsProps {
  journeyId: string;
  apiBaseUrl?: string;
}

export const DepartmentIntegrations: React.FC<DepartmentIntegrationsProps> = ({
  journeyId,
  apiBaseUrl = 'http://localhost:3000'
}) => {
  const [integrations, setIntegrations] = useState<DepartmentIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIntegration, setSelectedIntegration] = useState<DepartmentIntegration | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchIntegrations();
  }, [journeyId]);

  const fetchIntegrations = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/department-integrations/journey/${journeyId}`);
      if (response.ok) {
        const data = await response.json();
        setIntegrations(data.integrations || []);
      } else {
        throw new Error('Failed to fetch integrations');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
      console.error('Error fetching integrations:', err);
    } finally {
      setLoading(false);
    }
  };

  const getDepartmentIcon = (integrationType: string) => {
    switch (integrationType) {
      case 'electronic_health_record': return '🏥';
      case 'laboratory': return '🔬';
      case 'radiology': return '📡';
      case 'pharmacy': return '💊';
      case 'billing': return '💰';
      default: return '🔗';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#10B981';
      case 'syncing': return '#3B82F6';
      case 'error': return '#EF4444';
      case 'inactive': return '#6B7280';
      default: return '#6B7280';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active': return 'Active';
      case 'syncing': return 'Syncing...';
      case 'error': return 'Error';
      case 'inactive': return 'Inactive';
      default: return status;
    }
  };

  const handleSyncNow = async (integrationId: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/department-integrations/${integrationId}/sync`, {
        method: 'POST'
      });

      if (response.ok) {
        // Refresh integrations to show updated status
        fetchIntegrations();
      } else {
        throw new Error('Failed to trigger sync');
      }
    } catch (err) {
      console.error('Error triggering sync:', err);
      alert('Failed to trigger synchronization');
    }
  };

  const handleViewDetails = (integration: DepartmentIntegration) => {
    setSelectedIntegration(integration);
    setShowDetails(true);
  };

  const handleCloseDetails = () => {
    setShowDetails(false);
    setSelectedIntegration(null);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="department-integrations-loading">
        <div className="loading-spinner"></div>
        <p>Loading integrations...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="department-integrations-error">
        <h4>Unable to Load Integrations</h4>
        <p>{error}</p>
        <button onClick={fetchIntegrations} className="retry-btn">Retry</button>
      </div>
    );
  }

  return (
    <div className="department-integrations">
      <div className="integrations-header">
        <div className="header-left">
          <button
            className="back-nav-btn"
            onClick={() => {
              window.location.href = '/upload';
            }}
          >
            ← Back
          </button>
          <div>
            <h3>Department Integrations</h3>
            <p>Monitor and manage department data synchronization</p>
          </div>
        </div>
      </div>

      {integrations.length === 0 ? (
        <div className="empty-integrations">
          <div className="empty-icon">🔗</div>
          <h4>No Integrations Configured</h4>
          <p>This journey has no department integrations set up yet.</p>
          <button className="setup-btn">Setup Integration</button>
        </div>
      ) : (
        <div className="integrations-grid">
          {integrations.map((integration) => (
            <div
              key={integration.id}
              className={`integration-card ${integration.status}`}
              onClick={() => handleViewDetails(integration)}
            >
              <div className="integration-header">
                <div className="integration-icon">
                  {getDepartmentIcon(integration.integrationType)}
                </div>
                <div className="integration-info">
                  <h4>{integration.departmentName}</h4>
                  <p className="integration-type">{integration.integrationType.replace(/_/g, ' ')}</p>
                </div>
                <div className="integration-status">
                  <div
                    className="status-indicator"
                    style={{ backgroundColor: getStatusColor(integration.status) }}
                  ></div>
                  <span className="status-label">{getStatusLabel(integration.status)}</span>
                </div>
              </div>

              <div className="integration-details">
                <div className="detail-row">
                  <span className="detail-label">Last Sync:</span>
                  <span className="detail-value">{formatDate(integration.lastSync)}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Next Sync:</span>
                  <span className="detail-value">{formatDate(integration.nextSync)}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Frequency:</span>
                  <span className="detail-value">{integration.syncFrequency}</span>
                </div>
              </div>

              {integration.status === 'error' && integration.errorMessage && (
                <div className="error-message">
                  <div className="error-icon">⚠️</div>
                  <p>{integration.errorMessage}</p>
                </div>
              )}

              <div className="integration-actions">
                <button
                  className="action-btn sync-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSyncNow(integration.id);
                  }}
                  disabled={integration.status === 'syncing'}
                >
                  {integration.status === 'syncing' ? 'Syncing...' : 'Sync Now'}
                </button>
                <button className="action-btn config-btn">
                  Configure
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Details Modal */}
      {showDetails && selectedIntegration && (
        <div className="details-modal" onClick={handleCloseDetails}>
          <div className="details-content" onClick={(e) => e.stopPropagation()}>
            <div className="details-header">
              <div className="header-icon">
                {getDepartmentIcon(selectedIntegration.integrationType)}
              </div>
              <div className="header-info">
                <h3>{selectedIntegration.departmentName}</h3>
                <p>{selectedIntegration.integrationType.replace(/_/g, ' ')}</p>
              </div>
              <button className="close-btn" onClick={handleCloseDetails}>✕</button>
            </div>

            <div className="details-body">
              <div className="details-section">
                <h4>Integration Status</h4>
                <div className="status-details">
                  <div className="status-row">
                    <span>Current Status:</span>
                    <span className={`status-badge ${selectedIntegration.status}`}>
                      {getStatusLabel(selectedIntegration.status)}
                    </span>
                  </div>
                  <div className="status-row">
                    <span>Last Successful Sync:</span>
                    <span>{formatDate(selectedIntegration.lastSync)}</span>
                  </div>
                  <div className="status-row">
                    <span>Next Scheduled Sync:</span>
                    <span>{formatDate(selectedIntegration.nextSync)}</span>
                  </div>
                  <div className="status-row">
                    <span>Sync Frequency:</span>
                    <span>{selectedIntegration.syncFrequency}</span>
                  </div>
                </div>
              </div>

              {selectedIntegration.errorMessage && (
                <div className="details-section">
                  <h4>Error Information</h4>
                  <div className="error-details">
                    <p>{selectedIntegration.errorMessage}</p>
                  </div>
                </div>
              )}

              <div className="details-section">
                <h4>Configuration</h4>
                <div className="config-details">
                  {Object.entries(selectedIntegration.configuration).map(([key, value]) => (
                    <div key={key} className="config-row">
                      <span className="config-key">{key}:</span>
                      <span className="config-value">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="details-footer">
              <button className="footer-btn secondary-btn" onClick={handleCloseDetails}>
                Close
              </button>
              <button className="footer-btn primary-btn">
                Configure Integration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DepartmentIntegrations;