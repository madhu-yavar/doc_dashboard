const VOICE_DASHBOARD_INCOMPLETE_ERROR = "Voice extraction completed but dashboard payload was incomplete.";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasArrayItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasObjectValues(value) {
  return isObject(value) && Object.values(value).some((item) => {
    if (hasText(item) || hasPositiveNumber(item)) return true;
    if (Array.isArray(item)) return item.length > 0;
    if (isObject(item)) return hasObjectValues(item);
    return false;
  });
}

function extractPrincipalDiagnosis(value) {
  if (hasText(value)) return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (hasText(item)) return item.trim();
        if (isObject(item)) return String(item.name || item.description || "").trim();
        return "";
      })
      .find(Boolean) || "";
  }
  if (isObject(value)) {
    return String(value.name || value.description || value.value || "").trim();
  }
  return "";
}

function hasMeaningfulVitals(cards = {}, extracted = {}) {
  const cardSummary = cards.vitals_card?.summary || {};
  const latestVitals = extracted.vitals?.latest || {};
  return Boolean(
    hasPositiveNumber(cards.vitals_card?.data_points) ||
      hasText(cardSummary.latest_bp) ||
      hasPositiveNumber(cardSummary.pulse) ||
      hasPositiveNumber(cardSummary.temp) ||
      hasPositiveNumber(cardSummary.spo2) ||
      hasPositiveNumber(latestVitals.bp?.systolic) ||
      hasPositiveNumber(latestVitals.bp?.diastolic) ||
      hasPositiveNumber(latestVitals.pulse?.value) ||
      hasPositiveNumber(latestVitals.temperature?.value) ||
      hasPositiveNumber(latestVitals.spo2?.value) ||
      hasPositiveNumber(latestVitals.resp_rate?.value) ||
      hasPositiveNumber(latestVitals.resp_rate) ||
      hasPositiveNumber(latestVitals.weight?.value) ||
      hasPositiveNumber(latestVitals.pain_score?.value)
  );
}

function hasMeaningfulDiagnosis(cards = {}, extracted = {}) {
  return Boolean(
    hasText(cards.diagnosis_card?.principal_diagnosis) ||
      hasArrayItems(cards.diagnosis_card?.secondary_diagnoses) ||
      hasText(extractPrincipalDiagnosis(extracted.diagnosis?.principal)) ||
      hasArrayItems(extracted.diagnosis?.secondary) ||
      hasArrayItems(extracted.diagnosis?.symptoms)
  );
}

function hasMeaningfulMedications(cards = {}, extracted = {}) {
  return Boolean(
    hasPositiveNumber(cards.medications_card?.active_count) ||
      hasArrayItems(cards.medications_card?.medication_list) ||
      hasArrayItems(cards.medications_card?.allergies) ||
      hasArrayItems(extracted.medications) ||
      hasArrayItems(extracted.allergies)
  );
}

function hasMeaningfulLabs(cards = {}, extracted = {}) {
  return Boolean(
    hasPositiveNumber(cards.labs_card?.total_tests) ||
      hasArrayItems(cards.labs_card?.lab_results) ||
      hasArrayItems(cards.labs_card?.investigations_list) ||
      hasArrayItems(extracted.lab_results) ||
      hasArrayItems(extracted.investigations)
  );
}

function hasMeaningfulRadiology(cards = {}, extracted = {}) {
  const extractedRadiology = extracted.radiology;
  return Boolean(
    hasPositiveNumber(cards.radiology_card?.studies_completed) ||
      hasText(cards.radiology_card?.key_finding) ||
      hasArrayItems(extractedRadiology) ||
      hasArrayItems(extractedRadiology?.findings) ||
      hasArrayItems(extractedRadiology?.pending)
  );
}

function hasMeaningfulTreatment(cards = {}, extracted = {}) {
  return Boolean(
    hasPositiveNumber(cards.treatment_card?.procedures_performed) ||
      hasText(cards.treatment_card?.current_approach) ||
      hasArrayItems(cards.treatment_card?.management_items) ||
      hasText(extracted.treatment?.current_approach) ||
      hasArrayItems(extracted.treatment?.management_items) ||
      hasArrayItems(extracted.treatment?.procedures) ||
      hasArrayItems(extracted.procedures)
  );
}

function hasMeaningfulNotes(cards = {}, extracted = {}) {
  return Boolean(
    hasPositiveNumber(cards.clinical_notes_card?.total_notes) ||
      hasArrayItems(cards.clinical_notes_card?.notes) ||
      hasArrayItems(extracted.clinical_notes)
  );
}

function hasMeaningfulFollowUp(cards = {}, extracted = {}) {
  return Boolean(
    hasPositiveNumber(cards.follow_up_card?.appointment_count) ||
      hasText(cards.follow_up_card?.next_appointment) ||
      hasArrayItems(cards.follow_up_card?.appointments) ||
      hasArrayItems(extracted.follow_up?.items) ||
      hasArrayItems(extracted.follow_up)
  );
}

function hasMeaningfulDischarge(cards = {}, extracted = {}) {
  return Boolean(
    hasText(cards.discharge_plan_card?.condition) ||
      hasPositiveNumber(cards.discharge_plan_card?.instruction_count) ||
      hasPositiveNumber(cards.discharge_plan_card?.red_flags) ||
      hasArrayItems(extracted.discharge?.dietary) ||
      hasArrayItems(extracted.discharge?.instructions) ||
      hasArrayItems(extracted.discharge?.red_flags)
  );
}

function validateVoiceDashboardResult(result) {
  const details = [];

  if (!isObject(result)) {
    details.push("missing result object");
    return { valid: false, error: VOICE_DASHBOARD_INCOMPLETE_ERROR, details };
  }

  const dashboardCards = result.dashboard_cards;
  if (!isObject(dashboardCards)) {
    details.push("missing dashboard_cards");
  }

  const extractedData = result.extracted_data;
  if (!isObject(extractedData)) {
    details.push("missing extracted_data");
  }

  if (details.length > 0) {
    return { valid: false, error: VOICE_DASHBOARD_INCOMPLETE_ERROR, details };
  }

  const hasRenderableContent = [
    hasMeaningfulVitals(dashboardCards, extractedData),
    hasMeaningfulDiagnosis(dashboardCards, extractedData),
    hasMeaningfulMedications(dashboardCards, extractedData),
    hasMeaningfulLabs(dashboardCards, extractedData),
    hasMeaningfulRadiology(dashboardCards, extractedData),
    hasMeaningfulTreatment(dashboardCards, extractedData),
    hasMeaningfulNotes(dashboardCards, extractedData),
    hasMeaningfulFollowUp(dashboardCards, extractedData),
    hasMeaningfulDischarge(dashboardCards, extractedData),
  ].some(Boolean);

  if (!hasRenderableContent) {
    details.push("no renderable clinical content");
    return { valid: false, error: VOICE_DASHBOARD_INCOMPLETE_ERROR, details };
  }

  return { valid: true, error: null, details: [] };
}

module.exports = {
  VOICE_DASHBOARD_INCOMPLETE_ERROR,
  validateVoiceDashboardResult,
};
