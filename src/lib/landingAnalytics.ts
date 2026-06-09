import { apiFetch, expectApiJson } from "@/lib/apiClient";
import { API_BASE } from "@/lib/backendConfig";

export type DocumentAnalyticsPoint = {
  documentType:
    | "prescription"
    | "discharge_summary"
    | "outpatient_record"
    | "lab_report"
    | "chart_note"
    | "voice_dictation"
    | "live_conversation"
    | "voice"
    | "unknown";
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
  const response = await apiFetch(`${API_BASE}/analytics/overview`);
  return expectApiJson<LandingAnalyticsOverview>(response, "Unable to load processing insights.");
}
