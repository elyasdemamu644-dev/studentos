import { randomUUID } from "node:crypto";
import type { ProposedAction } from "./tools/types";

// ─────────────────────────────────────────────────────────────────────────────
// Pending action confirmations
// ─────────────────────────────────────────────────────────────────────────────
//
// A WRITE tool never runs on the turn that requests it. The agent records the
// exact `(tool, arguments)` pairs the student was shown and parks them here as
// a *proposal*. Nothing is created or changed until the student confirms, either
// by pressing Confirm in the UI (REST) or by saying "create it" in the chat —
// both funnel into `consumeProposal`, which is the only thing that hands a
// proposal's arguments to the tool layer.
//
// Deliberately in-process and in-memory: the confirmation is a short-lived
// handshake inside one conversation, and persisting it would mean a schema
// migration on a database whose migration history is baselined (see gap #15).
// See "Known limitations" in AI_CONTEXT.md.

export type ConfirmationStatus = "PENDING" | "EXECUTED" | "CANCELLED" | "SUPERSEDED";

export interface PendingAction {
  id: string;
  userId: string;
  conversationId: string;
  /** One-line headline for the confirmation card, e.g. "Database exam study plan". */
  title: string;
  /** The exact mutations awaiting approval. */
  actions: ProposedAction[];
  status: ConfirmationStatus;
  createdAt: string;
  expiresAt: string;
  /** Present once the actions have run. */
  result?: { executed: number; verified: number; failed: number; summary: string } | null;
}

export interface ConfirmationActionOutcome {
  tool: string;
  description: string;
  /** True when the write itself ran. A write can succeed and still fail verification. */
  ok: boolean;
  error?: string;
  /** The created record's id, when the tool produced one. */
  recordId?: string | null;
  /**
   * Whether the record was re-read through its own domain service afterwards and
   * held the values the student approved. `ok && verified` is the only state the
   * assistant may call a success.
   */
  verified: boolean;
  /** One truthful sentence about the record's state after the write. */
  verification?: string;
}

/** Proposals expire after this long; a stale "Create it." should not fire. */
const TTL_MS = 30 * 60 * 1000;

/** Conversation -> id -> proposal. Keyed by user *and* conversation so one
 *  student can never read or confirm another student's proposal. */
const store = new Map<string, Map<string, PendingAction>>();

function key(userId: string, conversationId: string): string {
  return `${userId}::${conversationId}`;
}

function bucket(userId: string, conversationId: string): Map<string, PendingAction> {
  const k = key(userId, conversationId);
  let entry = store.get(k);
  if (!entry) {
    entry = new Map();
    store.set(k, entry);
  }
  return entry;
}

/** Drop anything past its TTL. Called on every read/write so the map cannot grow. */
function sweep(userId: string, conversationId: string): void {
  const now = Date.now();
  for (const [id, action] of bucket(userId, conversationId)) {
    if (new Date(action.expiresAt).getTime() < now) bucket(userId, conversationId).delete(id);
  }
}

export const confirmationStore = {
  /**
   * Record a new proposal. Any earlier still-pending proposal for the same
   * conversation is marked SUPERSEDED — the student is only ever shown one
   * "would you like me to do this?" at a time.
   */
  create(input: {
    userId: string;
    conversationId: string;
    title: string;
    actions: ProposedAction[];
  }): PendingAction {
    sweep(input.userId, input.conversationId);
    for (const action of bucket(input.userId, input.conversationId).values()) {
      if (action.status === "PENDING") action.status = "SUPERSEDED";
    }

    const now = new Date();
    const action: PendingAction = {
      id: randomUUID(),
      userId: input.userId,
      conversationId: input.conversationId,
      title: input.title,
      actions: input.actions,
      status: "PENDING",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
      result: null,
    };
    bucket(input.userId, input.conversationId).set(action.id, action);
    return action;
  },

  /** The conversation's current pending proposal, if any. */
  getPending(userId: string, conversationId: string): PendingAction | null {
    sweep(userId, conversationId);
    const pending = [...bucket(userId, conversationId).values()]
      .filter((a) => a.status === "PENDING")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return pending[0] ?? null;
  },

  get(userId: string, conversationId: string, id: string): PendingAction | null {
    sweep(userId, conversationId);
    return bucket(userId, conversationId).get(id) ?? null;
  },

  /**
   * Mark a proposal as no longer actionable. Idempotent for non-pending states
   * so a double-click on "Cancel" cannot resurrect a cancelled proposal.
   */
  cancel(userId: string, conversationId: string, id: string): PendingAction | null {
    const action = confirmationStore.get(userId, conversationId, id);
    if (!action) return null;
    if (action.status === "PENDING") action.status = "CANCELLED";
    return action;
  },

  /**
   * Atomically take a pending proposal, so two concurrent confirms cannot both
   * execute the same mutations. Returns `null` when it was already consumed.
   */
  consume(userId: string, conversationId: string, id: string): PendingAction | null {
    const action = confirmationStore.get(userId, conversationId, id);
    if (!action || action.status !== "PENDING") return null;
    action.status = "EXECUTED";
    return action;
  },

  /** Record the outcome of an executed proposal. */
  complete(id: string, result: NonNullable<PendingAction["result"]>): void {
    for (const entry of store.values()) {
      const action = entry.get(id);
      if (action) {
        action.result = result;
        return;
      }
    }
  },

  /** Test/ops helper — drops everything. */
  reset(): void {
    store.clear();
  },
};

/**
 * One honest sentence about a batch.
 *
 * Shared by the REST confirm route and the `confirm_pending_actions` tool so the
 * two paths cannot describe the same outcome differently. A single action
 * reports its own verification ("Verified: title=…, status=…") rather than a
 * generic "done", and a partial batch names what failed instead of rounding up.
 */
export function summarizeOutcomes(outcomes: ConfirmationActionOutcome[]): string {
  if (outcomes.length === 0) return "Nothing to apply";

  const applied = outcomes.filter((o) => o.ok).length;
  const verified = outcomes.filter((o) => o.ok && o.verified).length;
  const unverified = applied - verified;
  const failed = outcomes.length - applied;

  if (outcomes.length === 1) {
    const only = outcomes[0];
    if (only && only.ok) return only.verification ?? only.description;
    return only?.error ?? "Action failed";
  }

  return [
    `${verified} of ${outcomes.length} action(s) applied and verified`,
    failed > 0 ? `${failed} failed` : null,
    unverified > 0 ? `${unverified} applied but unverified` : null,
  ]
    .filter((part): part is string => part !== null)
    .join("; ");
}

/** The wire shape handed to the web app. Never includes userId. */
export function toPendingActionResponse(action: PendingAction | null) {
  if (!action) return null;
  return {
    id: action.id,
    title: action.title,
    status: action.status,
    actions: action.actions.map((a) => ({ tool: a.tool, description: a.description })),
    createdAt: action.createdAt,
    /** When it stops being confirmable — the UI uses this to grey the card out. */
    expiresAt: action.expiresAt,
    result: action.result ?? null,
  };
}
