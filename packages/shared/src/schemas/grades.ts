import { z } from "zod";
import { idSchema } from "./academics";

// ─────────────────────────────────────────────
// GRADE
// ─────────────────────────────────────────────

export const gradeTypeSchema = z.enum([
  "ASSIGNMENT",
  "EXAM",
  "QUIZ",
  "PROJECT",
  "PARTICIPATION",
  "FINAL",
  "OTHER",
  "ASSESSMENT",
]);

export const gradeSchema = z.object({
  id: idSchema,
  userId: idSchema,
  courseId: idSchema.nullable(),
  title: z.string().trim(),
  score: z.number().min(0).nullable(),
  maxScore: z.number().min(0).nullable(),
  weight: z.number().min(0).nullable(),
  type: gradeTypeSchema,
  recordedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // optional course relation
  course: z.any().nullable(),
});

export const createGradeSchema = z.object({
  courseId: idSchema.nullable().optional(),
  title: z.string().trim().min(1, "Title is required"),
  score: z.number().min(0).nullable().optional(),
  maxScore: z.number().min(0).nullable().optional(),
  weight: z.number().min(0).nullable().optional(),
  type: gradeTypeSchema.optional(),
  recordedAt: z.coerce.date().optional(),
});

export const updateGradeSchema = createGradeSchema.partial();

export type GradeType = z.infer<typeof gradeTypeSchema>;
export type Grade = z.infer<typeof gradeSchema>;
export type CreateGradeInput = z.infer<typeof createGradeSchema>;
export type UpdateGradeInput = z.infer<typeof updateGradeSchema>;