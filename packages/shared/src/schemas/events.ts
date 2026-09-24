import { z } from "zod";
import { idSchema, optionalDateSchema } from "./academics";

// ─────────────────────────────────────────────
// EVENT (Calendar)
// ─────────────────────────────────────────────

export const eventTypeSchema = z.enum([
  "CLASS",
  "EXAM",
  "ASSIGNMENT",
  "PROJECT",
  "STUDY",
  "MEETING",
  "PERSONAL",
  "OTHER",
]);

export const eventSchema = z.object({
  id: idSchema,
  userId: idSchema,
  courseId: idSchema.nullable(),
  title: z.string().trim(),
  description: z.string().nullable(),
  type: eventTypeSchema,
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullable(),
  location: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // optional course relation
  course: z.any().nullable(),
});

export const createEventSchema = z.object({
  courseId: idSchema.nullable().optional(),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().nullable().optional(),
  type: eventTypeSchema.optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullable().optional(),
  location: z.string().trim().nullable().optional(),
});

export const updateEventSchema = createEventSchema.partial();

export type EventType = z.infer<typeof eventTypeSchema>;
export type Event = z.infer<typeof eventSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
