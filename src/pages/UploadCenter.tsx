import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Eye, FileText, FileStack, RefreshCw, Search, Sparkles, Trash2, Upload, Key } from "lucide-react";

import AuditTrailSheet from "@/components/dashboard/AuditTrailSheet";
import { HandwritingCompletionDialog } from "@/components/dashboard/HandwritingCompletionDialog";
import ProcessingInsights from "@/components/dashboard/ProcessingInsights";
import PharmacyAlertBadge from "@/components/dashboard/PharmacyAlertBadge";
import DepartmentAlertBadge from "@/components/dashboard/DepartmentAlertBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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

const statusClasses: Record<QueueStatus, string> = {
  queued: "border-transparent bg-emerald-50 text-emerald-700",
  processing: "border-transparent bg-amber-50 text-amber-700",
  processed: "border-transparent bg-blue-50 text-blue-700",
  failed: "border-transparent bg-red-50 text-red-700",
  partial: "border-transparent bg-purple-50 text-purple-700",
};

const statusLabels: Record<QueueStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  processed: "Processed",
  failed: "Failed",
  partial: "Needs API Key",
};

const UploadCenter = () => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<ProcessedDocument[]>([]);
  const [activeTab, setActiveTab] = useState<QueueTab>("all");
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
    const response = await fetch(`${API_BASE}/documents`);
    if (!response.ok) {
      throw new Error("Unable to load uploaded documents.");
    }
    const payload = await response.json();
    setDocuments(payload.documents ?? []);
  };

  const loadAnalytics = async () => {
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
        toast.error(error instanceof Error ? error.message : "Unable to load processing insights.");
      })
      .finally(() => {
        setIsLoadingAnalytics(false);
      });
  }, []);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => documents.some((document) => document.id === id)));
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    return documents.filter((document) => {
      const matchesTab =
        activeTab === "all" ||
        (activeTab === "queued" && document.status === "queued") ||
        (activeTab === "processed" && document.status === "processed") ||
        (activeTab === "failed" && document.status === "failed") ||
        (activeTab === "partial" && document.status === "partial");
      return matchesTab && matchesProcessedDocumentQuery(document, searchValue);
    });
  }, [activeTab, documents, searchValue]);

  const stats = useMemo(() => {
    return {
      total: documents.length,
      queued: documents.filter((document) => document.status === "queued").length,
      processing: documents.filter((document) => document.status === "processing").length,
      processed: documents.filter((document) => document.status === "processed").length,
      failed: documents.filter((document) => document.status === "failed").length,
      partial: documents.filter((document) => document.status === "partial").length,
    };
  }, [documents]);

  const queueReady = stats.queued > 0 && stats.processing === 0 && !isProcessingBatch;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedIdSet.has(document.id)),
    [documents, selectedIdSet],
  );
  const visibleSelectableIds = useMemo(
    () => filteredDocuments.filter((document) => document.status !== "processing").map((document) => document.id),
    [filteredDocuments],
  );
  const selectedVisibleCount = useMemo(
    () => visibleSelectableIds.filter((id) => selectedIdSet.has(id)).length,
    [selectedIdSet, visibleSelectableIds],
  );
  const allVisibleSelected = visibleSelectableIds.length > 0 && selectedVisibleCount === visibleSelectableIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const selectedQueuedDocuments = useMemo(
    () => selectedDocuments.filter((document) => document.status === "queued"),
    [selectedDocuments],
  );
  const selectedProcessingCount = useMemo(
    () => selectedDocuments.filter((document) => document.status === "processing").length,
    [selectedDocuments],
  );
  const canProcessSelected = selectedQueuedDocuments.length > 0 && stats.processing === 0 && !isProcessingBatch;
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
      const response = await fetch(`${API_BASE}/documents/upload`, {
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

    // Gemma 31B is currently stable only when inpatient/discharge runs are serialized.
    const MAX_CONCURRENT = 1;
    const chunks = [];
    for (let i = 0; i < queuedDocuments.length; i += MAX_CONCURRENT) {
      chunks.push(queuedDocuments.slice(i, i + MAX_CONCURRENT));
    }

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
          const eventSource = new EventSource(eventSourceUrl);

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

          eventSource.onerror = () => {
            logClientStage("warn", `SSE stream error/closed for ${document.name}`, { documentId: document.id });
            eventSource.close();
          };

          await new Promise<void>((resolve) => {
            const checkInterval = setInterval(async () => {
              try {
                const response = await fetch(`${API_BASE}/documents`);
                if (response.ok) {
                  const payload = await response.json();
                  const currentDoc = payload.documents?.find((d: any) => d.id === document.id);
                  // Also consider 'partial' status as complete (when Stage 3 was skipped)
                  if (currentDoc && (currentDoc.status === 'processed' || currentDoc.status === 'failed' || currentDoc.status === 'partial')) {
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
                    eventSource.close();
                    resolve();
                  }
                }
              } catch (e) {
                logClientStage("warn", `Polling error for ${document.name}`, {
                  documentId: document.id,
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            }, 2000);

            setTimeout(() => {
              logClientStage("warn", `Processing timeout reached for ${document.name}`, {
                documentId: document.id,
                timeoutMs: 300000,
              });
              clearInterval(checkInterval);
              eventSource.close();
              resolve();
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

    await loadDocuments();
    await loadAnalytics();
    setIsProcessingBatch(false);
    setProcessingProgress({});
    logClientStage("info", "Batch processing flow completed");
    toast.success(`Batch processing complete.`);
  };

  const handleProcessQueue = async () => {
    await processDocuments(documents.filter((document) => document.status === "queued"));
  };

  const handleProcessSelected = async () => {
    await processDocuments(selectedQueuedDocuments);
  };

  const handleReprocess = async (documentId: string) => {
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

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE}/documents/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("Unable to delete document.");
      }
      setDocuments((current) => current.filter((document) => document.id !== id));
      setSelectedIds((current) => current.filter((currentId) => currentId !== id));
      await loadAnalytics();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete document.");
    }
  };

  const handleDeleteSelected = async () => {
    if (!canDeleteSelected) return;

    const deleteResults = await Promise.allSettled(
      selectedIds.map(async (id) => {
        const response = await fetch(`${API_BASE}/documents/${id}`, { method: "DELETE" });
        if (!response.ok) {
          throw new Error(id);
        }
      }),
    );

    const failedDeletes = deleteResults.filter((result) => result.status === "rejected").length;

    if (failedDeletes > 0) {
      toast.error(`Unable to delete ${failedDeletes} selected document${failedDeletes > 1 ? "s" : ""}.`);
    }

    if (failedDeletes < selectedIds.length) {
      setDocuments((current) => current.filter((document) => !selectedIdSet.has(document.id)));
      setSelectedIds([]);
      await loadAnalytics();
      toast.success(
        `${selectedIds.length - failedDeletes} document${selectedIds.length - failedDeletes > 1 ? "s" : ""} deleted.`,
      );
    }
  };

  const handleCompleteHandwriting = async (documentId: string) => {
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
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-4">
            <img src="/manipal-logo.png" alt="Manipal Hospitals" className="h-10" />
          </div>
          <img src="/yavar-logo.png" alt="Powered by Yavar.ai" className="h-5 opacity-60" />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        <div className="grid gap-6">
          <ProcessingInsights analytics={analyticsOverview} isLoading={isLoadingAnalytics} />

          {/* Upload Area */}
          <Card>
            <CardContent className="p-6">
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Upload Zone */}
                <div>
                  <input ref={inputRef} type="file" multiple accept=".pdf,application/pdf" className="hidden" onChange={handleInputChange} />
                  <div
                    role="button"
                    tabIndex={0}
                    className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                      dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
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
                    <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="font-medium">Drop PDF files here or click to upload</p>
                    <p className="text-sm text-muted-foreground mt-1">Multiple files supported</p>
                  </div>
                </div>

                {/* Process Action */}
                <div className="flex flex-col justify-center">
                  <div className="mb-4">
                    <p className="text-sm font-medium">Queue Status</p>
                    <p className="text-2xl font-bold mt-1">{stats.queued} queued · {stats.processed} processed</p>
                  </div>
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleProcessQueue}
                    disabled={!queueReady || isUploading}
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    {isProcessingBatch ? "Processing..." : "Process Queue"}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    {!queueReady && stats.queued === 0 ? "Upload PDFs to enable processing" : null}
                    {stats.processing > 0 ? "Processing in progress..." : null}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Documents Queue */}
          <Card>
            <div className="p-4 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex flex-col gap-3">
                {/* Gemini API Key Input */}
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="Gemini API Key (for Stage 3 handwriting extraction)"
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    className="h-8 w-64 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  {["all", "queued", "processed", "failed", "partial"].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab as QueueTab)}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                        activeTab === tab
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Select rows for batch actions"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleProcessSelected}
                    disabled={!canProcessSelected}
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Process Selected
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={handleDeleteSelected}
                    disabled={!canDeleteSelected}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Selected
                  </Button>
                </div>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder="Search by PDF, patient, or MRN"
                  className="pl-9"
                />
              </div>
            </div>

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
                        <TableRow key={document.id}>
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
                              <FileText className="h-5 w-5 text-muted-foreground" />
                              <div>
                                <p className="font-medium">{document.name}</p>
                                <div className="flex items-center gap-2">
                                  {patientName && (
                                    <p className="text-xs text-muted-foreground">
                                      {patientName}{mrn ? ` · MRN ${mrn}` : ""}
                                    </p>
                                  )}
                                  {/* Alert Badges */}
                                  <div className="flex items-center gap-1">
                                    {/* Pharmacy Alert Badge */}
                                    {(document.result?.pharmacyAlert || document.result?.pharmacy_alert) && (
                                      <PharmacyAlertBadge pharmacyAlert={document.result?.pharmacyAlert || document.result?.pharmacy_alert} compact />
                                    )}
                                    {/* Department Alert Badge */}
                                    {(document.result?.departmentAlerts || document.result?.department_alerts) && (
                                      <DepartmentAlertBadge departmentAlerts={document.result?.departmentAlerts || document.result?.department_alerts} compact />
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{formatFileSize(document.size)}</TableCell>
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
                                      : 'tokens pending'}
                                  </span>
                                </div>
                              </div>
                            ) : document.status === "partial" && document.result?.meta?.user_action_prompt?.error_type ? (
                              <div className="flex items-center gap-2">
                                <Badge className={statusClasses[document.status]}>{statusLabels[document.status]}</Badge>
                                <span className="text-xs text-orange-600 dark:text-orange-400" title={document.result.meta.user_action_prompt.message}>
                                  {document.result.meta.user_action_prompt.error_type === 'quota_exceeded' ? '⚠️ Quota' :
                                   document.result.meta.user_action_prompt.error_type === 'extraction_failed' ? '⚠️ Failed' : '⚠️'}
                                </span>
                              </div>
                            ) : (
                              <Badge className={statusClasses[document.status]}>{statusLabels[document.status]}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{formatDateTime(document.uploadedAt)}</TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              <AuditTrailSheet
                                documentId={document.id}
                                processedDocument={document}
                                trigger={
                                  <Button variant="ghost" size="icon" title="Audit trail" aria-label={`Open audit trail for ${document.name}`}>
                                    <ClipboardList className="h-4 w-4" />
                                  </Button>
                                }
                              />
                              {document.status === "partial" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
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
                                  title="Reprocess document"
                                  onClick={() => handleReprocess(document.id)}
                                  disabled={isProcessingBatch}
                                >
                                  <RefreshCw className="h-4 w-4 text-amber-600" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  if (document.status === "processed" || document.status === "partial") {
                                    navigate(`/dashboard?documentId=${document.id}`);
                                  } else {
                                    toast.info("Process this document first.");
                                  }
                                }}
                                disabled={document.status === "queued" || document.status === "processing" || document.status === "failed"}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleDelete(document.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
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
        </div>
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

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export default UploadCenter;
