class CardMetricSelectorTool {
  constructor(config = {}) {
    this.name = "Card Metric Selector";
    this.version = "1.0.0";
    this.config = config;
  }

  normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  createCard(section, payload = {}) {
    return {
      section,
      title: payload.title || section,
      headline_metric: payload.headline_metric || "",
      secondary_line: payload.secondary_line || "",
      supporting_points: this.toArray(payload.supporting_points).filter(Boolean).slice(0, 2),
      status: payload.status || "neutral",
      provenance_status: payload.provenance_status || "insufficient_evidence",
    };
  }

  buildVitalsCard(data = {}, context = {}) {
    const latest = data.vitals?.latest || {};
    const bp = latest.bloodPressure || {};
    const pulse = latest.heartRate || {};
    const spo2 = latest.spo2 || {};
    const temp = latest.temperature || {};
    const rr = latest.respiratoryRate || {};

    return this.createCard("vitals", {
      title: "Vitals",
      headline_metric: bp.systolic && bp.diastolic ? `${bp.systolic}/${bp.diastolic} mmHg` : "",
      secondary_line: pulse.value ? `Pulse ${pulse.value} bpm` : "",
      supporting_points: [
        spo2.value ? `SpO2 ${spo2.value}%` : "",
        temp.value || rr.value ? `Temp ${temp.value || "-"}°F · RR ${rr.value || "-"} /min` : "",
      ],
      status: data.vitals?.status || "neutral",
      provenance_status: context.provenance_status,
    });
  }

  buildDiagnosisCard(data = {}, context = {}) {
    return this.createCard("diagnosis", {
      title: "Diagnosis",
      headline_metric: data.diagnosis?.principal?.description || "",
      secondary_line: data.diagnosis?.principal?.code ? `ICD-10 ${data.diagnosis.principal.code}` : "",
      supporting_points: [
        data.diagnosis?.secondary?.length ? `+${data.diagnosis.secondary.length} secondary` : "",
      ],
      status: "neutral",
      provenance_status: context.provenance_status,
    });
  }

  buildMedicationsCard(data = {}, context = {}) {
    const meds = this.toArray(data.medications?.active);
    return this.createCard("medications", {
      title: "Medications",
      headline_metric: `${meds.length}`,
      secondary_line: meds.length === 1 ? "active medication" : "active medications",
      supporting_points: meds.slice(0, 2).map((med) => med?.name).filter(Boolean),
      status: data.medications?.allergies?.length ? "warning" : "normal",
      provenance_status: context.provenance_status,
    });
  }

  buildLabsCard(data = {}, context = {}) {
    const investigations = this.toArray(data.labs?.investigations);
    const nuclearStudies = this.toArray(data.labs?.nuclearStudies);
    const orderedNames = investigations
      .map((item) => this.normalizeWhitespace(item?.type || item?.test || item?.test_name || item))
      .concat(nuclearStudies.map((item) => this.normalizeWhitespace(item?.type || item?.study_name || item?.test || item)))
      .filter(Boolean)
      .slice(0, 2);

    return this.createCard("labs", {
      title: "Labs",
      headline_metric: `${data.labs?.totalTests || 0}`,
      secondary_line: data.labs?.hasResults ? "tests completed" : "tests ordered",
      supporting_points: [
        data.labs?.hasResults
          ? (data.labs?.abnormalCount ? `${data.labs.abnormalCount} abnormal` : "")
          : orderedNames[0] || "",
        data.labs?.hasResults
          ? (data.labs?.criticalCount ? `${data.labs.criticalCount} critical` : "")
          : orderedNames[1] || "",
      ],
      status: data.labs?.criticalCount ? "critical" : data.labs?.abnormalCount ? "warning" : "normal",
      provenance_status: context.provenance_status,
    });
  }

  buildRadiologyCard(data = {}, context = {}) {
    const studies = this.toArray(data.radiology?.studies);
    const studyNames = studies
      .map((item) => this.normalizeWhitespace(item?.type || item?.name || item?.study_name || item))
      .filter(Boolean)
      .slice(0, 2);
    const studyCount = Number(data.radiology?.completedStudies || 0);

    return this.createCard("radiology", {
      title: "Radiology",
      headline_metric: `${studyCount}`,
      secondary_line: studyCount === 1 ? "study ordered" : "studies ordered",
      supporting_points: [
        studyNames[0] || "",
        studyNames[1] || (data.radiology?.pendingStudies ? `${data.radiology.pendingStudies} pending/documented` : "No pending imaging documented"),
      ],
      status: data.radiology?.criticalFindings ? "critical" : "normal",
      provenance_status: context.provenance_status,
    });
  }

  buildTreatmentCard(data = {}, context = {}) {
    const activeManagement = this.toArray(data.treatment?.activeManagement);
    const procedures = this.toArray(data.treatment?.procedures);
    const procedureNames = procedures
      .map((item) => this.normalizeWhitespace(item?.name || item?.details || item))
      .filter(Boolean)
      .slice(0, 2);
    const complicationsLabel = this.normalizeWhitespace(data.treatment?.complicationsLabel || "");

    return this.createCard("treatment", {
      title: "Treatment",
      headline_metric: `${Math.max(activeManagement.length, procedures.length)}`,
      secondary_line: "plan items",
      supporting_points: [
        data.treatment?.currentApproach || procedureNames[0] || "",
        procedureNames[1] || (!/^not documented$/i.test(complicationsLabel) ? complicationsLabel : ""),
      ],
      status: data.treatment?.complications ? "warning" : "normal",
      provenance_status: context.provenance_status,
    });
  }
}

module.exports = CardMetricSelectorTool;
