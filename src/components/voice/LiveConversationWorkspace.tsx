import { useState } from "react";
import {
  AlertTriangle,
  AudioLines,
  CheckCheck,
  Clock3,
  Edit3,
  FileCheck2,
  Mic,
  PauseCircle,
  PlayCircle,
  RadioTower,
  ShieldAlert,
  Square,
  TimerReset,
  UserRound,
  Waves,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  formatLiveDuration,
  useLiveConversationSession,
  type LiveConversationSession,
  type LiveReviewItem,
  type LiveReviewResolution,
  type LiveTranscriptSegment,
} from "@/hooks/useLiveConversationSession";

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

function SessionMetric({
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

function SessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
  onCreateDraftSession,
}: {
  sessions: LiveConversationSession[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateDraftSession: () => void;
}) {
  const activeSessions = sessions.filter((session) => ["draft", "live", "paused", "review_required", "finalizing"].includes(session.status));
  const finalizedSessions = sessions.filter((session) => session.status === "finalized");
  const attentionSessions = sessions.filter((session) => session.status === "failed");

  const renderRow = (session: LiveConversationSession, subtitle: string) => (
    <button
      key={session.id}
      type="button"
      className={`w-full rounded-2xl border p-4 text-left transition-colors ${
        session.id === selectedSessionId
          ? "border-teal-300 bg-teal-50/70"
          : "border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white"
      }`}
      onClick={() => onSelectSession(session.id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{session.title}</p>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
        <Badge className={statusTone(session.status)}>{statusLabel(session.status)}</Badge>
      </div>
      <p className="mt-3 text-xs text-slate-500">Updated {formatTimestamp(session.updatedAt)}</p>
    </button>
  );

  return (
    <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-200/80 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base text-slate-900">Live sessions</CardTitle>
            <p className="mt-1 text-sm text-slate-600">UI-only session list for the planned live workflow.</p>
          </div>
          <Button className={PRIMARY_TEAL_BUTTON} onClick={onCreateDraftSession}>
            <Mic className="mr-2 h-4 w-4" />
            Start new session
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 p-5">
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            <Clock3 className="h-4 w-4" />
            Active and draft
          </div>
          <div className="space-y-2">
            {activeSessions.map((session) =>
              renderRow(session, session.encounterLabel || "Encounter link pending"),
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            <FileCheck2 className="h-4 w-4" />
            Recent finalized sessions
          </div>
          <div className="space-y-2">
            {finalizedSessions.map((session) =>
              renderRow(session, `${session.linkedPatient} · ${session.encounterLabel}`),
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            <AlertTriangle className="h-4 w-4" />
            Failed or interrupted
          </div>
          <div className="space-y-2">
            {attentionSessions.map((session) =>
              renderRow(session, session.error || "Capture recovery required"),
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function SetupCard({
  session,
  onUpdate,
  onStart,
  isPreview,
}: {
  session: LiveConversationSession;
  onUpdate: (patch: { linkedPatient?: string; encounterLabel?: string; deviceId?: string }) => void;
  onStart: () => void;
  isPreview: boolean;
}) {
  return (
    <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-200/80 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base text-slate-900">Preflight and session setup</CardTitle>
            <p className="mt-1 text-sm text-slate-600">
              Lock the live conversation UI flow now, then swap the mock driver for realtime transport later.
            </p>
          </div>
          {isPreview ? <Badge className="border-transparent bg-sky-50 text-sky-700">UI-only preview</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Patient link</label>
              <Input
                value={session.linkedPatient}
                onChange={(event) => onUpdate({ linkedPatient: event.target.value })}
                placeholder="Search or type patient name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Encounter link</label>
              <Input
                value={session.encounterLabel}
                onChange={(event) => onUpdate({ encounterLabel: event.target.value })}
                placeholder="Add encounter label"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Input device</label>
            <select
              value={session.recorder.deviceId || ""}
              onChange={(event) => onUpdate({ deviceId: event.target.value })}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
            >
              <option value="built-in-mic">Built-in Microphone</option>
              <option value="room-array">Consult Room Array Mic</option>
              <option value="headset-mic">Clinician Headset Mic</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-slate-600" />
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-600">Recording readiness</p>
            </div>
            <div className="mt-3 space-y-3 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-3">
                <span>Microphone permission</span>
                <Badge className={statusTone(session.status === "failed" ? "failed" : "draft")}>
                  {session.recorder.permission === "unknown" ? "Pending" : session.recorder.permission}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Selected device</span>
                <span className="text-xs text-slate-500">{session.recorder.deviceLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Session context</span>
                <span className="text-xs text-slate-500">
                  {session.linkedPatient || session.encounterLabel ? "Linked" : "Needs context"}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4 text-sm text-amber-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <p className="font-medium">Preview behavior</p>
            </div>
            <p className="mt-2">
              Transcript events, extraction updates, and final publication are simulated here so the UI can be reviewed before backend wiring.
            </p>
          </div>

          {session.error ? (
            <div className="rounded-2xl border border-rose-100 bg-rose-50/80 p-4 text-sm text-rose-900">
              {session.error}
            </div>
          ) : null}

          <Button className={PRIMARY_TEAL_BUTTON} onClick={onStart}>
            <Mic className="mr-2 h-4 w-4" />
            {session.status === "failed" ? "Restart session" : "Start session"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusRail({
  session,
  onPause,
  onResume,
  onStop,
}: {
  session: LiveConversationSession;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  return (
    <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
      <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className={statusTone(session.status)}>{statusLabel(session.status)}</Badge>
          <Badge variant="outline">
            <TimerReset className="mr-1 h-3.5 w-3.5" />
            {formatLiveDuration(session.durationMs)}
          </Badge>
          <Badge variant="outline">
            <RadioTower className="mr-1 h-3.5 w-3.5" />
            {session.transport.connectionState}
          </Badge>
          <Badge variant="outline">
            <Mic className="mr-1 h-3.5 w-3.5" />
            {session.recorder.deviceLabel}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {session.status === "live" ? (
            <Button className={SECONDARY_TEAL_BUTTON} onClick={onPause}>
              <PauseCircle className="mr-2 h-4 w-4" />
              Pause
            </Button>
          ) : null}
          {session.status === "paused" ? (
            <Button className={SECONDARY_TEAL_BUTTON} onClick={onResume}>
              <PlayCircle className="mr-2 h-4 w-4" />
              Resume
            </Button>
          ) : null}
          {(session.status === "live" || session.status === "paused") ? (
            <Button className={PRIMARY_TEAL_BUTTON} onClick={onStop}>
              <Square className="mr-2 h-4 w-4" />
              Stop
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function TranscriptPanel({ session }: { session: LiveConversationSession }) {
  return (
    <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-200/80 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base text-slate-900">Rolling transcript</CardTitle>
            <p className="mt-1 text-sm text-slate-600">Speaker-aware transcript preview for the live session.</p>
          </div>
          {session.transcript.hasGap ? (
            <Badge className="border-transparent bg-amber-50 text-amber-800">Reconnect gap noted</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[560px]">
          <div className="space-y-3 bg-[linear-gradient(180deg,rgba(252,252,249,0.9),rgba(255,255,255,1))] p-4">
            {session.transcript.segments.length === 0 && !session.transcript.interimText ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
                Start the preview session to stream transcript events into this panel.
              </div>
            ) : null}

            {session.transcript.segments.map((segment) => (
              <article
                key={segment.id}
                className={`rounded-xl border bg-white p-4 shadow-sm ${
                  segment.flags.includes("low_confidence")
                    ? "border-amber-200 ring-1 ring-amber-100"
                    : "border-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={speakerTone(segment.speakerRole)}>{segment.speakerLabel}</Badge>
                  <span className="text-xs font-medium text-slate-500">
                    <Clock3 className="mr-1 inline h-3.5 w-3.5" />
                    {segment.startLabel} - {segment.endLabel}
                  </span>
                  <span className="text-xs text-slate-500">
                    {segment.confidence ? `Confidence ${Math.round(segment.confidence * 100)}%` : "Confidence pending"}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-800">{segment.text}</p>
                {segment.flags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {segment.flags.map((flag) => (
                      <Badge
                        key={flag}
                        className={
                          flag === "low_confidence"
                            ? "border-transparent bg-amber-50 text-amber-800"
                            : "border-transparent bg-slate-100 text-slate-700"
                        }
                      >
                        {flag.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}

            {session.transcript.interimText ? (
              <article className="rounded-xl border border-dashed border-sky-200 bg-sky-50/70 p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-transparent bg-sky-100 text-sky-800">Interim transcript</Badge>
                  <span className="text-xs text-slate-500">
                    <AudioLines className="mr-1 inline h-3.5 w-3.5" />
                    Waiting for finalized segment
                  </span>
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

function DraftPanel({ session }: { session: LiveConversationSession }) {
  const draft = session.draft.extractedData;
  const pendingReview = session.draft.reviewItems.filter((item) => item.resolution === "pending").length;
  const medications = draft.medications.map((item) => `${item.name} · ${item.instruction}`);
  const workup = [...draft.labs, ...draft.radiology, ...draft.procedures];

  const ListBlock = ({ title, items }: { title: string; items: string[] }) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {items.map((item) => (
            <li key={item} className="rounded-lg bg-slate-50 px-3 py-2">{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-400">No draft content yet.</p>
      )}
    </div>
  );

  return (
    <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-200/80 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base text-slate-900">Draft extraction</CardTitle>
            <p className="mt-1 text-sm text-slate-600">Incremental structured view that will later be backed by realtime extraction.</p>
          </div>
          <Badge className="border-transparent bg-slate-100 text-slate-700">
            {pendingReview} review item{pendingReview === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <UserRound className="h-4 w-4" />
            <p className="text-xs uppercase tracking-[0.18em]">Patient and encounter</p>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-900">{session.linkedPatient || "Encounter link pending"}</p>
          <p className="text-sm text-slate-600">{session.encounterLabel || "Not linked"}</p>
          <Separator className="my-4" />
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Diagnosis draft</p>
          <p className="mt-2 text-sm text-slate-900">{draft.diagnosis || "No diagnosis draft yet."}</p>
        </div>
        <ListBlock title="Symptoms" items={draft.symptoms} />
        <ListBlock title="Medications" items={medications} />
        <ListBlock title="Labs, radiology, procedures" items={workup} />
        <ListBlock title="Follow-up" items={draft.followUp} />
        <ListBlock title="Plan" items={draft.plan} />
      </CardContent>
    </Card>
  );
}

function ReviewPanel({
  session,
  canFinalize,
  onResolveReviewItem,
  onFinalize,
}: {
  session: LiveConversationSession;
  canFinalize: boolean;
  onResolveReviewItem: (reviewItemId: string, resolution: LiveReviewResolution, editedValue?: string) => void;
  onFinalize: () => void;
}) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  return (
    <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-200/80 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base text-slate-900">Review and finalize</CardTitle>
            <p className="mt-1 text-sm text-slate-600">
              Hold final publication until medication and follow-up ambiguities are resolved.
            </p>
          </div>
          <Button className={PRIMARY_TEAL_BUTTON} onClick={onFinalize} disabled={!canFinalize || session.status === "finalizing"}>
            <FileCheck2 className="mr-2 h-4 w-4" />
            {session.status === "finalizing" ? "Finalizing..." : "Finalize to dashboard"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-5">
        {!canFinalize ? (
          <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4 text-sm text-amber-900">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              <p className="font-medium">Finalize is blocked</p>
            </div>
            <p className="mt-2">Resolve all pending review items before the session can publish to the shared dashboard route.</p>
          </div>
        ) : null}

        {session.draft.reviewItems.map((item) => {
          const isEditing = editingItemId === item.id;
          return (
            <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={severityTone(item.severity)}>{item.severity}</Badge>
                <Badge variant="outline">{item.category.replace(/_/g, " ")}</Badge>
                <Badge variant="outline">{item.resolution}</Badge>
              </div>
              <p className="mt-3 text-sm font-medium text-slate-900">{item.title}</p>
              <p className="mt-2 text-sm text-slate-600">
                Suggested value: <span className="font-medium text-slate-800">{item.editedValue || item.suggestedValue}</span>
              </p>
              {isEditing ? (
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
                      Save edit
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
      </CardContent>
    </Card>
  );
}

function PublishedSummary({
  session,
  onReturnToDraft,
}: {
  session: LiveConversationSession;
  onReturnToDraft: () => void;
}) {
  return (
    <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
      <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-transparent bg-emerald-50 text-emerald-700">Published state</Badge>
            <Badge variant="outline">Mock document id {session.documentId}</Badge>
          </div>
          <h3 className="mt-3 text-lg font-semibold text-slate-900">{session.title}</h3>
          <p className="mt-1 text-sm text-slate-600">
            This final state is UI-only for now. The dashboard launch will be connected once the finalize backend exists.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className={PRIMARY_TEAL_BUTTON}
            onClick={() => {
              toast.info("Dashboard launch will be wired once live conversation finalization reaches the backend.");
            }}
          >
            Open dashboard
          </Button>
          <Button className={SECONDARY_TEAL_BUTTON} onClick={onReturnToDraft}>
            Back to voice workspace
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LiveConversationWorkspace() {
  const {
    isPreview,
    sessions,
    selectedSession,
    selectedSessionId,
    hasPendingReview,
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
  } = useLiveConversationSession();

  if (!selectedSession) {
    return null;
  }

  const activeCount = sessions.filter((session) => ["draft", "live", "paused", "review_required", "finalizing"].includes(session.status)).length;
  const finalizedCount = sessions.filter((session) => session.status === "finalized").length;
  const attentionCount = sessions.filter((session) => session.status === "failed").length;
  const showSetup = selectedSession.status === "draft" || selectedSession.status === "failed";
  const showConversationShell = ["live", "paused", "review_required", "finalizing", "finalized"].includes(selectedSession.status);

  return (
    <div className="grid gap-6">
      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Live Conversation</p>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">Live doctor-patient conversation</h2>
              <p className="text-sm text-slate-600">
                UI shell for realtime transcript, draft extraction, and review before backend streaming is added.
              </p>
            </div>
            {isPreview ? <Badge className="border-transparent bg-sky-50 text-sky-700">Mock events active</Badge> : null}
          </div>
          <div className="rounded-xl border border-teal-200/80 bg-teal-50/70 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <SessionMetric label="Total sessions" value={sessions.length} />
              <SessionMetric label="Active" value={activeCount} />
              <SessionMetric label="Finalized" value={finalizedCount} />
              <SessionMetric label="Attention" value={attentionCount} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <SessionList
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={selectSession}
          onCreateDraftSession={createDraftSession}
        />

        <div className="grid gap-6">
          {showSetup ? (
            <SetupCard
              session={selectedSession}
              onUpdate={updateSelectedSession}
              onStart={startSelectedSession}
              isPreview={isPreview}
            />
          ) : null}

          {showConversationShell ? (
            <>
              <StatusRail
                session={selectedSession}
                onPause={pauseSelectedSession}
                onResume={resumeSelectedSession}
                onStop={stopSelectedSession}
              />

              {selectedSession.status === "paused" ? (
                <div className="rounded-2xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-sky-900">
                  Paused. The session draft is preserved and can resume without losing transcript or extraction context.
                </div>
              ) : null}

              {selectedSession.status === "live" && selectedSession.recorder.permission === "unknown" ? (
                <div className="rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
                  Waiting for microphone. In the final flow this state will reflect real browser permission and device readiness.
                </div>
              ) : null}

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
                <TranscriptPanel session={selectedSession} />
                <DraftPanel session={selectedSession} />
              </div>

              {(selectedSession.status === "review_required" || selectedSession.status === "finalizing") ? (
                <ReviewPanel
                  session={selectedSession}
                  canFinalize={!hasPendingReview}
                  onResolveReviewItem={resolveReviewItem}
                  onFinalize={finalizeSelectedSession}
                />
              ) : null}

              {selectedSession.status === "finalized" ? (
                <PublishedSummary session={selectedSession} onReturnToDraft={returnToDraft} />
              ) : null}
            </>
          ) : null}

          {showSetup ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-5 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <Waves className="h-4 w-4" />
                <p className="font-medium text-slate-900">Planned live capture layout</p>
              </div>
              <p className="mt-2">
                Once started, this area switches into the status rail, rolling transcript, draft extraction panel, and review/finalize states from the live conversation plan.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
