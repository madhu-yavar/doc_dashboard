import { patientData } from "@/data/patientData";
import StatusBadge from "./StatusBadge";
import { ArrowLeft } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface LabsDetailProps {
  onBack: () => void;
}

const LabsDetail = ({ onBack }: LabsDetailProps) => {
  const { labs } = patientData;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-labs/10 flex items-center justify-center text-lg">🔬</div>
        <h2 className="text-xl font-bold text-foreground">Laboratory Results</h2>
        <div className="flex gap-2">
          <StatusBadge status="normal" label={`${labs.totalTests} Complete`} />
          <StatusBadge status="warning" label={`${labs.abnormalCount} Abnormal`} />
          <StatusBadge status="critical" label={`${labs.criticalCount} Critical`} />
        </div>
      </div>

      {/* Critical */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm text-status-critical mb-4">🔴 Critical Values</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-status-critical/5"><th className="text-left p-3 font-medium text-muted-foreground">Test</th><th className="text-left p-3 font-medium text-muted-foreground">Result</th><th className="text-left p-3 font-medium text-muted-foreground">Reference</th><th className="text-left p-3 font-medium text-muted-foreground">Status</th><th className="text-left p-3 font-medium text-muted-foreground">Date</th></tr></thead>
            <tbody>
              {labs.critical.map((t, i) => (
                <tr key={i}><td className="p-3 font-medium text-foreground">{t.test}</td><td className="p-3 font-bold text-status-critical">{t.result}</td><td className="p-3 text-muted-foreground">{t.reference}</td><td className="p-3"><StatusBadge status="normal" label={t.status + " ✓"} /></td><td className="p-3 text-muted-foreground font-mono text-xs">{t.date}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Abnormal */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm text-status-warning mb-4">⚠️ Abnormal Values</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-status-warning/5"><th className="text-left p-3 font-medium text-muted-foreground">Test</th><th className="text-left p-3 font-medium text-muted-foreground">Result</th><th className="text-left p-3 font-medium text-muted-foreground">Reference</th><th className="text-left p-3 font-medium text-muted-foreground">Date</th></tr></thead>
            <tbody>
              {labs.abnormal.map((t, i) => (
                <tr key={i} className="border-t"><td className="p-3 font-medium text-foreground">{t.test}</td><td className="p-3 font-bold text-status-warning">{t.result}</td><td className="p-3 text-muted-foreground">{t.reference}</td><td className="p-3 text-muted-foreground">{t.date}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Troponin Trend */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">Troponin Trend — Serial Monitoring</h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={labs.troponinTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis domain={[0, 3.5]} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <ReferenceLine y={0.5} stroke="hsl(var(--status-normal))" strokeDasharray="5 5" label={{ value: "Normal", fill: "hsl(var(--status-normal))", fontSize: 10 }} />
              <Line type="monotone" dataKey="value" stroke="hsl(var(--status-critical))" strokeWidth={2} dot={{ r: 4 }} name="Troponin I" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* CBC & Metabolic */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-sm mb-3 text-foreground">Complete Blood Count</h3>
          {labs.cbc.map((t, i) => (
            <div key={i} className="flex justify-between py-2 border-b last:border-0 text-sm">
              <span className="text-foreground">{t.test}</span>
              <span className="font-mono text-foreground">{t.result}</span>
            </div>
          ))}
        </div>
        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-sm mb-3 text-foreground">Metabolic Panel</h3>
          {labs.metabolic.map((t, i) => (
            <div key={i} className="flex justify-between py-2 border-b last:border-0 text-sm">
              <span className="text-foreground">{t.test}</span>
              <span className="font-mono text-foreground">{t.result}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pending */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-3 text-foreground">⏳ Pending Results</h3>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {labs.pending.map((p, i) => <li key={i}>• {p}</li>)}
        </ul>
      </div>
    </div>
  );
};

export default LabsDetail;
