import { Router } from "express";
import { z } from "zod";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

import { config } from "@/config";
import { ConflictError, NotFoundError, unauthorizedError } from "@/config/errors";
import type { User } from "@prisma/client";
import { zValidator } from "@/lib/zod-validator-shim";
import { AuthRequest, authenticate } from "@/modules/auth/middleware";

// ─────────────────────────────────────────────
// Token helpers
// ─────────────────────────────────────────────

const jwtIssuer = "studentos";
const jwtAudience = "studentos";

function makeKey() {
  return new TextEncoder().encode(config.jwtSecret);
}

/** Sign an access token for the given user. */
async function signAccessToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ sub: userId, email, type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(jwtIssuer)
    .setAudience(jwtAudience)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime("1h")
    .sign(makeKey());
}

/** Sign a refresh token for the given user. */
async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, type: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(jwtIssuer)
    .setAudience(jwtAudience)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime("7d")
    .sign(makeKey());
}

/** Verify a token and return its payload. Throws on invalid/expired tokens. */
async function verifyToken<T>(token: string): Promise<T> {
  const { payload } = await jwtVerify(token, makeKey(), {
    issuer: jwtIssuer,
    audience: jwtAudience,
  });
  return payload as T;
}

// ─────────────────────────────────────────────
// Password hashing
// ─────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 4 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2Verify(hash, password, { memoryCost: 65536, timeCost: 3, parallelism: 4 });
}

// ─────────────────────────────────────────────
// Auth service
// ─────────────────────────────────────────────

/** AuthService — the business-logic layer for authentication. */
export const authService = {
  async register(email: string, password: string, firstName: string, lastName: string, opts?: {
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
    const accessToken = await signAccessToken(user.id, user.email);
    const refreshToken = await signRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt },
    });
    return { accessToken, refreshToken, expiresIn: 3600, user: toPublicUser(user) };
  },

  async refresh(refreshToken: string) {
    let payload: { sub: string; type: string };
    try { payload = await verifyToken<{ sub: string; type: string }>(refreshToken); }
    catch { throw unauthorizedError("Invalid or expired refresh token"); }
    if (payload.type !== "refresh") { throw unauthorizedError("Invalid or expired refresh token"); }
    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken }, include: { user: true } });
    if (!stored || stored.userId !== payload.sub) { throw unauthorizedError("Invalid or expired refresh token"); }
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    const user = stored.user;
    const accessToken = await signAccessToken(user.id, user.email);
    const newRefreshToken = await signRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { token: newRefreshToken, userId: user.id, expiresAt } });
    return { accessToken, refreshToken: newRefreshToken, expiresIn: 3600, user: toPublicUser(user) };
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
} from "./middleware";
export type { AuthRequest, CurrentUser, TokenPayload } from "./middleware";

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

export default authRouter;
