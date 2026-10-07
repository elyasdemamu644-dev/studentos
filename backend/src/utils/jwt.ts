import { SignJWT, jwtVerify, type JWTPayload } from "jose";

import { config } from "@/config";

// ─────────────────────────────────────────────
// Canonical JWT helpers
// ─────────────────────────────────────────────
//
// This is the ONLY place tokens are minted or verified. `auth/routes.ts`
// signs with these helpers and `auth/middleware.ts` verifies with them, so the
// TTLs, issuer, audience and algorithm cannot drift apart between the two.
// Do not re-declare SignJWT/jwtVerify outside this file.

const jwtIssuer = "studentos";
const jwtAudience = "studentos";

/** `config.jwtSecret` is validated by `validateConfig()` at boot. */
const secret = new TextEncoder().encode(config.jwtSecret);

export interface TokenPayload extends JWTPayload {
  /** user id (jose puts it in `sub`, mirrored here for typed access) */
  sub: string;
  /** The login email — never a password or a credential. */
  email: string;
  /** Token kind. Refresh tokens are persisted in `RefreshToken` for rotation. */
  type: "access" | "refresh";
  iat: number;
  exp: number;
}

/**
 * jose's `setExpirationTime` treats numeric values as epoch *seconds*, so a
 * relative TTL must be expressed as `now + seconds` (not `seconds * 1000`).
 */
function expiresAt(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

/** Sign an access token. TTL: `JWT_ACCESS_EXPIRES_IN_SECONDS` (default 15 min). */
export function signAccessToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ sub: userId, email, type: "access" })
    .setProtectedHeader({ alg: config.auth.algorithm })
    .setIssuer(jwtIssuer)
    .setAudience(jwtAudience)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(expiresAt(config.jwtAccessExpiresInSeconds))
    .sign(secret);
}

/** Sign a refresh token. TTL: `JWT_REFRESH_EXPIRES_IN_SECONDS` (default 7 days). */
export function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, type: "refresh" })
    .setProtectedHeader({ alg: config.auth.algorithm })
    .setIssuer(jwtIssuer)
    .setAudience(jwtAudience)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(expiresAt(config.jwtRefreshExpiresInSeconds))
    .sign(secret);
}

/**
 * Verify a token's signature, algorithm, issuer, audience and expiry.
 * Throws on anything that does not match — the caller decides the HTTP shape.
 */
export async function verifyJwt(
  token: string,
  expectedAlgorithm: string = config.auth.algorithm,
): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: [expectedAlgorithm],
    issuer: jwtIssuer,
    audience: jwtAudience,
  });
  return payload as unknown as TokenPayload;
}

/** Seconds until an access token expires — returned as `expiresIn` to clients. */
export const accessTokenTtlSeconds = config.jwtAccessExpiresInSeconds;

/** Seconds until a refresh token expires — mirrors the `RefreshToken.expiresAt` row. */
export const refreshTokenTtlSeconds = config.jwtRefreshExpiresInSeconds;

// Callable `serialize` object exported as a named function for convenience
export const serialize = {
  signAccessToken,
  signRefreshToken,
  verifyJwt,
};

export type Serialize = typeof serialize;
