import { z } from "zod";
import {
  createStudySessionSchema,
  completeStudySessionSchema,
  updateStudySessionSchema,
} from "@studentos/shared/schemas/study";

export {
  createStudySessionSchema,
  completeStudySessionSchema,
  updateStudySessionSchema,
};
export type {
  CreateStudySessionInput,
  CompleteStudySessionInput,
  UpdateStudySessionInput,
} from "@studentos/shared/schemas/study";

// ─────────────────────────────────────────────
// List query
// ─────────────────────────────────────────────

export const queryStudySessionSchema = z.object({
  courseId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  // "today" | "week" | "month" — convenience time windows for study summaries
  range: z.enum(["today", "week", "month"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().min(1).optional(),
});

export type StudySessionListQuery = z.infer<typeof queryStudySessionSchema>;
export type StudySessionCreate = z.infer<typeof createStudySessionSchema>;
export type StudySessionUpdate = z.infer<typeof updateStudySessionSchema>;