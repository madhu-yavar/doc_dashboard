/**
 * Journey Analytics Component - Phase 6: Frontend Components
 *
 * Component for displaying journey analytics and insights.
 * Provides visualizations and metrics for inpatient journeys.
 *
 * Features:
 * - Journey overview metrics
 * - Daily notes statistics
 * - Department integration status
 * - Timeline visualization
 * - Performance indicators
 */

import React, { useState, useEffect } from 'react';
import './JourneyAnalytics.css';

interface JourneyAnalyticsProps {
  journeyId: string;
  detailed?: boolean;
  apiBaseUrl?: string;
}

interface AnalyticsData {
  journeyMetrics: {
    totalDays: number;
    totalNotes: number;
    voiceNotes: number;
    paperNotes: number;
    manualNotes: number;
    averageNotesPerDay: number;
    completionRate: number;
  };
  notesByType: {
    voice: number;
    paper: number;
    manual: number;
  };
  notesByStatus: {
    draft: number;
    pending_review: number;
    verified: number;
    rejected: number;
  };
  integrationHealth: {
    activeIntegrations: number;
    totalIntegrations: number;
    successfulSyncs: number;
    failedSyncs: number;
  };
  timelineData: {
    date: string;
    notes: number;
    voiceNotes: number;
    paperNotes: number;
  }[];
  qualityMetrics: {
    averageExtractionConfidence: number;
    highQualityNotes: number;
    lowQualityNotes: number;
    reviewRequired: number;
  };
}

export const JourneyAnalytics: React.FC<JourneyAnalyticsProps> = ({
  journeyId,
  detailed = false,
  apiBaseUrl = 'http://localhost:3000'
}) => {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState<'7d' | '30d' | 'all'>('all');

  useEffect(() => {
    fetchAnalytics();
  }, [journeyId, selectedTimeRange]);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/journeys/${journeyId}/analytics?timeRange=${selectedTimeRange}`
      );
      if (response.ok) {
        const data = await response.json();
        setAnalytics(data);
      } else {
        throw new Error('Failed to fetch analytics');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
      console.error('Error fetching analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const renderMetricCard = (title: string, value: string | number, subtitle?: string, icon?: string) => (
    <div className="metric-card">
      {icon && <div className="metric-icon">{icon}</div>}
      <div className="metric-content">
        <div className="metric-title">{title}</div>
        <div className="metric-value">{value}</div>
        {subtitle && <div className="metric-subtitle">{subtitle}</div>}
      </div>
    </div>
  );

  const renderProgressBar = (label: string, current: number, total: number, color: string) => {
    const percentage = total > 0 ? (current / total) * 100 : 0;
    return (
      <div className="progress-item">
        <div className="progress-header">
          <span className="progress-label">{label}</span>
          <span className="progress-value">{current}/{total}</span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${percentage}%`, backgroundColor: color }}
          ></div>
        </div>
      </div>
    );
  };

  const renderTimelineChart = () => {
    if (!analytics || !analytics.timelineData || analytics.timelineData.length === 0) {
      return <div className="no-chart-data">No timeline data available</div>;
    }

    const maxNotes = Math.max(...analytics.timelineData.map(d => d.notes), 1);

    return (
      <div className="timeline-chart">
        <div className="chart-header">
          <h4>Daily Notes Timeline</h4>
          <div className="chart-legend">
            <div className="legend-item">
              <div className="legend-dot voice"></div>
              <span>Voice</span>
            </div>
            <div className="legend-item">
              <div className="legend-dot paper"></div>
              <span>Paper</span>
            </div>
          </div>
        </div>
        <div className="chart-content">
          {analytics.timelineData.map((day, index) => (
            <div key={index} className="chart-bar-container">
              <div className="chart-date">
                {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <div className="chart-bars">
                {day.voiceNotes > 0 && (
                  <div
                    className="chart-bar voice"
                    style={{ height: `${(day.voiceNotes / maxNotes) * 100}%` }}
                    title={`Voice notes: ${day.voiceNotes}`}
                  ></div>
                )}
                {day.paperNotes > 0 && (
                  <div
                    className="chart-bar paper"
                    style={{ height: `${(day.paperNotes / maxNotes) * 100}%` }}
                    title={`Paper notes: ${day.paperNotes}`}
                  ></div>
                )}
                {day.notes === 0 && (
                  <div className="chart-bar empty">-</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderQualityMetrics = () => {
    if (!analytics) return null;

    return (
      <div className="quality-metrics">
        <h4>Quality Metrics</h4>
        <div className="quality-grid">
          {renderMetricCard(
            'Avg. Confidence',
            `${Math.round(analytics.qualityMetrics.averageExtractionConfidence * 100)}%`,
            'Extraction quality',
            '🎯'
          )}
          {renderMetricCard(
            'High Quality',
            analytics.qualityMetrics.highQualityNotes,
            'Confidence > 80%',
            '✅'
          )}
          {renderMetricCard(
            'Review Required',
            analytics.qualityMetrics.reviewRequired,
            'Needs verification',
            '⚠️'
          )}
          {renderMetricCard(
            'Low Quality',
            analytics.qualityMetrics.lowQualityNotes,
            'Confidence < 50%',
            '❌'
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="journey-analytics-loading">
        <div className="loading-spinner"></div>
        <p>Loading analytics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="journey-analytics-error">
        <p>{error}</p>
        <button onClick={fetchAnalytics} className="retry-btn">Retry</button>
      </div>
    );
  }

  if (!analytics) {
    return <div className="journey-analytics-empty">No analytics data available</div>;
  }

  return (
    <div className="journey-analytics">
      {/* Header */}
      <div className="analytics-header">
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
          <h3>Journey Analytics</h3>
        </div>
        <div className="time-range-selector">
          <button
            className={`range-btn ${selectedTimeRange === '7d' ? 'active' : ''}`}
            onClick={() => setSelectedTimeRange('7d')}
          >
            7 Days
          </button>
          <button
            className={`range-btn ${selectedTimeRange === '30d' ? 'active' : ''}`}
            onClick={() => setSelectedTimeRange('30d')}
          >
            30 Days
          </button>
          <button
            className={`range-btn ${selectedTimeRange === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedTimeRange('all')}
          >
            All Time
          </button>
        </div>
      </div>

      {/* Overview Metrics */}
      <div className="analytics-section">
        <h4>Overview Metrics</h4>
        <div className="metrics-grid">
          {renderMetricCard('Total Days', analytics.journeyMetrics.totalDays)}
          {renderMetricCard('Total Notes', analytics.journeyMetrics.totalNotes)}
          {renderMetricCard('Avg. Notes/Day', analytics.journeyMetrics.averageNotesPerDay.toFixed(1))}
          {renderMetricCard('Completion Rate', `${Math.round(analytics.journeyMetrics.completionRate * 100)}%`)}
        </div>
      </div>

      {/* Notes Distribution */}
      <div className="analytics-section">
        <h4>Notes Distribution</h4>
        <div className="distribution-grid">
          <div className="distribution-card">
            <h5>By Type</h5>
            {renderProgressBar('Voice Notes', analytics.notesByType.voice, analytics.journeyMetrics.totalNotes, '#3B82F6')}
            {renderProgressBar('Paper Notes', analytics.notesByType.paper, analytics.journeyMetrics.totalNotes, '#F59E0B')}
            {renderProgressBar('Manual Notes', analytics.notesByType.manual, analytics.journeyMetrics.totalNotes, '#10B981')}
          </div>

          <div className="distribution-card">
            <h5>By Status</h5>
            {renderProgressBar('Verified', analytics.notesByStatus.verified, analytics.journeyMetrics.totalNotes, '#10B981')}
            {renderProgressBar('Pending Review', analytics.notesByStatus.pending_review, analytics.journeyMetrics.totalNotes, '#F59E0B')}
            {renderProgressBar('Draft', analytics.notesByStatus.draft, analytics.journeyMetrics.totalNotes, '#6B7280')}
            {renderProgressBar('Rejected', analytics.notesByStatus.rejected, analytics.journeyMetrics.totalNotes, '#EF4444')}
          </div>
        </div>
      </div>

      {/* Integration Health */}
      <div className="analytics-section">
        <h4>Integration Health</h4>
        <div className="integration-health">
          {renderMetricCard(
            'Active Integrations',
            `${analytics.integrationHealth.activeIntegrations}/${analytics.integrationHealth.totalIntegrations}`,
            'Department connections',
            '🔗'
          )}
          {renderMetricCard(
            'Successful Syncs',
            analytics.integrationHealth.successfulSyncs,
            'Data synchronizations',
            '✅'
          )}
          {renderMetricCard(
            'Failed Syncs',
            analytics.integrationHealth.failedSyncs,
            'Sync failures',
            '❌'
          )}
        </div>
      </div>

      {/* Quality Metrics */}
      {renderQualityMetrics()}

      {/* Timeline Chart */}
      {detailed && (
        <div className="analytics-section">
          {renderTimelineChart()}
        </div>
      )}
    </div>
  );
};

export default JourneyAnalytics;