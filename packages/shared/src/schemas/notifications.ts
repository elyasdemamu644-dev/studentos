import { z } from "zod";
import { idSchema } from "./academics";

// ─────────────────────────────────────────────
// NOTIFICATION
// ─────────────────────────────────────────────

export const notificationTypeSchema = z.enum([
  "ASSIGNMENT_DUE",
  "EXAM_REMINDER",
  "OVERDUE_TASK",
  "STUDY_REMINDER",
  "STUDY_PLAN_REMINDER",
  "GOAL_REMINDER",
  "GENERAL",
]);

export const notificationDeliverySchema = z.enum(["IN_APP", "PUSH", "EMAIL", "SMS", "TELEGRAM"]);

export const notificationStatusSchema = z.enum(["UNREAD", "READ", "ARCHIVED"]);

export const notificationSchema = z.object({
  id: idSchema,
  userId: idSchema,
  title: z.string().trim(),
  message: z.string(),
  type: notificationTypeSchema,
  delivery: notificationDeliverySchema,
  channel: z.string().nullable(),
  status: notificationStatusSchema,
  readAt: z.coerce.date().nullable(),
  relatedType: z.string().nullable(),
  relatedId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createNotificationSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  message: z.string().min(1, "Message is required"),
  type: notificationTypeSchema.optional().default("GENERAL"),
  delivery: notificationDeliverySchema.optional().default("IN_APP"),
  channel: z.string().nullable().optional(),
  relatedType: z.string().nullable().optional(),
  relatedId: z.string().nullable().optional(),
});

export const updateNotificationSchema = z.object({
  status: notificationStatusSchema.optional(),
  readAt: z.coerce.date().nullable().optional(),
});

export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
export type UpdateNotificationInput = z.infer<typeof updateNotificationSchema>;