class VitalNormalityTool {
  constructor(config = {}) {
    this.name = "Vital Normality";
    this.version = "1.0.0";
    this.config = config;
    this.defaults = {
      bp_systolic_high: 120,
      bp_diastolic_high: 80,
      pulse_min: 60,
      pulse_max: 100,
      spo2_min: 95,
      temp_min: 97,
      temp_max: 99,
      resp_min: 12,
      resp_max: 20,
    };
  }

  numberFromText(text = "") {
    const match = String(text || "").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  getVitals(document = {}) {
    const vitals = document?.result?.extracted_data?.provenance?.vitals || {};
    return {
      systolic: vitals.systolic || null,
      diastolic: vitals.diastolic || null,
      pulse: vitals.pulse || null,
      spo2: vitals.spo2 || null,
      temperature: vitals.temperature || null,
      respiratory_rate: vitals.respiratory_rate || null,
    };
  }

  interpret(message = "", document = {}) {
    const lower = String(message || "").toLowerCase();
    const vitals = this.getVitals(document);

    if (lower.includes("bp") || lower.includes("blood pressure")) {
      const systolic = this.numberFromText(vitals.systolic?.value);
      const diastolic = this.numberFromText(vitals.diastolic?.value);
      if (systolic == null || diastolic == null) return null;

      const normal = systolic < this.defaults.bp_systolic_high && diastolic < this.defaults.bp_diastolic_high;
      return {
        answer: normal
          ? `Yes. The documented blood pressure is ${systolic}/${diastolic} mmHg, which is within the usual reference threshold of <120/<80 mmHg.`
          : `No. The documented blood pressure is ${systolic}/${diastolic} mmHg, which is above the usual reference threshold of <120/<80 mmHg.`,
        citations: [vitals.systolic, vitals.diastolic].filter(Boolean),
        source_class: "internal",
      };
    }

    if (lower.includes("pulse") || lower.includes("heart rate")) {
      const pulse = this.numberFromText(vitals.pulse?.value);
      if (pulse == null) return null;
      const normal = pulse >= this.defaults.pulse_min && pulse <= this.defaults.pulse_max;
      return {
        answer: normal
          ? `Yes. The documented pulse is ${pulse} bpm, which is within the usual reference range of 60-100 bpm.`
          : `No. The documented pulse is ${pulse} bpm, which is outside the usual reference range of 60-100 bpm.`,
        citations: [vitals.pulse].filter(Boolean),
        source_class: "internal",
      };
    }

    return null;
  }
}

module.exports = VitalNormalityTool;
