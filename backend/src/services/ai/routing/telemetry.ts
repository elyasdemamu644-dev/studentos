import { prisma } from "@/utils/prisma";
import type { AiHealthStatus } from "@prisma/client";
import { AiProviderName } from "@/services/ai/provider";
import {
  catalogIsFree,
  estimateCostCents,
} from "@/services/ai/routing/capability-catalog";

// ─────────────────────────────────────────────────────────────────────────────
// Usage + cost telemetry
// ─────────────────────────────────────────────────────────────────────────────
//
// Every completed provider turn writes one usage row. Token counts and cost
// come from the provider's own usage block when the adapter reports one; when it
// does not, cost is derived from the static price table and flagged `estimated`.
// An unknown price stays `null` and is never treated as zero, so a spend ceiling
// cannot be gamed by a model we cannot price.

export interface UsageInput {
  userId: string;
  conversationId?: string | null;
  connectionId?: string | null;
  provider: AiProviderName;
  model: string;
  feature?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Cost in cents reported by the provider, when it reports cost directly. */
  reportedCostCents?: number | null;
}

/**
 * Record one turn's usage. Best-effort by contract: telemetry must never fail a
 * request that otherwise succeeded, so this swallows write errors after logging
 * nothing sensitive.
 */
export async function recordUsage(input: UsageInput): Promise<void> {
  const promptTokens = Math.max(0, Math.round(input.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.round(input.completionTokens ?? 0));
  const totalTokens = promptTokens + completionTokens;

  const free = catalogIsFree(input.provider, input.model);
  let costCents: number | null = null;
  let estimated = false;

  if (typeof input.reportedCostCents === "number") {
    costCents = Math.round(input.reportedCostCents);
  } else if (free) {
    costCents = 0;
  } else {
    costCents = estimateCostCents(input.provider, input.model, promptTokens, completionTokens);
    estimated = costCents !== null;
  }

  try {
    await prisma.aiUsageRecord.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId ?? null,
        connectionId: input.connectionId ?? null,
        provider: input.provider,
        model: input.model,
        feature: input.feature ?? "chat",
        promptTokens,
        completionTokens,
        totalTokens,
        costCents,
        estimated,
        free,
      },
    });
  } catch {
    // Never let telemetry break the request path.
  }
}

export interface UsageSummary {
  windowDays: number;
  totalRequests: number;
  totalTokens: number;
  totalCostCents: number;
  /** True when any contributing row had unknown pricing. */
  hasUnknownPricing: boolean;
  byProvider: Array<{
    provider: string;
    model: string;
    requests: number;
    totalTokens: number;
    costCents: number;
  }>;
}

/**
 * Rolling-window usage summary for the settings UI and the spend ceiling check.
 * Unknown-priced turns contribute tokens but no cost; the summary flags that so
 * the UI can explain why a total may look low.
 */
export async function getUsageSummary(
  userId: string,
  windowDays: number,
): Promise<UsageSummary> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.aiUsageRecord.findMany({
    where: { userId, createdAt: { gte: since } },
    select: {
      provider: true,
      model: true,
      totalTokens: true,
      costCents: true,
    },
  });

  const byKey = new Map<string, { provider: string; model: string; requests: number; totalTokens: number; costCents: number }>();
  let totalCostCents = 0;
  let totalTokens = 0;
  let hasUnknownPricing = false;

  for (const row of rows) {
    totalTokens += row.totalTokens;
    if (row.costCents === null) hasUnknownPricing = true;
    else totalCostCents += row.costCents;

    const key = `${row.provider}:${row.model}`;
    const bucket = byKey.get(key) ?? { provider: row.provider, model: row.model, requests: 0, totalTokens: 0, costCents: 0 };
    bucket.requests += 1;
    bucket.totalTokens += row.totalTokens;
    bucket.costCents += row.costCents ?? 0;
    byKey.set(key, bucket);
  }

  return {
    windowDays,
    totalRequests: rows.length,
    totalTokens,
    totalCostCents,
    hasUnknownPricing,
    byProvider: [...byKey.values()].sort((a, b) => b.costCents - a.costCents),
  };
}

/**
 * Sum of known cost in the window, used to enforce a spend ceiling. Unknown-
 * priced turns are excluded from the sum *and* from the "is over ceiling"
 * decision would be wrong in the other direction, so the caller pairs this with
 * `getUsageSummary().hasUnknownPricing` when deciding whether a paid model is
 * safe to auto-select.
 */
export async function getWindowSpendCents(userId: string, windowDays: number): Promise<number> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const result = await prisma.aiUsageRecord.aggregate({
    where: { userId, createdAt: { gte: since }, costCents: { not: null } },
    _sum: { costCents: true },
  });
  return result._sum.costCents ?? 0;
}

// ── Provider health ─────────────────────────────────────────────────────────

export interface HealthInput {
  userId: string;
  connectionId: string;
  provider: AiProviderName;
  status: AiHealthStatus;
  latencyMs?: number | null;
  /**
   * A sanitized, credential-free message. Callers must pass only controlled
   * error text — never a raw provider payload or key.
   */
  message?: string | null;
  code?: string | null;
}

/** Record the outcome of a provider probe or a live turn. Best-effort. */
export async function recordHealth(input: HealthInput): Promise<void> {
  try {
    await prisma.aiProviderHealth.create({
      data: {
        userId: input.userId,
        connectionId: input.connectionId,
        provider: input.provider,
        status: input.status,
        latencyMs: input.latencyMs ?? null,
        message: input.message ?? null,
        code: input.code ?? null,
      },
    });
  } catch {
    // Best-effort.
  }
}

export interface HealthSnapshot {
  connectionId: string;
  provider: string;
  status: AiHealthStatus;
  latencyMs: number | null;
  message: string | null;
  code: string | null;
  checkedAt: Date;
}

/**
 * Latest health status per connection for the user's settings page. Reads the
 * most recent row per connection so the UI shows current state, not history.
 */
export async function getLatestHealth(userId: string, limit: number): Promise<HealthSnapshot[]> {
  const rows = await prisma.aiProviderHealth.findMany({
    where: { userId },
    orderBy: { checkedAt: "desc" },
    take: Math.max(limit, 1) * 8,
    select: {
      connectionId: true,
      provider: true,
      status: true,
      latencyMs: true,
      message: true,
      code: true,
      checkedAt: true,
    },
  });

  const seen = new Set<string>();
  const latest: HealthSnapshot[] = [];
  for (const row of rows) {
    if (seen.has(row.connectionId)) continue;
    seen.add(row.connectionId);
    latest.push(row);
    if (latest.length >= limit) break;
  }
  return latest;
}
