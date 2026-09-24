import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { config } from "@/config";

const secret = new TextEncoder().encode(config.jwtSecret!);

export interface TokenPayload {
  sub: string;
  email: string;
  role: "STUDENT" | "INSTRUCTOR" | "ADMIN";
  residency: "ON_CAMPUS" | "OFF_CAMPUS";
  name: string;
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

export function signAccessToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ sub: userId, email })
    .setProtectedHeader({ alg: config.auth.algorithm })
    .setIssuedAt()
    .setExpirationTime(expiresAt(config.jwtAccessExpiresInSeconds))
    .sign(secret);
}

export function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, type: "refresh" })
    .setProtectedHeader({ alg: config.auth.algorithm })
    .setIssuedAt()
    .setExpirationTime(expiresAt(config.jwtRefreshExpiresInSeconds))
    .sign(secret);
}

export async function verifyJwt(
  token: string,
  expectedAlgorithm?: string,
): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: expectedAlgorithm ? [expectedAlgorithm as any] : undefined,
  });
  return payload as unknown as TokenPayload;
}

// Callable `serialize` object exported as a named function for convenience
export const serialize = {
  signAccessToken,
  signRefreshToken,
  verifyJwt,
};

export type Serialize = typeof serialize;
