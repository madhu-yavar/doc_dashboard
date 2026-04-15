import { API_BASE } from "@/lib/processedDocuments";

export type AuditWorkflow = "extraction" | "chart_note" | "chat";
export type AuditRunStatus = "running" | "completed" | "failed";

export type AuditRun = {
  runId: string;
  workflow: AuditWorkflow;
  documentId?: string | null;
  chatId?: string | null;
  requestId?: string | null;
  title?: string;
  actor?: string;
  status: AuditRunStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  error?: string | null;
};

export type AuditEvent = {
  id: string;
  timestamp: string;
  runId: string;
  workflow?: AuditWorkflow;
  documentId?: string | null;
  chatId?: string | null;
  requestId?: string | null;
  type?: string;
  status?: string;
  title?: string;
  details?: Record<string, unknown>;
};

export type AuditRunDetail = {
  run: AuditRun;
  events: AuditEvent[];
};

type FetchAuditRunsOptions = {
  documentId?: string | null;
  workflow?: AuditWorkflow | "all";
  status?: AuditRunStatus | "all";
  limit?: number;
};

const withParams = (basePath: string, params: Record<string, string | number | null | undefined>) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "" || value === "all") return;
    search.set(key, String(value));
  });

  return `${basePath}${search.toString() ? `?${search.toString()}` : ""}`;
};

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || fallbackMessage);
  }

  return response.json() as Promise<T>;
}

export async function fetchAuditRuns(options: FetchAuditRunsOptions = {}): Promise<AuditRun[]> {
  const url = withParams(`${API_BASE}/audit/runs`, {
    documentId: options.documentId || undefined,
    workflow: options.workflow,
    status: options.status,
    limit: options.limit ?? 100,
  });

  const payload = await fetch(url).then((response) =>
    parseJsonResponse<{ runs?: AuditRun[] }>(response, "Unable to load audit runs.")
  );

  return Array.isArray(payload.runs) ? payload.runs : [];
}

export async function fetchAuditRunDetail(runId: string, limit = 500): Promise<AuditRunDetail> {
  const runUrl = `${API_BASE}/audit/runs/${encodeURIComponent(runId)}`;
  const eventsUrl = withParams(`${API_BASE}/audit/runs/${encodeURIComponent(runId)}/events`, { limit });

  const [runPayload, eventsPayload] = await Promise.all([
    fetch(runUrl).then((response) => parseJsonResponse<{ run?: AuditRun }>(response, "Unable to load audit run.")),
    fetch(eventsUrl).then((response) =>
      parseJsonResponse<{ events?: AuditEvent[] }>(response, "Unable to load audit run events.")
    ),
  ]);

  if (!runPayload.run) {
    throw new Error("Audit run not found.");
  }

  return {
    run: runPayload.run,
    events: Array.isArray(eventsPayload.events) ? eventsPayload.events : [],
  };
}
