/**
 * Medication Brand Verifier Tool (V2)
 * Uses Gemini Grounded Search to verify Indian pharmaceutical brand names
 * Falls back to local database for common brands
 */

class MedicationBrandVerifierTool {
  constructor(config = {}) {
    this.name = "Medication Brand Verifier V2";
    this.version = "2.0.0";
    this.config = config;

    // Import Gemini client for grounded search
    const GeminiClientTool = require("../llm/gemini_client.tool.cjs");
    this.geminiClient = new GeminiClientTool({
      baseUrl: config.geminiBaseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models",
      model: config.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash",
      timeout: config.timeout || 30000,
      apiKey: config.apiKey || process.env.GEMINI_API_KEY || ""
    });

    // Small local cache for verified results (to avoid repeated searches)
    this.verificationCache = new Map();
    this.cacheMaxSize = 1000;

    // Minimal fallback database for ultra-common brands (fast path)
    this.commonBrands = {
      "DOLO": { generic: "Paracetamol", category: "Analgesic" },
      "DOLO-650": { generic: "Paracetamol 650mg", category: "Analgesic" },
      "MONTEK-LC": { generic: "Montelukast + Levocetirizine", category: "Antihistamine" },
      "ZINCOVIT": { generic: "Multivitamin + Minerals", category: "Vitamin" },
      "D-Rise": { generic: "Cholecalciferol 60K", category: "Vitamin D" },
      "PANTOCID": { generic: "Pantoprazole", category: "PPI" },
      "AMLOPRES": { generic: "Amlodipine", category: "Calcium Channel Blocker" }
    };
  }

  /**
   * Normalize name for comparison
   */
  normalizeName(name) {
    if (!name || typeof name !== 'string') return '';
    return name.toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/^(TAB|CAP|INJ|SYP|DR)\s*/i, '')
      .trim();
  }

  /**
   * Check if name is in common brands cache
   */
  checkCommonBrands(normalizedName) {
    for (const [brand, data] of Object.entries(this.commonBrands)) {
      const normalizedBrand = this.normalizeName(brand);
      if (normalizedName === normalizedBrand) {
        return { brand, ...data, source: 'local_cache' };
      }
    }
    return null;
  }

  /**
   * Check verification cache
   */
  checkCache(normalizedName) {
    const cached = this.verificationCache.get(normalizedName);
    if (cached && (Date.now() - cached.timestamp) < 24 * 60 * 60 * 1000) { // 24 hour TTL
      return cached;
    }
    return null;
  }

  /**
   * Add to cache (with LRU eviction)
   */
  addToCache(normalizedName, result) {
    if (this.verificationCache.size >= this.cacheMaxSize) {
      const firstKey = this.verificationCache.keys().next().value;
      this.verificationCache.delete(firstKey);
    }
    this.verificationCache.set(normalizedName, {
      ...result,
      timestamp: Date.now()
    });
  }

  /**
   * Verify a medication brand using Gemini Grounded Search
   */
  async verifyBrand(name, apiKey) {
    const normalizedName = this.normalizeName(name);

    if (!normalizedName) {
      return { valid: false, corrected: null, confidence: 'invalid' };
    }

    // Check common brands first (fast path)
    const commonMatch = this.checkCommonBrands(normalizedName);
    if (commonMatch) {
      return {
        valid: true,
        corrected: name,
        originalName: name,
        generic: commonMatch.generic,
        category: commonMatch.category,
        confidence: 'high',
        source: 'local_common'
      };
    }

    // Check cache
    const cached = this.checkCache(normalizedName);
    if (cached) {
      return {
        ...cached.verification,
        source: 'cache'
      };
    }

    // Use Gemini Grounded Search for verification
    try {
      const prompt = `You are a pharmaceutical brand verification expert for Indian medicines.

Analyze this potential medication brand name: "${name}"

Questions to answer:
1. Is "${name}" a valid Indian pharmaceutical brand name?
2. If not, what is the most similar valid brand name it could be (consider common misreadings)?
3. What is the generic name and drug category?

Respond ONLY in this JSON format:
{
  "is_valid_brand": true/false,
  "corrected_brand": "actual brand name or null",
  "generic_name": "generic drug name or null",
  "category": "drug category or null",
  "confidence": "high/medium/low",
  "reasoning": "brief explanation"
}`;

      const result = await this.geminiClient.executeGroundedSearch(prompt, {
        temperature: 0.1,
        maxTokens: 500,
        apiKey: apiKey || this.geminiClient.apiKey
      });

      if (!result.success) {
        console.warn(`[BrandVerifier] Grounded search failed for "${name}": ${result.error}`);
        // DO NOT bless bad OCR - mark as uncertain
        return {
          valid: false,
          corrected: name,
          originalName: name,
          confidence: 'uncertain',
          source: 'verification_failed',
          reasoning: 'Verification service unavailable'
        };
      }

      // Parse response
      const verified = this.parseVerificationResponse(result.content, name);

      // If not a valid brand and no good correction found, mark uncertain
      if (!verified.valid || verified.confidence === 'low') {
        verified.confidence = 'uncertain';
        verified.valid = false;
      }

      // Cache the result
      this.addToCache(normalizedName, { verification: verified });

      return {
        ...verified,
        source: 'grounded_search',
        citations: result.citations || []
      };
    } catch (error) {
      console.error(`[BrandVerifier] Verification error for "${name}": ${error.message}`);
      // DO NOT bless bad OCR - mark as uncertain
      return {
        valid: false,
        corrected: name,
        originalName: name,
        confidence: 'uncertain',
        source: 'error',
        reasoning: `Verification error: ${error.message}`
      };
    }
  }

  /**
   * Parse JSON from model response
   * Handles markdown code blocks, prose-prefixed JSON, and various response formats
   */
  parseModelJson(content) {
    const text = String(content || "").trim();

    // Strategy 1: Try parsing as-is (already clean JSON)
    const candidates = [text];

    // Strategy 2: Remove markdown code blocks
    const withoutMarkdown = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    candidates.push(withoutMarkdown);

    // Strategy 3: Extract JSON object from any prose
    // Find the outermost braces that form a valid JSON object
    let braceDepth = 0;
    let jsonStart = -1;
    let jsonEnd = -1;

    for (let i = 0; i < text.length; i++) {
      if (text[i] === "{") {
        if (braceDepth === 0) jsonStart = i;
        braceDepth++;
      } else if (text[i] === "}") {
        braceDepth--;
        if (braceDepth === 0 && jsonStart >= 0) {
          jsonEnd = i;
          break; // Found the complete outermost object
        }
      }
    }

    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const extracted = text.substring(jsonStart, jsonEnd + 1);
      candidates.push(extracted);
    }

    // Strategy 4: Try to find the last { } pair in markdown-stripped text
    // (handles cases where model adds trailing text)
    const firstBrace = withoutMarkdown.indexOf("{");
    const lastBrace = withoutMarkdown.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(withoutMarkdown.slice(firstBrace, lastBrace + 1));
    }

    // Try each candidate in order
    for (const candidate of candidates) {
      if (!candidate || candidate.length < 2) continue;
      try {
        const parsed = JSON.parse(candidate);
        // Validate it's an object (not array, string, etc.)
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch (_error) {
        continue;
      }
    }

    throw new Error("Unable to parse model JSON response");
  }

  /**
   * Parse Gemini's verification response
   */
  parseVerificationResponse(content, originalName) {
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Parse failed - mark uncertain, don't bless bad OCR
      return {
        valid: false,
        corrected: originalName,
        originalName: originalName,
        confidence: 'uncertain',
        reasoning: 'Failed to parse verification response'
      };
    }

    try {
      const data = JSON.parse(jsonMatch[0]);

      const isValid = data.is_valid_brand === true;
      const corrected = data.corrected_brand || originalName;
      const confidence = data.confidence || 'medium';

      // If not clearly valid or low confidence, mark uncertain
      if (!isValid || confidence === 'low') {
        return {
          valid: false,
          corrected: originalName,
          originalName: originalName,
          generic: data.generic_name || null,
          category: data.category || null,
          confidence: 'uncertain',
          reasoning: data.reasoning || 'Brand verification inconclusive',
          needsCorrection: false
        };
      }

      const needsCorrection = isValid && corrected !== originalName;

      return {
        valid: isValid,
        corrected: corrected,
        originalName: originalName,
        generic: data.generic_name || null,
        category: data.category || null,
        confidence: confidence,
        reasoning: data.reasoning || '',
        needsCorrection: needsCorrection
      };
    } catch (error) {
      console.warn(`[BrandVerifier] Failed to parse verification response: ${error.message}`);
      // Parse error - mark uncertain, don't bless bad OCR
      return {
        valid: false,
        corrected: originalName,
        originalName: originalName,
        confidence: 'uncertain',
        reasoning: 'Failed to parse verification response'
      };
    }
  }

  /**
   * Verify a single medication entry
   */
  async verifyMedication(medication, apiKey) {
    const name = medication.name || medication.generic_name || "";

    if (!name) {
      return {
        original: medication,
        corrected: medication,
        changes: [],
        confidence: 'empty'
      };
    }

    const verification = await this.verifyBrand(name, apiKey);
    const corrected = { ...medication };

    const changes = [];

    if (verification.needsCorrection || verification.corrected !== name) {
      corrected.name = verification.corrected;
      corrected.original_name = name;
      changes.push({
        field: 'name',
        from: name,
        to: verification.corrected,
        source: verification.source,
        reasoning: verification.reasoning
      });
    }

    if (verification.generic && !corrected.generic_name) {
      corrected.generic_name = verification.generic;
      changes.push({
        field: 'generic_name',
        value: verification.generic
      });
    }

    if (verification.category && !corrected.category) {
      corrected.category = verification.category;
      changes.push({
        field: 'category',
        value: verification.category
      });
    }

    corrected.verification_source = verification.source;
    corrected.verification_confidence = verification.confidence;

    return {
      original: medication,
      corrected: corrected,
      changes: changes,
      confidence: verification.confidence,
      verification: verification
    };
  }

  /**
   * Verify multiple medications (with batch optimization)
   * @param {Array} medications - Array of medication objects
   * @param {string} apiKey - Gemini API key
   * @param {object} options - { sourceImages, geminiClient }
   */
  async verifyMedications(medications, apiKey, options = {}) {
    if (!Array.isArray(medications)) return [];

    const { sourceImages, geminiClient } = options;

    // First pass: identify unique names to avoid redundant searches
    const uniqueNames = new Map();
    for (const med of medications) {
      const name = med.name || med.generic_name || "";
      if (name && !uniqueNames.has(name)) {
        uniqueNames.set(name, med);
      }
    }

    // Verify each unique name
    const verificationMap = new Map();
    for (const [name, _] of uniqueNames) {
      const result = await this.verifyBrand(name, apiKey);
      verificationMap.set(name, result);
    }

    // Apply verifications to all medications
    const verified = medications.map(med => {
      const name = med.name || med.generic_name || "";
      const verification = verificationMap.get(name);

      if (!verification) {
        // No verification result - keep original but mark uncertain
        return {
          ...med,
          verification_confidence: 'uncertain',
          verification_source: 'not_verified'
        };
      }

      const corrected = { ...med };

      // Only apply correction if verification was successful
      if (verification.valid && verification.corrected && verification.corrected !== name) {
        corrected.name = verification.corrected;
        corrected.original_name = name;
      }

      // Always mark uncertain if verification says so
      if (verification.confidence === 'uncertain' || !verification.valid) {
        corrected.verification_confidence = 'uncertain';
        corrected.verification_uncertain_reason = verification.reasoning || 'Brand could not be verified';
      } else {
        corrected.verification_confidence = verification.confidence;
      }

      if (verification.generic && !corrected.generic_name) {
        corrected.generic_name = verification.generic;
      }

      if (verification.category && !corrected.category) {
        corrected.category = verification.category;
      }

      corrected.verification_source = verification.source;

      return corrected;
    });

    // Second pass: CORRECTION for uncertain medications using source images
    if (sourceImages && sourceImages.length > 0 && geminiClient) {
      const uncertainMeds = verified.filter(m => m.verification_confidence === 'uncertain');
      if (uncertainMeds.length > 0) {
        console.log(`[BrandVerifier] Attempting visual correction for ${uncertainMeds.length} uncertain medications...`);
        const corrected = await this.correctUncertainMedications(uncertainMeds, sourceImages, geminiClient, apiKey);

        // Merge corrections back into main array using object reference
        const correctedSet = new Set(corrected.map(c => c._medRef));
        return verified.map(med => {
          const correction = corrected.find(c => c._medRef === med);
          // Remove internal _medRef field before returning
          if (correction) {
            const { _medRef, ...cleanCorrection } = correction;
            return cleanCorrection;
          }
          return med;
        });
      }
    }

    return verified;
  }

  /**
   * Attempt visual correction of uncertain medications using the original images
   */
  async correctUncertainMedications(uncertainMeds, sourceImages, geminiClient, apiKey) {
    const corrections = [];

    for (let i = 0; i < uncertainMeds.length; i++) {
      const med = uncertainMeds[i];
      const originalName = med.name || med.generic_name || '';

      console.log(`[BrandVerifier] Correcting "${originalName}" using visual re-read...`);

      try {
        const prompt = `You are a pharmaceutical brand verification expert.

The system read this medication name as "${originalName}" from a handwritten prescription, but this brand could not be verified.

Your task:
1. Look at the prescription image carefully
2. Focus on the handwritten medication list
3. Re-read the medication that was transcribed as "${originalName}"
4. Determine what the actual brand name should be
5. Consider common Indian pharmaceutical brands that look similar to "${originalName}"

Respond with ONLY valid JSON in this exact format:
{
  "corrected_brand": "brand name or null",
  "generic_name": "generic name or null",
  "confidence": "high|medium|low",
  "reasoning": "explanation"
}

Do NOT include any text before or after the JSON. Do NOT use markdown code blocks.`;

        const result = await geminiClient.execute(prompt, {
          images: sourceImages,
          temperature: 0.1,
          maxTokens: 8192,
          responseMimeType: "application/json" // Re-enabled for gemini-2.5-pro
        });

        if (result.success) {
          // Check for response truncation
          if (result.finishReason && result.finishReason !== "STOP") {
            console.warn(`[BrandVerifier] Response truncated for "${originalName}": finishReason=${result.finishReason}`);
          }

          // Log response metadata for debugging
          console.log(`[BrandVerifier] Response length: ${result.content?.length} chars, tokens used: ${result.usage?.totalTokenCount || 'unknown'}`);

          try {
            const data = this.parseModelJson(result.content);

            // Normalize confidence - handle both string and numeric formats
            let confidence = data.confidence;
            if (typeof confidence === 'number') {
              confidence = confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
            }

            if (data.corrected_brand && data.corrected_brand !== originalName && data.corrected_brand !== 'null' && confidence !== 'low') {
              console.log(`[BrandVerifier] Visual correction: "${originalName}" → "${data.corrected_brand}" (${confidence})`);

              // Apply the correction - store the original medication reference
              corrections.push({
                ...med,
                name: data.corrected_brand,
                original_name: originalName,
                verification_confidence: confidence,
                verification_source: 'visual_correction',
                verification_uncertain_reason: undefined,
                generic_name: data.generic_name && data.generic_name !== 'null' ? data.generic_name : med.generic_name,
                _medRef: med // Reference to find original index later
              });
              continue;
            } else {
              console.log(`[BrandVerifier] No suitable correction found for "${originalName}"`);
            }
          } catch (parseError) {
            console.warn(`[BrandVerifier] Parse error for "${originalName}": ${parseError.message}`);
            console.warn(`[BrandVerifier] Response was: ${result.content?.substring(0, 500)}`);

            // Save debug artifact for failed corrections
            this.saveDebugArtifact(originalName, result.content, parseError.message);
          }
        } else {
          console.warn(`[BrandVerifier] Gemini call failed for "${originalName}": ${result.error}`);
        }

        // No correction possible - keep original
        corrections.push({ ...med, _medRef: med });

      } catch (error) {
        console.warn(`[BrandVerifier] Visual correction failed for "${originalName}": ${error.message}`);
        corrections.push({ ...med, _medRef: med });
      }
    }

    return corrections;
  }

  /**
   * Save debug artifact for failed visual corrections
   * Helps inspect model responses when parsing fails
   */
  async saveDebugArtifact(medicationName, rawResponse, errorMessage) {
    const fs = require("fs/promises");
    const path = require("path");

    try {
      const debugDir = path.join(process.cwd(), "data", "debug", "visual_correction");
      await fs.mkdir(debugDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const sanitizedName = medicationName.replace(/[^a-zA-Z0-9]/g, "_");
      const filename = `${timestamp}_${sanitizedName}.json`;
      const filepath = path.join(debugDir, filename);

      const artifact = {
        timestamp: new Date().toISOString(),
        medication_name: medicationName,
        error_message: errorMessage,
        raw_response: rawResponse,
        response_length: rawResponse?.length || 0,
        response_preview: rawResponse?.substring(0, 200) || ""
      };

      await fs.writeFile(filepath, JSON.stringify(artifact, null, 2));
      console.log(`[BrandVerifier] Debug artifact saved: ${filepath}`);
    } catch (error) {
      // Non-blocking - don't fail if debug write fails
      console.warn(`[BrandVerifier] Failed to save debug artifact: ${error.message}`);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.verificationCache.size,
      maxSize: this.cacheMaxSize,
      hitRate: this.cacheHits / Math.max(1, this.cacheMisses),
      entries: Array.from(this.verificationCache.entries()).map(([name, data]) => ({
        name,
        corrected: data.verification.corrected,
        confidence: data.verification.confidence,
        age: Date.now() - data.timestamp
      }))
    };
  }

  /**
   * Clear cache (useful for testing or force refresh)
   */
  clearCache() {
    this.verificationCache.clear();
  }
}

module.exports = MedicationBrandVerifierTool;
