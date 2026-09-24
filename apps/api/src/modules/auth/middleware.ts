import {
  type Request,
  type Response,
  type NextFunction,
} from "express";

import { config } from "@/config";
import { serialize } from "@/lib/jwt";

// ─────────────────────────────────────────────
// Auth Request
// ─────────────────────────────────────────────

export interface AuthRequest extends Request {
  /** The authenticated user's principal. */
  currentUser: CurrentUser;

  /** The raw JWT payload (claims) from the access token.
   *
   * Use this only for authz decisions that depend on the token
   * itself (e.g. scope checking). Most business logic should read
   * `currentUser` instead.
   */
  tokenPayload: TokenPayload;
}

// ─────────────────────────────────────────────
// CurrentUser
// ─────────────────────────────────────────────

export interface CurrentUser {
  /** Unique user identifier (the primary key in the `users` table). */
  readonly id: string;

  /** The user's email address — lowercase, as stored in the database. */
  readonly email: string;

  /** Display name derived from `firstName` + `lastName`. */
  readonly name: string;

  /** Database role: STUDENT | INSTRUCTOR | ADMIN.
   *
   * Every endpoint should check this if the operation is role-gated.
   */
  readonly role: "STUDENT" | "INSTRUCTOR" | "ADMIN";

  /** Current student residence status (on-campus / off-campus). */
  readonly residency: "ON_CAMPUS" | "OFF_CAMPUS";

  /** Timestamp when the user's profile was last updated.
   *
   * Useful for cache busting in long-lived sessions.
   */
  readonly updatedAt: Date;
}

// ─────────────────────────────────────────────
// TokenPayload
// ─────────────────────────────────────────────

export interface TokenPayload {
  readonly sub: string; // user id
  readonly email: string;
  readonly role: "STUDENT" | "INSTRUCTOR" | "ADMIN";
  readonly residency: "ON_CAMPUS" | "OFF_CAMPUS";
  readonly name: string;
  readonly iat: number;
  readonly exp: number;
}

// ─────────────────────────────────────────────
// Auth Error Codes
// ─────────────────────────────────────────────

/** Machine-readable error codes used by the auth module. */
export const AUTH_ERROR_CODES = {
  /** Email is already registered. */
  EMAIL_ALREADY_EXISTS: "AUTH_EMAIL_ALREADY_EXISTS",

  /** Email is not found during login. */
  EMAIL_NOT_FOUND: "AUTH_EMAIL_NOT_FOUND",

  /** Wrong password. */
  WRONG_PASSWORD: "AUTH_WRONG_PASSWORD",

  /** Expired or invalid access token. */
  INVALID_TOKEN: "AUTH_INVALID_TOKEN",

  /** Expired access token — client should refresh. */
  TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",

  /** The refresh token is invalid or has been revoked. */
  INVALID_REFRESH_TOKEN: "AUTH_INVALID_REFRESH_TOKEN",

  /** Expired refresh token. */
  REFRESH_TOKEN_EXPIRED: "AUTH_REFRESH_TOKEN_EXPIRED",

  /** The user account is suspended. */
  ACCOUNT_SUSPENDED: "AUTH_ACCOUNT_SUSPENDED",

  /** The user account is not yet verified. */
  ACCOUNT_NOT_VERIFIED: "AUTH_ACCOUNT_NOT_VERIFIED",

  /** Missing or invalid credentials for change-password. */
  WRONG_OLD_PASSWORD: "AUTH_WRONG_OLD_PASSWORD",

  /** Password does not meet complexity requirements. */
  PASSWORD_TOO_WEAK: "AUTH_PASSWORD_TOO_WEAK",

  /** The two password fields do not match. */
  PASSWORDS_DO_NOT_MATCH: "AUTH_PASSWORDS_DO_NOT_MATCH",
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

// ─────────────────────────────────────────────
// Middleware factory
// ─────────────────────────────────────────────

/**
 * Create the authentication middleware.
 *
 * The middleware:
 *  1. Reads the `Authorization: Bearer <token>` header.
 *  2. Verifies the JWT signature and expiration.
 *  3. Attaches `currentUser` and `tokenPayload` to the request.
 *  4. Returns 401 / 403 on failure.
 *
 * Usage:
 *  ```ts
 *  router.post("/", authenticate, handler);
 *  ```
 *
 * If you want optional auth (e.g. public endpoints):
 *  ```ts
 *  router.get("/", authenticateOptional, handler);
 *  ```
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;

  if (!header) {
    res.status(401).json({
      success: false,
      error: {
        code: AUTH_ERROR_CODES.INVALID_TOKEN,
        message: "Missing Authorization header",
      },
    });
    return;
  }

  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({
      success: false,
      error: {
        code: AUTH_ERROR_CODES.INVALID_TOKEN,
        message: "Invalid Authorization header format",
      },
    });
    return;
  }

  try {
    const payload = await serialize.verifyJwt(token, config.auth.algorithm);

    const currentUser: CurrentUser = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      residency: payload.residency,
      updatedAt: new Date(payload.iat * 1000),
    };

    (req as AuthRequest).currentUser = currentUser;
    (req as AuthRequest).tokenPayload = payload;

    next();
  } catch (error) {
    // jose throws JWTExpired with `code === "ERR_JWT_EXPIRED"` (its `name`
    // is the class name, not the jsonwebtoken-style "TokenExpiredError").
    const isExpired =
      error instanceof Error &&
      ((error as { code?: string }).code === "ERR_JWT_EXPIRED" ||
        error.name === "TokenExpiredError" ||
        error.message.includes("expired"));

    if (isExpired) {
      res.status(401).json({
        success: false,
        error: {
          code: AUTH_ERROR_CODES.TOKEN_EXPIRED,
          message: "Access token expired",
        },
      });
      return;
    }

    res.status(401).json({
      success: false,
      error: {
        code: AUTH_ERROR_CODES.INVALID_TOKEN,
        message: "Invalid access token",
      },
    });
    return;
  }
}

/**
 * Optional authentication — same as `authenticate` but does not fail
 * when no valid token is present.
 *
 * The request will have `currentUser` set to `null` when unauthenticated.
 */
export async function authenticateOptional(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;

  if (!header) {
    (req as AuthRequest).currentUser = null as unknown as CurrentUser;
    (req as AuthRequest).tokenPayload = null as unknown as TokenPayload;
    next();
    return;
  }

  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    (req as AuthRequest).currentUser = null as unknown as CurrentUser;
    (req as AuthRequest).tokenPayload = null as unknown as TokenPayload;
    next();
    return;
  }

  try {
    const payload = await serialize.verifyJwt(token, config.auth.algorithm);

    const currentUser: CurrentUser = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      residency: payload.residency,
      updatedAt: new Date(payload.iat * 1000),
    };

    (req as AuthRequest).currentUser = currentUser;
    (req as AuthRequest).tokenPayload = payload;
    next();
  } catch {
    (req as AuthRequest).currentUser = null as unknown as CurrentUser;
    (req as AuthRequest).tokenPayload = null as unknown as TokenPayload;
    next();
    return;
  }
}
