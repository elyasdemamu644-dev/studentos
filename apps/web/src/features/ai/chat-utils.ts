// ─────────────────────────────────────────────
// Chat utilities
// ─────────────────────────────────────────────
//
// Pure helpers behind the AI Assistant chat: conversation titles, the
// date grouping in the history sidebar, the lightweight markdown renderer, and
// the empty-state prompts.
//
// Nothing here talks to the API, so all of it is directly unit-testable and
// none of it needs a provider.

import type { Conversation } from "@/types/api-types";

/** Hard cap on a generated title. The API allows 200; titles read better short. */
export const MAX_TITLE_LENGTH = 60;

/** Titles the API seeds for an untouched conversation. */
const GENERIC_TITLES = new Set(["chat", "new conversation", "new chat", "untitled"]);

export function isGenericTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  return GENERIC_TITLES.has(title.trim().toLowerCase());
}

/**
 * Cut a string at a word boundary and append an ellipsis.
 *
 * Used for both titles and previews, where a hard mid-word slice reads as a
 * rendering bug.
 */
export function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const clipped = collapsed.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.replace(/[\s,;:.!?-]+$/, "")}…`;
}

// ── Title generation ──────────────────────────
//
// Derived on the client from the first meaningful user message: cheap,
// instant, offline, and deterministic enough to be predictable. No model call.

const FILLER_PREFIXES = [
  "hey, can you please",
  "hi, can you please",
  "hey can you",
  "hi can you",
  "can you please",
  "please can you",
  "could you please",
  "can you",
  "could you",
  "i want to know about",
  "i want to know",
  "i would like to",
  "i need to",
  "i want to",
  "help me to",
  "help me with",
  "help me on",
  "help me",
  "i'm trying to",
  "im trying to",
  "please",
];

/** Trailing "for me"-style filler that carries no topic information. */
const FILLER_SUFFIXES = ["for me", "please", "thanks", "thank you"];

/**
 * "Prepare me for my database exam" reads better as a topic than as an
 * instruction, and exam prep is the single most common thing a student asks
 * for — so it gets a real transformation instead of a truncation.
 */
const PREPARE_FOR_ASSESSMENT =
  /^prepare\s+(?:me\s+)?(?:ready\s+)?for\s+(?:my\s+|our\s+|the\s+)?(.+?(?:exam|test|quiz|midterm|final))\b/i;

const LEADING_PUNCTUATION = /^[\s"'“”‘’(\[{<>*#\-.•:;,]+/;
const TRAILING_PUNCTUATION = /[\s"'“”‘’)\]}>*.,;:!?—–-]+$/;

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Drop leading and trailing filler while preserving the original casing of
 * whatever survives — "B-trees" and "GPA" must not come back as "b-trees".
 *
 * Matches run against the lowercased text but always slice the original, so
 * lengths stay aligned.
 */
function stripFiller(text: string): string {
  let value = text.replace(TRAILING_PUNCTUATION, "");

  for (let pass = 0; pass < 3; pass += 1) {
    const lower = value.toLowerCase();
    const prefix = FILLER_PREFIXES.find((candidate) => lower.startsWith(candidate));
    if (!prefix) break;
    value = value.slice(prefix.length).replace(LEADING_PUNCTUATION, "").replace(TRAILING_PUNCTUATION, "");
  }

  // Polished off first so "for me?" still matches the bare " for me".
  const lower = value.toLowerCase();
  const suffix = FILLER_SUFFIXES.find((candidate) => lower.endsWith(` ${candidate}`));
  if (suffix) value = value.slice(0, -suffix.length);

  return value.replace(TRAILING_PUNCTUATION, "").trim();
}

/** Split on sentence/clause boundaries, keeping only the first clause. */
function firstClause(value: string): string {
  const clause = value.split(/\s*(?:[.!?;]|\b(?:and then|also)\b)\s*/)[0] ?? value;
  return clause.trim();
}

/**
 * A readable title from the first thing the student actually asked.
 *
 *   "Prepare me for my database exam."            -> "Database exam preparation"
 *   "How am I doing academically?"               -> "How am I doing academically"
 *   "Hi, can you please explain B-trees for me?" -> "Explain B-trees"
 *
 * Capitalizes the first letter and never returns an empty string — callers
 * fall back to a constant when there is nothing usable.
 */
export function generateConversationTitle(message: string): string {
  const raw = collapse(message);
  if (!raw) return "";

  const assessment = raw.match(PREPARE_FOR_ASSESSMENT);
  if (assessment?.[1]) {
    const topic = collapse(assessment[1]).replace(TRAILING_PUNCTUATION, "");
    if (topic) return truncate(`${capitalize(topic)} preparation`, MAX_TITLE_LENGTH);
  }

  const value = firstClause(stripFiller(raw));
  if (!value) return "";

  return truncate(capitalize(value), MAX_TITLE_LENGTH);
}

/**
 * The title a conversation should display.
 *
 * `derived` wins when supplied so the sidebar can show a useful title the
 * instant the first message is sent, before the rename has round-tripped.
 */
export function resolveConversationTitle(
  conversation: Pick<Conversation, "title"> | undefined,
  derived?: string,
): string {
  if (derived && derived.trim()) return derived;
  if (conversation && !isGenericTitle(conversation.title)) return conversation.title;
  return "New conversation";
}

/** Whether the conversation still needs a generated title persisted. */
export function needsAutoTitle(conversation: Pick<Conversation, "title"> | undefined): boolean {
  return conversation == null || isGenericTitle(conversation.title);
}

// ── Sidebar date grouping ─────────────────────

export type ConversationGroupLabel = "Today" | "Yesterday" | "Previous 7 days" | "Older";

export const CONVERSATION_GROUP_ORDER: ConversationGroupLabel[] = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Older",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(reference: Date): number {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
}

/**
 * Which bucket a timestamp belongs to, relative to `now`.
 *
 * Boundaries are computed in local time so "Today" matches what the student's
 * calendar says, not UTC.
 */
export function conversationGroupLabel(value: string | Date, now: Date = new Date()): ConversationGroupLabel {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Older";

  const startToday = startOfLocalDay(now);
  const startOfDate = startOfLocalDay(date);
  const daysAgo = Math.round((startToday - startOfDate) / DAY_MS);

  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo <= 7) return "Previous 7 days";
  return "Older";
}

export interface ConversationGroup {
  label: ConversationGroupLabel;
  items: Conversation[];
}

/**
 * Group conversations for the sidebar. Groups are emitted in
 * `CONVERSATION_GROUP_ORDER`, empty ones are dropped, and the order inside a
 * group is whatever the caller passed in (the API already sorts by recency).
 */
export function groupConversations(
  conversations: Conversation[],
  now: Date = new Date(),
): ConversationGroup[] {
  const buckets = new Map<ConversationGroupLabel, Conversation[]>();
  for (const conversation of conversations) {
    const label = conversationGroupLabel(conversation.updatedAt, now);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(conversation);
    else buckets.set(label, [conversation]);
  }

  return CONVERSATION_GROUP_ORDER.filter((label) => (buckets.get(label)?.length ?? 0) > 0).map(
    (label) => ({ label, items: buckets.get(label) as Conversation[] }),
  );
}

/** One-line preview of the newest message, with markdown noise removed. */
export function conversationPreview(conversation: Pick<Conversation, "preview">): string {
  const preview = conversation.preview;
  if (!preview?.content) return "No messages yet";
  return truncate(stripMarkdown(preview.content), 80);
}

// ── Minimal markdown ──────────────────────────
//
// Assistant replies routinely contain bold, bullets and fenced code. Rather
// than add a markdown dependency, render the subset that actually shows up.
// Everything is produced as React nodes — no HTML string is ever injected.

export type MarkdownBlock =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbers"; items: string[] }
  | { kind: "code"; language: string | null; code: string };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```(.*)$/;

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6})\s+/gm, "")
    .replace(/^\s*([-*•]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split raw markdown into renderable blocks. Fenced code wins over everything. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];

  let paragraph: string[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", lines: paragraph });
      paragraph = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length > 0) {
      blocks.push({ kind: "bullets", items: bullets });
      bullets = [];
    }
  };
  const flushNumbers = () => {
    if (numbers.length > 0) {
      blocks.push({ kind: "numbers", items: numbers });
      numbers = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushBullets();
    flushNumbers();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fence = line.match(FENCE);
    if (fence) {
      flushAll();
      const language = fence[1].trim() || null;
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: "code", language, code: code.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    if (HEADING.test(line)) {
      flushAll();
      const heading = line.match(HEADING);
      paragraph.push((heading?.[2] ?? line).trim());
      flushParagraph();
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      flushParagraph();
      flushNumbers();
      bullets.push(bullet[1]);
      continue;
    }

    const numbered = line.match(NUMBER);
    if (numbered) {
      flushParagraph();
      flushBullets();
      numbers.push(numbered[2]);
      continue;
    }

    flushBullets();
    flushNumbers();
    paragraph.push(line);
  }

  flushAll();
  return blocks;
}

export type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "strong"; value: InlineToken[] }
  | { kind: "em"; value: InlineToken[] };

const INLINE_PATTERN = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/;

/** Tokenize one line: code, bold, italic, plain text. Nesting is one level deep. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;

  while (rest.length > 0) {
    const match = rest.match(INLINE_PATTERN);
    if (!match || match.index === undefined) {
      tokens.push({ kind: "text", value: rest });
      break;
    }
    if (match.index > 0) tokens.push({ kind: "text", value: rest.slice(0, match.index) });

    const token = match[0];
    if (token.startsWith("`")) {
      tokens.push({ kind: "code", value: token.slice(1, -1) });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      tokens.push({ kind: "strong", value: parseInline(token.slice(2, -2)) });
    } else {
      tokens.push({ kind: "em", value: parseInline(token.slice(1, -1)) });
    }
    rest = rest.slice(match.index + token.length);
  }

  return tokens;
}

// ── Empty-state prompts ───────────────────────
//
// Real prompts sent through the normal send path — not decorative buttons.

export interface ChatSuggestion {
  label: string;
  prompt: string;
}

export const CHAT_SUGGESTIONS: ChatSuggestion[] = [
  { label: "Prepare for an exam", prompt: "Prepare me for my next exam." },
  { label: "Analyze my academic progress", prompt: "How am I doing academically?" },
  { label: "Plan my week", prompt: "What should I study today?" },
  { label: "Help me reach a goal", prompt: "Help me reach my most important goal." },
  { label: "Teach me a topic", prompt: "Teach me a topic from my coursework." },
  { label: "Research something", prompt: "Help me research a topic for an assignment." },
];

// ── Composer ─────────────────────────────────

/** Mirrors the API's `createMessageSchema` bound so the UI can refuse early. */
export const MAX_MESSAGE_LENGTH = 20000;

export interface ComposerState {
  canSend: boolean;
  /** Over the character limit: send is blocked and the counter is flagged. */
  overLimit: boolean;
  remaining: number;
}

export function composerState(draft: string, options: { busy: boolean; disabled?: boolean }): ComposerState {
  const length = draft.length;
  return {
    canSend: draft.trim().length > 0 && length <= MAX_MESSAGE_LENGTH && !options.busy && !options.disabled,
    overLimit: length > MAX_MESSAGE_LENGTH,
    remaining: MAX_MESSAGE_LENGTH - length,
  };
}

/**
 * Enter sends, Shift+Enter inserts a newline.
 *
 * Returns true when the key was consumed, so the caller knows whether to
 * `preventDefault()`.
 */
export function shouldSendOnKey(key: string, shiftKey: boolean): boolean {
  return key === "Enter" && !shiftKey;
}
