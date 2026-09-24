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