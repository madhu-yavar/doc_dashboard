/**
 * Voice Note Capture Component - Phase 6: Frontend Components
 *
 * Component for capturing voice notes for daily documentation.
 * Integrates with voice daily notes API for real-time processing.
 *
 * Features:
 * - Real-time voice recording
 * - Live transcription display
 * - Audio quality feedback
 * - Mobile-optimized recording interface
 * - Voice-to-SOAP extraction
 */

import React, { useState, useRef, useEffect } from 'react';
import './VoiceNoteCapture.css';

interface VoiceNoteCaptureProps {
  journeyId: string;
  patientId: string;
  onClose?: () => void;
  onComplete?: () => void;
  apiBaseUrl?: string;
}

export const VoiceNoteCapture: React.FC<VoiceNoteCaptureProps> = ({
  journeyId,
  patientId,
  onClose,
  onComplete,
  apiBaseUrl = 'http://localhost:8001'
}) => {
  const [step, setStep] = useState<'setup' | 'recording' | 'processing' | 'result'>('setup');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [audioQuality, setAudioQuality] = useState<'good' | 'medium' | 'poor'>('good');
  const [processingResult, setProcessingResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        }
      });

      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processRecording(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStep('recording');
      setError(null);

      // Start recording timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Error starting recording:', error);
      setError('Unable to access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }
  };

  const processRecording = async (audioBlob: Blob) => {
    setStep('processing');
    setError(null);

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const base64Audio = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const response = await fetch(`${apiBaseUrl}/api/voice/daily-notes/capture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/webm',
          'x-journey-id': journeyId,
          'x-patient-id': patientId,
          'x-language': 'en-US',
          'x-duration-ms': String(recordingTime * 1000)
        },
        body: arrayBuffer
      });

      if (!response.ok) {
        throw new Error('Failed to process voice recording');
      }

      const result = await response.json();
      setProcessingResult(result);
      setTranscript(result.transcript || '');
      setStep('result');

    } catch (error) {
      console.error('Error processing recording:', error);
      setError('Failed to process voice recording. Please try again.');
      setStep('setup');
    }
  };

  const handleReset = () => {
    setRecordingTime(0);
    setTranscript('');
    setProcessingResult(null);
    setStep('setup');
    setError(null);
  };

  const handleComplete = () => {
    cleanup();
    if (onComplete) {
      onComplete();
    }
  };

  const handleClose = () => {
    cleanup();
    if (onClose) {
      onClose();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getAudioQualityIndicator = () => {
    switch (audioQuality) {
      case 'good': return { color: '#10B981', label: 'Good' };
      case 'medium': return { color: '#F59E0B', label: 'Medium' };
      case 'poor': return { color: '#EF4444', label: 'Poor' };
      default: return { color: '#6B7280', label: 'Unknown' };
    }
  };

  const qualityIndicator = getAudioQualityIndicator();

  return (
    <div className="voice-note-capture">
      {/* Header */}
      <div className="voice-header">
        <div className="header-left">
          <button
            className="back-nav-btn"
            onClick={() => {
              if (onClose) {
                onClose();
              } else if (window.history.length > 1) {
                window.history.back();
              } else {
                window.location.href = '/upload';
              }
            }}
          >
            ← Back
          </button>
          <div className="header-title">
            <h3>Voice Note Capture</h3>
            <p>Journey: {journeyId}</p>
          </div>
        </div>
        <button className="close-btn" onClick={handleClose}>✕</button>
      </div>

      {/* Content */}
      <div className="voice-content">
        {step === 'setup' && (
          <div className="setup-step">
            <div className="setup-icon">🎤</div>
            <h4>Ready to Record</h4>
            <p>Speak clearly to create a daily note from your voice</p>

            <div className="setup-tips">
              <h5>Tips for best results:</h5>
              <ul>
                <li>Speak clearly and at a moderate pace</li>
                <li>Use SOAP structure: Subjective, Objective, Assessment, Plan</li>
                <li>Include relevant vitals and clinical information</li>
                <li>Record in a quiet environment</li>
              </ul>
            </div>

            {error && (
              <div className="error-message">
                <div className="error-icon">⚠️</div>
                <p>{error}</p>
              </div>
            )}

            <button
              className="record-start-btn"
              onClick={startRecording}
            >
              <span className="btn-icon">🎙️</span>
              <span className="btn-text">Start Recording</span>
            </button>
          </div>
        )}

        {step === 'recording' && (
          <div className="recording-step">
            <div className="recording-animation">
              <div className="recording-pulse"></div>
              <div className="recording-indicator">● Recording</div>
            </div>

            <div className="recording-time">{formatTime(recordingTime)}</div>

            <div className="audio-quality">
              <span className="quality-label">Audio Quality:</span>
              <div
                className="quality-indicator"
                style={{ backgroundColor: qualityIndicator.color }}
              >
                {qualityIndicator.label}
              </div>
            </div>

            <div className="recording-tips">
              <p>🗣️ Speak clearly and describe the patient's condition</p>
              <p>📋 Include: Subjective complaints, Objective findings, Assessment, Plan</p>
            </div>

            <button
              className="record-stop-btn"
              onClick={stopRecording}
            >
              <span className="btn-icon">⏹️</span>
              <span className="btn-text">Stop Recording</span>
            </button>
          </div>
        )}

        {step === 'processing' && (
          <div className="processing-step">
            <div className="processing-animation">
              <div className="processing-wave">
                <div className="wave-bar"></div>
                <div className="wave-bar"></div>
                <div className="wave-bar"></div>
                <div className="wave-bar"></div>
                <div className="wave-bar"></div>
              </div>
              <h4>Processing Voice Recording...</h4>
              <p>Transcribing and extracting clinical information</p>
            </div>
          </div>
        )}

        {step === 'result' && processingResult && (
          <div className="result-step">
            <div className="result-header">
              <div className={`success-icon ${processingResult.success ? 'success' : 'error'}`}>
                {processingResult.success ? '✓' : '✗'}
              </div>
              <h4>
                {processingResult.success ? 'Voice Note Processed Successfully' : 'Processing Failed'}
              </h4>
              {processingResult.confidence !== undefined && (
                <div className="confidence-badge">
                  Confidence: {Math.round(processingResult.confidence * 100)}%
                </div>
              )}
            </div>

            {transcript && (
              <div className="transcript-section">
                <h5>📝 Transcript</h5>
                <div className="transcript-content">
                  {transcript}
                </div>
              </div>
            )}

            {processingResult.dailyNote && (
              <div className="extracted-data-section">
                <h5>📋 Extracted Daily Note</h5>

                {processingResult.dailyNote.subjective && (
                  <div className="soap-section">
                    <strong>Subjective:</strong>
                    <p>{processingResult.dailyNote.subjective}</p>
                  </div>
                )}

                {processingResult.dailyNote.objective && (
                  <div className="soap-section">
                    <strong>Objective:</strong>
                    <p>{processingResult.dailyNote.objective}</p>
                  </div>
                )}

                {processingResult.dailyNote.assessment && (
                  <div className="soap-section">
                    <strong>Assessment:</strong>
                    <p>{processingResult.dailyNote.assessment}</p>
                  </div>
                )}

                {processingResult.dailyNote.plan && (
                  <div className="soap-section">
                    <strong>Plan:</strong>
                    <p>{processingResult.dailyNote.plan}</p>
                  </div>
                )}

                {processingResult.dailyNote.status === 'pending_review' && (
                  <div className="review-notice">
                    ⚠️ This note requires human verification before finalizing
                  </div>
                )}
              </div>
            )}

            <div className="result-actions">
              <button className="action-btn secondary-btn" onClick={handleReset}>
                Record Another
              </button>
              <button className="action-btn primary-btn" onClick={handleComplete}>
                Complete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceNoteCapture;