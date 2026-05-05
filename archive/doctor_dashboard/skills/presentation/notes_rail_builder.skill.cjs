class NotesRailBuilderSkill {
  constructor(config = {}) {
    this.name = "Notes Rail Builder";
    this.version = "1.0.0";
    this.config = config;
  }

  async execute(context) {
    const { dashboardData, noteSelector, timelineFormatter } = context;
    if (!dashboardData) {
      return { success: false, error: "No dashboard data provided" };
    }

    const notes = Array.isArray(dashboardData.clinicalNotes?.notes) ? dashboardData.clinicalNotes.notes : [];
    const selected = noteSelector.select(notes, 4);

    const railItems = selected.map((note) =>
      timelineFormatter.format(
        note,
        Array.isArray(note.source_excerpt)
          ? note.source_excerpt.map((item) => ({
              value: item,
              source_section: note.type || "Clinical Note",
              source_excerpt: item,
              source_page: null,
              confidence: 0.7,
              provenance_type: "normalized",
            }))
          : []
      )
    );

    return {
      success: true,
      step: "notes_rail_builder",
      data: railItems,
    };
  }
}

module.exports = NotesRailBuilderSkill;
