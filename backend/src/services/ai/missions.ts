import { randomUUID } from "node:crypto";
import { prisma } from "@/utils/prisma";
import { Prisma } from "@prisma/client";
import { NotFoundError, ConflictError, ValidationApiError } from "@/config/errors";
import { ERROR_CODES } from "@tutor-walle/shared/schemas/api";
import { executeTool, type ExecutionAutonomyMode } from "./tools/registry";
import { confirmationStore, type PendingAction, summarizeOutcomes } from "./confirmations";
import {
  claimPendingAction,
  loadPendingActionById,
  persistPendingAction,
  updatePersistedStatus,
} from "./pending-action-repository";
import { executeProposalActions } from "./tools/confirm-tool";
import type { ProposedAction } from "./tools/types";
import { settingsService } from "@/services/settings";
import { getTool } from "./tools/registry";

type MissionStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING"
  | "PARTIAL"
  | "FAILED_RECOVERABLE"
  | "FAILED_TERMINAL"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "COMPLETED";

type StepStatus =
  | "PENDING"
  | "QUEUED"
  | "RUNNING"
  | "WAITING"
  | "COMPLETED"
  | "FAILED_RECOVERABLE"
  | "FAILED_TERMINAL"
  | "SKIPPED"
  | "CANCELLED";

interface MissionStepInput {
  toolName: string;
  description: string;
  arguments: Record<string, unknown>;
  dependsOn?: string[];
  maxAttempts?: number;
}

interface CreateMissionInput {
  objective: string;
  conversationId?: string;
  steps: MissionStepInput[];
  contextSnapshot?: Record<string, unknown>;
}

interface MissionWithSteps {
  id: string;
  userId: string;
  conversationId: string | null;
  objective: string;
  contextSnapshot: Prisma.JsonValue | null;
  status: MissionStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  terminalError: string | null;
  steps: MissionStepWithDetails[];
  /**
   * The proposal a WAITING step is blocked on, when there is one. The UI needs
   * it to show what the student is being asked to approve; without it a mission
   * that stopped for approval looks identical to one that is still working.
   */
  pendingAction: MissionPendingAction | null;
}

/** The proposal a mission step is waiting on, in the shape the UI needs. */
interface MissionPendingAction {
  id: string;
  title: string;
  status: string;
  actions: Array<{ tool: string; description: string }>;
  createdAt: string;
  expiresAt: string;
  result: { executed: number; verified: number; failed: number; summary: string } | null;
}

/** The raw columns of one mission step, as Prisma returns them. */
interface MissionStepRecord {
  id: string;
  missionId: string;
  stepOrder: number;
  toolName: string;
  description: string;
  arguments: Prisma.JsonValue;
  dependsOn: string[];
  status: string;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  pendingActionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  result: Prisma.JsonValue | null;
  error: string | null;
  verification: Prisma.JsonValue | null;
}

interface MissionStepWithDetails extends Omit<MissionStepRecord, "status"> {
  status: StepStatus;
}

const RETRY_BACKOFF_BASE_MS = 1000;
const MAX_RETRY_BACKOFF_MS = 30000;
/**
 * How long a mission may sit in RUNNING before it is treated as abandoned.
 *
 * A RUNNING mission means "a worker owns this right now". If the worker died
 * (deploy, crash, laptop closed) nothing would ever move it again, so a RUNNING
 * row older than this is reset and the mission becomes runnable again. It is
 * deliberately generous: a real run of a long plan must not be stolen.
 */
const STALE_RUNNING_MS = 5 * 60 * 1000;
/** How long a parked proposal stays confirmable. Matches the chat handshake. */
const PENDING_ACTION_TTL_MS = 30 * 60 * 1000;
const TRANSIENT_ERROR_CODES = new Set([
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_RATE_LIMITED",
  "STORAGE_ERROR",
  "EMAIL_TIMEOUT",
  "NETWORK_ERROR",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);

function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    if (code && TRANSIENT_ERROR_CODES.has(code)) return true;
    if (error.message.includes("timeout") || error.message.includes("ECONNREFUSED")) return true;
  }
  return false;
}

function calculateBackoff(attempt: number): number {
  const backoff = Math.min(RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt), MAX_RETRY_BACKOFF_MS);
  const jitter = Math.random() * 0.3 * backoff;
  return Math.floor(backoff + jitter);
}

function mapMission(record: {
  id: string;
  userId: string;
  conversationId: string | null;
  objective: string;
  contextSnapshot: Prisma.JsonValue | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  terminalError: string | null;
  steps: MissionStepRecord[];
}): MissionWithSteps {
  return {
    id: record.id,
    userId: record.userId,
    conversationId: record.conversationId,
    objective: record.objective,
    contextSnapshot: record.contextSnapshot,
    status: record.status as MissionStatus,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    cancelledAt: record.cancelledAt,
    terminalError: record.terminalError,
    pendingAction: null,
    steps: record.steps.map(mapStep),
  };
}

/** One step, with its status narrowed to the mission vocabulary. */
function mapStep(s: MissionStepRecord): MissionStepWithDetails {
  return {
    id: s.id,
    missionId: s.missionId,
    stepOrder: s.stepOrder,
    toolName: s.toolName,
    description: s.description,
    arguments: s.arguments,
    dependsOn: s.dependsOn,
    status: s.status as StepStatus,
    attempts: s.attempts,
    maxAttempts: s.maxAttempts,
    idempotencyKey: s.idempotencyKey,
    pendingActionId: s.pendingActionId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    result: s.result,
    error: s.error,
    verification: s.verification,
  };
}

function validatePlan(steps: MissionStepInput[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const stepIds = new Set(steps.map((_, i) => String(i)));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.toolName || step.toolName.trim().length === 0) {
      errors.push(`Step ${i}: toolName is required`);
      continue;
    }
    if (!step.description || step.description.trim().length === 0) {
      errors.push(`Step ${i}: description is required`);
    }
    if (!step.arguments || typeof step.arguments !== "object") {
      errors.push(`Step ${i}: arguments must be an object`);
    }
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        if (!stepIds.has(dep)) {
          errors.push(`Step ${i}: dependsOn references unknown step "${dep}"`);
        }
      }
    }
    // A mission step runs without the agent loop asking the student to
    // confirm mid-step; `confirm_pending_actions` *is* the confirmation
    // gesture, so it cannot be used as a mission step. The catalog already
    // hides it, but this keeps an old or hand-crafted plan from trying to
    // bypass the mission approval handshake. Unknown tools are not rejected
    // here — creation still accepts them and execution fails with
    // "No tool named..." as the existing tests expect.
    const tool = getTool(step.toolName);
    if (tool?.confirmation === "self") {
      errors.push(`Step ${i}: tool "${step.toolName}" cannot be used as a mission step`);
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(stepIndex: number): boolean {
    const key = String(stepIndex);
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    const step = steps[stepIndex];
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        const depIndex = steps.findIndex((_, i) => String(i) === dep);
        if (depIndex >= 0 && visit(depIndex)) return true;
      }
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  }

  for (let i = 0; i < steps.length; i++) {
    if (visit(i)) {
      errors.push("Plan contains a dependency cycle");
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}

function topologicalOrder(steps: MissionStepInput[]): number[] {
  const inDegree = new Array(steps.length).fill(0);
  const adj: number[][] = Array.from({ length: steps.length }, () => []);

  for (let i = 0; i < steps.length; i++) {
    const deps = steps[i].dependsOn ?? [];
    for (const dep of deps) {
      const depIndex = steps.findIndex((_, idx) => String(idx) === dep);
      if (depIndex !== -1) {
        adj[depIndex].push(i);
        inDegree[i]++;
      }
    }
  }

  const queue: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  const order: number[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of adj[current]) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  return order.length === steps.length ? order : [];
}

async function updateMissionStatus(
  missionId: string,
  status: MissionStatus,
  extra?: { startedAt?: Date; completedAt?: Date; cancelledAt?: Date; terminalError?: string },
): Promise<void> {
  await prisma.aiMission.update({
    where: { id: missionId },
    data: {
      status,
      ...(extra?.startedAt && { startedAt: extra.startedAt }),
      ...(extra?.completedAt && { completedAt: extra.completedAt }),
      ...(extra?.cancelledAt && { cancelledAt: extra.cancelledAt }),
      ...(extra?.terminalError && { terminalError: extra.terminalError }),
    },
  });
}

async function updateStepStatus(
  stepId: string,
  status: StepStatus,
  extra?: {
    startedAt?: Date;
    completedAt?: Date;
    result?: Prisma.InputJsonValue | null;
    error?: string | null;
    verification?: Prisma.InputJsonValue | null;
    pendingActionId?: string | null;
  },
): Promise<void> {
  const data: Prisma.AiMissionStepUpdateInput = { status };
  if (extra?.startedAt) data.startedAt = extra.startedAt;
  if (extra?.completedAt) data.completedAt = extra.completedAt;
  if (extra?.result !== undefined) data.result = extra.result !== null ? extra.result : Prisma.DbNull;
  if (extra?.error !== undefined) data.error = extra.error !== null ? extra.error : undefined;
  if (extra?.verification !== undefined) data.verification = extra.verification !== null ? extra.verification : Prisma.DbNull;
  if (extra?.pendingActionId !== undefined) data.pendingActionId = extra.pendingActionId;

  await prisma.aiMissionStep.update({
    where: { id: stepId },
    data,
  });
}

async function getReadySteps(missionId: string): Promise<MissionStepWithDetails[]> {
  const mission = await prisma.aiMission.findUnique({
    where: { id: missionId },
    include: {
      steps: {
        orderBy: { stepOrder: "asc" },
      },
    },
  });

  if (!mission) return [];

  const completedStepIds = new Set(
    mission.steps.filter((s) => s.status === "COMPLETED").map((s) => s.id),
  );

  return mission.steps
    .filter((step) => {
      if (step.status !== "PENDING" && step.status !== "FAILED_RECOVERABLE") return false;
      // A recoverable step that already burned its attempts is not run again
      // here: `maxAttempts` is the budget for one run, and re-picking it up
      // would turn the mission into an endless retry loop. The student
      // restarts those steps explicitly with `retryMission`.
      if (step.status === "FAILED_RECOVERABLE" && step.attempts >= step.maxAttempts) return false;
      if (step.dependsOn.length === 0) return true;
      return step.dependsOn.every((depId) => completedStepIds.has(depId));
    })
    .map(mapStep);
}

/**
 * Park a step's proposal and remember it on the step.
 *
 * A WRITE tool in manual mode does not run: the registry refuses it and hands
 * back the exact `(tool, arguments)` pair the student was shown. The mission
 * parks that pair as a proposal — in the live confirmation store *and* in
 * `ai_pending_actions`, so it survives a restart and can be claimed
 * atomically — and points the step at it. The step then waits, and the student
 * approves the proposal from the mission or from chat; either way the same
 * durable row is claimed, so the write can happen exactly once.
 *
 * `hydrate` is used rather than `create` on purpose: `create` retires any
 * other proposal still pending in the same conversation, which would silently
 * withdraw a change the student had already been asked about.
 */
async function parkStepProposal(input: {
  userId: string;
  conversationId: string;
  title: string;
  actions: ProposedAction[];
}): Promise<string> {
  const now = new Date();
  const action: PendingAction = {
    id: randomUUID(),
    userId: input.userId,
    conversationId: input.conversationId,
    title: input.title.slice(0, 120),
    actions: input.actions,
    status: "PENDING",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PENDING_ACTION_TTL_MS).toISOString(),
    result: null,
  };
  confirmationStore.hydrate(action);
  await persistPendingAction(action);
  return action.id;
}

/**
 * Bring WAITING steps back in line with the proposals they wait on.
 *
 * The proposal is the source of truth. It may have been approved (from the
 * mission or from chat), cancelled, replaced by a newer one, expired, or
 * removed altogether — and the step has to follow it:
 *
 *   EXECUTED   → the change was applied: the step is COMPLETED (or, when the
 *                stored outcome shows failures, FAILED_RECOVERABLE).
 *   CANCELLED  → the student said no: the step is SKIPPED.
 *   SUPERSEDED → a newer proposal replaced it: the step is FAILED_RECOVERABLE.
 *   PENDING    → still waiting, unless it expired: the step stays WAITING.
 *   missing    → nothing left to approve: the step is FAILED_RECOVERABLE.
 */
async function reconcileWaitingSteps(
  mission: { id: string; userId: string; steps: MissionStepWithDetails[] },
): Promise<{ stillWaiting: boolean; changed: boolean }> {
  let stillWaiting = false;
  let changed = false;

  for (const step of mission.steps) {
    if (step.status !== "WAITING") continue;

    if (!step.pendingActionId) {
      await updateStepStatus(step.id, "FAILED_RECOVERABLE", {
        completedAt: new Date(),
        error: "The proposal this step was waiting on is no longer available.",
      });
      changed = true;
      continue;
    }

    const action = await loadPendingActionById(mission.userId, step.pendingActionId);
    if (!action) {
      await updateStepStatus(step.id, "FAILED_RECOVERABLE", {
        completedAt: new Date(),
        error: "The proposal this step was waiting on no longer exists.",
      });
      changed = true;
      continue;
    }

    if (action.status === "EXECUTED") {
      const result = action.result ?? null;
      const clean = result !== null && result.failed === 0 && result.verified === result.executed;
      if (clean) {
        await updateStepStatus(step.id, "COMPLETED", {
          completedAt: new Date(),
          result: result as unknown as Prisma.InputJsonValue,
          verification: { summary: result.summary } as Prisma.InputJsonValue,
        });
      } else {
        await updateStepStatus(step.id, "FAILED_RECOVERABLE", {
          completedAt: new Date(),
          error: result?.summary ?? "The approved change did not fully apply.",
        });
      }
      changed = true;
      continue;
    }

    if (action.status === "CANCELLED") {
      await updateStepStatus(step.id, "SKIPPED", {
        completedAt: new Date(),
        error: "The change was declined, so this step was skipped.",
      });
      changed = true;
      continue;
    }

    if (action.status === "SUPERSEDED") {
      await updateStepStatus(step.id, "FAILED_RECOVERABLE", {
        completedAt: new Date(),
        error: "The proposal was replaced by a newer one, so this step has to run again.",
      });
      changed = true;
      continue;
    }

    if (new Date(action.expiresAt).getTime() <= Date.now()) {
      await updateStepStatus(step.id, "FAILED_RECOVERABLE", {
        completedAt: new Date(),
        error: "The proposal expired before it was approved, so this step has to run again.",
      });
      changed = true;
      continue;
    }

    stillWaiting = true;
  }

  return { stillWaiting, changed };
}

/**
 * The mission's final status, derived from its steps.
 *
 * PARTIAL is the honest answer when a mission both succeeded and failed: some
 * steps are done and others are not, so neither COMPLETED nor FAILED describes
 * it. A mission where nothing succeeded is a failure; a mission where every
 * step succeeded (or was skipped because its dependency was) is complete.
 */
function computeMissionStatus(steps: MissionStepWithDetails[]): {
  status: MissionStatus;
  terminalError?: string;
} {
  const failed = steps.filter((s) => s.status === "FAILED_RECOVERABLE" || s.status === "FAILED_TERMINAL");
  const waiting = steps.filter((s) => s.status === "WAITING");
  const cancelled = steps.filter((s) => s.status === "CANCELLED");
  const completed = steps.filter((s) => s.status === "COMPLETED");
  const skipped = steps.filter((s) => s.status === "SKIPPED");

  if (waiting.length > 0) return { status: "WAITING" };

  if (failed.length > 0) {
    const anyTerminal = failed.some((s) => s.status === "FAILED_TERMINAL");
    if (completed.length > 0 || skipped.length > 0) {
      return {
        status: "PARTIAL",
        terminalError: `${failed.length} of ${steps.length} step(s) failed; the rest were applied.`,
      };
    }
    return {
      status: anyTerminal ? "FAILED_TERMINAL" : "FAILED_RECOVERABLE",
      terminalError: anyTerminal
        ? "One or more steps failed permanently"
        : "One or more steps failed and can be retried",
    };
  }

  if (cancelled.length > 0 && completed.length === 0 && skipped.length === 0) {
    return { status: "CANCELLED" };
  }

  return { status: "COMPLETED" };
}

/**
 * Missions currently being executed by this process.
 *
 * A mission is a long-running job, so two requests can ask for the same one at
 * the same time (the UI's Execute button, a retry, a resume). The persisted
 * status catches a worker on another instance; this set catches the one in
 * this process, which the status cannot see until it is written.
 */
const activeMissions = new Set<string>();

async function withMissionLock<T>(missionId: string, run: () => Promise<T>): Promise<T> {
  if (activeMissions.has(missionId)) {
    throw new ConflictError("This mission is already running");
  }
  activeMissions.add(missionId);
  try {
    return await run();
  } finally {
    activeMissions.delete(missionId);
  }
}

/**
 * Attach the proposal each mission is waiting on.
 *
 * The mission rows only carry the proposal's id; what the student has to
 * approve (title, the actions, the expiry) lives in `ai_pending_actions`. One
 * query for the whole page, so a list of twenty missions does not become
 * twenty queries.
 */
async function attachPendingActions(missions: MissionWithSteps[]): Promise<void> {
  const ids = [
    ...new Set(
      missions
        .flatMap((m) => m.steps.map((s) => s.pendingActionId))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (ids.length === 0) return;

  const rows = await prisma.aiPendingAction.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const mission of missions) {
    const waiting = mission.steps.find((s) => s.status === "WAITING" && s.pendingActionId);
    const id = waiting?.pendingActionId;
    if (!id) continue;
    const row = byId.get(id);
    if (!row) continue;
    const actions = (row.actions as unknown as ProposedAction[] | null) ?? [];
    mission.pendingAction = {
      id: row.id,
      title: row.title,
      status: row.status,
      actions: actions.map((a) => ({ tool: a.tool, description: a.description })),
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      result: (row.result as unknown as MissionPendingAction["result"]) ?? null,
    };
  }
}

/** What a step's tool call produced. */
type StepOutcome =
  | { kind: "completed"; result: Prisma.InputJsonValue }
  | { kind: "awaiting_approval"; pendingActionId: string; result: Prisma.InputJsonValue };

async function executeStepWithRetries(
  userId: string,
  conversationId: string | null,
  step: {
    id: string;
    missionId: string;
    toolName: string;
    description: string;
    arguments: Record<string, unknown>;
    maxAttempts: number;
    attempts: number;
  },
  currentStep: { id: string; attempts: number; maxAttempts: number; status: string },
  executionAutonomyMode: ExecutionAutonomyMode,
  signal?: AbortSignal,
): Promise<StepOutcome> {
  let stepError: string | null = null;

  for (let attempt = currentStep.attempts; attempt < currentStep.maxAttempts; attempt++) {
    if (signal?.aborted) break;

    await prisma.aiMissionStep.update({
      where: { id: step.id },
      data: {
        attempts: attempt + 1,
        // Derived from the mission and the step, so a retried step keeps the
        // same key: the write it performs is recognisable as the same one when
        // it is replayed.
        idempotencyKey: `${step.missionId}:${step.id}`,
      },
    });

    try {
      const toolResult = await executeTool(
        { name: step.toolName, arguments: step.arguments },
        { userId, conversationId: conversationId ?? "", approvedActions: null, executionAutonomyMode },
      );

      // A WRITE tool in manual mode is *refused*, and the refusal carries the
      // exact call the student was shown (`confirmation_required`). That is a
      // proposal, not a failure — the step waits for the student's approval.
      // This check has to come before the `!ok` branch: reading it the other
      // way round failed every write step terminally and threw the proposal
      // away, so a mission could never ask for approval.
      const proposed = toolResult.proposedActions ?? [];
      if (proposed.length > 0) {
        if (!conversationId) {
          throw new Error(
            "This step changes your data and needs your approval, but the mission has no conversation to ask in. Create it from a conversation so the change can be confirmed.",
          );
        }
        const pendingActionId = await parkStepProposal({
          userId,
          conversationId,
          title: step.description,
          actions: proposed,
        });
        return {
          kind: "awaiting_approval",
          pendingActionId,
          result: (toolResult.data ?? { awaitingApproval: true }) as Prisma.InputJsonValue,
        };
      }

      if (!toolResult.ok) {
        throw new Error(toolResult.error?.message ?? "Tool execution failed");
      }

      return {
        kind: "completed",
        result: (toolResult.data ?? { success: true }) as Prisma.InputJsonValue,
      };
    } catch (error) {
      stepError = error instanceof Error ? error.message : "Unknown error";

      if (isTransientError(error) && attempt < currentStep.maxAttempts - 1) {
        const backoff = calculateBackoff(attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      throw error;
    }
  }

  throw new Error(stepError ?? "Max retries exceeded");
}

export const missionService = {
  async createMission(userId: string, input: CreateMissionInput) {
    const { valid, errors } = validatePlan(input.steps);
    if (!valid) {
      throw new ValidationApiError("Invalid mission plan", ERROR_CODES.VALIDATION_ERROR, { details: errors.join("; ") });
    }

    const order = topologicalOrder(input.steps);
    if (order.length !== input.steps.length) {
      throw new ValidationApiError("Plan contains a dependency cycle");
    }

    if (input.conversationId) {
      const conversation = await prisma.aiConversation.findFirst({
        where: { id: input.conversationId, userId },
      });
      if (!conversation) throw new NotFoundError("Conversation not found");
    }

    // `dependsOn` arrives as step *indices* — the only thing a client can know
    // before the rows exist, and what `validatePlan` and `topologicalOrder`
    // above check cycles against. Execution (`getReadySteps`), retry and the
    // mission progress UI all resolve dependencies against the generated step
    // ids, so the indices are translated here, inside the same transaction that
    // creates the plan: stored missions then mean the same thing on every path.
    const mission = await prisma.$transaction(async (tx) => {
      const created = await tx.aiMission.create({
        data: {
          userId,
          conversationId: input.conversationId,
          objective: input.objective,
          contextSnapshot: (input.contextSnapshot ?? Prisma.DbNull) as Prisma.InputJsonValue,
          status: "QUEUED",
          steps: {
            create: input.steps.map((step, index) => ({
              stepOrder: index,
              toolName: step.toolName,
              description: step.description,
              arguments: step.arguments as Prisma.InputJsonValue,
              dependsOn: step.dependsOn ?? [],
              maxAttempts: step.maxAttempts ?? 3,
              status: "PENDING",
            })),
          },
        },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      });

      const idByIndex = new Map(created.steps.map((step, index) => [String(index), step.id]));
      for (let index = 0; index < created.steps.length; index++) {
        const deps = input.steps[index]?.dependsOn ?? [];
        if (deps.length === 0) continue;
        await tx.aiMissionStep.update({
          where: { id: created.steps[index].id },
          data: { dependsOn: deps.map((dep) => idByIndex.get(dep) ?? dep) },
        });
      }

      return tx.aiMission.findUnique({
        where: { id: created.id },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      });
    });
    if (!mission) throw new NotFoundError("Mission");

    return mapMission(mission as {
      id: string;
      userId: string;
      conversationId: string | null;
      objective: string;
      contextSnapshot: Prisma.JsonValue | null;
      status: string;
      createdAt: Date;
      updatedAt: Date;
      startedAt: Date | null;
      completedAt: Date | null;
      cancelledAt: Date | null;
      terminalError: string | null;
      steps: MissionStepRecord[];
    });
  },

  async listMissions(
    userId: string,
    query: { status?: MissionStatus; limit?: number; cursor?: string },
  ) {
    const { status, limit = 50, cursor } = query;
    const where: Prisma.AiMissionWhereInput = { userId };
    if (status) where.status = status;

    const records = await prisma.aiMission.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: { steps: { orderBy: { stepOrder: "asc" } } },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > limit;
    const items = records.slice(0, limit).map(mapMission);
    await attachPendingActions(items);

    return {
      items,
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  },

  async getMission(userId: string, id: string) {
    const mission = await prisma.aiMission.findFirst({
      where: { id, userId },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });
    if (!mission) throw new NotFoundError("Mission not found");
    const mapped = mapMission(mission);
    await attachPendingActions([mapped]);
    return mapped;
  },

  async cancelMission(userId: string, id: string) {
    const mission = await prisma.aiMission.findFirst({ where: { id, userId } });
    if (!mission) throw new NotFoundError("Mission not found");

    if (["COMPLETED", "CANCELLED", "FAILED_TERMINAL"].includes(mission.status)) {
      throw new ConflictError(`Cannot cancel mission in status ${mission.status}`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.aiMission.update({
        where: { id },
        data: { status: "CANCEL_REQUESTED", cancelledAt: new Date() },
      });

      await tx.aiMissionStep.updateMany({
        where: { missionId: id, status: { in: ["PENDING", "QUEUED", "RUNNING", "WAITING"] } },
        data: { status: "CANCELLED" },
      });
    });

    return this.getMission(userId, id);
  },

  async retryMission(userId: string, id: string) {
    const mission = await prisma.aiMission.findFirst({
      where: { id, userId },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });
    if (!mission) throw new NotFoundError("Mission not found");

    if (!["FAILED_RECOVERABLE", "FAILED_TERMINAL", "PARTIAL"].includes(mission.status)) {
      throw new ConflictError(`Cannot retry mission in status ${mission.status}`);
    }

    const failedSteps = mission.steps.filter(
      (s) => ["FAILED_RECOVERABLE", "FAILED_TERMINAL"].includes(s.status),
    );

    if (failedSteps.length === 0) {
      throw new ConflictError("No failed steps to retry");
    }

    await prisma.$transaction(async (tx) => {
      await tx.aiMission.update({
        where: { id },
        data: { status: "QUEUED", terminalError: null },
      });

      for (const step of failedSteps) {
        await tx.aiMissionStep.update({
          where: { id: step.id },
          data: {
            status: "PENDING",
            attempts: 0,
            error: null,
            result: Prisma.DbNull,
            verification: Prisma.DbNull,
            // The proposal this step was waiting on is spent (expired,
            // cancelled or superseded). Keeping the pointer would let the
            // reconcile mistake the old proposal for the new one, so the step
            // starts clean and parks a fresh proposal if it needs one.
            pendingActionId: null,
          },
        });
      }

      const dependentSteps = mission.steps.filter((s) =>
        s.dependsOn.some((depId) => failedSteps.some((fs) => fs.id === depId)),
      );
      for (const step of dependentSteps) {
        if (["COMPLETED", "SKIPPED"].includes(step.status)) {
          await tx.aiMissionStep.update({
            where: { id: step.id },
            data: {
              status: "PENDING",
              attempts: 0,
              result: Prisma.DbNull,
              error: null,
              verification: Prisma.DbNull,
              pendingActionId: null,
            },
          });
        }
      }
    });

    return this.getMission(userId, id);
  },

  async executeMission(missionId: string, signal?: AbortSignal): Promise<MissionWithSteps> {
    const mission = await prisma.aiMission.findUnique({
      where: { id: missionId },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });
    if (!mission) throw new NotFoundError("Mission not found");

    if (mission.status === "CANCEL_REQUESTED" || mission.status === "CANCELLED") {
      return mapMission(mission);
    }

    // One worker per mission. The lock covers this process; the persisted
    // status covers the other one (a second Render instance).
    return withMissionLock(missionId, async () => {
      // Re-read under the lock: another request may have moved the mission
      // between the read above and the lock being taken.
      const current = await prisma.aiMission.findUnique({
        where: { id: missionId },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      });
      if (!current) throw new NotFoundError("Mission not found");
      if (current.status === "CANCEL_REQUESTED" || current.status === "CANCELLED") {
        return mapMission(current);
      }

      if (current.status === "RUNNING") {
        const stale = Date.now() - current.updatedAt.getTime() > STALE_RUNNING_MS;
        if (!stale) {
          throw new ConflictError("This mission is already running");
        }
        // The worker that owned it is gone — a deploy, a crash, a closed
        // laptop. Take it over rather than leaving it stuck in RUNNING for
        // ever, where nothing would ever move it again.
        await updateMissionStatus(missionId, "QUEUED");
      }

      // A mission that stopped for approval picks up where it left off: the
      // proposal may have been approved (from the mission or from chat) since
      // the mission stopped.
      const reconciled = await reconcileWaitingSteps({
        id: missionId,
        userId: current.userId,
        steps: current.steps.map(mapStep),
      });
      if (reconciled.stillWaiting) {
        await updateMissionStatus(missionId, "WAITING");
        return this.getMission(current.userId, missionId);
      }

      // Read the user's execution autonomy mode from settings
      const settings = await settingsService.get(current.userId);
      const executionAutonomyMode: ExecutionAutonomyMode = (settings["ai.executionMode"] as ExecutionAutonomyMode) ?? "manual";

      await updateMissionStatus(missionId, "RUNNING", { startedAt: current.startedAt ?? new Date() });

      return this.executeMissionLoop(current, executionAutonomyMode, signal);
    });
  },

  /**
   * Approve the proposal a mission is waiting on, then carry the mission on.
   *
   * The claim is the same atomic conditional UPDATE the chat-side confirmation
   * uses, so the change can happen exactly once even when the student
   * double-clicks or two instances receive the request at the same time: the
   * second caller gets a 409 instead of running the write twice.
   */
  async approveMission(userId: string, missionId: string): Promise<MissionWithSteps> {
    const mission = await prisma.aiMission.findFirst({
      where: { id: missionId, userId },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });
    if (!mission) throw new NotFoundError("Mission not found");

    if (["COMPLETED", "CANCELLED", "FAILED_TERMINAL"].includes(mission.status)) {
      throw new ConflictError(`Cannot approve a mission in status ${mission.status}`);
    }
    if (!mission.conversationId) {
      throw new ConflictError("This mission has no conversation, so there is nothing to approve");
    }

    const waiting = mission.steps.find((s) => s.status === "WAITING" && s.pendingActionId);
    if (!waiting?.pendingActionId) {
      // Nothing is waiting any more. Reconcile first so the caller learns what
      // actually happened to the proposal instead of a bare conflict.
      await reconcileWaitingSteps({
        id: missionId,
        userId,
        steps: mission.steps.map(mapStep),
      });
      throw new ConflictError("This mission is not waiting for approval");
    }

    return withMissionLock(missionId, async () => {
      const conversationId = mission.conversationId as string;
      const proposal = await claimPendingAction(userId, conversationId, waiting.pendingActionId as string);
      if (!proposal) {
        throw new ConflictError("This proposal has already been applied, cancelled, or expired");
      }
      // Keep the local cache consistent with the row we just claimed, so a
      // later read cannot resurrect the PENDING copy.
      confirmationStore.consume(userId, conversationId, proposal.id);

      const executed = await executeProposalActions(
        proposal.actions,
        { userId, conversationId },
        executeTool,
      );

      const summary = summarizeOutcomes(executed);
      const result = {
        executed: executed.filter((e) => e.ok).length,
        verified: executed.filter((e) => e.ok && e.verified).length,
        failed: executed.filter((e) => !e.ok).length,
        summary,
      };
      confirmationStore.complete(proposal.id, result);
      await updatePersistedStatus(proposal.id, "EXECUTED", result);

      // PARTIAL, not EXECUTED, whenever any action failed *or* wrote something
      // we could not read back and match.
      const clean = executed.length > 0 && executed.every((e) => e.ok && e.verified);

      if (clean) {
        await updateStepStatus(waiting.id, "COMPLETED", {
          completedAt: new Date(),
          result: result as unknown as Prisma.InputJsonValue,
          verification: { summary } as Prisma.InputJsonValue,
        });
      } else {
        await updateStepStatus(waiting.id, "FAILED_RECOVERABLE", {
          completedAt: new Date(),
          error: summary,
        });
      }

      // Carry the mission on with the steps this approval unblocked.
      const settings = await settingsService.get(userId);
      const executionAutonomyMode: ExecutionAutonomyMode = (settings["ai.executionMode"] as ExecutionAutonomyMode) ?? "manual";

      const refreshed = await prisma.aiMission.findUnique({
        where: { id: missionId },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      });
      if (!refreshed) throw new NotFoundError("Mission not found");

      await updateMissionStatus(missionId, "RUNNING", { startedAt: refreshed.startedAt ?? new Date() });
      return this.executeMissionLoop(refreshed, executionAutonomyMode);
    });
  },

  /**
   * Continue every mission whose WAITING step points at a proposal that was
   * just decided outside the mission panel (chat confirm/cancel).
   *
   * The proposal row is authoritative, but the mission step, the mission status
   * and any dependent steps have to follow it. Resuming through the ordinary
   * executor keeps that path identical to an approval made from the mission.
   */
  async resumeMissionsWaitingOn(userId: string, actionId: string) {
    const missions = await prisma.aiMission.findMany({
      where: {
        userId,
        steps: { some: { pendingActionId: actionId, status: "WAITING" } },
      },
      select: { id: true },
    });

    for (const mission of missions) {
      await this.executeMission(mission.id);
    }
  },

  async executeMissionLoop(
    mission: { id: string; userId: string; conversationId: string | null },
    executionAutonomyMode: ExecutionAutonomyMode,
    signal?: AbortSignal,
  ): Promise<MissionWithSteps> {
    const missionId = mission.id;
    const userId = mission.userId;

    while (true) {
      if (signal?.aborted) {
        await updateMissionStatus(missionId, "CANCELLED", { cancelledAt: new Date() });
        break;
      }

      const readySteps = await getReadySteps(missionId);

      if (readySteps.length === 0) {
        const allSteps = await prisma.aiMissionStep.findMany({ where: { missionId } });

        // The mission is blocked on the student's approval. Reconcile first:
        // the proposal may have been decided since the mission stopped.
        const waitingSteps = allSteps.filter((s) => s.status === "WAITING");
        if (waitingSteps.length > 0) {
          const reconciled = await reconcileWaitingSteps({
            id: missionId,
            userId,
            steps: waitingSteps.map(mapStep),
          });
          if (reconciled.stillWaiting) {
            // Waiting for a human is not "work in progress". The old loop
            // slept and spun here for ever; the mission now stops and waits
            // for the approval that unblocks it.
            await updateMissionStatus(missionId, "WAITING");
            break;
          }
          // The proposal was decided — carry on with the steps it unblocked.
          continue;
        }

        // A step marked RUNNING with nobody running it means the worker died
        // mid-step. Report it instead of spinning.
        const hasRunning = allSteps.some((s) => s.status === "RUNNING" || s.status === "QUEUED");
        if (hasRunning) {
          await updateMissionStatus(missionId, "FAILED_RECOVERABLE", {
            completedAt: new Date(),
            terminalError: "The run was interrupted before every step finished. Retry to continue.",
          });
          break;
        }

        // A step that never ran because its dependency was skipped or failed
        // can never run now: mark it skipped rather than leaving it PENDING,
        // which would let the mission claim to be complete while a step never
        // happened.
        const orphaned = allSteps.filter((s) => s.status === "PENDING");
        for (const step of orphaned) {
          await updateStepStatus(step.id, "SKIPPED", {
            completedAt: new Date(),
            error: "A step this one depends on did not complete, so it was skipped.",
          });
        }

        const finalSteps = orphaned.length > 0
          ? await prisma.aiMissionStep.findMany({ where: { missionId } })
          : allSteps;
        const final = computeMissionStatus(finalSteps.map(mapStep));

        await updateMissionStatus(missionId, final.status, {
          completedAt: new Date(),
          terminalError: final.terminalError,
        });
        break;
      }

      await updateMissionStatus(missionId, "RUNNING");

      for (const step of readySteps) {
        if (signal?.aborted) {
          await updateMissionStatus(missionId, "CANCELLED", { cancelledAt: new Date() });
          break;
        }

        const currentStep = await prisma.aiMissionStep.findUnique({ where: { id: step.id } });
        if (!currentStep || ["CANCELLED", "COMPLETED"].includes(currentStep.status)) continue;

        await updateStepStatus(step.id, "RUNNING", { startedAt: new Date() });

        try {
          const outcome = await executeStepWithRetries(
            userId,
            mission.conversationId,
            { ...step, arguments: step.arguments as Record<string, unknown> },
            currentStep,
            executionAutonomyMode,
            signal,
          );

          if (signal?.aborted) break;

          if (outcome.kind === "awaiting_approval") {
            // The step produced a change the student has to approve. The
            // mission stops here and waits for them.
            await updateStepStatus(step.id, "WAITING", {
              pendingActionId: outcome.pendingActionId,
              result: outcome.result,
            });
            await updateMissionStatus(missionId, "WAITING");
            return this.getMission(userId, missionId);
          }

          await updateStepStatus(step.id, "COMPLETED", {
            completedAt: new Date(),
            result: outcome.result,
          });
        } catch (error) {
          const stepError = error instanceof Error ? error.message : "Unknown error";
          const isTerminal = !isTransientError(error);
          await updateStepStatus(step.id, isTerminal ? "FAILED_TERMINAL" : "FAILED_RECOVERABLE", {
            completedAt: new Date(),
            error: stepError,
          });
        }

        if (signal?.aborted) break;
      }
    }

    return this.getMission(userId, missionId);
  },

};
