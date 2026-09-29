import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/config/errors";
import type { Prisma } from "@prisma/client";
import type { NotificationListQuery } from "./schema";
import type { UpdateNotificationInput } from "./schema";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────
//
// Notifications are system-generated (no create endpoint). This phase only
// implements IN_APP delivery — PUSH/EMAIL/SMS/TELEGRAM records may exist in
// the schema but external delivery is not implemented.
//
// Generation (`generateForUser`) is the foundation that makes the module
// useful without a background worker: it derives reminders from the user's
// real academic data. It is idempotent — at most one notification exists per
// (type, relatedType, relatedId) triple — so it can be called on every app
// load without spamming the user.

/** Lookahead windows for the reminder sweep. */
export const REMINDER_WINDOWS = {
  /** Tasks due within this window get an ASSIGNMENT_DUE reminder. */
  taskDueHours: 72,
  /** Tasks already past due get an OVERDUE_TASK alert. */
  overdueAfterHours: -72,
  /** Exams starting within this window get an EXAM_REMINDER. */
  examDays: 14,
  /** Goals with a deadline inside this window get a GOAL_REMINDER. */
  goalDeadlineDays: 7,
} as const;

type GeneratedKind =
  | "ASSIGNMENT_DUE"
  | "OVERDUE_TASK"
  | "EXAM_REMINDER"
  | "GOAL_REMINDER";

interface Candidate {
  type: GeneratedKind;
  title: string;
  message: string;
  relatedType: string;
  relatedId: string;
  /** Sort weight so the newest/most urgent land first. */
  sortAt: Date;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function humanDue(due: Date, now: Date): string {
  const diffMs = due.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const days = Math.round(abs / DAY_MS);
  const hours = Math.round(abs / HOUR_MS);
  let phrase: string;
  if (days >= 1) phrase = `${days} day${days === 1 ? "" : "s"}`;
  else if (hours >= 1) phrase = `${hours} hour${hours === 1 ? "" : "s"}`;
  else phrase = "less than an hour";
  return diffMs < 0 ? `${phrase} overdue` : `due in ${phrase}`;
}

function humanCountdown(startAt: Date, now: Date): string {
  const diffMs = startAt.getTime() - now.getTime();
  if (diffMs <= 0) return "starting now";
  const days = Math.floor(diffMs / DAY_MS);
  const hours = Math.floor((diffMs % DAY_MS) / HOUR_MS);
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return "in less than an hour";
}

function humanDeadline(deadline: Date, now: Date): string {
  const diffMs = deadline.getTime() - now.getTime();
  if (diffMs <= 0) return "past its deadline";
  const days = Math.ceil(diffMs / DAY_MS);
  if (days >= 1) return `due in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.round(diffMs / HOUR_MS));
  return `due in ${hours} hour${hours === 1 ? "" : "s"}`;
}

export const notificationsService = {
  /** List the user's notifications, newest first, with an unread count. */
  async list(userId: string, query: NotificationListQuery) {
    const { status, type, unread, limit = 50, cursor } = query;

    const where: Prisma.NotificationWhereInput = { userId };
    if (status) where.status = status;
    if (type) where.type = type;
    if (unread !== undefined) {
      where.status = unread ? "UNREAD" : { not: "UNREAD" };
    }

    const [records, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      prisma.notification.count({ where: { userId, status: "UNREAD" } }),
    ]);

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map(mapNotification),
      unreadCount,
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  },

  /** Get a single notification by id (must belong to the user). */
  async getById(userId: string, id: string) {
    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!notification) throw new NotFoundError("Notification not found");
    return mapNotification(notification);
  },

  /** Partially update a notification (e.g. status/readAt). */
  async update(userId: string, id: string, input: UpdateNotificationInput) {
    const existing = await prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundError("Notification not found");

    const nextStatus = input.status ?? existing.status;
    const readAt =
      input.readAt !== undefined && input.readAt !== null
        ? new Date(input.readAt)
        : nextStatus === "READ"
          ? (existing.readAt ?? new Date())
          : nextStatus === "UNREAD"
            ? null
            : existing.readAt;

    const notification = await prisma.notification.update({
      where: { id },
      data: {
        ...(input.status !== undefined && { status: input.status }),
        readAt,
      },
    });
    return mapNotification(notification);
  },

  /** Mark a single notification as READ. */
  async markRead(userId: string, id: string) {
    const existing = await prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundError("Notification not found");

    const notification = await prisma.notification.update({
      where: { id },
      data: { status: "READ", readAt: existing.readAt ?? new Date() },
    });
    return mapNotification(notification);
  },

  /** Mark all of the user's unread notifications as READ. */
  async readAll(userId: string) {
    const result = await prisma.notification.updateMany({
      where: { userId, status: "UNREAD" },
      data: { status: "READ", readAt: new Date() },
    });
    return { updated: result.count };
  },

  /**
   * Derive reminder notifications from the user's live academic data.
   *
   * Idempotent: a candidate is skipped when a notification already exists for
   * the same (type, relatedType, relatedId). Safe to call on every load.
   */
  async generateForUser(userId: string, now = new Date()) {
    const windowStart = new Date(
      now.getTime() + REMINDER_WINDOWS.overdueAfterHours * HOUR_MS,
    );
    const dueWindowEnd = new Date(
      now.getTime() + REMINDER_WINDOWS.taskDueHours * HOUR_MS,
    );
    const examWindowEnd = new Date(
      now.getTime() + REMINDER_WINDOWS.examDays * DAY_MS,
    );
    const goalWindowEnd = new Date(
      now.getTime() + REMINDER_WINDOWS.goalDeadlineDays * DAY_MS,
    );

    const [tasks, exams, goals] = await Promise.all([
      prisma.task.findMany({
        where: {
          userId,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
          dueDate: { gte: windowStart, lte: dueWindowEnd },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          type: true,
          course: { select: { name: true } },
        },
      }),
      prisma.event.findMany({
        where: {
          userId,
          type: "EXAM",
          startAt: { gte: now, lte: examWindowEnd },
        },
        select: {
          id: true,
          title: true,
          startAt: true,
          location: true,
          course: { select: { name: true } },
        },
      }),
      prisma.goal.findMany({
        where: {
          userId,
          status: "ACTIVE",
          deadline: { gte: now, lte: goalWindowEnd },
        },
        select: { id: true, title: true, deadline: true, progress: true },
      }),
    ]);

    const candidates: Candidate[] = [];

    for (const task of tasks) {
      if (!task.dueDate) continue;
      const overdue = task.dueDate.getTime() < now.getTime();
      const courseName = task.course?.name;
      const where = courseName ? ` (${courseName})` : "";
      candidates.push({
        type: overdue ? "OVERDUE_TASK" : "ASSIGNMENT_DUE",
        title: overdue ? "Task overdue" : "Task due soon",
        message: `"${task.title}"${where} is ${humanDue(task.dueDate, now)}.`,
        relatedType: "TASK",
        relatedId: task.id,
        sortAt: task.dueDate,
      });
    }

    for (const exam of exams) {
      const courseName = exam.course?.name;
      const bits = [humanCountdown(exam.startAt, now)];
      if (courseName) bits.push(courseName);
      if (exam.location) bits.push(exam.location);
      candidates.push({
        type: "EXAM_REMINDER",
        title: "Exam coming up",
        message: `"${exam.title}" — ${bits.join(" · ")}.`,
        relatedType: "EVENT",
        relatedId: exam.id,
        sortAt: exam.startAt,
      });
    }

    for (const goal of goals) {
      if (!goal.deadline) continue;
      candidates.push({
        type: "GOAL_REMINDER",
        title: "Goal deadline approaching",
        message: `"${goal.title}" is ${humanDeadline(goal.deadline, now)} and is ${goal.progress}% complete.`,
        relatedType: "GOAL",
        relatedId: goal.id,
        sortAt: goal.deadline,
      });
    }

    if (candidates.length === 0) {
      const unreadCount = await prisma.notification.count({
        where: { userId, status: "UNREAD" },
      });
      return { created: 0, scanned: 0, unreadCount };
    }

    // One round-trip to learn which candidates already have a notification.
    const existing = await prisma.notification.findMany({
      where: {
        userId,
        OR: candidates.map((c) => ({
          type: c.type,
          relatedType: c.relatedType,
          relatedId: c.relatedId,
        })),
      },
      select: { type: true, relatedType: true, relatedId: true },
    });
    const seen = new Set(
      existing.map((n) => `${n.type}:${n.relatedType}:${n.relatedId}`),
    );

    const fresh = candidates.filter(
      (c) => !seen.has(`${c.type}:${c.relatedType}:${c.relatedId}`),
    );

    let created = 0;
    if (fresh.length > 0) {
      // createMany shares one timestamp for every row, so sort explicitly to
      // keep the list ordering stable regardless of insertion order.
      fresh.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());
      const result = await prisma.notification.createMany({
        data: fresh.map((c) => ({
          userId,
          title: c.title,
          message: c.message,
          type: c.type,
          delivery: "IN_APP" as const,
          status: "UNREAD" as const,
          relatedType: c.relatedType,
          relatedId: c.relatedId,
          createdAt: now,
        })),
      });
      created = result.count;
    }

    const unreadCount = await prisma.notification.count({
      where: { userId, status: "UNREAD" },
    });

    return { created, scanned: candidates.length, unreadCount };
  },
};

// ─────────────────────────────────────────────
// Mapper
// ─────────────────────────────────────────────

function mapNotification(record: {
  id: string;
  title: string;
  message: string;
  type: string;
  delivery: string;
  channel: string | null;
  status: string;
  readAt: Date | null;
  relatedType: string | null;
  relatedId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    title: record.title,
    message: record.message,
    type: record.type,
    delivery: record.delivery,
    channel: record.channel,
    status: record.status,
    readAt: record.readAt ? record.readAt.toISOString() : null,
    relatedType: record.relatedType,
    relatedId: record.relatedId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
