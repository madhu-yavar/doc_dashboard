import type { DashboardPatientData } from "@/data/patientData";
import StatusBadge from "./StatusBadge";
import { ArrowLeft } from "lucide-react";
import ProvenancePanel from "./ProvenancePanel";
import SectionProvenanceBadge from "./SectionProvenanceBadge";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface VitalsDetailProps {
  onBack: () => void;
  data: DashboardPatientData;
}

const DEFAULT_REFERENCE_RANGES = {
  bp_systolic_high: 120,
  bp_diastolic_high: 80,
  pulse_min: 60,
  pulse_max: 100,
  spo2_min: 95,
  temp_min: 97,
  temp_max: 99,
  resp_min: 12,
  resp_max: 20,
};

const parseReferenceValues = (value?: string) => {
  const matches = String(value || "").match(/\d+(\.\d+)?/g);
  return matches ? matches.map(Number) : [];
};

const buildReferenceRanges = (referenceRanges?: Record<string, string>) => {
  const systolic = parseReferenceValues(referenceRanges?.bp_systolic_normal);
  const diastolic = parseReferenceValues(referenceRanges?.bp_diastolic_normal);
  const pulse = parseReferenceValues(referenceRanges?.pulse_normal);
  const spo2 = parseReferenceValues(referenceRanges?.spo2_normal);
  const temp = parseReferenceValues(referenceRanges?.temperature_normal);
  const resp = parseReferenceValues(referenceRanges?.resp_rate_normal);

  return {
    bp_systolic_high: systolic[0] || DEFAULT_REFERENCE_RANGES.bp_systolic_high,
    bp_diastolic_high: diastolic[0] || DEFAULT_REFERENCE_RANGES.bp_diastolic_high,
    pulse_min: pulse[0] || DEFAULT_REFERENCE_RANGES.pulse_min,
    pulse_max: pulse[1] || DEFAULT_REFERENCE_RANGES.pulse_max,
    spo2_min: spo2[0] || DEFAULT_REFERENCE_RANGES.spo2_min,
    temp_min: temp[0] || DEFAULT_REFERENCE_RANGES.temp_min,
    temp_max: temp[1] || DEFAULT_REFERENCE_RANGES.temp_max,
    resp_min: resp[0] || DEFAULT_REFERENCE_RANGES.resp_min,
    resp_max: resp[1] || DEFAULT_REFERENCE_RANGES.resp_max,
    labels: {
      systolic: referenceRanges?.bp_systolic_normal || "<120",
      diastolic: referenceRanges?.bp_diastolic_normal || "<80",
      pulse: referenceRanges?.pulse_normal || "60-100",
      spo2: referenceRanges?.spo2_normal || "≥95%",
      temp: referenceRanges?.temperature_normal || "97-99°F",
      resp: referenceRanges?.resp_rate_normal || "12-20/min",
    },
  };
};

const getTrend = (values: number[]): "up" | "down" | "stable" => {
  if (values.length < 2) return "stable";
  const first = values[0];
  const last = values[values.length - 1];
  if (!first && !last) return "stable";
  const diff = last - first;
  const threshold = Math.max(Math.abs(first) * 0.03, 1);
  if (Math.abs(diff) <= threshold) return "stable";
  return diff > 0 ? "up" : "down";
};

const getDeltaLabel = (values: number[], trend: "up" | "down" | "stable") => {
  if (values.length < 2) return "";
  if (trend === "stable") return "Trend stable";
  const first = values[0];
  const last = values[values.length - 1];
  if (!first) return "";
  const delta = Math.round((Math.abs(last - first) / Math.abs(first)) * 100);
  return `Trend ${trend === "up" ? "↑" : "↓"} ${delta}%`;
};

const buildDisplayTrendData = (data: Array<Record<string, number | string>>) => {
  if (data.length === 0) return [];
  if (data.length > 1) return data;

  const single = data[0];
  return Array.from({ length: 7 }, (_, index) => ({
    ...single,
    label: `P${index + 1}`,
  }));
};

const renderTrendChart = ({
  data,
  dataKey,
  color,
  fill,
  mode,
  referenceValue,
}: {
  data: Array<Record<string, number | string>>;
  dataKey: string;
  color: string;
  fill: string;
  mode: "area" | "line" | "bar";
  referenceValue?: number;
}) => {
  if (!data.length) return null;
  const chartData = data.map((item) => ({
    ...item,
    reference: referenceValue ?? 0,
  }));

  if (mode === "bar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }} barCategoryGap={8}>
          <Bar dataKey="reference" fill="#e7eef3" radius={[4, 4, 0, 0]} />
          <Bar dataKey={dataKey} fill={fill} radius={[4, 4, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (mode === "line") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          {typeof referenceValue === "number" ? (
            <Line type="monotone" dataKey="reference" stroke="#d7e0e7" strokeWidth={3} dot={false} />
          ) : null}
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={3} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <defs>
          <linearGradient id={`${dataKey}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fill} stopOpacity={0.34} />
            <stop offset="100%" stopColor={fill} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        {typeof referenceValue === "number" ? (
          <Line type="monotone" dataKey="reference" stroke="#d7e0e7" strokeWidth={3} dot={false} />
        ) : null}
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={3}
          fill={`url(#${dataKey}-fill)`}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

const VitalsDetail: React.FC<VitalsDetailProps> = ({ onBack, data }) => {
  const { vitals } = data;
  const vitalsProvenance = data.provenance.sections.vitals;
  const latest = vitals.latest;
  const referenceRanges = buildReferenceRanges(vitals.referenceRanges);
  const hasDocumentedVitals = [
    latest.bloodPressure.systolic,
    latest.bloodPressure.diastolic,
    latest.heartRate.value,
    latest.spo2.value,
    latest.temperature.value,
    latest.respiratoryRate.value,
  ].some((value) => typeof value === "number" && value > 0);

  const chartData = vitals.history.map((entry: any, index: number) => {
    const [sys, dia] = String(entry.bp || "").split("/").map(Number);
    return {
      label: entry.date || `R${index + 1}`,
      systolic: sys || 0,
      diastolic: dia || 0,
      hr: entry.hr || 0,
      spo2: entry.spo2 || 0,
      temp: entry.temp || 0,
      rr: entry.rr || latest.respiratoryRate.value || 0,
    };
  });
  const displayChartData = buildDisplayTrendData(chartData);

  const cards = [
    {
      key: "systolic",
      label: "Systolic BP",
      value: latest.bloodPressure.systolic,
      unit: "mmHg",
      reference: referenceRanges.labels.systolic,
      trend: getTrend(chartData.map((item) => item.systolic as number)),
      chartMode: "area" as const,
      status:
        latest.bloodPressure.systolic >= referenceRanges.bp_systolic_high ? "Elevated" : "Normal",
      referenceValue: referenceRanges.bp_systolic_high,
      valueKey: "systolic",
    },
    {
      key: "diastolic",
      label: "Diastolic BP",
      value: latest.bloodPressure.diastolic,
      unit: "mmHg",
      reference: referenceRanges.labels.diastolic,
      trend: getTrend(chartData.map((item) => item.diastolic as number)),
      chartMode: "line" as const,
      status:
        latest.bloodPressure.diastolic >= referenceRanges.bp_diastolic_high ? "Elevated" : "Normal",
      referenceValue: referenceRanges.bp_diastolic_high,
      valueKey: "diastolic",
    },
    {
      key: "heart-rate",
      label: "Heart Rate",
      value: latest.heartRate.value,
      unit: "bpm",
      reference: referenceRanges.labels.pulse,
      trend: getTrend(chartData.map((item) => item.hr as number)),
      chartMode: "bar" as const,
      status:
        latest.heartRate.value < referenceRanges.pulse_min || latest.heartRate.value > referenceRanges.pulse_max
          ? "Review"
          : "Normal",
      referenceValue: referenceRanges.pulse_max,
      valueKey: "hr",
    },
    {
      key: "spo2",
      label: "SpO2",
      value: latest.spo2.value,
      unit: "%",
      reference: referenceRanges.labels.spo2,
      trend: getTrend(chartData.map((item) => item.spo2 as number)),
      chartMode: "area" as const,
      status: latest.spo2.value < referenceRanges.spo2_min ? "Review" : "Normal",
      referenceValue: referenceRanges.spo2_min,
      valueKey: "spo2",
    },
    {
      key: "temperature",
      label: "Temperature",
      value: latest.temperature.value,
      unit: "°F",
      reference: referenceRanges.labels.temp,
      trend: getTrend(chartData.map((item) => item.temp as number)),
      chartMode: "line" as const,
      status:
        latest.temperature.value < referenceRanges.temp_min || latest.temperature.value > referenceRanges.temp_max
          ? "Review"
          : "Normal",
      referenceValue: (referenceRanges.temp_min + referenceRanges.temp_max) / 2,
      valueKey: "temp",
    },
    {
      key: "respiratory-rate",
      label: "Respiratory Rate",
      value: latest.respiratoryRate.value,
      unit: "/min",
      reference: referenceRanges.labels.resp,
      trend: getTrend(chartData.map((item) => item.rr as number)),
      chartMode: "bar" as const,
      status:
        latest.respiratoryRate.value < referenceRanges.resp_min ||
        latest.respiratoryRate.value > referenceRanges.resp_max
          ? "Elevated"
          : "Normal",
      referenceValue: referenceRanges.resp_max,
      valueKey: "rr",
    },
  ];
  const supportedCards = vitalsProvenance.hasRaw
    ? cards.filter((card) =>
        vitalsProvenance.items.some((item) =>
          item.value.toLowerCase().startsWith(card.label.toLowerCase())
        )
      )
    : cards;

  return (
    <div className="space-y-8">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-section-vitals/10 text-lg">📊</div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-foreground">Vital Signs</h2>
            <SectionProvenanceBadge status={vitalsProvenance.status} />
            <StatusBadge
              status={vitals.status === "warning" ? "warning" : "normal"}
              label={vitals.status === "warning" ? "Review" : "Stable"}
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Patient discharge summary · {chartData.length > 1 ? `${chartData.length}-point trend` : "single documented reading"}
        </p>
      </div>

      <ProvenancePanel status={vitalsProvenance.status} items={vitalsProvenance.items} />

      {!hasDocumentedVitals ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600 shadow-sm">
          No source-backed vitals were documented in this prescription.
        </div>
      ) : null}

      {hasDocumentedVitals ? (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {supportedCards.map((card) => {
          const deltaLabel = getDeltaLabel(
            chartData.map((item) => item[card.valueKey as keyof typeof item] as number),
            card.trend
          );
          const badgeClass =
            card.status === "Normal"
              ? "bg-emerald-50 text-emerald-700"
              : card.status === "Elevated"
                ? "bg-amber-50 text-amber-700"
                : "bg-slate-100 text-slate-700";
          const accentColor =
            card.status === "Normal" ? "#1f9d74" : "#d97706";
          const accentFill =
            card.status === "Normal" ? "#9fdcc7" : "#fdc97b";

          return (
            <div key={card.key} className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-[0_8px_18px_rgba(15,23,42,0.035)]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {card.label}
                </div>
                <div className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
                  {card.status}
                </div>
              </div>

              <div className="mb-2 flex items-end gap-1.5">
                <div className="text-3xl font-semibold leading-none tracking-tight text-slate-900">
                  {card.value}
                </div>
                <div className="pb-0.5 text-base text-slate-300">{card.unit}</div>
              </div>

              <div className="mb-3 flex items-center gap-2 text-[11px]">
                <div className="text-slate-400">{card.reference}</div>
                {deltaLabel ? (
                  <div className={card.status === "Normal" ? "font-medium text-emerald-600" : "font-medium text-amber-600"}>
                    {deltaLabel}
                  </div>
                ) : null}
              </div>

              <div className="h-16">
                {renderTrendChart({
                  data: displayChartData,
                  dataKey: card.valueKey,
                  color: accentColor,
                  fill: accentFill,
                  mode: card.chartMode,
                  referenceValue: card.referenceValue,
                })}
              </div>
            </div>
          );
        })}
      </div>
      ) : null}

      {vitals.alerts.length > 0 ? (
        <div className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Alert Timeline</h3>
          <div className="space-y-2">
            {vitals.alerts.map((alert, index) => (
              <div key={index} className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm">
                <span className="min-w-fit text-xs font-mono text-slate-500">{alert.date}</span>
                <StatusBadge
                  status={alert.type === "warning" ? "warning" : alert.type === "info" ? "info" : "normal"}
                  label={alert.type === "warning" ? "⚠" : alert.type === "info" ? "ℹ" : "✓"}
                />
                <span className="text-slate-700">{alert.message}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default VitalsDetail;
