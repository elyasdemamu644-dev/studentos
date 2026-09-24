import { z } from "zod";
import {
  createEventSchema,
  updateEventSchema,
} from "@studentos/shared/schemas/events";

export { createEventSchema, updateEventSchema };
export type {
  CreateEventInput,
  UpdateEventInput,
} from "@studentos/shared/schemas/events";

// ─────────────────────────────────────────────
// List query
// ─────────────────────────────────────────────

export const queryEventSchema = z.object({
  courseId: z.string().min(1).optional(),
  type: z
    .enum(["CLASS", "EXAM", "ASSIGNMENT", "PROJECT", "STUDY", "MEETING", "PERSONAL", "OTHER"])
    .optional(),
  // Filter by startAt range
  startFrom: z.string().optional(),
  startTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().min(1).optional(),
});

export type EventListQuery = z.infer<typeof queryEventSchema>;
export type EventCreate = z.infer<typeof createEventSchema>;
export type EventUpdate = z.infer<typeof updateEventSchema>;