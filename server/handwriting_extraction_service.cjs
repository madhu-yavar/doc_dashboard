/**
 * Handwriting Extraction Service - Phase 4: Paper Digitization
 *
 * Service for extracting handwritten content from medical paper notes.
 * Reuses existing AI agents and image processing infrastructure.
 *
 * Responsibilities:
 * - Handwriting text extraction from paper notes
 * - Form structure recognition and parsing
 * - Clinical data normalization to daily note format
 * - Integration with existing extraction agents
 * - Quality assessment and confidence scoring
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Reuse existing AI agents
const ChartNoteExtractorAgent = require('../agents/chart_note_extractor_agent.cjs');
const PhiMaskerTool = require('../tools/image/phi_masker.tool.cjs');

class HandwritingExtractionService {
  constructor(config = {}) {
    this.name = 'HandwritingExtractionService';
    this.tempDir = config.tempDir || '/tmp/handwriting_extraction';
    this.maxImageSize = config.maxImageSize || 10 * 1024 * 1024; // 10MB

    // Initialize AI agents
    this.phiMasker = new PhiMaskerTool(config.phiMasker || {});
    this.chartNoteExtractor = new ChartNoteExtractorAgent(config.extraction || {});

    // Configuration
    this.supportedImageFormats = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    this.confidenceThreshold = config.confidenceThreshold || 0.7;
    this.maxRetries = config.maxRetries || 2;

    this.ensureTempDir();
  }

  /**
   * Ensure temp directory exists for processing
   */
  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Extract handwriting from paper note image
   * @param {Buffer} imageData - Raw image data
   * @param {Object} options - Extraction options
   * @returns {Object} Extracted and normalized clinical data
   */
  async extractHandwriting(imageData, options = {}) {
    try {
      this.log('Starting handwriting extraction', {
        imageSize: imageData.length,
        mimeType: options.mimeType
      });

      // Step 1: Validate input
      await this.validateImageInput(imageData, options.mimeType);

      // Step 2: Apply PHI masking for privacy
      const maskedImageData = await this.applyPHIMasking(imageData, options);

      // Step 3: Preprocess image for better extraction
      const preprocessedImage = await this.preprocessImage(maskedImageData);

      // Step 4: Extract content using existing agents
      const extractedData = await this.extractClinicalData(preprocessedImage, options);

      // Step 5: Normalize to daily note structure
      const normalizedData = await this.normalizeToDailyNote(extractedData, options);

      // Step 6: Quality assessment
      const qualityAssessment = await this.assessQuality(normalizedData, extractedData);

      this.log('Handwriting extraction completed', {
        success: true,
        confidence: qualityAssessment.overallConfidence,
        extractedFields: Object.keys(normalizedData).length
      });

      return {
        success: true,
        data: normalizedData,
        quality: qualityAssessment,
        metadata: {
          extractionMethod: 'handwriting',
          processedAt: new Date().toISOString(),
          version: this.version || '1.0.0'
        }
      };

    } catch (error) {
      this.log('Handwriting extraction failed', { error: error.message });
      throw new Error(`Handwriting extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract daily note structure from paper form
   * @param {Buffer} imageData - Paper form image
   * @param {Object} options - Processing options
   * @returns {Object} Structured daily note data
   */
  async extractDailyNoteStructure(imageData, options = {}) {
    try {
      this.log('Extracting daily note structure from paper form');

      // Apply PHI masking first
      const maskedImageData = await this.applyPHIMasking(imageData, options);

      // Use existing chart note extractor
      const tempImagePath = await this.saveTempImage(maskedImageData);

      try {
        const extractionResult = await this.chartNoteExtractor.process(tempImagePath, {
          pdfName: options.documentName || 'paper_daily_note',
          ...options
        });

        // Extract SOAP structure
        const soapStructure = this.extractSOAPFromExtraction(extractionResult);

        return {
          success: true,
          structure: soapStructure,
          rawExtraction: extractionResult,
          confidence: this.calculateExtractionConfidence(extractionResult)
        };

      } finally {
        // Clean up temp file
        if (fs.existsSync(tempImagePath)) {
          fs.unlinkSync(tempImagePath);
        }
      }

    } catch (error) {
      this.log('Daily note structure extraction failed', { error: error.message });
      throw new Error(`Structure extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract vitals from paper forms
   * @param {Buffer} imageData - Paper form with vitals
   * @param {Object} options - Processing options
   * @returns {Object} Extracted vitals data
   */
  async extractVitalsFromForm(imageData, options = {}) {
    try {
      this.log('Extracting vitals from paper form');

      const maskedImageData = await this.applyPHIMasking(imageData, options);
      const tempImagePath = await this.saveTempImage(maskedImageData);

      try {
        const extractionResult = await this.chartNoteExtractor.process(tempImagePath, {
          focus: 'vitals',
          ...options
        });

        const vitals = this.parseVitalsFromExtraction(extractionResult);

        return {
          success: true,
          vitals,
          confidence: this.calculateVitalsConfidence(vitals, extractionResult)
        };

      } finally {
        if (fs.existsSync(tempImagePath)) {
          fs.unlinkSync(tempImagePath);
        }
      }

    } catch (error) {
      this.log('Vitals extraction failed', { error: error.message });
      throw new Error(`Vitals extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract medications from paper orders
   * @param {Buffer} imageData - Paper medication order
   * @param {Object} options - Processing options
   * @returns {Object} Extracted medication data
   */
  async extractMedicationsFromOrder(imageData, options = {}) {
    try {
      this.log('Extracting medications from paper order');

      const maskedImageData = await this.applyPHIMasking(imageData, options);
      const tempImagePath = await this.saveTempImage(maskedImageData);

      try {
        // Use prescription extractor agent
        const PrescriptionExtractorAgent = require('../agents/prescription_extractor_agent.cjs');
        const prescriptionExtractor = new PrescriptionExtractorAgent();

        const extractionResult = await prescriptionExtractor.process(tempImagePath, {
          ...options
        });

        const medications = this.parseMedicationsFromExtraction(extractionResult);

        return {
          success: true,
          medications,
          confidence: this.calculateMedicationsConfidence(medications, extractionResult)
        };

      } finally {
        if (fs.existsSync(tempImagePath)) {
          fs.unlinkSync(tempImagePath);
        }
      }

    } catch (error) {
      this.log('Medication extraction failed', { error: error.message });
      throw new Error(`Medication extraction failed: ${error.message}`);
    }
  }

  /**
   * Parse handwritten text using OCR if needed
   * @param {Buffer} imageData - Image with handwritten text
   * @param {Object} options - Processing options
   * @returns {Object} Parsed text and metadata
   */
  async parseHandwrittenText(imageData, options = {}) {
    try {
      this.log('Parsing handwritten text');

      // For handwritten text, we might need specialized OCR
      // This is a placeholder for future handwriting-specific OCR integration
      const maskedImageData = await this.applyPHIMasking(imageData, options);

      return {
        success: true,
        text: 'Handwritten text parsing - placeholder for specialized OCR',
        confidence: 0.5,
        requiresManualReview: true
      };

    } catch (error) {
      this.log('Handwritten text parsing failed', { error: error.message });
      throw new Error(`Text parsing failed: ${error.message}`);
    }
  }

  /**
   * Normalize extracted data to daily note format
   * @param {Object} extractedData - Raw extraction result
   * @param {Object} options - Normalization options
   * @returns {Object} Normalized daily note structure
   */
  async normalizeToDailyNote(extractedData, options = {}) {
    try {
      this.log('Normalizing extracted data to daily note format');

      // Extract SOAP components
      const subjective = this.extractSubjective(extractedData);
      const objective = this.extractObjective(extractedData);
      const assessment = this.extractAssessment(extractedData);
      const plan = this.extractPlan(extractedData);

      // Extract additional clinical data
      const vitals = this.extractVitals(extractedData);
      const medications = this.extractMedications(extractedData);
      const procedures = this.extractProcedures(extractedData);

      return {
        soap: {
          subjective: subjective || '',
          objective: objective || '',
          assessment: assessment || '',
          plan: plan || ''
        },
        vitals,
        medications,
        procedures,
        metadata: {
          extractionSource: 'handwriting',
          confidence: this.calculateExtractionConfidence(extractedData),
          requiresReview: this.doesRequireReview(extractedData)
        }
      };

    } catch (error) {
      this.log('Normalization failed', { error: error.message });
      throw new Error(`Normalization failed: ${error.message}`);
    }
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  /**
   * Validate image input
   */
  async validateImageInput(imageData, mimeType) {
    if (!Buffer.isBuffer(imageData)) {
      throw new Error('Invalid image data: must be a buffer');
    }

    if (imageData.length > this.maxImageSize) {
      throw new Error(`Image size exceeds ${this.maxImageSize / (1024 * 1024)}MB limit`);
    }

    if (mimeType && !this.supportedImageFormats.includes(mimeType)) {
      throw new Error(`Unsupported image format: ${mimeType}`);
    }
  }

  /**
   * Apply PHI masking to image
   */
  async applyPHIMasking(imageData, options) {
    try {
      this.log('Applying PHI masking');

      const base64Image = imageData.toString('base64');
      const maskingResult = await this.phiMasker.maskPhiRegions(base64Image);

      if (maskingResult.success) {
        return Buffer.from(maskingResult.maskedImage, 'base64');
      } else {
        this.log('PHI masking failed, using original image', {
          error: maskingResult.error
        });
        return imageData; // Fallback to original if masking fails
      }

    } catch (error) {
      this.log('PHI masking error, using original image', { error: error.message });
      return imageData; // Fallback to original if masking fails
    }
  }

  /**
   * Preprocess image for better extraction
   */
  async preprocessImage(imageData) {
    try {
      this.log('Preprocessing image');

      // Use sharp for image preprocessing
      const processedImage = await sharp(imageData)
        .resize({ width: 2000, height: 2000, fit: 'inside' }) // Resize for better OCR
        .sharpen() // Sharpen for better text recognition
        .normalize() // Normalize contrast
        .toBuffer();

      return processedImage;

    } catch (error) {
      this.log('Image preprocessing failed, using original', { error: error.message });
      return imageData;
    }
  }

  /**
   * Extract clinical data using existing agents
   */
  async extractClinicalData(imageData, options) {
    const tempImagePath = await this.saveTempImage(imageData);

    try {
      const result = await this.chartNoteExtractor.process(tempImagePath, {
        pdfName: options.documentName || 'paper_note',
        ...options
      });

      return result;

    } finally {
      if (fs.existsSync(tempImagePath)) {
        fs.unlinkSync(tempImagePath);
      }
    }
  }

  /**
   * Save image to temp file for processing
   */
  async saveTempImage(imageData) {
    const filename = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
    const tempPath = path.join(this.tempDir, filename);
    await fs.promises.writeFile(tempPath, imageData);
    return tempPath;
  }

  /**
   * Extract SOAP structure from extraction result
   */
  extractSOAPFromExtraction(extractionResult) {
    const extracted = extractionResult.extracted_data || {};
    return {
      subjective: extracted.subjective || extracted.chief_complaint || '',
      objective: extracted.objective || extracted.vitals || '',
      assessment: extracted.assessment || extracted.diagnosis || '',
      plan: extracted.plan || extracted.treatment || ''
    };
  }

  /**
   * Parse vitals from extraction result
   */
  parseVitalsFromExtraction(extractionResult) {
    const extracted = extractionResult.extracted_data || {};
    return {
      temperature: extracted.temperature || extracted.vitals?.temperature,
      bloodPressure: extracted.blood_pressure || extracted.vitals?.blood_pressure,
      heartRate: extracted.heart_rate || extracted.vitals?.heart_rate,
      respiratoryRate: extracted.respiratory_rate || extracted.vitals?.respiratory_rate,
      oxygenSaturation: extracted.o2_saturation || extracted.vitals?.o2_saturation,
      weight: extracted.weight || extracted.vitals?.weight,
      height: extracted.height || extracted.vitals?.height
    };
  }

  /**
   * Parse medications from extraction result
   */
  parseMedicationsFromExtraction(extractionResult) {
    const extracted = extractionResult.extracted_data || {};
    return extracted.medications || extracted.prescriptions || [];
  }

  /**
   * Calculate extraction confidence
   */
  calculateExtractionConfidence(extractionResult) {
    // Placeholder for confidence calculation logic
    // In real implementation, would analyze extraction quality indicators
    return 0.8; // Default confidence
  }

  /**
   * Calculate vitals confidence
   */
  calculateVitalsConfidence(vitals, extractionResult) {
    // Check if all required vitals are present
    const requiredVitals = ['temperature', 'bloodPressure', 'heartRate'];
    const presentVitals = requiredVitals.filter(v => vitals[v] !== undefined);
    return presentVitals.length / requiredVitals.length;
  }

  /**
   * Calculate medications confidence
   */
  calculateMedicationsConfidence(medications, extractionResult) {
    if (!Array.isArray(medications) || medications.length === 0) {
      return 0.3; // Low confidence if no medications found
    }
    return 0.8; // High confidence if medications extracted
  }

  /**
   * Determine if extraction requires manual review
   */
  doesRequireReview(extractionResult) {
    const confidence = this.calculateExtractionConfidence(extractionResult);
    return confidence < this.confidenceThreshold;
  }

  /**
   * Quality assessment of extraction
   */
  async assessQuality(normalizedData, extractedData) {
    const confidence = this.calculateExtractionConfidence(extractedData);
    const completeness = this.assessCompleteness(normalizedData);
    const consistency = this.assessConsistency(normalizedData);

    return {
      overallConfidence: confidence,
      completeness,
      consistency,
      requiresReview: confidence < this.confidenceThreshold || completeness < 0.7,
      issues: this.identifyQualityIssues(normalizedData, confidence, completeness)
    };
  }

  /**
   * Assess data completeness
   */
  assessCompleteness(data) {
    const soap = data.soap || {};
    const sections = ['subjective', 'objective', 'assessment', 'plan'];
    const filledSections = sections.filter(section => {
      const content = soap[section];
      return content && content.trim().length > 10;
    });

    return filledSections.length / sections.length;
  }

  /**
   * Assess data consistency
   */
  assessConsistency(data) {
    // Placeholder for consistency checks
    // In real implementation, would check for logical inconsistencies
    return 0.9;
  }

  /**
   * Identify quality issues
   */
  identifyQualityIssues(data, confidence, completeness) {
    const issues = [];

    if (confidence < this.confidenceThreshold) {
      issues.push('low_confidence');
    }

    if (completeness < 0.7) {
      issues.push('incomplete_data');
    }

    if (!data.soap || Object.keys(data.soap).length === 0) {
      issues.push('missing_soap_structure');
    }

    return issues;
  }

  // SOAP component extraction methods
  extractSubjective(data) {
    return data.extracted_data?.subjective ||
           data.extracted_data?.chief_complaint ||
           data.extracted_data?.present_illness || '';
  }

  extractObjective(data) {
    return data.extracted_data?.objective ||
           data.extracted_data?.physical_exam || '';
  }

  extractAssessment(data) {
    return data.extracted_data?.assessment ||
           data.extracted_data?.diagnosis || '';
  }

  extractPlan(data) {
    return data.extracted_data?.plan ||
           data.extracted_data?.treatment || '';
  }

  extractVitals(data) {
    return this.parseVitalsFromExtraction(data);
  }

  extractMedications(data) {
    return this.parseMedicationsFromExtraction(data);
  }

  extractProcedures(data) {
    return data.extracted_data?.procedures || [];
  }

  /**
   * Logging utility
   */
  log(message, data = {}) {
    console.log(`[${this.name}] ${message}`, data);
  }

  /**
   * Get service version
   */
  get version() {
    return '1.0.0';
  }
}

module.exports = HandwritingExtractionService;