import { patientData } from "@/data/patientData";
import StatusBadge from "./StatusBadge";
import { ArrowLeft } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const bpData = patientData.vitals.history.map((h) => {
  const [sys, dia] = h.bp.split("/").map(Number);
  return { date: h.date, systolic: sys, diastolic: dia, hr: h.hr, spo2: h.spo2 };
});

interface VitalsDetailProps {
  onBack: () => void;
}

const VitalsDetail = ({ onBack }: VitalsDetailProps) => {
  const { vitals } = patientData;
  const v = vitals.latest;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-vitals/10 flex items-center justify-center text-lg">📊</div>
        <h2 className="text-xl font-bold text-foreground">Vital Signs — Detailed History</h2>
        <StatusBadge status="normal" label="Stable ✓" />
      </div>

      {/* Current Vitals */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">Current Vitals</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: "Blood Pressure", value: `${v.bloodPressure.systolic}/${v.bloodPressure.diastolic}`, unit: v.bloodPressure.unit },
            { label: "Heart Rate", value: v.heartRate.value, unit: v.heartRate.unit },
            { label: "Temperature", value: v.temperature.value, unit: v.temperature.unit },
            { label: "Resp Rate", value: v.respiratoryRate.value, unit: v.respiratoryRate.unit },
            { label: "SpO2", value: v.spo2.value, unit: v.spo2.unit },
            { label: "Pain Score", value: `${v.painScore.value}/${v.painScore.scale}`, unit: "" },
          ].map((item) => (
            <div key={item.label} className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
              <div className="text-lg font-bold text-foreground">{item.value}</div>
              <div className="text-xs text-muted-foreground">{item.unit}</div>
            </div>
          ))}
        </div>
      </div>

      {/* BP Trend */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">Blood Pressure Trend (Last 5 Days)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={bpData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis domain={[60, 170]} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Line type="monotone" dataKey="systolic" stroke="hsl(var(--status-critical))" strokeWidth={2} dot={{ r: 4 }} name="Systolic" />
              <Line type="monotone" dataKey="diastolic" stroke="hsl(var(--status-info))" strokeWidth={2} dot={{ r: 4 }} name="Diastolic" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Heart Rate Trend */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">Heart Rate Trend</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={bpData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis domain={[50, 100]} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Line type="monotone" dataKey="hr" stroke="hsl(var(--section-vitals))" strokeWidth={2} dot={{ r: 4 }} name="Heart Rate" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Alert Timeline */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 text-foreground">Alert Timeline</h3>
        <div className="space-y-3">
          {vitals.alerts.map((alert, i) => (
            <div key={i} className="flex items-start gap-3 text-sm">
              <span className="text-xs font-mono text-muted-foreground whitespace-nowrap mt-0.5">{alert.date}</span>
              <StatusBadge
                status={alert.type === "warning" ? "warning" : alert.type === "info" ? "info" : "normal"}
                label={alert.type === "warning" ? "⚠️" : alert.type === "info" ? "💊" : "✅"}
              />
              <span className="text-foreground">{alert.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default VitalsDetail;
