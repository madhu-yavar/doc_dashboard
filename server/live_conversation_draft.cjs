function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const EMPTY_LIVE_DRAFT = Object.freeze({
  chiefComplaint: "",
  hpi: "",
  ros: [],
  pastHistory: [],
  diagnosis: "",
  assessment: "",
  symptoms: [],
  medications: [],
  labs: [],
  radiology: [],
  procedures: [],
  followUp: [],
  plan: [],
  patient: {
    name: "",
    age: null,
    gender: "",
  },
  vitals: {
    latest: {
      bp: {
        systolic: null,
        diastolic: null,
      },
      pulse: {
        value: null,
        unit: "bpm",
      },
      temperature: {
        value: null,
        unit: "F",
      },
      spo2: {
        value: null,
        unit: "%",
      },
      weight: {
        value: null,
        unit: "kg",
      },
    },
  },
});

const SUPPORTED_PATIENT_SEX_OPTIONS = Object.freeze(["Male", "Female", "Other"]);
const SUPPORTED_MEDICATION_STATUSES = Object.freeze(["draft", "needs_review", "current", "prescribed", "planned"]);

const REQUIRED_REVIEW_FIELDS = Object.freeze([
  {
    id: "required:linkedPatient",
    fieldPath: "linkedPatient",
    title: "Patient name",
    category: "demographics",
    severity: "high",
    placeholder: "Enter patient name",
    inputType: "text",
  },
  {
    id: "required:patient.age",
    fieldPath: "patient.age",
    title: "Patient age",
    category: "demographics",
    severity: "high",
    placeholder: "Enter age in years",
    inputType: "number",
  },
  {
    id: "required:patient.gender",
    fieldPath: "patient.gender",
    title: "Patient sex",
    category: "demographics",
    severity: "high",
    placeholder: "Select patient sex",
    inputType: "select",
    options: SUPPORTED_PATIENT_SEX_OPTIONS,
  },
]);

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeGender(value, { strict = false } = {}) {
  const normalized = asText(value).toLowerCase();
  if (!normalized) return "";
  if (["m", "male", "man", "boy"].includes(normalized)) return "Male";
  if (["f", "female", "woman", "girl"].includes(normalized)) return "Female";
  if (["other", "non-binary", "nonbinary"].includes(normalized)) return "Other";
  if (strict) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function withArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeMedicationStatus(value) {
  const normalized = asText(value).toLowerCase();
  if (!normalized) return "draft";
  if (SUPPORTED_MEDICATION_STATUSES.includes(normalized)) return normalized;
  if (["review", "uncertain", "unknown"].includes(normalized)) return "needs_review";
  if (["home", "existing", "ongoing"].includes(normalized)) return "current";
  if (["new", "ordered", "started"].includes(normalized)) return "prescribed";
  if (["continue", "continued"].includes(normalized)) return "planned";
  return "draft";
}

function normalizeMedicationEntries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") {
        const name = asText(item);
        return name ? { name, instruction: "", status: "draft" } : null;
      }
      if (!item || typeof item !== "object") return null;

      const name = asText(item.name || item.label || item.medicine);
      if (!name) return null;

      return {
        ...item,
        name,
        instruction: asText(item.instruction || item.frequency || item.note),
        status: normalizeMedicationStatus(item.status),
      };
    })
    .filter(Boolean);
}

function normalizeListItem(item) {
  if (typeof item === "string") return item.trim();
  if (typeof item === "number" || typeof item === "boolean") return String(item);
  if (!item || typeof item !== "object") return "";

  const directText = asText(
    item.name
    || item.label
    || item.value
    || item.text
    || item.summary
    || item.reason
    || item.finding
    || item.description
  );
  if (directText) return directText;

  const system = asText(item.system || item.category || item.type);
  const detail = asText(item.result || item.status || item.note);
  if (system && detail) return `${system}: ${detail}`;
  return system || detail;
}

function normalizeTextList(value, label = "") {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeListItem(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const labeledGroups = [
    ["positive", value.positive],
    ["positives", value.positives],
    ["negative", value.negative],
    ["negatives", value.negatives],
    ["items", value.items],
    ["list", value.list],
    ["history", value.history],
  ];

  const flattened = labeledGroups.flatMap(([groupLabel, groupValue]) =>
    normalizeTextList(groupValue).map((item) =>
      groupLabel === "positive" || groupLabel === "positives"
        ? `Positive: ${item}`
        : groupLabel === "negative" || groupLabel === "negatives"
          ? `Negative: ${item}`
          : item
    )
  );

  if (flattened.length > 0) {
    return flattened;
  }

  const collectedValues = Object.entries(value)
    .filter(([key]) => !["positive", "positives", "negative", "negatives", "items", "list", "history"].includes(key))
    .flatMap(([key, entryValue]) => {
      const items = normalizeTextList(entryValue);
      if (items.length === 0) return [];
      const keyLabel = asText(key).replace(/_/g, " ");
      if (!keyLabel || keyLabel === label) return items;
      return items.map((item) => `${keyLabel}: ${item}`);
    });

  return collectedValues;
}

function normalizeLiveDraft(rawDraft = {}) {
  const base = clone(EMPTY_LIVE_DRAFT);
  const draft = rawDraft && typeof rawDraft === "object" ? rawDraft : {};

  base.chiefComplaint = asText(draft.chiefComplaint || draft.chief_complaint);
  base.hpi = asText(draft.hpi || draft.historyOfPresentIllness || draft.history_of_present_illness);
  base.ros = normalizeTextList(draft.ros || draft.reviewOfSystems || draft.review_of_systems, "ros");
  base.pastHistory = normalizeTextList(
    draft.pastHistory
    || draft.past_history
    || draft.pastMedicalHistory
    || draft.past_medical_history
    || draft.medicalHistory
    || draft.medical_history
    || draft.pmh
    || draft.comorbidities,
    "past history",
  );
  base.diagnosis = asText(draft.diagnosis);
  base.assessment = asText(draft.assessment);
  base.symptoms = normalizeTextList(draft.symptoms, "symptoms");
  base.medications = normalizeMedicationEntries(draft.medications);
  base.labs = normalizeTextList(draft.labs, "labs");
  base.radiology = normalizeTextList(draft.radiology, "radiology");
  base.procedures = normalizeTextList(draft.procedures, "procedures");
  base.followUp = normalizeTextList(draft.followUp || draft.follow_up, "follow up");
  base.plan = normalizeTextList(draft.plan, "plan");

  const patient = draft.patient && typeof draft.patient === "object" ? draft.patient : {};
  base.patient = {
    name: asText(patient.name || draft.patientName),
    age: toNumber(patient.age),
    gender: normalizeGender(patient.gender || draft.gender),
  };

  const vitals = draft.vitals && typeof draft.vitals === "object" ? draft.vitals : {};
  const latest = vitals.latest && typeof vitals.latest === "object" ? vitals.latest : {};
  const bp = latest.bp && typeof latest.bp === "object" ? latest.bp : vitals.bp || {};
  const pulse = latest.pulse && typeof latest.pulse === "object" ? latest.pulse : vitals.pulse || {};
  const temperature = latest.temperature && typeof latest.temperature === "object" ? latest.temperature : vitals.temperature || {};
  const spo2 = latest.spo2 && typeof latest.spo2 === "object" ? latest.spo2 : vitals.spo2 || {};
  const weight = latest.weight && typeof latest.weight === "object" ? latest.weight : vitals.weight || {};

  base.vitals = {
    latest: {
      bp: {
        systolic: toNumber(bp.systolic),
        diastolic: toNumber(bp.diastolic),
      },
      pulse: {
        value: toNumber(pulse.value ?? pulse),
        unit: asText(pulse.unit) || "bpm",
      },
      temperature: {
        value: toNumber(temperature.value ?? temperature),
        unit: asText(temperature.unit) || "F",
      },
      spo2: {
        value: toNumber(spo2.value ?? spo2),
        unit: asText(spo2.unit) || "%",
      },
      weight: {
        value: toNumber(weight.value ?? weight),
        unit: asText(weight.unit) || "kg",
      },
    },
  };

  return base;
}

function hasFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function preferText(incoming, existing) {
  const incomingText = asText(incoming);
  if (incomingText) return incomingText;
  return asText(existing);
}

function preferArray(incoming, existing) {
  if (Array.isArray(incoming) && incoming.length > 0) {
    return incoming;
  }
  return withArray(existing);
}

function preferNumber(incoming, existing) {
  const incomingNumber = toNumber(incoming);
  if (hasFiniteNumber(incomingNumber)) return incomingNumber;
  return toNumber(existing);
}

function mergeLiveDraft(existingDraft = {}, incomingDraft = {}) {
  const existing = normalizeLiveDraft(existingDraft);
  const incoming = normalizeLiveDraft(incomingDraft);

  return normalizeLiveDraft({
    chiefComplaint: preferText(incoming.chiefComplaint, existing.chiefComplaint),
    hpi: preferText(incoming.hpi, existing.hpi),
    ros: preferArray(incoming.ros, existing.ros),
    pastHistory: preferArray(incoming.pastHistory, existing.pastHistory),
    diagnosis: preferText(incoming.diagnosis, existing.diagnosis),
    assessment: preferText(incoming.assessment, existing.assessment),
    symptoms: preferArray(incoming.symptoms, existing.symptoms),
    medications: preferArray(incoming.medications, existing.medications),
    labs: preferArray(incoming.labs, existing.labs),
    radiology: preferArray(incoming.radiology, existing.radiology),
    procedures: preferArray(incoming.procedures, existing.procedures),
    followUp: preferArray(incoming.followUp, existing.followUp),
    plan: preferArray(incoming.plan, existing.plan),
    patient: {
      name: preferText(incoming.patient.name, existing.patient.name),
      age: preferNumber(incoming.patient.age, existing.patient.age),
      gender: preferText(incoming.patient.gender, existing.patient.gender),
    },
    vitals: {
      latest: {
        bp: {
          systolic: preferNumber(incoming.vitals.latest.bp.systolic, existing.vitals.latest.bp.systolic),
          diastolic: preferNumber(incoming.vitals.latest.bp.diastolic, existing.vitals.latest.bp.diastolic),
        },
        pulse: {
          value: preferNumber(incoming.vitals.latest.pulse.value, existing.vitals.latest.pulse.value),
          unit: preferText(incoming.vitals.latest.pulse.unit, existing.vitals.latest.pulse.unit) || "bpm",
        },
        temperature: {
          value: preferNumber(incoming.vitals.latest.temperature.value, existing.vitals.latest.temperature.value),
          unit: preferText(incoming.vitals.latest.temperature.unit, existing.vitals.latest.temperature.unit) || "F",
        },
        spo2: {
          value: preferNumber(incoming.vitals.latest.spo2.value, existing.vitals.latest.spo2.value),
          unit: preferText(incoming.vitals.latest.spo2.unit, existing.vitals.latest.spo2.unit) || "%",
        },
        weight: {
          value: preferNumber(incoming.vitals.latest.weight.value, existing.vitals.latest.weight.value),
          unit: preferText(incoming.vitals.latest.weight.unit, existing.vitals.latest.weight.unit) || "kg",
        },
      },
    },
  });
}

function getDraftFieldValue(session, draft, fieldPath) {
  const normalizedDraft = normalizeLiveDraft(draft);
  switch (fieldPath) {
    case "linkedPatient":
      return asText(session?.linkedPatient || normalizedDraft.patient.name);
    case "patient.age":
      return normalizedDraft.patient.age;
    case "patient.gender":
      return asText(normalizedDraft.patient.gender);
    case "vitals.latest.bp":
      return normalizedDraft.vitals.latest.bp;
    case "vitals.latest.pulse.value":
      return normalizedDraft.vitals.latest.pulse.value;
    case "vitals.latest.spo2.value":
      return normalizedDraft.vitals.latest.spo2.value;
    case "vitals.latest.temperature.value":
      return normalizedDraft.vitals.latest.temperature.value;
    case "vitals.latest.weight.value":
      return normalizedDraft.vitals.latest.weight.value;
    default:
      return null;
  }
}

function hasFieldValue(session, draft, fieldPath) {
  const value = getDraftFieldValue(session, draft, fieldPath);
  if (fieldPath === "vitals.latest.bp") {
    return Boolean(
      value
      && Number.isFinite(value.systolic)
      && value.systolic > 0
      && Number.isFinite(value.diastolic)
      && value.diastolic > 0
    );
  }
  if (fieldPath === "patient.gender") {
    return Boolean(normalizeGender(value, { strict: true }));
  }
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return Boolean(asText(value));
}

function listMissingRequiredFields(session, draft) {
  return REQUIRED_REVIEW_FIELDS.filter((definition) => !hasFieldValue(session, draft, definition.fieldPath));
}

function buildRequiredReviewItems(session, draft) {
  return listMissingRequiredFields(session, draft).map((definition) => ({
    id: definition.id,
    category: definition.category,
    severity: definition.severity,
    title: `${definition.title} is required before finalizing`,
    extractedValue: "",
    suggestedValue: "",
    resolution: "pending",
    required: true,
    fieldPath: definition.fieldPath,
    placeholder: definition.placeholder,
    inputType: definition.inputType,
    options: Array.isArray(definition.options) ? definition.options : undefined,
  }));
}

function mergeRequiredReviewItems(existingItems = [], requiredItems = []) {
  const nonRequired = withArray(existingItems).filter((item) => !item?.required);
  return [...nonRequired, ...requiredItems];
}

function parseRequiredFieldPatch(fieldPath, rawValue, currentDraft = {}) {
  const value = asText(rawValue);
  const sessionPatch = {};
  const draftPatch = {};
  const normalizedDraft = normalizeLiveDraft(currentDraft);

  if (!value) {
    throw new Error("A value is required.");
  }

  switch (fieldPath) {
    case "linkedPatient":
      sessionPatch.linkedPatient = value;
      draftPatch.patient = { name: value };
      return { sessionPatch, draftPatch };
    case "patient.age": {
      const age = Math.round(toNumber(value) || 0);
      if (!age || age <= 0) throw new Error("Enter a valid patient age.");
      draftPatch.patient = { age };
      return { sessionPatch, draftPatch };
    }
    case "patient.gender": {
      const gender = normalizeGender(value, { strict: true });
      if (!gender) throw new Error("Select a valid patient sex.");
      draftPatch.patient = { gender };
      return { sessionPatch, draftPatch };
    }
    case "vitals.latest.bp": {
      const match = value.match(/(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})/i);
      if (!match) throw new Error("Enter blood pressure like 120/80.");
      draftPatch.vitals = {
        latest: {
          bp: {
            systolic: Number(match[1]),
            diastolic: Number(match[2]),
          },
        },
      };
      return { sessionPatch, draftPatch };
    }
    case "vitals.latest.pulse.value": {
      const pulse = toNumber(value);
      if (!pulse || pulse <= 0) throw new Error("Enter a valid pulse.");
      draftPatch.vitals = {
        latest: {
          pulse: {
            value: pulse,
            unit: normalizedDraft.vitals.latest.pulse.unit || "bpm",
          },
        },
      };
      return { sessionPatch, draftPatch };
    }
    case "vitals.latest.spo2.value": {
      const spo2 = toNumber(value);
      if (!spo2 || spo2 <= 0) throw new Error("Enter a valid SpO2 value.");
      draftPatch.vitals = {
        latest: {
          spo2: {
            value: spo2,
            unit: "%",
          },
        },
      };
      return { sessionPatch, draftPatch };
    }
    case "vitals.latest.temperature.value": {
      const temperature = toNumber(value);
      if (!temperature || temperature <= 0) throw new Error("Enter a valid temperature.");
      draftPatch.vitals = {
        latest: {
          temperature: {
            value: temperature,
            unit: /c(?:elsius)?$/i.test(value) ? "C" : normalizedDraft.vitals.latest.temperature.unit || "F",
          },
        },
      };
      return { sessionPatch, draftPatch };
    }
    case "vitals.latest.weight.value": {
      const weight = toNumber(value);
      if (!weight || weight <= 0) throw new Error("Enter a valid weight.");
      draftPatch.vitals = {
        latest: {
          weight: {
            value: weight,
            unit: /lb|lbs|pounds?/i.test(value) ? "lb" : normalizedDraft.vitals.latest.weight.unit || "kg",
          },
        },
      };
      return { sessionPatch, draftPatch };
    }
    default:
      return { sessionPatch, draftPatch };
  }
}

module.exports = {
  EMPTY_LIVE_DRAFT,
  REQUIRED_REVIEW_FIELDS,
  SUPPORTED_PATIENT_SEX_OPTIONS,
  buildRequiredReviewItems,
  listMissingRequiredFields,
  mergeLiveDraft,
  mergeRequiredReviewItems,
  normalizeGender,
  normalizeLiveDraft,
  parseRequiredFieldPatch,
};
