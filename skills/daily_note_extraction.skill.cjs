/**
 * Daily Note Extraction Skill - Phase 5: Voice Integration
 *
 * Extraction skill for converting voice transcripts to structured daily notes.
 * Follows existing skill patterns and focuses on SOAP structure extraction.
 *
 * Responsibilities:
 * - SOAP structure extraction from transcripts
 * - Clinical data extraction (vitals, medications, procedures)
 * - Context-aware extraction based on patient/journey
 * - Confidence scoring and quality assessment
 */

class DailyNoteExtractionSkill {
  constructor(config = {}) {
    this.name = 'DailyNoteExtractionSkill';
    this.confidenceThreshold = config.confidenceThreshold || 0.8;

    // SOAP section patterns
    this.soapPatterns = {
      subjective: [
        /(?:patient |pt |the patient )(?:says|states|reports|complains of|mentions|describes|feels|is feeling)/i,
        /(?:chief complaint|cc|presenting complaint|present illness|history of present illness)/i,
        /(?:subjective|s\s*:\s*)/i
      ],
      objective: [
        /(?:on examination|on exam|examination shows|physical exam|obj|objective)\s*:/i,
        /(?:vitals|vital signs|temperature|blood pressure|pulse|heart rate|respiratory)/i,
        /(?:general appearance|patient appears|looks|appears)/i
      ],
      assessment: [
        /(?:assessment|diagnosis|impression|a\s*:\s*)/i,
        /(?:likely|probably|most likely|consistent with|suggests of)/i,
        /(?:working diagnosis|clinical diagnosis|primary diagnosis)/i
      ],
      plan: [
        /(?:plan|treatment|management|p\s*:\s*)/i,
        /(?:recommend|will|prescribed|ordered|scheduled)/i,
        /(?:follow-up|follow up|next steps|disposition)/i
      ]
    };

    // Clinical data patterns
    this.clinicalPatterns = {
      vitals: {
        temperature: /(?:temperature|temp|fever)\s*[:is\s]*\s*(\d+\.?\d*)\s*(?:degrees?°?\s*[FC]?)?/i,
        bloodPressure: /(?:blood pressure|bp|pressure)\s*[:is\s]*\s*(\d{2,3}\/\d{2,3})/i,
        heartRate: /(?:heart rate|hr|pulse|rate)\s*[:is\s]*\s*(\d+)\s*bpm?/i,
        respiratoryRate: /(?:respiratory rate|rr|breathing|respirations)\s*[:is\s]*\s*(\d+)\s*(?:breaths)?/i,
        oxygenSaturation: /(?:oxygen saturation|o2 sat|spo2|sa o2)\s*[:is\s]*\s*(\d+)%?/i,
        weight: /(?:weight|wt)\s*[:is\s]*\s*(\d+\.?\d*)\s*(?:kg|lbs?|pounds?)?/i
      },
      medications: [
        /(?:prescribed|started|ordered|given|administered)\s+(?:[a-z]+(?:\s+[a-z]+)?)\s+(?:\d+\s*(?:mg|ml|units?))/gi,
        /(?:taking|on)\s+(?:[a-z]+(?:\s+[a-z]+)?)\s+(?:\d+\s*(?:mg|ml|units?))/gi
      ],
      procedures: [
        /(?:performed|conducted|completed|done)\s+(?:[a-z]+(?:\s+[a-z]+)?)\s*(?:procedure|surgery)/gi
      ]
    };
  }

  /**
   * Extract SOAP structure from transcript
   * @param {string} transcript - Voice transcript
   * @param {Object} context - Extraction context
   * @returns {Object} SOAP structure
   */
  async extractSOAP(transcript, context = {}) {
    try {
      this.log('Extracting SOAP structure', {
        transcriptLength: transcript.length,
        journeyId: context.journeyId
      });

      const sentences = this.splitIntoSentences(transcript);
      const soap = {
        subjective: '',
        objective: '',
        assessment: '',
        plan: ''
      };

      let currentSection = null;

      for (const sentence of sentences) {
        const detectedSection = this.detectSOAPSection(sentence);

        if (detectedSection) {
          currentSection = detectedSection;
        } else if (currentSection) {
          soap[currentSection] += (soap[currentSection] ? ' ' : '') + sentence;
        }
      }

      // Clean up extracted sections
      for (const section of Object.keys(soap)) {
        soap[section] = this.cleanExtractedText(soap[section]);
      }

      const confidence = this.calculateSOAPConfidence(soap);

      this.log('SOAP extraction completed', {
        sections: Object.keys(soap).filter(k => soap[k]).length,
        confidence
      });

      return soap;

    } catch (error) {
      this.log('SOAP extraction failed', { error: error.message });
      throw new Error(`SOAP extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract clinical data from transcript
   * @param {string} transcript - Voice transcript
   * @param {Object} options - Extraction options
   * @returns {Object} Clinical data
   */
  async extractClinicalData(transcript, options = {}) {
    try {
      this.log('Extracting clinical data', {
        focus: options.focus || 'general'
      });

      const clinical = {
        vitals: this.extractVitals(transcript),
        medications: this.extractMedications(transcript),
        procedures: this.extractProcedures(transcript),
        allergies: this.extractAllergies(transcript),
        complaints: this.extractComplaints(transcript)
      };

      this.log('Clinical data extracted', {
        vitalsCount: Object.keys(clinical.vitals).length,
        medicationsCount: clinical.medications.length,
        proceduresCount: clinical.procedures.length
      });

      return clinical;

    } catch (error) {
      this.log('Clinical data extraction failed', { error: error.message });
      throw new Error(`Clinical extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract vitals from transcript
   */
  extractVitals(transcript) {
    const vitals = {};

    for (const [vital, pattern] of Object.entries(this.clinicalPatterns.vitals)) {
      const match = transcript.match(pattern);
      if (match) {
        vitals[vital] = match[1];
      }
    }

    return vitals;
  }

  /**
   * Extract medications from transcript
   */
  extractMedications(transcript) {
    const medications = [];

    for (const pattern of this.clinicalPatterns.medications) {
      const matches = transcript.matchAll(pattern);
      for (const match of matches) {
        medications.push({
          name: match[1] || match[0],
          dosage: match[2] || 'unknown',
          mentionedIn: match[0]
        });
      }
    }

    return medications;
  }

  /**
   * Extract procedures from transcript
   */
  extractProcedures(transcript) {
    const procedures = [];

    for (const pattern of this.clinicalPatterns.procedures) {
      const matches = transcript.matchAll(pattern);
      for (const match of matches) {
        procedures.push({
          name: match[1] || match[0],
          mentionedIn: match[0]
        });
      }
    }

    return procedures;
  }

  /**
   * Extract allergies from transcript
   */
  extractAllergies(transcript) {
    const allergies = [];

    const allergyPattern = /(?:allergic to|allergy|allergies)\s*(?:to)?\s*([a-z]+(?:\s+[a-z]+)?)/gi;
    const matches = transcript.matchAll(allergyPattern);

    for (const match of matches) {
      allergies.push(match[1].trim());
    }

    return allergies;
  }

  /**
   * Extract patient complaints from transcript
   */
  extractComplaints(transcript) {
    const complaints = [];

    // Common complaint patterns
    const complaintPatterns = [
      /(?:complains of|reporting|presents with)\s+([a-z]+(?:\s+[a-z]+)?)/gi,
      /(?:pain|ache|discomfort|symptom)\s+(?:in|at|on)\s+([a-z]+(?:\s+[a-z]+)?)/gi
    ];

    for (const pattern of complaintPatterns) {
      const matches = transcript.matchAll(pattern);
      for (const match of matches) {
        complaints.push(match[1].trim());
      }
    }

    return complaints;
  }

  /**
   * Detect which SOAP section a sentence belongs to
   */
  detectSOAPSection(sentence) {
    const lowerSentence = sentence.toLowerCase();

    for (const [section, patterns] of Object.entries(this.soapPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(lowerSentence)) {
          return section;
        }
      }
    }

    return null;
  }

  /**
   * Split transcript into sentences
   */
  splitIntoSentences(transcript) {
    // Simple sentence splitting - could be enhanced with NLP
    return transcript
      .replace(/([.!?])\s+/g, '$1|')
      .split('|')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Clean extracted text
   */
  cleanExtractedText(text) {
    if (!text) return '';

    return text
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/\s*([.,;:!])\s*/g, '$1 ')  // Fix punctuation spacing
      .trim();
  }

  /**
   * Calculate confidence for SOAP extraction
   */
  calculateSOAPConfidence(soap) {
    let confidence = 0.0;
    const sections = ['subjective', 'objective', 'assessment', 'plan'];
    let filledSections = 0;

    for (const section of sections) {
      if (soap[section] && soap[section].length > 10) {
        filledSections++;
      }
    }

    confidence = filledSections / sections.length;

    // Boost confidence if we have multiple substantial sections
    const substantialSections = sections.filter(s =>
      soap[s] && soap[s].length > 50
    ).length;

    if (substantialSections >= 2) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Logging utility
   */
  log(message, data = {}) {
    console.log(`[${this.name}] ${message}`, data);
  }

  /**
   * Get skill version
   */
  get version() {
    return '1.0.0';
  }
}

module.exports = DailyNoteExtractionSkill;