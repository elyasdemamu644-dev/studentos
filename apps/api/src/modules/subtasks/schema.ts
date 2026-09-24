import { z } from "zod";
import {
  createSubtaskSchema,
  updateSubtaskSchema,
} from "@studentos/shared/schemas/tasks";

export { createSubtaskSchema, updateSubtaskSchema };
export type {
  CreateSubtaskInput,
  UpdateSubtaskInput,
} from "@studentos/shared/schemas/tasks";

// ─────────────────────────────────────────────
// List query
// ─────────────────────────────────────────────

export const querySubtaskSchema = z.object({
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
});

export type SubtaskListQuery = z.infer<typeof querySubtaskSchema>;