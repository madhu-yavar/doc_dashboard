import { normalizeRiskEntry, normalizeRiskLevel } from "@/lib/riskNormalization";
import type { DashboardPatientData } from "@/data/patientData";
import { API_BASE, BACKEND_ORIGIN } from "@/lib/backendConfig";
export { API_BASE } from "@/lib/backendConfig";

// Extend DashboardPatientData to include card activation and masked image info
declare module "@/data/patientData" {
  export interface DashboardPatientData {
    cardActivation?: {
      documentType?: string;
      activeCards?: string[];
      inactiveCards?: string[];
      hiddenCards?: string[];
      states?: Record<string, CardActivationState>;
    };
    // Masked image for privacy verification
    maskedImageUrl?: string;
    maskedImagePath?: string;
    maskedImagePages?: Array<{
      pageNumber: number;
      imageUrl: string;
      imagePath?: string | null;
      imageRole: "masked" | "original";
      sentToExternal: boolean;
    }>;
    // Pharmacy alert information
    pharmacyAlert?: {
      sent?: boolean;
      email_sent?: boolean;
      whatsapp_sent?: boolean;
      skipped?: boolean;
      skip_reason?: string | null;
      medications_count?: number;
    } | null;
    // Department alerts information (Lab, Radiology, Nuclear Medicine, Procedures)
    departmentAlerts?: {
      sent?: boolean;
      skipped?: boolean;
      skip_reason?: string | null;
      error?: string | null;
      departments?: {
        lab?: { sent?: boolean; itemCount?: number };
        radiology?: { sent?: boolean; itemCount?: number };
        nuclear_medicine?: { sent?: boolean; itemCount?: number };
        procedures?: { sent?: boolean; itemCount?: number };
      };
    } | null;
  }
}

export const VOICE_DASHBOARD_INCOMPLETE_ERROR = "Voice extraction completed but dashboard payload was incomplete.";

const resolveMaskedImageUrl = (
  maskedImageUrl?: string | null,
  maskedImagePath?: string | null
) => {
  const normalizeUrl = (value?: string | null) => {
    if (!value) return null;
    if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
    if (value.startsWith("/")) return `${BACKEND_ORIGIN}${value}`;
    return `${BACKEND_ORIGIN}/storage/masked_images/${value.split("/").pop()}`;
  };

  return normalizeUrl(maskedImageUrl) || normalizeUrl(maskedImagePath);
};

const resolveMaskedImagePages = (
  pages?: Array<{
    page_number?: number;
    image_url?: string | null;
    image_path?: string | null;
    image_role?: "masked" | "original";
    sent_to_external?: boolean;
  }> | null
) => {
  if (!Array.isArray(pages)) return [];

  return pages
    .map((page) => {
      const imageUrl = resolveMaskedImageUrl(page.image_url, page.image_path);
      if (!imageUrl) return null;

      return {
        pageNumber: typeof page.page_number === "number" ? page.page_number : 0,
        imageUrl,
        imagePath: page.image_path || null,
        imageRole: page.image_role === "original" ? "original" : "masked",
        sentToExternal: page.sent_to_external !== false,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.pageNumber - b.pageNumber) as Array<{
      pageNumber: number;
      imageUrl: string;
      imagePath?: string | null;
      imageRole: "masked" | "original";
      sentToExternal: boolean;
    }>;
};

export type QueueStatus = "queued" | "queued_for_extraction" | "processing" | "processed" | "failed" | "partial" | "transcribing" | "review_required";

export type GemmaDashboardResult = {
  meta?: {
    pdf_file?: string;
    report_complexity?: string;
    estimated_pages?: number;
    department_type?: string;
    document_type?: string;
    extraction_focus?: string;
    router?: {
      detected_type?: string;
      router_version?: string;
      confidence?: string;
      filename_used?: string;
    };
    drg?: string;
  };
  extracted_data?: {
    patient?: {
      name?: string;
      mrn?: string;
      age?: number;
      gender?: string;
      admission_date?: string;
      discharge_date?: string;
    };
    diagnosis?: {
      principal?: string;
      icd_code?: string;
      secondary?: string[];
      comorbidities?: string[];
      symptoms?: string[];
      drg?: string;
    };
    risk_scores?: {
      fall_risk?: { score?: number; level?: string | null };
      dvt_risk?: { score?: number; level?: string | null };
      pressure_ulcer_risk?: { score?: number; level?: string | null };
      aspiration_risk?: { score?: number; level?: string | null };
      ews_score?: number | null;
      gcs?: { total?: number | null };
    };
    functional_status?: {
      overall_assistance_needs?: string;
      mobility_notes?: string;
    };
    medications?: Array<{ name?: string; dose?: string; frequency?: string }>;
    allergies?: Array<string | { name?: string; status?: string; severity?: string; reaction?: string }>;
    investigations?: Array<string | { test_name?: string; finding?: string; test?: string; value?: string }>;
    treatment?: {
      current_approach?: string;
      management_items?: string[];
      procedures?: string[];
      response?: string;
      complications?: string[];
    };
    review_of_systems?: {
      positives?: string[];
      negatives?: string[];
    };
    physical_exam?: {
      normal_findings?: string[];
      abnormal_findings?: string[];
    };
    nursing_needs?: string[];
    clinical_notes?: Array<{
      type?: string;
      author?: string;
      date?: string;
      summary?: string;
      situation?: string;
      background?: string;
      assessment?: string;
      recommendations?: string;
      pending_items?: string[];
      risk_flags?: string[];
      handed_over_by?: string;
      handed_over_to?: string;
      source_excerpt?: string[];
    }>;
    pending_items?: {
      pending_labs?: Array<{
        test_name?: string;
        expected_date?: string;
        reason?: string;
        priority?: "high" | "medium" | "low";
        source_section?: string;
        source_excerpt?: string;
      }>;
      pending_radiology?: Array<{
        type?: string;
        body_part?: string;
        scheduled_date?: string;
        reason?: string;
        priority?: "high" | "medium" | "low";
        source_section?: string;
        source_excerpt?: string;
      }>;
      pending_followups?: Array<{
        department?: string;
        provider?: string;
        date?: string;
        time?: string;
        purpose?: string;
        priority?: "high" | "medium" | "low";
        source_section?: string;
        source_excerpt?: string;
      }>;
      medication_reconciliation?: {
        status?: "complete" | "attention_needed";
        medication_count?: number;
        allergy_count?: number;
        concerns?: string;
        source_section?: string;
        source_excerpt?: string;
      };
      pending_discharge_items?: Array<{
        item?: string;
        reason?: string;
        priority?: "high" | "medium" | "low";
        source_section?: string;
        source_excerpt?: string;
      }>;
      summary?: {
        total_pending?: number;
        needs_attention?: number;
        scheduled?: number;
        complete?: number;
      };
    };
    lab_results?: Array<{ test_name?: string; test?: string; value?: string; reference?: string; ref?: string; flag?: string; status?: string }>;
    provenance?: {
      vitals?: {
        systolic?: {
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        } | null;
        diastolic?: {
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        } | null;
        pulse?: {
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        } | null;
        spo2?: {
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        } | null;
        temperature?: {
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        } | null;
        respiratory_rate?: {
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        } | null;
      };
      diagnosis?: {
        principal?: {
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        } | null;
        secondary?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
      };
      medications?: Array<{
        value?: string;
        source_section?: string;
        source_excerpt?: string;
        source_page?: number | null;
        confidence?: number;
        provenance_type?: "quoted" | "normalized" | "derived";
      }>;
      discharge?: {
        dietary?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
        instructions?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
        red_flags?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
      };
      labs?: {
        results?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
        investigations?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
      };
      radiology?: {
        findings?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
        pending?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
      };
      treatment?: {
        current_approach?: {
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        } | null;
        management_items?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
        procedures?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
        response?: {
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        } | null;
        complications?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
      };
      handover?: {
        overview?: {
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        } | null;
        notes?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
      };
      follow_up?: {
        items?: Array<{
          value?: string;
          source_section?: string;
          source_excerpt?: string;
          source_page?: number | null;
          confidence?: number;
          provenance_type?: "quoted" | "normalized" | "derived";
        }>;
      };
    };
    latest?: {
      bp?: { systolic?: number; diastolic?: number; status?: string };
      pulse?: { value?: number; status?: string };
      temperature?: { value?: number; unit?: string };
      resp_rate?: number;
      spo2?: { value?: number; status?: string };
      grbs?: { value?: number; interpretation?: string };
    };
  };
  dashboard_cards?: {
    vitals_card?: {
      status?: string;
      summary?: { latest_bp?: string; pulse?: string; temp?: string; spo2?: string };
      trend?: string;
      data_points?: number;
      has_alerts?: boolean;
      _activation?: { state?: 'active' | 'inactive' | 'hidden'; documentType?: string };
    };
    diagnosis_card?: {
      principal_diagnosis?: string;
      icd_code?: string;
      secondary_count?: number;
      secondary_diagnoses?: string[];
      procedures_count?: number;
      _activation?: { state?: 'active' | 'inactive' | 'hidden'; documentType?: string };
    };
    medications_card?: {
      active_count?: number;
      allergy_count?: number;
      allergies?: Array<string | { name?: string; status?: string; severity?: string; reaction?: string }>;
      categories?: Array<string | { name?: string; count?: number }>;
      medication_list?: Array<{ name?: string; dose?: string; frequency?: string }>;
      _activation?: { state?: 'active' | 'inactive' | 'hidden'; documentType?: string };
    };
    labs_card?: {
      total_tests?: number;
      abnormal_count?: number;
      critical_count?: number;
      pending_count?: number;
      top_abnormal?: string;
      lab_results?: Array<{ test?: string; value?: string; reference?: string; flag?: string }>;
      investigations_list?: Array<string | { test_name?: string; finding?: string; test?: string; value?: string }>;
      has_results?: boolean;
      note?: string;
      _activation?: { state?: 'active' | 'inactive' | 'hidden'; documentType?: string };
    };
    radiology_card?: {
      studies_completed?: number;
      critical_findings?: number;
      key_finding?: string;
      _activation?: { state?: 'active' | 'inactive' | 'hidden'; documentType?: string };
    };
    treatment_card?: {
      procedures_performed?: number;
      surgeries?: number;
      response?: string;
      current_approach?: string;
      management_items?: string[];
      complications_count?: number;
      _activation?: { state?: 'active' | 'inactive' | 'hidden'; documentType?: string };
    };
    clinical_notes_card?: {
      total_notes?: number;
      last_update?: string;
      notes?: Array<{
        type?: string;
        author?: string;
        date?: string;
        summary?: string;
        situation?: string;
        background?: string;
        assessment?: string;
        recommendations?: string;
        pending_items?: string[];
        risk_flags?: string[];
        handed_over_by?: string;
        handed_over_to?: string;
        source_excerpt?: string[];
        source_type?: string;
        is_synthetic?: boolean;
        page_number?: number | null;
        confidence?: string;
        confidence_reason?: string;
        is_inferred?: boolean;
      }>;
      _activation?: { state?: 'active' | 'inactive' | 'hidden'; documentType?: string };
    };
    discharge_plan_card?: {
      condition?: string;
      instruction_count?: number;
      red_flags?: number;
      _activation?: { state?: 'active' | 'inactive' | 'hidden'; documentType?: string };
    };
    follow_up_card?: {
      next_appointment?: string;
      appointment_count?: number;
      appointments?: Array<{
        department?: string;
        physician?: string;
        date?: string;
        time?: string;
        purpose?: string;
      }>;
      _activation?: { state?: 'active' | 'inactive' | 'hidden'; documentType?: string };
    };
  };
  card_activation?: {
    documentType?: string;
    activeCards?: string[];
    hiddenCards?: string[];
    inactiveCards?: string[];
  };
  masked_image_path?: string | null;
  masked_image_url?: string | null;
  masked_image_pages?: Array<{
    page_number?: number;
    image_url?: string | null;
    image_path?: string | null;
    image_role?: "masked" | "original";
    sent_to_external?: boolean;
  }>;
  pharmacy_alert?: {
    sent?: boolean;
    email_sent?: boolean;
    whatsapp_sent?: boolean;
    skipped?: boolean;
    skip_reason?: string | null;
    error?: string | null;
    medications_count?: number;
  } | null;
  department_alerts?: {
    sent?: boolean;
    skipped?: boolean;
    skip_reason?: string | null;
    error?: string | null;
    departments?: {
      lab?: { sent?: boolean; itemCount?: number };
      radiology?: { sent?: boolean; itemCount?: number };
      nuclear_medicine?: { sent?: boolean; itemCount?: number };
      procedures?: { sent?: boolean; itemCount?: number };
    };
  } | null;
  sample_patient_data?: {
    name?: string;
    age?: number | null;
    mrn?: string;
    admission_date?: string;
    discharge_date?: string;
    los_days?: number | null;
    summary?: string;
    weight?: {
      value?: number | null;
      unit?: string;
    } | null;
  };
  presentation?: {
    summary_cards?: Record<
      string,
      {
        section?: string;
        title?: string;
        headline_metric?: string;
        secondary_line?: string;
        supporting_points?: string[];
        status?: string;
        provenance_status?: "source_backed" | "mixed" | "derived_only" | "insufficient_evidence";
      }
    >;
    notes_rail?: Array<{
      title?: string;
      author?: string;
      timestamp?: string;
      body?: string;
      priority?: "normal" | "warning" | "critical";
      category?: "doctor" | "nurse" | "handover" | "result" | "treatment";
      provenance?: Array<{
        value?: string;
        source_section?: string;
        source_excerpt?: string;
        source_page?: number | null;
        confidence?: number;
        provenance_type?: "quoted" | "normalized" | "derived";
      }>;
    }>;
  };
};

export type ProcessedDocument = {
  id: string;
  name: string;
  fileName?: string;
  size: number;
  uploadedAt: string;
  status: QueueStatus;
  department: string;
  documentType?: 'pdf' | 'voice';
  auditRunId?: string | null;
  result?: GemmaDashboardResult | null;
  error?: string | null;
  processedAt?: string;
  // Voice-specific fields
  audioPath?: string;
  mimeType?: string;
  durationLabel?: string;
  linkedPatient?: string;
  encounterLabel?: string;
  transcript?: {
    rawText: string | null;
    normalizedText: string | null;
    language: string | null;
    overallConfidence: number | null;
  } | null;
  segments?: Array<any>;
  extractionPreview?: {
    linkedPatient?: string;
    encounterLabel?: string;
    diagnosis?: string;
    medications?: Array<any>;
    labs?: Array<any>;
    radiology?: Array<any>;
    procedures?: Array<any>;
    followUp?: Array<any>;
    clinicalNotes?: Array<string>;
  };
  reviewItems?: Array<any>;
  agentInfo?: {
    name: string;
    version: string;
    latency: number;
    tokensUsed: number;
    providerTokens?: {
      gemma?: number;
      gemini?: number;
    } | null;
    steps: Array<{
      success: boolean;
      tokens: number;
      latency: number;
      dataKeys: string[];
      validationIssues: number;
    }>;
    validation: {
      confidence_level: string;
      inconsistencies_found: string[];
      missing_critical_fields: string[];
    };
  };
  chartNote?: {
    auditRunId?: string | null;
  } | null;
};

export const extractProcessedDocumentResponse = (payload: unknown): ProcessedDocument | null => {
  if (!payload || typeof payload !== "object") return null;

  const candidate =
    "document" in payload
      ? (payload as { document?: unknown }).document
      : payload;

  if (!candidate || typeof candidate !== "object") return null;
  if (!("id" in candidate) || !("status" in candidate)) return null;

  return candidate as ProcessedDocument;
};

type PresentationCard = {
  section: string;
  title: string;
  headlineMetric: string;
  secondaryLine: string;
  supportingPoints: string[];
  status: string;
  provenanceStatus: ProvenanceStatus;
};

type PresentationRailItem = {
  title: string;
  author: string;
  timestamp: string;
  body: string;
  priority: "normal" | "warning" | "critical";
  category: "doctor" | "nurse" | "handover" | "result" | "treatment";
  provenance: ProvenanceItem[];
};

const isLowValuePresentationNote = (item: { title?: string; body?: string }) => {
  const title = String(item.title || "").trim().toLowerCase();
  const body = String(item.body || "").trim().toLowerCase();
  const combined = `${title} ${body}`.trim();

  if (!combined) return true;
  if (/diet:\s*(npo|nbm|nil per mouth)\b/.test(combined)) return true;
  if (/discharge planning/.test(title) && body.length < 60) return true;
  if (/medication orders?|nursing care plan status|patient measurable goal/.test(combined)) return true;

  return false;
};

const mapPresentationStatus = (value?: string) => {
  switch (String(value || "").toLowerCase()) {
    case "source_backed":
      return "source_backed" as const;
    case "mixed":
      return "mixed" as const;
    case "derived_only":
      return "derived_only" as const;
    default:
      return "insufficient_evidence" as const;
  }
};

const mapCardStatus = (value?: string) => {
  switch (String(value || "").toLowerCase()) {
    case "stable":
      return "normal";
    case "review":
    case "elevated":
      return "warning";
    default:
      return String(value || "neutral").toLowerCase() || "neutral";
  }
};

const parseClinicalNoteTimestamp = (value?: string, fallbackYear?: number) => {
  const normalized = String(value || "").trim();
  if (!normalized) return Number.NEGATIVE_INFINITY;

  const slashMatch = normalized.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (slashMatch) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = slashMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    const timestamp = Date.UTC(
      Number(fullYear),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
    if (!Number.isNaN(timestamp)) return timestamp;
  }

  const direct = Date.parse(normalized);
  if (!Number.isNaN(direct)) return direct;

  if (fallbackYear) {
    const withCommaYear = Date.parse(`${normalized}, ${fallbackYear}`);
    if (!Number.isNaN(withCommaYear)) return withCommaYear;

    const withYear = Date.parse(`${normalized} ${fallbackYear}`);
    if (!Number.isNaN(withYear)) return withYear;
  }

  return Number.NEGATIVE_INFINITY;
};

export const getProcessedDocumentPatientName = (document: ProcessedDocument) => {
  // For voice documents, use linkedPatient if sample_patient_data name is not available
  if (document.documentType === 'voice') {
    const extractedName = document.result?.sample_patient_data?.name?.trim();
    if (extractedName) return extractedName;
    // Use linkedPatient if it's not the placeholder
    const linkedPatient = document.linkedPatient?.trim();
    if (linkedPatient && linkedPatient !== 'Encounter link pending') {
      return linkedPatient;
    }
    const livePatientName = document.result?.meta?.patientName?.trim() || document.result?.extracted_data?.patient?.name?.trim() || document.result?.extracted_data?.patient_info?.name?.trim();
    if (livePatientName) return livePatientName;
    // Fallback to file name without extension for voice docs
    return document.name?.replace(/\.[^.]+$/, '') || "Voice Dictation";
  }
  return document.result?.sample_patient_data?.name?.trim() || "";
};

export const getProcessedDocumentMrn = (document: ProcessedDocument) =>
  document.result?.sample_patient_data?.mrn?.trim() || "";

export const getProcessedDocumentEncounterLabel = (document: ProcessedDocument) => {
  if (document.documentType !== "voice") return "";
  return (
    document.encounterLabel?.trim() ||
    document.result?.meta?.encounterLabel?.trim() ||
    document.result?.sample_patient_data?.mrn?.trim() ||
    document.result?.extracted_data?.patient?.mrn?.trim() ||
    document.result?.extracted_data?.patient_info?.mrn?.trim() ||
    ""
  );
};

export const getVoiceDocumentMode = (document: ProcessedDocument) => {
  if (document.documentType !== "voice") return "dictation" as const;
  return document.result?.meta?.sessionType === "live_conversation" ? "live" as const : "dictation" as const;
};

const hasVoiceText = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const hasVoicePositiveNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
const hasVoiceArrayItems = (value: unknown) => Array.isArray(value) && value.length > 0;

const getVoicePrincipalEntries = (value: unknown): Array<string | Record<string, unknown>> => {
  if (typeof value === "string") {
    return value.trim() ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined) as Array<string | Record<string, unknown>>;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const hasDirectPrincipalFields = ["name", "description", "value", "icd_code"].some((key) => {
      const entry = record[key];
      return typeof entry === "string" && entry.trim().length > 0;
    });

    if (hasDirectPrincipalFields) {
      return [record];
    }

    return Object.keys(record)
      .filter((key) => key !== "provenance")
      .sort((left, right) => {
        const leftIndex = Number(left);
        const rightIndex = Number(right);
        const leftIsIndex = Number.isFinite(leftIndex);
        const rightIsIndex = Number.isFinite(rightIndex);

        if (leftIsIndex && rightIsIndex) return leftIndex - rightIndex;
        if (leftIsIndex) return -1;
        if (rightIsIndex) return 1;
        return left.localeCompare(right);
      })
      .map((key) => record[key])
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  }

  return [];
};

const extractVoicePrincipalDiagnosis = (value: unknown) => {
  return getVoicePrincipalEntries(value)
    .map((item) =>
      typeof item === "string"
        ? item.trim()
        : String(item.name || item.description || item.value || "").trim()
    )
    .find(Boolean) || "";
};

const extractVoicePrincipalIcdCode = (value: unknown) =>
  getVoicePrincipalEntries(value)
    .map((item) => typeof item === "string" ? "" : String(item.icd_code || "").trim())
    .find(Boolean) || "";

export const getVoiceDocumentDashboardError = (document: ProcessedDocument | null | undefined) => {
  if (!document || document.documentType !== "voice") return null;

  const result = document.result;
  if (!result || typeof result !== "object") {
    return document.error || VOICE_DASHBOARD_INCOMPLETE_ERROR;
  }

  const cards = result.dashboard_cards;
  const extracted = result.extracted_data;
  if (!cards || typeof cards !== "object" || !extracted || typeof extracted !== "object") {
    return document.error || VOICE_DASHBOARD_INCOMPLETE_ERROR;
  }

  const hasRenderableContent = Boolean(
    hasVoicePositiveNumber(cards.vitals_card?.data_points) ||
    hasVoiceText(cards.vitals_card?.summary?.latest_bp) ||
    hasVoicePositiveNumber(cards.vitals_card?.summary?.pulse) ||
    hasVoicePositiveNumber(extracted.vitals?.latest?.bp?.systolic) ||
    hasVoicePositiveNumber(extracted.vitals?.latest?.pulse?.value) ||
    hasVoiceText(cards.diagnosis_card?.principal_diagnosis) ||
    hasVoiceText(extractVoicePrincipalDiagnosis(extracted.diagnosis?.principal)) ||
    hasVoiceArrayItems(cards.diagnosis_card?.secondary_diagnoses) ||
    hasVoiceArrayItems(extracted.diagnosis?.secondary) ||
    hasVoiceArrayItems(cards.medications_card?.medication_list) ||
    hasVoiceArrayItems(extracted.medications) ||
    hasVoiceArrayItems(cards.labs_card?.lab_results) ||
    hasVoiceArrayItems(cards.labs_card?.investigations_list) ||
    hasVoiceArrayItems(extracted.lab_results) ||
    hasVoiceArrayItems(extracted.investigations) ||
    hasVoicePositiveNumber(cards.radiology_card?.studies_completed) ||
    hasVoiceText(cards.radiology_card?.key_finding) ||
    hasVoiceArrayItems(extracted.radiology) ||
    hasVoiceArrayItems(extracted.radiology?.findings) ||
    hasVoiceArrayItems(extracted.radiology?.pending) ||
    hasVoiceText(cards.treatment_card?.current_approach) ||
    hasVoiceArrayItems(cards.treatment_card?.management_items) ||
    hasVoiceText(extracted.treatment?.current_approach) ||
    hasVoiceArrayItems(extracted.treatment?.management_items) ||
    hasVoiceArrayItems(extracted.procedures) ||
    hasVoicePositiveNumber(cards.clinical_notes_card?.total_notes) ||
    hasVoiceArrayItems(cards.clinical_notes_card?.notes) ||
    hasVoiceArrayItems(extracted.clinical_notes) ||
    hasVoiceText(cards.follow_up_card?.next_appointment) ||
    hasVoicePositiveNumber(cards.follow_up_card?.appointment_count) ||
    hasVoiceArrayItems(cards.follow_up_card?.appointments) ||
    hasVoiceArrayItems(extracted.follow_up?.items) ||
    hasVoiceArrayItems(extracted.follow_up) ||
    hasVoiceText(cards.discharge_plan_card?.condition) ||
    hasVoicePositiveNumber(cards.discharge_plan_card?.instruction_count) ||
    hasVoiceArrayItems(extracted.discharge?.instructions)
  );

  return hasRenderableContent ? null : document.error || VOICE_DASHBOARD_INCOMPLETE_ERROR;
};

export const isVoiceDocumentDashboardReady = (document: ProcessedDocument | null | undefined) =>
  !getVoiceDocumentDashboardError(document);

export const matchesProcessedDocumentQuery = (document: ProcessedDocument, query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [
    document.name,
    document.department,
    getProcessedDocumentPatientName(document),
    getProcessedDocumentMrn(document),
    getProcessedDocumentEncounterLabel(document),
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(normalized));
};

/**
 * Card activation state types
 */
export type CardActivationState = 'active' | 'inactive' | 'hidden';

/**
 * Get activation state for a specific card from the dashboard_cards
 */
export const getCardActivation = (
  document: ProcessedDocument,
  cardKey: keyof NonNullable<ProcessedDocument['result']['dashboard_cards']>
): CardActivationState => {
  const card = document.result?.dashboard_cards?.[cardKey];
  if (typeof card === 'object' && card !== null && '_activation' in card) {
    const activation = (card as { _activation?: { state?: CardActivationState } })._activation;
    return activation?.state || 'active';
  }
  return 'active'; // Default to active if no activation metadata
};

/**
 * Get all card activation states for a document
 */
export const getCardActivationStates = (document: ProcessedDocument) => {
  const cards = document.result?.dashboard_cards || {};
  const activation: Record<string, CardActivationState> = {};
  const documentType = document.result?.meta?.document_type ||
                      document.result?.meta?.router?.detected_type ||
                      'prescription';

  for (const [key, card] of Object.entries(cards)) {
    if (typeof card === 'object' && card !== null && '_activation' in card) {
      const cardActivation = (card as { _activation?: { state?: CardActivationState } })._activation;
      activation[key] = cardActivation?.state || 'active';
    } else {
      activation[key] = 'active';
    }
  }

  return {
    documentType,
    activeCards: Object.entries(activation).filter(([, state]) => state === 'active').map(([key]) => key),
    inactiveCards: Object.entries(activation).filter(([, state]) => state === 'inactive').map(([key]) => key),
    hiddenCards: Object.entries(activation).filter(([, state]) => state === 'hidden').map(([key]) => key),
    states: activation as Record<string, CardActivationState>,
  };
};

/**
 * Check if a card should be rendered (active or inactive, but not hidden)
 */
export const shouldRenderCard = (
  document: ProcessedDocument,
  cardKey: keyof NonNullable<ProcessedDocument['result']['dashboard_cards']>
): boolean => {
  const state = getCardActivation(document, cardKey);
  return state !== 'hidden';
};

/**
 * Check if a card is active (has meaningful data for this document type)
 */
export const isCardActive = (
  document: ProcessedDocument,
  cardKey: keyof NonNullable<ProcessedDocument['result']['dashboard_cards']>
): boolean => {
  const state = getCardActivation(document, cardKey);
  return state === 'active';
};

const parseBp = (bp?: string | { systolic: number; diastolic: number }) => {
  // If already an object with systolic/diastolic, return it
  if (typeof bp === 'object' && bp !== null) {
    return {
      systolic: bp.systolic || 120,
      diastolic: bp.diastolic || 80,
    };
  }
  // Otherwise parse from string
  const match = String(bp || '').match(/(\d+)\s*\/\s*(\d+)/);
  return {
    systolic: match ? Number(match[1]) : 120,
    diastolic: match ? Number(match[2]) : 80,
  };
};

const parseNumeric = (value?: string | number, fallback = 0) => {
  // If already a number, return it
  if (typeof value === 'number') {
    return value;
  }
  // Otherwise parse from string
  const match = String(value || '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : fallback;
};

const isPlaceholderPatientName = (value?: string | null) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "sample patient name";
};

const createRange = (count: number, mapper: (index: number) => string) =>
  Array.from({ length: Math.max(count, 0) }, (_, index) => mapper(index));

const dedupeStrings = (items: Array<string | null | undefined | object>) => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of items) {
    let normalized: string | undefined;

    if (typeof item === 'string' || item instanceof String) {
      normalized = item.toString().trim();
    } else if (item && typeof item === 'object') {
      // Handle objects - try to extract a string representation
      if ('name' in item) normalized = String(item.name).trim();
      else if ('value' in item) normalized = String(item.value).trim();
      else normalized = JSON.stringify(item).trim();
    } else {
      normalized = item?.toString().trim();
    }

    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }

  return output;
};

const dedupeBy = <T,>(items: T[], getKey: (item: T) => string) => {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
};

const dedupeMedicationEntries = <
  T extends {
    name?: string;
    dose?: string;
    frequency?: string;
    route?: string;
    category?: string;
    start?: string;
    instructions?: string;
  },
>(
  items: T[]
) => {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const item of items) {
    const key = [
      item?.name,
      item?.dose,
      item?.frequency,
      item?.route,
      item?.category,
      item?.start,
      item?.instructions,
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .join("|");

    if (!String(item?.name || "").trim() || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
};

const isNoisyClinicalItem = (value: string) =>
  /^(?:\d+\s+of\s+\d+|--\s*\d+\s+of\s+\d+\s*--|Hospital No:|Visit No:|Name:|Doctor Name:|MEDICINES-:|Diet -:)/i.test(
    value.trim()
  );

const cleanClinicalItem = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/PHYSIOTHERAY/gi, "PHYSIOTHERAPY")
    .replace(/\s+&\s+/g, " & ")
    .trim();

const splitDelimitedItems = (value?: string) =>
  String(value || "")
    .split(/[;,]/)
    .map(cleanClinicalItem)
    .filter(Boolean);

const formatDocumentTypeLabel = (value?: string) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const firstNonEmptyString = (...values: Array<unknown>) => {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
};

const resolveDepartmentLabel = (result: GemmaDashboardResult, document: ProcessedDocument) =>
  firstNonEmptyString(
    result.meta?.department_type,
    result.visit?.department,
    result.hospital?.department,
    result.extracted_data?.visit?.department,
    result.extracted_data?.hospital?.department,
    result.extracted_data?.stage1?.visit?.department,
    result.extracted_data?.stage1?.hospital?.department,
    result.extracted_data?.stage1?.clinical?.department,
    result.doctor?.department,
    result.doctor?.specialty,
    result.extracted_data?.doctor?.department,
    result.extracted_data?.doctor?.specialty,
    result.extracted_data?.stage1?.doctor?.department,
    result.extracted_data?.stage1?.doctor?.specialty,
    formatDocumentTypeLabel(result.meta?.document_type || result.meta?.router?.detected_type),
    document.department,
    "General"
  );

const normalizeAllergyEntries = (
  rawEntries: Array<string | { name?: string; status?: string; severity?: string; reaction?: string } | null | undefined>
) => {
  const seen = new Set<string>();
  const output: Array<{
    allergen: string;
    severity: string;
    reaction: string;
    lastReaction: string;
    action: string;
    alternative: string;
  }> = [];

  for (const entry of rawEntries) {
    if (!entry) continue;

    if (typeof entry === "string") {
      const allergen = entry.trim();
      if (!allergen) continue;
      const key = allergen.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        allergen,
        severity: "",
        reaction: "",
        lastReaction: "",
        action: "",
        alternative: "",
      });
      continue;
    }

    const allergen = String(entry.name || "").trim();
    if (!allergen) continue;

    const status = String(entry.status || "").trim();
    const severity = String(entry.severity || "").trim();
    const reaction = String(entry.reaction || "").trim();
    const label = status ? `${allergen}: ${status}` : allergen;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    output.push({
      allergen: label,
      severity,
      reaction,
      lastReaction: "",
      action: "",
      alternative: "",
    });
  }

  return output.filter((entry) => !isUnknownAllergyMarker(entry.allergen));
};

const normalizeInvestigationEntries = (
  rawEntries: Array<string | { test_name?: string; finding?: string; test?: string; value?: string } | null | undefined>
) =>
  dedupeStrings(
    rawEntries.map((entry) => {
      if (!entry) return "";
      if (typeof entry === "string") return cleanClinicalItem(entry);

      const testName = cleanClinicalItem(entry.test_name || entry.test || "");
      const finding = cleanClinicalItem(entry.finding || entry.value || "");

      if (testName && finding) return `${testName}: ${finding}`;
      return testName || finding;
    })
  );

const splitInstructionList = (value?: string) => {
  const input = cleanClinicalItem(value || "");
  if (!input) return [];

  const items: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")" && depth > 0) depth -= 1;

    if (char === "," && depth === 0) {
      const normalized = cleanClinicalItem(current);
      if (normalized) items.push(normalized);
      current = "";
      continue;
    }

    current += char;
  }

  const finalItem = cleanClinicalItem(current);
  if (finalItem) items.push(finalItem);

  return items
    .map((item) => item.replace(/^\d+[\).]?\s*/, ""))
    .filter(Boolean);
};

const isMedicationLikeItem = (value: string) =>
  /^(?:INJ|TAB|CAP|SYR|SYP|IV FLUID|NEB|DROP|OINT|CREAM|LOTION)\b/i.test(value.trim());

const isInvestigationLikeItem = (value: string) =>
  /(CBC|CRP|SODIUM|POTASSIUM|UREA|CREAT|PT|APTT|INR|SEROLOG|LFT|LIPID|TSH|GROUPING|RH|URINE|XRAY|ECHOCARDIOGRAM|CT SCAN|USG|ECG|pending reports?)/i.test(
    value
  );

const isDietInstruction = (value: string) =>
  /(?:^|\b)(NPM|NBM|diet|oral feed|liquid diet|soft diet|regular diet|tube feed|nil per mouth)\b/i.test(value);

const isGenericPlanBucket = (value: string) =>
  /^(?:IV Fluids|Miscellaneous|Medications|Radiology|Planned procedure)$/i.test(value.trim());

const formatDietInstruction = (value: string) => {
  const cleaned = cleanClinicalItem(value);
  if (/^NPM$/i.test(cleaned)) return "Nil per mouth (NPM)";
  return cleaned;
};

const isPatientInstruction = (value: string) =>
  /^(?:maintain|avoid|drink|take|continue|do|use|keep|follow|review|report back|return|mobili[sz]e|walk|rest)/i.test(
    value.trim()
  );

const isNonInstructionCareItem = (value: string) =>
  /(risk\b|high risk|low risk|due for|came to daycare|admitted to|multiple myeloma|chemotherapy|nursing diagnosis|goal to|patient is|report back if)/i.test(
    value.trim()
  );

const normalizePendingReviewItems = (items: string[]) => {
  const output: string[] = [];

  for (const rawItem of items) {
    const cleaned = cleanClinicalItem(rawItem)
      .replace(/^BLOOD FOR\s*-:\s*/i, "")
      .replace(/^URINE FOR\s*-:\s*/i, "URINE ")
      .replace(/\s+,/g, ",")
      .replace(/,\s*$/, "")
      .replace(/\.\s*$/, "")
      .trim();

    if (
      !cleaned ||
      isNoisyClinicalItem(cleaned) ||
      isMedicationLikeItem(cleaned) ||
      isDietInstruction(cleaned) ||
      isGenericPlanBucket(cleaned) ||
      /^MEDICINES-:?$/i.test(cleaned)
    ) {
      continue;
    }

    const lastIndex = output.length - 1;
    const previous = lastIndex >= 0 ? output[lastIndex] : "";

    if (/^TYPING$/i.test(cleaned) && /GROUPING\s*&\s*RH$/i.test(previous)) {
      output[lastIndex] = `${previous} TYPING`;
      continue;
    }

    if (/^(?:R\/E,?\s*C\/S|R\/E|C\/S)$/i.test(cleaned) && /^URINE$/i.test(previous)) {
      output[lastIndex] = `URINE ${cleaned.replace(/\s*,\s*/g, ", ")}`;
      continue;
    }

    if (
      !isInvestigationLikeItem(cleaned) &&
      !/pending reports?|approved follow-up|transfer \/ handover required/i.test(cleaned)
    ) {
      continue;
    }

    output.push(cleaned);
  }

  return dedupeStrings(output.filter((item) => !/^URINE$/i.test(item)));
};

const splitEscalationInstructions = (value?: string) => {
  const cleaned = cleanClinicalItem(value || "");
  if (!cleaned) return [];

  const reportBackMatch = cleaned.match(/report back(?:\s+if)?\s+(.+)/i);
  if (!reportBackMatch) {
    return /(pain|weight|appetite|distension|fever|loose stools|bleeding|tiredness|breathing difficulty|altered sensorium|undue symptoms)/i.test(
      cleaned
    )
      && !/(add nursing care plan|medication orders|drug \/ generic item|dosage qty|frequency instructions|aqua pulse|lyophilized|autofusion set)/i.test(
        cleaned
      )
      ? [toSentence(cleaned.replace(/^(?:for|or)\s+/i, ""))]
      : [];
  }

  const normalizedTail = reportBackMatch[1]
    .replace(/Add Nursing Care Plan[\s\S]*$/i, "")
    .replace(/MEDICATION ORDERS[\s\S]*$/i, "")
    .replace(/Reports supplied to patients[\s\S]*$/i, "")
    .replace(/\bSOS in case of any undue symptoms\b/i, "any undue symptoms")
    .replace(/\s+or\s+SOS\b/gi, ", ")
    .replace(/\s+or\s+/gi, ", ");

  return normalizedTail
    .split(/\s*,\s*/)
    .map((item) => cleanClinicalItem(item))
    .filter(Boolean)
    .map((item) => item.replace(/^(?:if|for|or)\s+/i, ""))
    .filter(
      (item) =>
        !/(add nursing care plan|medication orders|drug \/ generic item|dosage qty|frequency instructions|aqua pulse|lyophilized|autofusion set)/i.test(
          item
        )
    )
    .map((item) => item.replace(/\s*\.\s*$/, ""))
    .map((item) => toSentence(item.charAt(0).toUpperCase() + item.slice(1)));
};

const isUnknownAllergyMarker = (value: string) =>
  /(?:^|\b)(?:unknown|nkda|nkfa|nkf&da|not known|no known allergy|no known drug allergy|nil known allergy)(?:\b|$)/i.test(
    value.trim()
  );

const looksLikeRealDrg = (value?: string) =>
  Boolean(value && (/\bdrg\b/i.test(value) || /\b\d{3}\b/.test(value)) && !/complexity/i.test(value));

const isComorbidityLikeDiagnosis = (value: string) =>
  /\b(htn|hypertension|t2dm|dm|diabetes|copd|post cabg|cabg|cad|ihd|hfp?ef|ckd|cva|stroke|af|cad|hypothyroid|dyslipidemia)\b/i.test(
    value
  );

const isGenericPrincipalDiagnosis = (value?: string) =>
  /^(?:newborn|neonate|baby|infant|patient)$/i.test(String(value || "").trim());

const isRadiologyInvestigation = (value: string) =>
  /\b(?:xray|x-ray|ct|mri|usg|ultrasound|echo|echocardiogram|scan|doppler)\b/i.test(value);

const isCriticalImagingFinding = (value: string) =>
  /\b(?:bleed|hemorrhage|haemorrhage|stroke|infarct|mass effect|pneumothorax|fracture|embol|malign|lesion)\b/i.test(
    value
  );

const parseNumericReference = (value?: string) => {
  const matches = String(value || "").match(/\d+(\.\d+)?/g);
  return matches ? matches.map(Number) : [];
};

const matchesProvenanceValue = (value: string, items: ProvenanceItem[]) => {
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) return false;

  return items.some((item) => {
    const normalizedItem = item.value.trim().toLowerCase();
    return (
      normalizedItem === normalizedValue ||
      normalizedItem.includes(normalizedValue) ||
      normalizedValue.includes(normalizedItem)
    );
  });
};

type ProvenanceItem = {
  value: string;
  sourceSection: string;
  sourceExcerpt: string;
  sourcePage: number | null;
  confidence: number;
  provenanceType: "quoted" | "normalized" | "derived";
};

type ProvenanceStatus = "source_backed" | "mixed" | "derived_only" | "insufficient_evidence";

const normalizeProvenanceItem = (item?: {
  value?: string;
  source_section?: string;
  source_excerpt?: string;
  source_page?: number | null;
  confidence?: number;
  provenance_type?: "quoted" | "normalized" | "derived";
} | null): ProvenanceItem | null => {
  if (!item) return null;
  const value = String(item.value || "").trim();
  const sourceExcerpt = String(item.source_excerpt || "").trim();
  if (!value) return null;

  return {
    value,
    sourceSection: String(item.source_section || "").trim(),
    sourceExcerpt,
    sourcePage: typeof item.source_page === "number" ? item.source_page : null,
    confidence: typeof item.confidence === "number" ? item.confidence : 0,
    provenanceType: item.provenance_type || "normalized",
  };
};

const isFallbackLikeValue = (value: string) =>
  /(generated|derived from|validate against|source document|not documented|unknown)$/i.test(value.trim());

const isSafeProvenanceItem = (item: ProvenanceItem, allowedTypes: Array<"quoted" | "normalized" | "derived">) =>
  Boolean(
    item.value &&
      item.sourceExcerpt &&
      allowedTypes.includes(item.provenanceType) &&
      !isFallbackLikeValue(item.value) &&
      !isFallbackLikeValue(item.sourceExcerpt)
  );

/**
 * Checks if a value is a provenance metadata object (not an actual provenance item)
 */
const isMetadataObject = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value as object);
  return keys.includes('section') || keys.includes('has_data') || keys.includes('source');
};

/**
 * Normalizes provenance input to handle both array format and metadata object format.
 * - If input is already an array, return it as-is
 * - If input is a metadata object (has 'section', 'has_data', etc.), return empty array
 *   (metadata format doesn't contain actual provenance items)
 * - Otherwise, return empty array
 */
const normalizeProvenanceInput = (
  provenance: unknown
): Array<Record<string, unknown>> => {
  if (Array.isArray(provenance)) {
    return provenance as Array<Record<string, unknown>>;
  }
  // Check if it's a metadata object (has 'section' or 'has_data' keys)
  if (isMetadataObject(provenance)) {
    // This is metadata, not provenance items - return empty array
    return [];
  }
  return [];
};

/**
 * Flattens an array of provenance items, filtering out metadata objects
 */
const flattenProvenanceItems = (
  items: Array<unknown>
): Array<Record<string, unknown>> => {
  const result: Array<Record<string, unknown>> = [];
  for (const item of items) {
    if (Array.isArray(item)) {
      result.push(...flattenProvenanceItems(item));
    } else if (!isMetadataObject(item) && item != null) {
      result.push(item as Record<string, unknown>);
    }
  }
  return result;
};

const buildSectionProvenance = (
  rawItems: Array<{
    value?: string;
    source_section?: string;
    source_excerpt?: string;
    source_page?: number | null;
    confidence?: number;
    provenance_type?: "quoted" | "normalized" | "derived";
  } | null | undefined>,
  allowedTypes: Array<"quoted" | "normalized" | "derived">
) => {
  // Guard against non-array inputs
  if (!Array.isArray(rawItems)) {
    console.warn('[buildSectionProvenance] Non-array input received, using empty array:', typeof rawItems, rawItems);
    return {
      status: "insufficient_evidence" as const,
      items: [],
      hasRaw: false,
    };
  }

  const normalized = rawItems.map((item) => normalizeProvenanceItem(item)).filter(Boolean) as ProvenanceItem[];
  const safeItems = normalized.filter((item) => isSafeProvenanceItem(item, allowedTypes));

  let status: ProvenanceStatus = "insufficient_evidence";
  if (safeItems.length > 0 && safeItems.length === normalized.length) status = "source_backed";
  else if (safeItems.length > 0) status = "mixed";
  else if (normalized.some((item) => item.provenanceType === "derived")) status = "derived_only";

  return {
    status,
    items: safeItems,
    hasRaw: normalized.length > 0,
  };
};

const getSafeProvenanceItems = (
  rawItems: Array<{
    value?: string;
    source_section?: string;
    source_excerpt?: string;
    source_page?: number | null;
    confidence?: number;
    provenance_type?: "quoted" | "normalized" | "derived";
  } | null | undefined>,
  allowedTypes: Array<"quoted" | "normalized" | "derived">
) =>
  rawItems
    .map((item) => normalizeProvenanceItem(item))
    .filter(Boolean)
    .filter((item) => isSafeProvenanceItem(item as ProvenanceItem, allowedTypes)) as ProvenanceItem[];

const toSentence = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const riskWatchAliases: Record<string, string[]> = {
  Fall: ["fall", "falls", "fall risk"],
  Aspiration: ["aspiration", "aspiration risk"],
  "Pressure Ulcer": ["pressure", "pressure ulcer", "pressure sore", "braden"],
  DVT: ["dvt", "deep vein thrombosis", "dvt risk"],
  EWS: ["ews", "early warning score"],
};

const getFallbackDashboardData = (document: ProcessedDocument): DashboardPatientData => ({
  meta: {
    reportId: document.id,
    generatedAt: document.processedAt || document.uploadedAt,
    version: "gemma-processed",
  },
  patient: {
    id: document.id,
    name: "",
    age: 0,
    gender: "",
    weight: { value: 0, unit: "" },
    dateOfBirth: "",
    mrn: "",
    bloodGroup: "",
    contact: { phone: "", email: "", emergencyContact: "" },
  },
  admission: {
    id: document.id,
    admissionDate: document.uploadedAt,
    dischargeDate: null,
    lengthOfStay: 0,
    department: "Unknown",
    ward: "",
    bed: "",
    attendingPhysician: { id: "", name: "", specialization: "" },
    admissionType: "",
    admissionDiagnosis: "",
  },
  vitals: {
    latest: {
      bloodPressure: { systolic: 0, diastolic: 0, unit: "mmHg" },
      heartRate: { value: 0, unit: "bpm" },
      temperature: { value: 0, unit: "°F" },
      respiratoryRate: { value: 0, unit: "/min" },
      spo2: { value: 0, unit: "%" },
      weight: { value: 0, unit: "" },
      painScore: { value: 0, scale: 10 },
    },
    status: "stable",
    trend: "stable",
    history: [],
    alerts: [],
    referenceRanges: {},
  },
  diagnosis: {
    principal: { code: "", description: "Not available", confirmedDate: "", presentation: [], confirmation: [], treatingPhysician: "" },
    secondary: [],
    comorbidities: [],
    drg: "",
  },
  medications: { active: [], allergies: [], changes: { added: [], adjusted: [], discontinued: [] }, interactionCheck: "" },
  labs: {
    totalTests: 0,
    abnormalCount: 0,
    criticalCount: 0,
    pendingCount: 0,
    lab_results: [],
    investigations: [],
    hasResults: false,
    note: "",
    critical: [],
    abnormal: [],
    cbc: [],
    metabolic: [],
    troponinTrend: [],
    pending: [],
  },
  radiology: {
    completedStudies: 0,
    pendingStudies: 0,
    criticalFindings: 0,
    studies: [],
    pending: [],
  },
  treatment: {
    procedures: [],
    activeManagement: [],
    currentApproach: "",
    response: "",
    responseDocumented: false,
    complications: 0,
    complicationsDocumented: false,
    complicationsLabel: "",
  },
  riskWatch: { ewsScore: null, items: [] },
  clinicalNotes: {
    totalNotes: 0,
    lastUpdate: "",
    notes: [],
    handover: { overview: "", sections: [] },
  },
  dischargePlan: {
    condition: "",
    conditionChecks: [],
    dietary: [],
    activityRestrictions: { doNot: [], okToDo: [], duration: "", afterRestriction: "" },
    pendingItems: [],
    redFlags: [],
  },
  followUp: [],
  presentation: {
    summaryCards: {},
    notesRail: [],
  },
  provenance: { sections: {} },
});

export const transformProcessedDocument = (document: ProcessedDocument): DashboardPatientData => {
  try {
    const result = document.result || {};
    if (!result) {
      console.error('[transformProcessedDocument] No result in document');
      return getFallbackDashboardData(document);
    }
  const cards = result.dashboard_cards || {};
  const sample = result.sample_patient_data || {};
  // For prescription pipeline, data is at root level; for chart notes, it's in extracted_data
  const extracted = result.extracted_data && Object.keys(result.extracted_data).length > 0
    ? result.extracted_data
    : result;

  // Normalize voice dictation data structure to match expected format
  // Voice documents have diagnosis.principal as array, medications as array, etc.
  const isVoiceDocument =
    result.meta?.source_type === 'voice' ||
    result.meta?.source_type === 'voice_transcript' ||
    extracted?.meta?.source_type === 'voice_transcript' ||
    document.documentType === 'voice';
  const normalizedExtracted = isVoiceDocument ? {
    ...extracted,
    diagnosis: {
      principal: extractVoicePrincipalDiagnosis(extracted.diagnosis?.principal),
      secondary: Array.isArray(extracted.diagnosis?.secondary)
        ? extracted.diagnosis.secondary.map((d: any) => d.name || d)
        : extracted.diagnosis?.secondary || [],
      comorbidities: Array.isArray(extracted.diagnosis?.comorbidities)
        ? extracted.diagnosis.comorbidities
        : [],
      symptoms: Array.isArray(extracted.diagnosis?.symptoms)
        ? extracted.diagnosis.symptoms.map((item: any) => typeof item === 'string' ? item : item.name || item.finding || item.value || '')
        : [],
      icd_code: extractVoicePrincipalIcdCode(extracted.diagnosis?.principal) || extracted.diagnosis?.icd_code || '',
    },
    medications: Array.isArray(extracted.medications)
      ? extracted.medications.map((m: any) => ({
          name: m.name,
          dose: m.dose || '',
          frequency: m.frequency || '',
          route: m.route || '',
          status: m.status || 'active',
        }))
      : extracted.medications || [],
    procedures: Array.isArray(extracted.procedures)
      ? extracted.procedures.map((p: any) => p.name || p)
      : extracted.procedures || [],
    follow_up: typeof extracted.follow_up === 'object' && extracted.follow_up?.items
      ? {
          items: extracted.follow_up.items.map((f: any) =>
            typeof f === 'string' ? f : f.timing || f.reason || f.specialty || JSON.stringify(f)
          )
        }
      : extracted.follow_up || { items: [] },
    review_of_systems: extracted.review_of_systems || { positives: [], negatives: [] },
    physical_exam: extracted.physical_exam || { normal_findings: [], abnormal_findings: [] },
    clinical_notes: Array.isArray(extracted.clinical_notes)
      ? extracted.clinical_notes
      : [],
    labs: {
      results: Array.isArray(extracted.lab_results) ? extracted.lab_results : [],
    },
    investigations: Array.isArray(extracted.investigations) ? extracted.investigations : [],
    radiology: {
      findings: Array.isArray(extracted.radiology?.findings) ? extracted.radiology.findings : [],
      pending: Array.isArray(extracted.radiology?.pending) ? extracted.radiology.pending.map((r: any) => r.type || r.body_part || r) : [],
    },
    treatment: {
      procedures: Array.isArray(extracted.treatment?.procedures) ? extracted.treatment.procedures : extracted.procedures || [],
      management_items: Array.isArray(extracted.treatment?.management_items) ? extracted.treatment.management_items : [],
    },
    patient: extracted.patient || { name: '', mrn: '', age: null, gender: '' },
    vitals: extracted.vitals || { bp: {}, pulse: {}, temperature: {}, spo2: {}, resp_rate: {} },
  } : extracted;

  const sampleName = firstNonEmptyString(
    !isPlaceholderPatientName(sample.name) ? sample.name : "",
    normalizedExtracted?.patient?.name,
    normalizedExtracted?.stage1?.patient?.name,
  );
  const sampleAge = typeof sample.age === "number" && sample.age > 0 ? sample.age : (Number(normalizedExtracted?.patient?.age || normalizedExtracted?.stage1?.patient?.age) || 0);
  const sampleLosDays = typeof sample.los_days === "number" && sample.los_days > 0 ? sample.los_days : 0;
  const extractedProvenance = result.provenance || normalizedExtracted.provenance || {};
  // For voice documents, normalizedExtracted has the correct structure (principal as string, not array)
  // Prioritize normalizedExtracted to ensure consistent data structure
  const extractedDiagnosis = normalizedExtracted.diagnosis || result.diagnosis || {};
  const extractedTreatment = normalizedExtracted.treatment || result.treatment || {};

  console.log('[transformProcessedDocument] Debug: cards type', typeof cards, 'Array.isArray?', Array.isArray(cards));
  console.log('[transformProcessedDocument] Debug: cards keys', Object.keys(cards));
  console.log('[transformProcessedDocument] Debug: sample', sample);
  console.log('[transformProcessedDocument] Debug: extracted keys', Object.keys(extracted));
  console.log('[transformProcessedDocument] Debug: extractedProvenance', extractedProvenance);

  let vitalsSectionProvenance, diagnosisSectionProvenance, medicationsSectionProvenance, labsSectionProvenance, radiologySectionProvenance, treatmentSectionProvenance, handoverSectionProvenance, followUpSectionProvenance, dischargeSectionProvenance;

  try {
    vitalsSectionProvenance = buildSectionProvenance(
      flattenProvenanceItems([
        extractedProvenance.vitals?.systolic,
        extractedProvenance.vitals?.diastolic,
        extractedProvenance.vitals?.pulse,
        extractedProvenance.vitals?.spo2,
        extractedProvenance.vitals?.temperature,
        extractedProvenance.vitals?.respiratory_rate,
      ]),
      ["quoted", "normalized"]
    );
  } catch (e) {
    console.error('[transformProcessedDocument] Error in vitalsSectionProvenance:', e);
    vitalsSectionProvenance = { status: "insufficient_evidence", items: [], hasRaw: false };
  }

  try {
    diagnosisSectionProvenance = buildSectionProvenance(
      flattenProvenanceItems([
        extractedProvenance.diagnosis?.principal,
        ...(extractedProvenance.diagnosis?.secondary || []),
      ]),
      ["quoted", "normalized"]
    );
  } catch (e) {
    console.error('[transformProcessedDocument] Error in diagnosisSectionProvenance:', e);
    diagnosisSectionProvenance = { status: "insufficient_evidence", items: [], hasRaw: false };
  }

  try {
    medicationsSectionProvenance = buildSectionProvenance(normalizeProvenanceInput(extractedProvenance.medications), ["quoted", "normalized"]);
  } catch (e) {
    console.error('[transformProcessedDocument] Error in medicationsSectionProvenance:', e);
    medicationsSectionProvenance = { status: "insufficient_evidence", items: [], hasRaw: false };
  }

  try {
    labsSectionProvenance = buildSectionProvenance(
      flattenProvenanceItems([
        ...(extractedProvenance.labs?.results || []),
        ...(extractedProvenance.labs?.investigations || []),
      ]),
      ["quoted", "normalized"]
    );
  } catch (e) {
    console.error('[transformProcessedDocument] Error in labsSectionProvenance:', e);
    labsSectionProvenance = { status: "insufficient_evidence", items: [], hasRaw: false };
  }

  try {
    radiologySectionProvenance = buildSectionProvenance(
      flattenProvenanceItems([
        ...(extractedProvenance.radiology?.findings || []),
        ...(extractedProvenance.radiology?.pending || []),
      ]),
      ["quoted", "normalized"]
    );
  } catch (e) {
    console.error('[transformProcessedDocument] Error in radiologySectionProvenance:', e);
    radiologySectionProvenance = { status: "insufficient_evidence", items: [], hasRaw: false };
  }

  try {
    treatmentSectionProvenance = buildSectionProvenance(
      flattenProvenanceItems([
        extractedProvenance.treatment?.current_approach,
        ...(extractedProvenance.treatment?.management_items || []),
        ...(extractedProvenance.treatment?.procedures || []),
        extractedProvenance.treatment?.response,
        ...(extractedProvenance.treatment?.complications || []),
      ]),
      ["quoted", "normalized", "derived"]
    );
  } catch (e) {
    console.error('[transformProcessedDocument] Error in treatmentSectionProvenance:', e);
    treatmentSectionProvenance = { status: "insufficient_evidence", items: [], hasRaw: false };
  }

  try {
    handoverSectionProvenance = buildSectionProvenance(
      flattenProvenanceItems([
        extractedProvenance.handover?.overview,
        ...(extractedProvenance.handover?.notes || []),
      ]),
      ["quoted", "normalized", "derived"]
    );
  } catch (e) {
    console.error('[transformProcessedDocument] Error in handoverSectionProvenance:', e);
    handoverSectionProvenance = { status: "insufficient_evidence", items: [], hasRaw: false };
  }

  try {
    followUpSectionProvenance = buildSectionProvenance(
      normalizeProvenanceInput(extractedProvenance.follow_up?.items),
      ["quoted", "normalized"]
    );
  } catch (e) {
    console.error('[transformProcessedDocument] Error in followUpSectionProvenance:', e);
    followUpSectionProvenance = { status: "insufficient_evidence", items: [], hasRaw: false };
  }

  try {
    dischargeSectionProvenance = buildSectionProvenance(
      flattenProvenanceItems([
        ...(extractedProvenance.discharge?.dietary || []),
        ...(extractedProvenance.discharge?.instructions || []),
        ...(extractedProvenance.discharge?.red_flags || []),
      ]),
      ["quoted", "normalized"]
    );
  } catch (e) {
    console.error('[transformProcessedDocument] Error in dischargeSectionProvenance:', e);
    dischargeSectionProvenance = { status: "insufficient_evidence", items: [], hasRaw: false };
  }

  const diagnosisSectionSupported =
    !diagnosisSectionProvenance.hasRaw || diagnosisSectionProvenance.items.length > 0;
  const medicationsSectionSupported =
    !medicationsSectionProvenance.hasRaw || medicationsSectionProvenance.items.length > 0;
  const vitalsSectionSupported =
    !vitalsSectionProvenance.hasRaw || vitalsSectionProvenance.items.length > 0;
  const labsSectionSupported =
    !labsSectionProvenance.hasRaw || labsSectionProvenance.items.length > 0;
  const radiologySectionSupported =
    !radiologySectionProvenance.hasRaw || radiologySectionProvenance.items.length > 0;
  const treatmentSectionSupported =
    !treatmentSectionProvenance.hasRaw || treatmentSectionProvenance.items.length > 0;
  const handoverSectionSupported =
    !handoverSectionProvenance.hasRaw || handoverSectionProvenance.items.length > 0;
  const followUpSectionSupported =
    !followUpSectionProvenance.hasRaw || followUpSectionProvenance.items.length > 0;
  const safeVitalsProvenanceItems = vitalsSectionProvenance.items;
  const safeLabResultProvenanceItems = getSafeProvenanceItems(normalizeProvenanceInput(extractedProvenance.labs?.results), ["quoted", "normalized"]);
  const safeLabInvestigationProvenanceItems = getSafeProvenanceItems(normalizeProvenanceInput(extractedProvenance.labs?.investigations), ["quoted", "normalized"]);
  const safeRadiologyFindingProvenanceItems = getSafeProvenanceItems(normalizeProvenanceInput(extractedProvenance.radiology?.findings), ["quoted", "normalized"]);
  const safeRadiologyPendingProvenanceItems = getSafeProvenanceItems(normalizeProvenanceInput(extractedProvenance.radiology?.pending), ["quoted", "normalized"]);
  const safeTreatmentManagementItems = getSafeProvenanceItems(normalizeProvenanceInput(extractedProvenance.treatment?.management_items), ["quoted", "normalized", "derived"]);
  const safeTreatmentProcedureItems = getSafeProvenanceItems(normalizeProvenanceInput(extractedProvenance.treatment?.procedures), ["quoted", "normalized", "derived"]);
  const safeTreatmentComplicationItems = getSafeProvenanceItems(normalizeProvenanceInput(extractedProvenance.treatment?.complications), ["quoted", "normalized", "derived"]);
  const safeHandoverNoteItems = getSafeProvenanceItems(normalizeProvenanceInput(extractedProvenance.handover?.notes), ["quoted", "normalized", "derived"]);
  const safeFollowUpItems = getSafeProvenanceItems(normalizeProvenanceInput(extractedProvenance.follow_up?.items), ["quoted", "normalized"]);
  const resolvedPatientMrn = firstNonEmptyString(
    sample.mrn,
    extracted?.patient?.mrn,
    extracted?.patient?.hospital_no,
    extracted?.stage1?.patient?.mrn,
    extracted?.stage1?.patient?.hospital_no,
    extracted?.stage1?.phi?.hospital_no
  );

  // Use result.vitals.latest for prescriptions, extracted.latest for chart notes
  const latestVitals = result.vitals?.latest || extracted.latest || {};
  const visitType = String(
    result.meta?.visit_type ||
    normalizedExtracted.meta?.visit_type ||
    extracted.visit?.visit_type ||
    extracted.stage1?.visit?.visit_type ||
    ""
  ).trim();
  const hasVitalEvidence = (pattern: RegExp) =>
    safeVitalsProvenanceItems.some((item) => pattern.test(item.value));
  const extractedRespRateValue =
    typeof latestVitals.resp_rate?.value === "number"
      ? latestVitals.resp_rate.value
      : typeof latestVitals.resp_rate === "number"
        ? latestVitals.resp_rate
        : null;
  const hasSourceBackedVitals = Boolean(
    result.vitals?.has_vitals ||
    normalizedExtracted.vitals?.has_vitals ||
    cards.vitals_card?.data_points ||
    safeVitalsProvenanceItems.length > 0 ||
    (
      typeof latestVitals.bp?.systolic === "number" &&
      typeof latestVitals.bp?.diastolic === "number" &&
      latestVitals.bp.systolic > 0 &&
      latestVitals.bp.diastolic > 0
    ) ||
    (typeof latestVitals.pulse?.value === "number" && latestVitals.pulse.value > 0) ||
    (typeof latestVitals.temperature?.value === "number" && latestVitals.temperature.value > 0) ||
    (typeof latestVitals.spo2?.value === "number" && latestVitals.spo2.value > 0) ||
    (typeof extractedRespRateValue === "number" && extractedRespRateValue > 0)
  );
  const extractedBp =
    latestVitals.bp?.systolic && latestVitals.bp?.diastolic
      ? { systolic: latestVitals.bp.systolic, diastolic: latestVitals.bp.diastolic }
      : null;
  const bp = hasSourceBackedVitals && (!vitalsSectionProvenance.hasRaw || hasVitalEvidence(/systolic bp|diastolic bp/i))
    ? (extractedBp || parseBp(cards.vitals_card?.summary?.latest_bp))
    : { systolic: 0, diastolic: 0 };
  const pulse = hasSourceBackedVitals && (!vitalsSectionProvenance.hasRaw || hasVitalEvidence(/^pulse\b/i))
    ? (typeof latestVitals.pulse?.value === "number" && latestVitals.pulse.value > 0
        ? latestVitals.pulse.value
        : parseNumeric(cards.vitals_card?.summary?.pulse, 0))
    : 0;
  const temp = hasSourceBackedVitals && (!vitalsSectionProvenance.hasRaw || hasVitalEvidence(/^temperature\b/i))
    ? (typeof latestVitals.temperature?.value === "number" && latestVitals.temperature.value > 0
        ? latestVitals.temperature.value
        : parseNumeric(cards.vitals_card?.summary?.temp, 0))
    : 0;
  const spo2 = hasSourceBackedVitals && (!vitalsSectionProvenance.hasRaw || hasVitalEvidence(/^spo2\b/i))
    ? (typeof latestVitals.spo2?.value === "number" && latestVitals.spo2.value > 0
        ? latestVitals.spo2.value
        : parseNumeric(cards.vitals_card?.summary?.spo2, 0))
    : 0;
  const respRate = hasSourceBackedVitals && (!vitalsSectionProvenance.hasRaw || hasVitalEvidence(/^respiratory rate\b/i))
    ? (typeof extractedRespRateValue === "number" && extractedRespRateValue > 0
        ? extractedRespRateValue
        : 0)
    : 0;
  const painScore = typeof latestVitals.pain_score?.value === "number" ? latestVitals.pain_score.value : 0;
  const weightValue =
    typeof latestVitals.weight?.value === "number" && latestVitals.weight.value > 0
      ? latestVitals.weight.value
      : typeof sample.weight?.value === "number" && sample.weight.value > 0
        ? sample.weight.value
        : 0;
  const weightUnit = latestVitals.weight?.unit || sample.weight?.unit || "";
  const secondaryDiagnoses = dedupeStrings(
    diagnosisSectionSupported ? (cards.diagnosis_card?.secondary_diagnoses || extractedDiagnosis.secondary || []) : []
  );
  const allergies = normalizeAllergyEntries(Array.isArray(cards.medications_card?.allergies) ? cards.medications_card.allergies : Array.isArray(normalizedExtracted.allergies) ? normalizedExtracted.allergies : []);
  const medicationList = medicationsSectionSupported
    ? dedupeMedicationEntries(Array.isArray(cards.medications_card?.medication_list) ? cards.medications_card.medication_list : Array.isArray(normalizedExtracted.medications) ? normalizedExtracted.medications : [])
    : [];
  const extractedLabResults = Array.isArray(normalizedExtracted.lab_results) ? normalizedExtracted.lab_results.map((result) => ({
    test: result.test_name || result.test || "Unknown",
    value: result.value || "",
    reference: result.reference || result.ref || "N/A",
    flag: result.flag || result.status || "",
  })) : [];
  const cardLabResults = Array.isArray(cards.labs_card?.lab_results) ? cards.labs_card.lab_results : [];
  const ungatedLabResults = cardLabResults.length > 0 ? cardLabResults : extractedLabResults;
  const labResults = labsSectionSupported
    ? (
        labsSectionProvenance.hasRaw
          ? ungatedLabResults.filter((result) =>
              matchesProvenanceValue(String(result.test || ""), safeLabResultProvenanceItems)
            )
          : ungatedLabResults
      )
    : [];
  const hasActualLabResults = (cards.labs_card?.has_results || false) && labResults.length > 0;
  const ungatedInvestigationList = normalizeInvestigationEntries(Array.isArray(cards.labs_card?.investigations_list) ? cards.labs_card.investigations_list : Array.isArray(normalizedExtracted.investigations) ? normalizedExtracted.investigations : []);
  const investigationList = labsSectionSupported
    ? (
        labsSectionProvenance.hasRaw
          ? ungatedInvestigationList.filter((item) => matchesProvenanceValue(String(item || ""), safeLabInvestigationProvenanceItems))
          : ungatedInvestigationList
      )
    : [];
  const criticalLabRows = hasActualLabResults
    ? labResults.filter((result) => {
        const flag = (result.flag || "").toLowerCase();
        return ["critical", "c", "panic"].includes(flag);
      })
    : [];
  const abnormalLabRows = hasActualLabResults
    ? labResults.filter((result) => {
        const flag = (result.flag || "").toLowerCase();
        return ["high", "low", "abnormal", "h", "l", "a"].includes(flag);
      })
    : [];
  const instructionCount = cards.discharge_plan_card?.instruction_count || 0;
  const followUpCount = cards.follow_up_card?.appointment_count || 0;
  const noteFallbackYear = (() => {
    const parsed = Date.parse(cards.clinical_notes_card?.last_update || document.processedAt || document.uploadedAt || "");
    return Number.isNaN(parsed) ? undefined : new Date(parsed).getUTCFullYear();
  })();
  const explicitClinicalNotes = (Array.isArray(cards.clinical_notes_card?.notes) ? cards.clinical_notes_card.notes : Array.isArray(normalizedExtracted.clinical_notes) ? normalizedExtracted.clinical_notes : [])
    .map((note) => ({
      date: note.date || "",
      author: note.author || "",
      type: note.type || "Clinical Note",
      summary: note.summary || "",
      situation: note.situation || "",
      background: note.background || "",
      assessment: note.assessment || "",
      recommendations: note.recommendations || "",
      pending_items: Array.isArray(note.pending_items) ? note.pending_items.filter((item) => item && !isNoisyClinicalItem(item)) : [],
      risk_flags: Array.isArray(note.risk_flags) ? note.risk_flags.filter(Boolean) : [],
      handed_over_by: note.handed_over_by || "",
      handed_over_to: note.handed_over_to || "",
      source_excerpt: Array.isArray(note.source_excerpt) ? note.source_excerpt.filter((item) => item && !isNoisyClinicalItem(item)) : [],
      source_type: note.source_type || "",
      is_synthetic: Boolean(note.is_synthetic),
      page_number: typeof note.page_number === "number" ? note.page_number : null,
      confidence: note.confidence || "",
      confidence_reason: note.confidence_reason || "",
      is_inferred: Boolean(note.is_inferred),
    }))
    .filter((note) =>
      [
        note.summary,
        note.situation,
        note.background,
        note.assessment,
        note.recommendations,
        ...note.pending_items,
        ...note.risk_flags,
        note.handed_over_by,
        note.handed_over_to,
        ...note.source_excerpt,
      ].some((value) => String(value || "").trim().length > 0)
    )
    .map((note, index) => ({
      ...note,
      __sortIndex: index,
      __timestamp: parseClinicalNoteTimestamp(note.date, noteFallbackYear),
    }))
    .sort((a, b) => {
      if (a.__timestamp === b.__timestamp) return a.__sortIndex - b.__sortIndex;
      return b.__timestamp - a.__timestamp;
    })
    .map(({ __sortIndex, __timestamp, ...note }) => note);
  const totalNotes = Math.max(cards.clinical_notes_card?.total_notes || 0, explicitClinicalNotes.length);
  const handoverNotes = handoverSectionSupported && handoverSectionProvenance.hasRaw
    ? explicitClinicalNotes.filter((note) =>
        safeHandoverNoteItems.some((item) =>
          matchesProvenanceValue(
            `${note.type}: ${note.summary || note.assessment || note.recommendations || note.situation || note.background || note.source_excerpt[0] || ""}`,
            [item]
          )
        )
      )
    : explicitClinicalNotes;
  const handoverNote = explicitClinicalNotes.find((note) => /handover/i.test(note.type));
  const residentNote = explicitClinicalNotes.find((note) => /resident/i.test(note.type));
  const admissionNote = explicitClinicalNotes.find((note) => /initial assessment|admission/i.test(note.type));
  const rawRiskScores = normalizedExtracted.risk_scores || {};
  const riskScores = {
    ...rawRiskScores,
    fall_risk: normalizeRiskEntry(rawRiskScores.fall_risk),
    dvt_risk: normalizeRiskEntry(rawRiskScores.dvt_risk),
    pressure_ulcer_risk: normalizeRiskEntry(rawRiskScores.pressure_ulcer_risk),
    aspiration_risk: normalizeRiskEntry(rawRiskScores.aspiration_risk),
  };
  const derivedComorbidities = dedupeStrings([
    ...(Array.isArray(extractedDiagnosis.comorbidities) ? extractedDiagnosis.comorbidities : []),
    ...secondaryDiagnoses.filter((item) => isComorbidityLikeDiagnosis(item)),
  ]);
  const likelyRealDrg = [
    extractedDiagnosis.drg,
    result.meta?.drg,
    cards.diagnosis_card?.icd_code && /^DRG[:\s]/i.test(cards.diagnosis_card.icd_code) ? cards.diagnosis_card.icd_code : "",
  ].find((value) => looksLikeRealDrg(value));
  const principalDiagnosisText = diagnosisSectionSupported
    ? (cards.diagnosis_card?.principal_diagnosis || extractedDiagnosis.principal || "Diagnosis not identified")
    : "Diagnosis not identified";
  const gatedPrincipalDiagnosisText = diagnosisSectionSupported ? principalDiagnosisText : "";
  const genericPrincipalDiagnosis = isGenericPrincipalDiagnosis(gatedPrincipalDiagnosisText);
  const consultantNote = explicitClinicalNotes.find((note) => /consultant/i.test(note.type));
  const nursingEndorsementNote = explicitClinicalNotes.find((note) => /endorsement/i.test(note.type));
  const diagnosisPresentation = dedupeStrings([
    consultantNote?.summary,
    residentNote?.summary,
    admissionNote?.summary,
    explicitClinicalNotes.find((note) => note.situation)?.situation,
    !genericPrincipalDiagnosis ? sample.summary?.split(".")[0] : "",
  ]).map(toSentence);
  const diagnosisConfirmation = dedupeStrings([
    genericPrincipalDiagnosis && gatedPrincipalDiagnosisText
      ? `Recorded impression in source document: ${gatedPrincipalDiagnosisText}`
      : "",
    consultantNote?.summary,
    nursingEndorsementNote?.assessment,
    sample.admission_date ? `Documented on admission date ${sample.admission_date}` : "",
    result.meta?.pdf_file ? `Source PDF: ${result.meta.pdf_file}` : "",
  ]).map(toSentence);
  const diagnosisConfirmedDate = sample.discharge_date || sample.admission_date || admissionNote?.date || consultantNote?.date || residentNote?.date || "";
  const likelyDiagnosisPhysician = dedupeStrings([
    consultantNote?.author,
    explicitClinicalNotes.find((note) => /doctor|consultant/i.test(note.type) && note.author)?.author,
  ])[0] || "";
  const rawReferenceRanges = cards.vitals_card?.reference_ranges || {
    bp_systolic_normal: "<120",
    bp_diastolic_normal: "<80",
    pulse_normal: "60-100",
    spo2_normal: "≥95%",
    temperature_normal: "97-99°F",
    resp_rate_normal: "12-20/min",
  };
  const systolicLimit = parseNumericReference(rawReferenceRanges.bp_systolic_normal)[0] || 120;
  const diastolicLimit = parseNumericReference(rawReferenceRanges.bp_diastolic_normal)[0] || 80;
  const pulseRange = parseNumericReference(rawReferenceRanges.pulse_normal);
  const spo2Limit = parseNumericReference(rawReferenceRanges.spo2_normal)[0] || 95;
  const tempRange = parseNumericReference(rawReferenceRanges.temperature_normal);
  const respRange = parseNumericReference(rawReferenceRanges.resp_rate_normal);
  const derivedVitalsAlerts = dedupeStrings([
    latestVitals.bp?.systolic && latestVitals.bp.systolic >= systolicLimit
      ? `Systolic BP ${latestVitals.bp.systolic} is above reference ${rawReferenceRanges.bp_systolic_normal}`
      : "",
    latestVitals.bp?.diastolic && latestVitals.bp.diastolic >= diastolicLimit
      ? `Diastolic BP ${latestVitals.bp.diastolic} is above reference ${rawReferenceRanges.bp_diastolic_normal}`
      : "",
    typeof latestVitals.pulse?.value === "number" && pulseRange.length >= 2 &&
      (latestVitals.pulse.value < pulseRange[0] || latestVitals.pulse.value > pulseRange[1])
      ? `Pulse ${latestVitals.pulse.value} is outside reference ${rawReferenceRanges.pulse_normal}`
      : "",
    typeof latestVitals.spo2?.value === "number" && latestVitals.spo2.value < spo2Limit
      ? `SpO2 ${latestVitals.spo2.value}% is below reference ${rawReferenceRanges.spo2_normal}`
      : "",
    typeof latestVitals.temperature?.value === "number" && tempRange.length >= 2 &&
      (latestVitals.temperature.value < tempRange[0] || latestVitals.temperature.value > tempRange[1])
      ? `Temperature ${latestVitals.temperature.value}${latestVitals.temperature.unit || ""} is outside reference ${rawReferenceRanges.temperature_normal}`
      : "",
    typeof latestVitals.resp_rate === "number" && respRange.length >= 2 &&
      (latestVitals.resp_rate < respRange[0] || latestVitals.resp_rate > respRange[1])
      ? `Respiratory rate ${latestVitals.resp_rate}/min is outside reference ${rawReferenceRanges.resp_rate_normal}`
      : "",
  ]).map((message) => ({
    date: document.processedAt || document.uploadedAt || "",
    type: "warning" as const,
    message,
  }));
  const imagingInvestigations = dedupeStrings(
    investigationList.filter((item) => isRadiologyInvestigation(item)).map(cleanClinicalItem)
  );
  const imagingEvidence = dedupeStrings(
    explicitClinicalNotes
      .flatMap((note) => [note.summary, note.assessment, ...note.source_excerpt])
      .map((item) => cleanClinicalItem(String(item || "")))
      .filter((item) => item && isRadiologyInvestigation(item))
  );

  // For prescriptions, use extracted.radiology directly if available
  const extractedRadiology = Array.isArray(extracted.radiology) ? extracted.radiology : [];
  const hasStructuredRadiology = extractedRadiology.length > 0;
  const structuredRadiologyStudies = hasStructuredRadiology
    ? extractedRadiology
        .filter(rad => rad.status === "ordered" || rad.status === "completed" || rad.status === "documented")
        .map(rad => ({
          name: rad.type || rad.study_name || "Imaging study",
          date: document.processedAt || document.uploadedAt,
          performedBy: "Prescription order",
          findings: rad.status === "completed" ? ["Completed"] : ["Ordered"],
          impression: rad.type || rad.study_name || "Imaging study",
          critical: false,
          source: "prescription_extraction"
        }))
    : [];

  const ungatedDocumentedImagingStudies = hasStructuredRadiology
    ? structuredRadiologyStudies
    : imagingEvidence.map((finding, index) => ({
    name: imagingInvestigations.find((study) => {
      const normalizedStudy = study.toLowerCase();
      const normalizedFinding = finding.toLowerCase();
      if (normalizedStudy.includes("ct") && normalizedFinding.includes("ct")) return true;
      if ((normalizedStudy.includes("xray") || normalizedStudy.includes("x-ray")) && (normalizedFinding.includes("xray") || normalizedFinding.includes("x-ray"))) return true;
      if (normalizedStudy.includes("usg") && normalizedFinding.includes("usg")) return true;
      if (normalizedStudy.includes("echo") && normalizedFinding.includes("echo")) return true;
      return false;
    }) || imagingInvestigations[index] || "Imaging finding",
    date: handoverNote?.date || consultantNote?.date || document.processedAt || document.uploadedAt,
    performedBy: consultantNote?.author || likelyDiagnosisPhysician || "Documented in source notes",
    findings: [finding],
    impression: finding,
    critical: isCriticalImagingFinding(finding),
  }));
  const documentedImagingStudies = radiologySectionSupported
    ? (
        radiologySectionProvenance.hasRaw
          ? ungatedDocumentedImagingStudies.filter(
              (study) =>
                matchesProvenanceValue(study.impression, safeRadiologyFindingProvenanceItems) ||
                matchesProvenanceValue(study.name, safeRadiologyFindingProvenanceItems)
            )
          : ungatedDocumentedImagingStudies
      )
    : [];
  // For pending radiology, use extracted.radiology if available
  const structuredPendingRadiology = hasStructuredRadiology
    ? extractedRadiology
        .filter(rad => rad.status === "ordered" || rad.status === "not_selected")
        .map(rad => rad.type || rad.study_name || "Imaging study")
    : [];

  const ungatedPendingImagingStudies = hasStructuredRadiology
    ? structuredPendingRadiology
    : dedupeStrings(
        imagingInvestigations.filter(
          (study) =>
            !ungatedDocumentedImagingStudies.some((documented) => {
              const normalizedStudy = study.toLowerCase();
              const normalizedName = documented.name.toLowerCase();
              const normalizedFinding = documented.impression.toLowerCase();
              return normalizedName.includes(normalizedStudy) || normalizedStudy.includes(normalizedName) || normalizedFinding.includes(normalizedStudy.split(" ")[0]);
            })
        )
      );
  const pendingImagingStudies = radiologySectionSupported
    ? (
        radiologySectionProvenance.hasRaw
          ? ungatedPendingImagingStudies.filter((study) => matchesProvenanceValue(study, safeRadiologyPendingProvenanceItems))
          : ungatedPendingImagingStudies
      )
    : [];
  const formattedMedicationOrders = medicationList
    .slice(0, 5)
    .map((med) => [med.name, med.dose, med.frequency].filter(Boolean).join(" "))
    .filter(Boolean);
  const explicitManagementItems = dedupeStrings(
    Array.isArray(extractedTreatment.management_items) ? extractedTreatment.management_items : []
  );
  // For prescriptions, procedures may be at root level (from handwriting extraction agent)
  const extractedProcedures = extractedTreatment.procedures || normalizedExtracted.procedures || [];
  // Keep full procedure objects for prescriptions (with name, category, is_uncertain, confidence_reason)
  const procedureObjects = Array.isArray(extractedProcedures)
    ? extractedProcedures.map((p: any) => {
        if (typeof p === 'string') {
          return { name: p, details: "", is_uncertain: false };
        }
        return {
          name: p.name || p.toString(),
          category: p.category || "",
          details: p.details || "",
          is_uncertain: Boolean(p.is_uncertain),
          confidence_reason: p.confidence_reason || ""
        };
      })
    : [];
  const explicitProcedures = dedupeStrings(
    procedureObjects.map((p: any) => p.name).filter(Boolean)
  );
  const safeTreatmentCurrentApproach =
    normalizeProvenanceItem(extractedProvenance.treatment?.current_approach) &&
    isSafeProvenanceItem(normalizeProvenanceItem(extractedProvenance.treatment?.current_approach) as ProvenanceItem, ["quoted", "normalized", "derived"])
      ? (normalizeProvenanceItem(extractedProvenance.treatment?.current_approach) as ProvenanceItem).value
      : "";
  const safeTreatmentResponse =
    normalizeProvenanceItem(extractedProvenance.treatment?.response) &&
    isSafeProvenanceItem(normalizeProvenanceItem(extractedProvenance.treatment?.response) as ProvenanceItem, ["quoted", "normalized", "derived"])
      ? (normalizeProvenanceItem(extractedProvenance.treatment?.response) as ProvenanceItem).value
      : "";
  const gatedManagementItems = treatmentSectionProvenance.hasRaw
    ? safeTreatmentManagementItems.map((item) => item.value)
    : explicitManagementItems;
  const gatedProcedures = treatmentSectionProvenance.hasRaw
    ? safeTreatmentProcedureItems.map((item) => item.value)
    : explicitProcedures;
  const riskItems = dedupeStrings([
    riskScores.fall_risk?.level ? `Fall risk ${riskScores.fall_risk.level}` : "",
    riskScores.aspiration_risk?.level ? `Aspiration risk ${riskScores.aspiration_risk.level}` : "",
    riskScores.pressure_ulcer_risk?.level ? `Pressure ulcer risk ${riskScores.pressure_ulcer_risk.level}` : "",
    riskScores.dvt_risk?.level ? `DVT risk ${riskScores.dvt_risk.level}` : "",
    allergies
      .filter((allergen) => !allergen.allergen.toLowerCase().includes("nkf") && !allergen.allergen.toLowerCase().includes("not known"))
      .map((allergen) => `Allergy documented: ${allergen.allergen}`)
      .join(" "),
  ]);
  const buildRiskWatchCitations = (label: string, score: number | null, level: string) => {
    const aliases = riskWatchAliases[label] || [label.toLowerCase()];
    const citations = explicitClinicalNotes.flatMap((note) => {
      const noteCandidates = [
        note.summary,
        note.assessment,
        note.recommendations,
        ...(Array.isArray(note.source_excerpt) ? note.source_excerpt : [])
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const matchingExcerpt = noteCandidates.find((candidate) => {
        const normalized = candidate.toLowerCase();
        const aliasMatch = aliases.some((alias) => normalized.includes(alias));
        const scoreMatch = typeof score === "number" ? normalized.includes(String(score)) : false;
        const levelMatch = level ? normalized.includes(level.toLowerCase()) : false;
        return aliasMatch && (scoreMatch || levelMatch || /risk/.test(normalized));
      });

      if (!matchingExcerpt) return [];
      return [{
        value: `${label}${level ? `: ${level}` : ""}`,
        sourceSection: note.type || "Clinical Note",
        sourceExcerpt: matchingExcerpt,
        sourcePage: null,
        confidence: 0.7,
        provenanceType: "normalized" as const,
      }];
    });

    return dedupeBy(citations, (item) => `${item.sourceSection}|${item.sourceExcerpt}`);
  };
  const riskWatchItems = [
    { label: "Fall", level: riskScores.fall_risk?.level || "", score: riskScores.fall_risk?.score ?? null },
    { label: "Aspiration", level: riskScores.aspiration_risk?.level || "", score: riskScores.aspiration_risk?.score ?? null },
    { label: "Pressure Ulcer", level: riskScores.pressure_ulcer_risk?.level || "", score: riskScores.pressure_ulcer_risk?.score ?? null },
    { label: "DVT", level: riskScores.dvt_risk?.level || "", score: riskScores.dvt_risk?.score ?? null },
  ]
    .filter((item) => item.level)
    .map((item) => ({
      ...item,
      summary: `${item.label}${item.level ? `: ${item.level}` : ""}`,
      citations: buildRiskWatchCitations(item.label, item.score, item.level),
    }));
  const riskWatchSectionProvenance = buildSectionProvenance(
    riskWatchItems.flatMap((item) => item.citations || []),
    ["quoted", "normalized"]
  );
  const elevatedRiskWatchItems = riskWatchItems.filter((item) => /high|moderate/i.test(String(item.level || "")));
  const documentedRiskWatchItems = riskWatchItems.filter((item) => Boolean(normalizeRiskLevel(item.level)));
  const highRiskWatchItems = riskWatchItems.filter((item) => /high/i.test(String(item.level || "")));
  const riskWatchStatus =
    typeof riskScores.ews_score === "number" && riskScores.ews_score >= 5
      ? "critical"
      : highRiskWatchItems.length > 0
        ? "critical"
        : elevatedRiskWatchItems.length > 0 || (typeof riskScores.ews_score === "number" && riskScores.ews_score > 0)
          ? "warning"
          : "normal";
  const riskWatchHeadlineMetric =
    highRiskWatchItems.length > 0
      ? `${highRiskWatchItems.length}`
      : typeof riskScores.ews_score === "number" && riskScores.ews_score > 0
        ? `${riskScores.ews_score}`
        : "0";
  const riskWatchSecondaryLine =
    highRiskWatchItems.length > 0
      ? highRiskWatchItems.length === 1
        ? "high-risk signal"
        : "high-risk signals"
      : elevatedRiskWatchItems.length > 0
        ? elevatedRiskWatchItems.length === 1
          ? "elevated watch item"
          : "elevated watch items"
        : documentedRiskWatchItems.length > 0
          ? documentedRiskWatchItems.length === 1
            ? "watch item documented"
            : "watch items documented"
        : typeof riskScores.ews_score === "number" && riskScores.ews_score > 0
          ? "ews score"
          : "not documented";
  const handoverSections = [
    {
      title: "Presentation",
      tone: "normal" as const,
      items: dedupeStrings([
        handoverNotes.find((note) => note.situation)?.situation,
        handoverNotes.find((note) => /initial assessment|admission/i.test(note.type))?.summary,
        sample.summary && !genericPrincipalDiagnosis ? sample.summary.split(".")[0] : "",
        gatedPrincipalDiagnosisText ? `Primary problem: ${gatedPrincipalDiagnosisText}` : "",
      ]).map(toSentence),
    },
    {
      title: "Assessment",
      tone: "normal" as const,
      items: dedupeStrings([
        handoverNotes.find((note) => note.assessment)?.assessment,
        handoverNotes.find((note) => note.background)?.background,
        gatedPrincipalDiagnosisText
          ? `Diagnosis: ${gatedPrincipalDiagnosisText}${secondaryDiagnoses.length ? ` with ${secondaryDiagnoses.join(", ")}` : ""}`
          : "",
        riskScores.gcs?.total ? `GCS ${riskScores.gcs.total}` : "",
        extracted.functional_status?.mobility_notes || "",
        latestVitals.bp?.systolic && latestVitals.bp?.diastolic
          ? `Latest BP ${latestVitals.bp.systolic}/${latestVitals.bp.diastolic}`
          : "",
        typeof latestVitals.grbs?.value === "number"
          ? `GRBS ${latestVitals.grbs.value}${latestVitals.grbs.interpretation ? ` (${latestVitals.grbs.interpretation})` : ""}`
          : "",
        handoverNotes.find((note) => /handover/i.test(note.type))?.summary,
      ]).map(toSentence),
    },
    {
      title: "Active Plan",
      tone: "normal" as const,
      items: dedupeStrings([
        handoverNotes.find((note) => note.recommendations)?.recommendations,
        handoverNotes.find((note) => /handover/i.test(note.type))?.summary,
        extracted.nursing_needs?.length ? `Current bedside plan: ${extracted.nursing_needs.slice(0, 4).join(", ")}` : "",
        formattedMedicationOrders.length ? `Active medication orders: ${formattedMedicationOrders.join("; ")}` : "",
      ]).map(toSentence),
    },
    {
      title: "Risks To Watch",
      tone: "warning" as const,
      items: dedupeStrings([
        ...riskItems,
        ...handoverNotes.flatMap((note) => note.risk_flags || []),
      ]).map(toSentence),
    },
    {
      title: "Pending / Follow-up",
      tone: "normal" as const,
      items: dedupeStrings([
        ...handoverNotes.flatMap((note) => note.pending_items || []),
        investigationList.length ? `Pending workup: ${investigationList.slice(0, 8).join(", ")}${investigationList.length > 8 ? ` +${investigationList.length - 8} more` : ""}` : "",
        followUpCount > 0 ? `Follow-up appointments documented: ${followUpCount}` : "",
        cards.follow_up_card?.next_appointment ? `Next appointment: ${cards.follow_up_card.next_appointment}` : "",
        handoverNotes.find((note) => note.handed_over_by || note.handed_over_to)
          ? `Handover: ${handoverNotes.find((note) => note.handed_over_by)?.handed_over_by || ""}${handoverNotes.find((note) => note.handed_over_by && note.handed_over_to) ? " to " : ""}${handoverNotes.find((note) => note.handed_over_to)?.handed_over_to || ""}`
          : "",
      ]).map(toSentence),
    },
  ].filter((section) => section.items && section.items.length > 0);
  const handoverOverview =
    handoverSectionProvenance.hasRaw
      ? (
          normalizeProvenanceItem(extractedProvenance.handover?.overview) &&
          isSafeProvenanceItem(normalizeProvenanceItem(extractedProvenance.handover?.overview) as ProvenanceItem, ["quoted", "normalized", "derived"])
            ? (normalizeProvenanceItem(extractedProvenance.handover?.overview) as ProvenanceItem).value
            : ""
        ) ||
        dedupeStrings([
          !genericPrincipalDiagnosis ? sample.summary : "",
          handoverSections.find((section) => section.title === "Assessment")?.items[0],
          handoverSections.find((section) => section.title === "Active Plan")?.items[0],
        ])[0] ||
        "No clinical handover summary available."
      : dedupeStrings([
          !genericPrincipalDiagnosis ? sample.summary : "",
          handoverSections.find((section) => section.title === "Assessment")?.items[0],
          handoverSections.find((section) => section.title === "Active Plan")?.items[0],
        ])[0] || "No clinical handover summary available.";
  const activeManagement = [
    (treatmentSectionSupported && (safeTreatmentCurrentApproach || (!treatmentSectionProvenance.hasRaw ? extractedTreatment.current_approach : "")))
      ? {
          title: "Current Management Approach",
          details: safeTreatmentCurrentApproach || extractedTreatment.current_approach,
          source: treatmentSectionProvenance.hasRaw ? "Treatment provenance" : "Treatment extraction",
        }
      : !treatmentSectionProvenance.hasRaw && handoverNote?.summary
      ? {
          title: "Current Management Approach",
          details: handoverNote.summary,
          source: handoverNote.type,
        }
      : null,
    gatedManagementItems.length
      ? {
          title: "Active Management Items",
          details: gatedManagementItems.slice(0, 8).join(", "),
          source: treatmentSectionProvenance.hasRaw ? "Treatment provenance" : "Treatment extraction",
        }
      : null,
    !treatmentSectionProvenance.hasRaw && extracted.nursing_needs?.length
      ? {
          title: "Bedside Interventions",
          details: extracted.nursing_needs.slice(0, 6).join(", "),
          source: "Nursing needs",
        }
      : null,
    !treatmentSectionProvenance.hasRaw && formattedMedicationOrders.length
      ? {
          title: "Active Therapeutic Orders",
          details: formattedMedicationOrders.join("; "),
          source: "Medication orders",
        }
      : null,
    !treatmentSectionProvenance.hasRaw && investigationList.length
      ? {
          title: "Ongoing Workup",
          details: `Pending investigations include ${investigationList.slice(0, 8).join(", ")}${investigationList.length > 8 ? ` and ${investigationList.length - 8} more` : ""}`,
          source: "Residents Notes",
        }
      : null,
    !treatmentSectionProvenance.hasRaw && admissionNote?.summary
      ? {
          title: "Clinical Context",
          details: admissionNote.summary,
          source: admissionNote.type,
        }
      : null,
  ].filter(Boolean) as Array<{ title: string; details: string; source: string }>;
  const treatmentPlanCount = Math.max(activeManagement.length, procedureObjects.length);
  const currentApproach = safeTreatmentCurrentApproach
    ? safeTreatmentCurrentApproach
    : !treatmentSectionProvenance.hasRaw && extractedTreatment.current_approach
    ? extractedTreatment.current_approach
    : !treatmentSectionProvenance.hasRaw && /conservative management/i.test(handoverNote?.summary || "")
    ? "Conservative management"
      : activeManagement[0]?.details
        ? activeManagement[0].details
      : !treatmentSectionProvenance.hasRaw && cards.treatment_card?.current_approach
        ? cards.treatment_card.current_approach
        : "Not documented";
  const responseEvidence = dedupeStrings([
    safeTreatmentResponse,
    !treatmentSectionProvenance.hasRaw ? extractedTreatment.response : "",
    explicitClinicalNotes
      .map((note) => note.summary)
      .filter((summary) => !treatmentSectionProvenance.hasRaw && /(improving|responding|stable for discharge|stable post|tolerated|no complications)/i.test(summary))
      .join(" "),
  ])[0];
  const responseDocumented = Boolean(responseEvidence);
  const response = responseDocumented
    ? toSentence(responseEvidence)
    : "Not documented";
  const complicationEvidence = dedupeStrings([
    ...(treatmentSectionProvenance.hasRaw ? safeTreatmentComplicationItems.map((item) => item.value) : (Array.isArray(extractedTreatment.complications) ? extractedTreatment.complications : [])),
    explicitClinicalNotes
      .map((note) => note.summary)
      .filter((summary) => !treatmentSectionProvenance.hasRaw && /(complication|bleeding|infection|worsening|deterioration)/i.test(summary))
      .join(" "),
  ])[0];
  const complicationsDocumented = Boolean(complicationEvidence);
  const complicationsLabel = complicationsDocumented
    ? toSentence(complicationEvidence)
    : "Not documented";
  const dischargeEvidenceText = explicitClinicalNotes
    .flatMap((note) => [
      note.summary,
      note.assessment,
      note.recommendations,
      ...note.source_excerpt,
    ])
    .join(" ");
  const dischargePlanExplicitlyAbsent = /discharge plan\s*:\s*no\b/i.test(dischargeEvidenceText);
  const rawDischargeItems = explicitClinicalNotes.flatMap((note) => [
    note.summary,
    ...note.pending_items,
    ...splitDelimitedItems(note.recommendations),
    ...note.source_excerpt,
  ]);
  const dischargePlanningNotes = explicitClinicalNotes.filter((note) =>
    /discharge|education|plan and comments/i.test(note.type)
  );
  const dischargeRecommendationItems = dedupeStrings(
    dischargePlanningNotes.flatMap((note) => splitInstructionList(note.recommendations))
  );
  const dischargeConditionChecks = dedupeStrings([
    explicitClinicalNotes.find((note) => /handover/i.test(note.type))?.summary,
    explicitClinicalNotes.find((note) => /endorsement/i.test(note.type))?.summary,
    explicitClinicalNotes.find((note) => /initial assessment|admission/i.test(note.type))?.assessment,
    explicitClinicalNotes.find((note) => /handover/i.test(note.type))?.assessment,
  ])
    .filter((item) => /(stable|improv|oriented|admitted|chemotherapy|multiple myeloma|discharge|follow-up)/i.test(item || ""))
    .map(toSentence);
  const dischargeDietary = dedupeStrings(
    dischargeSectionProvenance.hasRaw
      ? (extractedProvenance.discharge?.dietary || [])
          .map((item) => normalizeProvenanceItem(item))
          .filter(Boolean)
          .filter((item) => isSafeProvenanceItem(item as ProvenanceItem, ["quoted", "normalized"]))
          .map((item) => formatDietInstruction((item as ProvenanceItem).value))
      : rawDischargeItems
          .filter((item) => isDietInstruction(item))
          .map(formatDietInstruction)
  );
  const dischargePrecautions = dedupeStrings([
    ...explicitClinicalNotes.flatMap((note) => note.risk_flags || []).map(cleanClinicalItem),
    ...explicitClinicalNotes
      .map((note) => note.summary)
      .filter((summary) => /pressure ulcer/i.test(summary))
      .map(() => "Pressure ulcer risk"),
  ]).map(toSentence);
  const dischargeCareInstructions = dedupeStrings([
    ...(dischargeSectionProvenance.hasRaw
      ? (extractedProvenance.discharge?.instructions || [])
          .map((item) => normalizeProvenanceItem(item))
          .filter(Boolean)
          .filter((item) => isSafeProvenanceItem(item as ProvenanceItem, ["quoted", "normalized"]))
          .map((item) => (item as ProvenanceItem).value)
      : dischargeRecommendationItems.filter(
      (item) =>
        !isDietInstruction(item) &&
        !isNonInstructionCareItem(item) &&
        !isInvestigationLikeItem(item) &&
        !isMedicationLikeItem(item) &&
        !isGenericPlanBucket(item) &&
        isPatientInstruction(item)
      )),
  ]).map(toSentence);
  const dischargeRedFlags = dedupeStrings([
    ...(dischargeSectionProvenance.hasRaw
      ? (extractedProvenance.discharge?.red_flags || [])
          .map((item) => normalizeProvenanceItem(item))
          .filter(Boolean)
          .filter((item) => isSafeProvenanceItem(item as ProvenanceItem, ["quoted", "normalized"]))
          .map((item) => (item as ProvenanceItem).value)
      : dischargePlanningNotes.flatMap((note) =>
          [note.summary, note.assessment].flatMap(splitEscalationInstructions)
        )),
  ]);
  const dischargePendingItems = normalizePendingReviewItems([
    ...explicitClinicalNotes.flatMap((note) => note.pending_items || []),
    cards.follow_up_card?.next_appointment ? `Next appointment: ${cards.follow_up_card.next_appointment}` : "",
  ]).map(toSentence);

  // NEW: Add LLM-extracted pending_items
  const llmPendingItems = extracted.pending_items || {};
  const llmLabsPending = llmPendingItems.pending_labs?.map(lab => lab.test_name || lab.reason || "Pending lab") || [];
  const llmRadiologyPending = llmPendingItems.pending_radiology?.map(rad => `${rad.type}${rad.body_part ? ` of ${rad.body_part}` : ''}${rad.scheduled_date ? ` - ${rad.scheduled_date}` : ''}`) || [];
  const llmFollowUpsPending = llmPendingItems.pending_followups?.map(fu => `${fu.department}${fu.provider ? ` with ${fu.provider}` : ''}${fu.date ? ` on ${fu.date}` : ''}${fu.time ? ` at ${fu.time}` : ''}`) || [];
  const dischargeDispositionNote = dischargePlanExplicitlyAbsent
    ? "No explicit discharge disposition was documented in this record. The items below reflect current inpatient care instructions and pending workup."
    : dischargePendingItems.length > 0
      ? "Follow-up and pending items are listed exactly as documented in the source record."
      : "";

  // Merge LLM-extracted pending items with existing pending items
  const allPendingItems = [
    ...dischargePendingItems,
    ...llmLabsPending,
    ...llmRadiologyPending,
    ...llmFollowUpsPending,
    ...(llmPendingItems.pending_discharge_items?.map(item => item.item || item.reason) || []),
  ];
  const dischargeCondition = dischargePlanExplicitlyAbsent
    ? "Not documented"
    : dedupeStrings(
        explicitClinicalNotes
          .flatMap((note) => [note.summary, note.assessment])
          .filter((item) => /(stable|improv|fit for discharge|ready for discharge|oriented)/i.test(item || ""))
      )[0] || "Not documented";
  const followUpAppointments =
    followUpSectionSupported && followUpSectionProvenance.hasRaw
      ? safeFollowUpItems.map((item) => ({
          department: resolveDepartmentLabel(result, document),
          physician: "",
          date: "",
          time: "",
          purpose: toSentence(item.value),
        }))
      : Array.isArray(cards.follow_up_card?.appointments) && cards.follow_up_card.appointments.length > 0
        ? cards.follow_up_card.appointments.map((item) => ({
            department: item.department || resolveDepartmentLabel(result, document),
            physician: item.physician || "",
            date: item.date || "",
            time: item.time || "",
            purpose: item.purpose || "",
          }))
        : Array.isArray(normalizedExtracted.follow_up?.items) && normalizedExtracted.follow_up.items.length > 0
          ? normalizedExtracted.follow_up.items.map((item: any) => ({
              department: resolveDepartmentLabel(result, document),
              physician: "",
              date: "",
              time: "",
              purpose: toSentence(typeof item === "string" ? item : item?.timing || item?.reason || item?.specialty || ""),
            }))
      : cards.follow_up_card?.next_appointment
        ? [{
            department: resolveDepartmentLabel(result, document),
            physician: "",
            date: cards.follow_up_card.next_appointment,
            time: "",
            purpose: "",
          }]
        : [];
  const presentationSummaryCardsRaw = result.presentation?.summary_cards || {};
  const presentationNotesRailRaw = result.presentation?.notes_rail || [];
  const fallbackPresentationSummaryCards: Record<string, PresentationCard> = {
    vitals: {
      section: "vitals",
      title: "Vitals",
      headlineMetric: hasSourceBackedVitals && bp.systolic > 0 && bp.diastolic > 0 ? `${bp.systolic}/${bp.diastolic} mmHg` : "",
      secondaryLine: hasSourceBackedVitals && pulse ? `Pulse ${pulse} bpm` : "",
      supportingPoints: dedupeStrings([
        hasSourceBackedVitals && spo2 ? `SpO2 ${spo2}%` : "",
        hasSourceBackedVitals && (temp || respRate) ? `Temp ${temp || "-"}°F · RR ${respRate || "-"} /min` : "",
        !hasSourceBackedVitals ? "No source-backed vitals documented." : "",
      ]).slice(0, 2),
      status: hasSourceBackedVitals ? mapCardStatus(cards.vitals_card?.status || "normal") : "neutral",
      provenanceStatus: vitalsSectionProvenance.status,
    },
    diagnosis: {
      section: "diagnosis",
      title: "Diagnosis",
      headlineMetric: gatedPrincipalDiagnosisText,
      secondaryLine: cards.diagnosis_card?.icd_code ? `ICD-10 ${cards.diagnosis_card.icd_code}` : "",
      supportingPoints: secondaryDiagnoses.length ? [`+${secondaryDiagnoses.length} secondary`] : [],
      status: "neutral",
      provenanceStatus: diagnosisSectionProvenance.status,
    },
    medications: {
      section: "medications",
      title: "Medications",
      headlineMetric: `${medicationList.length}`,
      secondaryLine: medicationList.length === 1 ? "active medication" : "active medications",
      supportingPoints: medicationList.slice(0, 2).map((med) => med.name || "").filter(Boolean),
      status: allergies.length > 0 ? "warning" : "normal",
      provenanceStatus: medicationsSectionProvenance.status,
    },
    labs: {
      section: "labs",
      title: "Lab Results",
      headlineMetric: `${hasActualLabResults ? labResults.length : investigationList.length}`,
      secondaryLine: hasActualLabResults ? "tests completed" : "tests ordered",
      supportingPoints: dedupeStrings([
        abnormalLabRows.length ? `${abnormalLabRows.length} abnormal` : "",
        criticalLabRows.length ? `${criticalLabRows.length} critical` : "",
      ]).slice(0, 2),
      status: criticalLabRows.length ? "critical" : abnormalLabRows.length ? "warning" : "normal",
      provenanceStatus: labsSectionProvenance.status,
    },
    radiology: {
      section: "radiology",
      title: "Radiology",
      headlineMetric: `${documentedImagingStudies.length}`,
      secondaryLine: documentedImagingStudies.length === 1 ? "finding" : "findings",
      supportingPoints: [
        pendingImagingStudies.length ? `${pendingImagingStudies.length} pending/documented` : "No pending imaging documented",
      ],
      status: documentedImagingStudies.some((study) => study.critical) ? "critical" : "normal",
      provenanceStatus: radiologySectionProvenance.status,
    },
    treatment: {
      section: "treatment",
      title: "Treatment",
      headlineMetric: `${treatmentPlanCount}`,
      secondaryLine: "plan items",
      supportingPoints: dedupeStrings([
        currentApproach,
        procedureObjects.length > 0 ? procedureObjects.slice(0, 2).map((proc: any) => proc.name).join(" · ") : "",
        complicationsLabel,
      ]).slice(0, 2),
      status: complicationsDocumented ? "warning" : "normal",
      provenanceStatus: treatmentSectionProvenance.status,
    },
    care_gaps: {
      section: "pending",
      title: "Care Gaps",
      headlineMetric: `${pendingImagingStudies.length + (extracted.pending_items?.pending_labs?.length || 0) + allPendingItems.length}`,
      secondaryLine:
        pendingImagingStudies.length + (extracted.pending_items?.pending_labs?.length || 0) + allPendingItems.length === 1
          ? "open care gap"
          : "open care gaps",
      supportingPoints: dedupeStrings([
        [extracted.pending_items?.pending_labs?.length ? `${extracted.pending_items.pending_labs.length} labs` : "", pendingImagingStudies.length ? `${pendingImagingStudies.length} imaging` : ""]
          .filter(Boolean)
          .join(" · "),
        allPendingItems.length ? `${allPendingItems.length} discharge actions` : followUpAppointments.length ? `${followUpAppointments.length} follow-up appointments booked` : "Follow-up not scheduled",
      ]).slice(0, 2),
      status:
        followUpAppointments.length === 0 && (pendingImagingStudies.length + (extracted.pending_items?.pending_labs?.length || 0) + allPendingItems.length) > 0
          ? "critical"
          : pendingImagingStudies.length + (extracted.pending_items?.pending_labs?.length || 0) + allPendingItems.length > 0
            ? "warning"
            : "normal",
      provenanceStatus:
        [labsSectionProvenance.status, radiologySectionProvenance.status, dischargeSectionProvenance.status, followUpSectionProvenance.status].includes("source_backed")
          ? "source_backed"
          : [labsSectionProvenance.status, radiologySectionProvenance.status, dischargeSectionProvenance.status, followUpSectionProvenance.status].includes("mixed")
            ? "mixed"
            : [labsSectionProvenance.status, radiologySectionProvenance.status, dischargeSectionProvenance.status, followUpSectionProvenance.status].includes("derived_only")
              ? "derived_only"
              : "insufficient_evidence",
    },
    risk_watch: {
      section: "riskwatch",
      title: "Risk Watch",
      headlineMetric: riskWatchHeadlineMetric,
      secondaryLine: riskWatchSecondaryLine,
      supportingPoints: dedupeStrings([
        elevatedRiskWatchItems.length > 0
          ? elevatedRiskWatchItems.slice(0, 2).map((item) => item.summary).join(" · ")
          : documentedRiskWatchItems
              .slice(0, 2)
              .map((item) => item.summary)
              .join(" · "),
        documentedRiskWatchItems.length === 0 && typeof riskScores.ews_score !== "number" ? "No explicit risk levels documented" : "",
      ]).slice(0, 2),
      status: riskWatchStatus,
      provenanceStatus: riskWatchSectionProvenance.status,
    },
  };
  const choosePresentationHeadlineMetric = (key: string, rawMetric: unknown, fallbackMetric: string) => {
    const metric = String(rawMetric || "").trim();
    if (!metric) return fallbackMetric;

    if (key === "vitals" && !hasSourceBackedVitals) {
      return fallbackMetric;
    }

    if (
      ["treatment", "labs", "radiology"].includes(key) &&
      metric === "0" &&
      fallbackMetric &&
      fallbackMetric !== "0"
    ) {
      return fallbackMetric;
    }

    return metric;
  };
  const choosePresentationSupportingPoints = (key: string, rawPoints: unknown, fallbackPoints: string[]) => {
    const points = Array.isArray(rawPoints) ? rawPoints.filter(Boolean).slice(0, 2) : [];

    if (key === "vitals" && !hasSourceBackedVitals) {
      return fallbackPoints;
    }

    if (["treatment", "labs", "radiology"].includes(key) && points.length === 0 && fallbackPoints.length > 0) {
      return fallbackPoints;
    }

    return points.length > 0 ? points : fallbackPoints;
  };
  const normalizedPresentationSummaryCards = Object.fromEntries(
    Object.entries(presentationSummaryCardsRaw).map(([key, card]) => [
      key,
      {
        section: card?.section || key,
        title: card?.title || fallbackPresentationSummaryCards[key]?.title || key,
        headlineMetric: choosePresentationHeadlineMetric(key, card?.headline_metric, fallbackPresentationSummaryCards[key]?.headlineMetric || ""),
        secondaryLine: card?.secondary_line || fallbackPresentationSummaryCards[key]?.secondaryLine || "",
        supportingPoints: choosePresentationSupportingPoints(key, card?.supporting_points, fallbackPresentationSummaryCards[key]?.supportingPoints || []),
        status: mapCardStatus(card?.status || fallbackPresentationSummaryCards[key]?.status),
        provenanceStatus: mapPresentationStatus(card?.provenance_status) || fallbackPresentationSummaryCards[key]?.provenanceStatus || "insufficient_evidence",
      } satisfies PresentationCard,
    ])
  ) as Record<string, PresentationCard>;
  const presentationSummaryCards =
    Object.keys(normalizedPresentationSummaryCards).length > 0
      ? { ...fallbackPresentationSummaryCards, ...normalizedPresentationSummaryCards, risk_watch: fallbackPresentationSummaryCards.risk_watch }
      : fallbackPresentationSummaryCards;
  const fallbackNotesRail: PresentationRailItem[] = (Array.isArray(handoverNotes) ? handoverNotes : [])
    .slice(0, 6)
    .map((note) => ({
      title: note.type || "Clinical Note",
      author: note.author || note.handed_over_by || note.handed_over_to || "Clinical Team",
      timestamp: note.date || "",
      body: note.summary || note.assessment || note.recommendations || note.situation || note.background || "",
      priority: note.risk_flags?.length ? "warning" : "normal",
      category: /handover/i.test(note.type) ? "handover" : /nurse|endorsement/i.test(note.type) ? "nurse" : "doctor",
      provenance: (Array.isArray(note.source_excerpt) ? note.source_excerpt : [])
        .map((item) => ({
          value: item,
          sourceSection: note.type || "Clinical Note",
          sourceExcerpt: item,
          sourcePage: null,
          confidence: 0.7,
          provenanceType: "normalized" as const,
        }))
        .filter((item) => item.value && item.sourceExcerpt),
    }))
    .filter((item) => !isLowValuePresentationNote(item))
    .slice(0, 4);
  const presentationNotesRail =
    Array.isArray(presentationNotesRailRaw) && presentationNotesRailRaw.length > 0
      ? presentationNotesRailRaw
          .map((item) => ({
            title: String(item.title || "Clinical Note"),
            author: (() => {
              const author = String(item.author || "").trim();
              return !author || /^unknown author$/i.test(author) ? "Clinical Team" : author;
            })(),
            timestamp: String(item.timestamp || ""),
            body: String(item.body || ""),
            priority: item.priority || "normal",
            category: item.category || "doctor",
            provenance: (Array.isArray(item.provenance) ? item.provenance : [])
              .map((entry) => normalizeProvenanceItem(entry))
              .filter(Boolean) as ProvenanceItem[],
          }))
          .filter((item) => !isLowValuePresentationNote(item))
      : fallbackNotesRail;

  return {
    meta: {
      reportId: document.id,
      generatedAt: document.processedAt || document.uploadedAt,
      version: "gemma-processed",
    },
    patient: {
      id: document.id,
      name: sampleName,
      age: sampleAge,
      gender: firstNonEmptyString(normalizedExtracted.patient?.gender, normalizedExtracted.stage1?.patient?.gender),
      weight: weightValue > 0 ? { value: weightValue, unit: weightUnit || "kg" } : null,
      dateOfBirth: "",
      mrn: resolvedPatientMrn,
      bloodGroup: "",
      contact: {
        phone: "",
        email: "",
        emergencyContact: "",
      },
    },
    admission: {
      id: document.id,
      admissionDate: /^IPD$/i.test(visitType) ? (sample.admission_date || result.meta?.rx_date || "") : (sample.admission_date || ""),
      dischargeDate: sample.discharge_date || null,
      lengthOfStay: sampleLosDays,
      department: resolveDepartmentLabel(result, document),
      ward: "",
      bed: "",
      attendingPhysician: {
        id: "",
        name: likelyDiagnosisPhysician || "",
        specialization: "",
      },
      admissionType: "",
      admissionDiagnosis: gatedPrincipalDiagnosisText,
    },
    vitals: {
      latest: {
        bloodPressure: { systolic: bp.systolic, diastolic: bp.diastolic, unit: "mmHg" },
        heartRate: { value: pulse, unit: "bpm" },
        temperature: { value: temp, unit: "°F" },
        respiratoryRate: { value: respRate, unit: "/min" },
        spo2: { value: spo2, unit: "%" },
        weight: { value: weightValue, unit: weightUnit || "kg" },
        painScore: { value: painScore, scale: 10 },
      },
      status: cards.vitals_card?.status || "stable",
      trend: cards.vitals_card?.trend || "stable",
      // Use actual readings from extraction if available, otherwise create placeholder
      history: Array.isArray(cards.vitals_card?.readings) && cards.vitals_card.readings.length > 0
        ? cards.vitals_card.readings.map(r => ({
            date: r.date || "Unknown",
            bp: r.bp_systolic && r.bp_diastolic ? `${r.bp_systolic}/${r.bp_diastolic}` : `${bp.systolic}/${bp.diastolic}`,
            hr: r.pulse || pulse,
            temp: r.temperature || temp,
            spo2: r.spo2 || spo2,
            rr: r.resp_rate || respRate
          }))
        : [
            { date: "Single Reading", bp: `${bp.systolic}/${bp.diastolic}`, hr: pulse, temp, spo2, rr: respRate }
          ],
      alerts: derivedVitalsAlerts,
      referenceRanges: rawReferenceRanges
    },
    diagnosis: {
      principal: {
        code: cards.diagnosis_card?.icd_code || extractedDiagnosis.icd_code || "",
        description: gatedPrincipalDiagnosisText,
        confirmedDate: diagnosisConfirmedDate,
        presentation: diagnosisPresentation,
        confirmation: diagnosisConfirmation,
        treatingPhysician: likelyDiagnosisPhysician,
      },
      secondary: secondaryDiagnoses.map((description, index) => ({
        code: "",
        description,
        status: isComorbidityLikeDiagnosis(description) ? "Chronic / relevant history" : "",
        history: "",
      })),
      comorbidities: derivedComorbidities,
      drg: likelyRealDrg || "",
    },
    medications: {
      active: medicationList
        .filter((med) =>
          !medicationsSectionProvenance.hasRaw ||
          medicationsSectionProvenance.items.some((item) => item.value.toLowerCase() === String(med.name || "").toLowerCase())
        )
        .map(med => ({
        name: med.name,
        dose: med.dose || "As per order",
        frequency: med.frequency || "As per order",
        route:
          med.name?.toUpperCase().includes("IV") ||
          med.name?.toUpperCase().includes("INJ") ||
          med.name?.toUpperCase().includes("INJECTION")
            ? "IV/Injection"
            : "Oral",
        start: "",
        instructions: "",
        // Preserve item master mapping if present
        ...(med._itemMaster ? { _itemMaster: med._itemMaster } : {}),
        ...(med.category ? { category: med.category } : {}),
        ...(med.is_uncertain !== undefined ? { is_uncertain: med.is_uncertain } : {}),
        ...(med.verification_confidence ? { verification_confidence: med.verification_confidence } : {}),
        })),
      allergies,
      changes: {
        added: [],
        adjusted: [],
        discontinued: [],
      },
      interactionCheck: "",
    },
    labs: {
      totalTests: hasActualLabResults ? labResults.length : investigationList.length,
      abnormalCount: abnormalLabRows.length,
      criticalCount: criticalLabRows.length,
      pendingCount: hasActualLabResults ? 0 : investigationList.length,
      // Use actual lab results from the document
      lab_results: labResults,
      // Use actual investigations from the document
      investigations: investigationList,
      hasResults: hasActualLabResults,
      note: cards.labs_card?.note || "",
      critical: criticalLabRows.map((result) => ({
        test: result.test || "Critical lab",
        result: result.value || "See uploaded report",
        reference: result.reference || "",
        status: "CRITICAL",
        date: "",
      })),
      abnormal: abnormalLabRows.map((result) => ({
        test: result.test || "Abnormal lab",
        result: result.value || "See uploaded report",
        reference: result.reference || "",
        date: "",
      })),
      cbc: [],
      metabolic: [],
      troponinTrend: [],
      pending: extracted.pending_items?.pending_labs?.map(lab => lab.test_name || lab.reason || "Pending lab") || [],
    },
    radiology: {
      completedStudies: documentedImagingStudies.length,
      pendingStudies: pendingImagingStudies.length,
      criticalFindings: documentedImagingStudies.filter((study) => study.critical).length,
      studies: documentedImagingStudies,
      pending: [
        ...pendingImagingStudies,
        ...(extracted.pending_items?.pending_radiology?.map(rad => `${rad.type}${rad.body_part ? ` of ${rad.body_part}` : ''}${rad.scheduled_date ? ` - ${rad.scheduled_date}` : ''}`) || [])
      ],
    },
    treatment: {
      // For prescriptions, use full procedure objects; for chart notes, use gatedProcedures strings
      procedures: procedureObjects.length > 0
        ? procedureObjects.map((proc: any) => ({
            name: proc.name,
            date: handoverNote?.date || consultantNote?.date || "",
            physician: likelyDiagnosisPhysician || "",
            details: proc.details || `${proc.category ? proc.category + ': ' : ''}${proc.is_uncertain ? '(Uncertain) ' : ''}${proc.confidence_reason || ''}`.trim(),
            is_uncertain: proc.is_uncertain || false,
            category: proc.category || "",
          }))
        : gatedProcedures.map((name) => ({
            name,
            date: handoverNote?.date || consultantNote?.date || "",
            physician: likelyDiagnosisPhysician || "",
            details: "",
          })),
      activeManagement,
      currentApproach,
      response,
      responseDocumented,
      complications: 0,
      complicationsDocumented,
      complicationsLabel,
    },
    riskWatch: {
      ewsScore: typeof riskScores.ews_score === "number" ? riskScores.ews_score : null,
      items: riskWatchItems,
    },
    clinicalNotes: {
      totalNotes,
      lastUpdate: cards.clinical_notes_card?.last_update || document.processedAt || document.uploadedAt,
      notes: handoverNotes,
      handover: {
        overview: handoverOverview,
        sections: handoverSections,
      },
    },
    dischargePlan: {
      condition: dischargeCondition,
      conditionChecks: dischargeConditionChecks,
      dietary: dischargeDietary,
      activityRestrictions: {
        doNot: dischargePrecautions,
        okToDo: dischargeCareInstructions,
        duration: "Documented plan",
        afterRestriction: dischargeDispositionNote,
      },
      pendingItems: allPendingItems,
      redFlags: dischargeRedFlags,
    },
    // NEW: Add pending_items_summary for easy access
    pending_items_summary: {
      pending_labs: llmLabsPending,
      pending_radiology: llmRadiologyPending,
      pending_followups: llmFollowUpsPending,
      medication_reconciliation: llmPendingItems.medication_reconciliation,
      summary: llmPendingItems.summary || { total_pending: 0, needs_attention: 0, scheduled: 0, complete: 0 },
    },
    followUp: followUpAppointments,
    presentation: {
      summaryCards: presentationSummaryCards,
      notesRail: presentationNotesRail,
    },
    // Add masked image URL for privacy verification
    // Check both new format (result.masked_image_url) and legacy format (result.meta.stage2_masking.masked_image_path)
    maskedImageUrl: resolveMaskedImageUrl(
      result.masked_image_url,
      result.masked_image_path || result.meta?.stage2_masking?.masked_image_path
    ),
    maskedImagePath: result.masked_image_path || result.meta?.stage2_masking?.masked_image_path || null,
    maskedImagePages: resolveMaskedImagePages(result.masked_image_pages || result.meta?.stage2_masking?.review_pages),
    pharmacyAlert: result.pharmacy_alert || null,
    departmentAlerts: result.department_alerts || null,
    provenance: {
      sections: {
        vitals: vitalsSectionProvenance,
        diagnosis: diagnosisSectionProvenance,
        medications: medicationsSectionProvenance,
        labs: labsSectionProvenance,
        radiology: radiologySectionProvenance,
        treatment: treatmentSectionProvenance,
        riskwatch: riskWatchSectionProvenance,
        handover: handoverSectionProvenance,
        followup: followUpSectionProvenance,
        discharge: dischargeSectionProvenance,
      },
    },
    cardActivation: getCardActivationStates(document),
  };
  } catch (error) {
    console.error('[transformProcessedDocument] Error:', error);
    console.error('[transformProcessedDocument] Document:', document);
    console.error('[transformProcessedDocument] Error stack:', error instanceof Error ? error.stack : 'No stack');
    // Return minimal safe data structure
    return getFallbackDashboardData(document) as DashboardPatientData;
  }
};

// Note: Fallback data removed to prevent bundling mock data in production
// The UI handles null/missing data appropriately
