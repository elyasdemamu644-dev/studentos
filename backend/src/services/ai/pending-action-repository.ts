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
