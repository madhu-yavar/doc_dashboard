/**
 * Vitals Extractor Skill
 */

class VitalsExtractorSkill {
  constructor(config = {}) {
    this.name = "Vitals Extractor";
    this.version = "1.0.0";
    this.config = config;
  }

  parseModelJson(content) {
    const normalized = String(content || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    return JSON.parse(normalized);
  }

  normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  getMetricFallback({ label, value, unit = "" }) {
    if (value == null || value === "" || Number(value) === 0) return null;
    return `${label} ${value}${unit ? ` ${unit}` : ""}`.trim();
  }

  sanitizeModelVitalsProvenance(data, provenanceBuilder) {
    if (!provenanceBuilder) return {};

    const raw = data?.provenance?.latest || data?.provenance?.vitals?.latest || {};
    const latest = data?.latest || {};

    const sanitizeMetric = (rawItem, fallback) =>
      provenanceBuilder.sanitizeItem(rawItem, fallback ? { value: fallback } : {});

    return {
      vitals: {
        systolic: sanitizeMetric(
          raw?.bp?.systolic || raw?.systolic,
          this.getMetricFallback({
            label: "Systolic BP",
            value: latest.bp?.systolic,
            unit: "mmHg",
          })
        ),
        diastolic: sanitizeMetric(
          raw?.bp?.diastolic || raw?.diastolic,
          this.getMetricFallback({
            label: "Diastolic BP",
            value: latest.bp?.diastolic,
            unit: "mmHg",
          })
        ),
        pulse: sanitizeMetric(
          raw?.pulse,
          this.getMetricFallback({
            label: "Pulse",
            value: latest.pulse?.value,
            unit: "bpm",
          })
        ),
        spo2: sanitizeMetric(
          raw?.spo2,
          this.getMetricFallback({
            label: "SpO2",
            value: latest.spo2?.value,
            unit: "%",
          })
        ),
        temperature: sanitizeMetric(
          raw?.temperature,
          this.getMetricFallback({
            label: "Temperature",
            value: latest.temperature?.value,
            unit: latest.temperature?.unit || "F",
          })
        ),
        respiratory_rate: sanitizeMetric(
          raw?.resp_rate || raw?.respiratory_rate,
          this.getMetricFallback({
            label: "Respiratory Rate",
            value: latest.resp_rate,
            unit: "/min",
          })
        ),
        pain_score: sanitizeMetric(
          raw?.pain_score,
          this.getMetricFallback({
            label: "Pain Score",
            value: latest.pain_score?.value,
          })
        ),
        grbs: sanitizeMetric(
          raw?.grbs,
          this.getMetricFallback({
            label: "GRBS",
            value: latest.grbs?.value,
          })
        ),
      },
    };
  }

  buildVitalsProvenance(data, pdfText, provenanceBuilder) {
    if (!provenanceBuilder) return {};

    const readings = Array.isArray(data.readings) ? data.readings : [];
    const latest = data.latest || {};
    const latestReading = readings[readings.length - 1] || {};
    const sourceSection = latestReading.source || "Vital Signs";
    const bpSystolic = latest.bp?.systolic;
    const bpDiastolic = latest.bp?.diastolic;

    const createMetric = ({ label, value, unit = "", candidates = [] }) => {
      if (value == null || value === "" || Number(value) === 0) return null;
      const formattedValue = this.getMetricFallback({ label, value, unit });
      return provenanceBuilder.createFromCandidates({
        value: formattedValue,
        source_section: sourceSection,
        candidates,
        pdfText,
        confidence: 0.82,
        provenance_type: "normalized",
      });
    };

    return {
      vitals: {
        systolic: createMetric({
          label: "Systolic BP",
          value: bpSystolic,
          unit: "mmHg",
          candidates: [
            `${bpSystolic}/${bpDiastolic}`,
            `BP ${bpSystolic}/${bpDiastolic}`,
            `Blood Pressure ${bpSystolic}/${bpDiastolic}`,
          ],
        }),
        diastolic: createMetric({
          label: "Diastolic BP",
          value: bpDiastolic,
          unit: "mmHg",
          candidates: [
            `${bpSystolic}/${bpDiastolic}`,
            `BP ${bpSystolic}/${bpDiastolic}`,
            `Blood Pressure ${bpSystolic}/${bpDiastolic}`,
          ],
        }),
        pulse: createMetric({
          label: "Pulse",
          value: latest.pulse?.value,
          unit: "bpm",
          candidates: [
            `Pulse ${latest.pulse?.value}`,
            `${latest.pulse?.value} bt/min`,
            `${latest.pulse?.value} bpm`,
          ],
        }),
        spo2: createMetric({
          label: "SpO2",
          value: latest.spo2?.value,
          unit: "%",
          candidates: [
            `SpO2 ${latest.spo2?.value}`,
            `${latest.spo2?.value}%`,
            `${latest.spo2?.value} %`,
          ],
        }),
        temperature: createMetric({
          label: "Temperature",
          value: latest.temperature?.value,
          unit: latest.temperature?.unit || "F",
          candidates: [
            `Temperature ${latest.temperature?.value}`,
            `Temperature(F) : ${latest.temperature?.value}`,
            `Temperature : ${latest.temperature?.value}`,
            `${latest.temperature?.value}${latest.temperature?.unit || "F"}`,
            `${latest.temperature?.value} ${latest.temperature?.unit || "F"}`,
          ],
        }),
        respiratory_rate: createMetric({
          label: "Respiratory Rate",
          value: latest.resp_rate,
          unit: "/min",
          candidates: [
            `Respiratory Rate ${latest.resp_rate}`,
            `Respiration/min : ${latest.resp_rate}`,
            `Respiration ${latest.resp_rate}`,
            `${latest.resp_rate} br/min`,
            `${latest.resp_rate} /min`,
          ],
        }),
      },
    };
  }

  async execute(context) {
    const { pdfText, gemmaClient, promptBuilder, provenanceBuilder } = context;

    const prompt = promptBuilder.build("vitals_extractor", { pdfText });
    const result = await gemmaClient.execute(prompt, { temperature: 0.1, maxTokens: 2200 });

    if (!result.success) {
      return { success: false, step: "vitals_extractor", error: result.error };
    }

    try {
      const data = this.parseModelJson(result.content);
      const modelProvenance = this.sanitizeModelVitalsProvenance(data, provenanceBuilder);
      const fallbackProvenance = this.buildVitalsProvenance(data, pdfText, provenanceBuilder);
      data.provenance = {
        vitals: {
          systolic: provenanceBuilder?.mergeItem(modelProvenance?.vitals?.systolic, fallbackProvenance?.vitals?.systolic) || null,
          diastolic: provenanceBuilder?.mergeItem(modelProvenance?.vitals?.diastolic, fallbackProvenance?.vitals?.diastolic) || null,
          pulse: provenanceBuilder?.mergeItem(modelProvenance?.vitals?.pulse, fallbackProvenance?.vitals?.pulse) || null,
          spo2: provenanceBuilder?.mergeItem(modelProvenance?.vitals?.spo2, fallbackProvenance?.vitals?.spo2) || null,
          temperature: provenanceBuilder?.mergeItem(modelProvenance?.vitals?.temperature, fallbackProvenance?.vitals?.temperature) || null,
          respiratory_rate:
            provenanceBuilder?.mergeItem(modelProvenance?.vitals?.respiratory_rate, fallbackProvenance?.vitals?.respiratory_rate) || null,
          pain_score: provenanceBuilder?.mergeItem(modelProvenance?.vitals?.pain_score, fallbackProvenance?.vitals?.pain_score) || null,
          grbs: provenanceBuilder?.mergeItem(modelProvenance?.vitals?.grbs, fallbackProvenance?.vitals?.grbs) || null,
        },
      };
      return { success: true, step: "vitals_extractor", data, usage: result.usage };
    } catch (e) {
      return { success: false, step: "vitals_extractor", error: e.message };
    }
  }
}

module.exports = VitalsExtractorSkill;
