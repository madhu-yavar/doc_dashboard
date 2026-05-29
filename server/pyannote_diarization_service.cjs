const fs = require("fs");
const fsp = require("fs/promises");
const FormData = require("form-data");
const path = require("path");

class PyannoteDiarizationService {
  constructor(config = {}) {
    this.name = "PyannoteDiarizationService";
    this.version = "1.0.0";
    this.apiUrl = config.apiUrl || "http://206.1.62.28:8009/diarize";
    this.apiKey = config.apiKey || "test123";
    this.timeout = config.timeout || 120000; // 2 minutes
    this.debug = config.debug || false;
  }

  log(message, data = {}) {
    if (this.debug) {
      console.log(`[PyannoteDiarization] ${message}`, data);
    }
  }

  /**
   * Diarize an audio file and return speaker segments
   * @param {string} audioPath - Absolute path to audio file
   * @returns {Promise<Object|null>} Diarization result or null on failure
   */
  async diarize(audioPath) {
    try {
      // Check if file exists
      const stats = await fsp.stat(audioPath);
      if (!stats.isFile()) {
        throw new Error(`Audio file not found: ${audioPath}`);
      }

      this.log("Starting diarization", { audioPath, size: stats.size });

      // Create form data
      const form = new FormData();
      form.append("file", fs.createReadStream(audioPath));

      // Make request to pyannote service
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          ...form.getHeaders(),
          "X-API-Key": this.apiKey,
        },
        body: form,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Diarization service returned ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      this.log("Diarization completed", {
        numSpeakers: result.num_speakers,
        segmentCount: result.segments?.length,
      });

      return this.normalizeDiarizationResult(result);
    } catch (error) {
      if (error.name === "AbortError") {
        this.log("Diarization timed out", { audioPath });
        throw new Error(`Diarization timed out after ${this.timeout}ms`);
      }
      this.log("Diarization failed", { audioPath, error: error.message });
      throw error;
    }
  }

  /**
   * Normalize pyannote response format to internal format
   */
  normalizeDiarizationResult(result) {
    const segments = (result.segments || []).map((seg, index) => ({
      id: `diarization-${index}`,
      start: Number(seg.start) || 0,
      end: Number(seg.end) || 0,
      speaker: String(seg.speaker || "UNKNOWN"),
    }));

    const speakers = (result.speakers || []).map((speaker, index) => ({
      id: String(speaker),
      label: `Speaker ${index + 1}`,
      role: "unknown", // Could be inferred from conversation patterns
    }));

    return {
      numSpeakers: Number(result.num_speakers) || 0,
      speakers,
      segments,
      metadata: {
        serviceName: "pyannote",
        processedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Merge diarization results with transcript segments
   * @param {Object} transcriptData - Transcript with segments
   * @param {Object} diarizationData - Diarization result
   * @returns {Object} Merged transcript with speaker labels
   */
  mergeDiarizationWithTranscript(transcriptData, diarizationData) {
    const transcriptSegments = transcriptData.segments || [];
    const diarizationSegments = diarizationData.segments || [];

    // Map speakers from pyannote format to readable labels
    const speakerMap = this.buildSpeakerMap(diarizationData);

    // Assign speakers to each transcript segment based on timing
    const mergedSegments = transcriptSegments.map((segment) => {
      const segmentStart = Number(segment.startSeconds) || 0;
      const segmentEnd = Number(segment.endSeconds) || segmentStart;

      // Find overlapping diarization segment
      const speaker = this.findSpeakerForTime(diarizationSegments, segmentStart, segmentEnd);

      return {
        ...segment,
        speakerId: speaker || segment.speakerId || "spk_0",
        speakerLabel: speakerMap.get(speaker) || segment.speakerLabel || "Unknown",
        speakerRole: this.inferSpeakerRole(segment, speaker),
      };
    });

    return {
      ...transcriptData,
      segments: mergedSegments,
      speakers: Array.from(speakerMap.values()),
      metadata: {
        ...transcriptData.metadata,
        diarization: {
          serviceName: diarizationData.metadata?.serviceName || "pyannote",
          processedAt: diarizationData.metadata?.processedAt,
          numSpeakers: diarizationData.numSpeakers,
        },
      },
    };
  }

  /**
   * Build a speaker map from diarization data
   */
  buildSpeakerMap(diarizationData) {
    const map = new Map();
    const speakers = diarizationData.speakers || [];

    for (const speaker of speakers) {
      const id = speaker.id || speaker.speaker;
      const label = speaker.label || `Speaker ${map.size + 1}`;
      map.set(id, {
        id,
        label,
        role: speaker.role || "unknown",
      });
    }

    // If no speakers provided, create from segments
    if (map.size === 0) {
      const uniqueSpeakers = new Set();
      for (const seg of diarizationData.segments || []) {
        uniqueSpeakers.add(seg.speaker);
      }

      let index = 0;
      for (const speakerId of uniqueSpeakers) {
        map.set(speakerId, {
          id: speakerId,
          label: `Speaker ${index + 1}`,
          role: "unknown",
        });
        index++;
      }
    }

    return map;
  }

  /**
   * Find which speaker is talking at a given time range
   */
  findSpeakerForTime(diarizationSegments, start, end) {
    // Find segment with maximum overlap
    let maxOverlap = 0;
    let bestSpeaker = null;

    for (const diarSeg of diarizationSegments) {
      const segStart = diarSeg.start;
      const segEnd = diarSeg.end;

      // Calculate overlap
      const overlapStart = Math.max(start, segStart);
      const overlapEnd = Math.min(end, segEnd);
      const overlap = Math.max(0, overlapEnd - overlapStart);

      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestSpeaker = diarSeg.speaker;
      }
    }

    return bestSpeaker;
  }

  /**
   * Infer speaker role from conversation patterns
   * (Doctor vs Patient detection)
   */
  inferSpeakerRole(segment, speakerId) {
    const text = String(segment?.text || "").toLowerCase().trim();
    const segmentLength = text.split(/\s+/).length;

    // Doctor indicators
    const doctorPatterns = [
      /^(can you|tell me|describe|explain|have you|are you|do you|did you)/i,
      /\b(prescribe|medication|treatment|diagnosis|examine|check)\b/i,
      /\b(blood pressure|temperature|pulse|vitals)\b/i,
    ];

    // Patient indicators
    const patientPatterns = [
      /^(i have|i feel|i'm experiencing|my|it hurts|pain)/i,
      /\b(hurting|aching|pain|fever|cough|nausea)\b/i,
    ];

    let doctorScore = 0;
    let patientScore = 0;

    for (const pattern of doctorPatterns) {
      if (pattern.test(text)) doctorScore++;
    }

    for (const pattern of patientPatterns) {
      if (pattern.test(text)) patientScore++;
    }

    // Longer segments tend to be doctor explanations
    if (segmentLength > 20) doctorScore += 0.5;
    // Short responses tend to be patient answers
    if (segmentLength < 10 && segmentLength > 1) patientScore += 0.5;

    if (doctorScore > patientScore) return "doctor";
    if (patientScore > doctorScore) return "patient";
    return "unknown";
  }

  /**
   * Process audio file and return merged transcript with diarization
   * @param {string} audioPath - Path to audio file
   * @param {Object} transcriptData - Existing transcript data
   * @returns {Promise<Object>} Merged transcript with speaker labels
   */
  async processWithDiarization(audioPath, transcriptData) {
    const diarizationResult = await this.diarize(audioPath);
    return this.mergeDiarizationWithTranscript(transcriptData, diarizationResult);
  }
}

module.exports = PyannoteDiarizationService;