import { patientData } from "@/data/patientData";
import StatusBadge from "./StatusBadge";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";

interface DischargeDetailProps {
  onBack: () => void;
}

const DischargeDetail = ({ onBack }: DischargeDetailProps) => {
  const { dischargePlan } = patientData;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-discharge/10 flex items-center justify-center text-lg">📋</div>
        <h2 className="text-xl font-bold text-foreground">Discharge Plan & Instructions</h2>
        <StatusBadge status="normal" label={`${dischargePlan.condition} ✓`} />
      </div>

      {/* Condition Checks */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">Patient Condition at Discharge</h3>
        <div className="space-y-2">
          {dischargePlan.conditionChecks.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-foreground">
              <CheckCircle2 className="w-4 h-4 text-status-normal flex-shrink-0" />
              {c}
            </div>
          ))}
        </div>
      </div>

      {/* Dietary */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-3 text-foreground">🍽️ Dietary Instructions</h3>
        <ul className="space-y-1.5 text-sm text-foreground">
          {dischargePlan.dietary.map((d, i) => <li key={i}>• {d}</li>)}
        </ul>
      </div>

      {/* Activity */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">🏃 Activity & Lifestyle (Next {dischargePlan.activityRestrictions.duration})</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-status-critical/5 border border-status-critical/20">
            <h4 className="font-semibold text-xs text-status-critical uppercase mb-2">Do Not</h4>
            <ul className="space-y-1.5 text-sm text-foreground">
              {dischargePlan.activityRestrictions.doNot.map((d, i) => (
                <li key={i} className="flex items-center gap-2">
                  <XCircle className="w-3.5 h-3.5 text-status-critical flex-shrink-0" />{d}
                </li>
              ))}
            </ul>
          </div>
          <div className="p-4 rounded-lg bg-status-normal/5 border border-status-normal/20">
            <h4 className="font-semibold text-xs text-status-normal uppercase mb-2">OK to Do</h4>
            <ul className="space-y-1.5 text-sm text-foreground">
              {dischargePlan.activityRestrictions.okToDo.map((d, i) => (
                <li key={i} className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-status-normal flex-shrink-0" />{d}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{dischargePlan.activityRestrictions.afterRestriction}</p>
      </div>

      {/* Red Flags */}
      <div className="bg-card rounded-xl border p-5 border-status-critical/20">
        <h3 className="font-semibold text-sm mb-3 text-status-critical">🚨 When to Seek Immediate Medical Attention</h3>
        <ul className="space-y-2 text-sm text-foreground">
          {dischargePlan.redFlags.map((r, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-status-critical mt-0.5">⚠️</span>{r}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default DischargeDetail;
