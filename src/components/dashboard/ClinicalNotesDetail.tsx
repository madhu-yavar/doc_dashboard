import { patientData } from "@/data/patientData";
import { ArrowLeft } from "lucide-react";

interface ClinicalNotesDetailProps {
  onBack: () => void;
}

const ClinicalNotesDetail = ({ onBack }: ClinicalNotesDetailProps) => {
  const { clinicalNotes } = patientData;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-notes/10 flex items-center justify-center text-lg">📝</div>
        <h2 className="text-xl font-bold text-foreground">Clinical Notes</h2>
        <span className="text-sm text-muted-foreground">{clinicalNotes.totalNotes} notes</span>
      </div>

      <div className="relative">
        <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />
        <div className="space-y-4">
          {clinicalNotes.notes.map((note, i) => (
            <div key={i} className="relative pl-14">
              <div className="absolute left-4 top-3 w-4 h-4 rounded-full bg-card border-2 border-primary z-10" />
              <div className="bg-card rounded-xl border p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-muted-foreground">{note.date}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{note.type}</span>
                </div>
                <p className="text-sm font-medium text-foreground mb-1">{note.author}</p>
                <p className="text-sm text-muted-foreground">{note.summary}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ClinicalNotesDetail;
