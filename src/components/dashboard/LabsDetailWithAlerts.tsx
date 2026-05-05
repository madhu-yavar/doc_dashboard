import type { DashboardPatientData } from "@/data/patientData";
import StatusBadge from "./StatusBadge";
import DepartmentAlertBadge from "./DepartmentAlertBadge";
import { ArrowLeft, TestTube, Activity } from "lucide-react";
import ProvenancePanel from "./ProvenancePanel";
import SectionProvenanceBadge from "./SectionProvenanceBadge";
import { Badge } from "@/components/ui/badge";

interface LabsDetailProps {
  onBack: () => void;
  data: DashboardPatientData;
}

const LabsDetail = ({ onBack, data }: LabsDetailProps) => {
  const investigations = data.investigations || [];
  const labProvenance = data.provenance?.sections?.labs;

  // Count ordered tests
  const orderedTests = investigations.filter(t => t.status === 'ordered');
  const notSelectedTests = investigations.filter(t => t.status === 'not_selected');

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-lg bg-section-labs/10 flex items-center justify-center text-lg">🧪</div>
        <h2 className="text-xl font-bold text-foreground">Laboratory Investigations</h2>
        <SectionProvenanceBadge status={labProvenance?.status || 'unknown'} />
        <div className="flex gap-2 flex-wrap">
          <StatusBadge status="normal" label={`${orderedTests.length} Ordered`} />
          {notSelectedTests.length > 0 && (
            <StatusBadge status="info" label={`${notSelectedTests.length} Not Selected`} />
          )}
          {/* Department Alert Badge */}
          {data.departmentAlerts?.departments?.lab?.sent && (
            <DepartmentAlertBadge departmentAlerts={data.departmentAlerts} showDetails />
          )}
        </div>
      </div>

      <ProvenancePanel status={labProvenance?.status || 'unknown'} items={labProvenance?.items || []} />

      {/* No Tests State */}
      {investigations.length === 0 && (
        <div className="bg-muted/30 rounded-lg p-8 text-center text-sm text-muted-foreground">
          <TestTube className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No lab tests ordered in this prescription.</p>
        </div>
      )}

      {/* Lab Tests List */}
      {investigations.length > 0 && (
        <div className="bg-card rounded-xl border overflow-hidden">
          <div className="p-5 border-b">
            <h3 className="font-semibold text-sm text-foreground">Lab Tests</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left p-3 font-medium text-muted-foreground">Test</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Priority</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Source</th>
                </tr>
              </thead>
              <tbody>
                {investigations.map((test, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-3 font-medium text-foreground">{test.type}</td>
                    <td className="p-3">
                      {test.status === 'ordered' ? (
                        <Badge className="bg-green-100 text-green-700">Ordered</Badge>
                      ) : (
                        <Badge variant="outline">Not Selected</Badge>
                      )}
                    </td>
                    <td className="p-3 text-foreground capitalize">{test.priority || 'Routine'}</td>
                    <td className="p-3 text-muted-foreground capitalize">{test.source || 'visual'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default LabsDetail;
