/**
 * Daily Notes Timeline Component - Phase 6: Frontend Components
 *
 * Timeline component for displaying and managing daily notes.
 * Supports multiple note types: voice, paper, and manual entry.
 *
 * Features:
 * - Chronological timeline of daily notes
 * - Multiple note type indicators
 * - Quick preview and detailed view
 * - Filter and search functionality
 * - Mobile-optimized display
 */

import React, { useState, useEffect } from 'react';
import './DailyNotesTimeline.css';

interface DailyNote {
  id: string;
  journeyId: string;
  noteType: 'voice' | 'paper' | 'manual';
  noteDate: string;
  createdAt: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  transcript?: string;
  status: 'draft' | 'pending_review' | 'verified' | 'rejected';
  createdBy: string;
  confidence?: number;
  metadata?: Record<string, any>;
}

interface DailyNotesTimelineProps {
  journeyId: string;
  onNoteClick?: (noteId: string) => void;
  onPaperCapture?: () => void;
  onVoiceCapture?: () => void;
  apiBaseUrl?: string;
}

export const DailyNotesTimeline: React.FC<DailyNotesTimelineProps> = ({
  journeyId,
  onNoteClick,
  onPaperCapture,
  onVoiceCapture,
  apiBaseUrl = 'http://localhost:3000'
}) => {
  const [notes, setNotes] = useState<DailyNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'voice' | 'paper' | 'manual'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    fetchDailyNotes();
  }, [journeyId]);

  const fetchDailyNotes = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/daily-notes/journey/${journeyId}`);
      if (response.ok) {
        const data = await response.json();
        setNotes(data.notes || []);
      }
    } catch (error) {
      console.error('Error fetching daily notes:', error);
    } finally {
      setLoading(false);
    }
  };

  const getNoteIcon = (noteType: string) => {
    switch (noteType) {
      case 'voice': return '🎤';
      case 'paper': return '📄';
      case 'manual': return '✏️';
      default: return '📝';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'verified': return '#10B981';
      case 'pending_review': return '#F59E0B';
      case 'rejected': return '#EF4444';
      case 'draft': return '#6B7280';
      default: return '#6B7280';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'verified': return 'Verified';
      case 'pending_review': return 'Pending Review';
      case 'rejected': return 'Rejected';
      case 'draft': return 'Draft';
      default: return status;
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

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const filteredNotes = notes
    .filter(note => filter === 'all' || note.noteType === filter)
    .filter(note => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      const searchText = `
        ${note.subjective || ''} ${note.objective || ''}
        ${note.assessment || ''} ${note.plan || ''} ${note.transcript || ''}
      `.toLowerCase();
      return searchText.includes(query);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const groupedNotes = filteredNotes.reduce((groups, note) => {
    const date = note.noteDate;
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(note);
    return groups;
  }, {} as Record<string, DailyNote[]>);

  const handleNoteClick = (note: DailyNote) => {
    if (onNoteClick) {
      onNoteClick(note.id);
    }
  };

  if (loading) {
    return (
      <div className="daily-notes-loading">
        <div className="loading-spinner"></div>
        <p>Loading daily notes...</p>
      </div>
    );
  }

  return (
    <div className="daily-notes-timeline">
      {/* Header Section */}
      <div className="timeline-header">
        <div className="header-left">
          <button
            className="back-nav-btn"
            onClick={() => {
              window.location.href = '/upload';
            }}
          >
            ← Back
          </button>
          <div className="timeline-title">
            <h2>Daily Notes Timeline</h2>
            <div className="notes-count">{filteredNotes.length} notes</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="timeline-actions">
          <button className="action-btn voice-btn" onClick={onVoiceCapture}>
            <span className="btn-icon">🎤</span>
            <span className="btn-text">Voice Note</span>
          </button>
          <button className="action-btn paper-btn" onClick={onPaperCapture}>
            <span className="btn-icon">📄</span>
            <span className="btn-text">Scan Paper</span>
          </button>
        </div>
      </div>

      {/* Filters Section */}
      <div className="timeline-filters">
        <div className="filter-group">
          <button
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All Notes
          </button>
          <button
            className={`filter-btn ${filter === 'voice' ? 'active' : ''}`}
            onClick={() => setFilter('voice')}
          >
            🎤 Voice
          </button>
          <button
            className={`filter-btn ${filter === 'paper' ? 'active' : ''}`}
            onClick={() => setFilter('paper')}
          >
            📄 Paper
          </button>
          <button
            className={`filter-btn ${filter === 'manual' ? 'active' : ''}`}
            onClick={() => setFilter('manual')}
          >
            ✏️ Manual
          </button>
        </div>

        <div className="search-group">
          <input
            type="text"
            className="search-input"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Timeline Content */}
      {Object.keys(groupedNotes).length === 0 ? (
        <div className="empty-timeline">
          <div className="empty-icon">📝</div>
          <h3>No Daily Notes Yet</h3>
          <p>Start documenting this journey by adding daily notes</p>
          <div className="empty-actions">
            <button className="action-btn voice-btn" onClick={onVoiceCapture}>
              <span className="btn-icon">🎤</span>
              <span className="btn-text">Add Voice Note</span>
            </button>
            <button className="action-btn paper-btn" onClick={onPaperCapture}>
              <span className="btn-icon">📄</span>
              <span className="btn-text">Scan Paper Note</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="timeline-content">
          {Object.entries(groupedNotes).map(([date, dayNotes]) => (
            <div key={date} className="timeline-day">
              <div className="day-header">
                <div className="day-date">{formatDate(date)}</div>
                <div className="day-count">{dayNotes.length} {dayNotes.length === 1 ? 'note' : 'notes'}</div>
              </div>

              <div className="day-notes">
                {dayNotes.map((note) => (
                  <div
                    key={note.id}
                    className={`note-card ${note.status}`}
                    onClick={() => handleNoteClick(note)}
                  >
                    <div className="note-header">
                      <div className="note-info">
                        <span className="note-icon">{getNoteIcon(note.noteType)}</span>
                        <span className="note-type-label">{note.noteType}</span>
                        <span className="note-time">{formatTime(note.createdAt)}</span>
                      </div>
                      <div className="note-status">
                        <div
                          className="status-dot"
                          style={{ backgroundColor: getStatusColor(note.status) }}
                        ></div>
                        <span className="status-label">{getStatusLabel(note.status)}</span>
                      </div>
                    </div>

                    <div className="note-preview">
                      {note.subjective && (
                        <div className="note-section">
                          <strong>S:</strong> {note.subjective.substring(0, 120)}
                          {note.subjective.length > 120 ? '...' : ''}
                        </div>
                      )}
                      {note.objective && (
                        <div className="note-section">
                          <strong>O:</strong> {note.objective.substring(0, 120)}
                          {note.objective.length > 120 ? '...' : ''}
                        </div>
                      )}
                      {note.assessment && (
                        <div className="note-section">
                          <strong>A:</strong> {note.assessment.substring(0, 120)}
                          {note.assessment.length > 120 ? '...' : ''}
                        </div>
                      )}
                      {note.plan && (
                        <div className="note-section">
                          <strong>P:</strong> {note.plan.substring(0, 120)}
                          {note.plan.length > 120 ? '...' : ''}
                        </div>
                      )}
                    </div>

                    {note.confidence !== undefined && (
                      <div className="note-confidence">
                        Confidence: {Math.round(note.confidence * 100)}%
                      </div>
                    )}

                    <div className="note-footer">
                      <span className="note-author">By {note.createdBy}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DailyNotesTimeline;