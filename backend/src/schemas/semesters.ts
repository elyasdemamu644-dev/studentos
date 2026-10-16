import { z } from "zod";

const idSchema = z
  .string()
  .min(1, "ID is required")
  .refine((v) => v.length >= 1 && v.length <= 26 && /^[a-zA-Z0-9-]+$/.test(v), "ID must be 1-26 alphanumeric characters (dashes allowed)");

/** A non-empty string that parses to a real calendar date. */
export const dateString = z
  .string()
  .min(1, "Date is required")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

export const statusEnum = z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]);
export type SemesterStatus = z.infer<typeof statusEnum>;

export const listQuery = z.object({
  academicYearId: idSchema.optional(),
  status: statusEnum.optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  cursor: idSchema.optional(),
});

export const create = z.object({
  name: z.string().min(1).max(200),
  academicYearId: idSchema,
  startDate: dateString,
  endDate: dateString,
  status: statusEnum.optional(),
});

export const update = z.object({
  name: z.string().min(1).max(200).optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  status: statusEnum.optional(),
});
