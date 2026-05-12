import { apiFetch } from "@/lib/apiClient";

const normalizeApiRoot = (value: string) => value.replace(/\/$/, "");

const API_ROOT = normalizeApiRoot(import.meta.env.VITE_API_URL || "");
export const ANALYTICS_API_BASE = `${API_ROOT}/api`;

export type DocumentAnalyticsPoint = {
  documentType: "prescription" | "discharge_summary" | "outpatient_record" | "lab_report" | "chart_note" | "unknown";
  count: number;
};

export type TestAnalyticsPoint = {
  documentType: DocumentAnalyticsPoint["documentType"];
  lab: number;
  radiology: number;
  nuclearMedicine: number;
  procedures: number;
};

export type LandingAnalyticsOverview = {
  documentsByType: DocumentAnalyticsPoint[];
  tokensByProvider: {
    gemma: number;
    gemini: number;
    total: number;
  };
  medicationsByDocumentType: DocumentAnalyticsPoint[];
  testsByDocumentType: TestAnalyticsPoint[];
  summary: {
    includedDocuments: number;
    refreshedAt: string;
  };
};

export async function fetchLandingAnalyticsOverview() {
  const response = await apiFetch(`${ANALYTICS_API_BASE}/analytics/overview`);
  if (!response.ok) {
    throw new Error("Unable to load processing insights.");
  }
  return response.json() as Promise<LandingAnalyticsOverview>;
}
