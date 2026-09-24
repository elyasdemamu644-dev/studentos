import { z } from "zod";
import {
  createGradeSchema,
  updateGradeSchema,
} from "@studentos/shared/schemas/grades";

export { createGradeSchema, updateGradeSchema };
export type {
  CreateGradeInput,
  UpdateGradeInput,
} from "@studentos/shared/schemas/grades";

// ─────────────────────────────────────────────
// List query
// ─────────────────────────────────────────────

export const queryGradeSchema = z.object({
  courseId: z.string().min(1).optional(),
  type: z
    .enum(["ASSIGNMENT", "EXAM", "QUIZ", "PROJECT", "PARTICIPATION", "FINAL", "OTHER", "ASSESSMENT"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().min(1).optional(),
});

export type GradeListQuery = z.infer<typeof queryGradeSchema>;
export type GradeCreate = z.infer<typeof createGradeSchema>;
export type GradeUpdate = z.infer<typeof updateGradeSchema>;