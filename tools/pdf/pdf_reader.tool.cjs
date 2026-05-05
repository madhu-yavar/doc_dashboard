/**
 * PDF Reader Tool
 * Extracts text content from PDF files
 */

const { PDFParse } = require("pdf-parse");
const fs = require("fs/promises");

class PDFReaderTool {
  constructor(config = {}) {
    this.name = "PDF Reader";
    this.version = "1.0.0";
    // Reduce default to leave room for prompt + response within 16384 token limit
    // 12000 chars ≈ 3000-4000 tokens, which leaves ~12000 tokens for response
    this.defaultMaxLength = config.maxLength || 10000;
  }

  /**
   * Extract text from a PDF file
   * @param {string} filePath - Absolute path to PDF file
   * @param {number} maxLength - Maximum characters to extract
   * @returns {Promise<{text: string, pages: number, metadata: object}>}
   */
  async execute(filePath, maxLength = this.defaultMaxLength) {
    try {
      const buffer = await fs.readFile(filePath);
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();

      const text = result.text || "";
      const truncatedText = text.slice(0, maxLength);

      return {
        success: true,
        text: truncatedText,
        originalLength: text.length,
        truncated: text.length > maxLength,
        pages: result.numpages,
        metadata: {
          info: result.info,
          version: result.pdfVersion
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        text: ""
      };
    }
  }

  /**
   * Extract full text without truncation
   */
  async executeFull(filePath) {
    return this.execute(filePath, Infinity);
  }

  /**
   * Get text from a specific page range
   */
  async executePageRange(filePath, startPage = 0, endPage = 10) {
    try {
      const buffer = await fs.readFile(filePath);
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();

      // Simple page approximation (lines per page varies)
      const text = result.text || "";
      const lines = text.split("\n");
      const avgLinesPerPage = Math.floor(lines.length / (result.numpages || 1));

      const startLine = startPage * avgLinesPerPage;
      const endLine = endPage * avgLinesPerPage;
      const pageLines = lines.slice(startLine, endLine);

      return {
        success: true,
        text: pageLines.join("\n"),
        pages: result.numpages,
        pageRange: { start: startPage, end: endPage }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        text: ""
      };
    }
  }
}

module.exports = PDFReaderTool;
