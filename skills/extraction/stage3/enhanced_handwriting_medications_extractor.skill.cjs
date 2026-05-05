/**
 * Enhanced Handwriting Medications Extractor Skill (Stage 3)
 * Extracts handwritten medications from masked prescription images
 * Uses:
 * - Page-aware extraction (medication page only)
 * - Higher DPI for medication lists
 * - Brand name verification
 * - Region-focused extraction (when available)
 */

class EnhancedHandwritingMedicationsExtractorSkill {
  constructor(config = {}) {
    this.name = "Enhanced Handwriting Medications Extractor";
    this.version = "2.0.0";
    this.config = config;
    this.geminiClient = null;
    this.currentApiKey = null;

    // Import tools
    const PdfToImageConverterTool = require("../../../tools/pdf/pdf_to_image_converter.tool.cjs");
    const MedicationBrandVerifierTool = require("../../../tools/validation/medication_brand_verifier.tool.cjs");
    const GeminiClientTool = require("../../../tools/llm/gemini_client.tool.cjs");

    this.pdfConverter = new PdfToImageConverterTool(config.pdfConverter || {});
    this.brandVerifier = new MedicationBrandVerifierTool(config.brandVerifier || {});
    this.GeminiClientTool = GeminiClientTool;

    this.geminiConfig = {
      geminiBaseUrl: config.geminiBaseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models",
      geminiModel: config.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash",
      timeout: config.timeout || 180000
    };
  }

  /**
   * Get or create Gemini client
   */
  getGeminiClient(apiKey) {
    const effectiveKey = apiKey || this.config.apiKey || "";
    if (!this.geminiClient || this.currentApiKey !== effectiveKey) {
      this.geminiClient = new this.GeminiClientTool({
        baseUrl: this.geminiConfig.geminiBaseUrl,
        model: this.geminiConfig.geminiModel,
        timeout: this.geminiConfig.timeout,
        apiKey: effectiveKey
      });
      this.currentApiKey = effectiveKey;
    }
    return this.geminiClient;
  }

  /**
   * Parse JSON response with fallbacks
   */
  parseModelJson(content) {
    const normalized = String(content || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const candidates = [normalized];
    const firstBrace = normalized.indexOf("{");
    const lastBrace = normalized.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(normalized.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (_error) {
        continue;
      }
    }

    throw new Error("Unable to parse model JSON response");
  }

  /**
   * Build focused prompt for medication extraction
   */
  buildMedicationPrompt() {
    return `You are an expert at reading handwritten medical prescriptions.

Your task is to extract ONLY medication entries from the prescription image.

FOCUS EXCLUSIVELY ON:
- Medicine names (brand names or generic names)
- Dosage (strength, e.g., 500mg, 10mg)
- Form (tablet, capsule, syrup, injection, etc.)
- Frequency (OD, BD, TDS, QID, SOS, or descriptive)
- Duration (e.g., 5 days, 1 week)
- Route (oral, IV, IM, topical, inhaled)

DO NOT EXTRACT:
- Diagnoses
- Lab tests
- Radiology studies
- Vital signs
- Doctor/patient/hospital information
- General advice

EXTRACTION RULES:
- Extract each medication line as a separate entry
- Preserve brand names exactly as written when legible
- If handwriting is partially illegible, extract what you can read and mark confidence as "low"
- If a line is completely unreadable, do NOT invent - just increment unreadable_count
- Do NOT include prefixes like "Tab", "Cap", "Inj", "Syp" in the name field
- Expand common abbreviations: OD=once daily, BD=twice daily, TDS=thrice daily, QID=four times daily

STRICT JSON RULES:
- Return exactly one JSON object
- Use double quotes for all keys and string values
- No markdown, no code fences, no prose, no comments

Return ONLY valid JSON in this format:
{
  "medications": [
    {
      "name": "brand or generic name",
      "generic_name": "generic if different or null",
      "dosage": "strength with unit",
      "form": "tablet|capsule|syrup|injection|ointment|cream|drops|inhaler",
      "frequency": "OD|BD|TDS|QID|SOS|description|null",
      "duration": "duration or null",
      "route": "oral|IV|IM|topical|inhaled|unknown",
      "instructions": "special instructions or null",
      "confidence": "high|medium|low",
      "is_handwritten": true
    }
  ],
  "total_count": 5,
  "has_unreadable": false,
  "unreadable_count": 0
}

Remember: Return ONLY the JSON object, no additional text or explanation.`;
  }

  /**
   * Extract medications from a single page
   */
  async extractFromPage(imageBase64, apiKey, options = {}) {
    const geminiClient = this.getGeminiClient(apiKey);
    const prompt = this.buildMedicationPrompt();

    const result = await geminiClient.execute(prompt, {
      images: [imageBase64],
      temperature: 0.1,
      maxTokens: 4096,
      thinkingBudget: options.thinkingBudget || 4096,
      responseMimeType: "application/json",
      systemInstruction: "You are a medical document extraction expert specializing in handwritten prescriptions. Focus on accuracy for medication names."
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const data = this.parseModelJson(result.content);

    // Apply brand name verification
    const verifiedMedications = this.brandVerifier.verifyMedications(
      Array.isArray(data.medications) ? data.medications : []
    );

    return {
      success: true,
      data: {
        medications: verifiedMedications,
        total_count: verifiedMedications.length,
        has_unreadable: data.has_unreadable || false,
        unreadable_count: data.unreadable_count || 0
      },
      usage: result.usage
    };
  }

  /**
   * Execute medication extraction with page-aware, high-DPI approach
   */
  async execute(context) {
    const { pdfPath, apiKey, onProgress, medicationPage = 1, useHighDpi = true } = context;

    if (!pdfPath) {
      return {
        success: false,
        step: "enhanced_medications_extractor",
        error: "PDF path is required for enhanced medication extraction"
      };
    }

    if (!apiKey) {
      return {
        success: false,
        step: "enhanced_medications_extractor",
        error: "Gemini API key is required for medication extraction"
      };
    }

    try {
      console.log(`[EnhancedMeds] Starting extraction from ${pdfPath}`);
      console.log(`[EnhancedMeds] Medication page: ${medicationPage}, High DPI: ${useHighDpi}`);

      if (onProgress) {
        onProgress({
          type: 'info',
          step: 'enhanced_medications_extractor',
          status: 'processing',
          message: `Converting PDF to high-DPI image for medication extraction...`
        });
      }

      // Convert medication page to image at appropriate DPI
      const conversionResult = await this.pdfConverter.convertPage(pdfPath, medicationPage, {
        purpose: useHighDpi ? 'medications' : 'handwriting'
      });

      if (!conversionResult.success) {
        throw new Error(conversionResult.error);
      }

      const imageBase64 = `data:image/png;base64,${conversionResult.base64}`;
      console.log(`[EnhancedMeds] Image converted at ${conversionResult.dpi} DPI`);

      if (onProgress) {
        onProgress({
          type: 'info',
          step: 'enhanced_medications_extractor',
          status: 'processing',
          message: `Extracting medications from ${conversionResult.dpi} DPI image...`
        });
      }

      // Extract medications
      const extractResult = await this.extractFromPage(imageBase64, apiKey, {
        thinkingBudget: this.config.thinkingBudget || 4096
      });

      if (!extractResult.success) {
        return {
          success: false,
          step: 'enhanced_medications_extractor',
          error: extractResult.error
        };
      }

      const meds = extractResult.data.medications || [];
      console.log(`[EnhancedMeds] Extracted ${meds.length} medications`);

      // Log brand corrections
      const corrections = meds.filter(m => m.original_name && m.original_name !== m.name);
      if (corrections.length > 0) {
        console.log(`[EnhancedMeds] Brand corrections applied:`);
        corrections.forEach(m => {
          console.log(`[EnhancedMeds]   "${m.original_name}" → "${m.name}"`);
        });
      }

      if (onProgress) {
        onProgress({
          type: 'success',
          step: 'enhanced_medications_extractor',
          status: 'complete',
          message: `Extracted ${meds.length} medications${corrections.length > 0 ? ` (${corrections.length} brand corrections applied)` : ''}`
        });
      }

      return {
        success: true,
        step: "enhanced_medications_extractor",
        data: extractResult.data,
        metadata: {
          dpi_used: conversionResult.dpi,
          medication_page: medicationPage,
          brand_corrections: corrections.length,
          extraction_method: 'enhanced_page_aware'
        }
      };
    } catch (error) {
      console.error(`[EnhancedMeds] Error: ${error.message}`);
      return {
        success: false,
        step: "enhanced_medications_extractor",
        error: error.message
      };
    }
  }

  /**
   * Legacy interface for compatibility with existing pipeline
   * Falls back to standard extraction if images are provided directly
   */
  async executeLegacy(context) {
    const { images, maskedImage, apiKey, onProgress } = context;
    const imagesForExtraction = images || (maskedImage ? [maskedImage] : null);

    if (!imagesForExtraction || imagesForExtraction.length === 0) {
      return {
        success: false,
        step: "handwriting_medications_extractor",
        error: "Images are required for handwriting extraction"
      };
    }

    if (!apiKey) {
      return {
        success: false,
        step: "handwriting_medications_extractor",
        error: "Gemini API key is required for handwriting extraction"
      };
    }

    try {
      const geminiClient = this.getGeminiClient(apiKey);
      const prompt = this.buildMedicationPrompt();

      const result = await geminiClient.execute(prompt, {
        images: imagesForExtraction,
        temperature: 0.1,
        maxTokens: 4096,
        responseMimeType: "application/json",
        systemInstruction: "You are a medical document extraction expert specializing in handwritten prescriptions."
      });

      if (!result.success) {
        return {
          success: false,
          step: "handwriting_medications_extractor",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);

      // Apply brand verification even to legacy mode
      const verifiedMedications = this.brandVerifier.verifyMedications(
        Array.isArray(data.medications) ? data.medications : []
      );

      const corrections = verifiedMedications.filter(m => m.original_name && m.original_name !== m.name);
      if (corrections.length > 0) {
        console.log(`[MedsLegacy] Brand corrections applied: ${corrections.length}`);
      }

      if (onProgress) {
        onProgress({
          type: 'success',
          step: 'handwriting_medications_extractor',
          status: 'complete',
          message: `Extracted ${verifiedMedications.length} medications`
        });
      }

      return {
        success: true,
        step: 'handwriting_medications_extractor',
        data: {
          medications: verifiedMedications,
          total_count: data.total_count || verifiedMedications.length,
          has_unreadable: data.has_unreadable || false,
          unreadable_count: data.unreadable_count || 0
        },
        usage: result.usage
      };
    } catch (error) {
      return {
        success: false,
        step: 'handwriting_medications_extractor',
        error: error.message
      };
    }
  }
}

module.exports = EnhancedHandwritingMedicationsExtractorSkill;
