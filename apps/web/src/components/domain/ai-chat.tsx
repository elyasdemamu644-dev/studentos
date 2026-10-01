"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  Check,
  CheckCircle2,
  CircleSlash,
  Clock,
  Copy,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";

import { ErrorState, formatApiError } from "@/components/states";
import { Button, LoadingButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CHAT_SUGGESTIONS,
  composerState,
  MAX_MESSAGE_LENGTH,
  parseInline,
  parseMarkdown,
  shouldSendOnKey,
  type InlineToken,
  type MarkdownBlock,
} from "@/features/ai/chat-utils";
import { formatTime } from "@/lib/format";
import type { AiActionOutcome, AiMessage, AiToolActivity, PendingAction } from "@/types/api-types";

// ── Markdown ─────────────────────────────────
//
// A small renderer for the subset of markdown an assistant actually produces.
// It builds React nodes only — no `dangerouslySetInnerHTML`, so a reply can
// never inject markup into the page.

function InlineTokens({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.kind) {
          case "code":
            return (
              <code
                key={index}
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
              >
                {token.value}
              </code>
            );
          case "strong":
            return (
              <strong key={index} className="font-semibold text-foreground">
                <InlineTokens tokens={token.value} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <InlineTokens tokens={token.value} />
              </em>
            );
          default:
            return <span key={index}>{token.value}</span>;
        }
      })}
    </>
  );
}

function Markdown({ content }: { content: string }) {
  const blocks = parseMarkdown(content);

  return (
    <div className="space-y-2">
      {blocks.map((block: MarkdownBlock, index) => {
        if (block.kind === "code") {
          return (
            <pre
              key={index}
              className="overflow-x-auto rounded-lg border border-border bg-background/70 p-3 text-xs"
            >
              {block.language && (
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {block.language}
                </span>
              )}
              <code className="font-mono leading-relaxed">{block.code}</code>
            </pre>
          );
        }

        if (block.kind === "bullets" || block.kind === "numbers") {
          const Tag = block.kind === "bullets" ? "ul" : "ol";
          return (
            <Tag key={index} className="space-y-1 pl-4">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="leading-relaxed marker:text-muted-foreground">
                  <InlineTokens tokens={parseInline(item)} />
                </li>
              ))}
            </Tag>
          );
        }

        return (
          <p key={index} className="whitespace-pre-wrap break-words leading-relaxed">
            <InlineTokens tokens={parseInline(block.lines.join("\n"))} />
          </p>
        );
      })}
    </div>
  );
}

// ── Message ──────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="h-6 w-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
    >
      {copied ? (
        <Check className="h-3 w-3 text-success" aria-hidden />
      ) : (
        <Copy className="h-3 w-3" aria-hidden />
      )}
    </Button>
  );
}

/**
 * What the assistant actually did while replying.
 *
 * Only real entries from the backend render here — there is no simulated
 * progress. When a future streaming transport exists this is the slot its
 * events belong in.
 */
function ToolActivityFeed({ activity }: { activity: AiToolActivity[] }) {
  if (activity.length === 0) return null;

  const ICONS = { success: CheckCircle2, error: CircleSlash, proposed: Clock } as const;

  return (
    <ul className="mt-1.5 space-y-1 border-l-2 border-border pl-3 text-xs" aria-label="Assistant activity">
      {activity.map((entry, index) => {
        const Icon = ICONS[entry.status] ?? CheckCircle2;
        return (
          <li
            key={`${entry.tool}-${index}`}
            className={cn(
              "flex items-start gap-1.5",
              entry.status === "error" ? "text-danger" : "text-muted-foreground",
            )}
          >
            <Icon
              className={cn("mt-0.5 h-3 w-3 shrink-0", entry.status === "proposed" && "text-warning")}
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

function MessageBubble({
  message,
  onRetry,
}: {
  message: AiMessage;
  onRetry?: (message: AiMessage) => void;
}) {
  const isUser = message.role === "USER";

  return (
    <div className={cn("group flex items-start gap-2", isUser && "flex-row-reverse")}>
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
        )}
        aria-hidden
      >
        {isUser ? <UserRound className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
      </span>

      <div className={cn("min-w-0 max-w-[85%] sm:max-w-[75%]", isUser && "flex flex-col items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm",
            isUser
              ? "rounded-tr-sm bg-primary text-primary-foreground"
              : "rounded-tl-sm border border-border bg-card text-card-foreground shadow-card",
            message.failed && "border border-danger/40 bg-danger/5",
            message.optimistic && "opacity-70",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
          ) : (
            <Markdown content={message.content} />
          )}
        </div>

        <div
          className={cn(
            "mt-1 flex items-center gap-1 px-1 text-[11px]",
            isUser ? "text-primary-foreground/60" : "text-muted-foreground",
          )}
        >
          <span>
            {message.optimistic ? "Sending…" : formatTime(message.createdAt)}
            {message.role === "SYSTEM" && <span className="ml-2 uppercase">system</span>}
          </span>
          {!message.optimistic && !isUser && (
            <CopyButton text={message.content} label="Copy response" />
          )}
          {message.failed && (
            <span className="ml-2 font-medium text-danger">Not delivered</span>
          )}
        </div>

        {message.failed && onRetry && (
          <div className="mt-1.5 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => onRetry(message)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What one confirmed step actually did.
 *
 * Three states, all read from the API: applied and verified, applied but not
 * verified on re-read, or not applied. The middle state is the reason this
 * exists — "the service returned ok" is not the same as "the record is right".
 */
function OutcomeLine({ outcome }: { outcome: AiActionOutcome }) {
  const state = !outcome.ok ? "failed" : outcome.verified ? "verified" : "unverified";
  const Icon = state === "verified" ? CheckCircle2 : CircleSlash;

  return (
    <span
      className={cn(
        "mt-0.5 flex items-start gap-1 text-xs",
        state === "failed" || state === "unverified" ? "text-danger" : "text-muted-foreground",
      )}
    >
      <Icon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>
        {state === "verified" && (outcome.verification ?? "Applied and verified")}
        {state === "unverified" && (outcome.error ?? "Written, but could not be verified")}
        {state === "failed" && (outcome.error ?? "Not applied")}
      </span>
    </span>
  );
}

/**
 * The write gate. Nothing in `actions` has been applied yet: the student either
 * confirms (which executes exactly this proposal) or discards it.
 *
 * Once confirmed, `outcomes` holds the API's real per-step results and each line
 * reports what actually happened — a step that was written but not verified on
 * re-read says so, instead of showing a green tick.
 */
export function PendingActionCard({
  action,
  onConfirm,
  onCancel,
  busy,
  outcomes,
}: {
  action: PendingAction;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  /** Per-step results from the last confirm. Absent until one has happened. */
  outcomes?: AiActionOutcome[];
}) {
  const decided = action.status !== "PENDING";
  const expired = new Date(action.expiresAt).getTime() <= Date.now();
  /** Match outcomes to steps by position; the API runs them in this order. */
  const outcomeFor = (index: number) => outcomes?.[index];

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
                ? (action.result?.summary ?? "Applied")
                : "Discarded"
              : "Nothing has been changed yet."}
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {action.actions.map((step, index) => {
          const outcome = decided ? outcomeFor(index) : undefined;
          return (
            <li key={`${step.tool}-${index}`} className="flex gap-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{index + 1}.</span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground/90">{step.description}</span>
                {outcome && <OutcomeLine outcome={outcome} />}
              </span>
            </li>
          );
        })}
      </ul>

      {!decided && (
        <>
          {expired && (
            <p className="mt-3 rounded-md bg-warning/15 px-3 py-2 text-xs text-warning">
              This proposal expired. Ask the assistant to prepare it again.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onConfirm} disabled={busy || expired}>
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
              Confirm
            </Button>
            <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
              <X className="h-3.5 w-3.5" aria-hidden />
              Not now
            </Button>
            <span className="text-[11px] text-muted-foreground">Expires {formatTime(action.expiresAt)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Generation state ─────────────────────────

/**
 * What the assistant is doing right now.
 *
 * Truthful by construction: it says it is generating, and shows only the tool
 * events the backend actually returned. It never invents progress steps.
 */
export function GeneratingIndicator({ activity }: { activity: AiToolActivity[] }) {
  return (
    <div className="animate-fade-in space-y-1" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 shrink-0 animate-pulse text-primary" aria-hidden />
        <span className="font-medium text-foreground">StudentOS AI is generating</span>
        <span
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary"
          aria-hidden
        />
      </div>
      {activity.length > 0 && (
        <div className="pl-6">
          <ToolActivityFeed activity={activity} />
        </div>
      )}
    </div>
  );
}

/** Non-blocking problem report. The conversation around it stays intact. */
export function MessageError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="animate-fade-in rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm"
    >
      <p className="flex items-start gap-2 font-medium text-danger">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Something went wrong while generating the response.
      </p>
      <p className="mt-1 pl-6 text-xs text-muted-foreground">{formatApiError(error)}</p>
      {onRetry && (
        <div className="mt-2 pl-6">
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Empty state ──────────────────────────────

export function ChatEmptyState({
  onPrompt,
  busy,
}: {
  onPrompt: (prompt: string) => void;
  busy: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold">What can StudentOS help you accomplish?</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Ask about your courses, deadlines or grades. The assistant reads your own StudentOS data, so
        its answers are grounded in what you actually have.
      </p>

      <ul className="mt-6 grid w-full gap-2 sm:grid-cols-2">
        {CHAT_SUGGESTIONS.map((suggestion) => (
          <li key={suggestion.label}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPrompt(suggestion.prompt)}
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-left text-sm shadow-card transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{suggestion.label}</span>
              <Send className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Composer ─────────────────────────────────

/**
 * The message input.
 *
 * Enter sends, Shift+Enter inserts a newline, and the send button turns into a
 * stop button while a generation is in flight.
 */
export function ChatComposer({
  draft,
  onDraftChange,
  onSend,
  onStop,
  busy,
  disabled,
  disabledReason,
  placeholder,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
  disabledReason?: string;
  placeholder: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const state = composerState(draft, { busy, disabled });

  // Grow with the content, then shrink back. Capped so the composer can never
  // eat the transcript on a phone.
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, [draft]);

  return (
    <div className="border-t border-border bg-card/60 px-3 py-3 sm:px-4">
      {disabled && disabledReason && (
        <p className="mb-2 px-1 text-xs text-muted-foreground">{disabledReason}</p>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (shouldSendOnKey(event.key, event.shiftKey)) {
              event.preventDefault();
              if (state.canSend) onSend();
            }
          }}
          placeholder={placeholder}
          aria-label="Message StudentOS AI"
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH + 500}
          disabled={disabled}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none py-2 leading-relaxed"
        />

        {busy ? (
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={onStop}
            aria-label="Stop generating"
          >
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
          </Button>
        ) : (
          <LoadingButton
            size="icon"
            className="shrink-0"
            loading={false}
            disabled={!state.canSend}
            onClick={onSend}
            aria-label="Send message"
          >
            <Send className="h-4 w-4" aria-hidden />
          </LoadingButton>
        )}
      </div>

      <p className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
        <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
        <span className="sm:hidden">Enter sends</span>
        <span className={cn("tabular-nums", state.overLimit && "font-medium text-danger")}>
          {draft.length > MAX_MESSAGE_LENGTH - 200 ? `${state.remaining}` : ""}
        </span>
      </p>
    </div>
  );
}

// ── Transcript ───────────────────────────────

export interface MessageListProps {
  messages: AiMessage[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetryLoad: () => void;
  generating: boolean;
  /** Real tool events for the run in flight, if any have been reported. */
  liveActivity: AiToolActivity[];
  /**
   * Tool events for the most recent completed run. They are returned with the
   * reply but never persisted, so they belong to that one message and are
   * dropped when the conversation is switched.
   */
  activityRun: ActivityRun | null;
  onRetryMessage: (message: AiMessage) => void;
  children?: ReactNode;
}

export interface ActivityRun {
  replyId: string;
  activity: AiToolActivity[];
}

function Transcript({
  messages,
  isLoading,
  isError,
  error,
  onRetryLoad,
  generating,
  liveActivity,
  activityRun,
  onRetryMessage,
  children,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // Only auto-scroll while the student is already at the bottom, so reading
  // back through a reply is not interrupted by an incoming message.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      setPinned(distance < 80);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!pinned) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, generating, pinned]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full space-y-4 overflow-y-auto px-3 py-4 sm:px-5" data-testid="transcript">
        {isLoading ? (
          <div className="space-y-4" aria-hidden>
            <div className="flex justify-end">
              <div className="h-12 w-52 animate-pulse rounded-2xl bg-muted" />
            </div>
            <div className="flex justify-start">
              <div className="h-20 w-72 animate-pulse rounded-2xl bg-muted" />
            </div>
          </div>
        ) : isError ? (
          <ErrorState error={error} retry={onRetryLoad} />
        ) : (
          messages.map((message) => (
            <div key={message.id} className="space-y-1">
              <MessageBubble message={message} onRetry={onRetryMessage} />
              {activityRun?.replyId === message.id && (
                <div className="pl-9">
                  <ToolActivityFeed activity={activityRun.activity} />
                </div>
              )}
            </div>
          ))
        )}

        {children}

        {generating && <GeneratingIndicator activity={liveActivity} />}
        <div ref={bottomRef} />
      </div>

      {!pinned && !isLoading && messages.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setPinned(true);
            bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-pop"
        >
          <ArrowDown className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Scroll to latest
        </Button>
      )}
    </div>
  );
}

export { MessageBubble };

/** Message list with the empty state wired in for a fresh conversation. */
export function MessageList({
  messages,
  empty,
  ...props
}: MessageListProps & { empty: ReactNode }) {
  if (!props.isLoading && !props.isError && messages.length === 0) {
    return <div className="flex min-h-0 flex-1 flex-col">{empty}</div>;
  }
  return <Transcript messages={messages} {...props} />;
}
