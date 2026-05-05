/**
 * Medication Brand Name Verifier Tool
 * Verifies and corrects commonly misrecognized Indian pharmaceutical brand names
 * Uses fuzzy matching and known brand databases
 */

class MedicationBrandVerifierTool {
  constructor(config = {}) {
    this.name = "Medication Brand Verifier";
    this.version = "1.0.0";
    this.config = config;

    // Common Indian pharmaceutical brands with their common misreadings
    this.brandDatabase = this.buildBrandDatabase();

    // Generic name mappings
    this.genericMappings = this.buildGenericMappings();
  }

  /**
   * Build database of known brands and their common misreadings
   */
  buildBrandDatabase() {
    return {
      // Pain/Analgesics
      "DOLO": { variations: ["BOLO", "DOLO", "DOLOW", "DALO", "DOLOL"], generic: "Paracetamol", category: "Analgesic" },
      "DOLO-650": { variations: ["DOLO650", "DOLO-650", "DOLO 650"], generic: "Paracetamol 650mg", category: "Analgesic" },
      "DOLO-650": { variations: ["DOLO-650", "DOLO650", "DOLO 650"], generic: "Paracetamol 650mg", category: "Analgesic" },
      "VOVERAN": { variations: ["VOVERAN", "VOVERON", "DOVERAN"], generic: "Diclofenac", category: "NSAID" },
      "MYOSPAR": { variations: ["MYOSPAR", "MYOSPAR", "MYOSPER"], generic: "Chlorzoxazone + Paracetamol", category: "Muscle Relaxant" },
      "COMBIFLAM": { variations: ["COMBIFLAM", "COMBIFLAM", "COMBIFLAN"], generic: "Ibuprofen + Paracetamol", category: "Analgesic" },

      // Respiratory / Allergy
      "MONTEK-LC": { variations: ["MONTEK-LC", "MONTEK LC", "MONTEK-L", "MONTEK LC", "MONTIK-LC", "MOUNTEK-LC"], generic: "Montelukast + Levocetirizine", category: "Antihistamine" },
      "MONTEK": { variations: ["MONTEK", "MONTIK", "MOUNTEK"], generic: "Montelukast", category: "Leukotriene Antagonist" },
      "ALEM-FX": { variations: ["ALEM-FX", "ALEM FX", "ALEM-F", "ALEMF"], generic: "Acebrophylline + Fexofenadine", category: "Bronchodilator" },
      "ABPHYLLINE": { variations: ["ABPHYLLINE", "ABPHILINE", "AB FHYLLINE"], generic: "Acebrophylline", category: "Mucolytic" },
      "BRO-ZEDEX": { variations: ["BRO-ZEDEX", "BRO ZEDEX", "BROZEDEX", "BRO-Z", "BROZ"], generic: "Bromhexine + Dexatomethorphan", category: "Cough Syrup" },
      "ASCORIL": { variations: ["ASCORIL", "ASCORIL", "ASCORILL"], generic: "Bromhexine + Guaifenesin + Terbutaline", category: "Cough Syrup" },

      // Vitamins / Supplements
      "ZINCOVIT": { variations: ["ZINCOVIT", "ZINCOUT", "ZINCOVIT", "ZINCUVIT", "ZINKOVIT"], generic: "Multivitamin + Minerals", category: "Vitamin" },
      "ZINCOVITA": { variations: ["ZINCOVITA", "ZINCOVITA", "ZINCOVITA"], generic: "Multivitamin + Minerals", category: "Vitamin" },
      "BECOSULES": { variations: ["BECOSULES", "BECOSULE", "BECOSUL", "BECOS"], generic: "B-Complex + Vitamin C", category: "Vitamin" },
      "SHELCAL": { variations: ["SHELCAL", "SHELCAL", "SHELCAL", "SHEL-CAL"], generic: "Calcium + Vitamin D3", category: "Calcium" },
      "CALPOL": { variations: ["CALPOL", "CALPOL", "CALPOL", "KALPOL"], generic: "Paracetamol", category: "Analgesic" },

      // Vitamin D
      "D-Rise": { variations: ["D-RISE", "D-RISE", "DRISE", "D-RISE", "D-RHE", "DRHE", "D RISE"], generic: "Cholecalciferol 60K", category: "Vitamin D" },
      "UD-DECA": { variations: ["UD-DECA", "UDDECA", "UD DECA"], generic: "Vitamin D3", category: "Vitamin D" },
      "BONMAX": { variations: ["BONMAX", "BON MAX", "BONMAX"], generic: "Alendronate", category: "Bisphosphonate" },

      // Antibiotics
      "AZEE": { variations: ["AZEE", "AZEE", "AZY", "AZI"], generic: "Azithromycin", category: "Antibiotic" },
      "AUGMENTIN": { variations: ["AUGMENTIN", "AUGMENTIN", "AUGMENTINE"], generic: "Amoxicillin + Clavulanic Acid", category: "Antibiotic" },
      "Moxikind": { variations: ["MOXIKIND", "MOXIKIND", "MOXYKIND"], generic: "Amoxicillin", category: "Antibiotic" },
      "CEFADUR": { variations: ["CEFADUR", "CEFADUR", "CEFADIR"], generic: "Cefadroxil", category: "Antibiotic" },
      "CIPLOX": { variations: ["CIPLOX", "CIPLOX", "CIPLEX"], generic: "Ciprofloxacin", category: "Antibiotic" },

      // Antidiabetic
      "GLIMIPERIDE": { variations: ["GLIMIPERIDE", "GLIMPERIDE", "GLIMEPIRIDE"], generic: "Glimepiride", category: "Antidiabetic" },
      "GLYCIPHAGE": { variations: ["GLYCIPHAGE", "GLYCIPHAGE", "GLYCIFAGE"], generic: "Metformin", category: "Antidiabetic" },
      "JANUMET": { variations: ["JANUMET", "JANUMET", "JANUMET"], generic: "Sitagliptin + Metformin", category: "Antidiabetic" },
      "GALVUS": { variations: ["GALVUS", "GALVUS", "GALVUS"], generic: "Vildagliptin", category: "Antidiabetic" },

      // Cardiovascular
      "AMLOPRES": { variations: ["AMLOPRES", "AMLOPRES", "AMLOPRESS", "AMLOPRESS"], generic: "Amlodipine", category: "Calcium Channel Blocker" },
      "TELMA": { variations: ["TELMA", "TELMA", "TELMA", "TELMMA"], generic: "Telmisartan", category: "ARB" },
      "METXL": { variations: ["METXL", "METXL", "MET X L", "METX"], generic: "Metoprolol XL", category: "Beta Blocker" },
      "COSAVIL": { variations: ["COSAVIL", "COSAVIL", "COSAVIL"], generic: "Telmisartan + Amlodipine", category: "Antihypertensive" },
      "EPLA": { variations: ["EPLA", "EPLA", "EPLA", "EPLAR"], generic: "Eplerenone", category: "Potassium Sparing Diuretic" },

      // Gastrointestinal
      "PANTOCID": { variations: ["PANTOCID", "PANTOCID", "PANTOCID", "PANTOSID"], generic: "Pantoprazole", category: "PPI" },
      "PAN-D": { variations: ["PAN-D", "PAN D", "PAND", "PANTO D"], generic: "Pantoprazole + Domperidone", category: "PPI" },
      "OMEZ": { variations: ["OMEZ", "OMEZ", "OMEZ", "OMEEZ"], generic: "Omeprazole", category: "PPI" },
      "RAKIP": { variations: ["RAKIP", "RAKIP", "RAKKIP"], generic: "Rabeprazole", category: "PPI" },
      "GELUSIL": { variations: ["GELUSIL", "GELUSIL", "GELUSIL"], generic: "Antacid", category: "Antacid" },
      "DROTIN": { variations: ["DROTIN", "DROTIN", "DROTINE"], generic: "Drotaverine", category: "Antispasmodic" },

      // Neuro/Psych
      "PREGABALIN": { variations: ["PREGABALIN", "PREGABALIN", "PREGABLIN", "PREGABALIN"], generic: "Pregabalin", category: "Antiepileptic" },
      "GABANEURON": { variations: ["GABANEURON", "GABANEURON", "GABANERON"], generic: "Gabapentin", category: "Antiepileptic" },
      "LEVETIRACETAM": { variations: ["LEVETIRACETAM", "LEVETIRACETAM", "LEVERA", "LEVERA"], generic: "Levetiracetam", category: "Antiepileptic" },
      "CLONOTRIL": { variations: ["CLONOTRIL", "CLONOTRIL", "CLONOTREL"], generic: "Clonazepam", category: "Benzodiazepine" },
      "ALPRAX": { variations: ["ALPRAX", "ALPRAX", "ALPRAX", "ALPRAX"], generic: "Alprazolam", category: "Benzodiazepine" },
      "SERTRALINE": { variations: ["SERTRALINE", "SERTRALINE", "SERTRALIN", "SERTRALINE"], generic: "Sertraline", category: "Antidepressant" },

      // Common prefixes/suffixes to strip
      prefixes: ["TAB", "T.", "CAP", "INJ", "SYP", "DR.", "DR"],
      suffixes: ["TAB", "CAP", "INJ", "SYP", "MG", "MG/ML"]
    };
  }

  /**
   * Build generic name mappings for verification
   */
  buildGenericMappings() {
    return {
      // Common generics with alternate names
      "paracetamol": ["acetaminophen", "pcm", "dolo", "calpol", "crocin"],
      "amlodipine": ["amlong", "amlopres", "amcard"],
      "metformin": ["glyciphage", "glycomet", "rimecon"],
      "telmisartan": ["telma", "telista", "telsar"],
      "atorvastatin": ["atorva", "atorvastin", "lipidor"],
      "pantoprazole": ["pantocid", "panto", "pan"],
      "montelukast": ["montek", "montril", "montemac"],
      "levocetirizine": ["levocet", "lc", "xyzal"],
    };
  }

  /**
   * Normalize medication name for comparison
   */
  normalizeName(name) {
    if (!name || typeof name !== 'string') return '';

    let normalized = name.toUpperCase()
      .replace(/[^A-Z0-9]/g, '')  // Remove special chars
      .trim();

    // Remove common prefixes
    for (const prefix of this.brandDatabase.prefixes) {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.substring(prefix.length);
      }
    }

    // Remove common suffixes
    for (const suffix of this.brandDatabase.suffixes) {
      if (normalized.endsWith(suffix)) {
        normalized = normalized.substring(0, normalized.length - suffix.length);
      }
    }

    return normalized;
  }

  /**
   * Calculate Levenshtein distance for fuzzy matching
   */
  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Check similarity between two strings (0-1 scale)
   */
  similarity(str1, str2) {
    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return 1;
    const distance = this.levenshteinDistance(str1, str2);
    return 1 - (distance / maxLen);
  }

  /**
   * Find best matching brand from database
   */
  findMatch(inputName, threshold = 0.7) {
    if (!inputName) return null;

    const normalized = this.normalizeName(inputName);
    if (!normalized) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (const [brand, data] of Object.entries(this.brandDatabase)) {
      if (brand === 'prefixes' || brand === 'suffixes') continue;

      const normalizedBrand = this.normalizeName(brand);

      // Check exact match
      if (normalized === normalizedBrand) {
        return { brand, ...data, matchType: 'exact' };
      }

      // Check against known variations
      if (data.variations) {
        for (const variation of data.variations) {
          const normalizedVar = this.normalizeName(variation);
          if (normalized === normalizedVar) {
            return { brand, ...data, matchType: 'variation' };
          }
        }
      }

      // Fuzzy match against brand name
      const score = this.similarity(normalized, normalizedBrand);
      if (score > threshold && score > bestScore) {
        bestScore = score;
        bestMatch = { brand, ...data, matchType: 'fuzzy', score };
      }
    }

    return bestMatch;
  }

  /**
   * Verify and correct a medication entry
   */
  verifyMedication(medication) {
    const name = medication.name || medication.generic_name || "";

    if (!name) {
      return {
        original: medication,
        corrected: medication,
        changes: [],
        confidence: 'unchanged'
      };
    }

    const match = this.findMatch(name, 0.65);  // Slightly lower threshold for handwriting

    if (!match) {
      return {
        original: medication,
        corrected: medication,
        changes: [],
        confidence: 'no_match'
      };
    }

    const changes = [];
    const corrected = { ...medication };

    if (match.matchType === 'exact') {
      // No changes needed for exact match
      return {
        original: medication,
        corrected: medication,
        changes: [],
        confidence: 'high'
      };
    }

    if (match.matchType === 'variation') {
      corrected.name = match.brand;
      changes.push({ field: 'name', from: name, to: match.brand, reason: 'known_variation' });

      if (!corrected.generic_name && match.generic) {
        corrected.generic_name = match.generic;
        changes.push({ field: 'generic_name', from: null, to: match.generic, reason: 'inferred' });
      }
      corrected.match_confidence = 'high';
    }

    if (match.matchType === 'fuzzy') {
      corrected.name = match.brand;
      corrected.original_name = name;  // Preserve original
      changes.push({ field: 'name', from: name, to: match.brand, reason: 'fuzzy_match', score: match.score });

      if (!corrected.generic_name && match.generic) {
        corrected.generic_name = match.generic;
        changes.push({ field: 'generic_name', from: null, to: match.generic, reason: 'inferred' });
      }
      corrected.match_confidence = match.score > 0.85 ? 'high' : 'medium';
    }

    if (match.category && !corrected.category) {
      corrected.category = match.category;
      changes.push({ field: 'category', from: null, to: match.category, reason: 'inferred' });
    }

    return {
      original: medication,
      corrected: corrected,
      changes: changes,
      confidence: match.matchType === 'fuzzy' ? (match.score > 0.85 ? 'high' : 'medium') : 'high'
    };
  }

  /**
   * Verify an array of medications
   */
  verifyMedications(medications) {
    if (!Array.isArray(medications)) return [];

    return medications.map(med => {
      const result = this.verifyMedication(med);
      return result.corrected;
    });
  }

  /**
   * Get verification statistics for a batch
   */
  getVerificationStats(original, verified) {
    const changes = [];

    for (let i = 0; i < Math.min(original.length, verified.length); i++) {
      const origName = (original[i]?.name || '').toLowerCase();
      const verName = (verified[i]?.name || '').toLowerCase();

      if (origName !== verName) {
        changes.push({
          index: i,
          from: origName,
          to: verName
        });
      }
    }

    return {
      total: original.length,
      changed: changes.length,
      changes: changes,
      changeRate: changes.length / original.length
    };
  }
}

module.exports = MedicationBrandVerifierTool;
