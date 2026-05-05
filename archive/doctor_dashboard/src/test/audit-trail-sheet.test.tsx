import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AuditTrailSheet from "@/components/dashboard/AuditTrailSheet";

describe("AuditTrailSheet", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads run history and shows failure drill-down for a failed run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes("/api/audit/runs/doc-run-1")) {
          return new Response(
            JSON.stringify({
              run: {
                runId: "doc-run-1",
                workflow: "extraction",
                status: "failed",
                title: "Custom inpatient record",
                startedAt: "2026-04-13T10:00:00.000Z",
                durationMs: 128000,
                actor: "system",
                error: "Model service unavailable.",
                summary: {
                  stepsCompleted: 4,
                  escalationRequired: false,
                },
                metadata: {
                  mode: "batch",
                  department: "Inpatient nursing / medical",
                },
              },
              events: [
                {
                  id: "event-1",
                  runId: "doc-run-1",
                  type: "run_started",
                  status: "info",
                  title: "Run started",
                  timestamp: "2026-04-13T10:00:00.000Z",
                  details: {
                    actor: "system",
                  },
                },
                {
                  id: "event-2",
                  runId: "doc-run-1",
                  type: "agent_progress",
                  status: "error",
                  title: "clinical_data_extractor",
                  timestamp: "2026-04-13T10:01:00.000Z",
                  details: {
                    step: "clinical_data_extractor",
                    status: "error",
                    error: "Request timeout after 180000ms",
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url.includes("/api/audit/runs")) {
          return new Response(
            JSON.stringify({
              runs: [
                {
                  runId: "doc-run-1",
                  workflow: "extraction",
                  status: "failed",
                  title: "Custom inpatient record",
                  startedAt: "2026-04-13T10:00:00.000Z",
                  durationMs: 128000,
                  actor: "system",
                  error: "Model service unavailable.",
                },
                {
                  runId: "chat-run-1",
                  workflow: "chat",
                  status: "completed",
                  title: "Drug safety question",
                  startedAt: "2026-04-13T11:00:00.000Z",
                  durationMs: 4200,
                  actor: "user",
                },
              ],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ error: "Unhandled request" }), { status: 500 });
      }),
    );

    render(
      <AuditTrailSheet
        documentId="doc-1"
        processedDocument={{
          id: "doc-1",
          name: "Custom inpatient record.pdf",
          size: 1024,
          uploadedAt: "2026-04-13T09:59:00.000Z",
          status: "processed",
          department: "Inpatient nursing / medical",
          agentInfo: {
            name: "Discharge Summary Extractor",
            version: "2.0.0",
            latency: 128000,
            tokensUsed: 2000,
            auditRunId: "doc-run-1",
            steps: [],
            validation: {
              confidence_level: "medium",
              inconsistencies_found: [],
              missing_critical_fields: [],
            },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /audit trail/i }));

    expect(await screen.findByText("Custom inpatient record")).toBeInTheDocument();
    expect(await screen.findByText("Failure drill-down")).toBeInTheDocument();
    expect((await screen.findAllByText("Model service unavailable.")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Request timeout after 180000ms")).length).toBeGreaterThan(0);
  });
});
