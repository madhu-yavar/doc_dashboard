/**
 * Cross-Validation Agent Skill
 * Validates extracted data against source document with citations
 * Detects hallucinations and provides source verification
 */

const CitationTrackerTool = require("../../tools/llm/citation_tracker.tool.cjs");

class CrossValidationAgentSkill {
  constructor(config = {}) {
    this.name = "Cross-Validation Agent";
    this.version = "1.0.0";
    this.config = config;
    this.confidenceThreshold = config.confidenceThreshold || 0.9;
  }

  /**
   * Execute validation with citations
   * @param {object} context - { extractedData, pdfText, gemmaClient, promptBuilder, pageNumberMap }
   * @returns {Promise<object>}
   */
  async execute(context) {
    const { extractedData, pdfText, gemmaClient, promptBuilder, pageNumberMap = {} } = context;

    if (!extractedData) {
      return {
        success: false,
        step: "cross_validation",
        error: "No extracted data provided"
      };
    }

    console.log("[CrossValidation] Starting validation with PDF text length:", typeof pdfText, pdfText?.length || 0);

    const citationTracker = new CitationTrackerTool();

    // Step 1: Validate each critical field with citations
    const validationResults = await this.validateAllFields(
      extractedData,
      pdfText,
      gemmaClient,
      promptBuilder,
      citationTracker,
      pageNumberMap
    );

    console.log("[CrossValidation] Validation results:", Object.keys(validationResults).length, "fields validated");

    // Step 2: Generate validation summary
    const summary = citationTracker.generateSummary();

    console.log("[CrossValidation] Summary:", JSON.stringify(summary));

    // Step 3: Return results with citations
    return {
      success: true,
      step: "cross_validation",
      data: {
        validatedData: this.attachCitationsToData(extractedData, citationTracker),
        citations: citationTracker.exportForChartNote(),
        validation: summary,
        fieldsNeedingReview: citationTracker.getFieldsNeedingReview(this.confidenceThreshold)
      }
    };
  }

  /**
   * Validate all critical fields with citations
   */
  async validateAllFields(extractedData, pdfText, gemmaClient, promptBuilder, citationTracker, pageNumberMap) {
    const results = {};

    // Ensure pdfText is a string
    const pdfContent = typeof pdfText === 'string' ? pdfText : (pdfText?.content || "");

    // Define critical field paths and their search terms
    // Paths match the actual extracted_data structure
    const fieldValidations = [
      {
        field: "patient.name",
        path: ["patient", "name"],
        searchTerms: ["Name:", "Patient Name:", "Patient:"]
      },
      {
        field: "patient.mrn",
        path: ["patient", "mrn"],
        searchTerms: ["MRN:", "Hospital No:", "Hospital Number:"]
      },
      {
        field: "patient.age",
        path: ["patient", "age"],
        searchTerms: ["Age:", "Age/Sex:", "years", "Age/Gender:"]
      },
      {
        field: "diagnosis.principal",
        path: ["diagnosis", "principal"],
        searchTerms: ["Principal Diagnosis:", "Diagnosis:", "Provisional Diagnosis:"]
      },
      {
        field: "vitals.bp",
        path: ["latest", "bp"],
        searchTerms: ["BP:", "Blood Pressure:", "BP mm Hg:"]
      },
      {
        field: "vitals.pulse",
        path: ["latest", "pulse"],
        searchTerms: ["Pulse:", "Pulse Rate:", "Pulse/min:", "Heart Rate:"]
      },
      {
        field: "vitals.spo2",
        path: ["latest", "spo2"],
        searchTerms: ["SpO2:", "Saturation:", "SPO2", "Oxygen Saturation:"]
      },
      {
        field: "risk_scores.fall_risk",
        path: ["risk_scores", "fall_risk"],
        searchTerms: ["Fall Risk:", "Fall Risk Assessment:", "Morse Fall Scale", "Humpty Dumpty Score"]
      },
      {
        field: "risk_scores.pressure_ulcer_risk",
        path: ["risk_scores", "pressure_ulcer_risk"],
        searchTerms: ["Braden Scale:", "Pressure Ulcer Risk:", "Braden Q Scale"]
      },
      {
        field: "functional_status.adl",
        path: ["functional_status", "functional_status"],
        searchTerms: ["Activities of Daily Living", "ADL", "Functional Status", "Bathing:", "Dressing:", "Eating:"]
      }
    ];

    // Validate each field
    for (const fieldConfig of fieldValidations) {
      const result = await this.validateField(
        fieldConfig,
        extractedData,
        pdfContent,
        gemmaClient,
        citationTracker,
        pageNumberMap
      );
      results[fieldConfig.field] = result;
    }

    return results;
  }

  /**
   * Validate a single field with citation
   */
  async validateField(fieldConfig, extractedData, pdfContent, gemmaClient, citationTracker, pageNumberMap) {
    const extractedValue = this.getNestedValue(extractedData, fieldConfig.path);

    console.log(`[CrossValidation] Validating ${fieldConfig.field}:`, {
      path: fieldConfig.path,
      found: !!extractedValue,
      value: extractedValue
    });

    if (!extractedValue) {
      return {
        found: false,
        confidence: 0,
        citation: null,
        warning: "Field not found in extracted data"
      };
    }

    // Build search prompt dynamically
    const searchPrompt = this.buildCitationPrompt(fieldConfig.field, fieldConfig.searchTerms, pdfContent);

    // Use LLM to find citation in source
    const citationResult = await this.findCitation(
      fieldConfig.field,
      extractedValue,
      searchPrompt,
      gemmaClient,
      pageNumberMap
    );

    console.log(`[CrossValidation] Citation result for ${fieldConfig.field}:`, { found: citationResult.found, confidence: citationResult.confidence });

    // Add to citation tracker and mark as verified
    if (citationResult.found) {
      const citationId = citationTracker.addCitation(fieldConfig.field, {
        snippet: citationResult.snippet,
        pageNumber: citationResult.pageNumber,
        sectionName: citationResult.sectionName,
        confidence: citationResult.confidence
      });
      // Mark citation as verified since we found it
      citationTracker.verifyCitation(citationId, true);
    }

    return citationResult;
  }

  /**
   * Find citation in source text using LLM
   */
  async findCitation(fieldName, value, searchPrompt, gemmaClient, pageNumberMap) {
    const fullPrompt = `You are a citation finder. Find the EXACT text in the document that supports this data point.

FIELD: ${fieldName}
VALUE TO VERIFY: ${JSON.stringify(value)}

${searchPrompt}

TASK:
1. Search the document text for the EXACT value or very similar text
2. Return the verbatim snippet (exact text from document)
3. Identify the section name and page if possible
4. Rate your confidence (0-1) that this citation supports the value

Return ONLY JSON:
{
  "found": true/false,
  "snippet": "exact text from document",
  "sectionName": "name of section where found",
  "pageNumber": number or null,
  "confidence": 0.0-1.0,
  "notes": "any discrepancies or concerns"
}`;

    try {
      const result = await gemmaClient.execute(fullPrompt, {
        temperature: 0.1,
        maxTokens: 500
      });

      if (!result.success) {
        return {
          found: false,
          confidence: 0,
          citation: null,
          warning: "LLM call failed"
        };
      }

      const parsed = this.parseJsonResponse(result.content);

      return {
        found: parsed.found || false,
        snippet: parsed.snippet || "",
        sectionName: parsed.sectionName || "",
        pageNumber: parsed.pageNumber || null,
        confidence: parsed.confidence || 0,
        notes: parsed.notes || ""
      };
    } catch (error) {
      return {
        found: false,
        confidence: 0,
        citation: null,
        warning: `Error: ${error.message}`
      };
    }
  }

  /**
   * Build citation search prompt
   */
  buildCitationPrompt(fieldName, searchTerms, pdfText) {
    // For efficiency, only include relevant portions of text
    const maxTextLength = 8000;
    const truncatedText = pdfText.length > maxTextLength
      ? pdfText.substring(0, maxTextLength) + "..."
      : pdfText;

    return `SEARCH TERMS: ${searchTerms.join(", ")}

DOCUMENT TEXT (first ${maxTextLength} chars):
${truncatedText}`;
  }

  /**
   * Attach citations to extracted data for export
   */
  attachCitationsToData(extractedData, citationTracker) {
    const dataWithCitations = JSON.parse(JSON.stringify(extractedData));
    const hyperlinks = citationTracker.generateAllHyperlinks();

    // Attach citation metadata to each field
    for (const [field, hyperlink] of Object.entries(hyperlinks)) {
      const path = field.split(".");
      this.setNestedCitation(dataWithCitations, path, hyperlink);
    }

    return dataWithCitations;
  }

  /**
   * Set citation metadata at nested path
   */
  setNestedCitation(obj, path, citation) {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (!(path[i] in current)) {
        current[path[i]] = {};
      }
      current = current[path[i]];
    }
    current[path[path.length - 1]] = {
      value: current[path[path.length - 1]],
      citation: citation
    };
  }

  /**
   * Get nested value from object
   */
  getNestedValue(obj, path) {
    let current = obj;
    for (const key of path) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return null;
      }
    }
    return current;
  }

  /**
   * Parse JSON response from LLM
   */
  parseJsonResponse(content) {
    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return { found: false, confidence: 0 };
    } catch {
      return { found: false, confidence: 0 };
    }
  }
}

module.exports = CrossValidationAgentSkill;
