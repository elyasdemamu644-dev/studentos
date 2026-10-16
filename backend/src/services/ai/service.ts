import { prisma } from "@/utils/prisma";
import type { Prisma } from "@prisma/client";
import { NotFoundError, ConflictError } from "@/config/errors";
import { AiProviderCancelledError, getAIProvider, AiProviderNotConfiguredError } from "./provider";
import { studentContextBuilder } from "./context";
import { runAgent, type ToolActivityEntry } from "./agent";
import { extractStructured } from "./structured";
import { confirmationStore, summarizeOutcomes, toPendingActionResponse } from "./confirmations";
import {
  loadPendingAction,
  persistPendingAction,
  supersedePersisted,
  updatePersistedStatus,
} from "./pending-action-repository";
import { executeProposalActions } from "./tools/confirm-tool";
import { executeTool } from "./tools/registry";
import type { ProposedAction } from "./tools/types";
import { getAiAttachmentContent } from "./attachments";
import { artifactsService, type AiArtifactDto } from "./artifacts";
import type {
  CreateConversationInput,
  CreateMessageInput,
  CreateStudyPlanInput,
  StructuredRequestInput,
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
      // id tiebreaker keeps cursor pagination stable when updatedAt ties.
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
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
    // One lookup for every attachment across the transcript, so a reloaded
    // conversation shows the same file chips it showed when the files were sent.
    const attachments = await loadAttachments(
      userId,
      messages.flatMap((message) => message.attachmentIds ?? []),
    );
    // Generated files are loaded once for the whole conversation and grouped by
    // the message they were attached to, so a reload shows them on the right
    // reply without a per-message query.
    const artifacts = await artifactsService.listForConversation(userId, conversationId);
    const artifactsByMessage = new Map<string, AiArtifactDto[]>();
    for (const artifact of artifacts) {
      if (!artifact.messageId) continue;
      const bucket = artifactsByMessage.get(artifact.messageId) ?? [];
      bucket.push(artifact);
      artifactsByMessage.set(artifact.messageId, bucket);
    }
    return messages.map((message) =>
      mapMessage(
        message,
        attachmentsFor(message.attachmentIds, attachments),
        artifactsByMessage.get(message.id) ?? [],
      ),
    );
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
  async addMessage(userId: string, conversationId: string, input: CreateMessageInput, signal?: AbortSignal) {
    await assertConversationOwnership(userId, conversationId);
    // Bring back a proposal parked before a restart, so the agent knows what the
    // student is still being asked to approve.
    await rehydratePending(userId, conversationId);

    const role = input.role ?? "USER";
    const wantsReply = input.generateReply ?? true;
    const attachmentIds = input.attachmentIds ?? [];

    const attachmentContent =
      attachmentIds.length > 0 && wantsReply && role === "USER"
        ? await getAiAttachmentContent(userId, attachmentIds)
        : { context: "", imageParts: [] };
    const attachmentContext = attachmentContent.context;

    if (wantsReply && role === "USER") {
      const provider = await getAIProvider(userId);
      if (!provider.isConfigured()) {
        throw new AiProviderNotConfiguredError();
      }

      // Assemble ground-truth context from the user's StudentOS data. It is
      // stored on the user message (as before), inlined into the prompt for
      // providers that have no native tool support, and handed to the agent as
      // a structured snapshot so the tool path also starts oriented.
      const studentContext = await studentContextBuilder.build(userId);
      // Include attachment content in the context snapshot
      const contextSnapshot = {
        studentContext,
        attachmentContext: attachmentContext || undefined,
      };
      const context = JSON.stringify(contextSnapshot);

      // Newest first: the window has to be the *latest* turns, and the ids are
      // needed to recognise a retry of a question that is still unanswered.
      const recent = await prisma.aiMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, role: true, content: true },
      });

      const student = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true },
      });

      // Persist the user message before invoking the provider. The question must
      // survive provider failures: when the provider is unreachable or returns
      // a non-2xx response, only the message row is stored (no reply), so the
      // client can reconcile its transcript and the student never loses their
      // input.
      //
      // A re-post of the exact question that is still waiting for an answer is
      // a *retry* of that stored row (the previous attempt persisted it, then
      // the provider failed), never a second copy of it.
      const unanswered = recent[0];
      const isRetry = Boolean(
        unanswered && unanswered.role === "USER" && unanswered.content === input.content,
      );

      const userMessage = isRetry
        ? await prisma.aiMessage.update({
            where: { id: unanswered!.id },
            data: { contextSnapshot: context },
          })
        : await prisma.aiMessage.create({
            data: {
              conversationId,
              userId,
              role: "USER",
              content: input.content,
              contextSnapshot: context,
              // Store the file ids so the transcript can render the attachments
              // again after a reload; the files themselves stay on `Resource`.
              attachmentIds,
            },
          });
      await touchConversation(conversationId);

      // Chronological order, newest window only: `runAgent` replays the last
      // few turns of what it is given, so handing it newest-first would replay
      // the oldest messages in the window. A retried question is dropped here
      // because it is the live turn, not history.
      const history = recent
        .filter((message) => !isRetry || message.id !== unanswered!.id)
        .reverse()
        .map((message) => ({ role: message.role, content: message.content }));

      const run = await runAgent({
        provider,
        userId,
        conversationId,
        history,
        userMessage: input.content,
        userMessageContent: attachmentContext || attachmentContent.imageParts.length > 0
          ? [
              {
                type: "text",
                text: [input.content, attachmentContext].filter(Boolean).join("\n\n"),
              },
              ...attachmentContent.imageParts,
            ]
          : input.content,
        studentName: student?.firstName ?? null,
        context: JSON.stringify({ studentContext }),
        studentContext,
        signal,
      });

      // A disconnect after the provider's final byte still must not turn a
      // cancelled turn into a completed assistant message or stored proposal.
      if (signal?.aborted) throw new AiProviderCancelledError();

      const pending = run.proposedActions.length
        ? await storeProposal(userId, conversationId, run)
        : confirmationStore.getPending(userId, conversationId);

      // Persist the assistant reply. A provider failure never reaches this
      // line, so a failed request cannot leave a fake assistant message behind.
      const assistantMessage = await prisma.aiMessage.create({
        data: { conversationId, userId, role: "ASSISTANT", content: run.content },
      });
      // A chat-side confirmation ("create it") runs the write tools inside this
      // same turn, so any file it generated is linked to the reply it produced.
      const replyArtifacts = await linkArtifacts(userId, run.createdArtifactIds, assistantMessage.id);
      await touchConversation(conversationId);

      const userAttachmentMap = await loadAttachments(userId, userMessage.attachmentIds ?? []);

      return {
        message: mapMessage(userMessage, attachmentsFor(userMessage.attachmentIds, userAttachmentMap)),
        reply: mapMessage(assistantMessage, [], replyArtifacts),
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
      data: { conversationId, userId, role, content: input.content, attachmentIds },
    });
    await touchConversation(conversationId);

    const storedAttachmentMap = await loadAttachments(userId, message.attachmentIds ?? []);

    return {
      message: mapMessage(message, attachmentsFor(message.attachmentIds, storedAttachmentMap)),
      reply: null,
      toolActivity: [] as ToolActivityEntry[],
      pendingAction: toPendingActionResponse(confirmationStore.getPending(userId, conversationId)),
      agent: null,
    };
  },

  // ── Structured extraction ───────────────────

  /**
   * Schema-validated AI extraction (`POST /ai/structured`).
   *
   * This is a pure read path: it invokes the grounded provider chat call and
   * returns only output that validated against the client-supplied schema. It
   * executes no tools and writes nothing, so there is never a pending proposal
   * to confirm.
   */
  async structured(userId: string, input: StructuredRequestInput) {
    return extractStructured({
      userId,
      prompt: input.prompt,
      schema: input.schema as unknown as Record<string, unknown>,
      ground: input.ground,
    });
  },

  // ── Pending action confirmations ───────────

  /** The proposal the student is currently being asked to approve, if any. */
  async getPendingAction(userId: string, conversationId: string) {
    await assertConversationOwnership(userId, conversationId);
    await rehydratePending(userId, conversationId);
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
    await rehydratePending(userId, conversationId);

    const existing = confirmationStore.get(userId, conversationId, actionId);
    if (!existing) throw new NotFoundError("Pending action not found");
    if (existing.status !== "PENDING") {
      throw new ConflictError("This action has already been applied");
    }

    const proposal = confirmationStore.consume(userId, conversationId, actionId);
    if (!proposal) throw new ConflictError("This action has already been applied");
    // Claim it durably before the writes, so a crash mid-apply cannot leave the
    // stored proposal PENDING and re-executable on restart.
    await updatePersistedStatus(proposal.id, "EXECUTED");

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

    // PARTIAL, not EXECUTED, whenever any step failed *or* wrote something we
    // could not read back and match.
    const clean = executed.length > 0 && executed.every((e) => e.ok && e.verified);

    // Create an assistant message summarizing the outcome
    const assistantMessage = await prisma.aiMessage.create({
      data: { conversationId, userId, role: "ASSISTANT", content: summary },
    });
    // Any file this confirmation generated belongs to the reply that reports it.
    const artifactIds = executed
      .filter((e) => e.tool === "create_artifact" && e.recordId)
      .map((e) => e.recordId as string);
    const replyArtifacts = await linkArtifacts(userId, artifactIds, assistantMessage.id);
    await touchConversation(conversationId);

    return {
      status: clean ? ("EXECUTED" as const) : ("PARTIAL" as const),
      summary,
      executed,
      reply: mapMessage(assistantMessage, [], replyArtifacts),
      artifacts: replyArtifacts,
      pendingAction: toPendingActionResponse(confirmationStore.get(userId, conversationId, actionId)),
    };
  },

  /** Drop a pending proposal. Idempotent: cancelling twice is not an error. */
  async cancelAction(userId: string, conversationId: string, actionId: string) {
    await assertConversationOwnership(userId, conversationId);
    await rehydratePending(userId, conversationId);

    const existing = confirmationStore.get(userId, conversationId, actionId);
    if (!existing) throw new NotFoundError("Pending action not found");

    const cancelled = confirmationStore.cancel(userId, conversationId, actionId);
    await updatePersistedStatus(actionId, "CANCELLED");
    return { pendingAction: toPendingActionResponse(cancelled) };
  },

  // ── Generated files (artifacts) ────────────

  /** Every file generated in a conversation, for a "Files" view. */
  async listArtifacts(userId: string, conversationId: string) {
    await assertConversationOwnership(userId, conversationId);
    return artifactsService.listForConversation(userId, conversationId);
  },

  async getArtifact(userId: string, id: string) {
    return artifactsService.get(userId, id);
  },

  /** Fetch a generated file's bytes for the owner. */
  async downloadArtifact(userId: string, id: string) {
    return artifactsService.getDownload(userId, id);
  },

  // ── Study plans ────────────────────────────

  async listStudyPlans(userId: string, query: { limit?: number; cursor?: string }) {
    const { limit = 50, cursor } = query;
    const records = await prisma.aiStudyPlan.findMany({
      where: { userId },
      include: { entries: { orderBy: { dayNumber: "asc" } } },
      // id tiebreaker keeps cursor pagination stable when createdAt ties.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

  /** Add one entry to a study plan. */
  async addEntry(userId: string, studyPlanId: string, input: { dayNumber: number; title: string; description?: string | null; durationMinutes: number; taskId?: string | null; courseId?: string | null }) {
    await assertStudyPlanOwnership(userId, studyPlanId);

    // Find the next free dayNumber that doesn't collide with existing entries.
    const existing = await prisma.aiStudyPlanEntry.findMany({
      where: { studyPlanId },
      select: { dayNumber: true },
    });
    const usedDays = new Set(existing.map((e) => e.dayNumber));
    let dayNumber = input.dayNumber;
    while (usedDays.has(dayNumber)) dayNumber += 1;

    const entry = await prisma.aiStudyPlanEntry.create({
      data: {
        studyPlanId,
        dayNumber,
        title: input.title,
        description: input.description,
        durationMinutes: input.durationMinutes,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.courseId ? { courseId: input.courseId } : {}),
      },
    });
    return mapStudyPlanEntry(entry);
  },

  /** Delete one entry from a study plan. */
  async deleteEntry(userId: string, studyPlanId: string, entryId: string) {
    await assertStudyPlanOwnership(userId, studyPlanId);

    const existing = await prisma.aiStudyPlanEntry.findFirst({
      where: { id: entryId, studyPlanId },
    });
    if (!existing) throw new NotFoundError("Study plan entry not found");

    await prisma.aiStudyPlanEntry.delete({ where: { id: entryId } });
    return { deleted: true };
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
async function storeProposal(
  userId: string,
  conversationId: string,
  run: { proposedActions: ProposedAction[]; toolActivity: ToolActivityEntry[] },
) {
  const firstProposal = run.proposedActions[0];
  const summary = run.toolActivity.find((a) => a.status === "proposed")?.summary;
  const title = firstProposal?.description?.slice(0, 120) ?? summary ?? "Proposed changes";

  const action = confirmationStore.create({
    userId,
    conversationId,
    title,
    actions: run.proposedActions,
  });

  // Mirror into `ai_pending_actions` so an approval survives a restart. The
  // in-memory map stays the live source of truth for this process; the row is
  // what another process (or the same one after a restart) rehydrates from.
  await supersedePersisted(userId, conversationId, action.id);
  await persistPendingAction(action);
  return action;
}

/**
 * Pull a durable proposal back into the in-memory store.
 *
 * Called before any read or decision so a proposal parked before a restart is
 * still visible and still confirmable. A proposal already in memory wins, so a
 * decision made in this process is never overwritten by the stored copy.
 */
async function rehydratePending(userId: string, conversationId: string): Promise<void> {
  if (confirmationStore.getPending(userId, conversationId)) return;
  const persisted = await loadPendingAction(userId, conversationId);
  if (persisted) confirmationStore.hydrate(persisted);
}

/**
 * Attach newly generated files to the assistant message that reports them and
 * return the linked artifacts, in one step. A no-op when nothing was generated.
 */
async function linkArtifacts(userId: string, artifactIds: string[], messageId: string): Promise<AiArtifactDto[]> {
  if (artifactIds.length === 0) return [];
  await artifactsService.linkToMessage(userId, artifactIds, messageId);
  return artifactsService.listForMessage(userId, messageId);
}

/** One sentence describing what applying a proposal actually did. */
async function assertConversationOwnership(userId: string, conversationId: string): Promise<void> {
  const conversation = await prisma.aiConversation.findFirst({
    where: { id: conversationId, userId },
  });
  if (!conversation) throw new NotFoundError("Conversation not found");
}

/**
 * Bump the conversation's recency when a message lands on it.
 *
 * Prisma does not touch a parent row when a child is created, and the history
 * sidebar is ordered and date-grouped by `updatedAt` — without this a
 * conversation the student is actively writing in never moves back to the top.
 */
async function touchConversation(conversationId: string): Promise<void> {
  await prisma.aiConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
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

/** Wire shape of one attachment on a stored message. */
interface AttachmentDto {
  id: string;
  resourceId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  resourceType: string;
}

/**
 * Resolve stored attachment ids to their resource metadata, owner-scoped.
 *
 * The message row only keeps ids; the file itself lives on a `Resource`. One
 * query for the whole page and a map lookup per message keeps a transcript with
 * many attachments from paying an N+1. Ids the student cannot read (another
 * account's file, or a deleted resource) simply do not resolve and are dropped.
 */
async function loadAttachments(userId: string, ids: string[]): Promise<Map<string, AttachmentDto>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, AttachmentDto>();
  if (unique.length === 0) return map;

  const resources = await prisma.resource.findMany({
    where: { userId, id: { in: unique } },
    select: {
      id: true,
      fileName: true,
      title: true,
      mimeType: true,
      fileSize: true,
      resourceType: true,
    },
  });

  for (const resource of resources) {
    map.set(resource.id, {
      id: resource.id,
      resourceId: resource.id,
      fileName: resource.fileName ?? resource.title ?? "file",
      mimeType: resource.mimeType ?? "application/octet-stream",
      fileSize: resource.fileSize ?? 0,
      resourceType: resource.resourceType,
    });
  }
  return map;
}

/** The resolved attachments for one message, in the order they were attached. */
function attachmentsFor(
  ids: string[] | null | undefined,
  map: Map<string, AttachmentDto>,
): AttachmentDto[] {
  if (!ids || ids.length === 0) return [];
  return ids
    .map((id) => map.get(id))
    .filter((attachment): attachment is AttachmentDto => Boolean(attachment));
}

function mapMessage(
  record: {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    contextSnapshot: string | null;
    createdAt: Date;
    attachmentIds?: string[] | null;
  },
  attachments: AttachmentDto[] = [],
  artifacts: AiArtifactDto[] = [],
) {
  return {
    id: record.id,
    conversationId: record.conversationId,
    role: record.role,
    content: record.content,
    contextSnapshot: record.contextSnapshot ?? null,
    createdAt: record.createdAt.toISOString(),
    attachments,
    artifacts,
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
