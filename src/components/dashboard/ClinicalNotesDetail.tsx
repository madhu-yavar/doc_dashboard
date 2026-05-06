import type { DashboardPatientData } from "@/data/patientData";
import { AlertTriangle, ArrowLeft, ClipboardList, Stethoscope } from "lucide-react";
import NoteRichText from "./NoteRichText";
import ProvenancePanel from "./ProvenancePanel";
import SectionProvenanceBadge from "./SectionProvenanceBadge";

interface ClinicalNotesDetailProps {
  onBack: () => void;
  data: DashboardPatientData;
}

const ClinicalNotesDetail = ({ onBack, data }: ClinicalNotesDetailProps) => {
  const { clinicalNotes } = data;
  const handoverProvenance = data.provenance.sections.handover;
  const handoverSections = clinicalNotes.handover?.sections || [];

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-notes/10 flex items-center justify-center text-lg">📝</div>
        <h2 className="text-xl font-bold text-foreground">Clinical Handover</h2>
        <SectionProvenanceBadge status={handoverProvenance.status} />
        <span className="text-sm text-muted-foreground">{clinicalNotes.totalNotes} source notes</span>
      </div>

      <ProvenancePanel status={handoverProvenance.status} items={handoverProvenance.items} />

      <div className="bg-card rounded-xl border p-5">
        <div className="flex items-center gap-2 mb-3">
          <Stethoscope className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm text-foreground">Doctor Handover Summary</h3>
        </div>
        <NoteRichText
          text={clinicalNotes.handover?.overview || "No clinical handover summary available."}
        />
      </div>

      {handoverSections.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {handoverSections.map((section) => (
            <div
              key={section.title}
              className={`rounded-xl border p-5 ${
                section.tone === "warning" ? "border-status-warning/20 bg-amber-50/50" : "bg-card"
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                {section.tone === "warning" ? (
                  <AlertTriangle className="w-4 h-4 text-status-warning" />
                ) : (
                  <ClipboardList className="w-4 h-4 text-primary" />
                )}
                <h3 className="font-semibold text-sm text-foreground">{section.title}</h3>
              </div>
              <div className="space-y-2">
                {section.items.map((item, index) => (
                  <NoteRichText key={`${section.title}-${index}`} text={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />
        <div className="space-y-4">
          {clinicalNotes.notes.length === 0 ? (
            <div className="relative pl-14">
              <div className="absolute left-4 top-3 w-4 h-4 rounded-full bg-card border-2 border-border z-10" />
              <div className="bg-card rounded-xl border p-5">
                <p className="text-sm font-medium text-foreground mb-1">No source notes extracted</p>
                <p className="text-sm text-muted-foreground">
                  This processed record does not yet include structured note sections such as resident notes, handover notes, or nursing endorsements.
                </p>
              </div>
            </div>
          ) : (
            clinicalNotes.notes.map((note, i) => (
              <div key={i} className="relative pl-14">
                <div className="absolute left-4 top-3 w-4 h-4 rounded-full bg-card border-2 border-primary z-10" />
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_4px_14px_rgba(15,23,42,0.035)]">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">{note.author}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">{note.date}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{note.type}</span>
                      </div>
                    </div>
                  </div>

                  {note.summary ? (
                    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Summary</p>
                      <NoteRichText text={note.summary} muted />
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2">
                    {note.situation ? (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Situation</p>
                        <NoteRichText text={note.situation} />
                      </div>
                    ) : null}
                    {note.background ? (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Background</p>
                        <NoteRichText text={note.background} />
                      </div>
                    ) : null}
                    {note.assessment ? (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Assessment</p>
                        <NoteRichText text={note.assessment} />
                      </div>
                    ) : null}
                    {note.recommendations ? (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Recommendations</p>
                        <NoteRichText text={note.recommendations} />
                      </div>
                    ) : null}
                  </div>

                  {note.pending_items?.length ? (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Pending Items</p>
                      <div className="flex flex-wrap gap-2">
                        {note.pending_items.map((item, index) => (
                          <span key={`${item}-${index}`} className="rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {note.risk_flags?.length ? (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Risk Flags</p>
                      <div className="flex flex-wrap gap-2">
                        {note.risk_flags.map((item, index) => (
                          <span key={`${item}-${index}`} className="rounded-full bg-status-warning/10 px-2.5 py-1 text-xs text-status-warning">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {note.handed_over_by || note.handed_over_to ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {note.handed_over_by ? (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Handed Over By</p>
                          <p className="text-sm text-foreground">{note.handed_over_by}</p>
                        </div>
                      ) : null}
                      {note.handed_over_to ? (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Handed Over To</p>
                          <p className="text-sm text-foreground">{note.handed_over_to}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {note.source_excerpt?.length ? (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Source Excerpts</p>
                      <div className="space-y-1">
                        {note.source_excerpt.map((item, index) => (
                          <div key={`${item}-${index}`} className="rounded-lg border-l-2 border-slate-200 bg-slate-50/70 px-3 py-2">
                            <NoteRichText text={item} muted />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ClinicalNotesDetail;
