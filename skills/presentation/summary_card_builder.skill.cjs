class SummaryCardBuilderSkill {
  constructor(config = {}) {
    this.name = "Summary Card Builder";
    this.version = "1.0.0";
    this.config = config;
  }

  async execute(context) {
    const { dashboardData, cardMetricSelector, sectionStatusResolver } = context;
    if (!dashboardData) {
      return { success: false, error: "No dashboard data provided" };
    }

    const sections = dashboardData.provenance?.sections || {};

    const buildStatus = (section) =>
      sectionStatusResolver?.build(sections[section]?.items || [], ["quoted", "normalized", "derived"]).status ||
      sections[section]?.status ||
      "insufficient_evidence";

    return {
      success: true,
      step: "summary_card_builder",
      data: {
        vitals: cardMetricSelector.buildVitalsCard(dashboardData, { provenance_status: buildStatus("vitals") }),
        diagnosis: cardMetricSelector.buildDiagnosisCard(dashboardData, { provenance_status: buildStatus("diagnosis") }),
        medications: cardMetricSelector.buildMedicationsCard(dashboardData, { provenance_status: buildStatus("medications") }),
        labs: cardMetricSelector.buildLabsCard(dashboardData, { provenance_status: buildStatus("labs") }),
        radiology: cardMetricSelector.buildRadiologyCard(dashboardData, { provenance_status: buildStatus("radiology") }),
        treatment: cardMetricSelector.buildTreatmentCard(dashboardData, { provenance_status: buildStatus("treatment") }),
      },
    };
  }
}

module.exports = SummaryCardBuilderSkill;
