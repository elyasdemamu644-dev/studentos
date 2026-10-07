import { prisma } from "@/utils/prisma";
import type { Prisma } from "@prisma/client";
import { NotFoundError, ConflictError } from "@/config/errors";
import { getAIProvider, AiProviderNotConfiguredError } from "./provider";
import { studentContextBuilder } from "./context";
import { runAgent, type ToolActivityEntry } from "./agent";
import { confirmationStore, summarizeOutcomes, toPendingActionResponse } from "./confirmations";
import { executeProposalActions } from "./tools/confirm-tool";
import { executeTool } from "./tools/registry";
import type { ProposedAction } from "./tools/types";
import type {
  CreateConversationInput,
  CreateMessageInput,
  CreateStudyPlanInput,
  UpdateConversationInput,
  UpdateStudyPlanInput,
  UpdateStudyPlanEntryInput,
} from "../../schemas/ai";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────
//
// Conversations, messages and study plans are fully database-backed and
// ownership-scoped. AI generation is optional: when no provider is
// configured, the `generateReply` flag yields a controlled 503 error rather
// than pretending the AI answered.

export const aiService = {
  // ── Conversations ──────────────────────────

  async listConversations(
    userId: string,
    query: { type?: "CHAT" | "TUTOR" | "QUIZ" | "STUDY_PLAN" | "EXPLAIN"; limit?: number; cursor?: string },
  ) {
    const { type, limit = 50, cursor } = query;

    const where: Prisma.AiConversationWhereInput = { userId };
    if (type) where.type = type;
    const records = await prisma.aiConversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit + 1,
      // One extra field per row: the newest message, so a chat list can show a
      // real preview without an N+1 fetch of every conversation's history.
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map(mapConversation),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  },

  async getConversation(userId: string, id: string) {
    const conversation = await prisma.aiConversation.findFirst({ where: { id, userId } });
    if (!conversation) throw new NotFoundError("Conversation not found");
    return mapConversation(conversation);
  },

  async createConversation(userId: string, input: CreateConversationInput) {
    const conversation = await prisma.aiConversation.create({
      data: {
        userId,
        title: input.title ?? "New conversation",
        type: input.type ?? "CHAT",
      },
    });
    return mapConversation(conversation);
  },

  /**
   * Rename a conversation.
   *
   * The client sends the title it derived from the first user message, which
   * means the row can already have changed underneath a stale read, so an
   * untouched field is left alone rather than written back.
   */
  async updateConversation(userId: string, id: string, input: UpdateConversationInput) {
    await assertConversationOwnership(userId, id);

    const conversation = await prisma.aiConversation.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
      },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return mapConversation(conversation);
  },

  async deleteConversation(userId: string, id: string) {
    const existing = await prisma.aiConversation.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Conversation not found");

    await prisma.aiConversation.delete({ where: { id } });
    return { deleted: true };
  },

  // ── Messages ───────────────────────────────

  async listMessages(userId: string, conversationId: string) {
    await assertConversationOwnership(userId, conversationId);

    const messages = await prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
    return messages.map(mapMessage);
  },

  /**
   * Add a message to a conversation and, for user messages, run the AI agent.
   *
   * The agent loop (`runAgent`) may call read/analysis tools and — only with the
   * student's approval — write tools. Its outcome is reported alongside the
   * reply: what it did (`toolActivity`), what it wants approved (`pendingAction`)
   * and whether the run used tools at all.
   *
   * `generateReply: false` keeps the store-only behaviour for callers that only
   * want to persist a message.
   */
  async addMessage(userId: string, conversationId: string, input: CreateMessageInput) {
    await assertConversationOwnership(userId, conversationId);

    const role = input.role ?? "USER";
    const wantsReply = input.generateReply ?? true;

    if (wantsReply && role === "USER") {
      const provider = await getAIProvider(userId);
      if (!provider.isConfigured()) {
        throw new AiProviderNotConfiguredError();
      }

      // Assemble ground-truth context from the user's StudentOS data. It is
      // stored on the user message (as before) and inlined into the prompt for
      // providers that have no native tool support.
      const context = await studentContextBuilder.toPrompt(userId);

      const history = await prisma.aiMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        take: 30,
        select: { role: true, content: true },
      });

      const student = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true },
      });

      const run = await runAgent({
        provider,
        userId,
        conversationId,
        history,
        userMessage: input.content,
        studentName: student?.firstName ?? null,
        context,
      });

      // A write was requested but not approved: park the exact calls so the
      // student can approve them with one click or one "create it".
      const pending = run.proposedActions.length
        ? storeProposal(userId, conversationId, run)
        : confirmationStore.getPending(userId, conversationId);

      // Persist user message + assistant reply in a transaction.
      const [userMessage, assistantMessage] = await prisma.$transaction([
        prisma.aiMessage.create({
          data: { conversationId, userId, role: "USER", content: input.content, contextSnapshot: context },
        }),
        prisma.aiMessage.create({
          data: { conversationId, userId, role: "ASSISTANT", content: run.content },
        }),
      ]);

      return {
        message: mapMessage(userMessage),
        reply: mapMessage(assistantMessage),
        toolActivity: run.toolActivity,
        pendingAction: toPendingActionResponse(pending),
        agent: {
          provider: provider.providerName,
          model: provider.model,
          usedTools: run.usedTools,
          toolSupport: run.finish !== "no_tool_support",
          finish: run.finish,
          rounds: run.rounds,
        },
      };
    }

    // Store-only path (no provider call).
    const message = await prisma.aiMessage.create({
      data: { conversationId, userId, role, content: input.content },
    });

    return {
      message: mapMessage(message),
      reply: null,
      toolActivity: [] as ToolActivityEntry[],
      pendingAction: toPendingActionResponse(confirmationStore.getPending(userId, conversationId)),
      agent: null,
    };
  },

  // ── Pending action confirmations ───────────

  /** The proposal the student is currently being asked to approve, if any. */
  async getPendingAction(userId: string, conversationId: string) {
    await assertConversationOwnership(userId, conversationId);
    return toPendingActionResponse(confirmationStore.getPending(userId, conversationId));
  },

  /**
   * Apply a pending proposal. This is the REST twin of the chat-side
   * `confirm_pending_actions` tool and runs the same code path, so a button
   * click and a typed "create it" cannot drift apart.
   *
   * `consume` is atomic, so a double-click executes once. Re-confirming an
   * already-applied proposal is a controlled 409 rather than a duplicate write.
   */
  async confirmAction(userId: string, conversationId: string, actionId: string) {
    await assertConversationOwnership(userId, conversationId);

    const existing = confirmationStore.get(userId, conversationId, actionId);
    if (!existing) throw new NotFoundError("Pending action not found");
    if (existing.status !== "PENDING") {
      throw new ConflictError("This action has already been applied");
    }

    const proposal = confirmationStore.consume(userId, conversationId, actionId);
    if (!proposal) throw new ConflictError("This action has already been applied");

    const executed = await executeProposalActions(
      proposal.actions,
      { userId, conversationId },
      executeTool,
    );

    const summary = summarizeOutcomes(executed);
    confirmationStore.complete(proposal.id, {
      executed: executed.filter((e) => e.ok).length,
      verified: executed.filter((e) => e.ok && e.verified).length,
      failed: executed.filter((e) => !e.ok).length,
      summary,
    });

    // PARTIAL, not EXECUTED, whenever any step failed *or* wrote something we
    // could not read back and match.
    const clean = executed.length > 0 && executed.every((e) => e.ok && e.verified);

    return {
      status: clean ? ("EXECUTED" as const) : ("PARTIAL" as const),
      summary,
      executed,
      pendingAction: toPendingActionResponse(confirmationStore.get(userId, conversationId, actionId)),
    };
  },

  /** Drop a pending proposal. Idempotent: cancelling twice is not an error. */
  async cancelAction(userId: string, conversationId: string, actionId: string) {
    await assertConversationOwnership(userId, conversationId);

    const existing = confirmationStore.get(userId, conversationId, actionId);
    if (!existing) throw new NotFoundError("Pending action not found");

    const cancelled = confirmationStore.cancel(userId, conversationId, actionId);
    return { pendingAction: toPendingActionResponse(cancelled) };
  },

  // ── Study plans ────────────────────────────

  async listStudyPlans(userId: string, query: { limit?: number; cursor?: string }) {
    const { limit = 50, cursor } = query;
    const records = await prisma.aiStudyPlan.findMany({
      where: { userId },
      include: { entries: { orderBy: { dayNumber: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map(mapStudyPlan),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  },

  async getStudyPlan(userId: string, id: string) {
    const plan = await prisma.aiStudyPlan.findFirst({
      where: { id, userId },
      include: { entries: { orderBy: { dayNumber: "asc" } } },
    });
    if (!plan) throw new NotFoundError("Study plan not found");
    return mapStudyPlan(plan);
  },

  async createStudyPlan(userId: string, input: CreateStudyPlanInput) {
    if (input.courseId) {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, userId },
      });
      if (!course) throw new NotFoundError("Course not found");
    }

    const plan = await prisma.aiStudyPlan.create({
      data: {
        userId,
        title: input.title,
        examDate: input.examDate ? new Date(input.examDate) : null,
        courseId: input.courseId ?? null,
        entries: input.entries
          ? {
              create: input.entries.map((entry) => ({
                dayNumber: entry.dayNumber,
                title: entry.title,
                description: entry.description ?? null,
                durationMinutes: entry.durationMinutes,
              })),
            }
          : undefined,
      },
      include: { entries: { orderBy: { dayNumber: "asc" } } },
    });

    return mapStudyPlan(plan);
  },

  async updateStudyPlan(userId: string, id: string, input: UpdateStudyPlanInput) {
    const existing = await prisma.aiStudyPlan.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Study plan not found");

    if (input.courseId !== undefined && input.courseId !== existing.courseId) {
      if (input.courseId) {
        const course = await prisma.course.findFirst({
          where: { id: input.courseId, userId },
        });
        if (!course) throw new NotFoundError("Course not found");
      }
    }

    const plan = await prisma.aiStudyPlan.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.examDate !== undefined && {
          examDate: input.examDate ? new Date(input.examDate) : null,
        }),
        ...(input.courseId !== undefined && { courseId: input.courseId ?? null }),
      },
      include: { entries: { orderBy: { dayNumber: "asc" } } },
    });

    return mapStudyPlan(plan);
  },

  async deleteStudyPlan(userId: string, id: string) {
    const existing = await prisma.aiStudyPlan.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Study plan not found");

    await prisma.aiStudyPlan.delete({ where: { id } });
    return { deleted: true };
  },

  // ── Study plan entries ─────────────────────

  async listStudyPlanEntries(userId: string, studyPlanId: string) {
    await assertStudyPlanOwnership(userId, studyPlanId);

    const entries = await prisma.aiStudyPlanEntry.findMany({
      where: { studyPlanId },
      orderBy: { dayNumber: "asc" },
    });
    return entries.map(mapStudyPlanEntry);
  },

  /** Update a single study-plan entry (e.g. mark complete). */
  async updateStudyPlanEntry(
    userId: string,
    studyPlanId: string,
    entryId: string,
    input: UpdateStudyPlanEntryInput,
  ) {
    await assertStudyPlanOwnership(userId, studyPlanId);

    const existing = await prisma.aiStudyPlanEntry.findFirst({
      where: { id: entryId, studyPlanId },
    });
    if (!existing) throw new NotFoundError("Study plan entry not found");

    const entry = await prisma.aiStudyPlanEntry.update({
      where: { id: entryId },
      data: {
        ...(input.dayNumber !== undefined && { dayNumber: input.dayNumber }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.durationMinutes !== undefined && { durationMinutes: input.durationMinutes }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });
    return mapStudyPlanEntry(entry);
  },
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Park the actions a run wants to perform and give the confirmation card a
 * title. The title comes from the tool's own summary when it has one (a study
 * plan names its course), so the student sees a specific headline rather than
 * "3 changes".
 */
function storeProposal(
  userId: string,
  conversationId: string,
  run: { proposedActions: ProposedAction[]; toolActivity: ToolActivityEntry[] },
) {
  const firstProposal = run.proposedActions[0];
  const summary = run.toolActivity.find((a) => a.status === "proposed")?.summary;
  const title = firstProposal?.description?.slice(0, 120) ?? summary ?? "Proposed changes";

  return confirmationStore.create({
    userId,
    conversationId,
    title,
    actions: run.proposedActions,
  });
}

/** One sentence describing what applying a proposal actually did. */
async function assertConversationOwnership(userId: string, conversationId: string): Promise<void> {
  const conversation = await prisma.aiConversation.findFirst({
    where: { id: conversationId, userId },
  });
  if (!conversation) throw new NotFoundError("Conversation not found");
}

async function assertStudyPlanOwnership(userId: string, studyPlanId: string): Promise<void> {
  const plan = await prisma.aiStudyPlan.findFirst({
    where: { id: studyPlanId, userId },
  });
  if (!plan) throw new NotFoundError("Study plan not found");
}

// ─────────────────────────────────────────────
// Mappers
// ─────────────────────────────────────────────

function mapConversation(record: {
  id: string;
  title: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
  messages?: Array<{ content: string; role: string; createdAt: Date }>;
}) {
  const latest = record.messages?.[0] ?? null;
  return {
    id: record.id,
    title: record.title,
    type: record.type,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    // Newest message, trimmed by the client for display. Null for a
    // conversation that has never been written to.
    preview: latest ? { content: latest.content, role: latest.role, createdAt: latest.createdAt.toISOString() } : null,
  };
}

function mapMessage(record: {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  contextSnapshot: string | null;
  createdAt: Date;
}) {
  return {
    id: record.id,
    conversationId: record.conversationId,
    role: record.role,
    content: record.content,
    contextSnapshot: record.contextSnapshot ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

function mapStudyPlan(record: {
  id: string;
  title: string;
  examDate: Date | null;
  courseId: string | null;
  createdAt: Date;
  updatedAt: Date;
  entries: Array<{
    id: string;
    dayNumber: number;
    title: string;
    description: string | null;
    durationMinutes: number;
    status: string;
    taskId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    id: record.id,
    title: record.title,
    examDate: record.examDate ? record.examDate.toISOString() : null,
    courseId: record.courseId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    entries: record.entries.map(mapStudyPlanEntry),
  };
}

function mapStudyPlanEntry(record: {
  id: string;
  dayNumber: number;
  title: string;
  description: string | null;
  durationMinutes: number;
  status: string;
  taskId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    dayNumber: record.dayNumber,
    title: record.title,
    description: record.description,
    durationMinutes: record.durationMinutes,
    status: record.status,
    taskId: record.taskId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}