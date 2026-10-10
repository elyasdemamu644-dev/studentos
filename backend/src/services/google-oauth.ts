import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { config } from "@/config";
import { serviceUnavailableError, unauthorizedError } from "@/config/errors";

// ─────────────────────────────────────────────
// Google OAuth — OIDC ID-token verification
// ─────────────────────────────────────────────
//
// Dependency-free verification of Google's OIDC `id_token`. Google ships no
// secret to us: tokens are RS256-signed by Google and verified against the
// public JWKS published at Google's jwks_uri. jose already depends on Web
// Crypto and is used by utils/jwt.ts, so no new dependency is introduced.
//
// The server never stores a Google access token or refresh token — after the
// user is identified, the app issues its own access/refresh pair exactly as
// email/password login does.

const GOOGLE_DEFAULT_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

/** Issuer values Google uses for hosted (non-workplace) accounts. */
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

/** Extra cooldown so a running server does not hammer Google's JWKS. */
const JWKS_COOLDOWN_MS = 30_000;

export interface GoogleIdTokenClaims {
  /** Google's stable subject id (anonymous per app + Google pair). */
  sub: string;
  /** The verified email address. */
  email: string;
  /** Must be true before we trust `email` for account matching. */
  email_verified: boolean;
  /** Client id this token was minted for — must equal OUR client id. */
  aud: string;
  /** Issuer — must be in {@link GOOGLE_ISSUERS}. */
  iss: string;
  /** Display name, when present. */
  name?: string;
  /** Avatar URL, when present. */
  picture?: string;
}

/** A verifier whose key resolution is fully injectable — used by tests. */
type IdTokenVerifier = (token: string, clientId: string) => Promise<JWTPayload>;

/**
 * Verify a Google OIDC id_token and return its claims, or throw a 401.
 *
 * Two indirections exist so tests can run fully offline:
 *  - `jwksUri` defaults to Google's public JWKS; tests point it at a local
 *    server serving a stubbed key set.
 *  - `makeVerifier` defaults to the jose remote-JWKS verifier; tests swap it
 *    for a local key.
 */
export function verifyGoogleIdToken(
  token: string,
  opts: {
    clientId?: string;
    jwksUri?: string;
    makeVerifier?: (
      jwksUri: string,
      clientId: string,
    ) => IdTokenVerifier;
  } = {},
): Promise<GoogleIdTokenClaims> {
  const clientId = opts.clientId ?? config.googleClientId;
  if (!clientId) {
    return Promise.reject(serviceUnavailableError("Google OAuth is not configured (GOOGLE_CLIENT_ID)"));
  }

  const jwksUri = opts.jwksUri ?? config.googleJwksUri ?? GOOGLE_DEFAULT_JWKS_URI;
  const makeVerifier = opts.makeVerifier ?? defaultVerifier;
  const verify = makeVerifier(jwksUri, clientId);

  return verify(token, clientId).then((payload) => {
    const claims = payload as unknown as GoogleIdTokenClaims;

    if (!claims.sub || !claims.email || claims.email_verified !== true) {
      throw unauthorizedError("Invalid Google ID token");
    }
    if (!GOOGLE_ISSUERS.has(claims.iss)) {
      throw unauthorizedError("Invalid Google ID token");
    }
    if (claims.aud !== clientId) {
      throw unauthorizedError("Invalid Google ID token");
    }

    return claims;
  });
}

/**
 * Default verifier: validates signature, `iss`, `aud` and `exp` using jose
 * against the remote JWKS. `iss`/`aud` are validated twice on purpose — jose
 * rejects mismatches before our claim checks ever run, which keeps the failure
 * surface deterministic.
 */
function defaultVerifier(jwksUri: string, clientId: string): IdTokenVerifier {
  const jwks = createRemoteJWKSet(new URL(jwksUri), {
    cooldownDuration: JWKS_COOLDOWN_MS,
  });

  return async (token, expectedClientId) => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ["RS256"],
        issuer: [...GOOGLE_ISSUERS],
        audience: expectedClientId,
      });
      return payload;
    } catch (error) {
      // Harden: never leak WHICH check failed (signature, aud, iss, exp) —
      // a probe should not learn anything about why a token was rejected.
      const reason =
        error instanceof Error && error.message.includes("expired")
          ? "Invalid or expired Google ID token"
          : "Invalid Google ID token";
      throw unauthorizedError(reason);
    }
  };
}