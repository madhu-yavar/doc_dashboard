import { patientData } from "@/data/patientData";
import StatusBadge from "./StatusBadge";
import { ArrowLeft } from "lucide-react";

interface MedicationsDetailProps {
  onBack: () => void;
}

const MedicationsDetail = ({ onBack }: MedicationsDetailProps) => {
  const { medications } = patientData;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-medications/10 flex items-center justify-center text-lg">💊</div>
        <h2 className="text-xl font-bold text-foreground">Medication Reconciliation</h2>
      </div>

      {/* Active Medications Table */}
      <div className="bg-card rounded-xl border overflow-hidden">
        <div className="p-5 border-b">
          <h3 className="font-semibold text-sm text-foreground">Discharge Medication List</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-3 font-medium text-muted-foreground">Medication</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Dose</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Freq</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Route</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Start</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Instructions</th>
              </tr>
            </thead>
            <tbody>
              {medications.active.map((med, i) => (
                <tr key={i} className="border-t">
                  <td className="p-3 font-medium text-foreground">{med.name}</td>
                  <td className="p-3 text-foreground">{med.dose}</td>
                  <td className="p-3 text-foreground">{med.frequency}</td>
                  <td className="p-3 text-foreground">{med.route}</td>
                  <td className="p-3 text-muted-foreground">{med.start}</td>
                  <td className="p-3 text-muted-foreground">{med.instructions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Allergy Alerts */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm text-status-critical mb-4 flex items-center gap-2">
          🔴 Allergy Alerts
        </h3>
        <div className="space-y-4">
          {medications.allergies.map((a, i) => (
            <div key={i} className="p-4 rounded-lg border border-status-critical/20 bg-status-critical/5">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-foreground">⚠️ {a.allergen}</span>
                <StatusBadge status={a.severity === "Severe" ? "critical" : "warning"} label={a.severity} />
              </div>
              <p className="text-sm text-foreground">Reaction: {a.reaction}</p>
              <p className="text-sm text-muted-foreground">Last: {a.lastReaction}</p>
              <p className="text-sm text-muted-foreground">Action: {a.action}</p>
              {a.alternative && <p className="text-sm text-muted-foreground">Alternative: {a.alternative}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Changes */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">Medication Changes During Stay</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-status-normal/5 border border-status-normal/20">
            <h4 className="font-semibold text-xs text-status-normal uppercase mb-2">Added</h4>
            <ul className="space-y-1 text-sm text-foreground">
              {medications.changes.added.map((m, i) => <li key={i}>• {m}</li>)}
            </ul>
          </div>
          <div className="p-4 rounded-lg bg-status-warning/5 border border-status-warning/20">
            <h4 className="font-semibold text-xs text-status-warning uppercase mb-2">Adjusted</h4>
            <ul className="space-y-1 text-sm text-foreground">
              {medications.changes.adjusted.length > 0
                ? medications.changes.adjusted.map((m, i) => <li key={i}>• {m}</li>)
                : <li className="text-muted-foreground">None</li>}
            </ul>
          </div>
          <div className="p-4 rounded-lg bg-muted/50 border">
            <h4 className="font-semibold text-xs text-muted-foreground uppercase mb-2">Discontinued</h4>
            <p className="text-sm text-muted-foreground">None</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-status-normal">✅ {medications.interactionCheck}</p>
      </div>
    </div>
  );
};

export default MedicationsDetail;
