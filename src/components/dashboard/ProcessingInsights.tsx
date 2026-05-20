import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { Activity, ChevronDown, FileBarChart2, FlaskConical, Pill } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  voice: "Voice",
  unknown: "Unknown",
};

const formatDocumentType = (value: string) => DOCUMENT_TYPE_LABELS[value] || value;
const formatNumber = (value: number) => value.toLocaleString("en-US");

export default function ProcessingInsights({ analytics, isLoading }: ProcessingInsightsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
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
  const totalTokens = analytics?.tokensByProvider.total || 0;
  const totalMedications = medicationsByType.reduce((sum, item) => sum + item.count, 0);
  const totalOrderedTests = testsByType.reduce(
    (sum, item) => sum + item.lab + item.radiology + item.procedures + item.nuclearMedicine,
    0,
  );

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200/80 pb-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
                Operations Analytics
              </p>
              <CardTitle className="text-base text-slate-900">Processing Insights</CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hasData ? <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">{includedDocuments} processed</Badge> : null}
              {hasData ? <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">{formatNumber(totalTokens)} tokens</Badge> : null}
              {hasData && refreshedAt ? (
                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                  Updated {refreshedAt}
                </Badge>
              ) : null}
              <CollapsibleTrigger asChild>
                <Button size="sm" className="gap-2 border-teal-600 bg-teal-600 text-white hover:border-teal-700 hover:bg-teal-700">
                  {isExpanded ? "Hide detail" : "Show detail"}
                  <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          {isLoading ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
              Loading processing insights...
            </div>
          ) : !hasData ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center">
              <p className="font-medium text-slate-900">Insights will appear after the first processed document.</p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <TokenStat label="Processed records" value={includedDocuments} accent="text-slate-900" />
                <TokenStat label="Total tokens" value={totalTokens} accent="text-slate-900" />
                <TokenStat label="Medicines extracted" value={totalMedications} accent="text-sky-700" />
                <TokenStat label="Orders extracted" value={totalOrderedTests} accent="text-teal-700" />
              </div>

              <CollapsibleContent className="space-y-4">
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
              </CollapsibleContent>
            </>
          )}
        </CardContent>
      </Card>
    </Collapsible>
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
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-[11px] leading-4 text-slate-600">{description}</p>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600">
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
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-1.5 text-xl font-semibold ${accent}`}>{formatNumber(value)}</p>
    </div>
  );
}
