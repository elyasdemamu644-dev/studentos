import { z } from "zod";
import { idSchema, optionalDateSchema } from "./academics";

// ─────────────────────────────────────────────
// GOAL
// ─────────────────────────────────────────────

export const goalStatusSchema = z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]);

export const goalSchema = z.object({
  id: idSchema,
  userId: idSchema,
  title: z.string().trim(),
  description: z.string().nullable(),
  deadline: optionalDateSchema,
  status: goalStatusSchema,
  progress: z.number().int().min(0).max(100).default(0),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  milestones: z.any().array().optional(), // GoalMilestone[]
});

export const createGoalSchema = z.object({
  title: z.string().trim().min(1, "Goal title is required"),
  description: z.string().trim().nullable().optional(),
  deadline: optionalDateSchema,
  status: goalStatusSchema.optional(),
});

export const updateGoalSchema = createGoalSchema.partial().extend({
  progress: z.number().int().min(0).max(100).optional(),
});

// ─────────────────────────────────────────────
// GOAL MILESTONE
// ─────────────────────────────────────────────

export const milestoneStatusSchema = z.enum(["TODO", "IN_PROGRESS", "COMPLETED"]);

export const goalMilestoneSchema = z.object({
  id: idSchema,
  goalId: idSchema,
  title: z.string().trim(),
  status: milestoneStatusSchema,
  position: z.number().int().min(0),
  completedAt: optionalDateSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createMilestoneSchema = z.object({
  title: z.string().trim().min(1, "Milestone title is required"),
  status: milestoneStatusSchema.optional(),
  position: z.number().int().min(0).optional(),
});

export const updateMilestoneSchema = createMilestoneSchema.partial().extend({
  completedAt: optionalDateSchema,
});

export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;
export type GoalMilestone = z.infer<typeof goalMilestoneSchema>;
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;
