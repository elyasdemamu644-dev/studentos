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

const dateFilterSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

export const queryEventSchema = z
  .object({
    courseId: z.string().min(1).optional(),
    type: z
      .enum(["CLASS", "EXAM", "ASSIGNMENT", "PROJECT", "STUDY", "MEETING", "PERSONAL", "OTHER"])
      .optional(),
    // Filter by startAt range
    startFrom: dateFilterSchema.optional(),
    startTo: dateFilterSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    cursor: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startFrom && value.startTo && Date.parse(value.startFrom) > Date.parse(value.startTo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startTo"],
        message: "startTo must be on or after startFrom",
      });
    }
  });

export type EventListQuery = z.infer<typeof queryEventSchema>;
export type EventCreate = z.infer<typeof createEventSchema>;
export type EventUpdate = z.infer<typeof updateEventSchema>;