class RecordContextSearchTool {
  constructor(config = {}) {
    this.name = "Record Context Search";
    this.version = "1.0.0";
    this.config = config;
    this.stopwords = new Set([
      "a","an","and","are","as","at","be","by","do","does","for","from","how","i","in","is","it","me",
      "need","of","on","or","the","to","we","what","when","where","which","who","why","will","with","would",
      "patient","medicine","medication","drug","tablet","tab","inj","cap","od","bd","tds","sos"
    ]);
  }

  normalize(value) {
    return String(value || "").toLowerCase().trim();
  }

  extractTerms(value) {
    return this.normalize(value)
      .replace(/[^a-z0-9\s/%.-]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((term) => !this.stopwords.has(term))
      .filter((term) => term.length > 1);
  }

  flattenInternalEvidence(document = {}) {
    const result = document.result || {};
    const extracted = result.extracted_data || {};
    const provenance = extracted.provenance || {};
    const items = [];

    const pushItems = (section, rawItems = []) => {
      (Array.isArray(rawItems) ? rawItems : [rawItems]).filter(Boolean).forEach((item) => {
        items.push({
          value: item.value || "",
          source_section: item.source_section || section,
          source_excerpt: item.source_excerpt || "",
          source_page: typeof item.source_page === "number" ? item.source_page : null,
          provenance_type: item.provenance_type || "normalized",
          confidence: typeof item.confidence === "number" ? item.confidence : 0.7,
          section,
          label: item.value || "",
        });
      });
    };

    pushItems("vitals", [
      provenance.vitals?.systolic,
      provenance.vitals?.diastolic,
      provenance.vitals?.pulse,
      provenance.vitals?.spo2,
      provenance.vitals?.temperature,
      provenance.vitals?.respiratory_rate,
    ]);
    pushItems("diagnosis", [provenance.diagnosis?.principal, ...(provenance.diagnosis?.secondary || [])]);
    pushItems("medications", provenance.medications || []);
    pushItems("labs", [...(provenance.labs?.results || []), ...(provenance.labs?.investigations || [])]);
    pushItems("radiology", [...(provenance.radiology?.findings || []), ...(provenance.radiology?.pending || [])]);
    pushItems("treatment", [
      provenance.treatment?.current_approach,
      ...(provenance.treatment?.management_items || []),
      ...(provenance.treatment?.procedures || []),
      provenance.treatment?.response,
      ...(provenance.treatment?.complications || []),
    ]);
    pushItems("handover", [provenance.handover?.overview, ...(provenance.handover?.notes || [])]);
    pushItems("discharge", [
      ...(provenance.discharge?.dietary || []),
      ...(provenance.discharge?.instructions || []),
      ...(provenance.discharge?.red_flags || []),
    ]);
    pushItems("followup", provenance.follow_up?.items || []);

    const patient = extracted.patient || {};
    [
      ["patient", patient.name, "Patient name"],
      ["patient", patient.mrn, "Medical record number"],
      ["patient", patient.age, "Age"],
      ["patient", patient.gender, "Gender"],
      ["patient", patient.admission_date, "Admission date"],
      ["patient", patient.discharge_date, "Discharge date"],
    ].forEach(([section, value, label]) => {
      if (value) {
        items.push({
          value: String(value),
          source_section: "Patient Overview",
          source_excerpt: `${label}: ${value}`,
          source_page: null,
          provenance_type: "normalized",
          confidence: 0.75,
          section,
          label,
        });
      }
    });

    return items.filter((item) => item.value);
  }

  score(item, query, sectionHints = [], factField = null) {
    const haystack = this.normalize(`${item.value} ${item.source_section} ${item.source_excerpt} ${item.section}`);
    const rawTerms = this.normalize(query).split(/\s+/).filter(Boolean);
    const significantTerms = this.extractTerms(query);
    let score = 0;

    if (sectionHints.includes(item.section)) score += 2;
    if (factField) {
      const label = this.normalize(item.label || "");
      const section = this.normalize(item.section || "");
      const sourceSection = this.normalize(item.source_section || "");
      if (factField === "patient_name" && (label.includes("patient name") || section === "patient")) score += 8;
      if (factField === "mrn" && (label.includes("medical record number") || label.includes("mrn"))) score += 8;
      if (factField === "age" && label.includes("age")) score += 8;
      if (factField === "gender" && label.includes("gender")) score += 8;
      if (factField === "admission_date" && label.includes("admission date")) score += 8;
      if (factField === "discharge_date" && label.includes("discharge date")) score += 8;
      if (factField === "principal_diagnosis" && (section === "diagnosis" || sourceSection.includes("diagnosis"))) score += 8;
    }
    for (const term of rawTerms) {
      if (haystack.includes(term)) score += 0.2;
    }
    for (const term of significantTerms) {
      if (haystack.includes(term)) score += 2;
    }
    if (item.section === "medications") {
      const medText = this.normalize(`${item.value} ${item.source_excerpt}`);
      for (const term of significantTerms) {
        if (medText.includes(term)) score += 5;
      }
    }
    if (this.normalize(item.value).includes(this.normalize(query))) score += 2;
    return score;
  }

  search(document, query, sectionHints = [], limit = 8, factField = null) {
    const items = this.flattenInternalEvidence(document)
      .map((item) => ({ ...item, score: this.score(item, query, sectionHints, factField) }))
      .filter((item) => item.score > 0 || sectionHints.includes(item.section))
      .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
      .slice(0, limit);

    return items;
  }
}

module.exports = RecordContextSearchTool;
