import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  AudioLines,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Edit3,
  ExternalLink,
  FileCheck2,
  Mic,
  PauseCircle,
  PlayCircle,
  Plus,
  RadioTower,
  ShieldAlert,
  Square,
  TimerReset,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  formatLiveDuration,
  sessionTitle,
  useLiveConversationAPI,
  type LiveDraftExtraction,
  type LiveConversationSession,
  type LiveReviewItem,
  type LiveReviewResolution,
  type LiveTranscriptSegment,
} from "@/hooks/useLiveConversationAPI";
import type { ConnectionState, MediaRecorderState } from "@/hooks/useLiveConversationAudio";

const PRIMARY_TEAL_BUTTON =
  "border-teal-600 bg-teal-600 text-white hover:border-teal-700 hover:bg-teal-700";
const SECONDARY_TEAL_BUTTON =
  "border-teal-200 bg-teal-50 text-teal-800 hover:border-teal-300 hover:bg-teal-100";

function formatTimestamp(value: string | null) {
  if (!value) return "Not started";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusTone(status: LiveConversationSession["status"]) {
  if (status === "finalized") return "border-transparent bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-transparent bg-rose-50 text-rose-700";
  if (status === "review_required") return "border-transparent bg-amber-50 text-amber-800";
  if (status === "paused") return "border-transparent bg-sky-50 text-sky-700";
  if (status === "finalizing") return "border-transparent bg-indigo-50 text-indigo-700";
  if (status === "live") return "border-transparent bg-teal-50 text-teal-700";
  return "border-transparent bg-slate-100 text-slate-700";
}

function statusLabel(status: LiveConversationSession["status"]) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function speakerTone(role: LiveTranscriptSegment["speakerRole"]) {
  if (role === "doctor") return "border-transparent bg-teal-50 text-teal-700";
  if (role === "patient") return "border-transparent bg-sky-50 text-sky-700";
  return "border-transparent bg-slate-100 text-slate-700";
}

function severityTone(severity: LiveReviewItem["severity"]) {
  if (severity === "high") return "border-transparent bg-rose-50 text-rose-700";
  if (severity === "medium") return "border-transparent bg-amber-50 text-amber-800";
  return "border-transparent bg-sky-50 text-sky-700";
}

function speakerAccent(role: LiveTranscriptSegment["speakerRole"]) {
  if (role === "doctor") return "bg-teal-500";
  if (role === "patient") return "bg-sky-500";
  return "bg-slate-300";
}

function autoPatientLabel(session: LiveConversationSession) {
  return [session.linkedPatient, session.draft.extractedData.patient.name]
    .map((value) => value.trim())
    .find(Boolean)
    || "";
}

function autoEncounterLabel(session: LiveConversationSession) {
  const explicit = session.encounterLabel.trim();
  if (explicit) return explicit;
  const digits = String(session.id || "").replace(/\D/g, "");
  return `EN${(digits.slice(-6) || "000001").padStart(6, "0")}`;
}

function countSetupFields(session: LiveConversationSession) {
  return [
    autoPatientLabel(session).length > 0,
    autoEncounterLabel(session).length > 0,
    session.recorder.permission === "granted",
  ].filter(Boolean).length;
}

function countDraftSections(session: LiveConversationSession) {
  const draft = session.draft.extractedData;
  return [
    draft.chiefComplaint,
    draft.hpi,
    draft.ros?.length || 0,
    draft.diagnosis,
    draft.symptoms.length,
    draft.patient.name || draft.patient.age || draft.patient.gender,
    draft.vitals.latest.bp.systolic || draft.vitals.latest.pulse.value || draft.vitals.latest.temperature.value || draft.vitals.latest.spo2.value || draft.vitals.latest.weight.value,
    draft.medications.length,
    draft.labs.length + draft.radiology.length + draft.procedures.length,
    draft.followUp.length,
    draft.plan.length,
  ].filter(Boolean).length;
}

function countPendingReview(session: LiveConversationSession) {
  return session.draft.reviewItems.filter((item) => item.resolution === "pending").length;
}

function permissionLabel(permission: LiveConversationSession["recorder"]["permission"]) {
  if (permission === "granted") return "Mic ready";
  if (permission === "denied") return "Mic denied";
  return "Mic pending";
}

function formatVitalNumber(value: number | null, unit = "") {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "";
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function formatBloodPressure(systolic: number | null, diastolic: number | null) {
  if (!systolic || !diastolic) return "";
  return `${systolic}/${diastolic} mmHg`;
}

function liveCaptureCopy(captureState: MediaRecorderState, transportState: ConnectionState, audioLevel: number) {
  if (captureState === "stopping") {
    return {
      title: "Ending recording",
      detail: "Processing the final audio chunk and moving this visit into review.",
    };
  }

  if (captureState === "paused") {
    return {
      title: "Recording paused",
      detail: "Resume when you are ready to continue capturing audio.",
    };
  }

  if (captureState === "starting" || transportState === "connecting" || transportState === "reconnecting") {
    return {
      title: "Connecting microphone",
      detail: "Preparing the stream. This takes a moment when a live visit starts.",
    };
  }

  if (captureState === "recording" && transportState === "connected") {
    return {
      title: audioLevel > 0.06 ? "Listening. Voice detected." : "Listening to your microphone",
      detail: "Transcript and note updates keep streaming while you speak.",
    };
  }

  return {
    title: "Ready to capture",
    detail: "Press Start to let the browser use your default microphone, then speak normally.",
  };
}

function transcriptEmptyCopy(captureState: MediaRecorderState, transportState: ConnectionState, audioLevel: number) {
  if (captureState === "stopping") {
    return {
      title: "Finishing transcript",
      detail: "Final audio is being processed before the review step opens.",
    };
  }

  if (captureState === "paused") {
    return {
      title: "Transcript paused",
      detail: "Resume recording to continue transcript capture.",
    };
  }

  if (captureState === "starting" || transportState === "connecting" || transportState === "reconnecting") {
    return {
      title: "Preparing transcript",
      detail: "The transcript panel will start updating after recording begins.",
    };
  }

  if (captureState === "recording" && transportState === "connected") {
    return {
      title: audioLevel > 0.06 ? "Listening now" : "Waiting for speech",
      detail: "Transcript keeps updating live every few seconds while you speak.",
    };
  }

  return {
    title: "Transcript will appear here",
    detail: "Press Start and speak. The live transcript begins after the first processed chunk.",
  };
}

function bloodPressureInputValue(systolic: number | null, diastolic: number | null) {
  if (!systolic || !diastolic) return "";
  return `${systolic}/${diastolic}`;
}

function vitalInputValue(value: number | null) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "";
  return String(value);
}

function AudioLevelMeter({
  audioLevel,
  isActive,
}: {
  audioLevel: number;
  isActive: boolean;
}) {
  const bars = [0.04, 0.08, 0.12, 0.18, 0.24, 0.32, 0.42, 0.56];

  return (
    <div className="flex items-end gap-1" aria-label="Microphone level">
      {bars.map((threshold, index) => (
        <span
          key={threshold}
          className={cn(
            "w-1.5 rounded-full transition-colors",
            isActive
              ? audioLevel >= threshold
                ? "bg-teal-500"
                : "bg-teal-100"
              : "bg-slate-200",
          )}
          style={{ height: `${12 + (index * 3)}px` }}
        />
      ))}
    </div>
  );
}

function RecordingIndicator({ isRecording, hasAudio }: { isRecording: boolean; hasAudio: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {/* Pulsing microphone icon */}
      <div className="relative">
        <div
          className={cn(
            "absolute inset-0 rounded-full bg-teal-400 opacity-20 transition-all duration-300",
            isRecording && "animate-ping"
          )}
        />
        <div
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300",
            isRecording
              ? hasAudio
                ? "bg-teal-500 text-white"
                : "bg-teal-100 text-teal-600"
              : "bg-slate-100 text-slate-400",
          )}
        >
          <Mic className="h-5 w-5" />
        </div>
      </div>

      {/* Audio wave animation */}
      {isRecording && (
        <div className="flex items-center gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                "w-1 bg-teal-500 rounded-full transition-all duration-150",
                hasAudio ? "animate-pulse" : "opacity-30",
              )}
              style={{
                height: hasAudio
                  ? `${8 + Math.sin((Date.now() / 100 + i) * 2) * 8 + Math.random() * 20}px`
                  : "4px",
                animationDelay: `${i * 50}ms`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AudioPlayer({ audioUrl }: { audioUrl: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600">
          <PlayCircle className="h-3.5 w-3.5" />
        </div>
        <audio key={audioUrl} controls className="h-8 flex-1 min-w-0" preload="metadata" src={audioUrl}>
          Your browser does not support audio playback.
        </audio>
      </div>
    </div>
  );
}

function RecordingPanel({
  session,
  onDeleteSession,
}: {
  session: LiveConversationSession;
  onDeleteSession: (sessionId: string) => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const hasAudioPlayback = Boolean(
    session.audio?.combinedPath
    && ["review_required", "finalizing", "finalized"].includes(session.status),
  );

  if (!hasAudioPlayback) return null;

  const audioFileName = session.audio?.combinedPath?.split(/[\\/]/).pop() || null;
  const audioUrl = `/api/voice/live/sessions/${encodeURIComponent(session.id)}/audio`;

  const handleDelete = async () => {
    const confirmed = window.confirm(`Delete ${sessionTitle(session.linkedPatient, session.encounterLabel)}? This will remove the saved recording and transcript draft.`);
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await onDeleteSession(session.id);
      toast.success("Recording deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete recording.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="border-slate-200/80 bg-white shadow-sm">
      <CardContent className="grid gap-1 px-3 py-0.5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium text-slate-900">Saved Recording</CardTitle>
          <div className="flex items-center gap-1">
            <Button asChild type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Open recording">
              <a href={audioUrl} target="_blank" rel="noreferrer" aria-label="Open recording">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
            <Button asChild type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Download recording">
              <a href={audioUrl} download={audioFileName || `${session.id}.webm`} aria-label="Download recording">
                <Download className="h-4 w-4" />
              </a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              title="Delete recording"
              aria-label="Delete recording"
              disabled={isDeleting}
              onClick={() => {
                void handleDelete();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <AudioPlayer audioUrl={audioUrl} />
      </CardContent>
    </Card>
  );
}

function SessionList({
  sessions,
  selectedSessionId,
  selectedSessionStatus,
  onSelectSession,
  onCreateDraftSession,
  isCollapsed = false,
  onToggleCollapse,
}: {
  sessions: LiveConversationSession[];
  selectedSessionId: string | null;
  selectedSessionStatus: LiveConversationSession["status"];
  onSelectSession: (sessionId: string) => void;
  onCreateDraftSession: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const activeSessions = sessions.filter((session) =>
    ["draft", "live", "paused", "review_required", "finalizing"].includes(session.status),
  );
  const finalizedSessions = sessions.filter((session) => session.status === "finalized");
  const attentionSessions = sessions.filter((session) => session.status === "failed");

  const renderRow = (session: LiveConversationSession, subtitle: string) => (
    <button
      key={session.id}
      type="button"
      className={`w-full overflow-hidden rounded-2xl border px-3 py-3 text-left transition-colors ${
        session.id === selectedSessionId
          ? "border-teal-300 bg-teal-50/70 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70"
      }`}
      onClick={() => onSelectSession(session.id)}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium leading-5 text-slate-900">{session.title}</p>
          </div>
          <Badge className={cn("shrink-0 whitespace-nowrap", statusTone(session.status))}>
            {statusLabel(session.status)}
          </Badge>
        </div>
        <p className="break-words text-xs leading-5 text-slate-500">{subtitle}</p>
        <p className="text-[11px] text-slate-400">{formatTimestamp(session.updatedAt)}</p>
      </div>
    </button>
  );

  const renderDisclosure = (
    label: string,
    items: LiveConversationSession[],
    subtitle: (session: LiveConversationSession) => string,
  ) => {
    if (items.length === 0) return null;

    return (
      <details className="group rounded-2xl border border-slate-200 bg-slate-50/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3">
          <p className="text-xs font-medium text-slate-900">{label}</p>
          <Badge variant="outline">{items.length}</Badge>
        </summary>
        <div className="space-y-2 border-t border-slate-200/80 p-3">
          {items.map((session) => renderRow(session, subtitle(session)))}
        </div>
      </details>
    );
  };

  return (
    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm xl:sticky xl:top-5 xl:self-start">
      <CardHeader className="border-b border-slate-200/80 pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base text-slate-900">Visits</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              onClick={onToggleCollapse}
              title={isCollapsed ? "Expand visits panel" : "Collapse visits panel"}
            >
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
            {["review_required", "finalizing", "finalized", "failed"].includes(selectedSessionStatus) ? (
              <Button
                size="icon"
                className={PRIMARY_TEAL_BUTTON}
                onClick={() => onCreateDraftSession()}
                aria-label="Create new visit"
                title="Create new visit"
              >
                <Plus className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      {!isCollapsed && (
        <CardContent className="grid gap-4 p-4">
          <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">In progress</p>
            <Badge variant="outline">{activeSessions.length}</Badge>
          </div>
          {activeSessions.length > 0 ? (
            <div className="space-y-2">
              {activeSessions.map((session) =>
                renderRow(session, autoEncounterLabel(session) || statusLabel(session.status)),
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-500">
              No session
            </div>
          )}
          </section>
          {renderDisclosure(
            "Completed",
            finalizedSessions,
            (session) => [autoPatientLabel(session), autoEncounterLabel(session)].filter(Boolean).join(" · ") || "Dashboard ready",
          )}
          {renderDisclosure(
            "Interrupted",
            attentionSessions,
            (session) => session.error || "Recovery required",
          )}
        </CardContent>
      )}
    </Card>
  );
}

function ControlBar({
  session,
  onStart,
  onPause,
  onResume,
  onStop,
  captureState,
  transportState,
  audioLevel,
}: {
  session: LiveConversationSession;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  captureState: MediaRecorderState;
  transportState: ConnectionState;
  audioLevel: number;
}) {
  const captureCopy = liveCaptureCopy(captureState, transportState, audioLevel);
  const isRecording = captureState === "recording";
  const hasAudio = audioLevel > 0.06;

  return (
    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
      <CardContent className="grid gap-1 px-3 py-1">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">Encounter</p>
            <h3 className="truncate text-lg font-semibold text-slate-900">{session.title}</h3>
            {[autoPatientLabel(session), autoEncounterLabel(session)].filter(Boolean).length > 0 ? (
              <p className="text-sm text-slate-600">
                {[autoPatientLabel(session), autoEncounterLabel(session)].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={statusTone(session.status)}>{statusLabel(session.status)}</Badge>
              <Badge variant="outline">
                <TimerReset className="mr-1 h-3.5 w-3.5" />
                {formatLiveDuration(session.durationMs)}
              </Badge>
              <Badge variant="outline">
                <RadioTower className="mr-1 h-3.5 w-3.5" />
                {session.transport.connectionState}
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {(session.status === "draft" || session.status === "failed") ? (
              <Button className={PRIMARY_TEAL_BUTTON} onClick={onStart} disabled={captureState === "starting" || captureState === "stopping"}>
                <Mic className="mr-2 h-4 w-4" />
                {captureState === "starting"
                  ? "Starting..."
                  : session.status === "failed"
                    ? "Restart"
                    : "Start"}
              </Button>
            ) : null}
            {session.status === "live" ? (
              <Button className={SECONDARY_TEAL_BUTTON} onClick={onPause} disabled={captureState !== "recording"}>
                <PauseCircle className="mr-2 h-4 w-4" />
                Pause
              </Button>
            ) : null}
            {session.status === "paused" ? (
              <Button className={SECONDARY_TEAL_BUTTON} onClick={onResume} disabled={captureState === "stopping"}>
                <PlayCircle className="mr-2 h-4 w-4" />
                Resume
              </Button>
            ) : null}
            {(session.status === "live" || session.status === "paused") ? (
              <Button className={PRIMARY_TEAL_BUTTON} onClick={onStop} disabled={captureState === "stopping"}>
                <Square className="mr-2 h-4 w-4" />
                {captureState === "stopping" ? "Ending..." : "End"}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Recording status with visual indicator */}
        <div className={cn(
          "rounded-2xl border p-1 transition-colors",
          isRecording
            ? hasAudio
              ? "border-teal-200 bg-teal-50/80"
              : "border-slate-200 bg-slate-50/80"
            : "border-slate-200/80 bg-slate-50/80"
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">{captureCopy.title}</p>
              <p className="text-xs leading-5 text-slate-500">{captureCopy.detail}</p>
            </div>
            <div className="flex items-center gap-4">
              <RecordingIndicator isRecording={isRecording} hasAudio={hasAudio} />
              <AudioLevelMeter audioLevel={audioLevel} isActive={isRecording} />
            </div>
          </div>
        </div>

        {session.error ? (
          <div className="rounded-xl border border-rose-100 bg-rose-50/80 px-3 py-2 text-sm text-rose-900">
            {session.error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TranscriptPanel({
  session,
  captureState,
  transportState,
  audioLevel,
}: {
  session: LiveConversationSession;
  captureState: MediaRecorderState;
  transportState: ConnectionState;
  audioLevel: number;
}) {
  const emptyTranscriptCopy = transcriptEmptyCopy(captureState, transportState, audioLevel);
  const isLiveCapture = captureState === "recording";
  const hasAudio = audioLevel > 0.06;

  return (
    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-200/80 pb-2.5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base text-slate-900">Transcript</CardTitle>
          <div className="flex items-center gap-2">
            {isLiveCapture && (
              <Badge className="border-transparent bg-teal-100 text-teal-800">
                <span className="relative mr-1.5 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-600" />
                </span>
                Recording
              </Badge>
            )}
            {session.transcript.hasGap ? (
              <Badge className="border-transparent bg-amber-50 text-amber-800">Gap</Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[600px] xl:h-[680px]">
          <div className="space-y-3 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,1))] p-4">
            {session.transcript.segments.length === 0 && !session.transcript.interimText ? (
              <div className={cn(
                "flex min-h-[140px] items-center justify-center rounded-xl border p-6 transition-colors",
                isLiveCapture
                  ? hasAudio
                    ? "border-teal-200 bg-teal-50/50"
                    : "border-slate-200 bg-white"
                  : "border-dashed border-slate-200 bg-white"
              )}>
                <div className="space-y-4 text-center">
                  {isLiveCapture && (
                    <div className="mx-auto flex justify-center">
                      <RecordingIndicator isRecording={isLiveCapture} hasAudio={hasAudio} />
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-700">{emptyTranscriptCopy.title}</p>
                    <p className="text-sm text-slate-500">{emptyTranscriptCopy.detail}</p>
                  </div>
                </div>
              </div>
            ) : null}

            {session.transcript.segments.map((segment) => (
              <article
                key={segment.id}
                className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-colors ${
                  segment.flags.includes("low_confidence")
                    ? "border-amber-200 ring-1 ring-amber-100"
                    : "border-slate-200/80"
                }`}
              >
                <div className="flex">
                  <div className={`w-1.5 shrink-0 ${speakerAccent(segment.speakerRole)}`} />
                  <div className="min-w-0 flex-1 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={speakerTone(segment.speakerRole)}>{segment.speakerLabel}</Badge>
                      <span className="text-xs font-medium text-slate-500">
                        <Clock3 className="mr-1 inline h-3.5 w-3.5" />
                        {segment.startLabel} - {segment.endLabel}
                      </span>
                      {segment.flags.includes("low_confidence") ? (
                        <Badge className="border-transparent bg-amber-50 text-amber-800">Low confidence</Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-800">{segment.text}</p>
                    {segment.flags.filter((flag) => flag !== "low_confidence").length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {segment.flags.filter((flag) => flag !== "low_confidence").map((flag) => (
                          <Badge
                            key={flag}
                            className="border-transparent bg-slate-100 text-slate-700"
                          >
                            {flag.replace(/_/g, " ")}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}

            {session.transcript.interimText ? (
              <article className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/70 p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-transparent bg-sky-100 text-sky-800">Live</Badge>
                  <Badge className="border-slate-200 bg-slate-100 text-slate-700">Speaker</Badge>
                  <AudioLines className="h-3.5 w-3.5 text-slate-500" />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-800">{session.transcript.interimText}</p>
              </article>
            ) : null}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function SetupPanel({
  session,
  onUpdate,
  availableDevices,
}: {
  session: LiveConversationSession;
  onUpdate: (patch: { linkedPatient?: string; encounterLabel?: string; deviceId?: string; draftPatch?: Partial<LiveDraftExtraction> }) => void | Promise<void>;
  availableDevices: Array<{ id: string; label: string }>;
}) {
  const isLocked = session.status === "finalized";
  const deviceBadgeLabel = session.recorder.deviceLabel
    || (session.recorder.permission === "denied" ? "Microphone blocked" : "Browser default microphone");
  const detectedPatient = autoPatientLabel(session);
  const detectedEncounter = autoEncounterLabel(session);
  const microphoneHelpText = session.recorder.permission === "denied"
    ? "Microphone access is blocked in the browser. Allow microphone access for this site and refresh."
    : availableDevices.length === 0
      ? "No microphone is listed yet. Press Start to grant access; the browser default microphone will still be used."
      : "You can leave this unchanged to keep using the browser default microphone.";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">Patient</p>
          <p className="mt-1 text-sm text-slate-900">
            {detectedPatient || "-"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">Encounter</p>
          <p className="mt-1 text-sm text-slate-900">
            {detectedEncounter}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">Mic</label>
        {availableDevices.length > 0 ? (
          <select
            value={session.recorder.deviceId || availableDevices[0]?.id || ""}
            onChange={(event) => onUpdate({ deviceId: event.target.value })}
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-50"
            disabled={isLocked}
          >
            {availableDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {typeof device.label === 'string' ? device.label : JSON.stringify(device.label)}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
            Browser default microphone will be requested on Start
          </div>
        )}
        <p className="text-xs leading-5 text-slate-500">{microphoneHelpText}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge className="border-transparent bg-slate-100 text-slate-700">
          {permissionLabel(session.recorder.permission)}
        </Badge>
        <Badge className="border-transparent bg-slate-100 text-slate-700">
          {deviceBadgeLabel}
        </Badge>
      </div>
    </div>
  );
}

function DraftPanel({
  session,
  onSaveOptionalVitals,
}: {
  session: LiveConversationSession;
  onSaveOptionalVitals: (draftPatch: Partial<LiveDraftExtraction>) => Promise<void> | void;
}) {
  const draft = session.draft.extractedData;
  const pendingReview = countPendingReview(session);
  const medications = draft.medications.map((item) => {
    const instruction = typeof item.instruction === 'string'
      ? item.instruction
      : typeof item.instruction === 'object' && item.instruction
        ? JSON.stringify(item.instruction)
        : String(item.instruction || '');
    return `${item.name}${instruction ? ' · ' + instruction : ''}`;
  });
  const workup = [...draft.labs, ...draft.radiology, ...draft.procedures].map(item =>
    typeof item === 'string' ? item : typeof item === 'object' ? JSON.stringify(item) : String(item)
  );
  const planItems = [...draft.plan, ...draft.followUp].map(item =>
    typeof item === 'string' ? item : typeof item === 'object' ? JSON.stringify(item) : String(item)
  );
  const [optionalVitals, setOptionalVitals] = useState(() => ({
    bp: bloodPressureInputValue(draft.vitals.latest.bp.systolic, draft.vitals.latest.bp.diastolic),
    pulse: vitalInputValue(draft.vitals.latest.pulse.value),
    temperature: vitalInputValue(draft.vitals.latest.temperature.value),
    spo2: vitalInputValue(draft.vitals.latest.spo2.value),
    weight: vitalInputValue(draft.vitals.latest.weight.value),
  }));
  const [isSavingVitals, setIsSavingVitals] = useState(false);
  const demographics = [
    session.linkedPatient || draft.patient.name,
    draft.patient.age ? `Age: ${draft.patient.age}` : "",
    draft.patient.gender ? `Sex: ${draft.patient.gender}` : "",
  ].map(item => typeof item === 'string' ? item : String(item)).filter(Boolean);
  const vitals = [
    formatBloodPressure(draft.vitals.latest.bp.systolic, draft.vitals.latest.bp.diastolic)
      ? `Blood pressure: ${formatBloodPressure(draft.vitals.latest.bp.systolic, draft.vitals.latest.bp.diastolic)}`
      : "",
    formatVitalNumber(draft.vitals.latest.pulse.value, draft.vitals.latest.pulse.unit)
      ? `Pulse: ${formatVitalNumber(draft.vitals.latest.pulse.value, draft.vitals.latest.pulse.unit)}`
      : "",
    formatVitalNumber(draft.vitals.latest.temperature.value, draft.vitals.latest.temperature.unit)
      ? `Temperature: ${formatVitalNumber(draft.vitals.latest.temperature.value, draft.vitals.latest.temperature.unit)}`
      : "",
    formatVitalNumber(draft.vitals.latest.spo2.value, draft.vitals.latest.spo2.unit)
      ? `SpO2: ${formatVitalNumber(draft.vitals.latest.spo2.value, draft.vitals.latest.spo2.unit)}`
      : "",
    formatVitalNumber(draft.vitals.latest.weight.value, draft.vitals.latest.weight.unit)
      ? `Weight: ${formatVitalNumber(draft.vitals.latest.weight.value, draft.vitals.latest.weight.unit)}`
      : "",
  ].filter(Boolean);
  const vitalsLocked = session.status === "finalizing" || session.status === "finalized";

  useEffect(() => {
    setOptionalVitals({
      bp: bloodPressureInputValue(draft.vitals.latest.bp.systolic, draft.vitals.latest.bp.diastolic),
      pulse: vitalInputValue(draft.vitals.latest.pulse.value),
      temperature: vitalInputValue(draft.vitals.latest.temperature.value),
      spo2: vitalInputValue(draft.vitals.latest.spo2.value),
      weight: vitalInputValue(draft.vitals.latest.weight.value),
    });
  }, [
    session.id,
    session.updatedAt,
    draft.vitals.latest.bp.systolic,
    draft.vitals.latest.bp.diastolic,
    draft.vitals.latest.pulse.value,
    draft.vitals.latest.temperature.value,
    draft.vitals.latest.spo2.value,
    draft.vitals.latest.weight.value,
  ]);

  const handleSaveVitals = async () => {
    const latestPatch: Record<string, unknown> = {};
    const draftPatch: Partial<LiveDraftExtraction> = {
      vitals: {
        latest: latestPatch as LiveDraftExtraction["vitals"]["latest"],
      },
    };

    const bpMatch = optionalVitals.bp.trim().match(/(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})/i);
    if (bpMatch) {
      latestPatch.bp = {
        systolic: Number(bpMatch[1]),
        diastolic: Number(bpMatch[2]),
      };
    }

    const pulse = Number(optionalVitals.pulse);
    if (Number.isFinite(pulse) && pulse > 0) {
      latestPatch.pulse = {
        value: pulse,
        unit: draft.vitals.latest.pulse.unit || "bpm",
      };
    }

    const temperature = Number(optionalVitals.temperature);
    if (Number.isFinite(temperature) && temperature > 0) {
      latestPatch.temperature = {
        value: temperature,
        unit: draft.vitals.latest.temperature.unit || "F",
      };
    }

    const spo2 = Number(optionalVitals.spo2);
    if (Number.isFinite(spo2) && spo2 > 0) {
      latestPatch.spo2 = {
        value: spo2,
        unit: draft.vitals.latest.spo2.unit || "%",
      };
    }

    const weight = Number(optionalVitals.weight);
    if (Number.isFinite(weight) && weight > 0) {
      latestPatch.weight = {
        value: weight,
        unit: draft.vitals.latest.weight.unit || "kg",
      };
    }

    if (Object.keys(latestPatch).length === 0) {
      toast.error("Enter at least one vital to save.");
      return;
    }

    try {
      setIsSavingVitals(true);
      await onSaveOptionalVitals(draftPatch);
      toast.success("Vitals saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save vitals.");
    } finally {
      setIsSavingVitals(false);
    }
  };

  const NoteSection = ({ title, items }: { title: string; items: string[] }) => (
    <div className="border-t border-slate-200/80 pt-3 first:border-t-0 first:pt-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-300">-</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-700">
            <UserRound className="h-4 w-4" />
            <p className="text-[11px] uppercase tracking-[0.18em]">Encounter note</p>
          </div>
          {pendingReview > 0 ? (
            <Badge className="border-transparent bg-amber-50 text-amber-800">{pendingReview}</Badge>
          ) : null}
        </div>
        <div className="mt-3 border-t border-slate-200/80 pt-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">Assessment</p>
          <p className="mt-2 text-sm text-slate-900">{draft.diagnosis || "-"}</p>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
        <NoteSection title="Demographics" items={demographics} />
        <NoteSection title="Chief Complaint" items={draft.chiefComplaint ? [draft.chiefComplaint] : []} />
        <NoteSection title="HPI" items={draft.hpi ? [draft.hpi] : []} />
        <NoteSection title="ROS" items={(draft.ros || []).map(item =>
          typeof item === 'string' ? item : typeof item === 'object' ? JSON.stringify(item) : String(item)
        )} />
        <NoteSection title="Vitals" items={vitals} />
        <NoteSection title="History" items={draft.symptoms.map(item =>
          typeof item === 'string' ? item : typeof item === 'object' ? JSON.stringify(item) : String(item)
        )} />
        <NoteSection title="Medications" items={medications} />
        <NoteSection title="Orders" items={workup} />
        <NoteSection title="Plan" items={planItems} />
        <div className="border-t border-slate-200/80 pt-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">Optional vitals entry</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Vitals are captured from the conversation when available. Add or correct anything here only if needed.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Input
              value={optionalVitals.bp}
              onChange={(event) => setOptionalVitals((current) => ({ ...current, bp: event.target.value }))}
              placeholder="Blood pressure 120/80"
              disabled={vitalsLocked || isSavingVitals}
            />
            <Input
              value={optionalVitals.pulse}
              onChange={(event) => setOptionalVitals((current) => ({ ...current, pulse: event.target.value }))}
              placeholder="Pulse"
              disabled={vitalsLocked || isSavingVitals}
            />
            <Input
              value={optionalVitals.temperature}
              onChange={(event) => setOptionalVitals((current) => ({ ...current, temperature: event.target.value }))}
              placeholder="Temperature"
              disabled={vitalsLocked || isSavingVitals}
            />
            <Input
              value={optionalVitals.spo2}
              onChange={(event) => setOptionalVitals((current) => ({ ...current, spo2: event.target.value }))}
              placeholder="SpO2"
              disabled={vitalsLocked || isSavingVitals}
            />
            <Input
              value={optionalVitals.weight}
              onChange={(event) => setOptionalVitals((current) => ({ ...current, weight: event.target.value }))}
              placeholder="Weight"
              disabled={vitalsLocked || isSavingVitals}
            />
          </div>
          {!vitalsLocked ? (
            <div className="mt-3">
              <Button className={SECONDARY_TEAL_BUTTON} onClick={() => void handleSaveVitals()} disabled={isSavingVitals}>
                {isSavingVitals ? "Saving..." : "Save optional vitals"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ReviewPanel({
  session,
  canFinalize,
  onResolveReviewItem,
  onFinalize,
  onReturnToDraft,
}: {
  session: LiveConversationSession;
  canFinalize: boolean;
  onResolveReviewItem: (reviewItemId: string, resolution: LiveReviewResolution, editedValue?: string) => void;
  onFinalize: () => void;
  onReturnToDraft: () => void;
}) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [requiredEdits, setRequiredEdits] = useState<Record<string, string>>({});

  if (session.status === "finalized") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-4 text-sm text-emerald-900">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-transparent bg-emerald-100 text-emerald-800">Published</Badge>
            <Badge variant="outline">Document {session.documentId}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {session.documentId && (
            <Button
              className="border-purple-600 bg-purple-600 text-white hover:border-purple-700 hover:bg-purple-700"
              onClick={() => {
                window.location.href = `/prescription/${session.documentId}`;
              }}
            >
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Generate Prescription
            </Button>
          )}
          <Button
            className={PRIMARY_TEAL_BUTTON}
            onClick={() => {
              if (session.documentId) {
                window.location.href = `/dashboard?documentId=${session.documentId}`;
              }
            }}
          >
            Open dashboard
          </Button>
          <Button className={SECONDARY_TEAL_BUTTON} onClick={onReturnToDraft}>
            Back to voice workspace
          </Button>
        </div>
      </div>
    );
  }

  if (!["review_required", "finalizing"].includes(session.status)) {
    return <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-400">-</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900">Review</p>
        <Button className={PRIMARY_TEAL_BUTTON} onClick={onFinalize} disabled={!canFinalize || session.status === "finalizing"}>
          <FileCheck2 className="mr-2 h-4 w-4" />
          {session.status === "finalizing" ? "Finalizing..." : "Finalize"}
        </Button>
      </div>

      {!canFinalize ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-2 text-sm text-amber-900">
          <ShieldAlert className="h-4 w-4" />
          <p className="font-medium">Review required</p>
        </div>
      ) : null}

      {session.draft.reviewItems.map((item) => {
        const isEditing = editingItemId === item.id;
        const requiredValue = requiredEdits[item.id] ?? item.editedValue ?? item.suggestedValue ?? "";
        return (
          <article key={item.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={severityTone(item.severity)}>{item.severity}</Badge>
              <Badge variant="outline">{item.category.replace(/_/g, " ")}</Badge>
              <Badge variant="outline">{item.resolution}</Badge>
              {item.required ? <Badge variant="outline">required</Badge> : null}
            </div>
            <p className="mt-3 text-sm font-medium text-slate-900">{item.title}</p>
            <p className="mt-2 text-sm text-slate-600">{item.editedValue || item.suggestedValue || "Enter manually"}</p>

            {item.required ? (
              <div className="mt-3 space-y-3">
                <Input
                  type={item.inputType === "number" ? "number" : "text"}
                  value={requiredValue}
                  onChange={(event) => {
                    setRequiredEdits((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }));
                  }}
                  placeholder={item.placeholder || "Enter value"}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    className={PRIMARY_TEAL_BUTTON}
                    onClick={() => {
                      onResolveReviewItem(item.id, "edited", requiredValue);
                      setRequiredEdits((current) => {
                        const next = { ...current };
                        delete next[item.id];
                        return next;
                      });
                    }}
                    disabled={!requiredValue.trim()}
                  >
                    <CheckCheck className="mr-2 h-4 w-4" />
                    Save
                  </Button>
                </div>
              </div>
            ) : isEditing ? (
              <div className="mt-3 space-y-3">
                <Input
                  value={editingValue}
                  onChange={(event) => setEditingValue(event.target.value)}
                  placeholder="Edit extracted value"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    className={PRIMARY_TEAL_BUTTON}
                    onClick={() => {
                      onResolveReviewItem(item.id, "edited", editingValue);
                      setEditingItemId(null);
                      setEditingValue("");
                    }}
                  >
                    <CheckCheck className="mr-2 h-4 w-4" />
                    Save
                  </Button>
                  <Button
                    className={SECONDARY_TEAL_BUTTON}
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
              <div className="mt-3 flex flex-wrap gap-2">
                <Button className={PRIMARY_TEAL_BUTTON} onClick={() => onResolveReviewItem(item.id, "approved")}>
                  <CheckCheck className="mr-2 h-4 w-4" />
                  Approve
                </Button>
                <Button
                  className={SECONDARY_TEAL_BUTTON}
                  onClick={() => {
                    setEditingItemId(item.id);
                    setEditingValue(item.editedValue || item.suggestedValue);
                  }}
                >
                  <Edit3 className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button className={SECONDARY_TEAL_BUTTON} onClick={() => onResolveReviewItem(item.id, "rejected")}>
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ContextPanel({
  session,
  onUpdateSession,
  hasPendingReview,
  onResolveReviewItem,
  onFinalize,
  onReturnToDraft,
  availableDevices,
}: {
  session: LiveConversationSession;
  onUpdateSession: (patch: { linkedPatient?: string; encounterLabel?: string; deviceId?: string; draftPatch?: Partial<LiveDraftExtraction> }) => void | Promise<void>;
  hasPendingReview: boolean;
  onResolveReviewItem: (reviewItemId: string, resolution: LiveReviewResolution, editedValue?: string) => void;
  onFinalize: () => void;
  onReturnToDraft: () => void;
  availableDevices: Array<{ id: string; label: string }>;
}) {
  const setupCount = countSetupFields(session);
  const draftCount = countDraftSections(session);
  const pendingReviewCount = countPendingReview(session);
  const openSections = [
    "setup",
    "draft",
    ...(session.status === "review_required" || session.status === "finalizing" || session.status === "finalized"
      ? ["review"]
      : []),
  ];

  const SectionTrigger = ({
    icon,
    label,
    value,
    tone = "slate",
  }: {
    icon: React.ReactNode;
    label: string;
    value?: string;
    tone?: "slate" | "amber" | "teal";
  }) => (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
          tone === "amber" && "border-amber-200 bg-amber-50 text-amber-800",
          tone === "teal" && "border-teal-200 bg-teal-50 text-teal-700",
          tone === "slate" && "border-slate-200 bg-slate-100 text-slate-700",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{label}</p>
      </div>
      {value ? (
        <Badge variant="outline" className="ml-auto">
          {value}
        </Badge>
      ) : null}
    </div>
  );

  return (
    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm xl:sticky xl:top-5 xl:self-start">
      <CardContent className="p-0">
        <Accordion type="multiple" defaultValue={openSections} className="px-4">
          <AccordionItem value="setup" className="border-slate-200/80">
            <AccordionTrigger className="py-4 hover:no-underline">
              <SectionTrigger
                icon={<Mic className="h-4 w-4" />}
                label="Encounter"
                value={`${setupCount}/3`}
                tone="teal"
              />
            </AccordionTrigger>
            <AccordionContent className="pt-0">
              <SetupPanel session={session} onUpdate={onUpdateSession} availableDevices={availableDevices} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="draft" className="border-slate-200/80">
            <AccordionTrigger className="py-4 hover:no-underline">
              <SectionTrigger
                icon={<FileCheck2 className="h-4 w-4" />}
                label="Note"
                value={draftCount > 0 ? String(draftCount) : undefined}
              />
            </AccordionTrigger>
            <AccordionContent className="pt-0">
              <DraftPanel
                session={session}
                onSaveOptionalVitals={async (draftPatch) => {
                  await onUpdateSession({ draftPatch });
                }}
              />
            </AccordionContent>
          </AccordionItem>

          {(session.status === "review_required" || session.status === "finalizing" || session.status === "finalized") ? (
            <AccordionItem value="review" className="border-slate-200/80">
              <AccordionTrigger className="py-4 hover:no-underline">
                <SectionTrigger
                  icon={<ShieldAlert className="h-4 w-4" />}
                  label="Review"
                  value={session.status === "finalized" ? "Done" : String(pendingReviewCount)}
                  tone={pendingReviewCount > 0 ? "amber" : "slate"}
                />
              </AccordionTrigger>
              <AccordionContent className="pt-0">
                <ReviewPanel
                  session={session}
                  canFinalize={!hasPendingReview}
                  onResolveReviewItem={onResolveReviewItem}
                  onFinalize={onFinalize}
                  onReturnToDraft={onReturnToDraft}
                />
              </AccordionContent>
            </AccordionItem>
          ) : null}
        </Accordion>
      </CardContent>
    </Card>
  );
}

export default function LiveConversationWorkspace() {
  const [isVisitsCollapsed, setIsVisitsCollapsed] = useState(false);
  const {
    sessions,
    selectedSession,
    selectedSessionId,
    hasPendingReview,
    isLoading,
    error,
    availableDevices,
    createDraftSession,
    selectSession,
    returnToDraft,
    updateSelectedSession,
    startSelectedSession,
    pauseSelectedSession,
    resumeSelectedSession,
    stopSelectedSession,
    resolveReviewItem,
    finalizeSelectedSession,
    deleteSession,
    refreshSessions,
    captureState,
    transportState,
    audioLevel,
  } = useLiveConversationAPI();

  if (!selectedSession) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-slate-500">{isLoading ? "Loading live conversations..." : "No session selected"}</p>
          {!isLoading ? (
            <Button
              className="mt-4 border-teal-600 bg-teal-600 text-white hover:border-teal-700 hover:bg-teal-700"
              onClick={() => createDraftSession()}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Session
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Ambient capture</p>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Live conversation</h2>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      <div className={`grid gap-5 ${isVisitsCollapsed ? "xl:grid-cols-[0px_minmax(0,1fr)_360px]" : "xl:grid-cols-[248px_minmax(0,1fr)_360px]"}`}>
        <SessionList
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          selectedSessionStatus={selectedSession.status}
          onSelectSession={selectSession}
          onCreateDraftSession={createDraftSession}
          isCollapsed={isVisitsCollapsed}
          onToggleCollapse={() => setIsVisitsCollapsed(!isVisitsCollapsed)}
        />

        <div className="grid gap-0.5">
          <ControlBar
            session={selectedSession}
            onStart={startSelectedSession}
            onPause={pauseSelectedSession}
            onResume={resumeSelectedSession}
            onStop={stopSelectedSession}
            captureState={captureState}
            transportState={transportState}
            audioLevel={audioLevel}
          />
          <RecordingPanel session={selectedSession} onDeleteSession={deleteSession} />
          <TranscriptPanel
            session={selectedSession}
            captureState={captureState}
            transportState={transportState}
            audioLevel={audioLevel}
          />
        </div>

        <ContextPanel
          session={selectedSession}
          onUpdateSession={updateSelectedSession}
          hasPendingReview={hasPendingReview}
          onResolveReviewItem={resolveReviewItem}
          onFinalize={finalizeSelectedSession}
          onReturnToDraft={returnToDraft}
          availableDevices={availableDevices}
        />
      </div>
    </div>
  );
}
