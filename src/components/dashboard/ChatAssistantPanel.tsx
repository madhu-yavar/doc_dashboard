import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Loader2, MessageSquare, MessageSquarePlus, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { API_BASE, type ProcessedDocument } from "@/lib/processedDocuments";

type ChatCitation = {
  label: string;
  source_class: "internal" | "external";
  source_section?: string;
  source_excerpt?: string;
  source_page?: number | null;
  url?: string;
  retrieved_at?: string;
  provenance_type?: "quoted" | "normalized" | "derived";
};

type ChatActionProposal = {
  id: string;
  type: "suggest_note_update" | "flag_abnormal_value" | "export_chat_summary";
  title: string;
  payload: Record<string, unknown>;
  rationale: string;
  citations: ChatCitation[];
  requires_confirmation: true;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content?: string;
  answer?: string;
  citations?: ChatCitation[];
  confidence?: number;
  confidence_label?: string;
  source_class?: "internal" | "external" | "mixed";
  proposed_actions?: ChatActionProposal[];
  decision_prompt?: {
    type: "external_search_consent";
    question?: string;
    options: Array<{ label: string; value: string }>;
  } | null;
  createdAt?: string;
};

type ChatSession = {
  chatId: string;
  documentId: string;
  messages: ChatMessage[];
  confirmedActions?: Array<ChatActionProposal & { confirmedAt?: string }>;
};

interface ChatAssistantPanelProps {
  documentId?: string | null;
  currentSection?: string | null;
  processedDocument?: ProcessedDocument | null;
}

const confidenceTone: Record<string, string> = {
  high: "text-emerald-700 bg-emerald-50 border-emerald-200",
  medium: "text-amber-700 bg-amber-50 border-amber-200",
  low: "text-amber-700 bg-amber-50 border-amber-200",
  refuse: "text-rose-700 bg-rose-50 border-rose-200",
};

const sourceTone: Record<string, string> = {
  internal: "bg-emerald-50 text-emerald-700",
  external: "bg-teal-50 text-teal-700",
  mixed: "bg-green-50 text-green-700",
};

const ChatAssistantPanel = ({ documentId, currentSection, processedDocument }: ChatAssistantPanelProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [chatId, setChatId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!documentId) {
      setMessages([]);
      setChatId("");
      return;
    }

    fetch(`${API_BASE}/chat/history/${documentId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load chat history");
        return response.json();
      })
      .then((payload) => {
        const session = payload.session as ChatSession | null;
        if (session) {
          setChatId(session.chatId);
          setMessages(session.messages || []);
        } else {
          setChatId("");
          setMessages([]);
        }
      })
      .catch(() => {
        setChatId("");
        setMessages([]);
      });
  }, [documentId]);

  if (!documentId) return null;

  const handleSendMessage = async (rawMessage: string, options?: { preserveInput?: boolean }) => {
    const message = rawMessage.trim();
    if (!message || isLoading) return;

    setIsLoading(true);
    setError("");
    const optimisticMessage: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimisticMessage]);
    if (!options?.preserveInput) {
      setInput("");
    }

    try {
      const response = await fetch(`${API_BASE}/chat/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          message,
          sectionContext: currentSection,
          chatId: chatId || undefined,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Chat request failed");

      const session = payload.session as ChatSession;
      setChatId(session.chatId);
      setMessages(session.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat request failed");
      setMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => handleSendMessage(input);

  const handleConfirmAction = async (actionId: string) => {
    if (!chatId) return;
    setError("");
    try {
      const response = await fetch(`${API_BASE}/chat/action/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, chatId, actionId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to confirm action");
      setMessages(payload.session.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm action");
    }
  };

  const handleExport = async () => {
    if (!chatId || exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/chat/export/${documentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to export chat summary");

      const text = payload.export?.chart_note_appendix || "";
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `assistant-summary-${processedDocument?.name || documentId}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export summary");
    } finally {
      setExporting(false);
    }
  };

  const handleClearChat = async () => {
    if (!chatId && messages.length === 0) return;
    const confirmed = window.confirm("Clear this chat for the current record?");
    if (!confirmed) return;

    setError("");
    try {
      const query = chatId ? `?chatId=${encodeURIComponent(chatId)}` : "";
      const response = await fetch(`${API_BASE}/chat/history/${documentId}${query}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to clear chat");

      setMessages([]);
      setChatId("");
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear chat");
    }
  };

  if (!isOpen) {
    return (
      <div className="fixed bottom-5 right-5 z-40">
        <button
          className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600 shadow-[0_12px_28px_rgba(15,23,42,0.12)] transition-colors hover:bg-emerald-100 hover:text-emerald-700"
          onClick={() => setIsOpen(true)}
          title="Open chat"
        >
          <MessageSquare className="h-4.5 w-4.5" strokeWidth={1.8} />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="overflow-hidden rounded-[18px] border border-emerald-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.12)]">
        <div className="flex items-center justify-between border-b border-emerald-100 bg-gradient-to-r from-emerald-50/50 to-white px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600">
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
            </div>
            <span className="text-xs font-medium text-emerald-800">AI Assistant</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-40"
              onClick={handleClearChat}
              disabled={!chatId && messages.length === 0}
              title="Clear chat"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" onClick={handleExport} disabled={!chatId || exporting}>
              {exporting ? "Exporting..." : "Export"}
            </Button>
            <button className="rounded-md p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" onClick={() => setIsOpen((open) => !open)}>
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {isOpen ? (
          <>
            <ScrollArea className="h-[420px] px-4 py-3">
              <div className="space-y-3">
                {messages.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/50 px-3 py-4 text-sm text-emerald-700">
                    Ask about the current patient record, meds, labs, diagnosis, discharge plan, or broader medical context.
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`rounded-2xl px-3 py-2.5 ${
                        message.role === "user"
                          ? "ml-8 bg-emerald-700 text-white"
                          : message.role === "system"
                          ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "mr-8 border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white"
                      }`}
                    >
                      {message.role === "user" ? (
                        <p className="text-[13px] leading-5">{message.content}</p>
                      ) : message.role === "system" ? (
                        <p className="text-[12px] font-medium">{message.content}</p>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {message.source_class ? (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sourceTone[message.source_class]}`}>
                                {message.source_class}
                              </span>
                            ) : null}
                            {message.confidence_label ? (
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${confidenceTone[message.confidence_label] || confidenceTone.low}`}>
                                {message.confidence_label}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-[13px] leading-5 text-slate-700">{message.answer}</p>
                          {message.citations?.length ? (
                            <details className="rounded-xl bg-white/80 px-2.5 py-2">
                              <summary className="cursor-pointer list-none text-[11px] font-medium text-emerald-700 hover:text-emerald-800">
                                View sources ({message.citations.length})
                              </summary>
                              <div className="mt-2 space-y-1.5">
                                {message.citations.slice(0, 4).map((citation, index) => (
                                  <div key={`${citation.label}-${index}`} className="text-[11px] text-slate-500">
                                    <div className="flex items-center gap-1">
                                      <span className="font-medium text-slate-600">{citation.label}</span>
                                      {citation.url ? (
                                        <a href={citation.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700">
                                          <ExternalLink className="h-3 w-3" />
                                        </a>
                                      ) : null}
                                    </div>
                                    {citation.source_excerpt ? <p className="mt-0.5 line-clamp-2 text-emerald-600/80">{citation.source_excerpt}</p> : null}
                                  </div>
                                ))}
                              </div>
                            </details>
                          ) : null}
                          {message.proposed_actions?.length ? (
                            <div className="space-y-2">
                              {message.proposed_actions.map((action) => (
                                <div key={action.id} className="rounded-xl border border-emerald-200 bg-white px-3 py-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <p className="text-[12px] font-semibold text-emerald-900">{action.title}</p>
                                      <p className="mt-0.5 text-[11px] text-emerald-700/70">{action.rationale}</p>
                                    </div>
                                    <Button size="sm" className="h-7 bg-emerald-600 text-[11px] hover:bg-emerald-700" onClick={() => handleConfirmAction(action.id)}>
                                      Confirm
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {message.decision_prompt?.type === "external_search_consent" ? (
                            <div className="flex items-center gap-2">
                              {message.decision_prompt.options.map((option) => (
                                <Button
                                  key={option.value}
                                  size="sm"
                                  variant={option.value === "yes" ? "default" : "outline"}
                                  className="h-7 text-[11px]"
                                  disabled={isLoading}
                                  onClick={() => handleSendMessage(option.value, { preserveInput: true })}
                                >
                                  {option.label}
                                </Button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))
                )}
                {isLoading ? (
                  <div className="mr-8 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/50 px-3 py-2.5 text-[12px] text-emerald-700">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                    Thinking with current record context...
                  </div>
                ) : null}
              </div>
            </ScrollArea>

            <div className="border-t border-slate-100 px-4 py-3">
              {error ? (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-700">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {error}
                </div>
              ) : null}
              <div className="space-y-2">
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask about this patient, meds, trends, ICD, guidelines, or request a note update..."
                  className="min-h-[84px] resize-none text-[13px]"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-400">Patient record first. External medical sources used only when needed.</p>
                  <Button onClick={handleSend} disabled={isLoading || !input.trim()} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                    <MessageSquarePlus className="h-4 w-4" />
                    Ask
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default ChatAssistantPanel;
