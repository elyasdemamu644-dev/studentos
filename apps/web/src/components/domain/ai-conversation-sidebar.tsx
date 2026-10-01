"use client";

import { useState } from "react";
import { Check, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";

import { ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { conversationPreview, groupConversations } from "@/features/ai/chat-utils";
import { CONVERSATION_TYPE_LABELS, UNTITLED_CONVERSATION } from "@/lib/labels";
import type { Conversation } from "@/types/api-types";

/**
 * Conversation history.
 *
 * Rows are grouped by recency, titled from the first message the student sent,
 * and previewed with their latest reply. The same markup serves the desktop
 * column and the mobile drawer, so there is one list to reason about.
 */

interface ConversationListProps {
  conversations: Conversation[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | null;
  /** Locally derived title, shown before the rename has round-tripped. */
  derivedTitle?: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  creating?: boolean;
}

function ConversationRow({
  conversation,
  active,
  derivedTitle,
  onSelect,
  onDelete,
  onRename,
}: {
  conversation: Conversation;
  active: boolean;
  derivedTitle?: string | null;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(derivedTitle ?? conversation.title);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== conversation.title) onRename(next);
    else setDraft(derivedTitle ?? conversation.title);
  };

  return (
    <li>
      <div
        className={cn(
          "group relative flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
          active
            ? "border-primary/50 bg-primary/5"
            : "border-transparent hover:border-border hover:bg-muted/40",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? "true" : undefined}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {editing ? (
            <input
              value={draft}
              autoFocus
              aria-label="Conversation title"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                  setDraft(derivedTitle ?? conversation.title);
                }
              }}
              onClick={(event) => event.stopPropagation()}
              className="w-full rounded border border-primary/40 bg-background px-1.5 py-0.5 text-sm font-medium outline-none"
            />
          ) : (
            <span
              className={cn(
                "block truncate text-sm font-medium",
                active ? "text-primary" : "text-foreground",
              )}
            >
              {derivedTitle ?? (conversation.title || UNTITLED_CONVERSATION)}
            </span>
          )}
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="shrink-0 uppercase tracking-wide">
              {CONVERSATION_TYPE_LABELS[conversation.type] ?? conversation.type}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate">{conversationPreview(conversation)}</span>
          </span>
        </button>

        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity",
            editing ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
          )}
        >
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={commit}
                aria-label="Save conversation title"
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setEditing(false);
                  setDraft(derivedTitle ?? conversation.title);
                }}
                aria-label="Cancel rename"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Rename ${derivedTitle ?? conversation.title}`}
                className="rounded p-1 text-muted-foreground/70 hover:text-foreground focus-visible:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={onDelete}
                aria-label={`Delete ${derivedTitle ?? conversation.title}`}
                className="rounded p-1 text-muted-foreground/70 hover:text-danger focus-visible:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function ConversationList({
  conversations,
  isPending,
  isError,
  error,
  onRetry,
  selectedId,
  derivedTitles,
  onSelect,
  onDelete,
  onRename,
}: ConversationListProps & { derivedTitles?: Record<string, string> }) {
  if (isPending) return <ListSkeleton rows={4} />;
  if (isError) return <ErrorState error={error} retry={onRetry} />;

  if (conversations.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        No conversations yet.
      </p>
    );
  }

  const groups = groupConversations(conversations);

  return (
    <nav aria-label="Conversation history" className="-mx-1">
      {groups.map((group) => (
        <section key={group.label} className="mb-3">
          <h3 className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            {group.label}
          </h3>
          <ul className="space-y-0.5">
            {group.items.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === selectedId}
                derivedTitle={derivedTitles?.[conversation.id]}
                onSelect={() => onSelect(conversation.id)}
                onDelete={() => onDelete(conversation.id)}
                onRename={(title) => onRename(conversation.id, title)}
              />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/** New Chat plus the desktop sidebar column. */
export function AiConversationSidebar({
  conversations,
  isPending,
  isError,
  error,
  onRetry,
  selectedId,
  derivedTitles,
  onSelect,
  onDelete,
  onRename,
  onNewChat,
  creating,
}: ConversationListProps & {
  derivedTitles?: Record<string, string>;
  onNewChat: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <Button onClick={onNewChat} disabled={creating} className="w-full justify-start" size="sm">
        <Plus className="mr-1.5 h-4 w-4" aria-hidden />
        {creating ? "Starting…" : "New chat"}
      </Button>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <ConversationList
          conversations={conversations}
          isPending={isPending}
          isError={isError}
          error={error}
          onRetry={onRetry}
          selectedId={selectedId}
          derivedTitles={derivedTitles}
          onSelect={onSelect}
          onDelete={onDelete}
          onRename={onRename}
        />
      </div>
    </div>
  );
}

/**
 * Mobile entry point. Below `lg` the sidebar collapses into a drawer so the
 * chat keeps the full width instead of stacking a list above every message.
 */
export function AiConversationDrawer(props: ConversationListProps & {
  derivedTitles?: Record<string, string>;
  onNewChat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { onSelect, conversations } = props;

  const select = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="lg:hidden"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden />
        History
        {conversations.length > 0 && (
          <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
            {conversations.length}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Conversation history">
          <button
            type="button"
            aria-label="Close conversation history"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full animate-fade-in bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-[85vw] max-w-xs animate-fade-in flex-col border-r border-border bg-background p-4 shadow-pop">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">Conversations</span>
              <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <AiConversationSidebar {...props} onSelect={select} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
