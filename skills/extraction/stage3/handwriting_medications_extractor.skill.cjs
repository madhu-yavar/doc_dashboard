/**
 * Handwriting Medications Extractor Skill (Stage 3)
 * Extracts handwritten medications from masked prescription images
 * Uses Gemini 2.5 Flash for superior handwriting recognition
 * Includes brand name verification using Gemini Grounded Search
 * Part of two-stage prescription extraction pipeline
 */

class HandwritingMedicationsExtractorSkill {
  constructor(config = {}) {
    this.name = "Handwriting Medications Extractor";
    this.version = "2.0.0"; // Bumped for grounded search verification
    this.config = config;
    this.geminiClient = null;
    this.currentApiKey = null;

    // Initialize brand verifier V2 with grounded search
    const MedicationBrandVerifierTool = require("../../../tools/validation/medication_brand_verifier_v2.tool.cjs");
    this.brandVerifier = new MedicationBrandVerifierTool(config.brandVerifier || {});
  }

  getGeminiClient(apiKey) {
    // Create new client if API key changed or client doesn't exist
    const effectiveKey = apiKey || this.config.apiKey || "";
    if (!this.geminiClient || this.currentApiKey !== effectiveKey) {
      const GeminiClientTool = require("../../../tools/llm/gemini_client.tool.cjs");
      this.geminiClient = new GeminiClientTool({
        baseUrl: this.config.geminiBaseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models",
        model: this.config.geminiModel || "gemini-2.5-flash",
        timeout: this.config.timeout || 180000,
        apiKey: effectiveKey
      });
      this.currentApiKey = effectiveKey;
    }
    return this.geminiClient;
  }

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

  buildPrompt(documentStructure = {}, pageSubset = null) {
    const hasPrescriptionTable = documentStructure.has_prescription_table;
    const tableLocation = documentStructure.prescription_table_location || "unknown";
    const pagesInfo = pageSubset
      ? `You are receiving ONLY pages ${pageSubset.join(', ')} which were pre-selected as most likely to contain medication orders.`
      : 'You are receiving all pages of this prescription.';

    return `You are an expert at reading handwritten medical prescriptions.

Your task is to analyze the prescription pages and extract ONLY MEDICATION ENTRIES.

DOCUMENT CONTEXT:
- Has prescription table: ${hasPrescriptionTable}
- Table location: ${tableLocation}
- ${pagesInfo}

EXTRACT FOR EACH MEDICATION:
- name
- generic_name
- dosage
- form
- frequency
- duration
- route
- instructions
- confidence

RULES:
- Extract medications ONLY from the pages provided. These pages were specifically selected because they are most likely to contain medication orders.
- Do NOT look for medications on pages that are not provided.
- Extract only medicines actually written in the prescription. Do NOT extract diagnoses, lab tests, radiology studies, advice, or follow-up notes as medications.
- CRITICAL: If the page contains only headers, patient information, hospital logos, or administrative text (no medication list), return an EMPTY medications array.
- CRITICAL: A valid medication MUST have at minimum: a brand/generic name AND one of (dosage, frequency, or duration). If these are missing, do NOT extract it.
- CRITICAL: Do NOT extract words like "Tablet", "Capsule", "Injection", "Syrup" as medication names unless they are part of a brand name.
- Preserve the medicine text as written when possible. Do NOT shorten or normalize into a partial token unless the writing itself is partial.
- Do NOT include form prefixes such as "Tab", "T.", "Cap", "Inj", "Syp" in the name field unless they are genuinely part of the brand name.
- If a medication line is partly legible, return your best full reading and set confidence to "low".
- If a medication line is unreadable, do NOT invent a name. Exclude it from "medications" and increment unreadable_count.
- Expand abbreviations where safe: OD=once daily, BD=twice daily, TDS=thrice daily, QID=four times daily, SOS=as needed.
- Infer route only when it is strongly implied by the form. Otherwise use "unknown".
- Use null for fields not present except:
  - dosage: use "As prescribed" only when a medicine is clearly present but no dosage is written
  - is_handwritten: always true
- If no medications are present, return an empty array and total_count 0.

STRICT JSON RULES:
- Return exactly one JSON object.
- Use double quotes for all keys and string values.
- No markdown, no code fences, no prose, no comments, no trailing commas.

Return ONLY valid JSON in this format:
{
  "medications": [
    {
      "name": "medicine name",
      "generic_name": "generic name if different or null",
      "dosage": "e.g., 500mg",
      "form": "tablet|syrup|injection|capsule|ointment|cream|drops|inhaler",
      "frequency": "OD|BD|TDS|QID|SOS|or description or null",
      "duration": "e.g., 5 days or null",
      "route": "oral|IV|IM|topical|inhaled|unknown",
      "instructions": "special instructions if any or null",
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
   * Execute handwriting medications extraction
   * @param {object} context - { images, maskedImage, documentStructure, apiKey, pageSubset }
   * @returns {Promise<object>}
   */
  async execute(context) {
    // Support both old (maskedImage) and new (images array) interface
    const { images, maskedImage, documentStructure, apiKey, pageSubset, onProgress } = context;
    const imagesForExtraction = images || (maskedImage ? [maskedImage] : null);

    console.log(`[Stage3-Medications] EXECUTE called! images=${imagesForExtraction?.length || 0}, pageSubset=${pageSubset?.join(',') || 'all'}, apiKey=${!!apiKey}`);

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
      console.log(`[Stage3-Medications] Getting Gemini client...`);
      const geminiClient = this.getGeminiClient(apiKey);
      console.log(`[Stage3-Medications] Gemini client obtained`);

      if (onProgress) {
        onProgress({
          type: "info",
          step: "handwriting_medications_extractor",
          status: "processing",
          message: `Extracting handwritten medications from ${imagesForExtraction.length} page(s)${pageSubset ? ` [pages ${pageSubset.join(', ')}]` : ''}...`
        });
      }

      console.log(`[Stage3-Medications] Calling Gemini with ${imagesForExtraction.length} image(s)`);
      const prompt = this.buildPrompt(documentStructure, pageSubset);

      const result = await geminiClient.execute(prompt, {
        images: imagesForExtraction,
        temperature: 0.1,
        maxTokens: 4096,
        responseMimeType: "application/json",
        systemInstruction: "You are a medical document extraction expert specializing in handwritten prescriptions. You have excellent handwriting recognition skills."
      });

      console.log(`[Stage3-Medications] Gemini result: success=${result.success}, error=${result.error?.substring(0, 100) || 'none'}`);

      if (!result.success) {
        console.error(`[Stage3-Medications] Gemini failed: ${result.error}`);
        return {
          success: false,
          step: "handwriting_medications_extractor",
          error: result.error
        };
      }

      const data = this.parseModelJson(result.content);

      // Apply brand name verification using Gemini Grounded Search
      const rawMedications = Array.isArray(data.medications) ? data.medications : [];
      console.log(`[Stage3-Medications] Verifying ${rawMedications.length} medications with Gemini Grounded Search...`);

      // Pass source images for correction when brands are uncertain
      const verifiedMedications = await this.brandVerifier.verifyMedications(rawMedications, apiKey, {
        sourceImages: imagesForExtraction,
        geminiClient: this.getGeminiClient(apiKey)
      });

      // Log any corrections
      const corrections = verifiedMedications.filter(m => m.original_name && m.original_name !== m.name);
      if (corrections.length > 0) {
        console.log(`[Stage3-Medications] Brand corrections applied:`);
        corrections.forEach(m => {
          const source = m.verification_source || 'unknown';
          console.log(`[Stage3-Medications]   "${m.original_name}" → "${m.name}" (source: ${source})`);
        });
      }

      if (onProgress) {
        onProgress({
          type: "success",
          step: "handwriting_medications_extractor",
          status: "complete",
          message: `Extracted ${verifiedMedications.length} medications${corrections.length > 0 ? ` (${corrections.length} verified/corrected)` : ''}`
        });
      }

      return {
        success: true,
        step: "handwriting_medications_extractor",
        data: {
          medications: verifiedMedications,
          total_count: verifiedMedications.length,
          has_unreadable: data.has_unreadable || false,
          unreadable_count: data.unreadable_count || 0,
          brand_corrections: corrections.length,
          verification_method: 'gemini_grounded_search'
        },
        usage: result.usage
      };
    } catch (error) {
      console.error(`[Stage3-Medications] Exception: ${error.message}`);
      console.error(`[Stage3-Medications] Stack: ${error.stack?.split('\n')[0] || 'no stack'}`);
      return {
        success: false,
        step: "handwriting_medications_extractor",
        error: error.message
      };
    }
  }
}

module.exports = HandwritingMedicationsExtractorSkill;
