import type { DashboardPatientData } from "@/data/patientData";
import StatusBadge from "./StatusBadge";
import { ArrowLeft } from "lucide-react";
import ProvenancePanel from "./ProvenancePanel";
import SectionProvenanceBadge from "./SectionProvenanceBadge";

interface DiagnosisDetailProps {
  onBack: () => void;
  data: DashboardPatientData;
}

const isGenericPrincipalDiagnosis = (value?: string) =>
  /^(?:newborn|neonate|baby|infant|patient)$/i.test(String(value || "").trim());

const DiagnosisDetail = ({ onBack, data }: DiagnosisDetailProps) => {
  const { diagnosis } = data;
  const genericPrincipal = isGenericPrincipalDiagnosis(diagnosis.principal.description);
  const footerBits = [
    diagnosis.principal.treatingPhysician ? `Clinician: ${diagnosis.principal.treatingPhysician}` : "",
    diagnosis.principal.confirmedDate ? `Documented: ${diagnosis.principal.confirmedDate}` : "",
  ].filter(Boolean);
  const diagnosisProvenance = data.provenance.sections.diagnosis;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-diagnosis/10 flex items-center justify-center text-lg">🩺</div>
        <h2 className="text-xl font-bold text-foreground">Diagnosis — Detailed View</h2>
        <SectionProvenanceBadge status={diagnosisProvenance.status} />
      </div>

      <ProvenancePanel status={diagnosisProvenance.status} items={diagnosisProvenance.items} />

      {/* Principal */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-1 text-foreground">{genericPrincipal ? "Recorded Impression" : "Principal Diagnosis"}</h3>
        <p className="text-lg font-bold text-foreground mb-1">{diagnosis.principal.description}</p>
        {diagnosis.principal.code ? (
          <p className="text-sm font-mono text-muted-foreground mb-4">ICD-10: {diagnosis.principal.code}</p>
        ) : null}

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Clinical Presentation</h4>
            {diagnosis.principal.presentation.length > 0 ? (
              <ul className="space-y-1.5 text-sm text-foreground">
                {diagnosis.principal.presentation.map((p, i) => (
                  <li key={i} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-status-critical" />{p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Not documented.</p>
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Diagnostic Confirmation</h4>
            {diagnosis.principal.confirmation.length > 0 ? (
              <ul className="space-y-1.5 text-sm text-foreground">
                {diagnosis.principal.confirmation.map((c, i) => (
                  <li key={i} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-status-info" />{c}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Not documented.</p>
            )}
          </div>
        </div>
        {footerBits.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">{footerBits.join(" · ")}</p>
        ) : null}
      </div>

      {/* Secondary */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">Secondary Diagnoses</h3>
        {diagnosis.secondary.length > 0 ? (
          <div className="space-y-4">
            {diagnosis.secondary.map((d, i) => (
              <div key={i} className="p-4 rounded-lg bg-muted/50">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-semibold text-sm text-foreground">{i + 1}. {d.description}</span>
                  {d.code ? <span className="font-mono text-xs text-muted-foreground">ICD-10: {d.code}</span> : null}
                </div>
                {d.status || d.history ? (
                  <p className="text-sm text-muted-foreground">
                    {[d.status, d.history].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No secondary diagnoses were documented.</p>
        )}
      </div>

      {/* Comorbidities */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-3 text-foreground">Comorbidities</h3>
        {diagnosis.comorbidities.length > 0 ? (
          <ul className="space-y-1.5 text-sm text-foreground">
            {diagnosis.comorbidities.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No chronic comorbidities were explicitly identified.</p>
        )}
        {diagnosis.drg ? (
          <p className="mt-3 text-xs text-muted-foreground font-mono">DRG: {diagnosis.drg}</p>
        ) : null}
      </div>
    </div>
  );
};

export default DiagnosisDetail;
