import { patientData } from "@/data/patientData";
import StatusBadge from "./StatusBadge";
import { ArrowLeft } from "lucide-react";

interface RadiologyDetailProps {
  onBack: () => void;
}

const RadiologyDetail = ({ onBack }: RadiologyDetailProps) => {
  const { radiology } = patientData;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-radiology/10 flex items-center justify-center text-lg">🫀</div>
        <h2 className="text-xl font-bold text-foreground">Radiology & Imaging</h2>
        <StatusBadge status="warning" label={`${radiology.criticalFindings} Critical Finding`} />
      </div>

      {radiology.studies.map((study, i) => (
        <div key={i} className={`bg-card rounded-xl border p-5 ${study.critical ? "border-status-critical/30" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground">{study.name}</h3>
            {study.critical && <StatusBadge status="critical" label="Critical ⚠️" />}
          </div>
          <p className="text-xs text-muted-foreground mb-4">Date: {study.date} · {study.performedBy}</p>

          <div className="mb-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Findings</h4>
            <ul className="space-y-1.5 text-sm text-foreground">
              {study.findings.map((f, j) => (
                <li key={j} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div className={`p-3 rounded-lg text-sm ${study.critical ? "bg-status-critical/5 border border-status-critical/20" : "bg-muted/50"}`}>
            <span className="font-semibold text-foreground">Impression: </span>
            <span className="text-foreground">{study.impression}</span>
          </div>
        </div>
      ))}

      {/* Pending */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-3 text-foreground">⏳ Pending Studies</h3>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {radiology.pending.map((p, i) => <li key={i}>• {p}</li>)}
        </ul>
      </div>
    </div>
  );
};

export default RadiologyDetail;
