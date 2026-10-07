import { z } from "zod";
import {
  updateNotificationSchema,
} from "@studentos/shared/schemas/notifications";

export { updateNotificationSchema };
export type {
  UpdateNotificationInput,
} from "@studentos/shared/schemas/notifications";

// ─────────────────────────────────────────────
// List query
// ─────────────────────────────────────────────

export const queryNotificationSchema = z.object({
  status: z.enum(["UNREAD", "READ", "ARCHIVED"]).optional(),
  type: z
    .enum(["ASSIGNMENT_DUE", "EXAM_REMINDER", "OVERDUE_TASK", "STUDY_REMINDER", "STUDY_PLAN_REMINDER", "GOAL_REMINDER", "GENERAL"])
    .optional(),
  unread: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().min(1).optional(),
});

export type NotificationListQuery = z.infer<typeof queryNotificationSchema>;