import { z } from "zod";

// ─────────────────────────────────────────────
// Shared id / date helpers
// ─────────────────────────────────────────────

/** Unique identifier — 26-char alphanumeric, like a short url, easy to type. */
export const idSchema = z
  .string()
  .min(1, "ID is required")
  .refine((v) => v.length >= 1 && v.length <= 26 && /^[a-zA-Z0-9-]+$/.test(v), "ID must be 1-26 alphanumeric characters (dashes allowed)");

export const dateSchema = z.string().datetime("Date must be ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ)");

export const dateOrEmptySchema = z.string().datetime().optional().or(z.literal(""));

export const dateRangeSchema = z.object({
  start: dateSchema,
  end: dateSchema,
}).refine((r) => r.start <= r.end, "Start date must be on or before end date");

// ─────────────────────────────────────────────
// Academic year
// ─────────────────────────────────────────────

export const academicYearCreateSchema = z.object({
  name: z.string().min(1).max(50),
  startDate: dateSchema,
  endDate: dateSchema,
}).refine((d) => d.startDate <= d.endDate, "Start date must be on or before end date");

export const academicYearUpdateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
}).refine(
  (d) => {
    if (d.startDate && d.endDate) return d.startDate <= d.endDate;
    if (d.startDate && !d.endDate) return true;
    if (!d.startDate && d.endDate) return true;
    return true;
  },
  "Start date must be on or before end date"
);

export const academicYearResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  startDate: dateSchema,
  endDate: dateSchema,
  status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

// ─────────────────────────────────────────────
// Semester
// ─────────────────────────────────────────────

export const semesterCreateSchema = z.object({
  name: z.string().min(1).max(100),
  academicYearId: idSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  // status defaults to UPCOMING; isCurrent defaults to false
}).refine((d) => d.startDate <= d.endDate, "Start date must be on or before end date");

export const semesterUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  // status and isCurrent are mutable by the user
  status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]).optional(),
  isCurrent: z.boolean().optional(),
}).refine(
  (d) => {
    if (d.startDate && d.endDate) return d.startDate <= d.endDate;
    return true;
  },
  "Start date must be on or before end date"
);

export const semesterResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  academicYearId: idSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]),
  isCurrent: z.boolean(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

export const semesterListQuerySchema = z.object({
  academicYearId: idSchema.optional(),
  status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: idSchema.optional(),
});

// ─────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────

export type AcademicYearCreate = z.infer<typeof academicYearCreateSchema>;
export type AcademicYearUpdate = z.infer<typeof academicYearUpdateSchema>;
export type AcademicYearResponse = z.infer<typeof academicYearResponseSchema>;

export type SemesterCreate = z.infer<typeof semesterCreateSchema>;
export type SemesterUpdate = z.infer<typeof semesterUpdateSchema>;
export type SemesterResponse = z.infer<typeof semesterResponseSchema>;
export type SemesterListQuery = z.infer<typeof semesterListQuerySchema>;
