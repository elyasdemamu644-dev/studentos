import { z } from "zod";
import {
  createGoalSchema,
  updateGoalSchema,
  createMilestoneSchema,
  updateMilestoneSchema,
} from "@studentos/shared/schemas/goals";

export {
  createGoalSchema,
  updateGoalSchema,
  createMilestoneSchema,
  updateMilestoneSchema,
};
export type {
  CreateGoalInput,
  UpdateGoalInput,
  CreateMilestoneInput,
  UpdateMilestoneInput,
} from "@studentos/shared/schemas/goals";

// ─────────────────────────────────────────────
// List query
// ─────────────────────────────────────────────

export const queryGoalSchema = z.object({
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().min(1).optional(),
});

export type GoalListQuery = z.infer<typeof queryGoalSchema>;
export type GoalCreate = z.infer<typeof createGoalSchema>;
export type GoalUpdate = z.infer<typeof updateGoalSchema>;
export type MilestoneCreate = z.infer<typeof createMilestoneSchema>;
export type MilestoneUpdate = z.infer<typeof updateMilestoneSchema>;