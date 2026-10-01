"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Sparkles, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { AiConversationDrawer, AiConversationSidebar } from "@/components/domain/ai-conversation-sidebar";
import {
  ChatComposer,
  ChatEmptyState,
  MessageError,
  MessageList,
  PendingActionCard,
} from "@/components/domain/ai-chat";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isAiNotConfigured,
  useActionOutcomes,
  useCancelPendingAction,
  useConfirmPendingAction,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useMessages,
  usePendingAction,
  useRenameConversation,
  useSendMessage,
} from "@/features/ai/hooks";
import { generateConversationTitle } from "@/features/ai/chat-utils";
import { CONVERSATION_TYPE_DESCRIPTIONS, CONVERSATION_TYPE_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import type { AiMessage, AiToolActivity, ConversationType } from "@/types/api-types";

/** Where the open conversation is remembered so a reload lands back in it. */
const ACTIVE_CONVERSATION_KEY = "studentos.ai.activeConversation";

function readActiveConversation(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

function writeActiveConversation(id: string | null) {
  try {
    if (id) window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    else window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    // Private mode or a disabled store: the chat still works, it just will not
    // remember the selection.
  }
}

export default function AiPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [draft, setDraft] = useState("");
  const [newType, setNewType] = useState<ConversationType>("CHAT");
  const [unconfigured, setUnconfigured] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  const [liveActivity, setLiveActivity] = useState<AiToolActivity[]>([]);
  // Tool activity is returned with the reply but never persisted, so it is
  // only ever shown against the single message that produced it.
  const [activityRun, setActivityRun] = useState<{ replyId: string; activity: AiToolActivity[] } | null>(
    null,
  );
  // Titles derived from the first message, shown before the rename persists.
  const [derivedTitles, setDerivedTitles] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  // Guards the send path so a double Enter cannot start two generations.
  const sendingRef = useRef(false);
  // A first prompt typed before any conversation exists: wait for the newly
  // created conversation's (known-empty) transcript to settle, then send.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const conversations = useConversations({ limit: 100 });
  const messages = useMessages(selectedId ?? undefined);
  const pendingAction = usePendingAction(selectedId ?? undefined);
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const renameConversation = useRenameConversation();
  const sendMessage = useSendMessage();
  const confirmAction = useConfirmPendingAction();
  const cancelAction = useCancelPendingAction();
  // Real per-step results from the last confirm, shown on the proposal card.
  const actionOutcomes = useActionOutcomes(selectedId ?? undefined);

  const convoItems = useMemo(() => conversations.data?.items ?? [], [conversations.data]);
  const selected = useMemo(
    () => convoItems.find((conversation) => conversation.id === selectedId),
    [convoItems, selectedId],
  );
  const messageItems = useMemo(() => messages.data ?? [], [messages.data]);
  const proposal = pendingAction.data ?? null;
  const generating = sendMessage.isPending;
  // A disabled query reports `isPending` forever, which would pin the skeleton
  // on screen when there is no conversation yet.
  const messagesLoading = Boolean(selectedId) && messages.isFetching;

  // Restore the conversation the student left open, falling back to the most
  // recent one.
  useEffect(() => {
    if (restored || conversations.isPending) return;
    setRestored(true);
    const stored = readActiveConversation();
    const exists = stored && convoItems.some((conversation) => conversation.id === stored);
    setSelectedId(exists ? stored : convoItems[0]?.id ?? null);
  }, [restored, conversations.isPending, convoItems]);

  useEffect(() => {
    if (restored) writeActiveConversation(selectedId);
  }, [restored, selectedId]);

  const selectConversation = useCallback((id: string) => {
    setSelectedId(id);
    setDraft("");
    setSendError(null);
    setLiveActivity([]);
    setActivityRun(null);
  }, []);

  const startConversation = useCallback(
    (type: ConversationType = newType) => {
      setSendError(null);
      void createConversation
        .mutateAsync({ type })
        .then((conversation) => {
          setSelectedId(conversation.id);
          setDraft("");
          setLiveActivity([]);
          setActivityRun(null);
        })
        .catch((error) => {
          if (isAiNotConfigured(error)) setUnconfigured(true);
        });
    },
    [createConversation, newType],
  );

  /**
   * Send. The message itself is added to the cached transcript by
   * `useSendMessage` the instant this runs, so it is on screen before the
   * request leaves the browser.
   */
  const send = useCallback(
    (content: string) => {
      const text = content.trim();
      if (!text || !selectedId || sendingRef.current) return;

      sendingRef.current = true;
      setDraft("");
      setSendError(null);
      setLiveActivity([]);
      setActivityRun(null);

      const controller = new AbortController();
      abortRef.current = controller;

      // Title the conversation from its first message, once, and persist it so
      // the sidebar stays meaningful after a reload.
      const isFirstMessage = !messageItems.some((message) => message.role === "USER");
      const derived = isFirstMessage ? generateConversationTitle(text) : "";

      if (derived) {
        setDerivedTitles((current) => ({ ...current, [selectedId]: derived }));
        renameConversation.mutate({ id: selectedId, title: derived });
      }

      void sendMessage
        .mutateAsync({ conversationId: selectedId, content: text, signal: controller.signal })
        .then((result) => {
          // Tool activity is returned with the reply but is not persisted, so
          // it is only ever shown against the run that produced it.
          setLiveActivity([]);
          if (result.reply) {
            setActivityRun({ replyId: result.reply.id, activity: result.toolActivity ?? [] });
            setDerivedTitles((current) => {
              const next = { ...current };
              delete next[selectedId];
              return next;
            });
          }
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          if (isAiNotConfigured(error)) setUnconfigured(true);
          else setSendError(error);
        })
        .finally(() => {
          sendingRef.current = false;
          abortRef.current = null;
        });
    },
    [messageItems, renameConversation, selectedId, sendMessage],
  );

  const stopGenerating = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * Entry point for the composer and the empty-state prompts. With a
   * conversation open it sends immediately; on a brand-new account it creates
   * one first and queues the prompt until its empty transcript has loaded, so
   * the optimistic message still lands before the request leaves the browser.
   */
  const handlePrompt = useCallback(
    (content: string) => {
      const text = content.trim();
      if (!text || sendingRef.current) return;
      if (selectedId) {
        send(text);
        return;
      }
      setPendingPrompt(text);
      startConversation();
    },
    [selectedId, send, startConversation],
  );

  // Fire the queued first prompt once the new conversation's transcript has
  // loaded (even an empty one). Waiting on `data` (not just "not fetching")
  // stops the messages refetch from clobbering the optimistic insert, which
  // would otherwise flash the user's bubble away on a fresh conversation.
  useEffect(() => {
    if (!pendingPrompt || !selectedId || messages.data === undefined) return;
    const queued = pendingPrompt;
    setPendingPrompt(null);
    send(queued);
  }, [pendingPrompt, selectedId, messages.data, send]);

  const removeConversation = useCallback(
    (id: string) => {
      void deleteConversation.mutateAsync(id).then(() => {
        if (selectedId !== id) return;
        const next = convoItems.find((conversation) => conversation.id !== id);
        if (next) selectConversation(next.id);
        else {
          setSelectedId(null);
          writeActiveConversation(null);
        }
      });
    },
    [convoItems, deleteConversation, selectConversation, selectedId],
  );

  // A failing conversation load must not look like an empty conversation.
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

  const title = selected
    ? derivedTitles[selected.id] ?? selected.title
    : "New conversation";

  const sidebarProps = {
    conversations: convoItems,
    isPending: conversations.isPending,
    isError: conversations.isError,
    error: conversations.error,
    onRetry: () => void conversations.refetch(),
    selectedId,
    derivedTitles,
    onSelect: selectConversation,
    onDelete: removeConversation,
    onRename: (id: string, nextTitle: string) => {
      setDerivedTitles((current) => {
        const copy = { ...current };
        delete copy[id];
        return copy;
      });
      renameConversation.mutate({ id, title: nextTitle });
    },
    onNewChat: () => startConversation(),
    creating: createConversation.isPending,
  };

  return (
    <div className="flex min-h-0 flex-col">
      <PageHeader
        kicker="AI Assistant"
        title="AI Assistant"
        description="Chat with your study companion across courses, topics and plans."
        actions={
          <div className="flex items-center gap-2">
            <Select value={newType} onValueChange={(value) => setNewType(value as ConversationType)}>
              <SelectTrigger className="hidden w-36 sm:inline-flex" aria-label="Conversation type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CONVERSATION_TYPE_LABELS) as ConversationType[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {CONVERSATION_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AiConversationDrawer {...sidebarProps} />
            <Button size="sm" onClick={() => startConversation()} disabled={createConversation.isPending}>
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
              <span className="hidden lg:inline">New chat</span>
              <span className="lg:hidden">New</span>
            </Button>
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="hidden min-h-0 lg:block">
          <AiConversationSidebar {...sidebarProps} />
        </aside>

        <section className="flex h-[calc(100dvh-15rem)] min-h-[26rem] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                aria-hidden
              >
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {selected ? (
                    <>
                      {CONVERSATION_TYPE_DESCRIPTIONS[selected.type] ?? selected.type}
                      <span className="ml-2">· started {formatDate(selected.createdAt, "MMM d")}</span>
                    </>
                  ) : (
                    "Start a conversation"
                  )}
                </p>
              </div>
            </div>

            {selected && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-danger hover:text-danger"
                  onClick={() => removeConversation(selected.id)}
                  aria-label="Delete conversation"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            )}
          </header>

          <MessageList
            messages={messageItems}
            isLoading={messagesLoading}
            isError={messages.isError}
            error={messages.error}
            onRetryLoad={() => void messages.refetch()}
            generating={generating}
            liveActivity={liveActivity}
            activityRun={activityRun}
            onRetryMessage={(message: AiMessage) => send(message.content)}
            empty={
              <ChatEmptyState onPrompt={handlePrompt} busy={generating || createConversation.isPending || Boolean(pendingPrompt)} />
            }
          >
            {proposal && selectedId && (
              <div className="pl-9">
                <PendingActionCard
                  action={proposal}
                  outcomes={actionOutcomes.data}
                  busy={confirmAction.isPending || cancelAction.isPending}
                  onConfirm={() => confirmAction.mutate({ conversationId: selectedId, actionId: proposal.id })}
                  onCancel={() => cancelAction.mutate({ conversationId: selectedId, actionId: proposal.id })}
                />
              </div>
            )}

            {sendError != null && !generating && (
              <div className="px-9">
                <MessageError
                  error={sendError}
                  onRetry={() => {
                    const lastUser = [...messageItems].reverse().find((m) => m.role === "USER");
                    if (lastUser) send(lastUser.content);
                  }}
                />
              </div>
            )}
          </MessageList>

          <ChatComposer
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => handlePrompt(draft)}
            onStop={stopGenerating}
            busy={generating}
            disabled={messagesLoading}
            disabledReason="Loading this conversation…"
            placeholder={
              selected
                ? `Message ${CONVERSATION_TYPE_LABELS[selected.type].toLowerCase()}…`
                : "Start a new conversation…"
            }
          />
        </section>
      </div>
    </div>
  );
}
