import { z } from "zod";
import { idSchema, dateSchema, optionalDateSchema } from "./academics";

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export const taskTypeSchema = z.enum([
  "ASSIGNMENT",
  "HOMEWORK",
  "PROJECT",
  "READING",
  "PRACTICE",
  "REVISION",
  "OTHER",
]);

export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);

// ─────────────────────────────────────────────
// TASK
// ─────────────────────────────────────────────

export const taskSchema = z.object({
  id: idSchema,
  userId: idSchema, // top-level tasks (not course-scoped) also have userId;
                     // course-scoped tasks also have courseId, but ownership is still userId
  courseId: idSchema.nullable(),
  title: z.string().trim(),
  description: z.string().nullable(),
  type: taskTypeSchema,
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  dueDate: optionalDateSchema,
  estimatedMinutes: z.number().int().min(0).nullable().optional(),
  completedAt: optionalDateSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // optional relations
  course: z.any().nullable(), // Course shape, omitted for brevity here, filled by service layer
  subtasks: z.any().array().optional(), // TaskSubtask[]
  tags: z.any().array().optional(), // TaskTag[]
});

export const createTaskSchema = z.object({
  courseId: idSchema.nullable().optional(),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().nullable().optional(),
  type: taskTypeSchema.optional(),
  priority: taskPrioritySchema.optional(),
  status: taskStatusSchema.optional(),
  dueDate: optionalDateSchema,
  estimatedMinutes: z.number().int().min(0).nullable().optional(),
});

export const updateTaskSchema = createTaskSchema.partial()
  .extend({
    // status transitions may require completion timestamp
    completedAt: optionalDateSchema,
  });

// ─────────────────────────────────────────────
// SUBTASK
// ─────────────────────────────────────────────

export const taskSubtaskSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  title: z.string().trim(),
  status: taskStatusSchema,
  position: z.number().int().min(0),
  completedAt: optionalDateSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createSubtaskSchema = z.object({
  title: z.string().trim().min(1, "Subtask title is required"),
  status: taskStatusSchema.optional(),
  position: z.number().int().min(0).optional(),
});

export const updateSubtaskSchema = createSubtaskSchema.partial().extend({
  completedAt: optionalDateSchema,
});

// ─────────────────────────────────────────────
// TASK TAG
// ─────────────────────────────────────────────

export const taskTagSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  name: z.string().trim(),
  color: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
});

export const createTaskTagSchema = z.object({
  name: z.string().trim().min(1, "Tag name is required"),
  color: z.string().optional(),
});

// ─────────────────────────────────────────────
// DERIVED TYPES
// ─────────────────────────────────────────────

export type TaskType = z.infer<typeof taskTypeSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export type Task = z.infer<typeof taskSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export type TaskSubtask = z.infer<typeof taskSubtaskSchema>;
export type CreateSubtaskInput = z.infer<typeof createSubtaskSchema>;
export type UpdateSubtaskInput = z.infer<typeof updateSubtaskSchema>;

export type TaskTag = z.infer<typeof taskTagSchema>;
export type CreateTaskTagInput = z.infer<typeof createTaskTagSchema>;
