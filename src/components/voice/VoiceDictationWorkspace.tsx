import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Clock3,
  FileAudio,
  FlaskConical,
  Mic,
  Stethoscope,
  Trash2,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { apiFetch, expectApiJson, API_BASE } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

type VoiceQueueStatus = "queued" | "queued_for_extraction" | "transcribing" | "extracting" | "review_required" | "processed" | "failed";
type SpeakerRole = "doctor" | "patient" | "unknown";
type MedicationRisk = "low" | "medium" | "high";
type ReviewResolution = "pending" | "approved" | "edited" | "rejected";
type ReviewSeverity = "low" | "medium" | "high";

type VoiceSegment = {
  id: string;
  speakerRole: SpeakerRole;
  speakerLabel: string;
  startLabel: string;
  endLabel: string;
  text: string;
  confidence: number | null;
  flags: string[];
};

type VoiceReviewItem = {
  id: string;
  category: "transcript" | "medication" | "diagnosis" | "vitals" | "lab_order" | "radiology_order" | "procedure" | "follow_up";
  severity: ReviewSeverity;
  reasonCode: "low_confidence" | "speaker_ambiguity" | "dosage_ambiguity" | "multiple_candidates" | "possible_missing_context" | "conflict_detected";
  title: string;
  extractedValue: string;
  suggestedValue: string;
  provenanceText: string;
  provenanceTime: string;
  resolution: ReviewResolution;
  editedValue?: string;
};

type VoiceExtractionPreview = {
  linkedPatient: string;
  encounterLabel: string;
  diagnosis: string;
  medications: Array<{ name: string; instruction: string; status: "confirmed" | "needs_review" }>;
  labs: string[];
  radiology: string[];
  procedures: string[];
  followUp: string[];
  clinicalNotes: string[];
};

type VoiceSession = {
  id: string;
  fileName: string;
  uploadedAt: string;
  durationLabel: string;
  linkedPatient: string;
  encounterLabel: string;
  status: VoiceQueueStatus;
  sttBackend: string;
  error?: string | null;
  transcriptQuality: {
    overallConfidence: number | null;
    lowConfidenceSegmentCount: number;
    medicationRisk: MedicationRisk;
  };
  segments: VoiceSegment[];
  reviewItems: VoiceReviewItem[];
  extractionPreview?: VoiceExtractionPreview;
};

const STATUS_META: Record<
  VoiceQueueStatus,
  { label: string; className: string; summary: string }
> = {
  queued: {
    label: "Queued",
    className: "border-transparent bg-slate-100 text-slate-700",
    summary: "Awaiting transcription start",
  },
  queued_for_extraction: {
    label: "Queued for Extraction",
    className: "border-transparent bg-indigo-50 text-indigo-700",
    summary: "In documents queue, ready for extraction",
  },
  transcribing: {
    label: "Transcribing",
    className: "border-transparent bg-blue-50 text-blue-700",
    summary: "Processing audio...",
  },
  extracting: {
    label: "Extracting",
    className: "border-transparent bg-amber-50 text-amber-700",
    summary: "Structured extraction is building the dashboard draft",
  },
  review_required: {
    label: "Approval Required",
    className: "border-transparent bg-rose-50 text-rose-700",
    summary: "Transcript approval is required before queueing",
  },
  processed: {
    label: "Processed",
    className: "border-transparent bg-emerald-50 text-emerald-700",
    summary: "Ready to launch into the dashboard",
  },
  failed: {
    label: "Failed",
    className: "border-transparent bg-red-50 text-red-700",
    summary: "Needs transcript or processing attention",
  },
};

const PRIMARY_TEAL_BUTTON =
  "border-teal-600 bg-teal-600 text-white hover:border-teal-700 hover:bg-teal-700";
const SECONDARY_TEAL_BUTTON =
  "border-teal-200 bg-teal-50 text-teal-800 hover:border-teal-300 hover:bg-teal-100";
const ICON_TEAL_BUTTON =
  "border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 hover:text-teal-800";
const TEAL_TABS_TRIGGER =
  "rounded-lg text-teal-800 data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=active]:shadow-none";

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPercent(value: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "Pending";
  return `${Math.round(value * 100)}%`;
}

function hasReliableSegmentTiming(segment: VoiceSegment) {
  return !segment.flags.includes("partial_json_recovery") && !segment.flags.includes("fallback_transcript");
}

function getSegmentTimeLabel(segment: VoiceSegment) {
  if (!hasReliableSegmentTiming(segment)) {
    return "Time alignment unavailable";
  }
  return `${segment.startLabel} - ${segment.endLabel}`;
}

function getSegmentSpeakerLabel(segment: VoiceSegment) {
  if (segment.speakerRole === "unknown" && !hasReliableSegmentTiming(segment)) {
    return "Transcript draft";
  }
  return segment.speakerLabel;
}

function getSegmentConfidenceLabel(segment: VoiceSegment) {
  if ((segment.confidence === null || segment.confidence <= 0) && !hasReliableSegmentTiming(segment)) {
    return "Confidence pending";
  }
  return `Confidence ${formatPercent(segment.confidence)}`;
}

function getSegmentReviewItems(session: VoiceSession, segment: VoiceSegment) {
  return session.reviewItems.filter((item) =>
    item.provenanceText === segment.text &&
    item.provenanceTime === `${segment.startLabel} - ${segment.endLabel}`
  );
}

function sessionHasStructuredExtraction(session: VoiceSession) {
  const preview = session.extractionPreview;
  // Null-safe: if preview is undefined, all optional chaining on preview will return undefined
  // and Boolean(undefined) will be false, preventing render errors
  return Boolean(
    preview?.diagnosis ||
    (preview?.medications?.length || 0) > 0 ||
    (preview?.labs?.length || 0) > 0 ||
    (preview?.radiology?.length || 0) > 0 ||
    (preview?.procedures?.length || 0) > 0 ||
    (preview?.followUp?.length || 0) > 0
  );
}

function hasMeaningfulEncounter(session: VoiceSession) {
  return !(
    session.linkedPatient === "Encounter link pending" &&
    session.encounterLabel === "Not linked"
  );
}

function getVisibleSegmentFlags(segment: VoiceSegment) {
  return segment.flags.filter((flag) => flag !== "partial_json_recovery");
}

function getStatusMeta(status: VoiceQueueStatus) {
  return STATUS_META[status] || {
    label: status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    className: "border-transparent bg-slate-100 text-slate-700",
    summary: "Unknown status",
  };
}

function isSessionReadyForQueue(session: VoiceSession) {
  const hasTranscript = session.segments.length > 0;
  const allReviewsResolved = session.reviewItems.every((item) => item.resolution !== "pending");
  return hasTranscript && allReviewsResolved && session.status !== "queued_for_extraction";
}

function VoiceMetricInline({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-teal-700">{label}</p>
      <p className="text-base font-semibold text-slate-900">{value}</p>
    </div>
  );
}

type VoiceDictationWorkspaceProps = {
  onDocumentsChanged?: () => Promise<void> | void;
};

export default function VoiceDictationWorkspace({ onDocumentsChanged }: VoiceDictationWorkspaceProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const inputRef = useRef<HTMLInputElement>(null);
  const [voiceSessions, setVoiceSessions] = useState<VoiceSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const [activeReviewTab, setActiveReviewTab] = useState<"transcript" | "extraction">("transcript");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [processingIds, setProcessingIds] = useState<string[]>([]);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

  const selectedSession =
    (voiceSessions || []).find((session) => session.id === selectedSessionId) || (voiceSessions || [])[0] || null;

  const hasStructuredExtraction = useMemo(() => {
    if (!selectedSession) return false;
    return sessionHasStructuredExtraction(selectedSession);
  }, [selectedSession]);

  useEffect(() => {
    if (!selectedSession && voiceSessions && voiceSessions.length > 0) {
      setSelectedSessionId(voiceSessions[0].id);
    }
  }, [selectedSession, voiceSessions]);

  useEffect(() => {
    setSelectedQueueIds((current) =>
      current.filter((id) => (voiceSessions || []).some((session) => session.id === id)),
    );
  }, [voiceSessions]);

  const loadVoiceSessions = async (preferredSessionId?: string) => {
    const response = await apiFetch(`${API_BASE}/voice`);
    const payload = await expectApiJson<{ sessions: VoiceSession[] }>(response, "Unable to load voice sessions.");
    setVoiceSessions(payload.sessions || []);

    if (preferredSessionId && payload.sessions.some((session) => session.id === preferredSessionId)) {
      setSelectedSessionId(preferredSessionId);
      return;
    }

    if (payload.sessions.length > 0) {
      setSelectedSessionId((current) => {
        if (current && payload.sessions.some((session) => session.id === current)) {
          return current;
        }
        return payload.sessions[0].id;
      });
      return;
    }

    setSelectedSessionId("");
  };

  useEffect(() => {
    loadVoiceSessions()
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Unable to load voice sessions.");
      })
      .finally(() => {
        setIsLoadingSessions(false);
      });
  }, []);

  useEffect(() => {
    const handleRefresh = () => {
      loadVoiceSessions(selectedSessionId || undefined).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Unable to load voice sessions.");
      });
    };

    window.addEventListener("voice-sessions-refresh", handleRefresh);
    return () => {
      window.removeEventListener("voice-sessions-refresh", handleRefresh);
    };
  }, [selectedSessionId]);

  useEffect(() => {
    if (!hasStructuredExtraction && activeReviewTab === "extraction") {
      setActiveReviewTab("transcript");
    }
  }, [activeReviewTab, hasStructuredExtraction]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadAudio() {
      if (!selectedSessionId) {
        setAudioUrl(null);
        return;
      }

      setIsLoadingAudio(true);
      try {
        const response = await apiFetch(`${API_BASE}/voice/${selectedSessionId}/audio`);
        if (!response.ok) {
          throw new Error("Unable to load audio.");
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setAudioUrl(objectUrl);
        }
      } catch {
        if (!cancelled) {
          setAudioUrl(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAudio(false);
        }
      }
    }

    void loadAudio();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [selectedSessionId]);

  const stats = useMemo(() => {
    if (!voiceSessions || !Array.isArray(voiceSessions)) {
      return { total: 0, reviewRequired: 0, processed: 0, inFlight: 0 };
    }
    return {
      total: voiceSessions.length,
      reviewRequired: voiceSessions.filter((session) => session.status === "review_required").length,
      processed: voiceSessions.filter((session) => session.status === "processed").length,
      inFlight: voiceSessions.filter((session) => session.status === "queued" || session.status === "transcribing" || session.status === "extracting").length,
    };
  }, [voiceSessions]);

  const openFilePicker = () => {
    inputRef.current?.click();
  };

  const processSessions = async (ids: string[], preferredSessionId?: string) => {
    if (ids.length === 0) return;

    setProcessingIds((current) => Array.from(new Set([...current, ...ids])));
    setVoiceSessions((current) =>
      current.map((session) =>
        ids.includes(session.id)
          ? {
              ...session,
              status: "transcribing",
              error: null,
            }
          : session,
      ),
    );

    try {
      const response = await apiFetch(`${API_BASE}/voice/process`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      await expectApiJson<{ sessions: VoiceSession[] }>(response, "Unable to process voice sessions.");
      await loadVoiceSessions(preferredSessionId || ids[0]);
      await onDocumentsChanged?.();
      toast.success(`${ids.length} voice ${ids.length > 1 ? "sessions" : "session"} transcribed and staged for review.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to process voice sessions.");
    } finally {
      setProcessingIds((current) => current.filter((id) => !ids.includes(id)));
    }
  };

  const handleAudioInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const supported = files.filter((file) => {
      const name = file.name.toLowerCase();
      return (
        file.type.startsWith("audio/") ||
        name.endsWith(".wav") ||
        name.endsWith(".mp3") ||
        name.endsWith(".m4a")
      );
    });

    if (supported.length === 0) {
      toast.error("Select a .wav, .mp3, or .m4a file.");
      event.target.value = "";
      return;
    }

    const formData = new FormData();
    supported.forEach((file) => formData.append("files", file));

    setIsUploading(true);
    try {
      const response = await apiFetch(`${API_BASE}/voice/upload`, {
        method: "POST",
        body: formData,
      });
      const payload = await expectApiJson<{
        sessions: VoiceSession[];
        duplicates: Array<{ name: string }>;
      }>(response, "Unable to upload voice files.");

      if (payload.duplicates?.length) {
        toast.info(`${payload.duplicates.length} duplicate voice file${payload.duplicates.length > 1 ? "s were" : " was"} skipped.`);
      }

      const uploadedIds = (payload.sessions || []).map((session) => session.id);
      if (uploadedIds.length > 0) {
        setSelectedSessionId(uploadedIds[0]);
        setActiveReviewTab("transcript");
        await loadVoiceSessions(uploadedIds[0]);
        // Clear uploading state before starting long-running transcription/extraction
        setIsUploading(false);
        await processSessions(uploadedIds, uploadedIds[0]);
      } else {
        await loadVoiceSessions();
        await onDocumentsChanged?.();
        setIsUploading(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload voice files.");
      setIsUploading(false);
    } finally {
      event.target.value = "";
    }
  };

  const handleResolveReviewItem = async (itemId: string, resolution: ReviewResolution, editedValue?: string) => {
    if (!selectedSessionId || !["approved", "edited", "rejected"].includes(resolution)) {
      return;
    }

    try {
      const response = await apiFetch(`${API_BASE}/voice/${selectedSessionId}/review`, {
        method: "POST",
        body: JSON.stringify({
          reviewItemId: itemId,
          resolution,
          editedValue: resolution === "edited" ? editedValue || "" : "",
        }),
      });
      const payload = await expectApiJson<{ session: VoiceSession }>(response, "Unable to save review decision.");
      setVoiceSessions((current) =>
        current.map((session) => (session.id === payload.session.id ? payload.session : session)),
      );
      setSelectedSessionId(payload.session.id);
      setEditingItemId(null);
      setEditingValue("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save review decision.");
    }
  };

  const beginEdit = (item: VoiceReviewItem) => {
    setEditingItemId(item.id);
    setEditingValue(item.editedValue || item.suggestedValue || item.extractedValue);
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!isAdmin) return;

    const session = (voiceSessions || []).find((item) => item.id === sessionId);
    if (!session) return;

    const confirmed = window.confirm(`Delete ${session.fileName}? This will remove the uploaded audio and transcript draft.`);
    if (!confirmed) return;

    setDeletingIds((current) => Array.from(new Set([...current, sessionId])));

    try {
      const response = await apiFetch(`${API_BASE}/voice/${sessionId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to delete voice session.");
      }

      const remainingSessions = voiceSessions.filter((item) => item.id !== sessionId);
      setVoiceSessions(remainingSessions);
      setSelectedQueueIds((current) => current.filter((id) => id !== sessionId));
      setSelectedSessionId((current) => {
        if (current !== sessionId) {
          return current;
        }
        return remainingSessions[0]?.id || "";
      });
      await onDocumentsChanged?.();
      toast.success("Voice session deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete voice session.");
    } finally {
      setDeletingIds((current) => current.filter((id) => id !== sessionId));
    }
  };

  const visibleQueueIds = useMemo(
    () => (voiceSessions || []).map((session) => session.id),
    [voiceSessions],
  );
  const selectedQueueIdSet = useMemo(() => new Set(selectedQueueIds), [selectedQueueIds]);
  const selectedQueueSessions = useMemo(
    () => (voiceSessions || []).filter((session) => selectedQueueIdSet.has(session.id)),
    [selectedQueueIdSet, voiceSessions],
  );
  const selectedReadySessions = useMemo(
    () => selectedQueueSessions.filter(isSessionReadyForQueue),
    [selectedQueueSessions],
  );
  const selectedBlockedSessions = useMemo(
    () => selectedQueueSessions.filter((session) => !isSessionReadyForQueue(session)),
    [selectedQueueSessions],
  );
  const selectedVisibleCount = useMemo(
    () => visibleQueueIds.filter((id) => selectedQueueIdSet.has(id)).length,
    [selectedQueueIdSet, visibleQueueIds],
  );
  const allVisibleSelected = visibleQueueIds.length > 0 && selectedVisibleCount === visibleQueueIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  const toggleQueueSelection = (id: string, checked: boolean) => {
    setSelectedQueueIds((current) => {
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((currentId) => currentId !== id);
    });
  };

  const toggleVisibleQueueSelection = (checked: boolean) => {
    setSelectedQueueIds((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...visibleQueueIds]));
      }
      const visibleSet = new Set(visibleQueueIds);
      return current.filter((id) => !visibleSet.has(id));
    });
  };

  const handleAddSelectedToQueue = async () => {
    if (selectedQueueSessions.length === 0) {
      toast.error("Select one or more voice files first.");
      return;
    }

    if (selectedReadySessions.length === 0) {
      toast.error("Approve the selected transcripts before adding them to the documents queue.");
      return;
    }

    const queuedIds: string[] = [];
    const failedMessages: string[] = [];

    for (const session of selectedReadySessions) {
      try {
        const response = await apiFetch(`${API_BASE}/voice/${session.id}/add-to-queue`, {
          method: "POST",
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          failedMessages.push(
            `${session.fileName}: ${payload?.error || "Unable to add to queue."}`,
          );
          continue;
        }

        queuedIds.push(session.id);
        if (payload?.session) {
          setVoiceSessions((current) =>
            current.map((item) => (item.id === payload.session.id ? payload.session : item)),
          );
        }
      } catch (error) {
        failedMessages.push(
          `${session.fileName}: ${error instanceof Error ? error.message : "Unable to add to queue."}`,
        );
      }
    }

    if (queuedIds.length > 0) {
      setSelectedQueueIds((current) => current.filter((id) => !queuedIds.includes(id)));
      await onDocumentsChanged?.();
      toast.success(
        `${queuedIds.length} voice file${queuedIds.length > 1 ? "s" : ""} added to the documents queue.`,
      );
    }

    if (selectedBlockedSessions.length > 0) {
      toast.info(
        `${selectedBlockedSessions.length} selected file${selectedBlockedSessions.length > 1 ? "s were" : " was"} skipped until transcript approval is complete.`,
      );
    }

    if (failedMessages.length > 0) {
      toast.error(failedMessages[0]);
    }
  };

  return (
    <div className="grid gap-6">
      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Voice Intake</p>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">Dictation review queue</h2>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".wav,.mp3,.m4a,audio/*"
            multiple
            className="hidden"
            onChange={handleAudioInput}
          />

          <div
            role="button"
            tabIndex={0}
            className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-left transition-colors hover:border-slate-400 hover:bg-white"
            onClick={openFilePicker}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openFilePicker();
              }
            }}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700">
                  <Mic className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-slate-900">Add dictated audio to the review queue</p>
                  <p className="mt-1 text-sm text-slate-600">Drag files here or select audio.</p>
                </div>
              </div>
              <Button type="button" className={`self-start md:self-center ${PRIMARY_TEAL_BUTTON}`} disabled={isUploading}>
                <AudioLines className="mr-2 h-4 w-4" />
                {isUploading ? "Uploading..." : "Select audio"}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-teal-200/80 bg-teal-50/70 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <VoiceMetricInline label="Total sessions" value={stats.total} />
              <VoiceMetricInline label="Approval required" value={stats.reviewRequired} />
              <VoiceMetricInline label="Ready" value={stats.processed} />
              <VoiceMetricInline label="In flight" value={stats.inFlight} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-200/80 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base text-slate-900">Voice processing queue</CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-500">
                {selectedQueueIds.length > 0
                  ? `${selectedQueueIds.length} selected · ${selectedReadySessions.length} ready to queue`
                  : "Select reviewed sessions to queue"}
              </span>
              <Button
                className={PRIMARY_TEAL_BUTTON}
                onClick={() => void handleAddSelectedToQueue()}
                disabled={selectedReadySessions.length === 0}
              >
                Add Selected to Queue
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    aria-label="Select all voice sessions"
                    checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                    onCheckedChange={(checked) => toggleVisibleQueueSelection(checked === true)}
                  />
                </TableHead>
                <TableHead>Dictation</TableHead>
                <TableHead>Encounter</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingSessions ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Loading voice sessions...
                  </TableCell>
                </TableRow>
              ) : voiceSessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center">
                    <FileAudio className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                    <p className="text-sm font-medium text-slate-900">No voice sessions yet</p>
                  </TableCell>
                </TableRow>
              ) : (
                voiceSessions.map((session) => (
                  <TableRow
                    key={session.id}
                    className={session.id === selectedSessionId ? "cursor-pointer bg-slate-50" : "cursor-pointer"}
                    onClick={() => {
                      setSelectedSessionId(session.id);
                      setActiveReviewTab("transcript");
                    }}
                  >
                    <TableCell>
                      <div onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${session.fileName}`}
                          checked={selectedQueueIdSet.has(session.id)}
                          onCheckedChange={(checked) => toggleQueueSelection(session.id, checked === true)}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                          <FileAudio className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{session.fileName}</p>
                          <p className="text-xs text-slate-500">{session.durationLabel}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {hasMeaningfulEncounter(session) ? (
                        <div>
                          <p className="text-sm text-slate-900">{session.linkedPatient}</p>
                          <p className="text-xs text-slate-500">{session.encounterLabel}</p>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">Not linked</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusMeta(session.status).className}>{getStatusMeta(session.status).label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{formatDateTime(session.uploadedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {session.status === "queued" ? (
                          <Button
                            size="sm"
                            className={PRIMARY_TEAL_BUTTON}
                            disabled={processingIds.includes(session.id)}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedSessionId(session.id);
                              void processSessions([session.id], session.id);
                            }}
                          >
                            {processingIds.includes(session.id) ? "Transcribing..." : "Transcribe"}
                          </Button>
                        ) : null}
                        {sessionHasStructuredExtraction(session) ? (
                          <Button
                            size="sm"
                            className={SECONDARY_TEAL_BUTTON}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedSessionId(session.id);
                              setActiveReviewTab("extraction");
                            }}
                          >
                            Summary
                          </Button>
                        ) : null}
                        {isAdmin ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className={ICON_TEAL_BUTTON}
                            title="Delete voice session"
                            disabled={processingIds.includes(session.id) || deletingIds.includes(session.id)}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteSession(session.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedSession ? (
        <div className="grid gap-6">
          <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
            <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
                  <FileAudio className="h-6 w-6" />
                </div>
                <div className="min-w-0 space-y-3">
                  <div>
                    <h3 className="truncate text-2xl font-semibold tracking-tight text-slate-900">{selectedSession.fileName}</h3>
                    {hasMeaningfulEncounter(selectedSession) ? (
                      <p className="mt-1 text-sm text-slate-500">
                        {selectedSession.linkedPatient} · {selectedSession.encounterLabel}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={getStatusMeta(selectedSession.status).className}>{getStatusMeta(selectedSession.status).label}</Badge>
                    <Badge variant="outline">{selectedSession.durationLabel}</Badge>
                    <Badge variant="outline">Uploaded {formatDateTime(selectedSession.uploadedAt)}</Badge>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-stretch gap-3 sm:flex-row lg:flex-col lg:items-end">
                {selectedSession.status === "transcribing" ? (
                  <div className="flex min-w-[220px] items-center gap-4 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-blue-200 border-t-blue-600" />
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-blue-700">Transcription</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{getStatusMeta(selectedSession.status).summary}</p>
                    </div>
                  </div>
                ) : null}
                {hasStructuredExtraction ? (
                  <Tabs value={activeReviewTab} onValueChange={(value) => setActiveReviewTab(value as "transcript" | "extraction")}>
                    <TabsList className="grid min-w-[280px] grid-cols-2 rounded-xl border border-slate-200 bg-slate-100/80 p-1">
                      <TabsTrigger value="transcript" className={TEAL_TABS_TRIGGER}>Transcript</TabsTrigger>
                      <TabsTrigger value="extraction" className={TEAL_TABS_TRIGGER}>Structured Summary</TabsTrigger>
                    </TabsList>
                  </Tabs>
                ) : null}
                {selectedSession.status !== "queued_for_extraction" && selectedSession.reviewItems.some((item) => item.resolution === "pending") ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <p className="font-medium">Approval required</p>
                    <p className="text-xs">Approve this transcript, then select it above and add it to queue.</p>
                  </div>
                ) : selectedSession.status !== "queued_for_extraction" && selectedSession.segments.length > 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <p className="font-medium">Ready for queue</p>
                    <p className="text-xs">Select this file above to add it to the documents queue.</p>
                  </div>
                ) : null}
              </div>
            </CardContent>
            {selectedSession.error ? (
              <CardContent className="border-t border-rose-100 bg-rose-50/70 px-6 py-4 text-sm text-rose-800">
                {selectedSession.error}
              </CardContent>
            ) : null}
          </Card>

          {activeReviewTab === "transcript" ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_360px]">
              <Card className="overflow-hidden border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-200/80 bg-white pb-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-lg">Transcript</CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[720px]">
                    <div className="space-y-3 bg-[linear-gradient(180deg,rgba(252,252,249,0.9),rgba(255,255,255,1))] p-4">
                      {selectedSession.segments.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
                          Transcript output is not ready yet for this session.
                        </div>
                      ) : (
                        selectedSession.segments.map((segment) => {
                          const segmentReviewItems = getSegmentReviewItems(selectedSession, segment);
                          const highlighted = segment.flags.includes("low_confidence") || segmentReviewItems.length > 0;

                          return (
                            <article
                              key={segment.id}
                              className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${
                                highlighted
                                  ? "border-amber-200 ring-1 ring-amber-100"
                                  : "border-slate-200"
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[11px]">
                                  {getSegmentSpeakerLabel(segment)}
                                </Badge>
                                <span className="text-xs font-medium text-slate-500">{getSegmentTimeLabel(segment)}</span>
                                <span className="text-xs text-slate-500">{getSegmentConfidenceLabel(segment)}</span>
                              </div>
                              <p className="mt-2 text-sm leading-relaxed text-slate-800">{segment.text}</p>
                                  {getVisibleSegmentFlags(segment).length > 0 ? (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {getVisibleSegmentFlags(segment).map((flag) => (
                                        <Badge key={flag} className="rounded-full border-transparent bg-slate-100 px-2 py-0.5 text-slate-700">
                                          {flag.replace(/_/g, " ")}
                                        </Badge>
                                      ))}
                                    </div>
                              ) : null}
                              {segmentReviewItems.length > 0 ? (
                                <div className="mt-3 space-y-2 border-t border-amber-100 pt-3">
                                  {segmentReviewItems.map((item) => {
                                    const isEditing = editingItemId === item.id;
                                    return (
                                      <div key={item.id} className="rounded-lg bg-amber-50/60 p-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge
                                            className={
                                              item.severity === "high"
                                                ? "border-transparent bg-rose-50 text-rose-700"
                                                : item.severity === "medium"
                                                  ? "border-transparent bg-amber-100 text-amber-800"
                                                  : "border-transparent bg-blue-50 text-blue-700"
                                            }
                                          >
                                            {item.severity}
                                          </Badge>
                                          <Badge variant="outline">{item.resolution}</Badge>
                                        </div>
                                        <p className="mt-2 text-sm font-medium text-slate-900">{item.title}</p>
                                        {isEditing ? (
                                          <div className="mt-2 space-y-2">
                                            <Input
                                              value={editingValue}
                                              onChange={(event) => setEditingValue(event.target.value)}
                                              placeholder="Edit the transcript cue"
                                            />
                                            <div className="flex gap-2">
                                              <Button
                                                size="sm"
                                                className={`rounded-lg ${PRIMARY_TEAL_BUTTON}`}
                                                onClick={() => handleResolveReviewItem(item.id, "edited", editingValue)}
                                              >
                                                Save edit
                                              </Button>
                                              <Button
                                                size="sm"
                                                className={`rounded-lg ${SECONDARY_TEAL_BUTTON}`}
                                                onClick={() => {
                                                  setEditingItemId(null);
                                                  setEditingValue("");
                                                }}
                                              >
                                                Cancel
                                              </Button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="mt-2 flex flex-wrap gap-2">
                                            <Button size="sm" className={`rounded-lg ${PRIMARY_TEAL_BUTTON}`} onClick={() => handleResolveReviewItem(item.id, "approved")}>
                                              Approve
                                            </Button>
                                            <Button size="sm" className={`rounded-lg ${SECONDARY_TEAL_BUTTON}`} onClick={() => beginEdit(item)}>
                                              Edit
                                            </Button>
                                            <Button
                                              size="sm"
                                              className={`rounded-lg ${SECONDARY_TEAL_BUTTON}`}
                                              onClick={() => handleResolveReviewItem(item.id, "rejected")}
                                            >
                                              Reject
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </article>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:sticky xl:top-6 xl:self-start">
                <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
                  <CardHeader className="border-b border-slate-200/80 pb-4">
                    <CardTitle className="text-base">Source Audio</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 p-5">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                      {audioUrl ? (
                        <audio key={audioUrl} controls preload="metadata" className="w-full">
                          <source src={audioUrl} />
                        </audio>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
                          {isLoadingAudio ? "Loading audio..." : "Audio preview is unavailable for this session."}
                        </div>
                      )}
                    </div>
                    {selectedSession.segments.some((segment) => !hasReliableSegmentTiming(segment)) ? (
                      <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-4 text-sm text-amber-900">
                        Time-aligned cueing is still pending for this file. Check the full audio instead of relying on the time labels.
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-200/80">
                <CardTitle className="text-base">Structured Summary</CardTitle>
                <CardDescription>Draft structured extraction for downstream dashboard publication.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-5 text-sm text-slate-700">
                    {selectedSession.reviewItems.length === 0
                      ? "No review items are pending for this session. The draft is ready for the next extraction layer."
                      : "Finish transcript approval before promoting this session into structured extraction."}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex items-center gap-2 text-slate-700">
                      <UserRound className="h-4 w-4" />
                      <p className="text-xs uppercase tracking-[0.18em]">Patient and encounter</p>
                    </div>
                    <p className="mt-3 text-sm font-medium text-slate-900">{selectedSession.extractionPreview?.linkedPatient || "Encounter link pending"}</p>
                    <p className="text-sm text-slate-600">{selectedSession.extractionPreview?.encounterLabel || "Not linked"}</p>
                    <Separator className="my-5" />
                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <div className="flex items-center gap-2 text-slate-700">
                          <Stethoscope className="h-4 w-4" />
                          <p className="text-xs uppercase tracking-[0.18em]">Diagnosis</p>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-900">
                          {selectedSession.extractionPreview?.diagnosis || "Awaiting voice extraction skills"}
                        </p>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-slate-700">
                          <Clock3 className="h-4 w-4" />
                          <p className="text-xs uppercase tracking-[0.18em]">Follow-up</p>
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          {(selectedSession.extractionPreview?.followUp?.length || 0) > 0
                            ? selectedSession.extractionPreview.followUp.map((item) => <p key={item}>{item}</p>)
                            : <p className="text-slate-500">No follow-up items</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4">
                  <Card className="border-slate-200 shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Medications</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {(selectedSession.extractionPreview?.medications?.length || 0) > 0 ? selectedSession.extractionPreview.medications.map((medication) => (
                        <div key={medication.name} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-slate-900">{medication.name}</p>
                            <Badge
                              className={
                                medication.status === "needs_review"
                                  ? "border-transparent bg-amber-50 text-amber-700"
                                  : "border-transparent bg-emerald-50 text-emerald-700"
                              }
                            >
                              {medication.status === "needs_review" ? "Needs review" : "Confirmed"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-slate-600">{medication.instruction}</p>
                        </div>
                      )) : <p className="text-sm text-slate-500">No structured medications extracted in Phase 1.</p>}
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Orders</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-5 md:grid-cols-2">
                      <div>
                        <div className="flex items-center gap-2 text-slate-700">
                          <FlaskConical className="h-4 w-4" />
                          <p className="text-xs uppercase tracking-[0.18em]">Labs</p>
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          {(selectedSession.extractionPreview?.labs?.length || 0) > 0
                            ? selectedSession.extractionPreview.labs.map((item) => <p key={item}>{item}</p>)
                            : <p className="text-slate-500">No lab orders</p>}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-slate-700">
                          <Clock3 className="h-4 w-4" />
                          <p className="text-xs uppercase tracking-[0.18em]">Procedures</p>
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          {(selectedSession.extractionPreview?.procedures?.length || 0) > 0
                            ? selectedSession.extractionPreview.procedures.map((item) => <p key={item}>{item}</p>)
                            : <p className="text-slate-500">No procedures extracted</p>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}
