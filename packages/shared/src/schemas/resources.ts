import { z } from "zod";
import { idSchema } from "./academics";

// ─────────────────────────────────────────────
// RESOURCE
// ─────────────────────────────────────────────

export const resourceStorageTypeSchema = z.enum(["URL", "UPLOAD"]);
export const resourceTypeSchema = z.enum([
  "PDF",
  "VIDEO",
  "AUDIO",
  "SLIDES",
  "LINK",
  "DOCUMENT",
  "OTHER",
]);

export const resourceSchema = z.object({
  id: idSchema,
  userId: idSchema,
  courseId: idSchema.nullable(),
  title: z.string().trim(),
  description: z.string().nullable(),
  url: z.string().nullable(),
  storageType: resourceStorageTypeSchema,
  fileKey: z.string().nullable(),
  fileName: z.string().nullable(),
  fileSize: z.number().int().nullable(),
  mimeType: z.string().nullable(),
  resourceType: resourceTypeSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // optional course relation
  course: z.any().nullable(),
});

export const createResourceSchema = z.object({
  courseId: idSchema.nullable().optional(),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().nullable().optional(),
  storageType: resourceStorageTypeSchema.optional().default("URL"),
  // When storageType = URL, url must be present
  url: z.string().url().nullable().optional(),
  // When storageType = UPLOAD, these come from the upload service
  fileKey: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  fileSize: z.number().int().min(0).nullable().optional(),
  mimeType: z.string().nullable().optional(),
  resourceType: resourceTypeSchema.optional(),
});

export const updateResourceSchema = createResourceSchema.partial();

export type ResourceStorageType = z.infer<typeof resourceStorageTypeSchema>;
export type ResourceType = z.infer<typeof resourceTypeSchema>;
export type Resource = z.infer<typeof resourceSchema>;
export type CreateResourceInput = z.infer<typeof createResourceSchema>;
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;
