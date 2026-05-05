/**
 * Vitals Interpreter Tool
 * Interprets vital signs and flags abnormalities
 */

class VitalsInterpreterTool {
  constructor(config = {}) {
    this.name = "Vitals Interpreter";
    this.version = "1.0.0";
  }

  /**
   * Interpret vitals and flag abnormalities
   */
  execute(vitals) {
    const flags = [];

    // Blood Pressure interpretation
    let bpStatus = "normal";
    if (vitals.bp) {
      const systolic = vitals.bp.systolic || parseInt(vitals.bp?.split?.("/")[0]) || 0;
      const diastolic = vitals.bp.diastolic || parseInt(vitals.bp?.split?.("/")?.[1]) || 0;

      if (systolic >= 180 || diastolic >= 110) {
        bpStatus = "crisis";
        flags.push("Hypertensive Crisis");
      } else if (systolic >= 140 || diastolic >= 90) {
        bpStatus = "high";
        flags.push("High Blood Pressure");
      } else if (systolic >= 120 || diastolic >= 80) {
        bpStatus = "elevated";
        flags.push("Elevated Blood Pressure");
      }
    }

    // Pulse interpretation
    let pulseStatus = "normal";
    if (vitals.pulse) {
      const pulse = typeof vitals.pulse === "object" ? vitals.pulse.value : vitals.pulse;
      if (pulse < 60) {
        pulseStatus = "bradycardia";
        flags.push("Bradycardia");
      } else if (pulse > 100) {
        pulseStatus = "tachycardia";
        flags.push("Tachycardia");
      }
    }

    // SpO2 interpretation
    let spo2Status = "normal";
    if (vitals.spo2) {
      const spo2 = typeof vitals.spo2 === "object" ? vitals.spo2.value : vitals.spo2;
      if (spo2 < 90) {
        spo2Status = "low";
        flags.push("Hypoxemia");
      } else if (spo2 < 95) {
        spo2Status = "borderline";
        flags.push("Borderline SpO2");
      }
    }

    // GRBS interpretation
    let grbsInterpretation = "normal";
    if (vitals.grbs !== null && vitals.grbs !== undefined) {
      const grbs = typeof vitals.grbs === "object" ? vitals.grbs.value : vitals.grbs;
      if (grbs < 70) {
        grbsInterpretation = "hypoglycemia";
        flags.push("Hypoglycemia");
      } else if (grbs >= 100 && grbs < 126) {
        grbsInterpretation = "prediabetic";
        flags.push("Prediabetic");
      } else if (grbs >= 126) {
        grbsInterpretation = "diabetic";
        flags.push("Diabetic");
      }
    }

    // Temperature interpretation
    let tempStatus = "normal";
    if (vitals.temperature) {
      let temp = vitals.temperature;
      if (typeof temp === "object") {
        temp = temp.value;
      }
      // Remove non-numeric characters
      temp = parseFloat(String(temp).replace(/[^0-9.]/g, ""));

      if (temp > 100 || (temp > 38 && temp < 43)) {
        tempStatus = "fever";
        flags.push("Fever");
      } else if (temp < 36) {
        tempStatus = "hypothermia";
        flags.push("Hypothermia");
      }
    }

    return {
      bp: { status: bpStatus },
      pulse: { status: pulseStatus },
      spo2: { status: spo2Status },
      temperature: { status: tempStatus },
      grbs: { interpretation: grbsInterpretation },
      abnormalFlags: flags,
      overallStatus: flags.length > 0 ? "abnormal" : "normal"
    };
  }

  /**
   * Get severity level for a vital
   */
  getSeverity(status) {
    const severityMap = {
      "crisis": "critical",
      "high": "warning",
      "elevated": "info",
      "low": "warning",
      "hypoxemia": "critical",
      "fever": "warning",
      "hypothermia": "warning"
    };
    return severityMap[status] || "normal";
  }
}

module.exports = VitalsInterpreterTool;
