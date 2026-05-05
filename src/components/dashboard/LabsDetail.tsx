import type { DashboardPatientData } from "@/data/patientData";
import StatusBadge from "./StatusBadge";
import { ArrowLeft, FileText, Clock, AlertCircle } from "lucide-react";
import ProvenancePanel from "./ProvenancePanel";
import SectionProvenanceBadge from "./SectionProvenanceBadge";

interface LabsDetailProps {
  onBack: () => void;
  data: DashboardPatientData;
}

const LabsDetail = ({ onBack, data }: LabsDetailProps) => {
  const { labs } = data;
  const labsProvenance = data.provenance.sections.labs;

  // Check if we have actual lab results or just investigations ordered
  const hasLabResults = labs.hasResults || false;
  const labResults = labs.lab_results || [];
  const investigations = labs.investigations || [];
  // Nuclear medicine studies (from prescriptions)
  const nuclearMedicineList = (labs as any).nuclear_medicine_list || [];
  const hasNuclearMedicine = nuclearMedicineList.length > 0;

  // Group investigations by category
  const groupedInvestigations = investigations.length > 0
    ? investigations.reduce((groups: Record<string, string[]>, inv: string) => {
        const name = inv.toUpperCase();
        let category = "Other";
        if (name.includes("CBC") || name.includes("HEMOGLOBIN")) category = "Blood Counts";
        else if (name.includes("LIPID")) category = "Lipid Profile";
        else if (name.includes("LFT")) category = "Liver Function";
        else if (name.includes("KFT") || name.includes("KIDNEY") || name.includes("UREA") || name.includes("CREAT")) category = "Kidney Function";
        else if (name.includes("SODIUM") || name.includes("POTASSIUM")) category = "Electrolytes";
        else if (name.includes("ECG") || name.includes("ECHO")) category = "Cardiac";
        else if (name.includes("XRAY") || name.includes("CT") || name.includes("USG")) category = "Imaging";
        else if (name.includes("URINE")) category = "Urine Tests";
        else if (name.includes("SEROLOGY")) category = "Serology";

        if (!groups[category]) groups[category] = [];
        groups[category].push(inv);
        return groups;
      }, {})
    : {};

  // Group lab results by category
  const groupedLabResults = labResults.length > 0
    ? labResults.reduce((groups: Record<string, typeof labResults>, result) => {
        const name = (result.test || "").toUpperCase();
        let category = "Other";
        if (name.includes("CBC") || name.includes("HEMOGLOBIN") || name.includes("WBC") || name.includes("PLATELET") || name.includes("HCT") || name.includes("RBC")) category = "Complete Blood Count";
        else if (name.includes("LIPID") || name.includes("CHOLESTEROL") || name.includes("LDL") || name.includes("HDL") || name.includes("TRIGLYCERIDE")) category = "Lipid Profile";
        else if (name.includes("LFT") || name.includes("LIVER") || name.includes("SGOT") || name.includes("SGPT") || name.includes("BILIRUBIN") || name.includes("ALP")) category = "Liver Function Tests";
        else if (name.includes("KFT") || name.includes("KIDNEY") || name.includes("UREA") || name.includes("CREATININE") || name.includes("EGFR")) category = "Kidney Function Tests";
        else if (name.includes("SODIUM") || name.includes("POTASSIUM") || name.includes("CHLORIDE") || name.includes("CALCIUM")) category = "Electrolytes";
        else if (name.includes("GLUCOSE") || name.includes("HBA1C") || name.includes("BLOOD SUGAR")) category = "Glucose/HbA1c";
        else if (name.includes("TROPONIN") || name.includes("CK") || name.includes("CK-MB")) category = "Cardiac Markers";
        else if (name.includes("PT") || name.includes("PTT") || name.includes("INR")) category = "Coagulation";
        else if (name.includes("URINE")) category = "Urine Analysis";

        if (!groups[category]) groups[category] = [];
        groups[category].push(result);
        return groups;
      }, {})
    : {};

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-labs/10 flex items-center justify-center text-lg">🔬</div>
        <h2 className="text-xl font-bold text-foreground">Labs - Advised / Results</h2>
        <SectionProvenanceBadge status={labsProvenance.status} />
        <div className="flex gap-2">
          <StatusBadge status="normal" label={`${hasLabResults ? labResults.length : labs.totalTests} Tests`} />
          {labs.abnormalCount > 0 && (
            <StatusBadge status="warning" label={`${labs.abnormalCount} Abnormal`} />
          )}
          {labs.criticalCount > 0 && (
            <StatusBadge status="critical" label={`${labs.criticalCount} Critical`} />
          )}
        </div>
      </div>

      <ProvenancePanel status={labsProvenance.status} items={labsProvenance.items} />

      {/* No Data State */}
      {!hasLabResults && investigations.length === 0 && (
        <div className="bg-muted/30 rounded-lg p-8 text-center text-sm text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No laboratory investigations documented in this discharge summary.</p>
        </div>
      )}

      {/* Lab Results with Values */}
      {hasLabResults && labResults.length > 0 && (
        <div className="space-y-4">
          <div className="bg-card rounded-xl border p-5">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-blue-600" />
              <h3 className="font-semibold text-sm text-foreground">Results</h3>
            </div>

            {Object.entries(groupedLabResults).map(([category, results]) => (
              <div key={category} className="mb-4">
                <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-muted text-xs">{category}</span>
                  <span className="text-xs text-muted-foreground">({results.length} tests)</span>
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left p-2 font-medium text-muted-foreground">Test</th>
                        <th className="text-left p-2 font-medium text-muted-foreground">Result</th>
                        <th className="text-left p-2 font-medium text-muted-foreground">Reference</th>
                        <th className="text-left p-2 font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result, i) => {
                        const flag = result.flag?.toLowerCase() || "";
                        const isAbnormal = flag && ['h', 'high', 'l', 'low', 'abnormal', 'a'].includes(flag);
                        const isCritical = flag && ['c', 'critical', 'panic'].includes(flag);
                        return (
                          <tr key={i} className={`border-t ${isCritical ? 'bg-red-50 dark:bg-red-950/20' : isAbnormal ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
                            <td className="p-2 font-medium text-foreground">{result.test}</td>
                            <td className={`p-2 font-bold ${isCritical ? 'text-red-600' : isAbnormal ? 'text-amber-600' : 'text-foreground'}`}>{result.value}</td>
                            <td className="p-2 text-muted-foreground text-xs">{result.reference}</td>
                            <td className="p-2">
                              {isCritical ? (
                                <StatusBadge status="critical" label="CRITICAL" />
                              ) : isAbnormal ? (
                                <StatusBadge status="warning" label="Abnormal" />
                              ) : (
                                <StatusBadge status="normal" label="Normal" />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Investigations Ordered (when no results available) */}
      {!hasLabResults && investigations.length > 0 && (
        <div className="bg-card rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-amber-600" />
            <h3 className="font-semibold text-sm text-foreground">Investigations Ordered (Pending)</h3>
            <span className="ml-auto text-xs text-muted-foreground">{investigations.length} tests</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            The following laboratory and radiological investigations were ordered. Results are not included in this document.
          </p>

          {Object.entries(groupedInvestigations).map(([category, items]) => (
            <div key={category} className="mb-4">
              <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-muted text-xs">{category}</span>
                <span className="text-xs text-muted-foreground">({items.length} tests)</span>
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm p-2 rounded border bg-muted/30">
                    <FileText className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    <span className="text-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Nuclear Medicine Studies */}
      {hasNuclearMedicine && (
        <div className="bg-card rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 text-purple-600">☢️</div>
            <h3 className="font-semibold text-sm text-foreground">Nuclear Medicine Studies</h3>
            <span className="ml-auto text-xs text-muted-foreground">{nuclearMedicineList.length} study{nuclearMedicineList.length > 1 ? 's' : ''}</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            The following nuclear medicine studies were ordered.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {nuclearMedicineList.map((study: any, i: number) => (
              <div key={i} className={`flex items-center gap-2 text-sm p-3 rounded border ${study.is_uncertain ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800' : 'bg-muted/30'}`}>
                <FileText className="w-4 h-4 text-purple-600 flex-shrink-0" />
                <span className="text-foreground font-medium">{study.test}</span>
                {study.is_uncertain && (
                  <span className="ml-auto text-xs text-amber-600 dark:text-amber-400" title={study.confidence_reason}>
                    Uncertain
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Critical Values Alert */}
      {labs.critical && labs.critical.length > 0 && (
        <div className="bg-card rounded-xl border border-status-critical/20 p-5">
          <h3 className="font-semibold text-sm text-status-critical mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            🔴 Critical Values
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-status-critical/5"><th className="text-left p-3 font-medium text-muted-foreground">Test</th><th className="text-left p-3 font-medium text-muted-foreground">Result</th><th className="text-left p-3 font-medium text-muted-foreground">Reference</th><th className="text-left p-3 font-medium text-muted-foreground">Status</th></tr></thead>
              <tbody>
                {labs.critical.map((t, i) => (
                  <tr key={i}><td className="p-3 font-medium text-foreground">{t.test}</td><td className="p-3 font-bold text-status-critical">{t.result}</td><td className="p-3 text-muted-foreground">{t.reference}</td><td className="p-3"><StatusBadge status="normal" label={t.status + " ✓"} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Abnormal Values */}
      {labs.abnormal && labs.abnormal.length > 0 && (
        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-sm text-status-warning mb-4">⚠️ Abnormal Values</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-status-warning/5"><th className="text-left p-3 font-medium text-muted-foreground">Test</th><th className="text-left p-3 font-medium text-muted-foreground">Result</th><th className="text-left p-3 font-medium text-muted-foreground">Reference</th></tr></thead>
              <tbody>
                {labs.abnormal.map((t, i) => (
                  <tr key={i} className="border-t"><td className="p-3 font-medium text-foreground">{t.test}</td><td className="p-3 font-bold text-status-warning">{t.result}</td><td className="p-3 text-muted-foreground">{t.reference}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Notes */}
      {labs.note && (
        <div className="bg-muted/30 rounded-lg p-4 text-sm text-muted-foreground">
          <p><strong>Note:</strong> {labs.note}</p>
        </div>
      )}
    </div>
  );
};

export default LabsDetail;
