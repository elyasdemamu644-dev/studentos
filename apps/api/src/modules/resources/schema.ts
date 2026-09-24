import { z } from "zod";
import {
  createResourceSchema,
  updateResourceSchema,
} from "@studentos/shared/schemas/resources";

export { createResourceSchema, updateResourceSchema };
export type {
  CreateResourceInput,
  UpdateResourceInput,
} from "@studentos/shared/schemas/resources";

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