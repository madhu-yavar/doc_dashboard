/**
 * PDF to Image Converter Tool
 * Converts PDF pages to base64 images with configurable DPI
 * Supports page-specific DPI for different use cases (e.g., higher DPI for medication lists)
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class PdfToImageConverterTool {
  constructor(config = {}) {
    this.name = "PDF to Image Converter";
    this.version = "1.0.0";
    this.config = config;

    // Default DPI settings for different purposes
    this.dpiSettings = {
      default: config.defaultDpi || 150,
      masking: config.maskingDpi || 150,
      handwriting: config.handwritingDpi || 150,
      medications: config.medicationsDpi || 200,  // Higher DPI for medication lists
      vitals: config.vitalsDpi || 150,
      diagnosis: config.diagnosisDpi || 150
    };

    this.tempDir = config.tempDir || '/tmp/prescription_conversion_temp';
  }

  /**
   * Ensure temp directory exists
   */
  async ensureTempDir() {
    await fs.promises.mkdir(this.tempDir, { recursive: true });
  }

  /**
   * Get total page count of PDF
   */
  async getPageCount(pdfPath) {
    try {
      const cmd = `pdfinfo "${pdfPath}" | grep Pages | awk '{print $2}'`;
      const pageCount = parseInt(execSync(cmd, { encoding: 'utf-8' }).trim()) || 1;
      return pageCount;
    } catch (error) {
      console.warn(`[PdfToImage] Could not get page count: ${error.message}`);
      return 1;
    }
  }

  /**
   * Convert a single PDF page to base64 image
   * @param {string} pdfPath - Path to PDF file
   * @param {number} pageNum - Page number (1-indexed)
   * @param {object} options - Conversion options
   * @param {number} options.dpi - Resolution in DPI (default: 150)
   * @param {string} options.purpose - Purpose hint (medications, masking, etc.) for auto-DPI
   * @param {boolean} options.keepTempFile - Keep temp file for debugging
   * @returns {Promise<{success: boolean, base64?: string, filePath?: string, error?: string}>}
   */
  async convertPage(pdfPath, pageNum = 1, options = {}) {
    await this.ensureTempDir();

    const dpi = options.dpi || this.getDpiForPurpose(options.purpose);
    const fileId = crypto.randomBytes(8).toString('hex');
    const baseOutputPath = path.join(this.tempDir, `${fileId}_page${pageNum}`);
    const outputPath = `${baseOutputPath}.png`;

    console.log(`[PdfToImage] Converting page ${pageNum} at ${dpi} DPI...`);

    try {
      const baseCmd = outputPath.replace('.png', '');
      const cmd = `pdftoppm -png -singlefile -r ${dpi} -f ${pageNum} -l ${pageNum} "${pdfPath}" "${baseCmd}"`;

      execSync(cmd, {
        stdio: 'pipe',
        timeout: 30000
      });

      // Check for actual output file (pdftoppm might add -1 suffix)
      const possiblePaths = [outputPath, outputPath.replace('.png', '-1.png')];
      let actualPath = null;

      for (const p of possiblePaths) {
        try {
          await fs.promises.access(p);
          actualPath = p;
          break;
        } catch { continue; }
      }

      if (!actualPath) {
        throw new Error('PDF conversion failed - no output created');
      }

      const buffer = await fs.promises.readFile(actualPath);
      const base64 = buffer.toString('base64');

      // Clean up temp file unless requested to keep
      if (!options.keepTempFile) {
        await fs.promises.unlink(actualPath).catch(() => {});
      }

      console.log(`[PdfToImage] ✓ Page ${pageNum} converted (${base64.length} chars)`);

      return {
        success: true,
        base64: base64,
        filePath: options.keepTempFile ? actualPath : undefined,
        dpi: dpi,
        pageNum: pageNum
      };
    } catch (error) {
      console.error(`[PdfToImage] ✗ Page ${pageNum} failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        pageNum: pageNum
      };
    }
  }

  /**
   * Convert multiple pages to base64 images
   * @param {string} pdfPath - Path to PDF file
   * @param {object} options - Conversion options
   * @param {number[]} options.pages - Page numbers to convert (1-indexed). If empty, convert all pages.
   * @param {number|object} options.dpi - DPI (number) or page-specific DPI (object: { pageNum: dpi })
   * @param {string} options.purpose - Default purpose for auto-DPI
   * @returns {Promise<Array<{pageNum: number, base64: string, dpi: number}>>}
   */
  async convertPages(pdfPath, options = {}) {
    await this.ensureTempDir();

    const pageCount = await this.getPageCount(pdfPath);
    const pagesToConvert = Array.isArray(options.pages)
      ? options.pages.filter(p => p >= 1 && p <= pageCount)
      : Array.from({ length: pageCount }, (_, i) => i + 1);

    console.log(`[PdfToImage] Converting ${pagesToConvert.length} pages...`);

    const fileId = crypto.randomBytes(8).toString('hex');
    const baseOutputPath = path.join(this.tempDir, fileId);

    try {
      const results = [];

      // Convert each page with appropriate DPI
      for (const pageNum of pagesToConvert) {
        const pageDpi = typeof options.dpi === 'object'
          ? (options.dpi[pageNum] || this.getDpiForPurpose(options.purpose))
          : (options.dpi || this.getDpiForPurpose(options.purpose));

        const result = await this.convertPage(pdfPath, pageNum, { dpi: pageDpi, purpose: options.purpose });

        if (result.success) {
          results.push({
            pageNum: pageNum,
            imageData: `data:image/png;base64,${result.base64}`,
            base64: result.base64,
            dpi: pageDpi
          });
        }
      }

      return results;
    } catch (error) {
      console.error(`[PdfToImage] Batch conversion failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Convert all pages with mixed DPI strategy
   * Higher DPI for medication pages, standard for others
   */
  async convertAllPagesMixedDpi(pdfPath, options = {}) {
    const pageCount = await this.getPageCount(pdfPath);
    const medicationPage = options.medicationPage || 1;  // Usually page 1 for prescriptions

    const results = [];
    for (let i = 1; i <= pageCount; i++) {
      const purpose = (i === medicationPage) ? 'medications' : (options.defaultPurpose || 'handwriting');
      const pageResult = await this.convertPage(pdfPath, i, { purpose });

      if (pageResult.success) {
        results.push({
          pageNum: i,
          imageData: `data:image/png;base64,${pageResult.base64}`,
          base64: pageResult.base64,
          dpi: pageResult.dpi
        });
      }
    }

    return results;
  }

  /**
   * Get appropriate DPI for a given purpose
   */
  getDpiForPurpose(purpose) {
    return this.dpiSettings[purpose] || this.dpiSettings.default;
  }

  /**
   * Detect medication page region and crop
   * Uses Vision API to identify where medications are listed
   */
  async detectMedicationRegion(imageBase64, apiKey) {
    // This is a placeholder for future implementation
    // Would use Gemini Vision to identify medication list region
    // Returns: { x, y, width, height } or null

    // For now, return null (use full page)
    return null;
  }

  /**
   * Crop image to specific region
   * @param {string} imageBase64 - Base64 image data (with or without data URI prefix)
   * @param {object} region - { x, y, width, height } in pixels
   * @returns {Promise<string>} Cropped image as base64 data URI
   */
  async cropImage(imageBase64, region) {
    const sharp = require('sharp');

    // Extract base64 data if prefixed
    const base64Data = imageBase64.includes('base64,')
      ? imageBase64.split('base64,')[1]
      : imageBase64;

    const buffer = Buffer.from(base64Data, 'base64');

    try {
      const cropped = await sharp(buffer)
        .extract({
          left: region.x || 0,
          top: region.y || 0,
          width: region.width,
          height: region.height
        })
        .png()
        .toBuffer();

      return `data:image/png;base64,${cropped.toString('base64')}`;
    } catch (error) {
      console.error(`[PdfToImage] Crop failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = PdfToImageConverterTool;
