"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleSlash,
  Clock,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState, formatApiError } from "@/components/states";
import { Button, LoadingButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isAiNotConfigured,
  useCancelPendingAction,
  useConfirmPendingAction,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useMessages,
  usePendingAction,
  useSendMessage,
} from "@/features/ai/hooks";
import type { AiMessage, AiToolActivity, ConversationType, PendingAction } from "@/types/api-types";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const CONVERSATION_TYPES: Record<ConversationType, { label: string; description: string }> = {
  CHAT: { label: "Chat", description: "General study questions" },
  TUTOR: { label: "Tutor", description: "Guided teaching & practice" },
  QUIZ: { label: "Quiz", description: "Test your knowledge" },
  STUDY_PLAN: { label: "Study plan", description: "Plan a study schedule" },
  EXPLAIN: { label: "Explain", description: "Break down a topic" },
};

const ACTIVITY_ICON = {
  success: CheckCircle2,
  error: CircleSlash,
  proposed: Clock,
} as const;

/** What the assistant actually looked at, so the answer is never a black box. */
function ToolActivityFeed({ activity }: { activity: AiToolActivity[] }) {
  if (activity.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-border pl-3" aria-label="Assistant activity">
      {activity.map((entry, index) => {
        const Icon = ACTIVITY_ICON[entry.status];
        return (
          <li
            key={`${entry.tool}-${index}`}
            className={cn(
              "flex items-start gap-1.5 text-xs",
              entry.status === "error" ? "text-danger" : "text-muted-foreground",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 h-3 w-3 shrink-0",
                entry.status === "proposed" ? "text-warning" : "",
              )}
              aria-hidden
            />
            <span>
              <span className="font-medium text-foreground/80">{entry.label}</span>
              {entry.summary ? ` — ${entry.summary}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The write gate. Nothing in `actions` has been applied yet: the user either
 * confirms (which executes exactly this proposal) or discards it.
 */
function PendingActionCard({
  action,
  onConfirm,
  onCancel,
  busy,
}: {
  action: PendingAction;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const decided = action.status !== "PENDING";
  const expired = new Date(action.expiresAt).getTime() <= Date.now();

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        decided ? "border-border bg-muted/30" : "border-warning/40 bg-warning/10",
      )}
      role="group"
      aria-label="Proposed change awaiting confirmation"
    >
      <div className="flex items-start gap-2">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{action.title}</p>
          <p className="text-xs text-muted-foreground">
            {decided
              ? action.status === "EXECUTED"
                ? "Applied"
                : "Discarded"
              : "Nothing has been changed yet."}
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {action.actions.map((step, index) => (
          <li key={`${step.tool}-${index}`} className="flex gap-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground">{index + 1}.</span>
            <span className="text-foreground/90">{step.description}</span>
          </li>
        ))}
      </ul>

      {!decided && (
        <>
          {expired && (
            <p className="mt-3 rounded-md bg-warning/15 px-3 py-2 text-xs text-warning">
              This proposal expired. Ask the assistant to prepare it again.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={busy || expired}
              aria-label="Confirm proposed change"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
              Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onCancel}
              disabled={busy}
              aria-label="Discard proposed change"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Discard
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Expires {formatTime(action.expiresAt)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: AiMessage }) {
  const isUser = message.role === "USER";
  return (
    <div className={cn("flex items-start gap-2", isUser ? "flex-row-reverse" : "")}>
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {isUser ? <UserRound className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
      </span>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm border border-border bg-muted/40",
        )}
      >
        <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
        <p className={cn("mt-1 text-[11px]", isUser ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {formatTime(message.createdAt)}
          {message.role === "SYSTEM" && <span className="ml-2 uppercase">system</span>}
        </p>
      </div>
    </div>
  );
}

export default function AiPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newType, setNewType] = useState<ConversationType>("CHAT");
  const [sending, setSending] = useState(false);
  const [unconfigured, setUnconfigured] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Activity is returned with the reply but is not persisted, so keep the
  // latest run alongside the message it belongs to.
  const [lastRun, setLastRun] = useState<{ replyId: string; activity: AiToolActivity[] } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversations = useConversations({ limit: 100 });
  const messages = useMessages(selectedId ?? undefined);
  const pendingAction = usePendingAction(selectedId ?? undefined);
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const sendMessage = useSendMessage();
  const confirmAction = useConfirmPendingAction();
  const cancelAction = useCancelPendingAction();

  const convoItems = useMemo(() => conversations.data?.items ?? [], [conversations.data]);
  const selected = selectedId ? convoItems.find((c) => c.id === selectedId) : undefined;
  const messageItems = messages.data ?? [];
  const proposal = pendingAction.data ?? null;

  useEffect(() => {
    if (convoItems.length > 0 && !selectedId) setSelectedId(convoItems[0].id);
  }, [convoItems, selectedId]);

  useEffect(() => {
    setLastRun(null);
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageItems.length]);

  const canSend = useMemo(() => draft.trim().length > 0 && selectedId != null && !sending, [draft, selectedId, sending]);

  // When the AI provider is unavailable, surface it clearly instead of a generic error.
  if (unconfigured || isAiNotConfigured(conversations.error)) {
    return (
      <div>
        <PageHeader
          kicker="AI Assistant"
          title="AI Assistant"
          description="Chat with your study companion across courses, topics and plans."
        />
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-warning" aria-hidden />
          <p className="mt-3 font-semibold">AI is not configured yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            The assistant needs an AI provider to reply. Add one in Settings so you can ask
            questions, get explanations and quiz yourself on your notes.
          </p>
          <Button asChild className="mt-4" size="sm">
            <Link href="/settings">
              Open settings <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const startConversation = () => {
    void createConversation
      .mutateAsync({ title: CONVERSATION_TYPES[newType].label, type: newType })
      .then((conversation) => {
        setSelectedId(conversation.id);
        setSendError(null);
      })
      .catch((error) => {
        if (isAiNotConfigured(error)) setUnconfigured(true);
      });
  };

  const send = () => {
    const content = draft.trim();
    if (!content || !selectedId || sending) return;
    setSending(true);
    setSendError(null);
    setDraft("");
    void sendMessage
      .mutateAsync({ conversationId: selectedId, content, generateReply: true })
      .then((result) => {
        setLastRun(
          result.reply ? { replyId: result.reply.id, activity: result.toolActivity ?? [] } : null,
        );
      })
      .catch((error) => {
        // Keep the user's message in the box so nothing is lost on failure.
        setDraft(content);
        if (isAiNotConfigured(error)) {
          setUnconfigured(true);
        } else {
          setSendError(formatApiError(error));
        }
      })
      .finally(() => setSending(false));
  };

  const removeConversation = (id: string) => {
    void deleteConversation.mutateAsync(id).then(() => {
      if (selectedId === id) setSelectedId(convoItems.find((c) => c.id !== id)?.id ?? null);
    });
  };

  return (
    <div>
      <PageHeader
        kicker="AI Assistant"
        title="AI Assistant"
        description="Chat with your study companion across courses, topics and plans."
        actions={
          <div className="flex items-center gap-2">
            <Select value={newType} onValueChange={(v) => setNewType(v as ConversationType)}>
              <SelectTrigger className="w-36" aria-label="Conversation type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONVERSATION_TYPES).map(([value, meta]) => (
                  <SelectItem key={value} value={value}>
                    {meta.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={startConversation} disabled={createConversation.isPending}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New chat
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside>
          {conversations.isPending ? (
            <ListSkeleton rows={5} />
          ) : conversations.isError ? (
            <ErrorState error={conversations.error} retry={() => conversations.refetch()} />
          ) : convoItems.length === 0 ? (
            <EmptyState icon={MessageSquare} title="No conversations" description="Start your first chat to get going." className="py-8" />
          ) : (
            <ul className="space-y-1" aria-label="Conversations">
              {convoItems.map((conversation) => (
                <li key={conversation.id}>
                  <div
                    className={cn(
                      "group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors",
                      selectedId === conversation.id
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-card hover:border-primary/30",
                    )}
                    onClick={() => setSelectedId(conversation.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(conversation.id);
                      }
                    }}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{conversation.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {(CONVERSATION_TYPES[conversation.type]?.label ?? conversation.type).toLowerCase()} · {formatDate(conversation.updatedAt, "MMM d")}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeConversation(conversation.id);
                      }}
                      aria-label={`Delete ${conversation.title}`}
                      className="shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="flex min-h-[60vh] flex-col rounded-xl border border-border bg-card shadow-card">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <EmptyState
                icon={Sparkles}
                title={convoItems.length === 0 ? "Start a conversation" : "Select a conversation"}
                description="Pick a chat on the left, or create a new one."
              />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{selected.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {CONVERSATION_TYPES[selected.type]?.description ?? selected.type}
                    <span className="ml-2">· created {formatDate(selected.createdAt)}</span>
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" className="shrink-0 text-danger hover:text-danger" onClick={() => removeConversation(selected.id)} aria-label="Delete conversation">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-5" style={{ minHeight: "50vh", maxHeight: "62vh" }}>
                {messages.isLoading ? (
                  <ListSkeleton rows={3} />
                ) : messages.isError ? (
                  <ErrorState error={messages.error} retry={() => messages.refetch()} />
                ) : messageItems.length === 0 ? (
                  <EmptyState
                    icon={MessageSquare}
                    title="No messages yet"
                    description="Say hello and ask about your courses, tasks or study plan."
                    className="py-8"
                  />
                ) : (
                  <>
                    {messageItems.map((message) => (
                      <div key={message.id} className="space-y-1">
                        <MessageBubble message={message} />
                        {lastRun?.replyId === message.id && (
                          <div className={cn("pl-9", message.role === "USER" && "pl-0 pr-9")}>
                            <ToolActivityFeed activity={lastRun.activity} />
                          </div>
                        )}
                      </div>
                    ))}
                    {sending && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden />
                        Thinking…
                      </div>
                    )}
                  </>
                )}

                {proposal && (
                  <div className="pl-9">
                    <PendingActionCard
                      action={proposal}
                      busy={confirmAction.isPending || cancelAction.isPending}
                      onConfirm={() => {
                        if (!selectedId) return;
                        confirmAction.mutate({ conversationId: selectedId, actionId: proposal.id });
                      }}
                      onCancel={() => {
                        if (!selectedId) return;
                        cancelAction.mutate({ conversationId: selectedId, actionId: proposal.id });
                      }}
                    />
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-border p-4">
                {sendError && (
                  <p role="alert" className="mb-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                    {sendError}
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder={`Message ${CONVERSATION_TYPES[selected.type]?.label.toLowerCase() ?? "the assistant"}… (Enter to send)`}
                    aria-label="Message"
                    rows={2}
                    className="min-h-0 flex-1"
                  />
                  <LoadingButton size="icon" loading={sending} disabled={!canSend} onClick={send} aria-label="Send message">
                    <Send className="h-4 w-4" aria-hidden />
                  </LoadingButton>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}