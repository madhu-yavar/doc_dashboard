import type { DashboardPatientData } from "@/data/patientData";
import { ArrowLeft } from "lucide-react";
import ProvenancePanel from "./ProvenancePanel";
import SectionProvenanceBadge from "./SectionProvenanceBadge";

interface TreatmentDetailProps {
  onBack: () => void;
  data: DashboardPatientData;
}

const TreatmentDetail = ({ onBack, data }: TreatmentDetailProps) => {
  const { treatment } = data;
  const treatmentProvenance = data.provenance.sections.treatment;
  const hasProcedures = treatment.procedures.length > 0;
  const hasActiveManagement = (treatment.activeManagement || []).length > 0;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-treatment/10 flex items-center justify-center text-lg">🏥</div>
        <h2 className="text-xl font-bold text-foreground">Treatment & Active Management</h2>
        <SectionProvenanceBadge status={treatmentProvenance.status} />
      </div>

      <ProvenancePanel status={treatmentProvenance.status} items={treatmentProvenance.items} />

      {hasActiveManagement && (
        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-sm mb-4 text-foreground">Current Management Plan</h3>
          <div className="grid gap-4">
            {treatment.activeManagement.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h4 className="font-semibold text-sm text-foreground">{item.title}</h4>
                  <span className="text-xs text-muted-foreground">{item.source}</span>
                </div>
                <p className="text-sm text-foreground leading-6">{item.details}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasProcedures ? (
        <div className="grid gap-4">
          {treatment.procedures.map((proc, i) => (
            <div key={i} className="bg-card rounded-xl border p-5">
              <h3 className="font-semibold text-foreground mb-1">{proc.name}</h3>
              {proc.date || proc.physician ? (
                <p className="text-xs text-muted-foreground mb-3">{[proc.date, proc.physician].filter(Boolean).join(" · ")}</p>
              ) : null}
              {proc.details ? <p className="text-sm text-foreground bg-muted/50 p-3 rounded-lg">{proc.details}</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-sm mb-2 text-foreground">Documented Procedures</h3>
          <p className="text-sm text-muted-foreground">No procedures were documented in this record.</p>
        </div>
      )}

      <div className="bg-card rounded-xl border p-5">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 rounded-lg bg-primary/5">
            <div className="text-sm font-semibold text-foreground">{treatment.currentApproach}</div>
            <div className="text-xs text-muted-foreground mt-1">Current Approach</div>
          </div>
          <div className="text-center p-4 rounded-lg bg-status-normal/5">
            <div className="text-sm font-semibold text-foreground">{treatment.response}</div>
            <div className="text-xs text-muted-foreground mt-1">Treatment Response</div>
          </div>
          <div className="text-center p-4 rounded-lg bg-muted/50">
            <div className="text-sm font-semibold text-foreground">{treatment.complicationsLabel}</div>
            <div className="text-xs text-muted-foreground mt-1">Complications</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TreatmentDetail;
