import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT, exportJWK, importPKCS8, importSPKI, type JWK } from "jose";

import { verifyGoogleIdToken } from "@/services/google-oauth";

/**
 * Unit tests for the Google OIDC id_token verifier. Everything stays offline:
 * a local HTTP server serves a stubbed JWKS built from an RSA key we generate,
 * and id_tokens are minted with the matching private key. This exercises the
 * same signature / iss / aud / exp / email_verified checks production runs.
 */

const TEST_CLIENT_ID = "test-client.apps.googleusercontent.com";
const KID = "test-key-1";

let publicKeyPem: string;
let privateKeyPem: string;
let publicJwk: JWK;
let privateKey: CryptoKey;
let jwksServer: http.Server;
let jwksUri: string;

beforeAll(async () => {
  const { publicKey, privateKey: key } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  publicKeyPem = publicKey;
  privateKeyPem = key;

  const importedPublic = await importSPKI(publicKeyPem, "RS256");
  const exported = await exportJWK(importedPublic);
  publicJwk = { ...exported, kid: KID, alg: "RS256", use: "sig" };

  privateKey = await importPKCS8(privateKeyPem, "RS256");

  jwksServer = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  const address = jwksServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  jwksUri = `http://127.0.0.1:${port}/certs`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
});

/** Mint a Google-style OIDC id_token signed with the test private key. */
async function signIdToken(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload as never)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

function basePayload(): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    azp: TEST_CLIENT_ID,
    aud: TEST_CLIENT_ID,
    sub: "google-user-123",
    email: "google@example.com",
    email_verified: true,
    name: "Google User",
    picture: "https://example.com/avatar.png",
  };
}

describe("verifyGoogleIdToken (offline, local JWKS)", () => {
  /**
   * Resolves the opts at call time — `jwksUri` is only assigned once
   * `beforeAll` has bound the server, so building them eagerly at module
   * scope would capture `undefined`.
   */
  const verifyOpts = () => ({ clientId: TEST_CLIENT_ID, jwksUri });
  const verify = (token: string) => verifyGoogleIdToken(token, verifyOpts());

  it("accepts a valid id_token and returns the verified claims", async () => {
    const token = await signIdToken(basePayload());

    const claims = await verify(token);

    expect(claims.sub).toBe("google-user-123");
    expect(claims.email).toBe("google@example.com");
    expect(claims.email_verified).toBe(true);
    expect(claims.name).toBe("Google User");
  });

  it("rejects a token signed with the wrong key", async () => {
    const { publicKey, privateKey: otherKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    void publicKey;
    const other = await importPKCS8(otherKey, "RS256");
    const token = await new SignJWT(basePayload() as never)
      .setProtectedHeader({ alg: "RS256", kid: "other-key" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(other);

    await expect(verify(token)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("rejects a token whose audience is not our client id", async () => {
    const payload = { ...basePayload(), aud: "someone-else.apps.googleusercontent.com" };
    const token = await signIdToken(payload);

    await expect(verify(token)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("rejects a token from an unknown issuer", async () => {
    const payload = { ...basePayload(), iss: "https://evil.example.com" };
    const token = await signIdToken(payload);

    await expect(verify(token)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("rejects a token whose email is not verified", async () => {
    const payload = { ...basePayload(), email_verified: false };
    const token = await signIdToken(payload);

    await expect(verify(token)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("rejects a token with no email or sub claim", async () => {
    const payload = { iss: "https://accounts.google.com", aud: TEST_CLIENT_ID, email_verified: true };
    const token = await signIdToken(payload);

    await expect(verify(token)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("fails with 503 SERVICE_UNAVAILABLE when GOOGLE_CLIENT_ID is not configured", async () => {
    await expect(verifyGoogleIdToken("any.token", { jwksUri })).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("rejects garbage input", async () => {
    await expect(verify("not-a-jwt")).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});