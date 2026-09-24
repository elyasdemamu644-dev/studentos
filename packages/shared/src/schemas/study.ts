import { z } from "zod";
import { idSchema, optionalDateSchema } from "./academics";

// ─────────────────────────────────────────────
// STUDY SESSION
// ─────────────────────────────────────────────

export const studySessionSchema = z.object({
  id: idSchema,
  userId: idSchema,
  courseId: idSchema.nullable(),
  taskId: idSchema.nullable(),
  topic: z.string().nullable(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  durationMinutes: z.number().int().min(0).nullable(),
  focusRating: z.number().int().min(1).max(5).nullable(),
  createdAt: z.coerce.date(),
  // optional relations
  course: z.any().nullable(),
  task: z.any().nullable(),
});

export const createStudySessionSchema = z.object({
  courseId: idSchema.nullable().optional(),
  taskId: idSchema.nullable().optional(),
  topic: z.string().trim().nullable().optional(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable().optional(),
  durationMinutes: z.number().int().min(0).nullable().optional(),
  focusRating: z.number().int().min(1).max(5).nullable().optional(),
});

// For starting a session (only requires course/topic + intended duration)
export const startStudySessionSchema = z.object({
  courseId: idSchema.nullable().optional(),
  taskId: idSchema.nullable().optional(),
  topic: z.string().trim().nullable().optional(),
  intendedDurationMinutes: z.number().int().min(1).max(480), // 1 min to 8 hours max
});

// For updating a session (partial, mirrors create)
export const updateStudySessionSchema = createStudySessionSchema.partial();

// For completing a session (add endedAt, actual duration, focus rating)
export const completeStudySessionSchema = z.object({
  endedAt: z.coerce.date().nullable().optional(),
  durationMinutes: z.number().int().min(0).nullable().optional(),
  focusRating: z.number().int().min(1).max(5).nullable().optional(),
});

export type StudySession = z.infer<typeof studySessionSchema>;
export type CreateStudySessionInput = z.infer<typeof createStudySessionSchema>;
export type StartStudySessionInput = z.infer<typeof startStudySessionSchema>;
export type CompleteStudySessionInput = z.infer<typeof completeStudySessionSchema>;
export type UpdateStudySessionInput = z.infer<typeof updateStudySessionSchema>;
