import type { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// AI tool contract
// ─────────────────────────────────────────────────────────────────────────────
//
// A tool is the ONLY way the model can reach StudentOS data or change it.
//
// Three rules hold for every definition in this layer:
//
//  1. The authenticated `userId` arrives through `AiToolContext`, taken from the
//     server-side request context. It is never part of the tool arguments, so a
//     model that invents `"userId": "<someone else>"` is stripped by the Zod
//     parse before the handler ever sees the payload.
//  2. Handlers call the existing module services (`tasksService`,
//     `goalsService`, …), so all ownership checks, validation and business rules
//     stay in one place. No tool imports Prisma.
//  3. Every tool is classified as READ, ANALYZE or WRITE. Only WRITE tools can
//     change data, and they cannot run until the student has confirmed.

/** What a tool is allowed to do. */
export type AiToolKind = "READ" | "ANALYZE" | "WRITE";

/**
 * How a WRITE tool satisfies the confirmation requirement.
 *
 *  - `"required"` (default): the tool may only run when the exact call was
 *    already approved by the student. Anything else is refused.
 *  - `"self"`: the tool *is* the confirmation — running it is the student's
 *    explicit approval. Reserved for `confirm_pending_actions`.
 */
export type AiToolConfirmation = "required" | "self";

/**
 * A single mutation the student can approve.
 *
 * ANALYZE tools may return these as `proposedActions` without executing them
 * (that is how `build_study_plan` proposes a schedule). The agent records them
 * as a pending proposal; nothing is created until confirmation.
 */
export interface ProposedAction {
  /** Target tool name, e.g. `create_study_session`. */
  tool: string;
  /** Human-readable line shown in the confirmation card. */
  description: string;
  /** Validated arguments, passed verbatim to `tool` on execution. */
  arguments: Record<string, unknown>;
}

export interface AiToolError {
  /** Stable, model-readable code (`invalid_arguments`, `not_found`, …). */
  code: string;
  /** Safe message. Never contains stack traces, SQL or credentials. */
  message: string;
  details?: unknown;
}

export interface AiToolResult {
  ok: boolean;
  /** Tool payload handed back to the model. */
  data?: unknown;
  error?: AiToolError;
  /** Mutations that would need confirmation before running. */
  proposedActions?: ProposedAction[];
  /** One-line, user-facing description of what happened. */
  summary?: string;
}

/**
 * Execution context handed to every tool.
 *
 * `approvedActions` is the safety gate. It is `null` on every ordinary turn, so
 * no WRITE tool can run. It is only non-null inside a turn where the student
 * has already confirmed that exact set of actions.
 */
export interface AiToolContext {
  /** Authenticated user id, sourced from the HTTP request — never from the model. */
  userId: string;
  conversationId: string;
  /** Exact calls the student approved for this turn, or `null` when none. */
  approvedActions: ProposedAction[] | null;
}

export interface AiToolDefinition {
  /** Stable snake_case identifier. Renaming breaks cached prompts, so don't. */
  name: string;
  /** Sent to the model verbatim. Keep it short and say when to use the tool. */
  description: string;
  kind: AiToolKind;
  /** Zod schema for the arguments. Parsed by the registry before `execute`. */
  parameters: z.ZodTypeAny;
  /** Present-tense label for the UI activity feed, e.g. "Checking your exams". */
  activityLabel: string;
  confirmation?: AiToolConfirmation;
  /**
   * Turns natural references into real ids *before* the student is asked to
   * approve anything.
   *
   * The registry calls this when a WRITE tool would be parked as a proposal, and
   * stores the returned arguments instead of the raw ones. Two things follow, and
   * both matter: the confirmation card shows the exact record ("DB301", not
   * "that course"), and an ambiguous or missing reference is reported now rather
   * than after the student has already clicked Confirm.
   *
   * Throw `EntityResolutionError` to abort the proposal with an honest
   * not-found or ambiguous result. READ tools normally do not need this.
   */
  prepare?(args: Record<string, unknown>, ctx: AiToolContext): Promise<Record<string, unknown>>;
  execute(args: Record<string, unknown>, ctx: AiToolContext): Promise<AiToolResult>;
}

/** OpenAI-compatible function-calling schema handed to the provider. */
export interface ProviderToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchemaObject;
  };
}

export interface JsonSchemaObject {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  items?: JsonSchemaObject;
  enum?: unknown[];
  anyOf?: JsonSchemaObject[];
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small shared helpers
// ─────────────────────────────────────────────────────────────────────────────

export const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO timestamp `days` from now (negative for the past). */
export function isoDaysFromNow(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() + days * DAY_MS).toISOString();
}

/** Whole days from now until `iso`. Negative when the date is in the past. */
export function daysUntil(iso: string | null | undefined, from: Date = new Date()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - from.getTime();
  if (Number.isNaN(ms)) return null;
  return Math.ceil(ms / DAY_MS);
}

/** Start of the local day `offset` days from today (midnight). */
export function startOfDayOffset(offset: number, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

/** `HH:MM` for an ISO timestamp in the server's local zone. */
export function clockTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** Percentage of `part` out of `total`, or null when `total` is 0. */
export function pct(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 100);
}

/**
 * Convert an ISO string to a `Date` for services whose schema is
 * `z.coerce.date()` (study sessions, goals). `null` and `undefined` pass through
 * so "clear this field" stays distinguishable from "leave it alone".
 */
export function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Normalise a model-supplied date to the `z.string().datetime()` form the task
 * and note schemas require. A bare `YYYY-MM-DD` becomes 09:00 local time, which
 * is the convention used across the rest of the app.
 */
export function toIsoTimestamp(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T09:00:00` : value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function ok(data: unknown, summary?: string): AiToolResult {
  return summary ? { ok: true, data, summary } : { ok: true, data };
}

export function fail(code: string, message: string, details?: unknown): AiToolResult {
  return { ok: false, error: details === undefined ? { code, message } : { code, message, details } };
}
