import { z } from "zod";

const idSchema = z
  .string()
  .min(1, "ID is required")
  .refine((v) => v.length >= 1 && v.length <= 26 && /^[a-zA-Z0-9-]+$/.test(v), "ID must be 1-26 alphanumeric characters (dashes allowed)");

export const listQuery = z.object({
  academicYearId: idSchema.optional(),
  status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]).optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  cursor: idSchema.optional(),
});

export const create = z.object({
  name: z.string().min(1).max(200),
  academicYearId: idSchema,
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]).optional(),
});

export const update = z.object({
  name: z.string().min(1).max(200).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]).optional(),
});
