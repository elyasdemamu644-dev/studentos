import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { NotFoundError } from "@/config/errors";
import { getAIProvider, AiProviderNotConfiguredError } from "./provider";
import { studentContextBuilder } from "./context";
import type {
  CreateConversationInput,
  CreateMessageInput,
  CreateStudyPlanInput,
  UpdateStudyPlanInput,
  UpdateStudyPlanEntryInput,
} from "./schema";

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
   * Add a message to a conversation.
   *
   * When `generateReply` is true and the message role is USER, the message is
   * stored, the Student context is assembled, and the AI provider is asked to
   * reply. The assistant reply is stored too. If no provider is configured a
   * controlled 503 error is returned and no message is persisted.
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

      // Assemble ground-truth context from the user's StudentOS data.
      const context = await studentContextBuilder.toPrompt(userId);

      const history = await prisma.aiMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        take: 30,
        select: { role: true, content: true },
      });
      const providerMessages: Array<{ role: "user" | "assistant"; content: string }> = history.map((m) => ({
        role: m.role === "ASSISTANT" ? "assistant" : "user",
        content: m.content,
      }));
      providerMessages.push({ role: "user", content: input.content });

      const result = await provider.chat({ messages: providerMessages, context });

      // Persist user message + assistant reply in a transaction.
      const [userMessage, assistantMessage] = await prisma.$transaction([
        prisma.aiMessage.create({
          data: { conversationId, userId, role: "USER", content: input.content, contextSnapshot: context },
        }),
        prisma.aiMessage.create({
          data: { conversationId, userId, role: "ASSISTANT", content: result.content },
        }),
      ]);

      return { message: mapMessage(userMessage), reply: mapMessage(assistantMessage) };
    }

    // Store-only path (no provider call).
    const message = await prisma.aiMessage.create({
      data: { conversationId, userId, role, content: input.content },
    });

    return { message: mapMessage(message), reply: null };
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
}) {
  return {
    id: record.id,
    title: record.title,
    type: record.type,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
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