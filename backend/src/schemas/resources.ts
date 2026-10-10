import { z } from "zod";
import {
  createResourceSchema,
  updateResourceSchema,
  resourceTypeSchema,
} from "@studentos/shared/schemas/resources";

export { createResourceSchema, updateResourceSchema };
export type {
  CreateResourceInput,
  UpdateResourceInput,
} from "@studentos/shared/schemas/resources";

// ─────────────────────────────────────────────
// Upload (multipart) text fields
// ─────────────────────────────────────────────
//
// The `file` part is validated separately (size + content sniffing); these are
// the optional metadata fields that may accompany it in the same multipart
// body. Values arrive as strings.

export const uploadResourceFieldsSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  courseId: z.string().min(1).optional(),
  resourceType: resourceTypeSchema.optional(),
});

export type ResourceUploadFields = z.infer<typeof uploadResourceFieldsSchema>;

// ─────────────────────────────────────────────
// List query
// ─────────────────────────────────────────────

export const queryResourceSchema = z.object({
  courseId: z.string().min(1).optional(),
  resourceType: z
    .enum(["PDF", "VIDEO", "AUDIO", "SLIDES", "LINK", "DOCUMENT", "OTHER"])
    .optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().min(1).optional(),
});

export type ResourceListQuery = z.infer<typeof queryResourceSchema>;
export type ResourceCreate = z.infer<typeof createResourceSchema>;
export type ResourceUpdate = z.infer<typeof updateResourceSchema>;