/**
 * Tool Registry
 * Central registry of all tools available to agents
 * Wraps existing tools and skills with standardized interface
 */

const PDFReaderTool = require("../../tools/pdf/pdf_reader.tool.cjs");
// HandwritingDetectorSkill removed - using two-stage agent for handwriting processing
// const HandwritingDetectorSkill = require("../../skills/detection/handwriting_detector.skill.cjs");
const GemmaVisionClient = require("../../tools/llm/gemma_vision_client.tool.cjs");

// ============================================================================
// CLASSIFICATION TOOLS
// ============================================================================

/**
 * Convert PDF first page to image
 */
async function convertFirstPageToImage(pdfPath) {
  const fs = require("fs/promises");
  const path = require("path");
  const { execSync } = require("child_process");
  const crypto = require("crypto");

  const tempDir = "/tmp/agent_classify_temp";
  await fs.mkdir(tempDir, { recursive: true });

  const fileId = crypto.randomBytes(8).toString("hex");
  const outputPath = path.join(tempDir, `${fileId}_page1.png`);

  try {
    // Convert only first page using pdftoppm
    execSync(
      `pdftoppm -png -singlefile -r 200 -f 1 "${pdfPath}" "${outputPath.replace('.png', '')}"`,
      { stdio: "ignore", timeout: 30000 }
    );

    // pdftoppm adds -1 suffix for single file, handle both cases
    const possiblePaths = [
      outputPath,
      outputPath.replace('.png', '-1.png')
    ];

    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        return p;
      } catch { continue; }
    }

    throw new Error("PDF conversion failed - no output created");
  } catch (error) {
    throw new Error(`Failed to convert PDF page 1: ${error.message}`);
  }
}

/**
 * Extract text from PDF first page
 */
async function extractPDFText(pdfPath, maxLength = 5000) {
  const pdfReader = new PDFReaderTool();
  const result = await pdfReader.execute(pdfPath, maxLength);
  return result;
}

// ============================================================================
// TOOL REGISTRY
// ============================================================================

const TOOL_REGISTRY = {
  // -------------------------------------------------------------------------
  // Document Processing Tools
  // -------------------------------------------------------------------------

  convert_first_page: {
    fn: async ({ pdfPath }) => {
      const imagePath = await convertFirstPageToImage(pdfPath);
      return {
        success: true,
        imagePath,
        message: "Converted first page to image"
      };
    },
    description: "Convert the first page of PDF to PNG image for visual analysis",
    parameters: {
      pdfPath: "string - Path to PDF file"
    },
    category: "document"
  },

  extract_text: {
    fn: async ({ pdfPath, maxLength = 5000 }) => {
      const result = await extractPDFText(pdfPath, maxLength);
      return {
        success: result.success,
        text: result.text || "",
        textLength: result.text?.length || 0,
        message: result.success
          ? `Extracted ${result.text?.length || 0} characters`
          : "Text extraction failed"
      };
    },
    description: "Extract OCR text content from PDF (first page preferred for speed)",
    parameters: {
      pdfPath: "string - Path to PDF file",
      maxLength: "number - Maximum characters to extract (default: 5000)"
    },
    category: "document"
  },

  get_page_count: {
    fn: async ({ pdfPath }) => {
      const fs = require("fs");
      try {
        // Simple page count using pdfinfo or similar
        const { execSync } = require("child_process");
        const output = execSync(`pdfinfo "${pdfPath}" 2>/dev/null || echo "Pages: Unknown"`, {
          encoding: "utf8",
          timeout: 5000
        });

        const match = output.match(/Pages:\s*(\d+)/i);
        const pages = match ? parseInt(match[1]) : 1;

        return {
          success: true,
          pages,
          message: `Document has ${pages} pages`
        };
      } catch {
        // Default to 1 if unable to determine
        return {
          success: true,
          pages: 1,
          message: "Unable to determine page count, assuming 1"
        };
      }
    },
    description: "Get the total number of pages in the PDF",
    parameters: {
      pdfPath: "string - Path to PDF file"
    },
    category: "document"
  },

  // -------------------------------------------------------------------------
  // Analysis Tools
  // -------------------------------------------------------------------------

  // detect_handwriting removed - using two-stage agent for handwriting processing
  // detect_handwriting: { ... },

  // -------------------------------------------------------------------------
  // LLM-Based Analysis Tools
  // -------------------------------------------------------------------------

  classify_with_llm: {
    fn: async ({ imagePath, ocrText = "" }) => {
      const client = new GemmaVisionClient();

      const prompt = `You are a medical document classification expert.

Classify this document into ONE of these types:
1. prescription - Handwritten or printed prescription with medications
2. discharge_summary - Hospital discharge document with discharge planning
3. outpatient_record - OPD/clinic visit record
4. lab_report - Laboratory test results with reference ranges
5. chart_note - Progress note, SOAP note, or consultation note

ANALYSIS INSTRUCTIONS:
- Look at the visual structure FIRST
- Then read any available text
- Consider handwritten vs typed content
- Check for specific sections (medications, vitals, discharge planning, etc.)

Return JSON only:
{
  "type": "one_of_the_above",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "indicators": ["key1", "key2"]
}`;

      const result = await client.executeJSON(prompt, {
        images: [imagePath],
        temperature: 0.1,
        maxTokens: 500
      });

      if (result.success) {
        return {
          success: true,
          type: result.data.type || "unknown",
          confidence: result.data.confidence || 0,
          reasoning: result.data.reasoning || "",
          indicators: result.data.indicators || [],
          message: `Classified as ${result.data.type} with ${(result.data.confidence * 100).toFixed(0)}% confidence`
        };
      }

      return {
        success: false,
        error: result.error,
        message: "LLM classification failed"
      };
    },
    description: "Use vision LLM to classify document type from image and optional text",
    parameters: {
      imagePath: "string - Path to converted PNG image",
      ocrText: "string - Optional OCR text to aid classification"
    },
    category: "llm"
  },

  analyze_structure: {
    fn: async ({ imagePath, ocrText = "" }) => {
      const client = new GemmaVisionClient();

      const prompt = `Analyze this medical document's structure and content.

Identify and list:
1. Header sections (hospital name, department, patient info)
2. Tables or structured data present
3. Handwritten regions
4. Key medical content sections (diagnosis, medications, vitals, etc.)
5. Document type indicators

Return JSON:
{
  "has_patient_info": boolean,
  "has_medications": boolean,
  "has_vitals": boolean,
  "has_diagnosis": boolean,
  "has_tables": boolean,
  "handwriting_ratio": "none/low/medium/high",
  "key_sections": ["section1", "section2"],
  "suggested_types": ["type1", "type2"]
}`;

      const result = await client.executeJSON(prompt, {
        images: [imagePath],
        temperature: 0.1,
        maxTokens: 800
      });

      if (result.success) {
        return {
          success: true,
          structure: result.data,
          message: "Document structure analyzed"
        };
      }

      return {
        success: false,
        error: result.error
      };
    },
    description: "Analyze document structure to understand layout and content types",
    parameters: {
      imagePath: "string - Path to image",
      ocrText: "string - Optional OCR text"
    },
    category: "analysis"
  },

  // -------------------------------------------------------------------------
  // Filename Analysis
  // -------------------------------------------------------------------------

  analyze_filename: {
    fn: async ({ filename }) => {
      const name = (filename || "").toLowerCase();

      const indicators = {
        prescription: /\b(prescription|rx|medication|doxper)\b/i.test(name),
        discharge: /\b(discharge|inpatient|admission)\b/i.test(name),
        lab: /\b(lab|investigation|report)\b/i.test(name),
        chart: /\b(chart|note|progress|soap)\b/i.test(name),
        opd: /\b(opd|outpatient|clinic)\b/i.test(name)
      };

      const suggestions = Object.entries(indicators)
        .filter(([_, matches]) => matches)
        .map(([type]) => type);

      return {
        success: true,
        filename,
        indicators,
        suggestions,
        message: suggestions.length > 0
          ? `Filename suggests: ${suggestions.join(", ")}`
          : "Filename gives no clear indication"
      };
    },
    description: "Analyze filename for document type hints",
    parameters: {
      filename: "string - Document filename"
    },
    category: "analysis"
  }
};

/**
 * Get tool by name
 */
function getTool(name) {
  return TOOL_REGISTRY[name];
}

/**
 * Get all tools in a category
 */
function getToolsByCategory(category) {
  return Object.entries(TOOL_REGISTRY)
    .filter(([_, tool]) => tool.category === category)
    .reduce((acc, [name, tool]) => ({ ...acc, [name]: tool }), {});
}

/**
 * Get all tool names
 */
function getToolNames() {
  return Object.keys(TOOL_REGISTRY);
}

module.exports = {
  TOOL_REGISTRY,
  getTool,
  getToolsByCategory,
  getToolNames,
  convertFirstPageToImage,
  extractPDFText
};
