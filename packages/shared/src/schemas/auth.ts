import { z } from "zod";

// ─────────────────────────────────────────────
// AUTH REQUESTS
// ─────────────────────────────────────────────

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long"),
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  university: z.string().trim().optional(),
  department: z.string().trim().optional(),
  academicYear: z.string().trim().optional(),
  timezone: z.string().trim().default("UTC"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters")
    .max(128, "Password is too long"),
});

export const updateProfileSchema = z.object({
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  university: z.string().trim().nullable().optional(),
  department: z.string().trim().nullable().optional(),
  academicYear: z.string().trim().nullable().optional(),
  timezone: z.string().trim().optional(),
  profilePicture: z.string().url().nullable().optional().or(z.literal("")),
});

// ─────────────────────────────────────────────
// AUTH RESPONSES
// ─────────────────────────────────────────────

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(), // seconds until access token expires
});

export const userPublicSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  university: z.string().nullable(),
  department: z.string().nullable(),
  academicYear: z.string().nullable(),
  timezone: z.string(),
  profilePicture: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export const userSettingsSchema = z.record(z.string(), z.string());

// ─────────────────────────────────────────────
// DERIVED TYPES
// ─────────────────────────────────────────────

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export type TokenPair = z.infer<typeof tokenPairSchema>;
export type UserPublic = z.infer<typeof userPublicSchema>;
export type UserSettings = z.infer<typeof userSettingsSchema>;
