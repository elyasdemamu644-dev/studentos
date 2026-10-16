import { z } from "zod";
import {
  createNoteSchema,
  updateNoteSchema,
} from "@tutor-walle/shared/schemas/notes";

// Re-export shared create/update contracts so the module owns a single
// validation entry-point while the canonical shape lives in @tutor-walle/shared.
export { createNoteSchema, updateNoteSchema };
export type {
  CreateNoteInput,
  UpdateNoteInput,
} from "@tutor-walle/shared/schemas/notes";

// ─────────────────────────────────────────────
// List query
// ─────────────────────────────────────────────

export const queryNoteSchema = z.object({
  courseId: z.string().min(1).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().min(1).optional(),
});

export type NoteListQuery = z.infer<typeof queryNoteSchema>;
export type NoteCreate = z.infer<typeof createNoteSchema>;
export type NoteUpdate = z.infer<typeof updateNoteSchema>;