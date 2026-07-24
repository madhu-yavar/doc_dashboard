/**
 * Paper Note Capture Component - Phase 6: Frontend Components
 *
 * Mobile-optimized component for capturing paper notes using camera.
 * Integrates with paper digitization service for processing.
 *
 * Features:
 * - Camera capture interface
 * - Image preview and cropping
 * - Real-time processing feedback
 * - Mobile-optimized UI
 * - Batch capture support
 */

import React, { useState, useRef, useEffect } from 'react';
import './PaperNoteCapture.css';

interface PaperNoteCaptureProps {
  journeyId: string;
  patientId: string;
  onClose?: () => void;
  onComplete?: () => void;
  apiBaseUrl?: string;
}

export const PaperNoteCapture: React.FC<PaperNoteCaptureProps> = ({
  journeyId,
  patientId,
  onClose,
  onComplete,
  apiBaseUrl = 'http://localhost:3000'
}) => {
  const [step, setStep] = useState<'capture' | 'preview' | 'processing' | 'result'>('capture');
  const [images, setImages] = useState<string[]>([]);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processedResult, setProcessedResult] = useState<any>(null);
  const [progress, setProgress] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (step === 'capture') {
      startCamera();
    } else {
      stopCamera();
    }

    return () => stopCamera();
  }, [step]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setCameraError(null);
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      let errorMessage = 'Unable to access camera. ';

      if (error instanceof Error) {
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          errorMessage += 'Please allow camera permissions in your browser settings.';
        } else if (error.name === 'NotFoundError') {
          errorMessage += 'No camera found on this device.';
        } else if (error.name === 'NotReadableError') {
          errorMessage += 'Camera may be in use by another application.';
        } else if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
          errorMessage += 'Camera access requires HTTPS. Please use HTTPS or localhost.';
        } else {
          errorMessage += 'Please check permissions and try again.';
        }
      } else {
        errorMessage += 'Please check permissions and try again.';
      }

      setCameraError(errorMessage);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);

        const imageData = canvas.toDataURL('image/jpeg', 0.9);
        setCurrentImage(imageData);
        setStep('preview');
      }
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCurrentImage(reader.result as string);
        setCameraError(null);
        setStep('preview');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRetake = () => {
    setCurrentImage(null);
    setStep('capture');
  };

  const handleConfirmCapture = () => {
    if (currentImage) {
      setImages([...images, currentImage]);
      setCurrentImage(null);
      setStep('capture');
    }
  };

  const handleProcess = async () => {
    if (images.length === 0) return;

    setStep('processing');
    setProcessing(true);
    setProgress(0);

    try {
      // Process each image sequentially
      const results = [];
      for (let i = 0; i < images.length; i++) {
        setProgress(((i) / images.length) * 100);

        const response = await fetch(`${apiBaseUrl}/api/paper-digitization/process`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageData: images[i].split(',')[1], // Remove data URL prefix
            journeyId,
            patientId,
            fileName: `paper_note_${Date.now()}_${i}.jpg`
          })
        });

        if (response.ok) {
          const result = await response.json();
          results.push(result);
        }

        setProgress(((i + 1) / images.length) * 100);
      }

      setProcessedResult(results);
      setStep('result');
      setProcessing(false);

    } catch (error) {
      console.error('Error processing paper notes:', error);
      setCameraError('Failed to process images. Please try again.');
      setStep('capture');
      setProcessing(false);
    }
  };

  const handleAddMore = () => {
    setCurrentImage(null);
    setStep('capture');
  };

  const handleComplete = () => {
    if (onComplete) {
      onComplete();
    }
  };

  const handleClose = () => {
    stopCamera();
    if (onClose) {
      onClose();
    }
  };

  return (
    <div className="paper-note-capture">
      {/* Header */}
      <div className="capture-header">
        <div className="header-left">
          <button
            className="back-nav-btn"
            onClick={() => {
              window.location.href = '/upload';
            }}
          >
            ← Back
          </button>
          <div className="header-title">
            <h3>Paper Note Capture</h3>
            <p>Journey: {journeyId}</p>
          </div>
        </div>
        <button className="close-btn" onClick={handleClose}>✕</button>
      </div>

      {/* Content */}
      <div className="capture-content">
        {step === 'capture' && (
          <div className="capture-step">
            {cameraError ? (
              <div className="camera-error">
                <div className="error-icon">📷</div>
                <h4>Camera Error</h4>
                <p>{cameraError}</p>
                <div className="error-actions">
                  <button className="retry-btn" onClick={startCamera}>Retry Camera</button>
                  <span className="action-divider">or</span>
                  <label className="upload-btn">
                    Upload Image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="file-input"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <>
                <div className="video-container">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="camera-feed"
                  />
                  <canvas ref={canvasRef} className="hidden-canvas" />
                  <div className="camera-overlay">
                    <div className="capture-frame">
                      <div className="frame-corner top-left"></div>
                      <div className="frame-corner top-right"></div>
                      <div className="frame-corner bottom-left"></div>
                      <div className="frame-corner bottom-right"></div>
                    </div>
                    <div className="capture-guide">
                      Align the paper note within the frame
                    </div>
                  </div>
                </div>

                <div className="capture-controls">
                  <button
                    className="capture-btn"
                    onClick={captureImage}
                    disabled={!!cameraError}
                  >
                    <div className="capture-btn-inner"></div>
                  </button>
                </div>

                {images.length > 0 && (
                  <div className="captured-counter">
                    {images.length} {images.length === 1 ? 'image' : 'images'} captured
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === 'preview' && currentImage && (
          <div className="preview-step">
            <div className="preview-image">
              <img src={currentImage} alt="Captured note" />
            </div>

            <div className="preview-controls">
              <button className="control-btn secondary-btn" onClick={handleRetake}>
                Retake
              </button>
              <button className="control-btn primary-btn" onClick={handleConfirmCapture}>
                Confirm Capture
              </button>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="processing-step">
            <div className="processing-animation">
              <div className="processing-spinner"></div>
              <h4>Processing Paper Notes...</h4>
              <p>Extracting and digitizing content</p>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <div className="progress-text">{Math.round(progress)}% complete</div>
            </div>
          </div>
        )}

        {step === 'result' && (
          <div className="result-step">
            <div className="result-header">
              <div className="success-icon">✓</div>
              <h4>Paper Notes Processed Successfully</h4>
              <p>{processedResult?.length || 0} notes extracted and digitized</p>
            </div>

            {processedResult && processedResult.map((result: any, index: number) => (
              <div key={index} className="result-item">
                <div className="result-info">
                  <span className="result-type">📄 Paper Note {index + 1}</span>
                  <span className={`result-status ${result.success ? 'success' : 'error'}`}>
                    {result.success ? 'Processed' : 'Failed'}
                  </span>
                </div>
                {result.extractedData && (
                  <div className="result-preview">
                    <div className="preview-section">
                      <strong>Subjective:</strong> {result.extractedData.subjective?.substring(0, 100)}...
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div className="result-actions">
              <button className="action-btn secondary-btn" onClick={handleAddMore}>
                Add More Notes
              </button>
              <button className="action-btn primary-btn" onClick={handleComplete}>
                Complete
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {step === 'capture' && images.length > 0 && (
        <div className="capture-footer">
          <button className="process-btn" onClick={handleProcess}>
            Process {images.length} {images.length === 1 ? 'Image' : 'Images'}
          </button>
        </div>
      )}
    </div>
  );
};

export default PaperNoteCapture;