import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ProcessingInsights from "@/components/dashboard/ProcessingInsights";
import type { LandingAnalyticsOverview } from "@/lib/landingAnalytics";

vi.mock("recharts", () => ({
  BarChart: ({ data, children }: { data: unknown; children: ReactNode }) => (
    <div data-testid="bar-chart" data-chart={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Bar: ({ dataKey }: { dataKey: string }) => <div data-testid={`bar-${dataKey}`} />,
  Cell: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
  ChartLegend: () => null,
  ChartLegendContent: () => null,
}));

const analytics: LandingAnalyticsOverview = {
  documentsByType: [
    { documentType: "prescription", count: 3 },
    { documentType: "discharge_summary", count: 2 },
    { documentType: "voice_dictation", count: 2 },
    { documentType: "live_conversation", count: 1 },
    { documentType: "outpatient_record", count: 1 },
    { documentType: "lab_report", count: 0 },
    { documentType: "chart_note", count: 0 },
    { documentType: "unknown", count: 0 },
  ],
  tokensByProvider: {
    gemma: 1200,
    gemini: 340,
    total: 1540,
  },
  medicationsByDocumentType: [
    { documentType: "prescription", count: 7 },
    { documentType: "discharge_summary", count: 2 },
    { documentType: "voice_dictation", count: 3 },
    { documentType: "live_conversation", count: 2 },
    { documentType: "outpatient_record", count: 1 },
    { documentType: "lab_report", count: 0 },
    { documentType: "chart_note", count: 0 },
    { documentType: "unknown", count: 0 },
  ],
  testsByDocumentType: [
    { documentType: "prescription", lab: 5, radiology: 2, nuclearMedicine: 1, procedures: 3 },
    { documentType: "discharge_summary", lab: 0, radiology: 0, nuclearMedicine: 0, procedures: 0 },
    { documentType: "voice_dictation", lab: 0, radiology: 0, nuclearMedicine: 0, procedures: 0 },
    { documentType: "live_conversation", lab: 1, radiology: 1, nuclearMedicine: 0, procedures: 1 },
    { documentType: "outpatient_record", lab: 1, radiology: 0, nuclearMedicine: 0, procedures: 0 },
    { documentType: "lab_report", lab: 0, radiology: 0, nuclearMedicine: 0, procedures: 0 },
    { documentType: "chart_note", lab: 0, radiology: 0, nuclearMedicine: 0, procedures: 0 },
    { documentType: "unknown", lab: 0, radiology: 0, nuclearMedicine: 0, procedures: 0 },
  ],
  summary: {
    includedDocuments: 9,
    refreshedAt: "2026-05-04T08:00:00Z",
  },
};

describe("ProcessingInsights", () => {
  it("renders a loading state", () => {
    render(<ProcessingInsights analytics={null} isLoading />);

    expect(screen.getByText(/loading processing insights/i)).toBeInTheDocument();
  });

  it("renders an empty state", () => {
    render(
      <ProcessingInsights
        analytics={{
          ...analytics,
          documentsByType: analytics.documentsByType.map((entry) => ({ ...entry, count: 0 })),
          medicationsByDocumentType: analytics.medicationsByDocumentType.map((entry) => ({ ...entry, count: 0 })),
          testsByDocumentType: analytics.testsByDocumentType.map((entry) => ({
            ...entry,
            lab: 0,
            radiology: 0,
            nuclearMedicine: 0,
            procedures: 0,
          })),
          tokensByProvider: { gemma: 0, gemini: 0, total: 0 },
          summary: { includedDocuments: 0, refreshedAt: "2026-05-04T08:00:00Z" },
        }}
        isLoading={false}
      />,
    );

    expect(screen.getByText(/insights will appear after the first processed document/i)).toBeInTheDocument();
  });

  it("renders populated charts and token totals from the API payload", () => {
    render(<ProcessingInsights analytics={analytics} isLoading={false} />);

    expect(screen.getByText(/processing insights/i)).toBeInTheDocument();
    expect(screen.getByText("1,540")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show detail/i }));
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("340")).toBeInTheDocument();

    const chartPayloads = screen.getAllByTestId("bar-chart").map((chart) => chart.getAttribute("data-chart") || "");
    expect(chartPayloads.some((payload) => payload.includes("\"label\":\"Prescription\"") && payload.includes("\"count\":3"))).toBe(true);
    expect(chartPayloads.some((payload) => payload.includes("\"label\":\"Dictation\"") && payload.includes("\"count\":2"))).toBe(true);
    expect(chartPayloads.some((payload) => payload.includes("\"label\":\"Live\"") && payload.includes("\"count\":1"))).toBe(true);
    expect(chartPayloads.some((payload) => payload.includes("\"label\":\"Prescription\"") && payload.includes("\"count\":7"))).toBe(true);
    expect(
      chartPayloads.some(
        (payload) =>
          payload.includes("\"label\":\"Prescription\"") &&
          payload.includes("\"lab\":5") &&
          payload.includes("\"radiology\":2") &&
          payload.includes("\"nuclearMedicine\":1") &&
          payload.includes("\"procedures\":3"),
      ),
    ).toBe(true);
  });
});
