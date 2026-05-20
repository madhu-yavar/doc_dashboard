/**
 * Dashboard Card Activation Configuration
 *
 * Defines which dashboard cards are active, inactive, or hidden for each document type.
 * This is the single source of truth for card activation across the system.
 *
 * Card States:
 * - active: Card is relevant and should be populated/rendered normally
 * - inactive: Card is not relevant for this document type, shown as disabled if layout consistency needed
 * - hidden: Card should not be rendered for this document type
 */

// Canonical card IDs - must match keys in dashboard_cards
const CARD_IDS = {
  VITALS: 'vitals_card',
  DIAGNOSIS: 'diagnosis_card',
  MEDICATIONS: 'medications_card',
  LABS: 'labs_card',
  RISK: 'risk_card',
  RADIOLOGY: 'radiology_card',
  TREATMENT: 'treatment_card',
  CLINICAL_NOTES: 'clinical_notes_card',
  DISCHARGE_PLAN: 'discharge_plan_card',
  FOLLOW_UP: 'follow_up_card'
};

// Document type constants
const DOCUMENT_TYPES = {
  PRESCRIPTION: 'prescription',
  DISCHARGE_SUMMARY: 'discharge_summary',
  OUTPATIENT_RECORD: 'outpatient_record',
  LAB_REPORT: 'lab_report',
  CHART_NOTE: 'chart_note',
  INPATIENT_RECORD: 'inpatient_record',
  VOICE: 'voice'
};

/**
 * Activation policy: maps document type -> card states
 *
 * Format: { [cardId]: 'active' | 'inactive' | 'hidden' }
 */
const ACTIVATION_POLICY = {
  // Prescription - focused on current visit, medications, vitals
  [DOCUMENT_TYPES.PRESCRIPTION]: {
    [CARD_IDS.VITALS]: 'active',
    [CARD_IDS.DIAGNOSIS]: 'active',
    [CARD_IDS.MEDICATIONS]: 'active',
    [CARD_IDS.CLINICAL_NOTES]: 'active',
    [CARD_IDS.FOLLOW_UP]: 'active',
    // Lab and radiology investigations are extracted via visual element detection
    [CARD_IDS.LABS]: 'active',            // Lab investigations are detected from checkboxes
    [CARD_IDS.RADIOLOGY]: 'active',       // Radiology studies are detected from checkboxes
    [CARD_IDS.RISK]: 'hidden',            // Risk assessment is for inpatient settings
    [CARD_IDS.TREATMENT]: 'inactive',     // May have treatment notes but usually minimal
    [CARD_IDS.DISCHARGE_PLAN]: 'hidden'   // Prescriptions are not discharge documents
  },

  // Discharge Summary - comprehensive inpatient discharge
  [DOCUMENT_TYPES.DISCHARGE_SUMMARY]: {
    [CARD_IDS.VITALS]: 'active',
    [CARD_IDS.DIAGNOSIS]: 'active',
    [CARD_IDS.MEDICATIONS]: 'active',
    [CARD_IDS.LABS]: 'active',
    [CARD_IDS.RISK]: 'active',
    [CARD_IDS.RADIOLOGY]: 'active',
    [CARD_IDS.TREATMENT]: 'active',
    [CARD_IDS.CLINICAL_NOTES]: 'active',
    [CARD_IDS.DISCHARGE_PLAN]: 'active',
    [CARD_IDS.FOLLOW_UP]: 'active'
    // All cards relevant for comprehensive discharge
  },

  // Outpatient Record - clinic visit notes
  [DOCUMENT_TYPES.OUTPATIENT_RECORD]: {
    [CARD_IDS.VITALS]: 'active',
    [CARD_IDS.DIAGNOSIS]: 'active',
    [CARD_IDS.TREATMENT]: 'active',
    [CARD_IDS.CLINICAL_NOTES]: 'active',
    [CARD_IDS.FOLLOW_UP]: 'active',
    [CARD_IDS.MEDICATIONS]: 'active',
    // Less relevant
    [CARD_IDS.LABS]: 'inactive',         // May have lab references but not full results
    [CARD_IDS.RADIOLOGY]: 'inactive',     // May have imaging references
    [CARD_IDS.RISK]: 'hidden',            // Outpatient typically doesn't have risk assessments
    [CARD_IDS.DISCHARGE_PLAN]: 'hidden'   // Not a discharge document
  },

  // Lab Report - lab results focused
  [DOCUMENT_TYPES.LAB_REPORT]: {
    [CARD_IDS.LABS]: 'active',
    [CARD_IDS.VITALS]: 'active',         // May have vitals with labs
    [CARD_IDS.DIAGNOSIS]: 'active',       // Lab tests often ordered for diagnosis
    [CARD_IDS.CLINICAL_NOTES]: 'active',  // May have interpretation notes
    // Not relevant
    [CARD_IDS.MEDICATIONS]: 'inactive',   // Lab reports don't typically list medications
    [CARD_IDS.RADIOLOGY]: 'inactive',     // Separate imaging reports
    [CARD_IDS.RISK]: 'hidden',
    [CARD_IDS.TREATMENT]: 'hidden',
    [CARD_IDS.DISCHARGE_PLAN]: 'hidden',
    [CARD_IDS.FOLLOW_UP]: 'inactive'     // May have follow-up recommendations
  },

  // Chart Note / Progress Note - daily inpatient note
  [DOCUMENT_TYPES.CHART_NOTE]: {
    [CARD_IDS.VITALS]: 'active',
    [CARD_IDS.DIAGNOSIS]: 'active',
    [CARD_IDS.TREATMENT]: 'active',
    [CARD_IDS.CLINICAL_NOTES]: 'active',
    [CARD_IDS.MEDICATIONS]: 'active',    // May have medication changes
    // Contextual
    [CARD_IDS.LABS]: 'inactive',         // May reference labs but not full results
    [CARD_IDS.RADIOLOGY]: 'inactive',     // May reference imaging
    [CARD_IDS.RISK]: 'inactive',         // May update risk status
    [CARD_IDS.FOLLOW_UP]: 'inactive',
    [CARD_IDS.DISCHARGE_PLAN]: 'hidden'  // Not a discharge document (unless discharge note)
  },

  // Inpatient Record - admission/treatment record
  [DOCUMENT_TYPES.INPATIENT_RECORD]: {
    [CARD_IDS.VITALS]: 'active',
    [CARD_IDS.DIAGNOSIS]: 'active',
    [CARD_IDS.MEDICATIONS]: 'active',
    [CARD_IDS.LABS]: 'active',
    [CARD_IDS.RISK]: 'active',
    [CARD_IDS.TREATMENT]: 'active',
    [CARD_IDS.CLINICAL_NOTES]: 'active',
    [CARD_IDS.RADIOLOGY]: 'active',
    [CARD_IDS.FOLLOW_UP]: 'active',
    [CARD_IDS.DISCHARGE_PLAN]: 'inactive'  // May have but not primary focus
  },

  // Voice Dictation - physician voice notes
  [DOCUMENT_TYPES.VOICE]: {
    [CARD_IDS.VITALS]: 'active',
    [CARD_IDS.DIAGNOSIS]: 'active',
    [CARD_IDS.MEDICATIONS]: 'active',
    [CARD_IDS.CLINICAL_NOTES]: 'active',
    [CARD_IDS.FOLLOW_UP]: 'active',
    // Contextual - depends on what was mentioned in dictation
    [CARD_IDS.LABS]: 'inactive',         // Only show if labs were mentioned
    [CARD_IDS.RADIOLOGY]: 'inactive',     // Only show if imaging was mentioned
    [CARD_IDS.RISK]: 'hidden',           // Risk assessment not typically in dictation
    [CARD_IDS.TREATMENT]: 'inactive',     // Only show if treatment discussed
    [CARD_IDS.DISCHARGE_PLAN]: 'hidden'   // Not a discharge document
  }
};

/**
 * Default fallback activation for unknown document types
 */
const DEFAULT_ACTIVATION = {
  [CARD_IDS.VITALS]: 'active',
  [CARD_IDS.DIAGNOSIS]: 'active',
  [CARD_IDS.MEDICATIONS]: 'active',
  [CARD_IDS.CLINICAL_NOTES]: 'active',
  [CARD_IDS.LABS]: 'inactive',
  [CARD_IDS.RADIOLOGY]: 'inactive',
  [CARD_IDS.RISK]: 'hidden',
  [CARD_IDS.TREATMENT]: 'inactive',
  [CARD_IDS.DISCHARGE_PLAN]: 'hidden',
  [CARD_IDS.FOLLOW_UP]: 'inactive'
};

/**
 * Get activation state for a card given document type
 * @param {string} cardId - Card ID from CARD_IDS
 * @param {string} documentType - Document type from DOCUMENT_TYPES
 * @returns {'active' | 'inactive' | 'hidden'}
 */
function getCardActivation(cardId, documentType) {
  const policy = ACTIVATION_POLICY[documentType] || DEFAULT_ACTIVATION;
  return policy[cardId] || 'inactive';
}

/**
 * Get all active cards for a document type
 * @param {string} documentType - Document type from DOCUMENT_TYPES
 * @returns {string[]} Array of active card IDs
 */
function getActiveCards(documentType) {
  const policy = ACTIVATION_POLICY[documentType] || DEFAULT_ACTIVATION;
  return Object.entries(policy)
    .filter(([, state]) => state === 'active')
    .map(([cardId]) => cardId);
}

/**
 * Get all hidden cards for a document type
 * @param {string} documentType - Document type from DOCUMENT_TYPES
 * @returns {string[]} Array of hidden card IDs
 */
function getHiddenCards(documentType) {
  const policy = ACTIVATION_POLICY[documentType] || DEFAULT_ACTIVATION;
  return Object.entries(policy)
    .filter(([, state]) => state === 'hidden')
    .map(([cardId]) => cardId);
}

/**
 * Apply activation metadata to dashboard cards
 * @param {object} dashboardCards - The dashboard_cards object
 * @param {string} documentType - Document type
 * @returns {object} Enhanced cards with activation metadata
 */
function applyActivationMetadata(dashboardCards, documentType) {
  const enhanced = {};

  for (const [cardId, cardData] of Object.entries(dashboardCards)) {
    const activation = getCardActivation(cardId, documentType);

    enhanced[cardId] = {
      ...cardData,
      _activation: {
        state: activation,
        documentType: documentType
      }
    };
  }

  return enhanced;
}

/**
 * Filter cards to only include active and inactive (not hidden)
 * @param {object} dashboardCards - Cards with activation metadata
 * @returns {object} Filtered cards
 */
function filterVisibleCards(dashboardCards) {
  const filtered = {};

  for (const [cardId, cardData] of Object.entries(dashboardCards)) {
    const state = cardData._activation?.state || 'inactive';
    if (state !== 'hidden') {
      filtered[cardId] = cardData;
    }
  }

  return filtered;
}

module.exports = {
  CARD_IDS,
  DOCUMENT_TYPES,
  ACTIVATION_POLICY,
  DEFAULT_ACTIVATION,
  getCardActivation,
  getActiveCards,
  getHiddenCards,
  applyActivationMetadata,
  filterVisibleCards
};
