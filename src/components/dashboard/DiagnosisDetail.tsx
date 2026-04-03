import { patientData } from "@/data/patientData";
import StatusBadge from "./StatusBadge";
import { ArrowLeft } from "lucide-react";

interface DiagnosisDetailProps {
  onBack: () => void;
}

const DiagnosisDetail = ({ onBack }: DiagnosisDetailProps) => {
  const { diagnosis } = patientData;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-diagnosis/10 flex items-center justify-center text-lg">🩺</div>
        <h2 className="text-xl font-bold text-foreground">Diagnosis — Detailed View</h2>
      </div>

      {/* Principal */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-1 text-foreground">Principal Diagnosis</h3>
        <p className="text-lg font-bold text-foreground mb-1">{diagnosis.principal.description}</p>
        <p className="text-sm font-mono text-muted-foreground mb-4">ICD-10: {diagnosis.principal.code}</p>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Clinical Presentation</h4>
            <ul className="space-y-1.5 text-sm text-foreground">
              {diagnosis.principal.presentation.map((p, i) => (
                <li key={i} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-status-critical" />{p}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Diagnostic Confirmation</h4>
            <ul className="space-y-1.5 text-sm text-foreground">
              {diagnosis.principal.confirmation.map((c, i) => (
                <li key={i} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-status-info" />{c}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Treating Physician: {diagnosis.principal.treatingPhysician} · Confirmed: {diagnosis.principal.confirmedDate}</p>
      </div>

      {/* Secondary */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">Secondary Diagnoses</h3>
        <div className="space-y-4">
          {diagnosis.secondary.map((d, i) => (
            <div key={i} className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm text-foreground">{i + 1}. {d.description}</span>
                <span className="font-mono text-xs text-muted-foreground">ICD-10: {d.code}</span>
              </div>
              <p className="text-sm text-muted-foreground">Status: {d.status} · {d.history}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Comorbidities */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-3 text-foreground">Comorbidities</h3>
        <ul className="space-y-1.5 text-sm text-foreground">
          {diagnosis.comorbidities.map((c, i) => (
            <li key={i}>• {c}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground font-mono">DRG: {diagnosis.drg}</p>
      </div>
    </div>
  );
};

export default DiagnosisDetail;
