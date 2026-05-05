import type { DashboardPatientData } from "@/data/patientData";
import StatusBadge from "./StatusBadge";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import ProvenancePanel from "./ProvenancePanel";
import SectionProvenanceBadge from "./SectionProvenanceBadge";

interface DischargeDetailProps {
  onBack: () => void;
  data: DashboardPatientData;
}

const DischargeDetail = ({ onBack, data }: DischargeDetailProps) => {
  const { dischargePlan } = data;
  const dischargeProvenance = data.provenance.sections.discharge;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-discharge/10 flex items-center justify-center text-lg">📋</div>
        <h2 className="text-xl font-bold text-foreground">Discharge Plan & Instructions</h2>
        <SectionProvenanceBadge status={dischargeProvenance.status} />
        <StatusBadge status={dischargePlan.condition === "Not documented" ? "warning" : "normal"} label={dischargePlan.condition} />
      </div>

      <ProvenancePanel status={dischargeProvenance.status} items={dischargeProvenance.items} />

      {/* Condition Checks */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">Documented Clinical Status</h3>
        {dischargePlan.conditionChecks.length > 0 ? (
          <div className="space-y-2">
            {dischargePlan.conditionChecks.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-foreground">
                <CheckCircle2 className="w-4 h-4 text-status-normal flex-shrink-0" />
                {c}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No discharge-condition statement was documented in this record.</p>
        )}
      </div>

      {/* Dietary */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-3 text-foreground">🍽️ Diet / Intake Instructions</h3>
        {dischargePlan.dietary.length > 0 ? (
          <ul className="space-y-1.5 text-sm text-foreground">
            {dischargePlan.dietary.map((d, i) => <li key={i}>• {d}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No diet or intake instruction was documented in this record.</p>
        )}
      </div>

      {/* Care Instructions */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">🏃 Precautions & Care Instructions</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-status-critical/5 border border-status-critical/20">
            <h4 className="font-semibold text-xs text-status-critical uppercase mb-2">Precautions / Risks</h4>
            {dischargePlan.activityRestrictions.doNot.length > 0 ? (
              <ul className="space-y-1.5 text-sm text-foreground">
                {dischargePlan.activityRestrictions.doNot.map((d, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <XCircle className="w-3.5 h-3.5 text-status-critical flex-shrink-0" />{d}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No explicit precautions were documented.</p>
            )}
          </div>
          <div className="p-4 rounded-lg bg-status-normal/5 border border-status-normal/20">
            <h4 className="font-semibold text-xs text-status-normal uppercase mb-2">Documented Care Instructions</h4>
            {dischargePlan.activityRestrictions.okToDo.length > 0 ? (
              <ul className="space-y-1.5 text-sm text-foreground">
                {dischargePlan.activityRestrictions.okToDo.map((d, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-status-normal flex-shrink-0" />{d}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No specific care instructions were documented.</p>
            )}
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{dischargePlan.activityRestrictions.afterRestriction}</p>
      </div>

      {dischargePlan.pendingItems.length > 0 ? (
        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-sm mb-3 text-foreground">🕒 Pending Before Disposition / Review</h3>
          <ul className="space-y-2 text-sm text-foreground">
            {dischargePlan.pendingItems.map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="text-status-warning mt-0.5">•</span>{item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Red Flags */}
      <div className="bg-card rounded-xl border p-5 border-status-critical/20">
        <h3 className="font-semibold text-sm mb-3 text-status-critical">🚨 Escalation Risks / Red Flags</h3>
        {dischargePlan.redFlags.length > 0 ? (
          <ul className="space-y-2 text-sm text-foreground">
            {dischargePlan.redFlags.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-status-critical mt-0.5">⚠️</span>{r}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No explicit red-flag escalation instructions were documented.</p>
        )}
      </div>
    </div>
  );
};

export default DischargeDetail;
