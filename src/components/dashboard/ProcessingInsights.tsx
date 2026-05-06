import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { Activity, FileBarChart2, FlaskConical, Pill } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { LandingAnalyticsOverview } from "@/lib/landingAnalytics";

type ProcessingInsightsProps = {
  analytics: LandingAnalyticsOverview | null;
  isLoading: boolean;
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  prescription: "Prescription",
  discharge_summary: "Inpatient",
  inpatient_record: "Inpatient",
  outpatient_record: "Outpatient",
  lab_report: "Lab report",
  chart_note: "Chart note",
  unknown: "Unknown",
};

const formatDocumentType = (value: string) => DOCUMENT_TYPE_LABELS[value] || value;
const formatNumber = (value: number) => value.toLocaleString("en-US");

export default function ProcessingInsights({ analytics, isLoading }: ProcessingInsightsProps) {
  const includedDocuments = analytics?.summary.includedDocuments || 0;
  const hasData = Boolean(analytics && includedDocuments > 0);
  const documentsByType = analytics?.documentsByType.map((item) => ({
    ...item,
    label: formatDocumentType(item.documentType),
  })) || [];
  const medicationsByType = analytics?.medicationsByDocumentType.map((item) => ({
    ...item,
    label: formatDocumentType(item.documentType),
  })) || [];
  const testsByType = analytics?.testsByDocumentType.map((item) => ({
    ...item,
    label: formatDocumentType(item.documentType),
  })) || [];
  const tokenSplit = analytics ? [
    {
      name: "Tokens",
      gemma: analytics.tokensByProvider.gemma,
      gemini: analytics.tokensByProvider.gemini,
    },
  ] : [];
  const refreshedAt = analytics?.summary.refreshedAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(analytics.summary.refreshedAt))
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-lg">Processing Insights</CardTitle>
          </div>
          <div className="text-xs text-muted-foreground">
            {hasData && refreshedAt ? `${includedDocuments} processed docs · updated ${refreshedAt}` : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            Loading processing insights...
          </div>
        ) : !hasData ? (
          <div className="rounded-lg border border-dashed px-4 py-10 text-center">
            <p className="font-medium text-slate-900">Insights will appear after the first processed document.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <InsightCard
              title="Documents by Class"
              description="Processed documents grouped by router class"
              icon={<FileBarChart2 className="h-4 w-4" />}
            >
              <ChartContainer
                className="h-[150px] w-full"
                config={{ count: { label: "Documents", color: "#0f766e" } }}
              >
                <BarChart data={documentsByType} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tickMargin={8} fontSize={11} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={24} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[5, 5, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ChartContainer>
            </InsightCard>

            <InsightCard
              title="Tokens by Provider"
              description="Lifetime token usage split between internal and external language models"
              icon={<Activity className="h-4 w-4" />}
            >
              <div className="grid gap-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <TokenStat label="Total" value={analytics.tokensByProvider.total} accent="text-slate-900" />
                  <TokenStat label="Internal LLM" value={analytics.tokensByProvider.gemma} accent="text-teal-700" />
                  <TokenStat label="External LLM" value={analytics.tokensByProvider.gemini} accent="text-amber-700" />
                </div>
                <ChartContainer
                  className="h-[72px] w-full"
                  config={{
                    gemma: { label: "Internal LLM", color: "#0f766e" },
                    gemini: { label: "External LLM", color: "#d97706" },
                  }}
                >
                  <BarChart data={tokenSplit} layout="vertical" margin={{ top: 2, right: 4, left: 4, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" hide />
                    <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                    <ChartLegend content={<ChartLegendContent className="pt-2 text-[11px]" />} />
                    <Bar dataKey="gemma" stackId="tokens" fill="var(--color-gemma)" radius={[6, 0, 0, 6]} />
                    <Bar dataKey="gemini" stackId="tokens" fill="var(--color-gemini)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            </InsightCard>

            <InsightCard
              title="Medicines by Document Type"
              description="Extracted medication totals grouped by document type"
              icon={<Pill className="h-4 w-4" />}
            >
              <ChartContainer
                className="h-[150px] w-full"
                config={{ count: { label: "Medicines", color: "#2563eb" } }}
              >
                <BarChart data={medicationsByType} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tickMargin={8} fontSize={11} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={24} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[5, 5, 0, 0]} maxBarSize={26}>
                    {medicationsByType.map((entry) => (
                      <Cell
                        key={entry.documentType}
                        fill={entry.count > 0 ? "var(--color-count)" : "#cbd5e1"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </InsightCard>

            <InsightCard
              title="Prescribed Tests by Document Type"
              description="Lab, radiology, procedure, and nuclear medicine order counts"
              icon={<FlaskConical className="h-4 w-4" />}
            >
              <ChartContainer
                className="h-[170px] w-full"
                config={{
                  lab: { label: "Lab", color: "#0f766e" },
                  radiology: { label: "Radiology", color: "#2563eb" },
                  procedures: { label: "Procedure", color: "#7c3aed" },
                  nuclearMedicine: { label: "Nuclear medicine", color: "#d97706" },
                }}
              >
                <BarChart data={testsByType} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tickMargin={8} fontSize={11} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={24} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent className="pt-2 text-[11px]" />} />
                  <Bar dataKey="lab" fill="var(--color-lab)" radius={[4, 4, 0, 0]} maxBarSize={16} />
                  <Bar dataKey="radiology" fill="var(--color-radiology)" radius={[4, 4, 0, 0]} maxBarSize={16} />
                  <Bar dataKey="procedures" fill="var(--color-procedures)" radius={[4, 4, 0, 0]} maxBarSize={16} />
                  <Bar dataKey="nuclearMedicine" fill="var(--color-nuclearMedicine)" radius={[4, 4, 0, 0]} maxBarSize={16} />
                </BarChart>
              </ChartContainer>
            </InsightCard>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InsightCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-slate-50/70 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-[11px] leading-4 text-slate-600">{description}</p>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-600 shadow-sm">
          {icon}
        </div>
      </div>
      {children}
    </div>
  );
}

function TokenStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-lg border bg-white px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-1.5 text-xl font-semibold ${accent}`}>{formatNumber(value)}</p>
    </div>
  );
}
