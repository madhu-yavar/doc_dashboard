/**
 * Page Selection Utilities for Prescription Extraction
 * Intelligently selects which pages to use for specific extraction tasks
 */

class PageSelector {
  constructor() {
    this.name = "Page Selector";
    this.version = "1.0.0";

    // Medication signal patterns - common Indian prescription indicators
    this.medicationSignals = {
      // Dosage forms
      dosageForms: [
        'tab', 'cap', 'inj', 'syp', 'dr', 'susp', 'drops', 'ointment',
        'cream', 'gel', 'lotion', 'spray', 'inhaler', 'patch', 'tube',
        'tablet', 'capsule', 'injection', 'syrup', 'suspension'
      ],

      // Frequencies
      frequencies: [
        'od', 'bd', 'tds', 'qid', 'sos', 'prn', 'hs', 'ac', 'pc',
        'qid', 'qod', 'qhs', 'stat', 'once daily', 'twice daily',
        'thrice daily', 'four times', 'before food', 'after food',
        'morning', 'evening', 'night', 'bedtime'
      ],

      // Durations
      durations: [
        'days', 'day', 'weeks', 'week', 'months', 'month',
        '\\d+\\s*(d|w|m)\\b', // e.g., 5d, 2w, 1m
        'for \\d+'
      ],

      // Dose patterns
      dosePatterns: [
        '\\d+\\s*mg', '\\d+\\s*ml', '\\d+\\s*mcg', '\\d+\\s*ug',
        '\\d+\\s*k', // e.g., 60K for Vitamin D
        '\\d+\\s*g\\b', // grams
        '\\d+\\s*%\\b' // percentage
      ],

      // Rx indicators
      rxIndicators: [
        'rx', 'prescription', 'medicines', 'medication', 'drugs',
        'tab\\.', 'cap\\.', 'inj\\.'
      ]
    };
  }

  /**
   * Select pages most likely to contain medication information
   * @param {Array} pages - Array of page objects with pageNum, imageData, optional textContent
   * @param {object} stage1Data - Stage 1 extraction results
   * @param {string} pdfText - Full PDF text content
   * @returns {Array} - Selected pages for medication extraction
   */
  selectMedicationPages(pages, stage1Data, pdfText) {
    if (!pages || pages.length === 0) {
      return [];
    }

    // Single page - return as is
    if (pages.length === 1) {
      console.log(`      🔵 Page Selection: Single page document, using page 1 for medications`);
      return pages;
    }

    console.log(`      🔵 Page Selection: Analyzing ${pages.length} pages for medication content...`);

    // Score each page for medication signals
    const pageScores = pages.map((page, index) => {
      const score = this.scorePageForMedications(page, index, pdfText, stage1Data);
      console.log(`         Page ${page.pageNum}: score ${score.total} (${score.reasoning})`);
      return { page, score: score.total, reasoning: score.reasoning };
    });

    // Sort by score (descending)
    pageScores.sort((a, b) => b.score - a.score);

    // Decision logic
    const topScore = pageScores[0].score;
    const secondScore = pageScores[1]?.score || 0;
    const topPage = pageScores[0].page;

    // If page 2 (index 1) has a strong signal and page 1 is weak, prefer page 2
    const page2 = pageScores.find(p => p.page.pageNum === 2);
    const page1 = pageScores.find(p => p.page.pageNum === 1);

    // Heuristic: For Doxper-like documents, page 2 often has medications
    // Use page 2 only if:
    // 1. Page 2 has medication signals
    // 2. Page 1 has mostly headers/demographics (low medication score)
    // 3. Page 2 score is significantly higher than page 1
    if (page2 && page1 && page2.score > 5 && page1.score < 3) {
      console.log(`      ✅ Selected: Page 2 only (medication signals concentrated there)`);
      return [page2.page];
    }

    // If top score is very high, use only that page
    if (topScore >= 10) {
      console.log(`      ✅ Selected: Page ${topPage.pageNum} only (strong medication signals)`);
      return [topPage];
    }

    // If top two pages have similar scores, use both
    if (secondScore > 0 && Math.abs(topScore - secondScore) < 3) {
      const selected = [pageScores[0].page, pageScores[1].page];
      console.log(`      ✅ Selected: Pages ${selected.map(p => p.pageNum).join(', ')} (similar scores)`);
      return selected;
    }

    // Default: use top page only
    console.log(`      ✅ Selected: Page ${topPage.pageNum} (highest medication score)`);
    return [topPage];
  }

  /**
   * Score a single page for medication signals
   * @param {object} page - Page object with pageNum, imageData, optional textContent
   * @param {number} index - Zero-based index in pages array
   * @param {string} pdfText - Full PDF text
   * @param {object} stage1Data - Stage 1 data
   * @returns {object} - { total: number, reasoning: string }
   */
  scorePageForMedications(page, index, pdfText, stage1Data) {
    let score = 0;
    const reasons = [];

    // Get page text if available
    const pageText = this.extractPageText(page, pdfText, index);
    const normalizedText = pageText.toLowerCase();

    // Check dosage forms (strong signal)
    for (const form of this.medicationSignals.dosageForms) {
      const regex = new RegExp(`\\b${form}\\b`, 'gi');
      const matches = normalizedText.match(regex);
      if (matches) {
        score += matches.length * 2; // Each dosage form is worth 2 points
        reasons.push(`${matches.length} dosage form(s)`);
      }
    }

    // Check frequencies (medium signal)
    for (const freq of this.medicationSignals.frequencies) {
      const regex = new RegExp(`\\b${freq}\\b`, 'gi');
      if (regex.test(normalizedText)) {
        score += 1;
        reasons.push('frequency pattern');
      }
    }

    // Check durations (weak signal)
    for (const dur of this.medicationSignals.durations) {
      const regex = new RegExp(`\\b${dur}\\b`, 'gi');
      if (regex.test(normalizedText)) {
        score += 0.5;
      }
    }

    // Check dose patterns (medium signal)
    for (const dose of this.medicationSignals.dosePatterns) {
      const regex = new RegExp(dose, 'gi');
      const matches = normalizedText.match(regex);
      if (matches) {
        score += matches.length * 0.5;
      }
    }

    // Check Rx indicators (strong signal)
    for (const indicator of this.medicationSignals.rxIndicators) {
      const regex = new RegExp(`\\b${indicator}\\b`, 'gi');
      if (regex.test(normalizedText)) {
        score += 3;
        reasons.push('Rx indicator');
      }
    }

    // Page position heuristics
    if (page.pageNum === 2) {
      // Page 2 bonus for multi-page prescriptions (often contains Rx)
      score += 1;
      reasons.push('page 2 position');
    } else if (page.pageNum === 1 && index === 0) {
      // Page 1 penalty if it's mostly headers (common in structured forms)
      if (this.hasHeaderPatterns(normalizedText)) {
        score -= 1;
        reasons.push('header-heavy page 1');
      }
    }

    // Document structure guidance
    if (stage1Data?.document_structure) {
      const ds = stage1Data.document_structure;
      if (page.pageNum === 1 && ds.has_prescription_table === false) {
        // Page 1 doesn't have Rx table, demote
        score -= 2;
        reasons.push('no Rx table on page 1');
      } else if (page.pageNum === 2 && ds.prescription_table_location?.includes('middle')) {
        // Page 2 likely has the prescription table
        score += 2;
        reasons.push('Rx table likely on page 2');
      }
    }

    return {
      total: Math.max(0, Math.round(score * 10) / 10),
      reasoning: reasons.join(', ') || 'minimal signals'
    };
  }

  /**
   * Extract text for a specific page
   * Handles multi-page PDF text extraction
   */
  extractPageText(page, fullPdfText, pageIndex) {
    // Try page's own textContent first
    if (page.textContent && typeof page.textContent === 'string') {
      return page.textContent;
    }

    // Try to extract from full PDF text
    if (!fullPdfText) return '';

    // Simple heuristic: split by page markers if present
    // Many PDFs have form feed characters or page markers
    const pageMarkers = fullPdfText.split(/\f|\[Page \d+\]/);
    if (pageMarkers.length > pageIndex) {
      return pageMarkers[pageIndex] || '';
    }

    // Fallback: return a portion of the text
    // This is imperfect but better than nothing
    const approxPageLength = Math.floor(fullPdfText.length / Math.max(1, fullPdfText.match(/\f/g)?.length || 1));
    const start = pageIndex * approxPageLength;
    const end = start + approxPageLength;
    return fullPdfText.substring(start, end);
  }

  /**
   * Check if text has header/demographic patterns
   * Used to identify pages that are mostly patient info
   */
  hasHeaderPatterns(text) {
    const headerPatterns = [
      /\bpatient name\b/i,
      /\bdate of birth\b/i,
      /\bag[eè]\s*\:?\s*\d+/i,
      /\bgender\b/i,
      /\bmale|female|other\b/i,
      /\buhid\b/i,
      /\bphone\b/i,
      /\baddress\b/i,
      /\bhospital\b/i,
      /\bclinic\b/i
    ];

    let matchCount = 0;
    for (const pattern of headerPatterns) {
      if (pattern.test(text)) matchCount++;
    }

    // If 3+ header patterns found, likely a header page
    return matchCount >= 3;
  }

  /**
   * Select pages for diagnosis extraction
   * Typically follows similar logic to medications but less strict
   */
  selectDiagnosisPages(pages, stage1Data, pdfText) {
    // Diagnosis often on page 1 or same as medications
    // For now, use same logic as medications
    return this.selectMedicationPages(pages, stage1Data, pdfText);
  }

  /**
   * Select pages for orders (lab/radiology) extraction
   * Often at the bottom of pages or on specific pages
   */
  selectOrdersPages(pages, stage1Data, pdfText) {
    if (!pages || pages.length === 0) return [];
    if (pages.length === 1) return pages;

    // Orders often on last page
    const lastPage = pages[pages.length - 1];
    console.log(`      🔵 Page Selection: Using page ${lastPage.pageNum} for orders (last page)`);
    return [lastPage];
  }

  /**
   * Select pages for visual element detection (lab ticks, etc.)
   * Usually pages with checkboxes/form elements
   */
  selectVisualPages(pages, stage1Data, pdfText) {
    if (!pages || pages.length === 0) return [];
    if (pages.length === 1) return pages;

    // If Stage 1 identified lab investigations region, prioritize that page
    if (stage1Data?.document_structure?.lab_selections_region) {
      // For now, return all pages - visual detection needs to see checkboxes
      // This could be refined with better page classification
      console.log(`      🔵 Page Selection: Using all pages for visual detection`);
      return pages;
    }

    return pages;
  }
}

module.exports = PageSelector;
