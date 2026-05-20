import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AudioLines, ClipboardList, Eye, FileText, FileStack, RefreshCw, Search, Sparkles, Trash2, Upload, Key } from "lucide-react";

import AppShellHeader from "@/components/auth/AppShellHeader";
import AuditTrailSheet from "@/components/dashboard/AuditTrailSheet";
import { HandwritingCompletionDialog } from "@/components/dashboard/HandwritingCompletionDialog";
import ProcessingInsights from "@/components/dashboard/ProcessingInsights";
import PharmacyAlertBadge from "@/components/dashboard/PharmacyAlertBadge";
import DepartmentAlertBadge from "@/components/dashboard/DepartmentAlertBadge";
import VoiceDictationWorkspace from "@/components/voice/VoiceDictationWorkspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch, createAuthenticatedEventSource, parseApiPayload } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import {
  API_BASE,
  getProcessedDocumentMrn,
  getProcessedDocumentPatientName,
  matchesProcessedDocumentQuery,
  type ProcessedDocument,
  type QueueStatus,
} from "@/lib/processedDocuments";
import { fetchLandingAnalyticsOverview, type LandingAnalyticsOverview } from "@/lib/landingAnalytics";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

type QueueTab = "all" | "queued" | "processed" | "failed" | "partial";
type IntakeWorkspace = "documents" | "voice";

const statusClasses: Record<QueueStatus, string> = {
  queued: "border-transparent bg-emerald-50 text-emerald-700",
  queued_for_extraction: "border-transparent bg-indigo-50 text-indigo-700",
  processing: "border-transparent bg-amber-50 text-amber-700",
  processed: "border-transparent bg-blue-50 text-blue-700",
  failed: "border-transparent bg-red-50 text-red-700",
  partial: "border-transparent bg-purple-50 text-purple-700",
  transcribing: "border-transparent bg-indigo-50 text-indigo-700",
  review_required: "border-transparent bg-orange-50 text-orange-700",
};

const statusLabels: Record<QueueStatus, string> = {
  queued: "Queued",
  queued_for_extraction: "Queued for Extraction",
  processing: "Processing",
  processed: "Processed",
  failed: "Failed",
  partial: "Needs API Key",
  transcribing: "Transcribing",
  review_required: "Approval Required",
};

const PRIMARY_TEAL_BUTTON =
  "border-teal-600 bg-teal-600 text-white hover:border-teal-700 hover:bg-teal-700";
const SECONDARY_TEAL_BUTTON =
  "border-teal-200 bg-teal-50 text-teal-800 hover:border-teal-300 hover:bg-teal-100";
const ICON_TEAL_BUTTON =
  "border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 hover:text-teal-800";
const TEAL_TABS_TRIGGER =
  "rounded-lg text-teal-800 data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=active]:shadow-none";

const UploadCenter = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const isAdmin = user?.role === "admin";

  const [documents, setDocuments] = useState<ProcessedDocument[]>([]);
  const [activeTab, setActiveTab] = useState<QueueTab>("all");
  const [workspace, setWorkspace] = useState<IntakeWorkspace>("documents");
  const [searchValue, setSearchValue] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [analyticsOverview, setAnalyticsOverview] = useState<LandingAnalyticsOverview | null>(null);
  const [processingProgress, setProcessingProgress] = useState<Record<string, {
    stepNumber: number;
    totalSteps: number;
    tokensUsed: number;
    stepName: string;
  }>>({});
  const [geminiApiKey, setGeminiApiKey] = useState("");

  // Handwriting completion dialog state
  const [handwritingDialog, setHandwritingDialog] = useState<{
    open: boolean;
    documentId: string;
    documentName: string;
    maskedImageUrl?: string;
    maskedImagePages?: Array<{
      pageNumber: number;
      imageUrl: string;
      imageRole: "masked" | "original";
    }>;
    phiRegions?: Array<{
      type: string;
      bounding_box: { x: number; y: number; width: number; height: number };
    }>;
    stage3Policy?: string;
    stage3TriggerReason?: string;
  }>({
    open: false,
    documentId: "",
    documentName: "",
    maskedImagePages: [],
  });

  const logClientStage = (
    level: "log" | "info" | "warn" | "error",
    message: string,
    details?: unknown
  ) => {
    const timestamp = new Date().toISOString();
    const prefix = `[UploadCenter][${timestamp}] ${message}`;
    if (details === undefined) {
      console[level](prefix);
      return;
    }
    console[level](prefix, details);
  };

  const loadDocuments = async () => {
    const response = await apiFetch(`${API_BASE}/documents`);
    if (!response.ok) {
      throw new Error("Unable to load uploaded documents.");
    }
    const payload = await response.json();
    setDocuments(payload.documents ?? []);
  };

  const loadAnalytics = async () => {
    if (!isAdmin) {
      setAnalyticsOverview(null);
      return;
    }
    const overview = await fetchLandingAnalyticsOverview();
    setAnalyticsOverview(overview);
  };

  useEffect(() => {
    loadDocuments()
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Unable to load uploaded documents.");
      })
      .finally(() => {
        setIsLoadingDocuments(false);
      });

    loadAnalytics()
      .catch((error) => {
        if (isAdmin) {
          toast.error(error instanceof Error ? error.message : "Unable to load processing insights.");
        }
      })
      .finally(() => {
        setIsLoadingAnalytics(false);
      });
  }, [isAdmin]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => (documents || []).some((document) => document.id === id)));
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    if (!documents || !Array.isArray(documents)) return [];
    return documents.filter((document) => {
      const matchesTab =
        activeTab === "all" ||
        (activeTab === "queued" && (document.status === "queued" || document.status === "queued_for_extraction")) ||
        (activeTab === "processed" && document.status === "processed") ||
        (activeTab === "failed" && document.status === "failed") ||
        (activeTab === "partial" && document.status === "partial");
      return matchesTab && matchesProcessedDocumentQuery(document, searchValue);
    });
  }, [activeTab, documents, searchValue]);

  const stats = useMemo(() => {
    if (!documents || !Array.isArray(documents)) {
      return { total: 0, queued: 0, processing: 0, processed: 0, failed: 0, partial: 0, transcribing: 0, review_required: 0 };
    }
    return {
      total: documents.length,
      queued: documents.filter((document) => document.status === "queued" || document.status === "queued_for_extraction").length,
      processing: documents.filter((document) => document.status === "processing" || document.status === "transcribing").length,
      processed: documents.filter((document) => document.status === "processed").length,
      failed: documents.filter((document) => document.status === "failed").length,
      partial: documents.filter((document) => document.status === "partial").length,
      transcribing: documents.filter((document) => document.status === "transcribing").length,
      review_required: documents.filter((document) => document.status === "review_required").length,
    };
  }, [documents]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedDocuments = useMemo(
    () => (documents || []).filter((document) => selectedIdSet.has(document.id)),
    [documents, selectedIdSet],
  );
  const visibleSelectableIds = useMemo(
    () => filteredDocuments.filter((document) => document.status !== "processing" && document.status !== "transcribing").map((document) => document.id),
    [filteredDocuments],
  );
  const selectedVisibleCount = useMemo(
    () => visibleSelectableIds.filter((id) => selectedIdSet.has(id)).length,
    [selectedIdSet, visibleSelectableIds],
  );
  const allVisibleSelected = visibleSelectableIds.length > 0 && selectedVisibleCount === visibleSelectableIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const selectedQueuedDocuments = useMemo(
    () => selectedDocuments.filter((document) => document.status === "queued" || document.status === "queued_for_extraction"),
    [selectedDocuments],
  );
  const selectedProcessingCount = useMemo(
    () => (selectedDocuments || []).filter((document) => document.status === "processing" || document.status === "transcribing").length,
    [selectedDocuments],
  );
  // Include transcribing in the active processing count for the canProcessSelected check
  const activeProcessingCount = stats.processing + stats.transcribing;
  const canProcessSelected = selectedQueuedDocuments.length > 0 && activeProcessingCount === 0 && !isProcessingBatch;
  const canDeleteSelected = selectedIds.length > 0 && selectedProcessingCount === 0 && !isProcessingBatch;

  const openFilePicker = () => {
    const input = inputRef.current;
    if (!input) return;
    if ("showPicker" in input && typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
    input.click();
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const pdfFiles = files.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));

    if (pdfFiles.length === 0) {
      toast.error("Only PDF files are supported.");
      return;
    }
    if (pdfFiles.length !== files.length) {
      toast.warning("Non-PDF files were skipped.");
    }

    const formData = new FormData();
    pdfFiles.forEach((file) => formData.append("files", file));

    try {
      setIsUploading(true);
      logClientStage("info", `Uploading ${pdfFiles.length} PDF file(s)`, {
        files: pdfFiles.map((file) => ({ name: file.name, size: file.size })),
      });
      const response = await apiFetch(`${API_BASE}/documents/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        logClientStage("error", "Upload request failed", { status: response.status, statusText: response.statusText });
        throw new Error("Upload failed.");
      }

      const result = await response.json();
      const { documents: uploaded, duplicates = [] } = result;
      logClientStage("info", "Upload request completed", {
        uploaded: uploaded.map((doc: ProcessedDocument) => ({ id: doc.id, name: doc.name, status: doc.status })),
        duplicates,
      });

      await loadDocuments();
      setActiveTab("all");

      // Show results
      if (uploaded.length > 0) {
        toast.success(`${uploaded.length} PDF${uploaded.length > 1 ? "s" : ""} added to the queue.`);
      }

      // Show duplicates info
      if (duplicates.length > 0) {
        const duplicateNames = duplicates.map((d: { name: string }) => d.name).join(", ");
        toast.info(`${duplicates.length} duplicate file${duplicates.length > 1 ? "s were" : " was"} skipped: ${duplicateNames}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await handleFiles(event.target.files);
    event.target.value = "";
  };

  const toggleSelection = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((currentId) => currentId !== id);
    });
  };

  const toggleVisibleSelection = (checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...visibleSelectableIds]));
      }
      const visibleSet = new Set(visibleSelectableIds);
      return current.filter((id) => !visibleSet.has(id));
    });
  };

  const processDocuments = async (queuedDocuments: ProcessedDocument[]) => {
    if (queuedDocuments.length === 0) return;

    setIsProcessingBatch(true);
    setProcessingProgress({});
    logClientStage("info", `Starting batch processing for ${queuedDocuments.length} document(s)`, {
      documents: queuedDocuments.map((document) => ({ id: document.id, name: document.name, status: document.status })),
      hasGeminiApiKey: Boolean(geminiApiKey),
    });

    // Voice documents are now processed through the standard SSE pipeline
    // They've already been transcribed in the voice dictation workflow
    const voiceDocs = queuedDocuments.filter(d => d.documentType === 'voice');
    const pdfDocs = queuedDocuments.filter(d => d.documentType !== 'voice');

    // Process all documents (both voice and PDF) through the standard pipeline
    const allDocs = [...voiceDocs, ...pdfDocs];

    if (allDocs.length === 0) {
      setIsProcessingBatch(false);
      await loadAnalytics();
      return;
    }

    // Gemma 31B is currently stable only when inpatient/discharge runs are serialized.
    const MAX_CONCURRENT = 1;
    const chunks = [];
    for (let i = 0; i < allDocs.length; i += MAX_CONCURRENT) {
      chunks.push(allDocs.slice(i, i + MAX_CONCURRENT));
    }

    try {
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        logClientStage("info", `Dispatching processing chunk ${chunkIndex + 1}/${chunks.length}`, {
          chunkSize: chunk.length,
          documents: chunk.map((document) => ({ id: document.id, name: document.name })),
        });

        setDocuments((current) =>
          current.map((document) =>
            chunk.some(d => d.id === document.id)
              ? { ...document, status: "processing" }
              : document
          ),
        );

        await new Promise(resolve => setTimeout(resolve, 100));

        await Promise.all(chunk.map(async (document) => {
        try {
          const eventSourceUrl = geminiApiKey
            ? `${API_BASE}/documents/process/progress?documentId=${document.id}&geminiApiKey=${encodeURIComponent(geminiApiKey)}`
            : `${API_BASE}/documents/process/progress?documentId=${document.id}`;
          logClientStage("info", `Opening SSE stream for ${document.name}`, {
            documentId: document.id,
            hasGeminiApiKey: Boolean(geminiApiKey),
          });
          const eventSource = createAuthenticatedEventSource(eventSourceUrl);

          eventSource.onopen = () => {
            logClientStage("info", `SSE stream opened for ${document.name}`, { documentId: document.id });
          };

          eventSource.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              logClientStage("info", `SSE event for ${document.name}`, {
                documentId: document.id,
                type: data.type,
                stage: data.stage,
                step: data.step || data.stepName,
                stepNumber: data.stepNumber,
                totalSteps: data.totalSteps,
                status: data.status,
                tokens: data.data?.tokens,
                tokensUsed: data.tokensUsed,
                error: data.error,
              });
              switch (data.type) {
                case 'start':
                  setProcessingProgress(prev => ({
                    ...prev,
                    [document.id]: {
                      stepNumber: prev[document.id]?.stepNumber || 0,
                      totalSteps: data.totalSteps || 5,
                      tokensUsed: prev[document.id]?.tokensUsed || 0,
                      stepName: data.stage === 'stage1' ? 'Processing Header' :
                                data.stage === 'stage2' ? 'Masking PHI' :
                                data.stage === 'stage3' ? 'Extracting Handwriting' :
                                data.stage === 'stage4' ? 'Integrating Data' :
                                'Starting...'
                    }
                  }));
                  break;
                case 'step':
                  setProcessingProgress(prev => ({
                    ...prev,
                    [document.id]: {
                      stepNumber: data.stepNumber || prev[document.id]?.stepNumber || 1,
                      totalSteps: data.totalSteps || prev[document.id]?.totalSteps || 5,
                      tokensUsed: (prev[document.id]?.tokensUsed || 0) + (data.data?.tokens || 0),
                      stepName: formatStepName(data.step || data.stepName || 'Processing')
                    }
                  }));
                  break;
                case 'stage_complete':
                  // Backend sends 'stage_complete' for individual stage completion
                  // Update progress to show stage is done
                  setProcessingProgress(prev => ({
                    ...prev,
                    [document.id]: {
                      stepNumber: prev[document.id]?.stepNumber || data.stepNumber || 0,
                      totalSteps: prev[document.id]?.totalSteps || data.totalSteps || 5,
                      tokensUsed: prev[document.id]?.tokensUsed || 0,
                      stepName: `${data.stage === 'stage1' ? 'Header' :
                                  data.stage === 'stage2' ? 'PHI Masking' :
                                  data.stage === 'stage3' ? 'Handwriting' :
                                  data.stage === 'stage4' ? 'Integration' : 'Stage'} complete`
                    }
                  }));
                  break;
                case 'complete':
                  setProcessingProgress(prev => ({
                    ...prev,
                    [document.id]: {
                      stepNumber: prev[document.id]?.stepNumber || data.totalSteps || 0,
                      totalSteps: prev[document.id]?.totalSteps || data.totalSteps || 5,
                      tokensUsed: Math.max(prev[document.id]?.tokensUsed || 0, data.tokensUsed || 0),
                      stepName: 'Finalizing'
                    }
                  }));
                  break;
                case 'done':
                  logClientStage("info", `Processing completed for ${document.name}`, {
                    documentId: document.id,
                    finalStatus: data.document?.status,
                  });
                  setDocuments((current) =>
                    current.map((doc) =>
                      doc.id === document.id ? { ...data.document } : doc
                    ),
                  );
                  // Clear progress state when done
                  setProcessingProgress(prev => {
                    const newProgress = { ...prev };
                    delete newProgress[document.id];
                    return newProgress;
                  });
                  eventSource.close();
                  break;
                case 'error':
                  logClientStage("error", `Processing failed for ${document.name}`, {
                    documentId: document.id,
                    error: data.error,
                  });
                  toast.error(`${document.name}: ${data.error}`);
                  setDocuments((current) =>
                    current.map((doc) =>
                      doc.id === document.id
                        ? { ...doc, status: "failed" as const, error: data.error }
                        : doc
                    ),
                  );
                  // Clear progress state on error
                  setProcessingProgress(prev => {
                    const newProgress = { ...prev };
                    delete newProgress[document.id];
                    return newProgress;
                  });
                  eventSource.close();
                  break;
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          };

          eventSource.onerror = async () => {
            logClientStage("warn", `SSE stream error/closed for ${document.name}`, { documentId: document.id });
            // Trigger immediate refresh to ensure UI state is up-to-date
            try {
              const response = await apiFetch(`${API_BASE}/documents`);
              if (response.ok) {
                const payload = await response.json();
                const docs = payload?.documents;
                if (docs && Array.isArray(docs)) {
                  const currentDoc = docs.find((d: any) => d.id === document.id);
                  if (currentDoc) {
                    setDocuments((current) =>
                      current.map((doc) =>
                        doc.id === document.id ? currentDoc : doc
                      ),
                    );
                    // Clear progress if document is in terminal state
                    if (currentDoc.status === 'processed' || currentDoc.status === 'failed' || currentDoc.status === 'partial' || currentDoc.status === 'review_required') {
                      setProcessingProgress(prev => {
                        const newProgress = { ...prev };
                        delete newProgress[document.id];
                        return newProgress;
                      });
                    }
                  }
                }
              }
            } catch (e) {
              console.error('Error refreshing document state after SSE error:', e);
            }
            eventSource.close();
          };

          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              clearInterval(checkInterval);
              clearTimeout(timeoutId);
              eventSource.close();
              resolve();
            };

            const checkInterval = setInterval(async () => {
              try {
                const response = await apiFetch(`${API_BASE}/documents`);
                if (response.ok) {
                  const payload = await response.json();
                  const docs = payload?.documents;
                  if (!docs || !Array.isArray(docs)) {
                    return;
                  }
                  const currentDoc = docs.find((d: any) => d.id === document.id);
                  // Terminal states: processed, failed, partial, review_required
                  if (currentDoc && (currentDoc.status === 'processed' || currentDoc.status === 'failed' || currentDoc.status === 'partial' || currentDoc.status === 'review_required')) {
                    logClientStage("info", `Polling observed terminal state for ${document.name}`, {
                      documentId: document.id,
                      status: currentDoc.status,
                      error: currentDoc.error,
                    });
                    clearInterval(checkInterval);
                    setDocuments((current) =>
                      current.map((doc) =>
                        doc.id === document.id ? currentDoc : doc
                      ),
                    );
                    // Clear progress state when done
                    setProcessingProgress(prev => {
                      const newProgress = { ...prev };
                      delete newProgress[document.id];
                      return newProgress;
                    });
                    finish();
                  }
                }
              } catch (e) {
                logClientStage("warn", `Polling error for ${document.name}`, {
                  documentId: document.id,
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            }, 2000);

            const timeoutId = setTimeout(() => {
              logClientStage("warn", `Processing timeout reached for ${document.name}`, {
                documentId: document.id,
                timeoutMs: 300000,
              });
              finish();
            }, 300000);
          });

        } catch (error) {
          logClientStage("error", `Processing request failed for ${document.name}`, {
            documentId: document.id,
            error: error instanceof Error ? error.message : String(error),
          });
            toast.error(`${document.name}: ${error instanceof Error ? error.message : 'Processing failed'}`);
          }
        }));
      }
    } finally {
      // Ensure cleanup always runs, even if processing fails
      await loadDocuments();
      await loadAnalytics();
      setIsProcessingBatch(false);
      setProcessingProgress({});
      logClientStage("info", "Batch processing cleanup completed");
    }

    logClientStage("info", "Batch processing flow completed");
    toast.success(`Batch processing complete.`);
  };

  const handleProcessSelected = async () => {
    await processDocuments(selectedQueuedDocuments);
  };

  const handleReprocess = async (documentId: string) => {
    if (!documents || !Array.isArray(documents)) return;
    const document = documents.find((d) => d.id === documentId);
    if (!document) return;

    try {
      setIsProcessingBatch(true);
      logClientStage("info", `Reprocessing failed document: ${document.name}`, { documentId });
      await processDocuments([document]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reprocess failed.");
    }
  };

  const formatStepName = (step: string) => {
    return step.split(/[_-]+/).filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const getApiErrorMessage = async (response: Response, fallbackMessage: string) => {
    const payload = await parseApiPayload(response);
    if (typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string") {
      return payload.error;
    }
    if (typeof payload === "string" && payload.trim()) {
      return payload;
    }
    return fallbackMessage;
  };

  const handleDelete = async (id: string) => {
    if (!isAdmin) return;
    try {
      const response = await apiFetch(`${API_BASE}/documents/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Unable to delete document."));
      }
      setDocuments((current) => current.filter((document) => document.id !== id));
      setSelectedIds((current) => current.filter((currentId) => currentId !== id));
      window.dispatchEvent(new Event("voice-sessions-refresh"));
      await loadAnalytics();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete document.");
    }
  };

  const handleDeleteSelected = async () => {
    if (!isAdmin || !canDeleteSelected) return;

    const deleteResults = await Promise.allSettled(
      selectedIds.map(async (id) => {
        const response = await apiFetch(`${API_BASE}/documents/${id}`, { method: "DELETE" });
        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, `Unable to delete document ${id}.`));
        }
      }),
    );

    const failedDeletes = deleteResults.filter((result) => result.status === "rejected").length;

    if (failedDeletes > 0) {
      const uniqueMessages = Array.from(
        new Set(
          deleteResults
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .map((result) => result.reason instanceof Error ? result.reason.message : "Unable to delete selected documents."),
        ),
      );
      toast.error(uniqueMessages.join(" "));
    }

    if (failedDeletes < selectedIds.length) {
      setDocuments((current) => current.filter((document) => !selectedIdSet.has(document.id)));
      setSelectedIds([]);
      window.dispatchEvent(new Event("voice-sessions-refresh"));
      await loadAnalytics();
      toast.success(
        `${selectedIds.length - failedDeletes} document${selectedIds.length - failedDeletes > 1 ? "s" : ""} deleted.`,
      );
    }
  };

  const handleCompleteHandwriting = async (documentId: string) => {
    if (!documents || !Array.isArray(documents)) return;
    const document = documents.find((d) => d.id === documentId);
    if (!document) return;

    // Get metadata for PHI regions and error messages
    const metadata = document.result?.meta;
    const userActionPrompt = metadata?.user_action_prompt;

    // Show error toast if Stage 3 failed with an error
    if (userActionPrompt?.error_type && userActionPrompt.error_type !== "no_api_key") {
      toast.error(userActionPrompt.title, {
        description: userActionPrompt.message?.substring(0, 200) + (userActionPrompt.message?.length > 200 ? "..." : ""),
      });
    }

    // Get Stage 3 policy metadata
    const stage3Policy = metadata?.stage3_policy || "detected";
    const stage3TriggerReason = metadata?.stage3_trigger_reason || "unknown";

    const phiRegions = metadata?.stage2_masking?.masked_types
      ? metadata.stage2_masking.masked_types.map((type: string) => ({
          type,
          bounding_box: { x: 0, y: 0, width: 0, height: 0 },
        }))
      : [];

    // Check for masked image path
    const maskedImagePath = metadata?.stage2_masking?.masked_image_path;
    // Build full URL for masked image - need to include backend origin if in dev mode
    const backendOrigin = import.meta.env.VITE_API_URL || window.location.origin;
    const maskedImagePages = Array.isArray(metadata?.stage2_masking?.review_pages)
      ? metadata.stage2_masking.review_pages
          .map((page: { page_number?: number; image_path?: string; image_role?: "masked" | "original" }) => ({
            pageNumber: page.page_number || 0,
            imageUrl: page.image_path ? `${backendOrigin}/storage/masked_images/${page.image_path}` : "",
            imageRole: page.image_role === "original" ? "original" : "masked",
          }))
          .filter((page: { imageUrl: string }) => Boolean(page.imageUrl))
          .sort((a: { pageNumber: number }, b: { pageNumber: number }) => a.pageNumber - b.pageNumber)
      : [];
    const maskedImageUrl = maskedImagePath
      ? `${backendOrigin}/storage/masked_images/${maskedImagePath}`
      : undefined;

    setHandwritingDialog({
      open: true,
      documentId,
      documentName: document.name,
      maskedImageUrl,
      maskedImagePages,
      phiRegions,
      stage3Policy,
      stage3TriggerReason,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <AppShellHeader />

      <main className="mx-auto max-w-7xl px-5 py-6">
        <Tabs value={workspace} onValueChange={(value) => setWorkspace(value as IntakeWorkspace)} className="grid gap-6">
          {isAdmin ? <ProcessingInsights analytics={analyticsOverview} isLoading={isLoadingAnalytics} /> : null}

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Clinical Operations</p>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">Intake Workspace</h1>
            </div>
            <TabsList className="grid h-auto w-full max-w-[420px] grid-cols-2 rounded-xl border border-teal-200 bg-teal-50/80 p-1">
              <TabsTrigger value="documents" className={TEAL_TABS_TRIGGER}>
                <FileStack className="mr-2 h-4 w-4" />
                Documents
              </TabsTrigger>
              <TabsTrigger value="voice" className={TEAL_TABS_TRIGGER}>
                <AudioLines className="mr-2 h-4 w-4" />
                Voice Dictation
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="documents" className="mt-0 grid gap-6">
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardContent className="space-y-4 p-5">
                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Document Intake</p>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-900">Clinical document queue</h2>
                </div>
                <div>
                  <input ref={inputRef} type="file" multiple accept=".pdf,application/pdf" className="hidden" onChange={handleInputChange} />
                  <div
                    role="button"
                    tabIndex={0}
                    className={`rounded-2xl border border-dashed p-4 transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                      dragActive
                        ? "border-primary bg-primary/5"
                        : "border-slate-300 bg-slate-50/70 hover:border-slate-400 hover:bg-white"
                    }`}
                    onClick={openFilePicker}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openFilePicker();
                      }
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                      handleFiles(event.dataTransfer.files);
                    }}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-start gap-4 text-left">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700">
                          <Upload className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">Add PDF documents to the intake queue</p>
                          <p className="mt-1 text-sm text-slate-600">Drag files here or select PDFs.</p>
                        </div>
                      </div>
                      <Button type="button" className={`self-start md:self-center ${PRIMARY_TEAL_BUTTON}`}>
                        Select PDFs
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-teal-200/80 bg-teal-50/70 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <WorkspaceMetric label="Total records" value={stats.total} />
                    <WorkspaceMetric label="Queued" value={stats.queued} />
                    <WorkspaceMetric label="Active" value={stats.processing + stats.transcribing} />
                    <WorkspaceMetric label="Completed" value={stats.processed} />
                    {stats.transcribing > 0 ? <WorkspaceMetric label="Transcribing" value={stats.transcribing} tone="text-indigo-700" /> : null}
                    {stats.review_required > 0 ? <WorkspaceMetric label="Approval Required" value={stats.review_required} tone="text-orange-700" /> : null}
                    {stats.failed > 0 ? <WorkspaceMetric label="Failed" value={stats.failed} tone="text-rose-700" /> : null}
                    {stats.partial > 0 ? <WorkspaceMetric label="Partial" value={stats.partial} tone="text-amber-700" /> : null}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-200/80 pb-3">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-3">
                    <CardTitle className="text-base text-slate-900">Documents queue</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      {["all", "queued", "processed", "failed", "partial"].map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setActiveTab(tab as QueueTab)}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                            activeTab === tab
                              ? "border-teal-700 bg-teal-600 text-white"
                              : "border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100"
                          }`}
                        >
                          {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500">
                        {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Select rows for batch actions"}
                      </span>
                      <Button
                        size="sm"
                        className={PRIMARY_TEAL_BUTTON}
                        onClick={handleProcessSelected}
                        disabled={!canProcessSelected}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Process selected
                      </Button>
                      {isAdmin ? (
                        <Button
                          size="sm"
                          className={PRIMARY_TEAL_BUTTON}
                          onClick={handleDeleteSelected}
                          disabled={!canDeleteSelected}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete selected
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:w-full sm:max-w-sm">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchValue}
                        onChange={(event) => setSearchValue(event.target.value)}
                        placeholder="Search by PDF, patient, or MRN"
                        className="h-10 border-slate-200 bg-white pl-9"
                      />
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <Key className="h-4 w-4 text-slate-500" />
                      <Input
                        type="password"
                        placeholder="Stage 3 API key"
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          aria-label="Select all visible documents"
                          checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                          onCheckedChange={(checked) => toggleVisibleSelection(checked === true)}
                        />
                      </TableHead>
                      <TableHead>Document</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingDocuments ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          Loading documents...
                        </TableCell>
                      </TableRow>
                    ) : filteredDocuments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8">
                          <FileStack className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                          <p className="text-muted-foreground">No documents found</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDocuments.map((document) => {
                        const patientName = getProcessedDocumentPatientName(document);
                        const mrn = getProcessedDocumentMrn(document);

                        return (
                          <TableRow key={document.id} className="align-top">
                            <TableCell>
                              <Checkbox
                                aria-label={`Select ${document.name}`}
                                checked={selectedIdSet.has(document.id)}
                                disabled={document.status === "processing"}
                                onCheckedChange={(checked) => toggleSelection(document.id, checked === true)}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                {document.documentType === 'voice' ? (
                                  <AudioLines className="h-5 w-5 text-indigo-500" />
                                ) : (
                                  <FileText className="h-5 w-5 text-muted-foreground" />
                                )}
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-slate-900">{document.name}</p>
                                  <div className="flex items-center gap-2">
                                    {document.documentType === 'voice' && document.linkedPatient && (
                                      <p className="text-xs text-muted-foreground">
                                        {document.linkedPatient}{document.encounterLabel ? ` · ${document.encounterLabel}` : ""}
                                      </p>
                                    )}
                                    {patientName && !document.documentType && (
                                      <p className="text-xs text-muted-foreground">
                                        {patientName}{mrn ? ` · MRN ${mrn}` : ""}
                                      </p>
                                    )}
                                    <div className="flex items-center gap-1">
                                      {(document.result?.pharmacyAlert || document.result?.pharmacy_alert) && (
                                        <PharmacyAlertBadge pharmacyAlert={document.result?.pharmacyAlert || document.result?.pharmacy_alert} compact />
                                      )}
                                      {(document.result?.departmentAlerts || document.result?.department_alerts) && (
                                        <DepartmentAlertBadge departmentAlerts={document.result?.departmentAlerts || document.result?.department_alerts} compact />
                                      )}
                                      {document.documentType === 'voice' && (
                                        <Badge variant="outline" className="text-xs border-indigo-200 text-indigo-700">Dictation</Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {document.documentType === 'voice' && document.durationLabel
                                ? document.durationLabel
                                : formatFileSize(document.size)}
                            </TableCell>
                            <TableCell>
                              {document.status === "processing" && processingProgress[document.id] ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                                    <span className="text-xs">{processingProgress[document.id].stepName}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{processingProgress[document.id].stepNumber}/{processingProgress[document.id].totalSteps}</span>
                                    <span>
                                      · {processingProgress[document.id].tokensUsed > 0
                                        ? `${processingProgress[document.id].tokensUsed.toLocaleString()} tokens`
                                        : "tokens pending"}
                                    </span>
                                  </div>
                                </div>
                              ) : document.status === "transcribing" ? (
                                <div className="flex items-center gap-2">
                                  <div className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
                                  <span className="text-xs">Transcribing audio...</span>
                                </div>
                              ) : document.status === "partial" && document.result?.meta?.user_action_prompt?.error_type ? (
                                <div className="flex items-center gap-2">
                                  <Badge className={statusClasses[document.status]}>{statusLabels[document.status]}</Badge>
                                  <span className="text-xs text-orange-600 dark:text-orange-400" title={document.result.meta.user_action_prompt.message}>
                                    {document.result.meta.user_action_prompt.error_type === "quota_exceeded" ? "⚠️ Quota" :
                                     document.result.meta.user_action_prompt.error_type === "extraction_failed" ? "⚠️ Failed" : "⚠️"}
                                  </span>
                                </div>
                              ) : (
                                <Badge className={statusClasses[document.status]}>{statusLabels[document.status]}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{formatDateTime(document.uploadedAt)}</TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-2">
                                {isAdmin ? (
                                  <AuditTrailSheet
                                    documentId={document.id}
                                    processedDocument={document}
                                    trigger={
                                      <Button variant="ghost" size="icon" className={ICON_TEAL_BUTTON} title="Audit trail" aria-label={`Open audit trail for ${document.name}`}>
                                        <ClipboardList className="h-4 w-4" />
                                      </Button>
                                    }
                                  />
                                ) : null}
                                {document.status === "partial" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={ICON_TEAL_BUTTON}
                                    title="Complete handwriting extraction"
                                    onClick={() => handleCompleteHandwriting(document.id)}
                                  >
                                    <Key className="h-4 w-4 text-purple-600" />
                                  </Button>
                                )}
                                {document.status === "failed" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={ICON_TEAL_BUTTON}
                                    title="Reprocess document"
                                    onClick={() => handleReprocess(document.id)}
                                    disabled={isProcessingBatch}
                                  >
                                    <RefreshCw className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={ICON_TEAL_BUTTON}
                                  onClick={() => {
                                    if (document.status === "processed" || document.status === "partial" || document.status === "review_required") {
                                      navigate(`/dashboard?documentId=${document.id}`);
                                    } else {
                                      toast.info("Process this document first.");
                                    }
                                  }}
                                  disabled={document.status === "queued" || document.status === "processing" || document.status === "transcribing" || document.status === "failed"}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {isAdmin ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={ICON_TEAL_BUTTON}
                                    onClick={() => handleDelete(document.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="voice" className="mt-0">
            <VoiceDictationWorkspace onDocumentsChanged={loadDocuments} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Handwriting Completion Dialog */}
      <HandwritingCompletionDialog
        open={handwritingDialog.open}
        onOpenChange={(open) => setHandwritingDialog(prev => ({ ...prev, open }))}
        onCompleted={async () => {
          await loadDocuments();
          await loadAnalytics();
        }}
        documentName={handwritingDialog.documentName}
        documentId={handwritingDialog.documentId}
        maskedImageUrl={handwritingDialog.maskedImageUrl}
        maskedImagePages={handwritingDialog.maskedImagePages}
        phiRegions={handwritingDialog.phiRegions}
        stage3Policy={handwritingDialog.stage3Policy}
        stage3TriggerReason={handwritingDialog.stage3TriggerReason}
      />
    </div>
  );
};

const formatFileSize = (size: number) => {
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

function WorkspaceMetric({
  label,
  value,
  tone = "text-teal-700",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
      <p className={`text-[10px] font-medium uppercase tracking-[0.16em] ${tone}`}>{label}</p>
      <p className="text-base font-semibold text-slate-900">{value}</p>
    </div>
  );
}

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export default UploadCenter;
