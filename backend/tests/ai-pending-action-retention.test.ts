import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The HTTP tests hand the service a *real* provider (real resolution logic)
// whose connection is faked, so only the credentials lookup is stubbed.
vi.mock("@/services/ai-connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/ai-connections")>();
  return { ...mod, getActiveUserConnection: vi.fn() };
});

import { prisma, registerAndLogin, authRequestJson } from "./helpers";
import { getActiveUserConnection } from "@/services/ai-connections";
import { confirmationStore } from "@/services/ai/confirmations";
import {
  claimPendingAction,
  loadPendingAction,
  loadPendingActionById,
} from "@/services/ai/pending-action-repository";
import {
  decidedRetentionMs,
  expiredGraceMs,
  retentionSchedulerRunning,
  startRetentionScheduler,
  stopRetentionScheduler,
  sweepPendingActions,
} from "@/services/ai/pending-action-retention";

const BASE = "/api/v1";

// ─────────────────────────────────────────────────────────────────────────────
// Gap #30 — retention sweep + multi-instance-safe confirmation state
//
// These are real database integration tests. The invariants they prove cannot be
// established with mocks: the atomic claim, the retention predicates and the
// cross-context visibility all live in Postgres, so the tests talk to it.
//
// "Two instances" is modelled as two *independent store contexts* over the same
// authoritative database — `confirmationStore.reset()` clears the process-local
// cache between them, exactly as a fresh process would start empty. Every
// decision in these tests goes through the database, so the cache being empty or
// stale is precisely the situation a second Render instance is in.
// ─────────────────────────────────────────────────────────────────────────────

let user: { token: string; id: string };
let conversationId: string;

/** Park a durable proposal directly, bypassing the agent, so timing is exact. */
async function parkProposal(opts: {
  status?: "PENDING" | "EXECUTED" | "CANCELLED" | "SUPERSEDED";
  createdAt?: Date;
  expiresAt?: Date;
  decidedAt?: Date | null;
  title?: string;
}) {
  const now = Date.now();
  return prisma.aiPendingAction.create({
    data: {
      userId: user.id,
      conversationId,
      title: opts.title ?? "Retention fixture",
      actions: [{ tool: "create_task", description: "Add a task", arguments: { title: "Retention task" } }],
      status: opts.status ?? "PENDING",
      createdAt: opts.createdAt ?? new Date(now),
      expiresAt: opts.expiresAt ?? new Date(now + 30 * 60 * 1000),
      decidedAt: opts.decidedAt ?? null,
    },
  });
}

async function newUser(tag: string) {
  const auth = await registerAndLogin(`${tag}-${Date.now()}@test.com`, "Pass123!");
  return { token: auth.token, id: auth.user.id };
}

beforeEach(async () => {
  confirmationStore.reset();
  user = await newUser("retention");
  const created = await authRequestJson("post", `${BASE}/ai/conversations`, user.token, { title: "Retention" });
  conversationId = created.body.data.id as string;
  vi.mocked(getActiveUserConnection).mockImplementation(async () => ({
    provider: "openai" as const,
    decryptedCredentials: { apiKey: "sk-test" },
    endpoint: "https://p.test",
    model: "test-model",
  }));
});

afterEach(() => {
  stopRetentionScheduler();
  vi.unstubAllGlobals();
});

// ── Retention ────────────────────────────────────────────────────────────────

describe("Pending-action retention sweep (gap #30)", () => {
  it("keeps a valid, unexpired PENDING proposal", async () => {
    const row = await parkProposal({});
    const result = await sweepPendingActions();
    expect(result.decidedDeleted).toBe(0);
    expect(result.expiredDeleted).toBe(0);
    expect(await prisma.aiPendingAction.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("keeps a PENDING proposal that expired inside the grace window", async () => {
    // Expired one hour ago, grace is 24h by default → still present.
    const row = await parkProposal({ expiresAt: new Date(Date.now() - 60 * 60 * 1000) });
    const result = await sweepPendingActions();
    expect(result.expiredDeleted).toBe(0);
    expect(await prisma.aiPendingAction.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("removes an expired PENDING proposal past the grace window", async () => {
    const past = new Date(Date.now() - expiredGraceMs() - 60 * 60 * 1000);
    const row = await parkProposal({ expiresAt: past });
    const result = await sweepPendingActions();
    expect(result.expiredDeleted).toBe(1);
    expect(await prisma.aiPendingAction.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it("keeps a decided row inside the retention window", async () => {
    const row = await parkProposal({
      status: "EXECUTED",
      decidedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const result = await sweepPendingActions();
    expect(result.decidedDeleted).toBe(0);
    expect(await prisma.aiPendingAction.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("removes a decided row past the retention window (EXECUTED / CANCELLED / SUPERSEDED)", async () => {
    const old = new Date(Date.now() - decidedRetentionMs() - 60 * 60 * 1000);
    const executed = await parkProposal({ status: "EXECUTED", decidedAt: old });
    const cancelled = await parkProposal({ status: "CANCELLED", decidedAt: old });
    const superseded = await parkProposal({ status: "SUPERSEDED", decidedAt: old });

    const result = await sweepPendingActions();
    expect(result.decidedDeleted).toBe(3);
    for (const row of [executed, cancelled, superseded]) {
      expect(await prisma.aiPendingAction.findUnique({ where: { id: row.id } })).toBeNull();
    }
  });

  it("follows the documented boundary rule: strictly older than the window is removed", async () => {
    const justInside = await parkProposal({
      status: "EXECUTED",
      decidedAt: new Date(Date.now() - decidedRetentionMs() + 60 * 60 * 1000),
    });
    const justOutside = await parkProposal({
      status: "EXECUTED",
      decidedAt: new Date(Date.now() - decidedRetentionMs() - 60 * 1000),
    });

    await sweepPendingActions();

    expect(await prisma.aiPendingAction.findUnique({ where: { id: justInside.id } })).not.toBeNull();
    expect(await prisma.aiPendingAction.findUnique({ where: { id: justOutside.id } })).toBeNull();
  });

  it("is idempotent — a second run deletes nothing further", async () => {
    const old = new Date(Date.now() - decidedRetentionMs() - 60 * 60 * 1000);
    await parkProposal({ status: "CANCELLED", decidedAt: old });

    const first = await sweepPendingActions();
    expect(first.decidedDeleted).toBe(1);
    const second = await sweepPendingActions();
    expect(second.decidedDeleted).toBe(0);
    expect(second.expiredDeleted).toBe(0);
  });

  it("processes a large eligible set in bounded batches without losing rows", async () => {
    const old = new Date(Date.now() - decidedRetentionMs() - 60 * 60 * 1000);
    // More than one 500-row batch, to prove the drain loop works.
    const rows = await Promise.all(
      Array.from({ length: 620 }, (_, i) => parkProposal({ status: "SUPERSEDED", decidedAt: old, title: `bulk-${i}` })),
    );

    const result = await sweepPendingActions();
    expect(result.decidedDeleted).toBe(620);
    expect(result.batches).toBeGreaterThanOrEqual(2);
    const remaining = await prisma.aiPendingAction.count({ where: { id: { in: rows.map((r) => r.id) } } });
    expect(remaining).toBe(0);
  }, 30_000);

  it("does not remove a PENDING row that changed state to a fresh decision mid-sweep", async () => {
    // A PENDING row with an *old* expiry is eligible. If it is decided while the
    // sweep is running, the re-asserted predicate must protect it (it is no
    // longer PENDING, and its fresh decidedAt is inside the window).
    const row = await parkProposal({ expiresAt: new Date(Date.now() - expiredGraceMs() - 60 * 60 * 1000) });

    // Simulate the interleaving: decide it before the delete predicates run.
    await prisma.aiPendingAction.update({
      where: { id: row.id },
      data: { status: "CANCELLED", decidedAt: new Date() },
    });

    await sweepPendingActions();
    const after = await prisma.aiPendingAction.findUnique({ where: { id: row.id } });
    expect(after).not.toBeNull();
    expect(after?.status).toBe("CANCELLED");
  });

  it("only touches pending-action rows — academic records are never affected", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, user.token, { title: "Untouched task" });
    const old = new Date(Date.now() - decidedRetentionMs() - 60 * 60 * 1000);
    await parkProposal({ status: "EXECUTED", decidedAt: old });

    await sweepPendingActions();

    const still = await authRequestJson("get", `${BASE}/tasks/${task.body.data.id}`, user.token);
    expect(still.status).toBe(200);
  });
});

// ── Multi-instance state ─────────────────────────────────────────────────────

describe("Multi-instance-safe confirmation state (gap #30)", () => {
  it("an empty cache (as a fresh instance starts) still sees the durable proposal", async () => {
    const row = await parkProposal({});
    // A different instance: separate process-local cache, same database.
    confirmationStore.reset();
    expect(confirmationStore.getPending(user.id, conversationId)).toBeNull();

    const loaded = await loadPendingAction(user.id, conversationId);
    expect(loaded?.id).toBe(row.id);
  });

  it("a status change made in one context is observed by another", async () => {
    const row = await parkProposal({});

    // Instance A cancels it in the database.
    await prisma.aiPendingAction.update({
      where: { id: row.id },
      data: { status: "CANCELLED", decidedAt: new Date() },
    });

    // Instance B, with an empty cache, must not see a pending proposal.
    confirmationStore.reset();
    const loaded = await loadPendingAction(user.id, conversationId);
    expect(loaded).toBeNull();
  });

  it("a stale cache entry cannot resurrect a cancelled proposal through the REST read", async () => {
    const row = await parkProposal({});
    // Cache it as PENDING (what the owning instance would have).
    const loaded = await loadPendingAction(user.id, conversationId);
    confirmationStore.hydrate(loaded!);
    expect(confirmationStore.getPending(user.id, conversationId)?.id).toBe(row.id);

    // Another instance cancels it.
    await prisma.aiPendingAction.update({
      where: { id: row.id },
      data: { status: "CANCELLED", decidedAt: new Date() },
    });

    // The read reconciles from the database, not from the stale cache.
    const res = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/pending-action`, user.token);
    expect(res.status).toBe(200);
    expect(res.body.data.pendingAction).toBeNull();
  });

  it("a stale cache entry cannot execute a proposal cancelled elsewhere", async () => {
    const row = await parkProposal({});
    const loaded = await loadPendingAction(user.id, conversationId);
    confirmationStore.hydrate(loaded!);

    await prisma.aiPendingAction.update({
      where: { id: row.id },
      data: { status: "CANCELLED", decidedAt: new Date() },
    });

    const res = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/pending-action/${row.id}/confirm`,
      user.token,
    );
    expect(res.status).toBe(409);
    expect(await prisma.task.count({ where: { userId: user.id, title: "Retention task" } })).toBe(0);
  });

  it("a proposal parked before a restart is recovered after the cache is dropped", async () => {
    const row = await parkProposal({});
    confirmationStore.reset();

    const res = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/pending-action`, user.token);
    expect(res.body.data.pendingAction.id).toBe(row.id);

    const confirmed = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/pending-action/${row.id}/confirm`,
      user.token,
    );
    expect(confirmed.status).toBe(200);
    expect(await prisma.task.count({ where: { userId: user.id, title: "Retention task" } })).toBe(1);
  });
});

// ── Concurrency, replay and authorisation ────────────────────────────────────

describe("Confirmation concurrency, replay and authorisation (gap #30)", () => {
  it("two simultaneous claims — only one wins", async () => {
    const row = await parkProposal({});

    const [a, b] = await Promise.all([
      claimPendingAction(user.id, conversationId, row.id),
      claimPendingAction(user.id, conversationId, row.id),
    ]);

    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.status).toBe("EXECUTED");
  });

  it("two simultaneous confirm requests perform the underlying write exactly once", async () => {
    await parkProposal({});

    const [first, second] = await Promise.all([
      authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/pending-action/${(await loadPendingAction(user.id, conversationId))!.id}/confirm`, user.token),
      authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/pending-action/${(await loadPendingAction(user.id, conversationId))!.id}/confirm`, user.token),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    // The winning request ran the write once; the loser ran nothing.
    expect(await prisma.task.count({ where: { userId: user.id, title: "Retention task" } })).toBe(1);
  });

  it("repeated confirm requests do not duplicate the action", async () => {
    await parkProposal({});
    const id = (await loadPendingAction(user.id, conversationId))!.id;

    await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/pending-action/${id}/confirm`, user.token);
    const replay = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/pending-action/${id}/confirm`, user.token);

    expect(replay.status).toBe(409);
    expect(await prisma.task.count({ where: { userId: user.id, title: "Retention task" } })).toBe(1);
  });

  it("an expired proposal cannot be claimed or confirmed", async () => {
    const row = await parkProposal({ expiresAt: new Date(Date.now() - 60 * 1000) });

    expect(await claimPendingAction(user.id, conversationId, row.id)).toBeNull();
    const res = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/pending-action/${row.id}/confirm`,
      user.token,
    );
    expect(res.status).toBe(409);
    expect(await prisma.task.count({ where: { userId: user.id, title: "Retention task" } })).toBe(0);
  });

  it("a cancelled proposal cannot be claimed", async () => {
    const row = await parkProposal({ status: "CANCELLED", decidedAt: new Date() });
    expect(await claimPendingAction(user.id, conversationId, row.id)).toBeNull();
  });

  it("another user cannot read or claim a proposal", async () => {
    const row = await parkProposal({});
    const other = await newUser("retention-other");

    // Wrong owner in the claim predicate → no rows matched.
    expect(await claimPendingAction(other.id, conversationId, row.id)).toBeNull();
    expect(await loadPendingActionById(other.id, row.id)).toBeNull();

    // The row is untouched and still PENDING for its real owner.
    expect((await loadPendingActionById(user.id, row.id))?.status).toBe("PENDING");
  });

  it("a proposal id from another conversation of the same user is rejected (404)", async () => {
    const row = await parkProposal({});
    const otherConversation = await authRequestJson("post", `${BASE}/ai/conversations`, user.token, { title: "Other" });

    const res = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${otherConversation.body.data.id}/pending-action/${row.id}/confirm`,
      user.token,
    );
    expect(res.status).toBe(404);
    expect((await loadPendingActionById(user.id, row.id))?.status).toBe("PENDING");
  });

  it("a simultaneously-claiming chat tool call cannot double-execute", async () => {
    const row = await parkProposal({});
    // The chat tool path claims from the database; a parallel REST claim must not
    // also succeed.
    const [toolWon, restWon] = await Promise.all([
      claimPendingAction(user.id, conversationId, row.id),
      claimPendingAction(user.id, conversationId, row.id),
    ]);
    expect([toolWon, restWon].filter(Boolean)).toHaveLength(1);
  });
});

// ── Scheduler lifecycle ──────────────────────────────────────────────────────

describe("Retention scheduler lifecycle (gap #30)", () => {
  it("starting twice does not leak timers, and stop clears it", () => {
    expect(retentionSchedulerRunning()).toBe(false);
    const stop = startRetentionScheduler(60 * 60 * 1000);
    expect(retentionSchedulerRunning()).toBe(true);
    startRetentionScheduler(60 * 60 * 1000);
    expect(retentionSchedulerRunning()).toBe(true);
    stop();
    expect(retentionSchedulerRunning()).toBe(false);
  });
});
