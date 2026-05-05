import { useState, useRef } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Key, Lock, Loader2, Sparkles } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const API_BASE = `${(import.meta.env.VITE_API_URL || "").replace(/\/$/, "")}/api`;

interface HandwritingCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentName: string;
  documentId: string;
  onCompleted?: () => Promise<void> | void;
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
}

export function HandwritingCompletionDialog({
  open,
  onOpenChange,
  documentName,
  documentId,
  onCompleted,
  maskedImageUrl,
  maskedImagePages = [],
  phiRegions = [],
  stage3Policy = "detected",
  stage3TriggerReason = "unknown",
}: HandwritingCompletionDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [activeTab, setActiveTab] = useState<"steps" | "privacy">("steps");

  // Progress state
  const [progress, setProgress] = useState<{
    stepNumber: number;
    totalSteps: number;
    step: string;
    message: string;
  } | null>(null);
  const [keyVerified, setKeyVerified] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: string; message: string; type: "info" | "success" | "error" }>>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const addLog = (message: string, type: "info" | "success" | "error" = "info") => {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [...prev, { time, message, type }]);
    console.log(`[Handwriting ${type.toUpperCase()}]`, message);
  };

  const handleComplete = async () => {
    if (!apiKey.trim()) {
      setError("Please enter your Gemini API key");
      return;
    }

    if (!apiKey.startsWith("AIza")) {
      setError("Invalid API key format. Gemini keys start with 'AIza'");
      return;
    }

    setIsCompleting(true);
    setError(null);
    setKeyVerified(false);
    setProgress(null);
    setLogs([]);

    try {
      addLog("Initiating handwriting extraction...", "info");

      // Use SSE for real-time progress
      const eventSource = new EventSource(`${API_BASE}/documents/${documentId}/handwriting-progress?apiKey=${encodeURIComponent(apiKey.trim())}`);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("[Handwriting SSE]", data);

          switch (data.type) {
            case "connected":
              addLog("Connected to extraction service", "info");
              break;
            case "key_verified":
              setKeyVerified(true);
              addLog("✓ API key verified successfully", "success");
              break;
            case "start":
              setProgress({ stepNumber: 0, totalSteps: data.totalSteps || 3, step: data.stage || "starting", message: data.message });
              addLog(data.message, "info");
              break;
            case "step":
              setProgress({ stepNumber: data.stepNumber, totalSteps: data.totalSteps || 3, step: data.step || "processing", message: data.message });
              addLog(`[${data.stepNumber}/${data.totalSteps}] ${data.message}`, "info");
              break;
            case "done":
              addLog("✓ Handwriting extraction completed successfully!", "success");
              setProgress({ stepNumber: data.totalSteps || 3, totalSteps: data.totalSteps || 3, step: "complete", message: data.message || "Complete!" });
              eventSource.close();
              setTimeout(async () => {
                onOpenChange(false);
                setApiKey("");
                setKeyVerified(false);
                setIsCompleting(false);
                setProgress(null);
                setLogs([]);
                await onCompleted?.();
              }, 1500);
              break;
            case "error":
              addLog(`✗ Error: ${data.error}`, "error");
              setError(data.error || "Failed to complete handwriting extraction");
              eventSource.close();
              setIsCompleting(false);
              setKeyVerified(false);
              break;
          }
        } catch (e) {
          console.error("Error parsing SSE data:", e);
        }
      };

      eventSource.onerror = () => {
        console.error("SSE connection error");
        eventSource.close();
        setError("Connection to extraction service lost");
        setIsCompleting(false);
        setKeyVerified(false);
      };

    } catch (err) {
      addLog(`✗ Error: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
      setError(err instanceof Error ? err.message : "Failed to complete handwriting extraction");
      setIsCompleting(false);
      setKeyVerified(false);
    }
  };

  // Cleanup EventSource on unmount
  const cleanup = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const getPhiTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      patient_name: "Patient Name",
      patient_id: "Patient ID/MRN",
      patient_age: "Age",
      patient_gender: "Gender",
      doctor_name: "Doctor Name",
      hospital_name: "Hospital Name",
      date: "Visit Date",
      episode_number: "Episode Number",
      registration_number: "Registration Number",
    };
    return labels[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const previewPages = maskedImagePages.length > 0
    ? maskedImagePages
    : maskedImageUrl
      ? [{ pageNumber: 1, imageUrl: maskedImageUrl, imageRole: "masked" as const }]
      : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {stage3Policy === "always"
              ? "Complete Prescription Enhancement"
              : "Complete Handwriting Extraction"}
          </DialogTitle>
          <DialogDescription>
            {stage3Policy === "always"
              ? "Prescription enhancement extracts medications, vitals, and clinical notes using Gemini AI after PHI masking."
              : "This prescription contains handwritten information that requires additional processing."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "steps" | "privacy")} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="steps">
              <Key className="h-4 w-4 mr-2" />
              Steps to Complete
            </TabsTrigger>
            <TabsTrigger value="privacy">
              <Lock className="h-4 w-4 mr-2" />
              Privacy Protection
            </TabsTrigger>
          </TabsList>

          <TabsContent value="steps" className="space-y-4 mt-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {stage3Policy === "always"
                  ? <><strong>{documentName}</strong> requires prescription enhancement to extract medications, dosages, vitals, and clinical notes using Gemini AI.</>
                  : <><strong>{documentName}</strong> contains handwritten text that cannot be extracted with the local model.</>}
              </AlertDescription>
            </Alert>

            {/* Progress Section - shown when processing */}
            {isCompleting && (
              <div className="space-y-3 rounded-lg border bg-slate-50 p-4">
                <div className="flex items-center gap-2">
                  {keyVerified ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  )}
                  <span className="font-medium text-sm">
                    {keyVerified ? "API Key Verified" : "Verifying API Key..."}
                  </span>
                </div>

                {progress && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Step {progress.stepNumber} of {progress.totalSteps}</span>
                        <span className="font-medium">{progress.step}</span>
                      </div>
                      <Progress
                        value={progress.totalSteps > 0 ? (progress.stepNumber / progress.totalSteps) * 100 : 0}
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">{progress.message}</p>
                    </div>

                    {/* Console-like log output */}
                    {logs.length > 0 && (
                      <div className="mt-3 rounded-md bg-slate-900 p-3 font-mono text-xs">
                        <div className="flex items-center gap-2 mb-2 text-slate-400 border-b border-slate-700 pb-2">
                          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
                          <span>Extraction Logs</span>
                        </div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {logs.map((log, i) => (
                            <div key={i} className={`flex gap-2 ${log.type === "error" ? "text-red-400" : log.type === "success" ? "text-green-400" : "text-slate-300"}`}>
                              <span className="text-slate-500">[{log.time}]</span>
                              <span className="flex-1">{log.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  1
                </div>
                <div>
                  <p className="font-medium">PHI Detection</p>
                  <p className="text-sm text-muted-foreground">
                    Patient information (name, ID, age) has been detected in the document header.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  2
                </div>
                <div>
                  <p className="font-medium">PHI Masking</p>
                  <p className="text-sm text-muted-foreground">
                    All detected PHI regions will be blacked out before sending to external services.
                  </p>
                  {phiRegions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {phiRegions.map((region, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {getPhiTypeLabel(region.type)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  3
                </div>
                <div>
                  <p className="font-medium">Handwriting Extraction</p>
                  <p className="text-sm text-muted-foreground">
                    The masked image is sent to Gemini AI to extract handwritten medications, doses, and instructions.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  4
                </div>
                <div>
                  <p className="font-medium">Data Integration</p>
                  <p className="text-sm text-muted-foreground">
                    Extracted handwriting is merged with the header data for a complete prescription record.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-muted p-4">
              <p className="text-sm font-medium mb-2">What will be extracted:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Handwritten medication names</li>
                <li>• Dosages and frequencies</li>
                <li>• Duration instructions</li>
                <li>• Vitals (if handwritten)</li>
                <li>• Doctor's notes</li>
              </ul>
            </div>
          </TabsContent>

          <TabsContent value="privacy" className="space-y-4 mt-4">
            <Alert>
              <Lock className="h-4 w-4" />
              <AlertDescription>
                <strong>Your privacy is protected.</strong> All personally identifiable information is masked before
                sending to external AI services.
              </AlertDescription>
            </Alert>

            {previewPages.length > 0 && (
              <div className="space-y-2">
                <Label>External Extraction Review</Label>
                <div className="max-h-[420px] space-y-4 overflow-y-auto rounded-lg border bg-muted p-3">
                  {previewPages.map((page) => (
                    <div key={`${page.pageNumber}-${page.imageRole}`} className="overflow-hidden rounded-lg border bg-background">
                      <div className="flex items-center justify-between border-b bg-slate-950 px-3 py-2 text-xs text-white">
                        <span>Page {page.pageNumber}</span>
                        <Badge variant="secondary" className="border-0 bg-white/10 text-white">
                          {page.imageRole === "masked" ? "Masked" : "Original"}
                        </Badge>
                      </div>
                      <img
                        src={page.imageUrl}
                        alt={`Prescription page ${page.pageNumber} used for external extraction`}
                        className="w-full h-auto object-contain"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <EyeOff className="h-3 w-3" />
                  Page 1 is masked before external processing. Remaining pages are shown exactly as sent.
                </div>
              </div>
            )}

            {previewPages.length === 0 && (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <EyeOff className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Masked image will be generated during extraction
                </p>
              </div>
            )}

            <div className="rounded-lg border bg-muted p-4">
              <p className="text-sm font-medium mb-2">Protected Information:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Patient name and demographics</li>
                <li>• Medical Record Number (MRN)</li>
                <li>• Doctor name and signature</li>
                <li>• Hospital/clinic name</li>
                <li>• Visit dates and episode numbers</li>
              </ul>
            </div>

            <div className="rounded-lg border bg-amber-50 dark:bg-amber-950 p-4">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-1">
                Your API key is used only for this extraction
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                The key is sent directly to Google's Gemini API and is never stored on our servers.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-2">
          <Label htmlFor="api-key">Gemini API Key</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="api-key"
                type={showApiKey ? "text" : "password"}
                placeholder="AIza..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !isCompleting && handleComplete()}
                disabled={isCompleting}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">
            Get your free API key at{" "}
            <a
              href="https://ai.google.dev/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              ai.google.dev
            </a>
          </p>
        </div>

        {isCompleting && !progress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting to extraction service...
              </span>
            </div>
            <Progress value={undefined} className="h-2" />
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              cleanup();
              onOpenChange(false);
            }}
            disabled={isCompleting}
          >
            Cancel
          </Button>
          <Button onClick={handleComplete} disabled={isCompleting || !apiKey.trim()}>
            <Sparkles className="h-4 w-4 mr-2" />
            {isCompleting ? "Processing..." : stage3Policy === "always" ? "Complete Enhancement" : "Complete Extraction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
