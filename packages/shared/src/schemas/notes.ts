import { z } from "zod";
import { idSchema, optionalDateSchema } from "./academics";

export const noteSchema = z.object({
  id: idSchema,
  userId: idSchema,
  courseId: idSchema.nullable(),
  title: z.string().trim(),
  content: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // optional course relation
  course: z.any().nullable(),
});

export const createNoteSchema = z.object({
  courseId: idSchema.nullable().optional(),
  title: z.string().trim().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
});

export const updateNoteSchema = createNoteSchema.partial();

export type Note = z.infer<typeof noteSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
