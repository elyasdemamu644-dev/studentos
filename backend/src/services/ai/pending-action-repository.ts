import { prisma } from "@/utils/prisma";
import type { Prisma } from "@prisma/client";
import type { ConfirmationStatus, PendingAction } from "./confirmations";
import type { ProposedAction } from "./tools/types";

// ─────────────────────────────────────────────────────────────────────────────
// Durable pending actions
// ─────────────────────────────────────────────────────────────────────────────
//
// The confirmation handshake used to live only in memory, which meant a server
// restart (or a second instance) forgot what the student was being asked to
// approve — the card vanished and the actions were unreachable. These helpers
// mirror the in-memory `confirmationStore` into `ai_pending_actions` and load it
// back.
//
// Every write here is best-effort against a row that may not exist: the REST and
// unit paths can park a proposal straight in the in-memory store (the tests do),
// and a confirm of such a proposal must still work. Status writes therefore use
// `updateMany` and treat "0 rows" as success, while `create` is only ever called
// for proposals the service itself parked.

/** Persist a freshly parked proposal so it survives a restart. */
export async function persistPendingAction(action: PendingAction): Promise<void> {
  await prisma.aiPendingAction.create({
    data: {
      id: action.id,
      userId: action.userId,
      conversationId: action.conversationId,
      title: action.title,
      actions: action.actions as unknown as Prisma.InputJsonValue,
      status: action.status,
      expiresAt: new Date(action.expiresAt),
      createdAt: new Date(action.createdAt),
    },
  });
}

/** Mark every other pending proposal in this conversation SUPERSEDED. */
export async function supersedePersisted(
  userId: string,
  conversationId: string,
  exceptId: string,
): Promise<void> {
  await prisma.aiPendingAction.updateMany({
    where: {
      userId,
      conversationId,
      status: "PENDING",
      id: { not: exceptId },
    },
    data: { status: "SUPERSEDED", decidedAt: new Date() },
  });
}

/** Move a persisted proposal to a decided state. A missing row is not an error. */
export async function updatePersistedStatus(
  id: string,
  status: ConfirmationStatus,
  result?: NonNullable<PendingAction["result"]>,
): Promise<void> {
  await prisma.aiPendingAction.updateMany({
    where: { id },
    data: {
      status,
      decidedAt: new Date(),
      ...(result ? { result: result as unknown as Prisma.InputJsonValue } : {}),
    },
  });
}

/** The newest still-confirmable proposal for a conversation, or null. */
export async function loadPendingAction(
  userId: string,
  conversationId: string,
): Promise<PendingAction | null> {
  const row = await prisma.aiPendingAction.findFirst({
    where: {
      userId,
      conversationId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;

  return toPendingAction(row);
}

/** Load one proposal by id, owner-scoped. Any status, any expiry. */
export async function loadPendingActionById(
  userId: string,
  id: string,
): Promise<PendingAction | null> {
  const row = await prisma.aiPendingAction.findFirst({ where: { id, userId } });
  if (!row) return null;
  return toPendingAction(row);
}

/**
 * Atomically claim a pending proposal for execution.
 *
 * This is the *only* gate that releases a proposal's arguments. The conditional
 * `updateMany` is a single SQL statement, so two concurrent confirms — in the
 * same process or in two Render instances — cannot both observe `count === 1`;
 * exactly one wins and the loser gets `null` and must answer 409. Ownership,
 * status, and expiry are all part of the predicate, so a caller can never claim
 * someone else's, an already-decided, or an expired row. A stale in-memory cache
 * entry is irrelevant here: this reads and writes Postgres, the source of truth.
 *
 * Returns the claimed proposal (now `EXECUTED` in the database) or `null`.
 */
export async function claimPendingAction(
  userId: string,
  conversationId: string,
  id: string,
): Promise<PendingAction | null> {
  const now = new Date();
  const { count } = await prisma.aiPendingAction.updateMany({
    where: {
      id,
      userId,
      conversationId,
      status: "PENDING",
      expiresAt: { gt: now },
    },
    data: { status: "EXECUTED", decidedAt: now },
  });
  if (count !== 1) return null;
  return loadPendingActionById(userId, id);
}

/**
 * Atomically cancel a proposal. Owner-scoped and only ever moves a PENDING row;
 * a cancelled/executed/expired proposal is left untouched and reported via the
 * returned row so the caller can render its real state.
 */
export async function cancelPersistedPending(
  userId: string,
  conversationId: string,
  id: string,
): Promise<PendingAction | null> {
  await prisma.aiPendingAction.updateMany({
    where: { id, userId, conversationId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
  return loadPendingActionById(userId, id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Retention
// ─────────────────────────────────────────────────────────────────────────────
//
// Two independent, documented eligibility rules, each expressed as a database
// predicate so the check and the delete cannot race:
//
//  1. Decided proposals (EXECUTED / CANCELLED / SUPERSEDED) older than the
//     retention window. Their `decidedAt` is when the decision happened.
//  2. Expired proposals still PENDING, older than a short grace. These were
//     never decided; the grace leaves a window in which the student can still
//     see why their card disappeared before the row vanishes.
//
// `deleteMany` is idempotent — a second run matches nothing — and bounded via
// `take`-style batching done in the caller, because Prisma's `deleteMany` has no
// LIMIT. Only `ai_pending_actions` rows are touched; no academic record is ever
// affected.

export interface RetentionWindow {
  /** Decided rows older than this many days are removed. */
  retentionDays: number;
  /** Expired still-PENDING rows older than this many hours are removed. */
  expiredGraceHours: number;
}

/** Deleted-row counts, for structured logging. */
export interface RetentionResult {
  decidedDeleted: number;
  expiredDeleted: number;
}

/**
 * Remove up to `batchSize` eligible rows of one kind. Returns how many went.
 * Exposed separately so the caller can loop until a batch comes back short,
 * keeping each statement's lock footprint bounded on a large table.
 */
export async function deleteDecidedOlderThan(
  olderThan: Date,
  batchSize: number,
): Promise<number> {
  const rows = await prisma.aiPendingAction.findMany({
    where: { status: { in: ["EXECUTED", "CANCELLED", "SUPERSEDED"] }, decidedAt: { lt: olderThan } },
    select: { id: true },
    take: batchSize,
    orderBy: { decidedAt: "asc" },
  });
  if (rows.length === 0) return 0;
  const { count } = await prisma.aiPendingAction.deleteMany({
    where: {
      id: { in: rows.map((r) => r.id) },
      // Re-assert the predicate inside the delete: a row that was touched
      // between the SELECT and the DELETE (state change, new decision) is not
      // removed. This is what makes concurrent cleanup safe.
      status: { in: ["EXECUTED", "CANCELLED", "SUPERSEDED"] },
      decidedAt: { lt: olderThan },
    },
  });
  return count;
}

export async function deleteExpiredPendingOlderThan(
  olderThan: Date,
  batchSize: number,
): Promise<number> {
  const rows = await prisma.aiPendingAction.findMany({
    where: { status: "PENDING", expiresAt: { lt: olderThan } },
    select: { id: true },
    take: batchSize,
    orderBy: { expiresAt: "asc" },
  });
  if (rows.length === 0) return 0;
  const { count } = await prisma.aiPendingAction.deleteMany({
    where: {
      id: { in: rows.map((r) => r.id) },
      status: "PENDING",
      expiresAt: { lt: olderThan },
    },
  });
  return count;
}

/** Map a Prisma row into the in-process `PendingAction` shape. */
function toPendingAction(row: {
  id: string;
  userId: string;
  conversationId: string;
  title: string;
  actions: Prisma.JsonValue;
  status: string;
  result: Prisma.JsonValue;
  createdAt: Date;
  expiresAt: Date;
}): PendingAction {
  return {
    id: row.id,
    userId: row.userId,
    conversationId: row.conversationId,
    title: row.title,
    actions: (row.actions as unknown as ProposedAction[]) ?? [],
    status: row.status as ConfirmationStatus,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    result: (row.result as unknown as PendingAction["result"]) ?? null,
  };
}
