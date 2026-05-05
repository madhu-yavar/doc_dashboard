import { type ReactElement, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  ClipboardList,
  Clock3,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldAlert,
  Stethoscope,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  fetchAuditRunDetail,
  fetchAuditRuns,
  type AuditEvent,
  type AuditRun,
  type AuditRunStatus,
  type AuditWorkflow,
} from "@/lib/auditTrail";
import type { ProcessedDocument } from "@/lib/processedDocuments";

type AuditTrailSheetProps = {
  documentId?: string | null;
  processedDocument?: ProcessedDocument | null;
  trigger?: ReactElement;
};

const WORKFLOW_OPTIONS: Array<{ value: AuditWorkflow | "all"; label: string }> = [
  { value: "all", label: "All workflows" },
  { value: "extraction", label: "Extraction" },
  { value: "chart_note", label: "Chart note" },
  { value: "chat", label: "Chat" },
];

const STATUS_OPTIONS: Array<{ value: AuditRunStatus | "all"; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

const WORKFLOW_META: Record<
  AuditWorkflow,
  {
    label: string;
    icon: typeof Stethoscope;
    badgeClass: string;
  }
> = {
  extraction: {
    label: "Extraction",
    icon: Stethoscope,
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  chart_note: {
    label: "Chart Note",
    icon: ClipboardList,
    badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
  },
  chat: {
    label: "Chat",
    icon: MessageSquareText,
    badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
  },
};

const STATUS_META: Record<
  AuditRunStatus,
  {
    label: string;
    badgeClass: string;
  }
> = {
  running: {
    label: "Running",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
  },
  completed: {
    label: "Completed",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  failed: {
    label: "Failed",
    badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatDuration = (value?: number | null) => {
  if (!value || value < 0) return "Pending";
  if (value < 1000) return `${value}ms`;

  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
};

const formatDetailValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => formatDetailValue(item)).join(", ") : "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
};

const humanizeKey = (value: string) =>
  value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const isNonEmptyObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;

const getEventTone = (event: AuditEvent) => {
  if (event.status === "error") return "border-rose-300 bg-rose-50";
  if (event.status === "warning" || event.status === "blocked") return "border-amber-300 bg-amber-50";
  if (event.status === "success") return "border-emerald-300 bg-emerald-50";
  return "border-slate-200 bg-white";
};

const summarizeEvent = (event: AuditEvent) => {
  const details = event.details || {};

  if (typeof details.error === "string" && details.error.trim()) return details.error;
  if (typeof details.summary === "string" && details.summary.trim()) return details.summary;
  if (typeof details.message === "string" && details.message.trim()) return details.message;
  if (typeof details.step === "string" && typeof details.status === "string") {
    return `${humanizeKey(details.step)} · ${details.status}`;
  }
  if (typeof details.name === "string" && details.name.trim()) return details.name;
  if (typeof details.provider === "string" && details.provider.trim()) return `Provider: ${details.provider}`;

  return "No additional detail";
};

const linkedRunEntries = (processedDocument?: ProcessedDocument | null) => {
  const entries: Array<{ label: string; runId: string }> = [];

  if (processedDocument?.agentInfo?.auditRunId) {
    entries.push({ label: "Current extraction", runId: processedDocument.agentInfo.auditRunId });
  }

  if (processedDocument?.chartNote?.auditRunId) {
    entries.push({ label: "Current chart note", runId: processedDocument.chartNote.auditRunId });
  }

  return entries;
};

const DetailGrid = ({ data }: { data?: Record<string, unknown> | null }) => {
  if (!isNonEmptyObject(data)) {
    return <p className="text-sm text-slate-500">No structured details available.</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{humanizeKey(key)}</div>
          <div className="mt-1 break-words whitespace-pre-wrap text-sm text-slate-800">{formatDetailValue(value)}</div>
        </div>
      ))}
    </div>
  );
};

const SummaryStat = ({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "warning" | "danger";
}) => {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className={cn("rounded-full border px-3 py-1.5 text-sm", toneClass)}>
      <span className="font-semibold text-slate-900">{value}</span> {label}
    </div>
  );
};

const AuditTrailSheet = ({ documentId, processedDocument, trigger }: AuditTrailSheetProps) => {
  const [open, setOpen] = useState(false);
  const [workflowFilter, setWorkflowFilter] = useState<AuditWorkflow | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AuditRunStatus | "all">("all");
  const [searchValue, setSearchValue] = useState("");
  const [runs, setRuns] = useState<AuditRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ run: AuditRun; events: AuditEvent[] } | null>(null);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const linkedRuns = useMemo(() => linkedRunEntries(processedDocument), [processedDocument]);

  useEffect(() => {
    if (!open || !documentId) return;

    let cancelled = false;
    setIsLoadingRuns(true);
    setRunsError(null);

    fetchAuditRuns({
      documentId,
      workflow: workflowFilter,
      status: statusFilter,
      limit: 150,
    })
      .then((payload) => {
        if (cancelled) return;
        setRuns(payload);
      })
      .catch((error) => {
        if (cancelled) return;
        setRuns([]);
        setRunsError(error instanceof Error ? error.message : "Unable to load audit runs.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingRuns(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, documentId, workflowFilter, statusFilter, refreshNonce]);

  const filteredRuns = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return runs;

    return runs.filter((run) => {
      const haystack = [run.title, run.requestId, run.runId, run.error, run.actor, run.workflow]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [runs, searchValue]);

  useEffect(() => {
    if (!filteredRuns.length) {
      setSelectedRunId(null);
      setDetail(null);
      return;
    }

    if (!selectedRunId || !filteredRuns.some((run) => run.runId === selectedRunId)) {
      setSelectedRunId(filteredRuns[0].runId);
    }
  }, [filteredRuns, selectedRunId]);

  useEffect(() => {
    if (!open || !selectedRunId) return;

    let cancelled = false;
    setIsLoadingDetail(true);
    setDetailError(null);

    fetchAuditRunDetail(selectedRunId)
      .then((payload) => {
        if (cancelled) return;
        setDetail(payload);
      })
      .catch((error) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(error instanceof Error ? error.message : "Unable to load audit run detail.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingDetail(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedRunId]);

  const selectedRun = detail?.run || filteredRuns.find((run) => run.runId === selectedRunId) || null;
  const failureEvents = useMemo(
    () => (detail?.events || []).filter((event) => event.status === "error" || event.status === "warning" || event.status === "blocked"),
    [detail?.events],
  );
  const stats = useMemo(() => {
    const failed = runs.filter((run) => run.status === "failed").length;
    const completed = runs.filter((run) => run.status === "completed").length;
    const running = runs.filter((run) => run.status === "running").length;
    return { total: runs.length, failed, completed, running };
  }, [runs]);

  const currentSummary = selectedRun?.summary && isNonEmptyObject(selectedRun.summary) ? selectedRun.summary : null;
  const currentMetadata = selectedRun?.metadata && isNonEmptyObject(selectedRun.metadata) ? selectedRun.metadata : null;
  const workflowMeta = selectedRun ? WORKFLOW_META[selectedRun.workflow] : null;
  const statusMeta = selectedRun ? STATUS_META[selectedRun.status] : null;
  const hasRunRail = filteredRuns.length > 1;
  const SelectedWorkflowIcon = workflowMeta?.icon || Stethoscope;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ? (
          trigger
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="rounded-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            disabled={!documentId}
          >
            <ClipboardList className="mr-2 h-4 w-4" />
            Audit Trail
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-hidden border-l border-slate-200 bg-[#f5f7fb] p-0 sm:max-w-[min(94vw,1160px)]">
        <div className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b border-slate-200 bg-white px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SheetTitle className="text-[28px] font-semibold tracking-tight text-slate-900">Audit Trail</SheetTitle>
                <SheetDescription className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                  Review extraction, chart note, and chat runs for this document with a durable event timeline and failure trace.
                </SheetDescription>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-full border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                onClick={() => setRefreshNonce((value) => value + 1)}
                disabled={isLoadingRuns}
              >
                <RefreshCw className={cn("h-4 w-4", isLoadingRuns && "animate-spin")} />
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <SummaryStat label="runs" value={stats.total} />
              <SummaryStat label="completed" value={stats.completed} tone="success" />
              <SummaryStat label="running" value={stats.running} tone="warning" />
              <SummaryStat label="failed" value={stats.failed} tone="danger" />
            </div>

            {linkedRuns.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {linkedRuns.map((entry) => (
                  <button
                    key={entry.runId}
                    type="button"
                    onClick={() => {
                      setSelectedRunId(entry.runId);
                    }}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-white"
                  >
                    {entry.label}: <span className="font-mono text-slate-900">{entry.runId}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </SheetHeader>

          <div className="border-b border-slate-200 bg-white px-6 py-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_170px_170px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder="Search title, run id, request id, or error"
                  className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-10"
                />
              </div>
              <Select value={workflowFilter} onValueChange={(value) => setWorkflowFilter(value as AuditWorkflow | "all")}>
                <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-slate-50">
                  <SelectValue placeholder="Workflow" />
                </SelectTrigger>
                <SelectContent>
                  {WORKFLOW_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as AuditRunStatus | "all")}>
                <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-slate-50">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className={cn("grid min-h-0 flex-1", hasRunRail && "xl:grid-cols-[300px_minmax(0,1fr)]")}>
            {hasRunRail ? (
            <div className="min-h-0 border-b border-slate-200 bg-white xl:border-b-0 xl:border-r">
              <ScrollArea className="h-full">
                <div className="space-y-2 p-4">
                  {isLoadingRuns ? (
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading audit runs...
                    </div>
                  ) : runsError ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {runsError}
                    </div>
                  ) : filteredRuns.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                      No audit runs matched the current filters.
                    </div>
                  ) : (
                    filteredRuns.map((run) => {
                      const selected = run.runId === selectedRunId;
                      const workflow = WORKFLOW_META[run.workflow];
                      const status = STATUS_META[run.status];
                      const WorkflowIcon = workflow.icon;

                      return (
                        <button
                          key={run.runId}
                          type="button"
                          onClick={() => setSelectedRunId(run.runId)}
                          className={cn(
                            "w-full rounded-2xl border p-3.5 text-left transition-all",
                            selected
                              ? "border-slate-900 bg-slate-900 text-white shadow-[0_12px_30px_rgba(15,23,42,0.10)]"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className={cn(
                                "mt-0.5 rounded-xl p-2",
                                selected ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700",
                              )}>
                                <WorkflowIcon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <p className={cn("break-words text-sm font-semibold leading-5", selected ? "text-white" : "text-slate-900")}>
                                  {run.title || `${workflow.label} run`}
                                </p>
                                <p className={cn("mt-1 text-xs", selected ? "text-slate-300" : "text-slate-500")}>
                                  {formatDateTime(run.startedAt)}
                                </p>
                                <p className={cn("mt-1 break-all font-mono text-[11px]", selected ? "text-slate-400" : "text-slate-400")}>
                                  {run.runId}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                            <Badge className={cn(selected ? "border-white/20 bg-white/10 text-white" : workflow.badgeClass)} variant="outline">
                              {workflow.label}
                            </Badge>
                            <Badge className={cn("shrink-0", selected ? "border-white/20 bg-white/10 text-white" : status.badgeClass)} variant="outline">
                              {status.label}
                            </Badge>
                            <span className={cn("font-medium", selected ? "text-slate-300" : "text-slate-500")}>
                              {formatDuration(run.durationMs)}
                            </span>
                          </div>

                          {run.error ? (
                            <div className={cn(
                              "mt-3 rounded-xl border px-3 py-2 text-xs leading-5",
                              selected
                                ? "border-white/10 bg-white/10 text-white"
                                : "border-rose-200 bg-rose-50 text-rose-700",
                            )}>
                              {run.error}
                            </div>
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
            ) : null}

            <div className="min-h-0 bg-[#f5f7fb]">
              <ScrollArea className="h-full">
                <div className="p-4 md:p-5">
                  {!selectedRun ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
                      Select an audit run to inspect its timeline and failure trail.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                        <div className="space-y-5">
                          <div className="min-w-0 rounded-2xl bg-slate-950 px-4 py-4 text-white shadow-[0_14px_30px_rgba(15,23,42,0.14)]">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0">
                                <div className="flex items-start gap-3">
                                  <div className="rounded-xl bg-white/10 p-2 text-white">
                                    <SelectedWorkflowIcon className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {workflowMeta ? (
                                        <Badge className="border-white/15 bg-emerald-400/10 text-emerald-200" variant="outline">
                                          {workflowMeta.label}
                                        </Badge>
                                      ) : null}
                                      {statusMeta ? (
                                        <Badge className="border-white/15 bg-white/8 text-slate-100" variant="outline">
                                          {statusMeta.label}
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <h3 className="mt-2 break-words text-[22px] font-semibold leading-[1.15] tracking-tight text-white md:text-[24px]">
                                      {selectedRun.title || `${workflowMeta?.label || "Audit"} run`}
                                    </h3>
                                    <p className="mt-2 text-sm text-slate-300">{formatDateTime(selectedRun.startedAt)}</p>
                                  </div>
                                </div>
                              </div>

                              <div className="grid gap-2 text-sm sm:grid-cols-3 lg:min-w-[260px]">
                                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Duration</div>
                                  <div className="mt-1 text-sm font-medium text-white">{formatDuration(selectedRun.durationMs)}</div>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Actor</div>
                                  <div className="mt-1 text-sm font-medium capitalize text-white">{selectedRun.actor || "system"}</div>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Events</div>
                                  <div className="mt-1 text-sm font-medium text-white">{detail?.events.length ?? "—"}</div>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="min-w-0">
                            <div className="space-y-2 text-sm text-slate-500">
                              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Run ID</div>
                                <div className="mt-1 break-all font-mono text-[13px] text-slate-700">{selectedRun.runId}</div>
                              </div>
                              {selectedRun.requestId ? (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Request ID</div>
                                  <div className="mt-1 break-all font-mono text-[13px] text-slate-700">{selectedRun.requestId}</div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {selectedRun.status === "failed" || selectedRun.error ? (
                          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-rose-900">
                              <ShieldAlert className="h-4 w-4" />
                              Failure drill-down
                            </div>
                            <p className="mt-2 text-sm text-rose-700">
                              {selectedRun.error || "This run was marked failed. Inspect warning and error events below for the failure chain."}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {isLoadingDetail ? (
                        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading run detail...
                        </div>
                      ) : detailError ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {detailError}
                        </div>
                      ) : (
                        <Tabs defaultValue="timeline" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                          <TabsList className="grid h-auto grid-cols-3 rounded-xl bg-slate-100 p-1">
                            <TabsTrigger value="timeline" className="rounded-lg">
                              Timeline
                            </TabsTrigger>
                            <TabsTrigger value="summary" className="rounded-lg">
                              Summary
                            </TabsTrigger>
                            <TabsTrigger value="failure" className="rounded-lg">
                              Failure
                            </TabsTrigger>
                          </TabsList>

                          <TabsContent value="timeline" className="mt-4">
                            {detail?.events?.length ? (
                              <div className="space-y-3">
                                {detail.events.map((event) => (
                                  <div key={event.id} className={cn("rounded-xl border p-4", getEventTone(event))}>
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                      <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge variant="outline" className="border-slate-300 bg-white text-slate-700">
                                            {event.type || "event"}
                                          </Badge>
                                          {event.status ? (
                                            <Badge
                                              variant="outline"
                                              className={cn(
                                                event.status === "error"
                                                  ? "border-rose-300 bg-rose-100 text-rose-700"
                                                  : event.status === "warning" || event.status === "blocked"
                                                    ? "border-amber-300 bg-amber-100 text-amber-700"
                                                    : event.status === "success"
                                                      ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                                                      : "border-slate-300 bg-white text-slate-700",
                                              )}
                                            >
                                              {humanizeKey(event.status)}
                                            </Badge>
                                          ) : null}
                                        </div>
                                        <h4 className="mt-3 text-base font-semibold text-slate-900">{event.title || humanizeKey(event.type || "event")}</h4>
                                        <p className="mt-1 text-sm text-slate-600">{summarizeEvent(event)}</p>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                                        <Clock3 className="h-3.5 w-3.5" />
                                        {formatDateTime(event.timestamp)}
                                      </div>
                                    </div>

                                    {isNonEmptyObject(event.details) ? (
                                      <div className="mt-4">
                                        <DetailGrid data={event.details} />
                                      </div>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                                No timeline events were recorded for this run.
                              </div>
                            )}
                          </TabsContent>

                          <TabsContent value="summary" className="mt-4 space-y-4">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                <Bot className="h-4 w-4" />
                                Run summary
                              </div>
                              <div className="mt-4">
                                <DetailGrid data={currentSummary} />
                              </div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                <ClipboardList className="h-4 w-4" />
                                Run metadata
                              </div>
                              <div className="mt-4">
                                <DetailGrid data={currentMetadata} />
                              </div>
                            </div>
                          </TabsContent>

                          <TabsContent value="failure" className="mt-4">
                            {selectedRun.status === "failed" || selectedRun.error || failureEvents.length > 0 ? (
                              <div className="space-y-4">
                                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                                  <div className="flex items-center gap-2 text-sm font-semibold text-rose-900">
                                    <AlertCircle className="h-4 w-4" />
                                    Failure summary
                                  </div>
                                  <p className="mt-2 whitespace-pre-wrap text-sm text-rose-700">
                                    {selectedRun.error || "This run contains warning or error events. Review the event drill-down below."}
                                  </p>
                                </div>

                                {failureEvents.length ? (
                                  failureEvents.map((event) => (
                                    <div key={event.id} className={cn("rounded-xl border p-4", getEventTone(event))}>
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <h4 className="text-sm font-semibold text-slate-900">{event.title || humanizeKey(event.type || "event")}</h4>
                                          <p className="mt-1 text-sm text-slate-600">{summarizeEvent(event)}</p>
                                        </div>
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            event.status === "error"
                                              ? "border-rose-300 bg-rose-100 text-rose-700"
                                              : "border-amber-300 bg-amber-100 text-amber-700",
                                          )}
                                        >
                                          {humanizeKey(event.status || "warning")}
                                        </Badge>
                                      </div>
                                      {isNonEmptyObject(event.details) ? (
                                        <div className="mt-4">
                                          <DetailGrid data={event.details} />
                                        </div>
                                      ) : null}
                                    </div>
                                  ))
                                ) : (
                                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                                    No warning or error events were recorded for this run.
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-sm text-emerald-700">
                                This run completed cleanly with no failure trail.
                              </div>
                            )}
                          </TabsContent>
                        </Tabs>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default AuditTrailSheet;
