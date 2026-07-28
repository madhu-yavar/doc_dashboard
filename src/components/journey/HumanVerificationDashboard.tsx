/**
 * Human Verification Dashboard - Phase 6: Frontend Components
 *
 * Dashboard for human verification of AI-extracted clinical data.
 * Provides interface for reviewing, editing, and approving extracted information.
 *
 * Features:
 * - Queue of pending verification items
 * - Detailed review interface
 * - Edit and approval workflows
 * - Quality metrics and feedback
 * - Bulk operations
 */

import React, { useState, useEffect } from 'react';
import './HumanVerificationDashboard.css';

interface VerificationItem {
  id: string;
  journeyId: string;
  patientId: string;
  patientName: string;
  itemType: 'daily_note' | 'handwriting_extraction' | 'paper_digitization';
  sourceType: 'voice' | 'paper' | 'manual';
  extractedData: {
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
    vitals?: Record<string, string>;
    medications?: Array<{name: string, dosage: string}>;
    procedures?: Array<{name: string, date: string}>;
  };
  originalSource?: string; // transcript, text content, etc.
  confidence: number;
  status: 'pending_review' | 'verified' | 'rejected' | 'corrected';
  createdAt: string;
  priority: 'high' | 'medium' | 'low';
  metadata?: Record<string, any>;
}

interface HumanVerificationDashboardProps {
  apiBaseUrl?: string;
}

export const HumanVerificationDashboard: React.FC<HumanVerificationDashboardProps> = ({
  apiBaseUrl = 'http://localhost:3000'
}) => {
  const [queue, setQueue] = useState<VerificationItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<VerificationItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'verified' | 'rejected'>('pending');
  const [itemType, setItemType] = useState<'all' | 'daily_note' | 'handwriting_extraction' | 'paper_digitization'>('all');
  const [stats, setStats] = useState({
    pending: 0,
    verified: 0,
    rejected: 0,
    corrected: 0,
    averageConfidence: 0
  });

  useEffect(() => {
    fetchVerificationQueue();
    fetchStats();
  }, [filter, itemType]);

  const fetchVerificationQueue = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/verification/queue?filter=${filter}&itemType=${itemType}`
      );
      if (response.ok) {
        const data = await response.json();
        setQueue(data.items || []);
      }
    } catch (error) {
      console.error('Error fetching verification queue:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/verification/stats`);
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleSelectItem = (item: VerificationItem) => {
    setSelectedItem(item);
  };

  const handleCloseReview = () => {
    setSelectedItem(null);
    fetchVerificationQueue(); // Refresh queue
    fetchStats(); // Refresh stats
  };

  const handleBulkAction = async (action: 'approve' | 'reject' | 'reset') => {
    // Implementation for bulk actions
    console.log(`Bulk ${action} not implemented yet`);
  };

  const getItemIcon = (itemType: string) => {
    switch (itemType) {
      case 'daily_note': return '📝';
      case 'handwriting_extraction': return '✍️';
      case 'paper_digitization': return '📄';
      default: return '📋';
    }
  };

  const getSourceIcon = (sourceType: string) => {
    switch (sourceType) {
      case 'voice': return '🎤';
      case 'paper': return '📄';
      case 'manual': return '✏️';
      default: return '📋';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return '#EF4444';
      case 'medium': return '#F59E0B';
      case 'low': return '#10B981';
      default: return '#6B7280';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending_review': return '#F59E0B';
      case 'verified': return '#10B981';
      case 'rejected': return '#EF4444';
      case 'corrected': return '#3B82F6';
      default: return '#6B7280';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const filteredQueue = queue.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'pending') return item.status === 'pending_review';
    if (filter === 'verified') return item.status === 'verified';
    if (filter === 'rejected') return item.status === 'rejected';
    return true;
  });

  return (
    <div className="human-verification-dashboard">
      {/* Header */}
      <div className="dashboard-header">
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
            <h1>Human Verification Dashboard</h1>
            <p>Review and approve AI-extracted clinical data</p>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="stats-overview">
          <div className="stat-card">
            <div className="stat-value">{stats.pending}</div>
            <div className="stat-label">Pending</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.corrected}</div>
            <div className="stat-label">Corrected</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{Math.round(stats.averageConfidence * 100)}%</div>
            <div className="stat-label">Avg. Confidence</div>
          </div>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="dashboard-controls">
        <div className="filter-group">
          <label>Status Filter:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="filter-select"
          >
            <option value="pending">Pending Review</option>
            <option value="all">All Items</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Item Type:</label>
          <select
            value={itemType}
            onChange={(e) => setItemType(e.target.value as any)}
            className="filter-select"
          >
            <option value="all">All Types</option>
            <option value="daily_note">Daily Notes</option>
            <option value="handwriting_extraction">Handwriting</option>
            <option value="paper_digitization">Paper Digitization</option>
          </select>
        </div>

        <div className="action-buttons">
          <button className="bulk-btn approve-btn" onClick={() => handleBulkAction('approve')}>
            ✓ Approve Selected
          </button>
          <button className="bulk-btn reject-btn" onClick={() => handleBulkAction('reject')}>
            ✗ Reject Selected
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="dashboard-content">
        {/* Queue List */}
        <div className="queue-list">
          <div className="queue-header">
            <h2>Verification Queue</h2>
            <div className="queue-count">{filteredQueue.length} items</div>
          </div>

          {loading ? (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <p>Loading verification queue...</p>
            </div>
          ) : filteredQueue.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3>No Items to Review</h3>
              <p>All items have been processed or no items match the current filters.</p>
            </div>
          ) : (
            <div className="queue-items">
              {filteredQueue.map((item) => (
                <div
                  key={item.id}
                  className={`queue-item ${item.status} ${selectedItem?.id === item.id ? 'selected' : ''}`}
                  onClick={() => handleSelectItem(item)}
                >
                  <div className="item-header">
                    <div className="item-icons">
                      <span className="item-type-icon">{getItemIcon(item.itemType)}</span>
                      <span className="source-icon">{getSourceIcon(item.sourceType)}</span>
                    </div>
                    <div className="item-priority">
                      <div
                        className="priority-dot"
                        style={{ backgroundColor: getPriorityColor(item.priority) }}
                      ></div>
                    </div>
                  </div>

                  <div className="item-content">
                    <div className="patient-info">
                      <strong>{item.patientName}</strong>
                      <span className="patient-id">ID: {item.patientId}</span>
                    </div>
                    <div className="item-preview">
                      {item.extractedData.subjective && (
                        <div className="preview-text">
                          <strong>S:</strong> {item.extractedData.subjective.substring(0, 60)}...
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="item-footer">
                    <div className="confidence-badge">
                      Confidence: {Math.round(item.confidence * 100)}%
                    </div>
                    <div className="item-date">{formatDate(item.createdAt)}</div>
                  </div>

                  <div
                    className="status-indicator"
                    style={{ backgroundColor: getStatusColor(item.status) }}
                  ></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Review Panel */}
        {selectedItem && (
          <div className="review-panel">
            <VerificationReview
              item={selectedItem}
              onClose={handleCloseReview}
              apiBaseUrl={apiBaseUrl}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// Verification Review Component
interface VerificationReviewProps {
  item: VerificationItem;
  onClose: () => void;
  apiBaseUrl: string;
}

const VerificationReview: React.FC<VerificationReviewProps> = ({ item, onClose, apiBaseUrl }) => {
  const [editedData, setEditedData] = useState(item.extractedData);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/verification/${item.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: editedData })
      });

      if (response.ok) {
        onClose();
      } else {
        throw new Error('Failed to approve item');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/verification/${item.id}/reject`, {
        method: 'POST'
      });

      if (response.ok) {
        onClose();
      } else {
        throw new Error('Failed to reject item');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rejection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCorrections = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/verification/${item.id}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: editedData })
      });

      if (response.ok) {
        onClose();
      } else {
        throw new Error('Failed to save corrections');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="verification-review">
      <div className="review-header">
        <div className="review-title">
          <h2>Review Extracted Data</h2>
          <div className="review-meta">
            <span className="patient-name">{item.patientName}</span>
            <span className="journey-id">Journey: {item.journeyId}</span>
          </div>
        </div>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {error && (
        <div className="error-alert">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <div className="review-content">
        {/* Original Source */}
        {item.originalSource && (
          <div className="review-section">
            <h3>Original Source</h3>
            <div className="source-content">
              {item.originalSource}
            </div>
          </div>
        )}

        {/* Extracted Data */}
        <div className="review-section">
          <div className="section-header">
            <h3>Extracted Clinical Data</h3>
            <button
              className="edit-toggle-btn"
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? '✓ Done Editing' : '✏️ Edit Data'}
            </button>
          </div>

          <div className="extracted-data">
            {editedData.subjective && (
              <div className="soap-section">
                <label>Subjective:</label>
                {isEditing ? (
                  <textarea
                    value={editedData.subjective}
                    onChange={(e) => setEditedData({...editedData, subjective: e.target.value})}
                    className="edit-textarea"
                  />
                ) : (
                  <p>{editedData.subjective}</p>
                )}
              </div>
            )}

            {editedData.objective && (
              <div className="soap-section">
                <label>Objective:</label>
                {isEditing ? (
                  <textarea
                    value={editedData.objective}
                    onChange={(e) => setEditedData({...editedData, objective: e.target.value})}
                    className="edit-textarea"
                  />
                ) : (
                  <p>{editedData.objective}</p>
                )}
              </div>
            )}

            {editedData.assessment && (
              <div className="soap-section">
                <label>Assessment:</label>
                {isEditing ? (
                  <textarea
                    value={editedData.assessment}
                    onChange={(e) => setEditedData({...editedData, assessment: e.target.value})}
                    className="edit-textarea"
                  />
                ) : (
                  <p>{editedData.assessment}</p>
                )}
              </div>
            )}

            {editedData.plan && (
              <div className="soap-section">
                <label>Plan:</label>
                {isEditing ? (
                  <textarea
                    value={editedData.plan}
                    onChange={(e) => setEditedData({...editedData, plan: e.target.value})}
                    className="edit-textarea"
                  />
                ) : (
                  <p>{editedData.plan}</p>
                )}
              </div>
            )}

            {editedData.vitals && Object.keys(editedData.vitals).length > 0 && (
              <div className="vitals-section">
                <label>Vitals:</label>
                <div className="vitals-grid">
                  {Object.entries(editedData.vitals).map(([key, value]) => (
                    <div key={key} className="vital-item">
                      <span className="vital-label">{key}:</span>
                      <span className="vital-value">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {editedData.medications && editedData.medications.length > 0 && (
              <div className="medications-section">
                <label>Medications:</label>
                <ul>
                  {editedData.medications.map((med, index) => (
                    <li key={index}>
                      {med.name} - {med.dosage}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Confidence Information */}
        <div className="confidence-section">
          <h3>Extraction Confidence</h3>
          <div className="confidence-display">
            <div className="confidence-bar">
              <div
                className="confidence-fill"
                style={{ width: `${item.confidence * 100}%` }}
              ></div>
            </div>
            <div className="confidence-value">
              {Math.round(item.confidence * 100)}%
            </div>
          </div>
          <div className="confidence-guidance">
            {item.confidence >= 0.8 ? '✅ High confidence extraction' :
             item.confidence >= 0.6 ? '⚠️ Medium confidence - review recommended' :
             '❌ Low confidence - careful review required'}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="review-actions">
        <button
          className="action-btn reject-btn"
          onClick={handleReject}
          disabled={loading}
        >
          ✗ Reject
        </button>

        {isEditing ? (
          <button
            className="action-btn save-btn"
            onClick={handleSaveCorrections}
            disabled={loading}
          >
            💾 Save Corrections
          </button>
        ) : (
          <button
            className="action-btn approve-btn"
            onClick={handleApprove}
            disabled={loading}
          >
            ✓ Approve
          </button>
        )}

        <button
          className="action-btn skip-btn"
          onClick={onClose}
          disabled={loading}
        >
          → Skip for Now
        </button>
      </div>
    </div>
  );
};

export default HumanVerificationDashboard;