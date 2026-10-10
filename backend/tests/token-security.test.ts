// ─────────────────────────────────────────────────────────────────────
// Token security — JWT forgery, token-type confusion and refresh rotation.
//
// The auth module signs tokens with `jose` in `src/utils/jwt.ts`. These
// tests forge tokens with the same algorithm/secret so they can prove the
// middleware rejects anything that is not a genuine, unexpired ACCESS token
// — independently of whether the signature check passes.
// ─────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT } from "jose";
import request from "supertest";

import { app } from "@/app";
import { config } from "@/config";
import { prisma, registerAndLogin } from "./helpers";

const BASE = "/api/v1";
const ISSUER = "studentos";

const realSecret = () => new TextEncoder().encode(config.jwtSecret);
const wrongSecret = () => new TextEncoder().encode("definitely-not-the-real-signing-secret-32!!");

interface RawTokenOptions {
  sub: string;
  type?: "access" | "refresh";
  email?: string;
  expiresInSeconds?: number;
  issuer?: string;
  audience?: string;
  alg?: string;
  secret?: Uint8Array;
}

/** Mint a token with the real signing key. Omitting `type` forges a
 *  correctly-signed token that is missing the claim entirely. */
async function mintToken(opts: RawTokenOptions): Promise<string> {
  const {
    sub,
    type,
    email = "forged@studentos.test",
    expiresInSeconds = 900,
    issuer = ISSUER,
    audience = ISSUER,
    alg = config.auth.algorithm,
    secret = realSecret(),
  } = opts;

  const claims: Record<string, unknown> = { sub, email };
  if (type !== undefined) claims.type = type;

  return new SignJWT(claims)
    .setProtectedHeader({ alg })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secret);
}

describe("JWT token security", () => {
  const password = "Pass123!";
  const email = "token-security@studentos.test";
  let userId: string;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const session = await registerAndLogin(email, password);
    userId = session.user.id;
    accessToken = session.accessToken;
    refreshToken = session.refreshToken;
  });

  describe("token-type confusion", () => {
    it("accepts a genuine access token (control)", async () => {
      const res = await request(app)
        .get(`${BASE}/auth/me`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(userId);
    });

    it("rejects a refresh token presented as an access token", async () => {
      const res = await request(app)
        .get(`${BASE}/auth/me`)
        .set("Authorization", `Bearer ${refreshToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_INVALID_TOKEN");
    });

    it("rejects a refresh token on a regular protected resource", async () => {
      const res = await request(app)
        .get(`${BASE}/tasks`)
        .set("Authorization", `Bearer ${refreshToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_INVALID_TOKEN");
    });

    it("rejects a signed access token that omits the `type` claim", async () => {
      const noType = await mintToken({ sub: userId, type: undefined });

      const res = await request(app)
        .get(`${BASE}/auth/me`)
        .set("Authorization", `Bearer ${noType}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_INVALID_TOKEN");
    });

    it("rejects an access token presented to /auth/refresh", async () => {
      const res = await request(app)
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: accessToken });

      expect(res.status).toBe(401);
    });
  });

  describe("signature and claim verification", () => {
    it("rejects a token signed with the wrong secret", async () => {
      const forged = await mintToken({ sub: userId, secret: wrongSecret() });

      const res = await request(app)
        .get(`${BASE}/auth/me`)
        .set("Authorization", `Bearer ${forged}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_INVALID_TOKEN");
    });

    it("rejects a token with the `none` algorithm", async () => {
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          sub: userId,
          type: "access",
          iss: ISSUER,
          aud: ISSUER,
          exp: Math.floor(Date.now() / 1000) + 900,
        }),
      ).toString("base64url");
      const unsigned = `${header}.${payload}.`;

      const res = await request(app)
        .get(`${BASE}/auth/me`)
        .set("Authorization", `Bearer ${unsigned}`);

      expect(res.status).toBe(401);
    });

    it("rejects a token minted for a different issuer or audience", async () => {
      const wrongIssuer = await mintToken({ sub: userId, issuer: "evil.example" });
      const wrongAudience = await mintToken({ sub: userId, audience: "evil.example" });

      for (const token of [wrongIssuer, wrongAudience]) {
        const res = await request(app)
          .get(`${BASE}/auth/me`)
          .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("AUTH_INVALID_TOKEN");
      }
    });

    it("rejects a tampered payload", async () => {
      const [header, payload, signature] = accessToken.split(".");
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
      decoded.sub = "some-other-user-id";
      const tampered = `${header}.${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;

      const res = await request(app)
        .get(`${BASE}/auth/me`)
        .set("Authorization", `Bearer ${tampered}`);

      expect(res.status).toBe(401);
    });

    it("reports an expired access token as AUTH_TOKEN_EXPIRED", async () => {
      const expired = await mintToken({ sub: userId, expiresInSeconds: -60 });

      const res = await request(app)
        .get(`${BASE}/auth/me`)
        .set("Authorization", `Bearer ${expired}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_TOKEN_EXPIRED");
    });

    it("rejects malformed Authorization headers", async () => {
      for (const header of ["", "Basic abc", "Bearer", "Bearer  "]) {
        const res = await request(app).get(`${BASE}/auth/me`).set("Authorization", header);
        expect(res.status, JSON.stringify(header)).toBe(401);
      }
    });
  });

  describe("refresh rotation", () => {
    async function freshRefreshToken(): Promise<string> {
      const login = await request(app)
        .post(`${BASE}/auth/login`)
        .send({ email, password });
      expect(login.status).toBe(200);
      return login.body.data.refreshToken as string;
    }

    it("returns a different token pair and invalidates the old refresh token", async () => {
      const first = await freshRefreshToken();

      const rotated = await request(app)
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: first });
      expect(rotated.status).toBe(200);
      const second = rotated.body.data.refreshToken as string;
      expect(second).not.toBe(first);
      expect(rotated.body.data.accessToken).toEqual(expect.any(String));

      const reuse = await request(app)
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: first });
      expect(reuse.status, "old refresh token must not be reusable").toBe(401);

      const stillValid = await request(app)
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: second });
      expect(stillValid.status).toBe(200);
    });

    it("rejects an expired but correctly-signed refresh token", async () => {
      const expired = await mintToken({ sub: userId, type: "refresh", expiresInSeconds: -60 });

      const res = await request(app)
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: expired });

      expect(res.status).toBe(401);
    });

    it("rejects a refresh token whose stored row has expired", async () => {
      const token = await freshRefreshToken();
      await prisma.refreshToken.updateMany({
        where: { token },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await request(app)
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: token });

      expect(res.status).toBe(401);
    });

    it("rejects a refresh token whose stored row was deleted (revocation)", async () => {
      const token = await freshRefreshToken();
      await prisma.refreshToken.deleteMany({ where: { token } });

      const res = await request(app)
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: token });

      expect(res.status).toBe(401);
    });

    it("rejects logout then reuse of the same refresh token", async () => {
      const token = await freshRefreshToken();

      const out = await request(app)
        .post(`${BASE}/auth/logout`)
        .send({ refreshToken: token });
      expect(out.status).toBe(200);

      const reuse = await request(app)
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: token });
      expect(reuse.status).toBe(401);
    });
  });
});
