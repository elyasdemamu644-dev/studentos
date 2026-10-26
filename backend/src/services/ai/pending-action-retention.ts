import { prisma } from "@/utils/prisma";
import { config } from "@/config";
import {
  deleteDecidedOlderThan,
  deleteExpiredPendingOlderThan,
  type RetentionResult,
  type RetentionWindow,
} from "./pending-action-repository";

// ─────────────────────────────────────────────────────────────────────────────
// Pending-action retention
// ─────────────────────────────────────────────────────────────────────────────
//
// `ai_pending_actions` rows accumulate forever otherwise: every proposal the
// assistant ever parked stays on disk after it was executed, cancelled,
// superseded or simply left to expire. Nothing reads a terminal row again, so
// they are dead weight — but they are also the ***replay guard***: while a
// decided row exists, a repeated confirm of its id can be told "already
// applied" instead of being silently accepted. Retention therefore deletes on a
// long, deliberate schedule rather than eagerly.
//
// The policy (both windows configurable via `config.ai`, see `.env.example`):
//
//   • Decided rows (EXECUTED / CANCELLED / SUPERSEDED) are kept for
//     `pendingActionRetentionDays` (default 7) past their decision. That is the
//     window in which a replayed confirm is still recognised as a duplicate.
//   • Expired-but-still-PENDING rows (never decided) are kept for
//     `pendingActionExpiredGraceHours` (default 24) past expiry — enough time
//     for the student to understand why the card is gone — then removed.
//
// Both rules are expressed as database predicates and re-asserted inside the
// DELETE, so a row that changes state mid-sweep is never removed by mistake.
// Cleanup is idempotent and safe to run from many processes at once.

/** The effective retention window, resolved from configuration. */
export function retentionWindow(): RetentionWindow {
  return {
    retentionDays: config.pendingActionRetentionDays,
    expiredGraceHours: config.pendingActionExpiredGraceHours,
  };
}

const BATCH_SIZE = 500;
/** Safety stop so a pathological backlog cannot pin the sweep — repeated runs drain it. */
const MAX_BATCHES = 200;

/**
 * Run one full sweep: drain both eligibility classes in bounded batches.
 *
 * Never throws into its caller — a cleanup failure must not break a request or
 * crash the process — but it reports the error so a log line survives. Each
 * batch is a separate statement, so one malformed row cannot block the rest.
 */
export async function sweepPendingActions(
  now: Date = new Date(),
): Promise<RetentionResult & { decidedDeleted: number; expiredDeleted: number; batches: number }> {
  const { retentionDays, expiredGraceHours } = retentionWindow();
  const decidedBefore = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const expiredBefore = new Date(now.getTime() - expiredGraceHours * 60 * 60 * 1000);

  let decidedDeleted = 0;
  let expiredDeleted = 0;
  let batches = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    batches++;
    const removed = await deleteDecidedOlderThan(decidedBefore, BATCH_SIZE);
    decidedDeleted += removed;
    if (removed < BATCH_SIZE) break;
  }

  for (let i = 0; i < MAX_BATCHES; i++) {
    batches++;
    const removed = await deleteExpiredPendingOlderThan(expiredBefore, BATCH_SIZE);
    expiredDeleted += removed;
    if (removed < BATCH_SIZE) break;
  }

  return { decidedDeleted, expiredDeleted, batches };
}

/**
 * How long a decided proposal is retained, in ms. Exported so tests can assert
 * the boundary against the same value the sweep uses rather than a copy.
 */
export function decidedRetentionMs(): number {
  return retentionWindow().retentionDays * 24 * 60 * 60 * 1000;
}

export function expiredGraceMs(): number {
  return retentionWindow().expiredGraceHours * 60 * 60 * 1000;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduling
// ─────────────────────────────────────────────────────────────────────────────
//
// There is no queue or cron in this deployment. The API runs on Render, where
// free instances sleep and may restart, and more than one instance can run the
// same code — so a `setInterval` is *not* a guaranteed distributed scheduler.
// It is used only as a best-effort trim between restarts; correctness does not
// depend on it. Two properties keep that honest:
//
//   1. The sweep is idempotent and concurrency-safe, so an instance that wakes
//      up and one that never slept cannot both damage anything by running it.
//   2. `sweepPendingActions` also runs opportunistically on confirmation reads
//      (see `service.ts`), so a long-lived instance that missed its interval
//      still trims eventually.
//
// The operational limitation — a fully-sleeping deployment trims nothing until
// it next wakes — is documented in AI_CONTEXT.md.

const HOUR_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Start the best-effort background trim. Returns a stop function. Never called
 * by tests (they invoke `sweepPendingActions` directly) and a no-op if a timer
 * is already active, so a double boot cannot leak intervals.
 */
export function startRetentionScheduler(intervalMs = HOUR_MS): () => void {
  if (timer) return () => stopRetentionScheduler();

  const tick = async () => {
    if (running) return; // do not overlap sweeps within one process
    running = true;
    try {
      const result = await sweepPendingActions();
      if (result.decidedDeleted > 0 || result.expiredDeleted > 0) {
        // Counts only — never action payloads, titles or user content.
        console.log(
          `[ai-retention] swept pending actions: decided=${result.decidedDeleted} expired=${result.expiredDeleted} batches=${result.batches}`,
        );
      }
    } catch (error) {
      console.error("[ai-retention] sweep failed:", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };

  // First sweep shortly after boot, then on the interval. `unref` so the timer
  // never keeps the process alive on its own.
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  const kickoff = setTimeout(() => void tick(), 10_000);
  kickoff.unref?.();

  return () => {
    clearTimeout(kickoff);
    stopRetentionScheduler();
  };
}

export function stopRetentionScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** True while a timer is registered — used by tests to assert lifecycle. */
export function retentionSchedulerRunning(): boolean {
  return timer !== null;
}

/** Row count, owner-agnostic — diagnostics and tests only. */
export async function countPendingActions(): Promise<number> {
  return prisma.aiPendingAction.count();
}
