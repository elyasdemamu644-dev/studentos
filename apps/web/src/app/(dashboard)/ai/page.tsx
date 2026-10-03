"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, History, Layers, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { AiConversationDrawer, AiConversationSidebar } from "@/components/domain/ai-conversation-sidebar";
import {
  ChatComposer,
  ChatEmptyState,
  MessageError,
  MessageList,
  PendingActionCard,
} from "@/components/domain/ai-chat";
import { AgentRunReport } from "@/components/domain/agent-run-report";
import { AiContextPanel, AiContextDrawer } from "@/components/domain/ai-context-panel";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkspacePanel } from "@/components/ui/surface";
import {
  isAiNotConfigured,
  useActionOutcomes,
  useCancelPendingAction,
  useConfirmPendingAction,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useLastAgentRun,
  useMessages,
  usePendingAction,
  useRenameConversation,
  useSendMessage,
} from "@/features/ai/hooks";
import { generateConversationTitle } from "@/features/ai/chat-utils";
import { CONVERSATION_TYPE_LABELS } from "@/lib/labels";
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
  // The two supporting panels are independent. Each one owns exactly one piece
  // of collapse state, which drives both its own rail and the single control in
  // its own header. Collapsing gives the width straight back to the chat, in
  // any combination, and never touches another panel.
  //
  // The AI chat has no state here at all: it is the permanent main panel, so it
  // has no control to press and nothing to restore.
  const [historyOpen, setHistoryOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(true);

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
  // Which provider/model actually answered the last turn here, and how it
  // ended. Cache-only, so it is `null` after a reload rather than invented.
  const lastAgentRun = useLastAgentRun(selectedId ?? undefined);

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
   *
   * `retryOf` reuses the slot of a message that already failed rather than
   * appending a second copy of the same text.
   */
  const send = useCallback(
    (content: string, retryOf?: string) => {
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
      // the sidebar stays meaningful after a reload. A retry is never the first
      // message, so it never re-titles.
      const isFirstMessage = !retryOf && !messageItems.some((message) => message.role === "USER");
      const derived = isFirstMessage ? generateConversationTitle(text) : "";

      if (derived) {
        setDerivedTitles((current) => ({ ...current, [selectedId]: derived }));
        renameConversation.mutate({ id: selectedId, title: derived });
      }

      void sendMessage
        .mutateAsync({
          conversationId: selectedId,
          content: text,
          signal: controller.signal,
          retryOf,
        })
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
    // This one screen is prose, not a workspace, so it scrolls itself — the
    // shell no longer scrolls for us.
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-[var(--page-pad)] py-4">
          <PageHeader
            kicker="AI Assistant"
            title="AI Assistant"
            description="Chat with your study companion across courses, topics and plans."
          />
          <div className="surface-panel p-6 text-center">
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
      </div>
    );
  }

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
    /* ───────────────────────────────────────────────────────────────
         AI workspace theming

         The assistant is meant to feel like a different room from the rest
         of the app, so its surfaces come from the theme's AI tokens
         (`bg-ai`, `rounded-ai`, `font-ai`, `shadow-ai`) rather than the
         page chrome. A theme can therefore make the chat feel warmer,
         softer or neon without touching the rest of the product.
         ─────────────────────────────────────────────────────────────── */
    /* A row of three boxes, inside the viewport height the shell hands down
       (`AppShell`'s workspace route). Nothing here scrolls the page: `min-h-0`
       on every flex child is what keeps the panels bounded instead of letting
       the document grow, and each box scrolls its own content. */
    <div className="flex h-full min-h-0 flex-col gap-3 bg-ai p-3 font-ai">
      {/* ── The three panels ─────────────────────────────────────────────
          Three equal-height boxes on one row. The chat is the one that grows
          and never collapses; the other two are fixed supporting columns, and
          each collapses to a rail that hands its width straight back to it. */}
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        {/* Chat History. A real column from `lg` up. */}
        <WorkspacePanel
          title="Chat History"
          label="chat history"
          icon={History}
          collapsed={!historyOpen}
          onCollapsedChange={(collapsed) => setHistoryOpen(!collapsed)}
          expandedClassName="w-64"
          className="hidden lg:flex"
          bodyClassName="px-3 py-3"
        >
          {/* `AiConversationSidebar` scrolls its own list. */}
          <AiConversationSidebar {...sidebarProps} />
        </WorkspacePanel>

        {/* AI Chat — the dominant panel, and the only one with no width of its
            own, so it absorbs whatever the other two give up. No `collapsed`
            and no `onCollapsedChange`, which is what makes it permanent: there
            is no control to press, no collapsed state and no rail.

            The workspace controls live in this panel's own header rather than in
            a bar of their own above the row. They used to occupy a separate
            block, which cost the conversation a full strip of height for no
            gain — and left the chat's real top edge a second row down. The
            panel header already renders `headerExtra` after the title, so this
            is the same markup in the same place, one row higher. */}
        <WorkspacePanel
          title="AI Assistant"
          label="AI chat"
          icon={Sparkles}
          headerExtra={
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {/* Below `lg` the history is a drawer, and below the three-pane
                  width the context is one, so the workspace stays single-column
                  there instead of squeezing the chat to a third of the screen. */}
              <AiConversationDrawer {...sidebarProps} />
              <AiContextDrawer />
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
              <Button size="sm" onClick={() => startConversation()} disabled={createConversation.isPending}>
                <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
                <span className="hidden lg:inline">New chat</span>
                <span className="lg:hidden">New</span>
              </Button>
            </div>
          }
        >
          {/* `<section>` rather than a second `<main>`: the shell already owns
              the page's `<main>`, and two of them break the document outline
              and screen-reader navigation. */}
          <section
            aria-label="AI conversation"
            className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          >
            {/* No conversation header here. It repeated what the history column
                and this panel's own title bar already say — the conversation
                title, its type blurb and the date it started — and charged the
                transcript a strip of height to say it. The transcript now starts
                directly under the panel's controls.

                Deleting a conversation is not lost with it: every row in Chat
                History still carries its own delete control, in the column and
                in the drawer. */}
            <MessageList
              conversationId={selectedId}
              messages={messageItems}
              isLoading={messagesLoading}
              isError={messages.isError}
              error={messages.error}
              onRetryLoad={() => void messages.refetch()}
              generating={generating}
              liveActivity={liveActivity}
              activityRun={activityRun}
              onRetryMessage={(message: AiMessage) => send(message.content, message.id)}
              empty={
                <ChatEmptyState
                  onPrompt={handlePrompt}
                  busy={generating || createConversation.isPending || Boolean(pendingPrompt)}
                />
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
                      // Retry the message that actually failed, in place. Falling
                      // back to the last user message would append a second copy.
                      const failed = [...messageItems]
                        .reverse()
                        .find((m) => m.role === "USER" && m.failed);
                      if (failed) send(failed.content, failed.id);
                    }}
                  />
                </div>
              )}
            </MessageList>

            {/* What the last turn actually did, and how it ended. Only rendered
                when the API reported a run in this browser session. */}
            {lastAgentRun.data && (
              <div className="shrink-0 border-t border-border/70 px-4 py-2">
                <div className="mx-auto w-full max-w-3xl">
                  <AgentRunReport run={lastAgentRun.data} />
                </div>
              </div>
            )}

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
        </WorkspacePanel>

        {/* StudentOS Context. A third box only once the viewport can afford it;
            below that the same panel is a drawer from the toolbar. */}
        <WorkspacePanel
          title="StudentOS Context"
          label="StudentOS context"
          icon={Layers}
          collapsed={!contextOpen}
          onCollapsedChange={(collapsed) => setContextOpen(!collapsed)}
          expandedClassName="w-72"
          className="hidden min-[1360px]:flex"
        >
          <AiContextPanel />
        </WorkspacePanel>
      </div>
    </div>
  );
}