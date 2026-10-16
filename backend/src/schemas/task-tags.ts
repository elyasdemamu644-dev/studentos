import { z } from "zod";
import {
  createTaskTagSchema,
} from "@tutor-walle/shared/schemas/tasks";

export { createTaskTagSchema };
export type {
  CreateTaskTagInput,
} from "@tutor-walle/shared/schemas/tasks";

// ─────────────────────────────────────────────
// Update tag (rename / recolor)
// ─────────────────────────────────────────────

export const updateTaskTagSchema = z.object({
  name: z.string().trim().min(1, "Tag name is required").max(50).optional(),
  color: z.string().max(20).nullable().optional(),
});

export type UpdateTaskTagInput = z.infer<typeof updateTaskTagSchema>;