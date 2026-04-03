import { patientData } from "@/data/patientData";
import { ArrowLeft } from "lucide-react";

interface TreatmentDetailProps {
  onBack: () => void;
}

const TreatmentDetail = ({ onBack }: TreatmentDetailProps) => {
  const { treatment } = patientData;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-treatment/10 flex items-center justify-center text-lg">🏥</div>
        <h2 className="text-xl font-bold text-foreground">Treatment & Procedures</h2>
      </div>

      <div className="grid gap-4">
        {treatment.procedures.map((proc, i) => (
          <div key={i} className="bg-card rounded-xl border p-5">
            <h3 className="font-semibold text-foreground mb-1">{proc.name}</h3>
            <p className="text-xs text-muted-foreground mb-3">{proc.date} · {proc.physician}</p>
            <p className="text-sm text-foreground bg-muted/50 p-3 rounded-lg">{proc.details}</p>
          </div>
        ))}
      </div>

      <div className="bg-card rounded-xl border p-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-4 rounded-lg bg-status-normal/5">
            <div className="text-2xl font-bold text-status-normal">{treatment.response}</div>
            <div className="text-xs text-muted-foreground">Treatment Response</div>
          </div>
          <div className="text-center p-4 rounded-lg bg-muted/50">
            <div className="text-2xl font-bold text-foreground">{treatment.complications}</div>
            <div className="text-xs text-muted-foreground">Complications</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TreatmentDetail;
