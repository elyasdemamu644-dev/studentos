import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { prisma } from "@/utils/prisma";

import { ConflictError, NotFoundError, unauthorizedError } from "@/config/errors";
import type { User } from "@prisma/client";
import { zValidator } from "@/utils/zod-validator-shim";
import {
  accessTokenTtlSeconds,
  refreshTokenTtlSeconds,
  signAccessToken,
  signRefreshToken,
  verifyJwt,
} from "@/utils/jwt";
import { AuthRequest, authenticate } from "@/middlewares/auth";
import { verifyGoogleIdToken } from "@/services/google-oauth";

// ─────────────────────────────────────────────
// Password hashing
// ─────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 4 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2Verify(hash, password, { memoryCost: 65536, timeCost: 3, parallelism: 4 });
}

/** Cryptographically random secret, used to make password login impossible
 *  for accounts that were created through Google OAuth. */
function randomSecret(): string {
  return randomBytes(48).toString("base64url");
}

// ─────────────────────────────────────────────
// Auth service
// ─────────────────────────────────────────────

/** AuthService — the business-logic layer for authentication. */
export const authService = {
  async register(email: string, password: string, firstName?: string, lastName?: string, opts?: {
    university?: string | null;
    department?: string | null;
    academicYear?: string | null;
    timezone?: string;
  }) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictError("A user with this email already exists");
    }
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: firstName ?? "",
        lastName: lastName ?? "",
        university: opts?.university ?? null,
        department: opts?.department ?? null,
        academicYear: opts?.academicYear ?? null,
        timezone: opts?.timezone ?? "UTC",
      },
    });
    return toPublicUser(user);
  },

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) { throw unauthorizedError("Invalid email or password"); }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) { throw unauthorizedError("Invalid email or password"); }
    return this.issueSession(user);
  },

  /**
   * Google OAuth sign-in. Verifies a Google OIDC id_token, then logs in the
   * matching existing user or provisions a new account keyed on the verified
   * email. Google accounts have no password, so a new user is created with an
   * unguessable random hash — password login stays impossible for them.
   */
  async loginWithGoogle(idToken: string) {
    const claims = await verifyGoogleIdToken(idToken);
    const email = claims.email.toLowerCase();

    // Registration and password login are case-sensitive, so the stored row
    // may carry mixed case. Google always reports the mailbox lowercased —
    // match case-insensitively so a Google sign-in links to the existing
    // account instead of silently provisioning a duplicate for the same user.
    let user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (!user) {
      const passwordHash = await hashPassword(randomSecret());
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: claims.name?.split(" ")[0] ?? "",
          lastName: claims.name?.split(" ").slice(1).join(" ") ?? "",
          profilePicture: claims.picture ?? null,
          timezone: "UTC",
        },
      });
    }

    return this.issueSession(user);
  },

  /** Issue a fresh access/refresh pair and persist the refresh row. */
  async issueSession(user: User) {
    const accessToken = await signAccessToken(user.id, user.email);
    const refreshToken = await signRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + refreshTokenTtlSeconds * 1000);
    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt },
    });
    return { accessToken, refreshToken, expiresIn: accessTokenTtlSeconds, user: toPublicUser(user) };
  },

  async refresh(refreshToken: string) {
    let payload: { sub: string; type: string };
    try { payload = await verifyJwt(refreshToken); }
    catch { throw unauthorizedError("Invalid or expired refresh token"); }
    if (payload.type !== "refresh") { throw unauthorizedError("Invalid or expired refresh token"); }
    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken }, include: { user: true } });
    if (!stored || stored.userId !== payload.sub) { throw unauthorizedError("Invalid or expired refresh token"); }
    // The JWT signature can outlive the row it was stored with (rotation,
    // revocation, clock skew) — honour the database's own expiry too.
    if (stored.expiresAt.getTime() <= Date.now()) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
      throw unauthorizedError("Invalid or expired refresh token");
    }
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    const user = stored.user;
    return this.issueSession(user);
  },

  async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  },

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { throw new NotFoundError("User"); }
    return toPublicUser(user);
  },

  async updateProfile(userId: string, data: {
    firstName?: string; lastName?: string; university?: string | null;
    department?: string | null; academicYear?: string | null;
    timezone?: string; profilePicture?: string | null;
  }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { throw new NotFoundError("User"); }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.university !== undefined && { university: data.university }),
        ...(data.department !== undefined && { department: data.department }),
        ...(data.academicYear !== undefined && { academicYear: data.academicYear }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        ...(data.profilePicture !== undefined && { profilePicture: data.profilePicture }),
      },
    });
    return toPublicUser(updated);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { throw new NotFoundError("User"); }
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) { throw new NotFoundError("User"); }
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  },
};

function toPublicUser(user: User) {
  return {
    id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    university: user.university, department: user.department,
    academicYear: user.academicYear, timezone: user.timezone,
    profilePicture: user.profilePicture, createdAt: user.createdAt,
  };
}

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  university: z.string().max(200).nullable().optional(),
  department: z.string().max(200).nullable().optional(),
  academicYear: z.string().nullable().optional(),
  timezone: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const googleLoginSchema = z.object({
  idToken: z.string().min(1, "idToken is required"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  university: z.string().max(200).nullable().optional(),
  department: z.string().max(200).nullable().optional(),
  academicYear: z.string().nullable().optional(),
  timezone: z.string().optional(),
  profilePicture: z.string().nullable().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export {
  authenticate,
  authenticateOptional,
  AUTH_ERROR_CODES,
  type AuthErrorCode,
} from "../middlewares/auth";
export type { AuthRequest, CurrentUser, TokenPayload } from "../middlewares/auth";

// ─────────────────────────────────────────────
// HTTP router
// ─────────────────────────────────────────────

const authRouter = Router();

authRouter.post("/register", zValidator("body", registerSchema), async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, university, department, academicYear, timezone } =
      req.body as z.infer<typeof registerSchema>;
    const user = await authService.register(email, password, firstName, lastName, {
      university,
      department,
      academicYear,
      timezone,
    });
    return res.status(201).json({ success: true, data: user });
  } catch (error) { next(error); }
});

authRouter.post("/login", zValidator("body", loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const result = await authService.login(email, password);
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

authRouter.post("/google", zValidator("body", googleLoginSchema), async (req, res, next) => {
  try {
    const { idToken } = req.body as z.infer<typeof googleLoginSchema>;
    const result = await authService.loginWithGoogle(idToken);
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

authRouter.post("/refresh", zValidator("body", refreshSchema), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    const result = await authService.refresh(refreshToken);
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

authRouter.post("/logout", zValidator("body", refreshSchema), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    await authService.logout(refreshToken);
    return res.status(200).json({ success: true });
  } catch (error) { next(error); }
});

authRouter.get("/me", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await authService.getProfile(req.currentUser!.id);
    return res.status(200).json({ success: true, data: user });
  } catch (error) { next(error); }
});

authRouter.patch("/me", authenticate, zValidator("body", updateProfileSchema), async (req: AuthRequest, res, next) => {
  try {
    const user = await authService.updateProfile(req.currentUser!.id, req.body as z.infer<typeof updateProfileSchema>);
    return res.status(200).json({ success: true, data: user });
  } catch (error) { next(error); }
});

authRouter.post("/me/change-password", authenticate, zValidator("body", changePasswordSchema), async (req: AuthRequest, res, next) => {
  try {
    await authService.changePassword(req.currentUser!.id, req.body.currentPassword, req.body.newPassword);
    return res.status(200).json({ success: true, data: { changed: true } });
  } catch (error) { next(error); }
});

export default authRouter;
