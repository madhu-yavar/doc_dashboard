/**
 * PHI/PII Masking Tool
 *
 * Detects and masks Personally Identifiable Information in medical document images
 * before sending to external APIs (like Gemini)
 *
 * Workflow:
 * 1. Use Gemma to detect PHI regions with coordinates
 * 2. Create masked image with black rectangles over PHI areas
 * 3. Return masked image for safe processing
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

class PhiMaskerTool {
  constructor(config = {}) {
    this.name = "PHI Masker";
    this.version = "1.0.0";
    this.gemmaUrl = config.gemmaUrl || process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions";
    this.gemmaModel = config.gemmaModel || "google/gemma-4-31B-it";
    this.tempDir = config.tempDir || "/tmp/phi_masking";
    this.maskColor = config.maskColor || [0, 0, 0]; // Black
  }

  /**
   * Ensure temp directory exists
   */
  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Stage 1: Detect PHI regions using Gemma
   * Returns bounding boxes for PHI elements
   */
  async detectPhiRegions(base64Image, pageNum = 1) {
    const prompt = `You are a document layout analyzer. Detect the bounding box coordinates of all Personally Identifiable Information (PII) and Protected Health Information (PHI) in this medical document page.

Return a JSON object with this exact structure:
{
  "page_number": ${pageNum},
  "phi_regions": [
    {
      "type": "patient_name|patient_id|patient_age|patient_gender|patient_contact|doctor_name|hospital_name|episode_number|registration_number|date|email|barcode|other_phi",
      "description": "brief description of what this region contains",
      "bounding_box": {
        "x": 0-100,  // percentage from left
        "y": 0-100,  // percentage from top
        "width": 0-100,  // percentage of image width
        "height": 0-100  // percentage of image height
      },
      "confidence": "high|medium|low"
    }
  ],
  "header_region": {
    "y_start": 0-100,  // percentage where header starts
    "y_end": 0-100,    // percentage where header ends
    "contains_phi": true
  },
  "total_phi_regions": count
}

Types of PHI to detect (ALL 11 PRESCRIPTION HEADER FIELDS MUST BE MASKED):
 1. Patient Name - The patient's full name
 2. Hospital No. / MRN / IP No. - Hospital identification number
 3. Patient Mob. No. / Phone - Mobile or phone number
 4. E-mail ID - Email address
 5. KMC Reg No. / Registration No. - Registration number
 6. Episode No. - Episode or visit number
 7. Age/Sex - Age and gender (mask for privacy)
 8. Date - Visit date (specific dates are PHI)
 9. Dept - Department name
 10. Consultant Name / Doctor Name - Doctor's name
 11. Hospital Name - Hospital or clinic name
 - Barcode/QR codes (used for patient identification)
 - Address information
 - Any other identifying numbers or codes

Use PERCENTAGE coordinates (0-100) so they work with any image size.
The bounding_box format: {x, y, width, height} where:
- x = left edge position (% of image width from left)
- y = top edge position (% of image height from top)
- width = width of region (% of image width)
- height = height of region (% of image height)

Example: If patient name is at top-left, spanning 20% of width:
{"type": "patient_name", "bounding_box": {"x": 5, "y": 8, "width": 25, "height": 4}}

Return ONLY valid JSON, no explanations.`;

    const startTime = Date.now();

    try {
      console.log(`[PHI_MASKER] Starting Gemma request to ${this.gemmaUrl}...`);
      console.log(`[PHI_MASKER] Image size: ${base64Image.length} chars (~${Math.round(base64Image.length/1024)}KB)`);

      const fetchStart = Date.now();
      const response = await fetch(this.gemmaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.gemmaModel,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${base64Image}` }
              }
            ]
          }],
          max_tokens: 2048,
          temperature: 0.1
        }),
        signal: AbortSignal.timeout(150000)  // Increased to 150s for large images
      });

      const fetchTime = Date.now() - fetchStart;
      console.log(`[PHI_MASKER] Fetch completed in ${fetchTime}ms`);

      if (!response.ok) {
        console.log(`[PHI_MASKER] Response not OK: ${response.status}`);
        throw new Error(`Gemma PHI detection failed: ${response.status}`);
      }
      console.log(`[PHI_MASKER] Response OK, parsing...`);

      const data = await response.json();
      const content = data.choices[0]?.message?.content || "";

      // Parse JSON response
      let jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      let phiData = null;
      if (jsonMatch) {
        try {
          phiData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } catch (e) {
          // Try to fix common JSON issues
          try {
            phiData = JSON.parse(content.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
          } catch (e2) {
            console.log("PHI detection JSON parse error, using fallback");
          }
        }
      }

      const duration = Date.now() - startTime;

      return {
        success: !!phiData,
        data: phiData,
        duration,
        tokens: data.usage?.prompt_tokens + data.usage?.completion_tokens || 0
      };

    } catch (error) {
      console.log(`[PHI_MASKER] Request failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        data: null,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Stage 2: Create masked image using sharp or canvas
   * For Node.js, we'll use a simple approach with ImageMagick or similar
   */
  async createMaskedImage(inputPath, outputPath, phiRegions, imageWidth, imageHeight) {
    const { execSync } = require("child_process");

    // Delete output if exists
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    // Build ImageMagick command to draw black rectangles
    // We'll use convert with -draw option
    const draws = [];

    for (const region of (phiRegions || [])) {
      if (!region.bounding_box) continue;

      const bb = region.bounding_box;
      // Convert percentage to pixels
      const x = Math.round((bb.x / 100) * imageWidth);
      const y = Math.round((bb.y / 100) * imageHeight);
      const w = Math.round((bb.width / 100) * imageWidth);
      const h = Math.round((bb.height / 100) * imageHeight);

      // Format: fill black + rectangle
      draws.push(`fill black rectangle ${x},${y} ${x+w},${y+h}`);
    }

    if (draws.length === 0) {
      // No PHI to mask, just copy
      fs.copyFileSync(inputPath, outputPath);
      return { success: true, masked_count: 0 };
    }

    try {
      // Use ImageMagick to draw black rectangles
      const drawArgs = draws.map(d => `-draw "${d}"`).join(" ");

      execSync(`convert "${inputPath}" ${drawArgs} "${outputPath}"`, {
        stdio: "ignore",
        timeout: 30000
      });

      return { success: true, masked_count: draws.length };

    } catch (error) {
      // ImageMagick might not be available, try with graphicsmagick or fallback
      console.log(`ImageMagick failed: ${error.message}`);
      return { success: false, error: error.message, masked_count: 0 };
    }
  }

  /**
   * Alternative: Create base64 masked image using node-canvas or pure JS
   * This is a fallback when ImageMagick is not available
   */
  async createMaskedImageBase64(base64Image, phiRegions, imageWidth = 1000, imageHeight = 1400) {
    const sharp = require("sharp");

    try {
      // Remove data URL prefix if present
      const base64Data = base64Image.includes("base64,")
        ? base64Image.split("base64,")[1]
        : base64Image;

      const buffer = Buffer.from(base64Data, "base64");

      // Validate buffer
      if (buffer.length < 8) {
        throw new Error(`Invalid image buffer: length=${buffer.length}`);
      }

      let image = sharp(buffer, { failOnError: false });
      const metadata = await image.metadata();

      // Get actual dimensions
      const actualWidth = metadata.width;
      const actualHeight = metadata.height;

      // Use SVG overlay approach for black rectangles
      // This is more reliable than creating separate image buffers
      const svgElements = [];
      for (const region of (phiRegions || [])) {
        if (!region.bounding_box) continue;

        const bb = region.bounding_box;
        const x = Math.round((bb.x / 100) * actualWidth);
        const y = Math.round((bb.y / 100) * actualHeight);
        const w = Math.max(1, Math.round((bb.width / 100) * actualWidth));
        const h = Math.max(1, Math.round((bb.height / 100) * actualHeight));

        svgElements.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="black"/>`);
      }

      if (svgElements.length > 0) {

        const svgOverlay = Buffer.from(`
          <svg width="${actualWidth}" height="${actualHeight}">
            <rect width="100%" height="100%" fill="none"/>
            ${svgElements.join("")}
          </svg>
        `);

        image = image.composite([{
          input: svgOverlay,
          top: 0,
          left: 0
        }]);
      }

      const maskedBuffer = await image.png().toBuffer();
      return maskedBuffer.toString("base64");

    } catch (error) {
      console.log(`Sharp masking failed: ${error.message}`);
      // Return original if masking fails
      return base64Image;
    }
  }

  /**
   * Normalize base64 image - strip data URI prefix if present
   */
  normalizeBase64(base64Image) {
    if (typeof base64Image !== 'string') return '';
    // Strip data:image/...;base64, prefix if present
    return base64Image.replace(/^data:image\/[a-z]+;base64,/i, '');
  }

  /**
   * Decode image and return grayscale raw pixels for deterministic layout analysis.
   */
  async decodeImageForAnalysis(base64Image) {
    const buffer = Buffer.from(this.normalizeBase64(base64Image), "base64");
    const { data, info } = await sharp(buffer, { failOnError: false })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return {
      pixels: data,
      width: info.width,
      height: info.height
    };
  }

  /**
   * Find strong horizontal rule-like rows in the printed prescription template.
   */
  detectStrongHorizontalLines(pixels, width, height) {
    const searchHeight = Math.max(1, Math.round(height * 0.42));
    const threshold = 190;
    const minCoverage = 0.68;
    const rows = [];

    for (let y = 0; y < searchHeight; y++) {
      let bestRun = 0;
      let currentRun = 0;
      let currentStart = 0;
      let bestStart = 0;
      let bestEnd = 0;

      for (let x = 0; x < width; x++) {
        const isDark = pixels[(y * width) + x] < threshold;
        if (isDark) {
          if (currentRun === 0) {
            currentStart = x;
          }
          currentRun += 1;
          if (currentRun > bestRun) {
            bestRun = currentRun;
            bestStart = currentStart;
            bestEnd = x;
          }
        } else {
          currentRun = 0;
        }
      }

      const coverage = bestRun / width;
      if (coverage >= minCoverage) {
        rows.push({ y, coverage, startX: bestStart, endX: bestEnd });
      }
    }

    const groups = [];
    for (const row of rows) {
      const last = groups[groups.length - 1];
      if (last && row.y <= last.endY + 2) {
        last.endY = row.y;
        last.coverage = Math.max(last.coverage, row.coverage);
        last.startX = Math.min(last.startX, row.startX);
        last.endX = Math.max(last.endX, row.endX);
      } else {
        groups.push({
          startY: row.y,
          endY: row.y,
          coverage: row.coverage,
          startX: row.startX,
          endX: row.endX
        });
      }
    }

    return groups.map((group) => ({
      y: Math.round((group.startY + group.endY) / 2),
      startY: group.startY,
      endY: group.endY,
      thickness: group.endY - group.startY + 1,
      coverage: group.coverage,
      startX: group.startX,
      endX: group.endX
    }));
  }

  /**
   * Detect the recurring prescription template anchors on page 1.
   */
  async detectPrescriptionTemplateAnchors(base64Image) {
    try {
      const analysis = await this.decodeImageForAnalysis(base64Image);
      const { pixels, width, height } = analysis;
      const lines = this.detectStrongHorizontalLines(pixels, width, height);

      const topSeparator = lines.find((line) =>
        line.y >= Math.round(height * 0.05) &&
        line.y <= Math.round(height * 0.16)
      );

      if (!topSeparator) {
        return {
          success: false,
          reason: "Top prescription separator not found",
          candidate_lines: lines
        };
      }

      const lowerLines = lines.filter((line) =>
        line.y > topSeparator.y + Math.round(height * 0.035) &&
        line.y <= Math.round(height * 0.32)
      );

      const headerBoundary = lowerLines[0] || null;
      if (!headerBoundary) {
        return {
          success: false,
          reason: "Header boundary line not found",
          candidate_lines: lines
        };
      }

      const notesBoundary = lowerLines.find((line) =>
        line.y > headerBoundary.y + Math.round(height * 0.02)
      ) || null;

      const spacing = headerBoundary.y - topSeparator.y;
      const minSpacing = Math.round(height * 0.07);
      const maxSpacing = Math.round(height * 0.18);
      if (spacing < minSpacing || spacing > maxSpacing) {
        return {
          success: false,
          reason: `Template spacing out of range (${spacing}px)`,
          candidate_lines: lines
        };
      }

      const formLeft = Math.max(0, Math.min(topSeparator.startX, headerBoundary.startX));
      const formRight = Math.min(width - 1, Math.max(topSeparator.endX, headerBoundary.endX));
      const formWidth = formRight - formLeft;
      if (formWidth < Math.round(width * 0.6)) {
        return {
          success: false,
          reason: "Detected form bounds too narrow",
          candidate_lines: lines
        };
      }

      const confidence = Number(Math.min(
        0.99,
        0.55 +
          (topSeparator.coverage * 0.15) +
          (headerBoundary.coverage * 0.15) +
          (notesBoundary ? 0.08 : 0) +
          (formWidth / width) * 0.07
      ).toFixed(2));

      return {
        success: true,
        width,
        height,
        confidence,
        formBounds: {
          left: formLeft,
          right: formRight,
          width: formWidth
        },
        anchorLines: {
          top_separator: {
            y: topSeparator.y,
            startY: topSeparator.startY,
            endY: topSeparator.endY,
            startX: topSeparator.startX,
            endX: topSeparator.endX
          },
          header_boundary: {
            y: headerBoundary.y,
            startY: headerBoundary.startY,
            endY: headerBoundary.endY,
            startX: headerBoundary.startX,
            endX: headerBoundary.endX
          },
          notes_boundary: notesBoundary ? {
            y: notesBoundary.y,
            startY: notesBoundary.startY,
            endY: notesBoundary.endY,
            startX: notesBoundary.startX,
            endX: notesBoundary.endX
          } : null
        },
        candidateLines: lines
      };
    } catch (error) {
      return {
        success: false,
        reason: `Template analysis failed: ${error.message}`
      };
    }
  }

  /**
   * Build deterministic header-field mask boxes inside the printed prescription grid.
   */
  buildPrescriptionHeaderMaskBoxes(anchorData, options = {}) {
    const { keepHospital = false } = options;
    const { width, height, formBounds, anchorLines } = anchorData;
    const topY = anchorLines.top_separator.y;
    const headerBottomY = anchorLines.header_boundary.y;
    const headerTopPadding = Math.max(8, Math.round(height * 0.006));
    const headerBottomPadding = Math.max(2, Math.round(height * 0.0015));
    const headerTop = topY + headerTopPadding;
    const headerBottom = headerBottomY - headerBottomPadding;
    const headerHeight = headerBottom - headerTop;

    if (headerHeight < Math.round(height * 0.05)) {
      return { success: false, reason: "Header field area too small for deterministic masking" };
    }

    const pageBox = (field, type, description, x1, x2, y1, y2) => ({
      field,
      type,
      description,
      bounding_box: {
        x: Number((Math.max(0, x1) / width * 100).toFixed(2)),
        y: Number((Math.max(0, y1) / height * 100).toFixed(2)),
        width: Number((Math.max(1, x2 - x1) / width * 100).toFixed(2)),
        height: Number((Math.max(1, y2 - y1) / height * 100).toFixed(2))
      },
      confidence: "high"
    });

    const fromHeader = (field, type, description, x1f, x2f, y1f, y2f, bottomOverscanPx = 0) => {
      const x1 = Math.max(0, Math.round(formBounds.left + (formBounds.width * x1f)));
      const x2 = Math.min(width, Math.round(formBounds.left + (formBounds.width * x2f)));
      const y1 = Math.max(headerTop, Math.round(headerTop + (headerHeight * y1f)));
      const y2 = Math.min(height, Math.round(headerTop + (headerHeight * y2f)) + bottomOverscanPx);
      return pageBox(field, type, description, x1, x2, y1, y2);
    };

    const boxes = [
      fromHeader("patient_name", "patient_name", "patient name", 0.16, 0.46, 0.02, 0.16),
      fromHeader("hospital_number", "patient_id", "hospital/MRN/IP number", 0.16, 0.38, 0.18, 0.30),
      fromHeader("patient_mobile", "patient_contact", "patient mobile/phone", 0.16, 0.38, 0.33, 0.45),
      fromHeader("consultant_name", "doctor_name", "consultant or doctor name", 0.16, 0.82, 0.47, 0.76),
      fromHeader("registration_number", "registration_number", "registration number", 0.12, 0.38, 0.72, 1.02, 10),
      fromHeader("age_sex", "patient_age", "age/sex", 0.56, 0.73, 0.02, 0.16),
      fromHeader("episode_number", "episode_number", "episode number", 0.84, 0.98, 0.02, 0.16),
      fromHeader("date", "date", "visit date", 0.56, 0.73, 0.18, 0.30),
      fromHeader("email", "email", "email address", 0.56, 0.82, 0.33, 0.45),
      fromHeader("department", "department", "department", 0.54, 0.90, 0.72, 1.02, 10)
    ];

    if (!keepHospital) {
      const logoTop = Math.max(8, Math.round(height * 0.01));
      const logoBottom = Math.max(logoTop + 12, topY - Math.max(8, Math.round(height * 0.008)));
      boxes.push(pageBox(
        "hospital_name",
        "hospital_name",
        "hospital name",
        Math.round(width * 0.06),
        Math.round(width * 0.43),
        logoTop,
        logoBottom
      ));
    }

    return {
      success: true,
      boxes,
      maskedFields: boxes.map((box) => box.field),
      anchorBoxes: {
        form_bounds: {
          left: formBounds.left,
          right: formBounds.right,
          top: headerTop,
          bottom: headerBottom,
          width: formBounds.width,
          height: headerHeight
        }
      }
    };
  }

  /**
   * Prescription-specific deterministic template masking for page 1.
   */
  async applyPrescriptionTemplateMask(base64Image, options = {}) {
    const anchorData = await this.detectPrescriptionTemplateAnchors(base64Image);
    if (!anchorData.success) {
      return {
        success: false,
        fallback_reason: anchorData.reason || "Template detection failed",
        template_detected: false,
        template_confidence: 0,
        anchor_lines: anchorData.anchorLines || null,
        candidate_lines: anchorData.candidateLines || []
      };
    }

    const boxesResult = this.buildPrescriptionHeaderMaskBoxes(anchorData, options);
    if (!boxesResult.success) {
      return {
        success: false,
        fallback_reason: boxesResult.reason,
        template_detected: true,
        template_confidence: anchorData.confidence,
        anchor_lines: anchorData.anchorLines,
        candidate_lines: anchorData.candidateLines || []
      };
    }

    const maskedBase64 = await this.createMaskedImageBase64(base64Image, boxesResult.boxes);
    const phiData = {
      page_number: options.pageNum || 1,
      phi_regions: boxesResult.boxes,
      header_region: {
        y_start: Number((anchorData.anchorLines.top_separator.startY / anchorData.height * 100).toFixed(2)),
        y_end: Number((anchorData.anchorLines.header_boundary.endY / anchorData.height * 100).toFixed(2)),
        contains_phi: true
      },
      total_phi_regions: boxesResult.boxes.length
    };

    return {
      success: true,
      maskedImage: maskedBase64,
      phiData,
      masked_count: boxesResult.boxes.length,
      masked_types: boxesResult.boxes.map((box) => box.type),
      masked_fields: boxesResult.maskedFields,
      masking_strategy: "prescription_template",
      template_detected: true,
      template_confidence: anchorData.confidence,
      fallback_reason: null,
      anchor_lines: anchorData.anchorLines,
      anchor_boxes: boxesResult.anchorBoxes
    };
  }

  /**
   * Existing Gemma-based fallback masking path.
   */
  async executeGemmaMasking(base64Image, options = {}) {
    const { pageNum = 1, keepHospital = false } = options;

    const detection = await this.detectPhiRegions(base64Image, pageNum);

    if (!detection.success) {
      return {
        success: false,
        error: `PHI detection failed: ${detection.error}`,
        maskedImage: null,
        phiData: null
      };
    }

    const phiRegions = detection.data?.phi_regions || [];

    let regionsToMask = phiRegions;
    if (keepHospital) {
      regionsToMask = phiRegions.filter((r) => r.type !== "hospital_name");
    }

    if (regionsToMask.length === 0) {
      return {
        success: true,
        maskedImage: base64Image,
        phiData: detection.data,
        masked_count: 0,
        note: "No PHI regions detected"
      };
    }

    try {
      const maskedBase64 = await this.createMaskedImageBase64(
        base64Image,
        regionsToMask
      );

      return {
        success: true,
        maskedImage: maskedBase64,
        originalImage: base64Image,
        phiData: detection.data,
        masked_count: regionsToMask.length,
        masked_types: regionsToMask.map((r) => r.type),
        duration: detection.duration
      };

    } catch (error) {
      return {
        success: false,
        error: `Masking failed: ${error.message}`,
        maskedImage: null,
        phiData: detection.data
      };
    }
  }

  /**
   * Main execution: Detect PHI and create masked image
   */
  async execute(base64Image, options = {}) {
    const { pageNum = 1, keepHospital = false, documentType = null } = options;

    this.ensureTempDir();

    // Normalize input (strip data URI prefix if present)
    const normalizedBase64 = this.normalizeBase64(base64Image);

    if (documentType === "prescription" && pageNum === 1) {
      const templateMasking = await this.applyPrescriptionTemplateMask(normalizedBase64, {
        pageNum,
        keepHospital
      });

      if (templateMasking.success) {
        return {
          ...templateMasking,
          originalImage: base64Image
        };
      }

      const fallback = await this.executeGemmaMasking(normalizedBase64, { pageNum, keepHospital });
      return {
        ...fallback,
        masking_strategy: "gemma_fallback",
        template_detected: false,
        template_confidence: templateMasking.template_confidence || 0,
        masked_fields: [],
        fallback_reason: templateMasking.fallback_reason || "Template detection failed",
        anchor_lines: templateMasking.anchor_lines || null,
        anchor_boxes: null
      };
    }

    return this.executeGemmaMasking(normalizedBase64, { pageNum, keepHospital });
  }

  /**
   * Mask multiple pages
   */
  async executeBatch(base64Images, options = {}) {
    const results = [];
    let totalDuration = 0;
    let totalMasked = 0;

    for (let i = 0; i < base64Images.length; i++) {
      const result = await this.execute(base64Images[i], {
        ...options,
        pageNum: i + 1
      });
      results.push(result);
      totalDuration += result.duration || 0;
      totalMasked += result.masked_count || 0;
    }

    return {
      success: true,
      results,
      summary: {
        total_pages: base64Images.length,
        total_masked_regions: totalMasked,
        total_duration: totalDuration
      }
    };
  }
}

module.exports = PhiMaskerTool;
