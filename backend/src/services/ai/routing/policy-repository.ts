import { prisma } from "@/utils/prisma";
import type { AiRoutingPolicy } from "@prisma/client";
import type { UpdateRoutingPolicyInput, ModelPreferenceInput } from "@/schemas/ai-routing";

// ─────────────────────────────────────────────────────────────────────────────
// Routing policy repository
// ─────────────────────────────────────────────────────────────────────────────
//
// Persistence for the unified routing policy: one row per user, plus the
// ordered model preferences (global and per-conversation). All reads are
// owner-scoped; a foreign id is never resolved.

/** A default policy for a user who has never saved one. Never persisted here. */
export function defaultPolicy(userId: string): AiRoutingPolicy {
  return {
    id: "",
    userId,
    strategy: "AUTO",
    fixedConnectionId: null,
    fixedModel: null,
    freeOnly: false,
    spendCeilingCents: null,
    spendWindowDays: 30,
    allowAutoFallback: true,
    externalProcessingDisabled: false,
    preset: null,
    fallbackOrder: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/** Read the user's policy, materialising a transient default when none exists. */
export async function getPolicy(userId: string): Promise<AiRoutingPolicy> {
  const row = await prisma.aiRoutingPolicy.findUnique({ where: { userId } });
  return row ?? defaultPolicy(userId);
}

/**
 * Upsert a partial policy update. Only provided fields are written; the rest are
 * left at their stored (or default) values.
 */
export async function upsertPolicy(
  userId: string,
  input: UpdateRoutingPolicyInput,
): Promise<AiRoutingPolicy> {
  const data: Record<string, unknown> = {};
  if (input.strategy !== undefined) data.strategy = input.strategy;
  if (input.fixedConnectionId !== undefined) data.fixedConnectionId = input.fixedConnectionId;
  if (input.fixedModel !== undefined) data.fixedModel = input.fixedModel;
  if (input.freeOnly !== undefined) data.freeOnly = input.freeOnly;
  if (input.spendCeilingCents !== undefined) data.spendCeilingCents = input.spendCeilingCents;
  if (input.spendWindowDays !== undefined) data.spendWindowDays = input.spendWindowDays;
  if (input.allowAutoFallback !== undefined) data.allowAutoFallback = input.allowAutoFallback;
  if (input.externalProcessingDisabled !== undefined) {
    data.externalProcessingDisabled = input.externalProcessingDisabled;
  }
  if (input.preset !== undefined) data.preset = input.preset;
  if (input.fallbackOrder !== undefined) data.fallbackOrder = input.fallbackOrder;

  return prisma.aiRoutingPolicy.upsert({
    where: { userId },
    create: { userId, ...data } as never,
    update: data as never,
  });
}

// ── Model preferences ───────────────────────────────────────────────────────

export async function listPreferences(userId: string, conversationId?: string) {
  return prisma.aiModelPreference.findMany({
    where: {
      userId,
      ...(conversationId ? { conversationId } : {}),
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * The model pinned for one conversation, if the student pinned one.
 *
 * A single row lookup, so the common case — no override — costs one indexed
 * query rather than a scan of every preference the student owns.
 */
export async function findConversationOverride(userId: string, conversationId: string) {
  return prisma.aiModelPreference.findFirst({
    where: { userId, scope: "CONVERSATION", conversationId, allowed: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * The preferences that apply to one request: the student's global list plus the
 * per-conversation override for *this* conversation.
 *
 * `listPreferences(userId)` returns every row the student has, including the
 * overrides of other conversations. Those are none of this request's business:
 * an override pinned inside one chat must not silently re-order (or deny) the
 * models used in another one, so the routing engine only ever sees the global
 * rows and the override for the conversation it is routing.
 */
export async function listEffectivePreferences(
  userId: string,
  conversationId?: string | null,
) {
  return prisma.aiModelPreference.findMany({
    where: {
      userId,
      OR: [
        { scope: "GLOBAL" },
        ...(conversationId ? [{ scope: "CONVERSATION" as const, conversationId }] : []),
      ],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Replace the caller's preference rows for one scope. Preferences are a set, not
 * a log, so an upsert list is written as delete-and-recreate *within the scope
 * being replaced*: a global save never touches a per-conversation override.
 */
export async function replacePreferences(
  userId: string,
  scope: "GLOBAL" | "CONVERSATION",
  conversationId: string | null,
  preferences: ModelPreferenceInput[],
) {
  const scopeWhere =
    scope === "CONVERSATION"
      ? { userId, scope, conversationId: conversationId ?? undefined }
      : { userId, scope };

  await prisma.$transaction([
    prisma.aiModelPreference.deleteMany({ where: scopeWhere }),
    ...(preferences.length > 0
      ? [
          prisma.aiModelPreference.createMany({
            data: preferences.map((pref) => ({
              userId,
              scope,
              conversationId: scope === "CONVERSATION" ? (pref.conversationId ?? conversationId) : null,
              provider: pref.provider,
              model: pref.model,
              connectionId: pref.connectionId ?? null,
              priority: pref.priority ?? null,
              allowed: pref.allowed ?? true,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  return listPreferences(userId, scope === "CONVERSATION" ? (conversationId ?? undefined) : undefined);
}

/** Clear the per-conversation override rows for one conversation. */
export async function clearConversationPreferences(userId: string, conversationId: string) {
  await prisma.aiModelPreference.deleteMany({
    where: { userId, scope: "CONVERSATION", conversationId },
  });
}

// ── Capability overrides ────────────────────────────────────────────────────

export interface CapabilityOverrideRow {
  provider: string;
  model: string;
  kind: string;
  evidence: string;
  note: string | null;
  connectionId: string | null;
}

/** Every capability assertion the user has saved, for merging into the catalog. */
export async function listCapabilityOverrides(userId: string): Promise<CapabilityOverrideRow[]> {
  const rows = await prisma.aiModelCapability.findMany({
    where: { userId },
    orderBy: [{ provider: "asc" }, { model: "asc" }],
  });
  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    kind: row.kind,
    evidence: row.evidence,
    note: row.note,
    connectionId: row.connectionId,
  }));
}

/**
 * Replace the user's capability assertions. A VERIFIED row records `verifiedAt`
 * so the UI can show when the student actually exercised the capability; other
 * evidence levels clear it.
 */
export async function replaceCapabilityOverrides(
  userId: string,
  overrides: CapabilityOverrideRow[],
): Promise<CapabilityOverrideRow[]> {
  await prisma.$transaction([
    prisma.aiModelCapability.deleteMany({ where: { userId } }),
    ...(overrides.length > 0
      ? [
          prisma.aiModelCapability.createMany({
            data: overrides.map((o) => ({
              userId,
              connectionId: o.connectionId ?? null,
              provider: o.provider,
              model: o.model,
              kind: o.kind as never,
              evidence: o.evidence as never,
              note: o.note ?? null,
              verifiedAt: o.evidence === "VERIFIED" ? new Date() : null,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
  return listCapabilityOverrides(userId);
}
