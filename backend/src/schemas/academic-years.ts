import { z } from "zod";
import { dateString, statusEnum } from "./semesters";

const idSchema = z
  .string()
  .min(1, "ID is required")
  .refine((v) => v.length >= 1 && v.length <= 26 && /^[a-zA-Z0-9-]+$/.test(v), "ID must be 1-26 alphanumeric characters (dashes allowed)");

export const listQuery = z.object({
  status: statusEnum.optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  cursor: idSchema.optional(),
});

export const create = z.object({
  name: z.string().min(1).max(200),
  startDate: dateString,
  endDate: dateString,
});

export const update = z.object({
  name: z.string().min(1).max(200).optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  status: statusEnum.optional(),
});

export type AcademicYearCreate = z.infer<typeof create>;
export type AcademicYearUpdate = z.infer<typeof update>;
